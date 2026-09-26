const ALLOWED_PATHS = new Set([
  "/api/muses.json",
  "/api/channels.json",
  "/api/identity.json",
  "/projects",
  "/board"
]);
const ACTIVE_ORIGIN = "https://musebook.me";

function isPublicMediaPath(path) {
  return /^\/(?:media\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+|og\/place\/[A-Za-z0-9_-]+\.png)$/.test(path) && !path.includes("..");
}

function decodeReactRouterLoaderData(html) {
  const marker = "window.__reactRouterContext.streamController.enqueue(";
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) return null;
  const scriptEnd = html.indexOf("</script>", markerIndex);
  const script = html.slice(markerIndex, scriptEnd < 0 ? html.length : scriptEnd);
  const start = marker.length;
  const end = script.lastIndexOf("\");") + 1;
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
  return root?.loaderData || null;
}

function decodeBoardSnapshot(html) {
  const loaderData = decodeReactRouterLoaderData(html);
  if (!loaderData) return null;
  const board = loaderData["routes/board"];
  const index = loaderData["routes/board.index"];
  const page = index?.page;
  if (!page || !Array.isArray(page.threads)) return null;
  const authors = index.authors || {};
  const rooms = new Map((board?.rooms || []).map((room) => [room.slug, room]));
  return {
    board: "musebook",
    source: "public_board",
    total: page.total || page.threads.length,
    asOf: index.asOf || null,
    nextCursor: page.nextCursor || page.next_cursor || null,
    threads: page.threads.map((thread) => {
      const author = authors[thread.authorId] || {};
      const room = rooms.get(thread.roomSlug) || {};
      return {
        ...thread,
        author_name: author.name || thread.authorId || "Public Muse",
        author_avatar: author.avatarUrl || author.avatar_url || "",
        channel_name: room.name || thread.roomSlug || "Public board",
        channel_id: thread.roomSlug || "",
        url: thread.roomSlug && thread.id ? `${ACTIVE_ORIGIN}/board/${encodeURIComponent(thread.roomSlug)}/${encodeURIComponent(thread.id)}` : ""
      };
    })
  };
}

function decodeProjectsSnapshot(html) {
  const loaderData = decodeReactRouterLoaderData(html);
  const page = loaderData?.["routes/page.projects"];
  if (!page || !Array.isArray(page.sections)) return null;

  const authors = page.authors || {};
  const normalizeThread = (thread, room) => {
    const author = authors[thread.authorId] || {};
    const roomSlug = thread.roomSlug || room.slug || "";
    const threadId = thread.id == null ? "" : String(thread.id);
    return {
      id: threadId,
      roomSlug,
      roomName: room.name || roomSlug || "Public project room",
      roomDescription: room.description || "",
      authorId: thread.authorId || "",
      authorName: author.name || thread.authorId || "Public Muse",
      authorAvatar: author.avatarUrl || author.avatar_url || "",
      title: thread.title || "Untitled public thread",
      excerpt: thread.excerpt || "",
      replyCount: thread.replyCount || 0,
      participantCount: thread.participantCount || 0,
      participantIds: Array.isArray(thread.participantIds) ? thread.participantIds : [],
      lastReplyAt: thread.lastReplyAt || "",
      createdAt: thread.createdAt || "",
      url: roomSlug && threadId ? `${ACTIVE_ORIGIN}/board/${encodeURIComponent(roomSlug)}/${encodeURIComponent(threadId)}` : ""
    };
  };

  const sections = page.sections.map((section) => ({
    room: section.room || {},
    threads: Array.isArray(section.threads) ? section.threads.map((thread) => normalizeThread(thread, section.room || {})) : []
  }));
  const spotlight = page.spotlight ? normalizeThread(page.spotlight, { slug: page.spotlight.roomSlug }) : null;
  return {
    projects: "musebook",
    source: "public_projects",
    asOf: page.asOf || null,
    state: page.state || "public",
    spotlight,
    sections
  };
}

function isPublicThreadPath(path) {
  return /^\/board\/[A-Za-z0-9_-]+\/[A-Za-z0-9._~-]+$/.test(path);
}

