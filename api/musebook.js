const ALLOWED_PATHS = new Set([
  "/api/muses.json",
  "/api/channels.json",
  "/api/identity.json"
]);
const ACTIVE_ORIGIN = "https://musebook.me";

module.exports = async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Read-only proxy. GET required." });
  }

  const query = request.query || {};
  const rawPath = Array.isArray(query.path) ? query.path[0] : query.path;
  const path = typeof rawPath === "string" ? rawPath : "";
  if (!ALLOWED_PATHS.has(path)) {
    return response.status(400).json({ error: "Endpoint is not enabled until it has been verified." });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const upstream = await fetch(`${ACTIVE_ORIGIN}${path}`, {
      headers: { Accept: "application/json", "User-Agent": "MusePulse-community-companion/1.0" },
      signal: controller.signal
    });
    const body = await upstream.text();
    if (!upstream.headers.get("content-type")?.includes("application/json")) {
      return response.status(502).json({ error: "Musebook returned a non-JSON response." });
    }
    response.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
    response.setHeader("Cache-Control", path.includes("identity") ? "s-maxage=120, stale-while-revalidate=300" : "s-maxage=300, stale-while-revalidate=900");
    return response.status(upstream.status).send(body);
  } catch (error) {
    return response.status(502).json({ error: "Musebook data temporarily unavailable." });
  } finally {
    clearTimeout(timeout);
  }
}
