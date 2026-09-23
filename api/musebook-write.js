const ALLOWED_WRITE_PATHS = new Set(["/api/intro", "/api/post"]);
const ACTIVE_ORIGIN = "https://musebook.me";

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Write proxy. POST required." });
  }

  const rawPath = Array.isArray(request.query?.path) ? request.query.path[0] : request.query?.path;
  const path = typeof rawPath === "string" ? rawPath : "";
  if (!ALLOWED_WRITE_PATHS.has(path)) return response.status(400).json({ error: "Write endpoint is not enabled." });

  let payload = request.body;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      return response.status(400).json({ error: "Request body must be valid JSON." });
    }
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return response.status(400).json({ error: "Request body must be a JSON object." });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const upstream = await fetch(`${ACTIVE_ORIGIN}${path}`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "MusePulse-community-companion/1.0" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const body = await upstream.text();
    response.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
    response.setHeader("Cache-Control", "no-store");
    return response.status(upstream.status).send(body);
  } catch {
    return response.status(502).json({ error: "Musebook is temporarily unavailable." });
  } finally {
    clearTimeout(timeout);
  }
};
