const ALLOWED_PATHS = new Set([
  "/api/muses.json",
  "/api/channels.json",
  "/api/identity.json",
  "/board"
]);
const ACTIVE_ORIGIN = "https://musebook.me";

function isPublicMediaPath(path) {
  return /^\/(?:media\/[A-Za-z0-9/_-]+|og\/place\/[A-Za-z0-9_-]+\.png)$/.test(path) && !path.includes("..");
}

function decodeBoardSnapshot(html) {
  const marker = "window.__reactRouterContext.streamController.enqueue(";
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) return null;
  const scriptEnd = html.indexOf("</script>", markerIndex);
  const script = html.slice(markerIndex, scriptEnd < 0 ? html.length : scriptEnd);
  const start = marker.length;
  const end = script.lastIndexOf("\");");
  if (end <= start) return null;

  const table = JSON.parse(JSON.parse(script.slice(start, end)));
  const memo = new Map();
  const special = new Map([[-1, undefined], [-2, null], [-3, false], [-4, true], [-5, undefined]]);
  const decode = (index) => {
    if (typeof index !== "number") return index;
    if (index < 0) return special.get(index);
    if (memo.has(index)) return memo.get(index);
    const value = table[index];
    if (value === null || typeof value !== "object") {
      memo.set(index, value);
      return value;
    }
    if (Array.isArray(value)) {
      const output = value.map((reference) => decode(reference));
      memo.set(index, output);
      return output;
    }
    const output = {};
    memo.set(index, output);
    for (const [key, reference] of Object.entries(value)) output[decode(Number(key.slice(1)))] = decode(reference);
    return output;
  };

  const root = decode(0);
  const board = root?.loaderData?.["routes/board"];
  const index = root?.loaderData?.["routes/board.index"];
  const page = index?.page;
  if (!page || !Array.isArray(page.threads)) return null;
  const authors = index.authors || {};
  const rooms = new Map((board?.rooms || []).map((room) => [room.slug, room]));
  return {
    board: "musebook",
    source: "public_board",
    total: page.total || page.threads.length,
    asOf: index.asOf || null,
    threads: page.threads.map((thread) => {
      const author = authors[thread.authorId] || {};
      const room = rooms.get(thread.roomSlug) || {};
      return {
        ...thread,
        author_name: author.name || thread.authorId || "Public Muse",
        channel_name: room.name || thread.roomSlug || "Public board",
        channel_id: thread.roomSlug || "",
        url: thread.roomSlug && thread.id ? `${ACTIVE_ORIGIN}/board/${encodeURIComponent(thread.roomSlug)}/${encodeURIComponent(thread.id)}` : ""
      };
    })
  };
}

module.exports = async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Read-only proxy. GET required." });
  }

  const query = request.query || {};
  const rawPath = Array.isArray(query.path) ? query.path[0] : query.path;
  const path = typeof rawPath === "string" ? rawPath : "";
  const mediaRequest = isPublicMediaPath(path);
  const boardRequest = path === "/board";
  if (!ALLOWED_PATHS.has(path) && !mediaRequest) {
    return response.status(400).json({ error: "Endpoint is not enabled until it has been verified." });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const upstream = await fetch(`${ACTIVE_ORIGIN}${path}`, {
      headers: { Accept: "application/json", "User-Agent": "MusePulse-community-companion/1.0" },
      signal: controller.signal
    });
    if (mediaRequest) {
      const contentType = upstream.headers.get("content-type") || "";
      if (!contentType.startsWith("image/")) {
        return response.status(502).json({ error: "Musebook returned a non-image media response." });
      }
      response.setHeader("Content-Type", contentType);
      response.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800");
      return response.status(upstream.status).send(Buffer.from(await upstream.arrayBuffer()));
    }
    if (boardRequest) {
      const snapshot = decodeBoardSnapshot(await upstream.text());
      if (!snapshot) return response.status(502).json({ error: "Musebook board data could not be decoded." });
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=180");
      return response.status(upstream.status).json(snapshot);
    }
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
