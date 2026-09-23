const ALLOWED_PATHS = new Set([
  "/api/muses.json",
  "/api/channels.json",
  "/api/identity.json"
]);
const DIAGNOSTIC_PATHS = new Set(["/", ...ALLOWED_PATHS]);
const UPSTREAM_ORIGINS = {
  lol: "https://musebook.lol",
  world: "https://musebook.world",
  me: "https://musebook.me"
};

function diagnosticResult(target, upstream, body) {
  const contentType = upstream.headers.get("content-type") || null;
  let jsonValid = false;
  let jsonError = null;
  try {
    JSON.parse(body);
    jsonValid = true;
  } catch (error) {
    jsonError = error.message;
  }
  return {
    target,
    reachable: true,
    httpStatus: upstream.status,
    contentType,
    responseSizeBytes: Buffer.byteLength(body, "utf8"),
    jsonValid,
    jsonError
  };
}

module.exports = async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Read-only proxy. GET required." });
  }

  const query = request.query || {};
  const diagnostic = query.diagnostic === "1";
  const originKey = Array.isArray(query.origin) ? query.origin[0] : query.origin;
  const origin = typeof originKey === "string" ? UPSTREAM_ORIGINS[originKey] : null;
  const rawPath = Array.isArray(query.path) ? query.path[0] : query.path;
  const path = typeof rawPath === "string" ? rawPath : "";
  if (diagnostic && (!origin || !DIAGNOSTIC_PATHS.has(path))) {
    return response.status(400).json({ error: "Diagnostic target is not enabled." });
  }
  if (!diagnostic && !ALLOWED_PATHS.has(path)) {
    return response.status(400).json({ error: "Endpoint is not enabled until it has been verified." });
  }

  const target = `${origin || UPSTREAM_ORIGINS.lol}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const upstream = await fetch(target, {
      headers: { Accept: "application/json", "User-Agent": "MusePulse-community-companion/1.0" },
      signal: controller.signal
    });
    const body = await upstream.text();
    if (diagnostic) {
      response.setHeader("Cache-Control", "no-store");
      return response.status(200).json(diagnosticResult(target, upstream, body));
    }
    if (!upstream.headers.get("content-type")?.includes("application/json")) {
      return response.status(502).json({ error: "Musebook returned a non-JSON response." });
    }
    response.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
    response.setHeader("Cache-Control", path.includes("identity") ? "s-maxage=120, stale-while-revalidate=300" : "s-maxage=300, stale-while-revalidate=900");
    return response.status(upstream.status).send(body);
  } catch (error) {
    if (diagnostic) {
      const cause = error?.cause;
      response.setHeader("Cache-Control", "no-store");
      return response.status(200).json({
        target,
        reachable: false,
        httpStatus: null,
        contentType: null,
        responseSizeBytes: 0,
        jsonValid: false,
        jsonError: null,
        error: {
          name: error?.name || "Error",
          message: error?.message || String(error),
          code: cause?.code || error?.code || null,
          cause: cause?.message || null
        }
      });
    }
    return response.status(502).json({ error: "Musebook data temporarily unavailable." });
  } finally {
    clearTimeout(timeout);
  }
}