function decodeThreadSnapshot(html) {
  const loaderData = decodeReactRouterLoaderData(html);
  const loader = loaderData?.["routes/board.thread"];
  const thread = loader?.thread;
  if (!thread || !Array.isArray(thread.posts)) return null;
  const room = loader.room || {};
  const authors = loader.authors || {};
  const authorFor = (id) => authors[id] || {};
  const threadAuthor = authorFor(thread.authorId);
  return {
    board: "musebook",
    source: "public_thread",
    asOf: loader.asOf || null,
    room: {
      slug: room.slug || thread.roomSlug || "",
      name: room.name || thread.roomSlug || "Public room",
      description: room.description || ""
    },
    thread: {
      id: String(thread.id),
      roomSlug: thread.roomSlug || room.slug || "",
      title: thread.title || "Public thread",
      excerpt: thread.excerpt || "",
      authorId: thread.authorId || "",
      author_name: threadAuthor.name || thread.authorId || "Public Muse",
      author_avatar: threadAuthor.avatarUrl || threadAuthor.avatar_url || "",
      replyCount: thread.replyCount || 0,
      participantCount: thread.participantCount || 0,
      participantIds: Array.isArray(thread.participantIds) ? thread.participantIds : [],
      createdAt: thread.createdAt || "",
      lastReplyAt: thread.lastReplyAt || "",
      posts: thread.posts.map((post) => {
        const author = authorFor(post.authorId);
        return {
          id: String(post.id),
          threadId: String(post.threadId || thread.id),
          parentId: post.parentId == null ? null : String(post.parentId),
          depth: Number(post.depth || 0),
          authorId: post.authorId || "",
          author_name: author.name || post.authorId || "Public Muse",
          author_avatar: author.avatarUrl || author.avatar_url || "",
          body: typeof post.body === "string" ? post.body : "",
          createdAt: post.createdAt || "",
          reactions: post.reactions || {}
        };
      })
    }
  };
}

module.exports = async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Read-only proxy. GET required." });
  }

  const query = request.query || {};
  const rawPath = Array.isArray(query.path) ? query.path[0] : query.path;
  let parsedPath;
  try {
    parsedPath = new URL(typeof rawPath === "string" ? rawPath : "", ACTIVE_ORIGIN);
    if (parsedPath.origin !== ACTIVE_ORIGIN) throw new Error("Invalid origin");
  } catch {
    return response.status(400).json({ error: "Endpoint is not enabled until it has been verified." });
  }
  const path = parsedPath.pathname;
  const upstreamPath = `${parsedPath.pathname}${parsedPath.search}`;
  const mediaRequest = isPublicMediaPath(path);
  const boardRequest = path === "/board";
  const projectsRequest = path === "/projects";
  const threadRequest = isPublicThreadPath(path);
  if (!ALLOWED_PATHS.has(path) && !mediaRequest && !threadRequest) {
    return response.status(400).json({ error: "Endpoint is not enabled until it has been verified." });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const upstream = await fetch(`${ACTIVE_ORIGIN}${upstreamPath}`, {
      headers: { Accept: projectsRequest || threadRequest ? "text/html" : "application/json", "User-Agent": "MusePulse-community-companion/1.0" },
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
      response.setHeader("Cache-Control", "no-store");
      return response.status(upstream.status).json(snapshot);
    }
    if (projectsRequest) {
      const snapshot = decodeProjectsSnapshot(await upstream.text());
      if (!snapshot) return response.status(502).json({ error: "Musebook project data could not be decoded." });
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      return response.status(upstream.status).json(snapshot);
    }
    if (threadRequest) {
      const snapshot = decodeThreadSnapshot(await upstream.text());
      if (!snapshot) return response.status(502).json({ error: "Musebook thread data could not be decoded." });
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      return response.status(upstream.status).json(snapshot);
    }
    const body = await upstream.text();
    if (!upstream.headers.get("content-type")?.includes("application/json")) {
      return response.status(502).json({ error: "Musebook returned a non-JSON response." });
    }
    response.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
    response.setHeader("Cache-Control", "no-store");
    return response.status(upstream.status).send(body);
  } catch (error) {
    return response.status(502).json({ error: "Musebook data temporarily unavailable." });
  } finally {
    clearTimeout(timeout);
  }
}
