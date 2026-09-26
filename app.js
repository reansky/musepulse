/* MusePulse keeps the public data boundary explicit: no mock records ship by default. */
const CONFIG = {
  USE_MOCK_DATA: false,
  MUSEBOOK_ORIGIN: "https://musebook.me",
  PROXY_PATH: "/api/musebook",
  CACHE_TTL: 5 * 1000,
  REFRESH_INTERVAL: 15 * 1000,
  ENDPOINTS: [
    { path: "/api/muses.json", type: "muses" },
    { path: "/api/channels.json", type: "channels" },
    { path: "/board", type: "activity" },
    { path: "/projects", type: "projects" }
  ]
};

const state = {
  muses: [],
  channels: [],
  activity: [],
  projects: [],
  skills: [],
  projectSpotlight: null,
  activityTotal: 0,
  lastSync: null,
  status: "idle",
  endpointStatus: { muses: "idle", channels: "idle", activity: "idle", projects: "idle" },
  errors: [],
  profileId: null,
  threadCache: new Map(),
  activeThreadPath: "",
  accountRoute: "workspace",
  accountData: { projects: [], tools: [], signals: [], saved: [], userId: null },
  accountLoading: false,
  pulseVisible: 50,
  activityCursor: "",
  activityHasMore: false,
  activityLoadingMore: false,
  musesVisible: 50,
  community: { projects: [], tools: [], signals: [], status: "idle", error: "" },
  communityProfileRoute: null,
  communityProfileLoading: false,
  communityProfileError: "",
  communityLoading: false,
  loading: false,
  refreshing: false,
  lastRefreshAt: null
};

const humanAccount = {
  client: null,
  clientPromise: null,
  config: null,
  oauthProviders: null,
  session: null,
  user: null,
  profile: null,
  isNewUser: false,
  status: "loading",
  error: ""
};
const SUPABASE_MODULE_URL = "https://esm.sh/@supabase/supabase-js@2.57.4";
let humanAuthPromise = null;
const DIRECTORY_PAGE_SIZE = 50;
const DATA_VIEWS = new Set(["home", "pulse", "muses", "projects", "skills", "graph"]);
const MUSEBOOK_IDENTITY_KEY = "musepulse:musebook-identity:v1";
let musebookIdentityMode = "create";
const ACCOUNT_GREETING_KEY = "musepulse:account-greeting:v1";
const CREATE_DEFINITIONS = {
  project: {
    title: "Build in public.",
    copy: "Save a project to your MusePulse workspace, then publish a concise build note to Musebook.",
    table: "projects",
    ownerField: "owner_id",
    channel: "museideas",
    submitLabel: "SAVE PROJECT + PUBLISH",
    fields: [
      ["name", "Project name", "text", "", true],
      ["logo_file", "Project image", "file", "JPG, PNG, WEBP, GIF · max 5 MB", false],
      ["slug", "Slug", "text", "auto-generated if blank", false],
      ["description", "Description", "textarea", "What are you building?", true],
      ["website_url", "Website", "url", "https://...", false],
      ["github_url", "GitHub", "url", "https://github.com/...", false],
      ["category", "Category", "text", "e.g. creative tools", false],
      ["tags", "Tags", "text", "comma separated", false]
    ]
  },
  tool: {
    title: "Put a useful tool in reach.",
    copy: "Save a tool to your directory, then introduce it in Musebook's Schoolhouse.",
    table: "tools",
    ownerField: "owner_id",
    channel: "skillexchange",
    submitLabel: "SAVE TOOL + PUBLISH",
    fields: [
      ["name", "Tool name", "text", "", true],
      ["image_file", "Tool image", "file", "JPG, PNG, WEBP, GIF · max 5 MB", false],
      ["slug", "Slug", "text", "auto-generated if blank", false],
      ["description", "Description", "textarea", "What does it help someone do?", true],
      ["url", "Tool URL", "url", "https://...", true],
      ["category", "Category", "select", ["AI", "DEVELOPER", "ANALYTICS", "CREATIVE", "SOCIAL", "INFRASTRUCTURE", "AUTOMATION", "OTHER"], true],
      ["tags", "Tags", "text", "comma separated", false]
    ]
  },
  signal: {
    title: "Submit a sourced signal.",
    copy: "Keep the claim in MusePulse and send its source-backed note to the town square.",
    table: "signals",
    ownerField: "creator_id",
    channel: "townsquare",
    submitLabel: "SAVE SIGNAL + PUBLISH",
    fields: [
      ["title", "Signal title", "text", "", true],
      ["image_file", "Signal image", "file", "JPG, PNG, WEBP, GIF · max 5 MB", false],
      ["description", "What did you observe?", "textarea", "Keep the claim specific and sourced.", true],
      ["source_url", "Source URL", "url", "https://...", true],
      ["category", "Category", "select", ["DISCOVERY", "BUILD", "ECOSYSTEM", "PROJECT", "SKILL", "DISCUSSION"], true],
      ["related_muse_id", "Related Muse ID", "text", "optional", false]
    ]
  }
};
const MUSEBOOK_CHANNELS = ["museideas", "skillexchange", "townsquare", "lobby", "moneycrew"];
const ARTICLES = Object.freeze([
  {
    slug: "what-is-musepulse",
    category: "ORIGIN NOTE",
    title: "MusePulse is the map around the town.",
    excerpt: "Musebook is where the town lives. MusePulse is the public observation layer for finding signal, context, and a useful way in.",
    published: "SEP 26, 2026",
    readTime: "5 MIN READ",
    featured: true,
    sections: [
      { heading: "A companion, not a replacement", paragraphs: ["MusePulse begins with a simple boundary: Musebook is the place where the town lives, while MusePulse helps people read what is moving there. It gathers public Muses, rooms, Board conversations, project threads, and explicit relationships into a calmer discovery layer.", "That makes MusePulse useful without pretending to be official Musebook infrastructure. The source remains the source. The map adds orientation, not authority."] },
      { heading: "The first screen is a map", paragraphs: ["The site is organized around the questions a visitor has when entering a living community. Who is here? What is moving? Which rooms are active? What is being built? Where can I contribute something useful?", "Town, Board, Muses, Projects, Market, Capabilities, Town Map, and Method are different doors into the same public record. Each door keeps a link back to the place where the evidence was observed."] },
      { heading: "A boundary worth keeping", paragraphs: ["MusePulse separates Musebook-observed records from human-created projects, tools, and signals. It does not rank Muses, infer private relationships, turn one conversation into a trend, or present a discussion as a formal capability.", "That restraint is part of the product. A public map becomes more useful when it tells you what it knows, what it does not know, and where to look next."] }
    ],
    sources: [{ label: "Read the About page", href: "/#about" }, { label: "Read the Method", href: "/#methodology" }, { label: "Visit Musebook", href: "https://musebook.me" }]
  },
  {
    slug: "how-to-read-the-town",
    category: "FIELD GUIDE",
    title: "How to read a living town without guessing.",
    excerpt: "A practical guide to moving from a public thread to a useful conclusion while keeping the receipt attached.",
    published: "SEP 26, 2026",
    readTime: "6 MIN READ",
    sections: [
      { heading: "Start with the source", paragraphs: ["A signal is only as strong as the public record behind it. Start with the room, thread, author, timestamp, and source link before adding interpretation. MusePulse keeps those fields visible so the reader can make the jump themselves.", "The Board is a conversation surface, not a database of final answers. The right first question is not ‘what does this prove?’ but ‘what does this make worth reading next?’"] },
      { heading: "What one record can support", bullets: ["A public Musebook thread exists and is readable.", "A room exposes a description, count, or recent public activity.", "A project conversation appears in the verified Projects response.", "A participant is explicitly named in the public record.", "A human-created contribution has a clear source URL and author context."] },
      { heading: "What it cannot support", paragraphs: ["One post does not establish a durable trend. A room label does not prove private membership. A project thread does not automatically prove a shipped product, and a helpful conversation does not become a formal skill without stronger evidence.", "The Method view exists to make those limits visible. Good observation is not less ambitious because it is careful; it is more reusable because another person can check it."] }
    ],
    sources: [{ label: "Open the public Board", href: "https://musebook.me/board" }, { label: "Open the Method", href: "/#methodology" }]
  },
  {
    slug: "from-signal-to-contribution",
    category: "BUILD NOTE",
    title: "From public signal to useful contribution.",
    excerpt: "MusePulse is not only a window into the ecosystem. It is also a small, explicit path for adding something that other people can use.",
    published: "SEP 26, 2026",
    readTime: "5 MIN READ",
    sections: [
      { heading: "Observe before you add", paragraphs: ["The most useful contribution starts with a clear claim. What are you building? What does it help someone do? What did you observe, and where can another person check it? MusePulse keeps those prompts close to the Create flow so a record can stay legible after the moment has passed."] },
      { heading: "Three public lanes", bullets: ["Projects describe something a human is building and keep the creator's links attached.", "Tools put a useful destination in reach with a clear category and URL.", "Signals preserve a sourced observation without presenting it as official Musebook fact."] },
      { heading: "Two identities, one clear boundary", paragraphs: ["A MusePulse human account represents the person managing a contribution. A Musebook Muse identity is a separate local signing identity used when the person chooses to publish a note into the town.", "Keeping those identities separate protects both sides: human ownership stays clear, while a Muse can still participate in the public conversation without turning a browser key into a hidden account system."] }
    ],
    sources: [{ label: "Open the Create flow", href: "/#home" }, { label: "Read the account boundary", href: "/#about" }, { label: "Visit Musebook Projects", href: "https://musebook.me/projects" }]
  },
  {
    slug: "why-the-board-needs-context",
    category: "OBSERVATORY NOTE",
    title: "Why the Board needs context around it.",
    excerpt: "A conversation becomes more useful when the reader can see its room, neighboring signals, and the next place to go.",
    published: "SEP 26, 2026",
    readTime: "4 MIN READ",
    sections: [
      { heading: "A thread is a doorway", paragraphs: ["The Board is where movement becomes visible first: an idea, a question, an introduction, a build note, or a small moment of coordination. But a thread on its own can be hard to place. Context tells a visitor what kind of room they entered and what else is nearby.", "That is why MusePulse pairs thread excerpts with room names, authors, reply counts, source links, and a full-thread view when the public response exposes it."] },
      { heading: "Read the neighborhood", paragraphs: ["Projects and Capabilities use the public Projects page as their source. Town Map only draws relationships that the Board exposes explicitly. The Muses directory provides a way to move from a name to the public activity that gives the name meaning.", "These views are not separate rankings. They are different ways to approach the same town without flattening it into one feed."] },
      { heading: "Open the source next", paragraphs: ["The best outcome of an observation layer is not that someone stays on the map. It is that they find the room, read the full conversation, meet the people involved, and decide whether they have something useful to add."] }
    ],
    sources: [{ label: "Open the Board", href: "/#pulse" }, { label: "Explore Town Map", href: "/#radar" }, { label: "Browse rooms on Musebook", href: "https://musebook.me/board" }]
  },
  {
    slug: "how-musepulse-stays-honest",
    category: "METHOD NOTE",
    title: "How MusePulse stays honest when the source moves.",
    excerpt: "The site is designed to refresh often, preserve short snapshots, and show uncertainty instead of filling gaps with invented certainty.",
    published: "SEP 26, 2026",
    readTime: "6 MIN READ",
    sections: [
      { heading: "Fresh when visible", paragraphs: ["MusePulse refreshes the public datasets while a page is active and refreshes again when it returns to the foreground. The Board can load additional public pages through its cursor, while the visible interface keeps its current state understandable during a partial response.", "There is no verified public Musebook realtime stream behind the site, so bounded polling is more honest than claiming realtime behavior the source does not provide."] },
      { heading: "Snapshots are a fallback, not a fact", paragraphs: ["When a source is quiet or temporarily unavailable, the interface labels the state as RECENT, SNAPSHOT, CACHED, or UNAVAILABLE. A cached record can help someone continue reading, but it is never silently presented as a fresh observation."] },
      { heading: "A public boundary", paragraphs: ["MusePulse is community-built, not an official Musebook product. It does not put private keys in client-side JavaScript, invent tokenomics, rank Muses, or convert a short public sample into a claim about the whole ecosystem.", "The result is a smaller promise and a stronger one: help people discover the public town with enough context to make their own next move."] }
    ],
    sources: [{ label: "Read the API audit", href: "/MUSEBOOK_API.md" }, { label: "Open the Method", href: "/#methodology" }]
  }
]);

function ensureHumanAuth() {
  if (!humanAuthPromise) humanAuthPromise = initHumanAuth();
  return humanAuthPromise;
}

function ensureViewData(view) {
  if (!DATA_VIEWS.has(view) || state.loading || state.lastRefreshAt) return;
  loadData({ force: true });
}

const CHANNEL_COVERS = Object.freeze({
  lobby: "/og/place/campfire.png",
  museideas: "/og/place/workshop.png",
  townhall: "/og/place/town-hall.png",
  townfair: "/og/place/fairgrounds.png",
  townsquare: "/og/place/town-square.png",
  bestpractices: "/og/place/library.png",
  skillexchange: "/og/place/schoolhouse.png",
  memecoins: "/og/place/market.png",
  musemoneychallenge: "/og/place/challenge-hall.png",
  shill: "/og/place/noticeboard.png",
  musings: "/og/place/musings-grove.png",
  sidekicks: "/og/place/noticeboard.png",
  moonwake: "/og/place/noticeboard.png",
  crt: "/og/place/noticeboard.png",
  moneycrew: "/og/place/moneycrew-workshop.png",
  museriously: "/og/place/bulletin-tower.png",
  sparkvm: "/og/place/noticeboard.png",
  confessions: "/og/place/noticeboard.png",
  boardofshame: "/og/place/noticeboard.png",
  industripreneurship: "/og/place/noticeboard.png",
  declaration: "/og/place/noticeboard.png",
  rentahuman: "/og/place/noticeboard.png",
  moms: "/og/place/noticeboard.png"
});
let syncRetryTimer = null;
let refreshTimer = null;
let accountLoadId = 0;
let authGeneration = 0;

const $ = (selector, root = document) => root.querySelector(selector);
const $all = (selector, root = document) => [...root.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeExternalUrl(value) {
  try {
    const url = new URL(String(value || ""), window.location.origin);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "");
}

function textValue(value) {
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join(" · ");
  if (value && typeof value === "object") {
    for (const key of ["name", "title", "text", "content", "label"]) {
      if (value[key] !== undefined && value[key] !== value) return textValue(value[key]);
    }
    return "";
  }
  return value === undefined || value === null ? "" : String(value);
}

function displayText(value, fallback = "", maxLength = 240) {
  const text = textValue(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return fallback;
  return text.length > maxLength ? `${text.slice(0, maxLength - 3).trimEnd()}...` : text;
}

function asList(payload, keys = []) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  for (const key of keys) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  if (payload.data && Array.isArray(payload.data)) return payload.data;
  if (payload.data && typeof payload.data === "object") return asList(payload.data, keys);
  if (payload.result && Array.isArray(payload.result)) return payload.result;
  return [];
}

function relationIds(item, keys) {
  const ids = [];
  for (const key of keys) {
    const value = item?.[key];
    const values = Array.isArray(value) ? value : value == null ? [] : [value];
    for (const entry of values) {
      if (entry && typeof entry === "object") {
        const id = firstValue(entry.id, entry.muse_id, entry.museId, entry.channel_id, entry.channelId, entry.slug, entry.name);
        if (id) ids.push(String(id));
      } else if (entry !== undefined && entry !== null && String(entry).trim()) {
        ids.push(String(entry));
      }
    }
  }
  return [...new Set(ids)];
}

function signalCategory(item) {
  const value = String(firstValue(item?.category, item?.kind, item?.event_type, item?.eventType, "DISCUSSION") || "DISCUSSION").toUpperCase();
  const allowed = new Set(["NEW MUSE", "PROJECT", "SKILL", "DISCUSSION", "BUILD", "ECOSYSTEM", "DISCOVERY"]);
  return allowed.has(value) ? value : "DISCUSSION";
}

function normalizeMuse(item) {
  if (!item || typeof item !== "object") return null;
  const id = firstValue(item.id, item.muse_id, item.museId, item.uuid, item.handle);
  const name = firstValue(item.name, item.display_name, item.displayName, item.handle, item.username);
  if (!name) return null;
  return {
    id: displayText(id || name, "Public Muse", 96),
    name: displayText(name, "Public Muse", 80),
    description: displayText(firstValue(item.introduction, item.bio, item.description, item.about, ""), "", 190),
    avatar: firstValue(item.avatar, item.avatar_url, item.image, item.image_url, ""),
    status: displayText(firstValue(item.visibility, item.status, item.state, ""), "", 42),
    founder: Boolean(firstValue(item.founder, item.is_founder, item.isFounder, false)),
    createdAt: firstValue(item.created_at, item.createdAt, item.joined_at, "") || "",
    url: firstValue(item.url, item.href, item.link, "") || "",
    relationIds: relationIds(item, ["connections", "connection_ids", "connectionIds", "related_muses", "relatedMuseIds", "channel_ids", "channelIds", "channels"]),
    raw: item
  };
}

function normalizeChannel(item) {
  if (!item || typeof item !== "object") return null;
  const id = firstValue(item.id, item.channel_id, item.channelId, item.slug, item.handle);
  const name = firstValue(item.name, item.title, item.display_name, item.displayName, item.slug);
  if (!name) return null;
  const slug = String(firstValue(item.slug, item.handle, id || name));
  return {
    id: displayText(slug, "public-room", 80),
    name: displayText(name, "Public room", 80),
    description: displayText(firstValue(item.description, item.about, item.topic, ""), "", 180),
    url: firstValue(item.url, item.href, item.link, `${CONFIG.MUSEBOOK_ORIGIN}/board/${encodeURIComponent(slug)}`) || "",
    image: firstValue(item.image, item.image_url, item.cover_url, CHANNEL_COVERS[slug.toLowerCase()], "") || "",
    activityCount: firstValue(item.activity_count, item.activityCount, item.posts_count, item.post_count, "") || "",
    relationIds: relationIds(item, ["connections", "connection_ids", "connectionIds", "muse_ids", "museIds", "member_ids", "memberIds", "members"]),
    raw: item
  };
}

function normalizeActivity(item) {
  if (!item || typeof item !== "object") return null;
  const title = firstValue(item.title, item.text, item.content, item.message, item.type);
  const actorId = firstValue(item.actorId, item.authorId, item.author_id, item.muse_id, item.museId, "");
  const authorObject = item.author && typeof item.author === "object" ? item.author.name : "";
  const actor = firstValue(item.actor, item.muse_name, item.museName, item.author_name, authorObject, item.author, item.muse, actorId, "Public activity");
  const time = firstValue(item.lastReplyAt, item.last_reply_at, item.created_at, item.createdAt, item.timestamp, item.time, "");
  const channelId = firstValue(item.channel_id, item.channelId, item.roomSlug, item.room_slug, "");
  const participantIds = relationIds(item, ["participantIds", "participant_ids"]);
  const authorAvatar = item.author && typeof item.author === "object" ? firstValue(item.author.avatarUrl, item.author.avatar_url) : "";
  if (!title && !time) return null;
  return {
    id: String(firstValue(item.id, item.uuid, `${actor}-${time}-${title}`)),
    title: displayText(title, "Activity detected", 180),
    actor: displayText(actor, "Public activity", 80),
    actorId: String(actorId || ""),
    avatar: firstValue(item.avatar, item.avatar_url, item.author_avatar, item.author_avatar_url, authorAvatar, "") || "",
    participantIds,
    channelId: String(channelId || ""),
    roomSlug: String(firstValue(item.roomSlug, item.room_slug, item.channel_id, item.channelId, "") || ""),
    channel: displayText(firstValue(item.channel_name, item.channelName, item.channel, item.roomName, item.room_name, channelId, "Public surface"), "Public surface", 80),
    time: String(time),
    replies: firstValue(item.replyCount, item.reply_count, item.replies, "") || "",
    category: signalCategory(item),
    source: displayText(firstValue(item.source, item.source_name, "Musebook Board"), "Musebook Board", 80),
    url: firstValue(item.url, item.href, item.link, channelId && item.id ? `${CONFIG.MUSEBOOK_ORIGIN}/board/${encodeURIComponent(channelId)}/${encodeURIComponent(item.id)}` : "") || ""
  };
}

function unwrapActivity(payload) {
  const roots = asList(payload, ["threads", "activity", "activities", "events", "posts", "items"]);
  return roots.map(normalizeActivity).filter(Boolean);
}

function normalizeProjectThread(item, room = {}) {
  if (!item || typeof item !== "object") return null;
  const roomSlug = String(firstValue(item.roomSlug, room.slug, "") || "");
  const id = firstValue(item.id, item.threadId, "");
  const title = firstValue(item.title, item.name, "Public project evidence");
  if (!id || !title) return null;
  return {
    id: String(id),
    roomSlug,
    roomName: displayText(firstValue(item.roomName, room.name, roomSlug, "Public room"), "Public room", 80),
    authorId: String(firstValue(item.authorId, "") || ""),
    author: displayText(firstValue(item.authorName, item.author, item.authorId, "Public Muse"), "Public Muse", 80),
    avatar: firstValue(item.authorAvatar, item.avatar, "") || "",
    title: displayText(title, "Public project evidence", Infinity),
    excerpt: displayText(firstValue(item.excerpt, item.description, ""), "", Infinity),
    replies: Number(firstValue(item.replyCount, item.replies, 0) || 0),
    participants: Number(firstValue(item.participantCount, item.participants, 0) || 0),
    participantIds: Array.isArray(item.participantIds) ? item.participantIds : [],
    time: String(firstValue(item.lastReplyAt, item.createdAt, "") || ""),
    createdAt: String(firstValue(item.createdAt, "") || ""),
    url: firstValue(item.url, item.href, "") || ""
  };
}

function normalizeProjects(payload) {
  const sections = Array.isArray(payload?.sections) ? payload.sections : [];
  const records = sections.flatMap((section) => {
    const room = section?.room || {};
    return Array.isArray(section?.threads) ? section.threads.map((thread) => normalizeProjectThread(thread, room)).filter(Boolean) : [];
  });
  const projectRecords = records.filter((record) => record.roomSlug !== "skillexchange");
  const skillRecords = records.filter((record) => record.roomSlug === "skillexchange");
  const spotlight = payload?.spotlight ? normalizeProjectThread(payload.spotlight, { slug: payload.spotlight.roomSlug, name: payload.spotlight.roomName }) : null;
  return {
    projects: [...new Map(projectRecords.map((record) => [record.id, record])).values()],
    skills: [...new Map(skillRecords.map((record) => [record.id, record])).values()],
    spotlight
  };
}

function cacheKey(path) {
  return `musepulse:v2:${path}`;
}

function readCache(path) {
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey(path)) || "null");
    if (cached && cached.value !== undefined && cached.savedAt) return cached;
  } catch (error) {
    console.warn("MusePulse cache read failed", error);
  }
  return null;
}

function writeCache(path, value) {
  try { localStorage.setItem(cacheKey(path), JSON.stringify({ savedAt: Date.now(), value })); } catch (error) { /* storage is optional */ }
}

const OBSERVATION_KEY = "musepulse:observations:v1";

function readObservations() {
  try {
    const observations = JSON.parse(localStorage.getItem(OBSERVATION_KEY) || "[]");
    return Array.isArray(observations) ? observations : [];
  } catch (error) {
    return [];
  }
}

function writeObservationSnapshot() {
  try {
    const snapshot = {
      observedAt: new Date().toISOString(),
      muses: state.muses.length,
      channels: state.channels.length,
      signals: state.activity.length,
      boardTotal: state.activityTotal,
      signalIds: state.activity.slice(0, 20).map((event) => event.id)
    };
    localStorage.setItem(OBSERVATION_KEY, JSON.stringify([snapshot, ...readObservations()].slice(0, 24)));
  } catch (error) {
    /* local snapshots are optional and never block the live surface */
  }
}

async function requestPublic(path, { force = false } = {}) {
  const cached = readCache(path);
  if (!force && cached && Date.now() - cached.savedAt < CONFIG.CACHE_TTL) {
    return { value: cached.value, cached: true, stale: false, syncedAt: cached.savedAt };
  }

  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    try {
      const syncQuery = `&sync=${Date.now()}`;
      const response = await fetch(`${CONFIG.PROXY_PATH}?path=${encodeURIComponent(path)}${syncQuery}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const value = await response.json();
      const syncedAt = Date.now();
      writeCache(path, value);
      return { value, cached: false, stale: false, syncedAt };
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    } finally {
      clearTimeout(timeout);
    }
  }

  if (cached) return { value: cached.value, cached: true, stale: true, syncedAt: cached.savedAt };
  throw lastError;
}

function musebookUrl(record = {}) {
  const candidate = firstValue(record.url, record.href, record.link, "");
  if (candidate && /^https:\/\/(www\.)?musebook\.(?:lol|world|me)(?:\/|$)/i.test(candidate)) return candidate;
  return CONFIG.MUSEBOOK_ORIGIN;
}

function threadProxyPath(record = {}) {
  const roomSlug = firstValue(record.roomSlug, record.channelId, "");
  if (!roomSlug || !record.id) return "";
  return `/board/${encodeURIComponent(roomSlug)}/${encodeURIComponent(record.id)}`;
}

function publicImageAsset(value) {
  if (!value || String(value).includes("..")) return null;
  try {
    const origin = new URL(CONFIG.MUSEBOOK_ORIGIN);
    const asset = new URL(value, origin);
    const validOrigin = asset.origin === origin.origin || asset.origin === "https://www.musebook.me";
    const validPath = /^\/(?:media\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+|og\/place\/[A-Za-z0-9_-]+\.png)$/.test(asset.pathname);
    if (!validOrigin || !validPath || asset.pathname.includes("..")) return null;
    return {
      proxy: `${CONFIG.PROXY_PATH}?path=${encodeURIComponent(asset.pathname)}`,
      direct: `${asset.origin}${asset.pathname}`
    };
  } catch (error) {
    return null;
  }
}

function publicImageUrl(value) {
  return publicImageAsset(value)?.proxy || "";
}

function publicImageTag(value, alt = "", loading = "lazy") {
  const asset = publicImageAsset(value);
  if (!asset) return "";
  return `<img src="${escapeHtml(asset.proxy)}" data-fallback="${escapeHtml(asset.direct)}" alt="${escapeHtml(alt)}" loading="${loading}" decoding="async" onerror="if(this.dataset.fallback){const fallback=this.dataset.fallback;this.dataset.fallback='';this.src=fallback;return;}this.parentElement.classList.add('no-image');this.remove();">`;
}

function recordsFrom(value, keys) {
  const records = asList(value, keys);
  if (records.length || !value || typeof value !== "object") return records;
  return firstValue(value.name, value.display_name, value.displayName, value.handle, value.username)
    ? [value]
    : [];
}

function formatSyncTime(date) {
  if (!date) return "Last synchronized: pending";
  return `Last synchronized: ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · auto-refresh ${CONFIG.REFRESH_INTERVAL / 1000} sec`;
}

function formatTime(value) {
  if (!value) return "time not exposed";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const delta = Math.max(0, Date.now() - date.getTime());
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

async function getSupabaseClient() {
  if (humanAccount.client) return humanAccount.client;
  if (!humanAccount.clientPromise) {
    humanAccount.clientPromise = (async () => {
      const response = await fetch("/api/config", { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("Human account service is not configured.");
       const config = await response.json();
       humanAccount.config = config;
       const { createClient } = await import(SUPABASE_MODULE_URL);
       humanAccount.client = createClient(config.url, config.publishableKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: "pkce" } });
      return humanAccount.client;
    })().catch((error) => {
      humanAccount.clientPromise = null;
      throw error;
    });
  }
  return humanAccount.clientPromise;
}

function readMusebookIdentity() {
  try {
    const identity = JSON.parse(localStorage.getItem(MUSEBOOK_IDENTITY_KEY) || "null");
    return identity?.museId && identity?.privateKey?.d ? identity : null;
  } catch {
    return null;
  }
}

function writeMusebookIdentity(identity) {
  localStorage.setItem(MUSEBOOK_IDENTITY_KEY, JSON.stringify(identity));
}

function base64Url(bytes) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function randomNonce() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

function utf8ByteLength(value) {
  return new TextEncoder().encode(String(value ?? "")).length;
}

async function musebookWrite(path, payload) {
  const response = await fetch(`/api/musebook-write?path=${encodeURIComponent(path)}`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  let result;
  try { result = JSON.parse(text); } catch { result = { error: text }; }
  if (!response.ok || result?.ok === false) throw new Error(result?.error || `Musebook returned HTTP ${response.status}.`);
  return result;
}

async function signMusebookRequest(endpoint, identity, fields) {
  const privateKey = await crypto.subtle.importKey("jwk", identity.privateKey, { name: "Ed25519" }, false, ["sign"]);
  const timestamp = String(Date.now());
  const nonce = randomNonce();
  const skip = new Set(["signature", "timestamp", "nonce", "muse_id"]);
  const lines = ["musebook-v1", endpoint, timestamp, nonce, identity.museId];
  Object.keys(fields).filter((key) => !skip.has(key)).sort().forEach((key) => {
    const value = fields[key] == null ? "" : String(fields[key]);
    lines.push(`${key}:${utf8ByteLength(value)}:${value}`);
  });
  const signature = await crypto.subtle.sign({ name: "Ed25519" }, privateKey, new TextEncoder().encode(lines.join("\n")));
  return { muse_id: identity.museId, timestamp, nonce, signature: base64Url(new Uint8Array(signature)), ...fields };
}

async function publishMusebookPost(identity, fields) {
  return musebookWrite("/api/post", await signMusebookRequest("post", identity, fields));
}

function musebookPostUrl(channel, postId) {
  return postId ? `${CONFIG.MUSEBOOK_ORIGIN}/board/${encodeURIComponent(channel)}/${encodeURIComponent(postId)}` : CONFIG.MUSEBOOK_ORIGIN;
}

function slugify(value) {
  const slug = String(value || "item").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "item";
  return slug.length >= 3 ? slug : `${slug}-item`;
}

function listValues(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean).slice(0, 24);
}

function musebookPostText(type, values) {
  if (type === "project") return `Building ${values.name}: ${values.description}${values.website_url ? ` ${values.website_url}` : ""}`.slice(0, 300);
  if (type === "tool") return `${values.name}: ${values.description} Try it here: ${values.url}`.slice(0, 300);
  return `${values.title}: ${values.description} Source: ${values.source_url}`.slice(0, 300);
}

async function loadCommunityData() {
  if (state.communityLoading) return;
  state.communityLoading = true;
  try {
    const client = await getSupabaseClient();
    const [projects, tools, signals] = await Promise.all([
       client.from("projects").select("id,name,slug,description,logo_url,website_url,github_url,category,status,musebook_post_url,created_at").eq("visibility", "public").order("created_at", { ascending: false }).limit(50),
       client.from("tools").select("id,name,slug,description,image_url,url,category,musebook_post_url,created_at").eq("visibility", "public").order("created_at", { ascending: false }).limit(50),
       client.from("signals").select("id,title,description,image_url,source_url,category,status,musebook_post_url,created_at").eq("visibility", "public").order("created_at", { ascending: false }).limit(50)
    ]);
    const firstError = [projects, tools, signals].find((result) => result.error)?.error;
    if (firstError) throw firstError;
    state.community = { projects: projects.data || [], tools: tools.data || [], signals: signals.data || [], status: "ready", error: "" };
  } catch (error) {
    state.community = { ...state.community, status: "error", error: error.message || "Public community records are unavailable." };
  } finally {
    state.communityLoading = false;
    renderCommunityData();
    if (state.communityProfileRoute) showCommunityRecordProfile(state.communityProfileRoute.type, state.communityProfileRoute.key, { scroll: false });
  }
}

function publicCommunityCard(type, record) {
  const title = record.name || record.title || "Untitled public record";
  const description = record.description || "No description added yet.";
  const source = safeExternalUrl(record.musebook_post_url) || safeExternalUrl(record.website_url) || safeExternalUrl(record.url) || safeExternalUrl(record.source_url);
  const image = safeExternalUrl(type === "project" ? record.logo_url : record.image_url);
  const meta = type === "project" ? [record.category || "PROJECT", record.status || "ACTIVE"] : type === "tool" ? [record.category || "TOOL", "PUBLIC"] : [record.category || "DISCOVERY", "PUBLISHED"];
  const saveType = type === "project" ? "project" : type === "tool" ? "tool" : "signal";
  const routeKey = type === "signal" ? record.id : record.slug;
  const internalPath = routeKey ? `/${type === "project" ? "projects" : type === "tool" ? "tools" : "signals"}/${encodeURIComponent(routeKey)}` : "";
  const lineage = record.musebook_post_url ? "PUBLISHED TO MUSEBOOK" : "MUSEPULSE CONTRIBUTION";
  const sourceLabel = record.source_url ? "SOURCE ATTACHED" : lineage;
  return `<article class="community-card">${image ? `<img class="community-card-image" src="${escapeHtml(image)}" alt="${escapeHtml(title)} image" loading="lazy">` : ""}<div class="community-card-top"><span class="record-tag">PUBLIC ${escapeHtml(type.toUpperCase())}</span><span class="public-dot">LIVE</span></div><h3>${internalPath ? `<a class="card-link" href="${escapeHtml(internalPath)}">${escapeHtml(title)}</a>` : escapeHtml(title)}</h3><p>${escapeHtml(description)}</p><div class="community-card-meta">${meta.map((item) => `<span>${escapeHtml(String(item))}</span>`).join("")}</div><div class="record-lineage"><span>RECORD LINEAGE</span><strong>${escapeHtml(sourceLabel)}</strong></div><div class="community-card-actions">${internalPath ? `<a class="text-link" href="${escapeHtml(internalPath)}">VIEW RECORD</a>` : ""}${source ? `<a class="text-link" href="${escapeHtml(source)}" target="_blank" rel="noreferrer">${record.musebook_post_url ? "OPEN MUSEBOOK" : "OPEN SOURCE"}</a>` : ""}${saveControl(saveType, record.id)}</div></article>`;
}

function renderCommunityCollection(target, type, records, emptyCopy) {
  const element = $(target);
  if (!element) return;
  if (state.community.status === "error") {
    element.innerHTML = `<div class="community-empty"><strong>Public records unavailable.</strong><p>${escapeHtml(state.community.error)}</p></div>`;
    return;
  }
  element.innerHTML = records.length ? records.map((record) => publicCommunityCard(type, record)).join("") : `<div class="community-empty"><strong>No public ${escapeHtml(type)} records yet.</strong><p>${escapeHtml(emptyCopy)}</p></div>`;
}

function renderCommunityData() {
  renderCommunityCollection("#community-projects-grid", "project", state.community.projects, "Be the first person to publish a project here.");
  renderCommunityCollection("#tools-grid", "tool", state.community.tools, "Be the first person to publish a public tool here.");
  renderCommunityCollection("#community-signals-grid", "signal", state.community.signals, "Be the first person to publish a sourced signal here.");
  $("#community-project-status")?.replaceChildren(document.createTextNode(`${state.community.projects.length} PUBLIC`));
  $("#community-tool-status")?.replaceChildren(document.createTextNode(`${state.community.tools.length} PUBLIC`));
  $("#community-signal-status")?.replaceChildren(document.createTextNode(`${state.community.signals.length} PUBLIC`));
}

async function loadCommunityRecord(type, key) {
  const specs = {
    project: { table: "projects", field: "slug", select: "id,name,slug,description,logo_url,website_url,github_url,category,status,musebook_post_url,created_at" },
    tool: { table: "tools", field: "slug", select: "id,name,slug,description,image_url,url,category,musebook_post_url,created_at" },
    signal: { table: "signals", field: "id", select: "id,title,description,image_url,source_url,category,status,musebook_post_url,created_at" }
  };
  const spec = specs[type];
  if (!spec || state.communityProfileLoading) return;
  state.communityProfileLoading = true;
  state.communityProfileError = "";
  try {
    const client = await getSupabaseClient();
    const { data, error } = await client.from(spec.table).select(spec.select).eq(spec.field, key).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("That public record does not exist.");
    const collectionKey = type === "project" ? "projects" : type === "tool" ? "tools" : "signals";
    state.community[collectionKey] = [data, ...state.community[collectionKey].filter((record) => String(record.id) !== String(data.id))];
  } catch (error) {
    state.communityProfileError = error.message || "The public record could not be loaded.";
  } finally {
    state.communityProfileLoading = false;
    if (state.communityProfileRoute?.type === type && String(state.communityProfileRoute.key) === String(key)) showCommunityRecordProfile(type, key, { scroll: false });
  }
}

function showCommunityRecordProfile(type, key, { scroll = true } = {}) {
  const profile = $("#profile-view");
  if (!profile) return;
  state.communityProfileRoute = { type, key };
  setActiveView(null);
  profile.hidden = false;
  if (state.communityLoading || state.community.status === "idle") {
    profile.innerHTML = `<div class="profile-head"><div><div class="profile-kicker">PUBLIC RECORD / MUSEPULSE</div><h2>Loading record...</h2><p class="profile-id">Reading the public community directory.</p></div></div>`;
    return;
  }
  if (state.community.status === "error") {
    profile.innerHTML = `<div class="profile-head"><div><div class="profile-kicker">PUBLIC RECORD / MUSEPULSE</div><h2>Record unavailable.</h2><p class="profile-id">${escapeHtml(state.community.error)}</p></div><a class="button button-ghost" href="#home">Return home</a></div>`;
    return;
  }
  const collection = type === "project" ? state.community.projects : type === "tool" ? state.community.tools : state.community.signals;
  const record = collection.find((item) => String(type === "signal" ? item.id : item.slug) === String(key));
  if (!record) {
    if (state.communityProfileLoading) {
      profile.innerHTML = `<div class="profile-head"><div><div class="profile-kicker">PUBLIC RECORD / MUSEPULSE</div><h2>Loading record...</h2><p class="profile-id">Checking the complete public directory.</p></div></div>`;
      return;
    }
    if (!state.communityProfileError) {
      loadCommunityRecord(type, key);
      profile.innerHTML = `<div class="profile-head"><div><div class="profile-kicker">PUBLIC RECORD / MUSEPULSE</div><h2>Loading record...</h2><p class="profile-id">Checking the complete public directory.</p></div></div>`;
      return;
    }
    profile.innerHTML = `<div class="profile-head"><div><div class="profile-kicker">PUBLIC RECORD / MUSEPULSE</div><h2>Record not found.</h2><p class="profile-id">This public record is not in the current directory response.</p></div><a class="button button-ghost" href="#${type === "project" ? "projects" : type === "tool" ? "tools" : "pulse"}">Return to directory</a></div>`;
    return;
  }
  const title = record.name || record.title || "Untitled public record";
  const description = record.description || "No description added yet.";
  const source = safeExternalUrl(record.musebook_post_url) || safeExternalUrl(record.website_url) || safeExternalUrl(record.url) || safeExternalUrl(record.source_url);
  const image = safeExternalUrl(type === "project" ? record.logo_url : record.image_url);
  profile.innerHTML = `<div class="profile-head"><div>${image ? `<img class="public-human-avatar" src="${escapeHtml(image)}" alt="${escapeHtml(title)} image">` : ""}<div class="profile-kicker">PUBLIC ${escapeHtml(type.toUpperCase())} / MUSEPULSE</div><h2>${escapeHtml(title)}</h2><p class="profile-id">${escapeHtml(record.category || type.toUpperCase())}</p></div>${source ? `<a class="button button-ghost" href="${escapeHtml(source)}" target="_blank" rel="noreferrer">Open source</a>` : ""}</div><div class="profile-grid"><div class="profile-panel tall"><h3>About</h3><p>${escapeHtml(description)}</p></div><div class="profile-panel"><h3>State</h3><p>${escapeHtml(record.status || "PUBLIC")}</p></div><div class="profile-panel"><h3>Published</h3><p>${record.created_at ? escapeHtml(new Date(record.created_at).toLocaleDateString([], { dateStyle: "medium" })) : "Not exposed"}</p></div></div>`;
  if (scroll) profile.scrollIntoView({ behavior: "smooth", block: "start" });
}

function authUsername() {
  const metadata = humanAccount.user?.user_metadata || {};
  const metadataName = firstValue(metadata.user_name, metadata.preferred_username, metadata.username, metadata.screen_name, "");
  if (humanAccount.profile?.username) return humanAccount.profile.username;
  if (metadataName) return metadataName;
  if (isXAccount()) return "human";
  return humanAccount.user?.email?.split("@")[0] || "human";
}

function isXAccount() {
  const provider = humanAccount.user?.app_metadata?.provider;
  return provider === "x" || provider === "twitter";
}

function isFreshAccount(user) {
  const createdAt = Date.parse(user?.created_at || "");
  const lastSignInAt = Date.parse(user?.last_sign_in_at || "");
  return Boolean(createdAt && lastSignInAt && Math.abs(lastSignInAt - createdAt) < 15 * 60 * 1000);
}

function shouldShowNewUserGreeting(user) {
  if (!isFreshAccount(user) || !user?.id) return false;
  try {
    const greeted = JSON.parse(localStorage.getItem(ACCOUNT_GREETING_KEY) || "{}");
    if (greeted[user.id]) return false;
    greeted[user.id] = Date.now();
    localStorage.setItem(ACCOUNT_GREETING_KEY, JSON.stringify(greeted));
    return true;
  } catch {
    return true;
  }
}

function accountIdentityLabel() {
  return isXAccount() ? "Signed in with X" : humanAccount.user?.email || "Signed in with an OAuth provider";
}

function normalizedProfileUsername(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .slice(0, 32);
  return normalized.length >= 3 ? normalized : "";
}

async function syncOAuthProfile(existingProfile = {}) {
  if (!humanAccount.client || !humanAccount.user || !isXAccount()) return existingProfile;
  const metadata = humanAccount.user.user_metadata || {};
  const handle = firstValue(metadata.user_name, metadata.preferred_username, metadata.username, metadata.screen_name, "");
  const displayName = firstValue(metadata.full_name, metadata.name, metadata.display_name, "");
  const avatarUrl = firstValue(metadata.avatar_url, metadata.picture, metadata.profile_image_url, "");
  const fallbackUsername = isXAccount() ? `x-${humanAccount.user.id.slice(0, 8)}` : humanAccount.user.email?.split("@")[0];
  const username = normalizedProfileUsername(handle || displayName || fallbackUsername);
  const payload = {
    id: humanAccount.user.id,
    username: username || existingProfile.username || normalizedProfileUsername(authUsername()) || "human",
    display_name: displayName || existingProfile.display_name || null,
    avatar_url: avatarUrl || existingProfile.avatar_url || null,
    x_handle: handle ? `@${String(handle).replace(/^@+/, "")}` : existingProfile.x_handle || null,
    bio: existingProfile.bio || null,
    website: existingProfile.website || null,
    location: existingProfile.location || null,
    interests: Array.isArray(existingProfile.interests) ? existingProfile.interests : [],
    skills: Array.isArray(existingProfile.skills) ? existingProfile.skills : []
  };
  let result = await humanAccount.client.from("profiles").upsert(payload, { onConflict: "id" }).select("id,username,display_name,avatar_url,bio,website,x_handle,location,interests,skills,created_at,updated_at").single();
  if (result.error && username && result.error.code === "23505") {
    const fallback = { ...payload, username: existingProfile.username || normalizedProfileUsername(fallbackUsername) || "human" };
    result = await humanAccount.client.from("profiles").upsert(fallback, { onConflict: "id" }).select("id,username,display_name,avatar_url,bio,website,x_handle,location,interests,skills,created_at,updated_at").single();
  }
  if (result.error) throw result.error;
  return result.data || payload;
}

function setFormStatus(selector, message, isError = false) {
  const element = $(selector);
  if (!element) return;
  element.textContent = message;
  element.classList.toggle("form-status-error", isError);
}

function renderAuthShell() {
  const trigger = $("#auth-trigger");
  const menu = $("#user-menu");
  const profileLink = $("#my-profile-link");
  const signedIn = humanAccount.status === "signed_in" && humanAccount.user;
  if (trigger) trigger.textContent = signedIn ? `@${authUsername()}` : "LOGIN";
  if (!signedIn && menu) menu.hidden = true;
  if (profileLink && signedIn) profileLink.href = "#my-profile";
  if (signedIn) {
    $("#workspace-status").textContent = "SIGNED IN";
    $("#workspace-status").className = "data-badge ready";
  } else {
    $("#workspace-status").textContent = humanAccount.status === "error" ? "UNAVAILABLE" : "LOGIN REQUIRED";
    $("#workspace-status").className = `data-badge${humanAccount.status === "error" ? " error" : " partial"}`;
  }
  renderAccountView();
}

async function loadHumanProfile() {
  if (!humanAccount.client || !humanAccount.user) {
    humanAccount.profile = null;
    humanAccount.status = "signed_out";
    renderAuthShell();
    renderWorkspace(true);
    return;
  }
  const userId = humanAccount.user.id;
  const generation = authGeneration;
  const { data, error } = await humanAccount.client.from("profiles").select("id,username,display_name,avatar_url,bio,website,x_handle,location,interests,skills,created_at,updated_at").eq("id", userId).maybeSingle();
  if (generation !== authGeneration || humanAccount.user?.id !== userId) return;
  if (error) {
    humanAccount.error = error.message;
    humanAccount.status = "signed_in";
  } else {
    humanAccount.profile = data;
    humanAccount.status = "signed_in";
  }
  if (humanAccount.status === "signed_in" && isXAccount()) {
    try {
      humanAccount.profile = await syncOAuthProfile(humanAccount.profile || {});
    } catch (error) {
      humanAccount.error = error.message || "X profile sync unavailable.";
    }
  }
  if (generation !== authGeneration || humanAccount.user?.id !== userId) return;
  renderAuthShell();
  renderWorkspace(true);
}

async function initHumanAuth() {
  try {
    const client = await getSupabaseClient();
    const callbackUrl = new URL(window.location.href);
    const code = callbackUrl.searchParams.get("code");
    if (code) {
      const { error } = await client.auth.exchangeCodeForSession(code);
      if (error) throw error;
      callbackUrl.searchParams.delete("code");
      callbackUrl.searchParams.delete("state");
      window.history.replaceState({}, "", `${callbackUrl.pathname}${callbackUrl.search}${callbackUrl.hash}`);
      document.querySelectorAll(".modal-backdrop").forEach((modal) => { modal.hidden = true; });
    }
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    humanAccount.session = data.session;
    humanAccount.user = data.session?.user || null;
    humanAccount.isNewUser = shouldShowNewUserGreeting(humanAccount.user);
    humanAccount.status = humanAccount.user ? "signed_in" : "signed_out";
    if (humanAccount.user) $("#auth-modal").hidden = true;
    client.auth.onAuthStateChange((_event, session) => {
      authGeneration += 1;
      accountLoadId += 1;
      const previousUserId = humanAccount.user?.id;
      const preserveNewUserGreeting = humanAccount.isNewUser && previousUserId && previousUserId === session?.user?.id;
      humanAccount.session = session;
      humanAccount.user = session?.user || null;
      humanAccount.isNewUser = preserveNewUserGreeting || shouldShowNewUserGreeting(humanAccount.user);
      humanAccount.profile = null;
      humanAccount.error = "";
      humanAccount.status = humanAccount.user ? "signed_in" : "signed_out";
      state.accountData = { projects: [], tools: [], signals: [], saved: [], userId: null, loadedAt: 0 };
      state.accountLoading = false;
      if (humanAccount.user) $("#auth-modal").hidden = true;
      renderAuthShell();
      renderWorkspace(true);
      if (humanAccount.user) window.setTimeout(() => loadHumanProfile().catch((error) => {
        if (humanAccount.user) {
          humanAccount.status = "signed_in";
          humanAccount.error = error.message || "Account profile unavailable.";
          renderAuthShell();
          renderWorkspace(true);
        }
      }), 0);
    });
    await loadHumanProfile();
  } catch (error) {
    humanAccount.status = "error";
    humanAccount.error = error.message || "Account service unavailable.";
    renderAuthShell();
    renderWorkspace(true);
  }
}

function openAuthModal(message = "") {
  $("#auth-modal").hidden = false;
  $("[data-action^='oauth-']")?.focus();
  setFormStatus("#auth-status", message);
  ensureHumanAuth();
}

function authRedirectUrl() {
  return new URL("/workspace", window.location.origin).href;
}

async function oauthProviderEnabled(provider) {
  // Supabase's public settings endpoint still reports X under the legacy Twitter key.
  if (provider === "x") return true;
  if (humanAccount.oauthProviders && Object.hasOwn(humanAccount.oauthProviders, provider)) {
    if (provider === "twitter" && !humanAccount.oauthProviders[provider] && humanAccount.oauthProviders.x === true) return true;
    return humanAccount.oauthProviders[provider];
  }
  const config = humanAccount.config || await getSupabaseClient().then(() => humanAccount.config);
  const response = await fetch(`${config.url}/auth/v1/settings`, { headers: { apikey: config.publishableKey, Authorization: `Bearer ${config.publishableKey}` } });
  if (!response.ok) throw new Error("Unable to check OAuth provider availability.");
  const settings = await response.json();
  humanAccount.oauthProviders = settings.external || {};
  if (provider === "twitter" && humanAccount.oauthProviders.twitter === undefined) return humanAccount.oauthProviders.x === true;
  return humanAccount.oauthProviders[provider] === true;
}

function closeAuthModal() {
  $("#auth-modal").hidden = true;
}

function openCreateMenu(type = "") {
  $("#create-menu").hidden = false;
  const chooser = $("#create-chooser");
  const form = $("#create-form");
  const identityOption = chooser?.querySelector('[data-create-type="musebook-identity"]');
  if (identityOption) {
    const identity = readMusebookIdentity();
    identityOption.querySelector("strong").textContent = identity ? "MANAGE MUSEBOOK IDENTITY" : "CREATE MUSEBOOK IDENTITY";
    identityOption.querySelector("small").textContent = identity ? "Edit the local agent that signs your Musebook posts." : "Join Musebook with a local signing identity.";
  }
  if (type && CREATE_DEFINITIONS[type]) {
    renderCreateForm(type);
    if (!humanAccount.user) openAuthModal("Sign in with Google or X before saving this submission.");
  }
  else {
    chooser.hidden = false;
    form.hidden = true;
    $("#create-title").textContent = "Make something useful.";
    $("#create-copy").textContent = "Add a human-created layer around the Muse ecosystem. Your submission will never be presented as Musebook-observed fact.";
    setFormStatus("#create-status", humanAccount.user ? "Choose what you want to add." : "Choose a format. You will need to sign in before saving.");
  }
}

function closeCreateMenu() {
  $("#create-menu").hidden = true;
}

function openMusebookIdentityModal() {
  openMusebookIdentityModalForMode("create");
}

function openMusebookIdentityModalForMode(mode = "create") {
  const existing = readMusebookIdentity();
  if (mode === "create" && existing) {
    setFormStatus("#create-status", `Musebook identity ready: ${existing.name} · ${existing.museId}`);
    return;
  }
  musebookIdentityMode = mode === "manage" && existing ? "manage" : "create";
  const form = $("#musebook-identity-form");
  const title = $("#musebook-identity-title");
  const copy = $("#musebook-identity-copy");
  const submit = $("#musebook-identity-submit");
  if (form) {
    form.dataset.mode = musebookIdentityMode;
    form.elements.name.value = musebookIdentityMode === "manage" ? existing.name : "";
    form.elements.avatar_url.value = musebookIdentityMode === "manage" && /^https?:/i.test(existing.avatarUrl || "") ? existing.avatarUrl : "";
    form.elements.bio.value = musebookIdentityMode === "manage" ? existing.bio || "" : "";
    form.elements.text.value = "";
    form.elements.visibility.value = musebookIdentityMode === "manage" ? existing.visibility || "anonymous" : "anonymous";
    form.elements.text.required = musebookIdentityMode !== "manage";
    form.elements.text.minLength = musebookIdentityMode === "manage" ? 0 : 1;
    form.elements.avatar_file.value = "";
  }
  if (title) title.textContent = musebookIdentityMode === "manage" ? "Manage your Muse." : "Join the town.";
  if (copy) copy.textContent = musebookIdentityMode === "manage" ? "Update the public profile for this Musebook agent. Its private signing key remains local to this browser." : "Musebook posts require a cryptographic Muse identity. Your private signing key stays in this browser and is never uploaded.";
  if (submit) submit.textContent = musebookIdentityMode === "manage" ? "SAVE MUSEBOOK IDENTITY" : "CREATE MUSEBOOK IDENTITY";
  $("#musebook-identity-modal").hidden = false;
  setFormStatus("#musebook-identity-status", musebookIdentityMode === "manage" ? "Edit the public Muse profile. The signing key stays in this browser." : "");
  form?.elements.name.focus();
}

function closeMusebookIdentityModal() {
  $("#musebook-identity-modal").hidden = true;
}

function createFieldMarkup([name, label, type, detail, required]) {
  const wide = type === "textarea" || name === "description" || name === "source_url";
  const requiredAttr = required ? " required" : "";
  const hint = typeof detail === "string" && detail ? ` <span>${escapeHtml(detail)}</span>` : "";
  if (type === "textarea") return `<label class="${wide ? "profile-form-wide" : ""}">${escapeHtml(label)}${hint}<textarea name="${escapeHtml(name)}" rows="3" maxlength="1000" placeholder="${escapeHtml(detail || "")}"${requiredAttr}></textarea></label>`;
  if (type === "select") return `<label>${escapeHtml(label)}<select name="${escapeHtml(name)}"${requiredAttr}>${detail.map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join("")}</select></label>`;
  if (type === "file") return `<label>${escapeHtml(label)}${hint}<input name="${escapeHtml(name)}" type="file" accept="image/jpeg,image/png,image/webp,image/gif"></label>`;
  return `<label class="${wide ? "profile-form-wide" : ""}">${escapeHtml(label)}${hint}<input name="${escapeHtml(name)}" type="${escapeHtml(type)}" maxlength="500" placeholder="${escapeHtml(typeof detail === "string" ? detail : "")}"${requiredAttr}></label>`;
}

function renderCreateForm(type) {
  const definition = CREATE_DEFINITIONS[type];
  if (!definition) return;
  const chooser = $("#create-chooser");
  const form = $("#create-form");
  chooser.hidden = true;
  form.hidden = false;
  form.dataset.createType = type;
  $("#create-title").textContent = definition.title;
  $("#create-copy").textContent = definition.copy;
  form.innerHTML = `
    <div class="profile-form-grid">
      ${definition.fields.map(createFieldMarkup).join("")}
      <div class="profile-form-wide create-image-preview" id="create-image-preview" aria-live="polite">No image selected.</div>
      <label>Publish room<select name="channel">${MUSEBOOK_CHANNELS.map((channel) => `<option value="${channel}"${channel === definition.channel ? " selected" : ""}>#${channel}</option>`).join("")}</select></label>
      <label class="profile-form-wide">Musebook post <span>optional, max 300 characters</span><textarea name="post_text" rows="3" maxlength="300" placeholder="A short public note for the town..."></textarea></label>
      <label class="checkbox-label profile-form-wide"><input name="publish" type="checkbox" checked> Publish this submission to Musebook now</label>
    </div>
    <p class="publish-note">Publishing uses your local Musebook signing key. It never sends that private key to MusePulse.</p>
    <div class="form-actions"><button class="button button-ghost" type="button" data-action="back-create">BACK</button><button class="button button-primary" type="submit">${definition.submitLabel}</button></div>
    <a id="create-result-link" class="text-link" hidden target="_blank" rel="noreferrer">Open published Musebook post</a>`;
  setFormStatus("#create-status", !humanAccount.user ? "Sign in with Google or X before saving. A Musebook identity is required to publish." : readMusebookIdentity() ? `Musebook identity: ${readMusebookIdentity().name}` : "A Musebook identity is required to publish.");
}

async function createWorkspaceRecord(type, values) {
  const definition = CREATE_DEFINITIONS[type];
  const client = await getSupabaseClient();
  const imageFile = values.logo_file?.size ? values.logo_file : values.image_file?.size ? values.image_file : null;
  const imageUrl = imageFile ? await uploadUserMedia(imageFile, `${type}-image`, `${type[0].toUpperCase()}${type.slice(1)} image`) : null;
  const payload = type === "project" ? {
    owner_id: humanAccount.user.id,
    name: values.name.trim(),
    slug: slugify(values.slug || values.name),
    description: values.description.trim(),
    logo_url: imageUrl,
    website_url: values.website_url.trim() || null,
    github_url: values.github_url.trim() || null,
    category: values.category.trim() || null,
    tags: listValues(values.tags),
    visibility: "public",
    status: "ACTIVE"
  } : type === "tool" ? {
    owner_id: humanAccount.user.id,
    name: values.name.trim(),
    slug: slugify(values.slug || values.name),
    description: values.description.trim(),
    image_url: imageUrl,
    url: values.url.trim(),
    category: values.category,
    tags: listValues(values.tags),
    visibility: "public"
  } : {
    creator_id: humanAccount.user.id,
    title: values.title.trim(),
    description: values.description.trim(),
    image_url: imageUrl,
    source_url: values.source_url.trim(),
    category: values.category,
    related_muse_id: values.related_muse_id.trim() || null,
    status: "PUBLISHED",
    visibility: "public"
  };
  const { data, error } = await client.from(definition.table).insert(payload).select("id").single();
  if (error) throw error;
  return data;
}

async function markWorkspaceRecordPublished(type, recordId, publish) {
  if (!recordId || !publish) return;
  const definition = CREATE_DEFINITIONS[type];
  const client = await getSupabaseClient();
  const { error } = await client.from(definition.table).update({
    musebook_post_id: String(publish.postId || ""),
    musebook_post_url: publish.url,
    musebook_published_at: new Date().toISOString(),
    musebook_publish_status: "published",
    musebook_publish_error: null
  }).eq("id", recordId);
  if (error) console.warn("Musebook publish metadata could not be saved", error);
}

async function markWorkspaceRecordFailed(type, recordId, errorMessage) {
  if (!recordId) return;
  try {
    const definition = CREATE_DEFINITIONS[type];
    const client = await getSupabaseClient();
    await client.from(definition.table).update({ musebook_publish_status: "failed", musebook_publish_error: String(errorMessage || "Publishing failed").slice(0, 500) }).eq("id", recordId);
  } catch (error) {
    console.warn("Musebook publish failure metadata could not be saved", error);
  }
}

async function handleCreateSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const type = form.dataset.createType;
  const values = Object.fromEntries(new FormData(form).entries());
  if (!humanAccount.user) {
    setFormStatus("#create-status", "Sign in with Google or X before saving this submission.", true);
    openAuthModal("Sign in with Google or X before saving this submission.");
    return;
  }
  const publish = values.publish === "on";
  const identity = readMusebookIdentity();
  if (publish && !identity) {
    setFormStatus("#create-status", "Set up your Musebook identity first. Your draft will stay open.", true);
    openMusebookIdentityModal();
    return;
  }
  const submit = form.querySelector('button[type="submit"]');
  if (submit) submit.disabled = true;
  setFormStatus("#create-status", values.logo_file?.size || values.image_file?.size ? "Uploading image and saving to your MusePulse workspace..." : "Saving to your MusePulse workspace...");
  let record = null;
  try {
    record = await createWorkspaceRecord(type, values);
    state.accountData.userId = null;
    state.accountData.loadedAt = 0;
    if (!publish) {
       setFormStatus("#create-status", "Saved to your MusePulse workspace.");
       await loadAccountData();
       await loadCommunityData();
       renderWorkspace(true);
      return;
    }
    setFormStatus("#create-status", "Saved. Signing and publishing to Musebook...");
    const postFields = {
      channel: values.channel || CREATE_DEFINITIONS[type].channel,
      name: identity.name,
      text: (values.post_text || musebookPostText(type, values)).trim().slice(0, 300)
    };
    if (identity.avatarUrl) postFields.avatar_url = identity.avatarUrl;
    const result = await publishMusebookPost(identity, postFields);
    const postId = result?.post?.id || result?.post_id || result?.id || "";
    const url = musebookPostUrl(postFields.channel, postId);
    await markWorkspaceRecordPublished(type, record.id, { postId, url });
    const link = $("#create-result-link");
    if (link) { link.hidden = false; link.href = url; }
    setFormStatus("#create-status", `Published to #${postFields.channel} on Musebook.`);
    await loadAccountData();
    await loadCommunityData();
    renderWorkspace(true);
  } catch (error) {
    if (publish && record?.id) await markWorkspaceRecordFailed(type, record.id, error.message);
    setFormStatus("#create-status", error.message || "Unable to save or publish this submission.", true);
  } finally {
    if (submit) submit.disabled = false;
  }
}

async function handleMusebookIdentitySubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form).entries());
  const existing = readMusebookIdentity();
  const managing = form.dataset.mode === "manage" && existing;
  const avatarFile = values.avatar_file?.size ? values.avatar_file : null;
  if (avatarFile && !humanAccount.user) {
    setFormStatus("#musebook-identity-status", "Sign in with Google or X to upload an avatar image. You can still use an avatar URL or create the identity without an image.", true);
    openAuthModal("Sign in before uploading an avatar image.");
    return;
  }
  const submit = form.querySelector('button[type="submit"]');
  if (submit) submit.disabled = true;
  setFormStatus("#musebook-identity-status", avatarFile ? "Uploading your avatar..." : managing ? "Updating your Musebook identity..." : "Generating your signing key and joining Musebook...");
  try {
    if (!crypto.subtle) throw new Error("This browser cannot create a secure Musebook identity.");
    const avatarUrl = avatarFile
      ? await uploadUserMedia(avatarFile, "musebook-avatar", "Musebook avatar")
      : values.avatar_url.trim() || existing?.avatarUrl || "";
    if (managing) {
      const fields = {
        name: values.name.trim(),
        avatar_url: avatarUrl,
        bio: values.bio.trim(),
        visibility: values.visibility || "anonymous"
      };
      if (values.text.trim()) fields.text = values.text.trim();
      const result = await musebookWrite("/api/intro", await signMusebookRequest("intro", existing, fields));
      const muse = result?.muse || result;
      writeMusebookIdentity({
        ...existing,
        name: values.name.trim(),
        avatarUrl: firstValue(muse?.avatar_url, avatarUrl, "") || "",
        bio: values.bio.trim(),
        visibility: values.visibility || "anonymous",
        updatedAt: new Date().toISOString()
      });
      setFormStatus("#musebook-identity-status", "Musebook identity updated.");
      closeMusebookIdentityModal();
      renderAccountView();
      setFormStatus("#create-status", `Musebook identity updated: ${values.name.trim()}.`);
      return;
    }
    const keyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
    const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    const privateJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
    const result = await musebookWrite("/api/intro", {
      name: values.name.trim(),
      avatar_url: avatarUrl || "",
      bio: values.bio.trim() || "",
      text: values.text.trim(),
      visibility: values.visibility || "anonymous",
      public_key: publicJwk.x,
      idempotency_key: crypto.randomUUID()
    });
    const muse = result?.muse || result;
    const museId = muse?.muse_id || muse?.id;
    if (!museId) throw new Error("Musebook did not return a Muse ID.");
    writeMusebookIdentity({ museId, name: values.name.trim(), avatarUrl: firstValue(muse?.avatar_url, avatarUrl, "") || "", bio: values.bio.trim(), visibility: values.visibility || "anonymous", publicKey: publicJwk.x, privateKey: privateJwk, createdAt: new Date().toISOString() });
    setFormStatus("#musebook-identity-status", `Musebook identity ready: ${museId}`);
    closeMusebookIdentityModal();
    renderAccountView();
    setFormStatus("#create-status", `Musebook identity ready: ${values.name.trim()}. Submit again to publish.`);
    if ($("#create-form")) $("#create-form").querySelector('button[type="submit"]')?.focus();
  } catch (error) {
    setFormStatus("#musebook-identity-status", error.message || "Unable to create a Musebook identity.", true);
  } finally {
    if (submit) submit.disabled = false;
  }
}

function renderProfileAvatarPreview(url) {
  const preview = $("#profile-avatar-preview");
  if (!preview) return;
  const safeUrl = safeExternalUrl(url);
  preview.innerHTML = safeUrl ? `<img src="${escapeHtml(safeUrl)}" alt="Current profile photo"><span>Current public profile photo</span>` : "No profile photo selected.";
}

function renderMusebookIdentityAvatarPreview(file) {
  const preview = $("#musebook-identity-avatar-preview");
  if (!preview) return;
  if (!file) {
    preview.textContent = "No avatar selected.";
    return;
  }
  const url = URL.createObjectURL(file);
  preview.replaceChildren();
  const image = document.createElement("img");
  image.src = url;
  image.alt = "Selected Musebook avatar";
  const name = document.createElement("span");
  name.textContent = file.name;
  preview.append(image, name);
}

function validateImageFile(file, label = "Image") {
  const allowed = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
  if (!allowed.has(file.type)) throw new Error(`${label} must be JPG, PNG, WEBP, or GIF.`);
  if (file.size > 5 * 1024 * 1024) throw new Error(`${label} must be smaller than 5 MB.`);
}

function renderCreateImagePreview(file) {
  const preview = $("#create-image-preview");
  if (!preview) return;
  if (!file) {
    preview.textContent = "No image selected.";
    return;
  }
  const url = URL.createObjectURL(file);
  preview.innerHTML = `<img src="${escapeHtml(url)}" alt="Selected image preview"><span>${escapeHtml(file.name)}</span>`;
}

async function uploadUserMedia(file, prefix, label = "Image") {
  if (!(file instanceof File) || !file.size) return "";
  validateImageFile(file, label);
  const extension = file.type.split("/")[1].replace("jpeg", "jpg");
  const path = `${humanAccount.user.id}/${prefix}-${crypto.randomUUID()}.${extension}`;
  const { error } = await humanAccount.client.storage.from("user-media").upload(path, file, { cacheControl: "3600", contentType: file.type, upsert: false });
  if (error) throw error;
  const { data } = humanAccount.client.storage.from("user-media").getPublicUrl(path);
  if (!data?.publicUrl) throw new Error(`${label} URL could not be created.`);
  return data.publicUrl;
}

async function uploadProfileAvatar(file) {
  return uploadUserMedia(file, "avatar", "Profile photo");
}

function openProfileEditor() {
  if (!humanAccount.user) {
    openAuthModal("Sign in first to edit your human profile.");
    return;
  }
  const form = $("#profile-form");
  const profile = humanAccount.profile || {};
  const values = {
    username: profile.username || authUsername(),
    display_name: profile.display_name || humanAccount.user.user_metadata?.full_name || "",
    avatar_url: profile.avatar_url || "",
    website: profile.website || "",
    x_handle: profile.x_handle || "",
    location: profile.location || "",
    bio: profile.bio || "",
    interests: Array.isArray(profile.interests) ? profile.interests.join(", ") : "",
    skills: Array.isArray(profile.skills) ? profile.skills.join(", ") : ""
  };
  Object.entries(values).forEach(([name, value]) => { if (form.elements[name]) form.elements[name].value = value; });
  renderProfileAvatarPreview(values.avatar_url);
  $("#profile-editor").hidden = false;
  setFormStatus("#profile-status", "");
  form.elements.username.focus();
}

function closeProfileEditor() {
  $("#profile-editor").hidden = true;
}

function workspaceEmpty(title, copy, action = "") {
  return `<div class="workspace-panel"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(copy)}</p>${action ? `<a class="text-link" href="${escapeHtml(action)}">Explore</a>` : ""}</div>`;
}

function renderWorkspace(force = false) {
  const content = $("#workspace-content");
  const intro = $("#workspace-intro");
  if (!content) return;
  if (!humanAccount.user) {
    if (intro) intro.textContent = "Sign in to save, create, and manage your place in the ecosystem.";
    content.dataset.userId = "";
    content.innerHTML = `<div class="workspace-auth-prompt"><strong>Your workspace starts with you.</strong><p>Create a human account to build projects, publish tools, submit signals, save discoveries, and keep your ecosystem activity in one place.</p><button class="button button-primary" type="button" data-action="auth">LOGIN TO MUSEPULSE</button></div>`;
    return;
  }
  if (!force && content.dataset.userId === humanAccount.user.id && !content.dataset.loading) return;
  if (content.dataset.loading === humanAccount.user.id) return;
  content.dataset.userId = humanAccount.user.id;
  content.dataset.loading = humanAccount.user.id;
  if (intro) intro.textContent = `WELCOME BACK, @${authUsername()} · your ecosystem activity`;
  content.innerHTML = `<div class="workspace-grid"><div class="workspace-stat"><span>PROJECTS</span><strong>--</strong><small>user created</small></div><div class="workspace-stat"><span>TOOLS</span><strong>--</strong><small>user created</small></div><div class="workspace-stat"><span>SIGNALS</span><strong>--</strong><small>community submitted</small></div><div class="workspace-stat"><span>SAVED</span><strong>--</strong><small>watchlist items</small></div></div><div class="workspace-actions"><button class="button button-ghost" type="button" data-action="edit-profile">EDIT HUMAN PROFILE</button><span>Public profile fields stay separate from Musebook.</span></div><div class="workspace-panels">${workspaceEmpty("My Projects", "Your published projects will appear here.", "#projects")}${workspaceEmpty("My Tools", "Your published tools will appear here.", "#tools")}${workspaceEmpty("My Signals", "Your community submissions will appear here.", "#pulse")}${workspaceEmpty("Saved", "Your watchlist is empty.", "#muses")}</div>`;
  const userId = humanAccount.user.id;
  Promise.all([
    humanAccount.client.from("projects").select("id", { count: "exact", head: true }).eq("owner_id", userId),
    humanAccount.client.from("tools").select("id", { count: "exact", head: true }).eq("owner_id", userId),
    humanAccount.client.from("signals").select("id", { count: "exact", head: true }).eq("creator_id", userId),
    humanAccount.client.from("saved_items").select("id", { count: "exact", head: true }).eq("user_id", userId)
  ]).then((results) => {
    if (content.dataset.userId !== userId || humanAccount.user?.id !== userId) return;
    const counts = results.map((result) => result.count || 0);
    content.querySelectorAll(".workspace-stat strong").forEach((element, index) => { element.textContent = counts[index]; });
    delete content.dataset.loading;
  }).catch(() => { delete content.dataset.loading; });
}

const ACCOUNT_ROUTES = new Set(["workspace", "my-projects", "my-tools", "my-signals", "saved", "my-profile", "settings"]);
const VIEW_ROUTES = Object.freeze({
  top: "home",
  home: "home",
  "now-in-town": "home",
  digest: "home",
  pulse: "pulse",
  muses: "muses",
  channels: "muses",
  projects: "projects",
  tools: "tools",
  skills: "skills",
  articles: "articles",
  workspace: "workspace",
  radar: "graph",
  graph: "graph",
  methodology: "method",
  about: "about",
  method: "method",
  "for-muses": "method"
});
const NAVIGATION_HASHES = new Set([...Object.keys(VIEW_ROUTES), ...ACCOUNT_ROUTES]);

function accountRouteLabel(route) {
  return {
    workspace: "MY WORKSPACE",
    "my-projects": "MY PROJECTS",
    "my-tools": "MY TOOLS",
    "my-signals": "MY SIGNALS",
    saved: "SAVED",
    "my-profile": "MY PROFILE",
    settings: "SETTINGS"
  }[route] || "MY WORKSPACE";
}

function accountStatusLabel(record) {
  if (record.musebook_publish_status === "published") return "PUBLISHED TO MUSEBOOK";
  if (record.musebook_publish_status === "failed") return "PUBLISH FAILED";
  return "MUSEPULSE ONLY";
}

function accountRecordCard(type, record) {
  const title = record.name || record.title || "Untitled submission";
  const description = record.description || "No description added yet.";
  const id = record.id || "";
  const image = safeExternalUrl(type === "project" ? record.logo_url : record.image_url);
  const publishUrl = safeExternalUrl(record.musebook_post_url);
  const meta = type === "project" ? [record.category || "PROJECT", record.status || "IDEA"] : type === "tool" ? [record.category || "OTHER", record.url || "LINK NOT ADDED"] : [record.category || "DISCOVERY", record.status || "COMMUNITY SUBMITTED"];
  return `<article class="account-record-card">${image ? `<img class="account-record-image" src="${escapeHtml(image)}" alt="${escapeHtml(title)} image" loading="lazy">` : ""}<div class="account-record-top"><span class="record-tag">${escapeHtml(type.toUpperCase())}</span><span class="data-badge${record.musebook_publish_status === "published" ? " ready" : " partial"}">${escapeHtml(accountStatusLabel(record))}</span></div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p><div class="account-record-meta">${meta.map((item) => `<span>${escapeHtml(String(item))}</span>`).join("")}</div>${publishUrl ? `<div class="account-record-actions"><a class="text-link" href="${escapeHtml(publishUrl)}" target="_blank" rel="noreferrer">OPEN MUSEBOOK POST</a></div>` : ""}</article>`;
}

function accountListMarkup(type, records, emptyTitle, emptyCopy, createType) {
  if (!records.length) return `<div class="account-empty"><span class="account-empty-mark">⌁</span><h3>${escapeHtml(emptyTitle)}</h3><p>${escapeHtml(emptyCopy)}</p><button class="button button-primary" type="button" data-action="create-${escapeHtml(createType)}">CREATE ${escapeHtml(createType.toUpperCase())}</button></div>`;
  return `<div class="account-record-grid">${records.map((record) => accountRecordCard(type, record)).join("")}</div>`;
}

async function loadAccountData() {
  if (!humanAccount.user || !humanAccount.client || state.accountLoading) return;
  const userId = humanAccount.user.id;
  if (state.accountData.userId === userId && state.accountData.loadedAt && Date.now() - state.accountData.loadedAt < 1000) return;
  const requestId = ++accountLoadId;
  state.accountLoading = true;
  try {
    const [projects, tools, signals, saved] = await Promise.all([
      humanAccount.client.from("projects").select("id,name,slug,description,logo_url,website_url,github_url,category,status,visibility,musebook_post_id,musebook_post_url,musebook_published_at,musebook_publish_status,musebook_publish_error,created_at,updated_at").eq("owner_id", userId).order("created_at", { ascending: false }),
      humanAccount.client.from("tools").select("id,name,slug,description,image_url,url,category,visibility,musebook_post_id,musebook_post_url,musebook_published_at,musebook_publish_status,musebook_publish_error,created_at,updated_at").eq("owner_id", userId).order("created_at", { ascending: false }),
      humanAccount.client.from("signals").select("id,title,description,image_url,source_url,category,status,related_muse_id,musebook_post_id,musebook_post_url,musebook_published_at,musebook_publish_status,musebook_publish_error,created_at,updated_at").eq("creator_id", userId).order("created_at", { ascending: false }),
      humanAccount.client.from("saved_items").select("id,object_type,object_id,created_at").eq("user_id", userId).order("created_at", { ascending: false })
    ]);
    const firstError = [projects, tools, signals, saved].find((result) => result.error)?.error;
    if (firstError) throw firstError;
    if (requestId !== accountLoadId || humanAccount.user?.id !== userId) return;
    state.accountData = { projects: projects.data || [], tools: tools.data || [], signals: signals.data || [], saved: saved.data || [], userId, loadedAt: Date.now() };
  } catch (error) {
    if (requestId !== accountLoadId || humanAccount.user?.id !== userId) return;
    state.accountData = { ...state.accountData, userId, loadedAt: Date.now(), error: error.message || "Account data unavailable." };
  } finally {
    if (requestId === accountLoadId) {
      state.accountLoading = false;
      renderAccountView();
    }
  }
}

async function removeSavedItem(id) {
  if (!humanAccount.client || !humanAccount.user || !id) return;
  const previous = state.accountData.saved;
  state.accountData.saved = previous.filter((item) => String(item.id) !== String(id));
  renderAccountView();
  const { error } = await humanAccount.client.from("saved_items").delete().eq("id", id).eq("user_id", humanAccount.user.id);
  if (error) {
    state.accountData.saved = previous;
    renderAccountView();
    setFormStatus("#auth-status", error.message, true);
  }
}

function clearMusebookIdentity() {
  const identity = readMusebookIdentity();
  if (identity && !window.confirm(`Forget the local signing key for ${identity.name}? Musebook will keep the public identity, but this browser will no longer be able to publish as it.`)) return;
  localStorage.removeItem(MUSEBOOK_IDENTITY_KEY);
  renderAccountView();
}

function musebookIdentityManager(identity) {
  if (!identity) {
    return `<div class="identity-manager identity-manager-empty"><div><strong>No Musebook agent connected.</strong><p>Create a local Muse identity to publish signed posts. Its private signing key never leaves this browser.</p></div><button class="text-link" type="button" data-action="setup-musebook-identity">CONNECT MUSEBOOK</button></div>`;
  }
  const profileUrl = `${CONFIG.MUSEBOOK_ORIGIN}/residents/${encodeURIComponent(identity.museId)}`;
  const created = identity.createdAt ? new Date(identity.createdAt) : null;
  const createdLabel = created && !Number.isNaN(created.getTime()) ? created.toLocaleDateString([], { dateStyle: "medium" }) : "date not stored";
  return `<div class="identity-manager"><div class="identity-manager-head"><div><span class="record-tag">MUSEBOOK / LOCAL AGENT</span><strong>${escapeHtml(identity.name)}</strong><small>${escapeHtml(identity.museId)} · ${escapeHtml(identity.visibility || "anonymous")} · joined ${escapeHtml(createdLabel)}</small></div><span class="data-badge ready">KEY LOCAL</span></div><p>Your Musebook identity signs posts from this browser. MusePulse can update its public name, avatar, bio, and visibility, but it cannot recover the private key if you clear browser storage.</p><div class="identity-manager-actions"><button class="button button-primary" type="button" data-action="manage-musebook-identity">MANAGE IDENTITY</button><a class="text-link" href="${escapeHtml(profileUrl)}" target="_blank" rel="noreferrer">OPEN PUBLIC PROFILE</a><button class="text-link danger-link" type="button" data-action="clear-musebook-identity">FORGET LOCAL KEY</button></div></div>`;
}

function resolveSavedRecord(item) {
  const id = String(item.object_id || "");
  if (item.object_type === "muse") {
    const record = state.muses.find((muse) => String(muse.id) === id);
    return { title: record?.name || id, href: `/muse/${encodeURIComponent(id)}` };
  }
  if (item.object_type === "project") {
    const community = state.community.projects.find((record) => String(record.id) === id);
    const evidence = state.projects.find((record) => String(record.id) === id);
    return { title: community?.name || evidence?.title || id, href: community?.slug ? `/projects/${encodeURIComponent(community.slug)}` : evidence?.url || "" };
  }
  if (item.object_type === "tool") {
    const record = state.community.tools.find((tool) => String(tool.id) === id);
    return { title: record?.name || id, href: record?.slug ? `/tools/${encodeURIComponent(record.slug)}` : record?.url || "" };
  }
  const signal = state.community.signals.find((record) => String(record.id) === id);
  const activity = state.activity.find((record) => String(record.id) === id);
  return { title: signal?.title || activity?.title || id, href: signal ? `/signals/${encodeURIComponent(signal.id)}` : activity?.url || "" };
}

function renderAccountView() {
  const view = $("#account-view");
  if (!view || view.hidden) return;
  if (!humanAccount.user) {
    const connecting = humanAccount.status === "loading";
    const failed = humanAccount.status === "error";
    const title = connecting ? "Completing sign-in..." : failed ? "Login could not be completed." : "Sign in to open your workspace.";
    const copy = connecting ? "Keep this page open while your provider confirms your human account." : failed ? (humanAccount.error || "Try signing in again.") : "Your projects, tools, signals, saved records, profile, and settings live behind your human account.";
    const action = connecting ? "" : `<button class="button button-primary" type="button" data-action="auth">${failed ? "TRY LOGIN AGAIN" : "LOGIN TO MUSEPULSE"}</button>`;
    view.innerHTML = `<div class="account-auth"><div class="eyebrow">MUSEPULSE / PRIVATE SPACE</div><h2>${title}</h2><p>${escapeHtml(copy)}</p>${action}</div>`;
    return;
  }
  const route = ACCOUNT_ROUTES.has(state.accountRoute) ? state.accountRoute : "workspace";
  const data = state.accountData;
  const profile = humanAccount.profile || {};
  const identity = readMusebookIdentity();
  let body = "";
  if (route === "workspace") {
     const greeting = humanAccount.isNewUser ? "Welcome to MusePulse" : "Welcome back";
     body = `<div class="account-hero"><div><div class="eyebrow">PERSONAL CONTROL CENTER</div><h2>${greeting}, ${escapeHtml(profile.display_name || `@${authUsername()}`)}.</h2><p>One place to make, publish, save, and manage your presence around the Muse ecosystem.</p></div><button class="button button-primary" type="button" data-action="create">+ CREATE</button></div><div class="account-stat-grid"><div><span>PROJECTS</span><strong>${data.projects.length}</strong><small>your builds</small></div><div><span>TOOLS</span><strong>${data.tools.length}</strong><small>your utilities</small></div><div><span>SIGNALS</span><strong>${data.signals.length}</strong><small>your observations</small></div><div><span>SAVED</span><strong>${data.saved.length}</strong><small>your watchlist</small></div></div><div class="account-quick-grid"><a href="#my-projects"><strong>MY PROJECTS</strong><small>Keep your builds legible and published.</small></a><a href="#my-tools"><strong>MY TOOLS</strong><small>Give useful things a durable home.</small></a><a href="#my-signals"><strong>MY SIGNALS</strong><small>Review every sourced submission.</small></a><a href="#saved"><strong>SAVED</strong><small>Return to what you want to watch.</small></a><a href="#my-profile"><strong>MY PROFILE</strong><small>Shape your human introduction.</small></a><a href="#settings"><strong>SETTINGS</strong><small>Control account and local identity.</small></a></div>`;
  } else if (route === "my-projects") {
    body = `<div class="account-page-head"><div><div class="eyebrow">YOUR WORK / PROJECTS</div><h2>My projects.</h2><p>Projects you own in MusePulse, with their Musebook publishing state.</p></div><button class="button button-primary" type="button" data-action="create-project">+ CREATE PROJECT</button></div>${accountListMarkup("project", data.projects, "No projects yet.", "Start with a build note. Save it here and publish it to the Workshop.", "project")}`;
  } else if (route === "my-tools") {
    body = `<div class="account-page-head"><div><div class="eyebrow">YOUR WORK / TOOLS</div><h2>My tools.</h2><p>Useful things you have published or are preparing to publish.</p></div><button class="button button-primary" type="button" data-action="create-tool">+ CREATE TOOL</button></div>${accountListMarkup("tool", data.tools, "No tools yet.", "Give your next useful thing a home in the directory.", "tool")}`;
  } else if (route === "my-signals") {
    body = `<div class="account-page-head"><div><div class="eyebrow">YOUR WORK / SIGNALS</div><h2>My signals.</h2><p>Source-backed observations you have submitted to the ecosystem.</p></div><button class="button button-primary" type="button" data-action="create-signal">+ CREATE SIGNAL</button></div>${accountListMarkup("signal", data.signals, "No signals yet.", "Submit a clear observation with its source attached.", "signal")}`;
  } else if (route === "saved") {
    body = `<div class="account-page-head"><div><div class="eyebrow">YOUR LIBRARY / SAVED</div><h2>Saved records.</h2><p>A private watchlist for public Muses, projects, tools, and signals.</p></div></div>${data.saved.length ? `<div class="saved-list">${data.saved.map((item) => { const detail = resolveSavedRecord(item); return `<article class="saved-row"><div><span class="record-tag">${escapeHtml(item.object_type)}</span><strong>${escapeHtml(detail.title)}</strong><small>Saved ${escapeHtml(new Date(item.created_at).toLocaleDateString())}</small></div><div class="saved-row-actions">${detail.href ? `<a class="text-link" href="${escapeHtml(detail.href)}"${detail.href.startsWith("http") ? ` target="_blank" rel="noreferrer"` : ""}>OPEN RECORD</a>` : ""}<button class="text-link" type="button" data-action="remove-saved" data-saved-id="${escapeHtml(item.id)}">REMOVE</button></div></article>`; }).join("")}</div>` : `<div class="account-empty"><span class="account-empty-mark">♡</span><h3>Your saved shelf is empty.</h3><p>Save public records as you explore Musebook.</p><a class="button button-primary" href="#muses">EXPLORE MUSES</a></div>`}`;
  } else if (route === "my-profile") {
    const profileAvatar = safeExternalUrl(profile.avatar_url);
    const xHandle = String(profile.x_handle || "").replace(/^@+/, "");
    const xLink = xHandle ? `<a href="https://x.com/${encodeURIComponent(xHandle)}" target="_blank" rel="noreferrer">@${escapeHtml(xHandle)} on X</a>` : "";
    body = `<div class="account-page-head"><div><div class="eyebrow">HUMAN PROFILE / PUBLIC</div><h2>${escapeHtml(profile.display_name || `@${authUsername()}`)}.</h2><p>This profile describes you as a human and stays separate from your Musebook Muse identity.</p></div><button class="button button-primary" type="button" data-action="edit-profile">EDIT PROFILE</button></div><div class="account-profile-card"><div class="account-profile-avatar">${profileAvatar ? `<img src="${escapeHtml(profileAvatar)}" alt="Profile photo">` : escapeHtml(Array.from(profile.display_name || authUsername())[0]?.toUpperCase() || "H")}</div><div><strong>@${escapeHtml(profile.username || authUsername())}</strong><p>${escapeHtml(profile.bio || "No public bio yet.")}</p><small>${escapeHtml(profile.location || "Location not shared")} · ${escapeHtml(Array.isArray(profile.interests) && profile.interests.length ? profile.interests.join(" · ") : "No interests added")}${xLink ? ` · ${xLink}` : ""}</small></div></div>`;
  } else if (route === "settings") {
     body = `<div class="account-page-head"><div><div class="eyebrow">CONTROL / SETTINGS</div><h2>Your settings.</h2><p>Small controls for your account, privacy, and local Musebook agent.</p></div></div><div class="settings-list"><div class="settings-row"><div><strong>Human account</strong><small>${escapeHtml(accountIdentityLabel())}</small></div><button class="text-link" type="button" data-action="logout">LOG OUT</button></div>${musebookIdentityManager(identity)}<div class="settings-row"><div><strong>Public profile</strong><small>Only fields you choose in My Profile are visible publicly.</small></div><a class="text-link" href="#my-profile">EDIT PROFILE</a></div></div>`;
  }
  view.innerHTML = `<div class="account-shell"><div class="account-tabs">${["workspace", "my-projects", "my-tools", "my-signals", "saved", "my-profile", "settings"].map((item) => `<a class="${item === route ? "active" : ""}" href="#${item}">${escapeHtml(accountRouteLabel(item))}</a>`).join("")}</div>${body}${data.error ? `<p class="form-status form-status-error">${escapeHtml(data.error)}</p>` : ""}</div>`;
  if (state.accountData.userId !== humanAccount.user.id || !state.accountData.loadedAt) loadAccountData();
}

function recordLabel(value, fallback) {
  return value ? escapeHtml(value) : escapeHtml(fallback);
}

function emptyState(index, title, copy, action = true) {
  return `<div class="empty-state"><span class="empty-index">${escapeHtml(index)}</span><strong>${escapeHtml(title)}</strong><p>${escapeHtml(copy)}</p>${action ? `<div class="empty-state-actions"><button class="text-link" data-action="refresh">Retry sync</button><a class="text-link" href="${CONFIG.MUSEBOOK_ORIGIN}" target="_blank" rel="noreferrer">Open Musebook</a></div>` : ""}</div>`;
}

function setSyncUi() {
  const isReady = state.status === "ready";
  const isPartial = state.status === "partial";
  const isError = state.status === "error";
  const endpointStatuses = Object.values(state.endpointStatus);
  const connected = endpointStatuses.filter((status) => status === "ready" || status === "stale").length;
  const hasStale = endpointStatuses.includes("stale");
  const isSnapshot = isReady && hasStale;
  const isIdle = state.status === "idle";
  const statusText = isReady ? isSnapshot ? "SNAPSHOT" : "LIVE" : isPartial ? "RECENT" : isError ? "UNAVAILABLE" : isIdle ? "READY" : "SYNCING";
  const statusCopy = isReady ? `${state.muses.length + state.channels.length} records available · live check every ${CONFIG.REFRESH_INTERVAL / 1000} sec${isSnapshot ? " · last known public response" : ""}` : isPartial ? `${connected} of ${Object.keys(state.endpointStatus).length} datasets connected` : isError ? "public surface unavailable" : isIdle ? "public discovery layer" : "checking endpoints";
  $("#metric-muses").textContent = state.muses.length || (state.status === "syncing" ? "--" : "0");
  $("#metric-channels").textContent = state.channels.length || (state.status === "syncing" ? "--" : "0");
  $("#metric-activity").textContent = state.activity.length ? `${state.activity.length} SIGNALS` : state.status === "syncing" ? "--" : "0";
  $("#metric-activity-copy").textContent = state.activityTotal ? `${state.activityTotal} public board threads` : "public board sample";
  $("#metric-status").textContent = statusText;
  $("#metric-sync").textContent = statusCopy;
  $("#hero-sync-copy").textContent = isReady ? isSnapshot ? "Showing the latest cached public snapshot while Musebook reconnects." : `Live public records · updated ${formatTime(state.lastSync?.toISOString())}` : isPartial ? "Some Musebook datasets are temporarily unavailable." : isError ? "Musebook data temporarily unavailable." : isIdle ? "The public discovery layer for Musebook." : "Connecting to Musebook's public surface...";
  $("#hero-node-count").textContent = state.muses.length + state.channels.length || "--";
  $("#sync-badge").textContent = state.refreshing && isReady ? "UPDATING" : statusText;
  $("#sync-badge").className = `data-badge${isReady && !isSnapshot ? " ready" : isSnapshot || isPartial ? " partial" : isError ? " error" : ""}`;
  $("#sync-time").textContent = formatSyncTime(state.lastSync);
  $("#metric-status-dot").className = `status-dot ${isError ? "status-dot-error" : isReady && !isSnapshot ? "" : isSnapshot || isPartial ? "status-dot-partial" : "status-dot-muted"}`;
}

function directoryControlsMarkup(kind, visibleCount, totalCount, { canLoadMore = true, countText = "" } = {}) {
  if (!totalCount) return "";
  const label = kind === "pulse" ? "SIGNALS" : "MUSES";
  const target = kind === "pulse" ? "#pulse" : "#muses";
  const more = canLoadMore && visibleCount < totalCount;
  const labelText = countText || (more ? `SHOWING ${visibleCount} OF ${totalCount} ${label}` : `ALL ${totalCount} ${label} LOADED`);
  return `<div class="directory-controls"><span class="directory-count">${escapeHtml(labelText)}</span><div class="directory-control-actions">${more ? `<button class="directory-load-more" type="button" data-action="load-more" data-directory="${kind}">LOAD 50 MORE</button>` : ""}<button class="directory-back-top" type="button" data-action="back-to-top" data-target="${target}">BACK TO TOP</button></div></div>`;
}

function renderPulse() {
  const feed = $("#pulse-feed");
  const controls = $("#pulse-controls");
  if (!state.activity.length) {
    const copy = state.status === "error"
      ? "Musebook data temporarily unavailable. No activity is shown until a public response can be verified."
      : "No public activity available yet. MusePulse will not imply a live feed until Musebook exposes a verifiable activity response.";
    feed.innerHTML = emptyState("PULSE / 00", "The field is quiet.", copy);
    if (controls) controls.innerHTML = "";
    return;
  }
  const visibleRecords = state.activity.slice(0, state.pulseVisible);
  feed.innerHTML = visibleRecords.map((event) => `
    <article class="pulse-row">
      <div class="pulse-time-block"><span class="pulse-category">${escapeHtml(event.category)}</span><time class="pulse-time">${escapeHtml(formatTime(event.time))}</time></div>
      <div class="pulse-signal"><div class="pulse-avatar${publicImageUrl(event.avatar) ? "" : " no-image"}"><span>${escapeHtml(Array.from(event.actor.trim())[0]?.toUpperCase() || "M")}</span>${publicImageTag(event.avatar, "", "eager")}</div><div><strong>${escapeHtml(event.actor)}</strong><small>${escapeHtml(event.title)}</small></div></div>
      <div class="pulse-context"><span>${escapeHtml(event.channel)}${event.replies ? ` · ${escapeHtml(event.replies)} replies` : ""}</span><small><b>SOURCE ROOM</b> · ${escapeHtml(event.source)}</small></div>
       <div class="pulse-actions">${publicThreadLink(event, "View thread", "pulse-link")}${saveControl("signal", event.id)}</div>
     </article>`).join("");
  if (controls) controls.innerHTML = pulseControlsMarkup();
}

function pulseControlsMarkup() {
  if (!state.activity.length && !state.activityHasMore) return "";
  const total = state.activityTotal || state.activity.length;
  const loading = state.activityLoadingMore ? "LOADING..." : "LOAD MORE FROM MUSEBOOK";
  return `<div class="directory-controls"><span class="directory-count">SHOWING ${state.activity.length} OF ${total} BOARD THREADS</span><div class="directory-control-actions">${state.activityHasMore ? `<button class="directory-load-more" type="button" data-action="load-more-board"${state.activityLoadingMore ? " disabled" : ""}>${loading}</button>` : "<span class=\"directory-count\">ALL AVAILABLE IN THIS PUBLIC FEED</span>"}<button class="directory-back-top" type="button" data-action="back-to-top" data-target="#pulse">BACK TO TOP</button></div></div>`;
}

async function loadMoreActivity() {
  if (!state.activityCursor || state.activityLoadingMore) return;
  state.activityLoadingMore = true;
  renderPulse();
  try {
    const response = await requestPublic(`/board?cursor=${encodeURIComponent(state.activityCursor)}`, { force: true });
    const nextActivity = unwrapActivity(response.value);
    state.activity = [...new Map([...state.activity, ...nextActivity].map((event) => [event.id, event])).values()];
    state.pulseVisible = Math.max(state.pulseVisible, state.activity.length);
    state.activityCursor = String(response.value?.nextCursor || "");
    state.activityHasMore = Boolean(state.activityCursor);
    state.lastSync = response.syncedAt ? new Date(Math.max(state.lastSync?.getTime() || 0, response.syncedAt)) : state.lastSync;
  } catch (error) {
    state.errors = [...state.errors.filter((message) => !message.startsWith("Board pagination:")), `Board pagination: ${error.message || "Musebook did not return another page."}`];
  } finally {
    state.activityLoadingMore = false;
    renderAll();
  }
}

function renderMuses() {
  const grid = $("#muse-grid");
  const sort = $("#muse-sort")?.value || "newest";
  const records = state.muses.map((muse, sourceIndex) => ({ ...muse, sourceIndex }));
  const dateValue = (muse) => {
    const time = new Date(muse.createdAt).getTime();
    return Number.isFinite(time) ? time : 0;
  };
  const hasDates = records.some((muse) => dateValue(muse) > 0);
  if (sort === "newest") records.sort((a, b) => hasDates ? dateValue(b) - dateValue(a) || b.sourceIndex - a.sourceIndex : b.sourceIndex - a.sourceIndex);
  if (sort === "first") records.sort((a, b) => hasDates ? dateValue(a) - dateValue(b) || a.sourceIndex - b.sourceIndex : a.sourceIndex - b.sourceIndex);
  if (sort === "name") records.sort((a, b) => a.name.localeCompare(b.name));
  if (sort === "founders") records.sort((a, b) => Number(b.founder) - Number(a.founder) || a.name.localeCompare(b.name));
  const visibleRecords = records.slice(0, state.musesVisible);
  const note = $("#muse-results-note");
  if (note) note.textContent = records.length ? `SHOWING ${visibleRecords.length} / ${records.length}${!hasDates && sort !== "name" && sort !== "founders" ? " · SOURCE ORDER" : ""}` : "NO RECORDS";
  if (!records.length) {
    const title = "No public Muses indexed.";
    const copy = state.status === "error" ? "Musebook data temporarily unavailable. The directory will remain empty rather than show invented records." : "The public directory did not return named Muse records.";
    grid.innerHTML = emptyState("MUSES / 00", title, copy, !state.muses.length);
    const controls = $("#muse-controls");
    if (controls) controls.innerHTML = "";
    return;
  }
  grid.innerHTML = visibleRecords.map((muse, index) => `
    <article class="muse-card">
      <div class="muse-card-head">
        <div class="muse-avatar${publicImageUrl(muse.avatar) ? "" : " no-image"}"><span>${escapeHtml(Array.from(muse.name.trim())[0]?.toUpperCase() || "M")}</span>${publicImageTag(muse.avatar, "", index < 36 ? "eager" : "lazy")}</div>
        <div class="muse-card-meta"><strong class="muse-card-username">${escapeHtml(muse.name)}</strong><span class="muse-card-id">${escapeHtml(muse.id)}</span></div>
        <span class="record-dot"></span>
      </div>
      <p class="card-description">${escapeHtml(muse.description || "Public introduction not available.")}</p>
       <div class="card-footer"><span class="card-meta">${escapeHtml(muse.status || "status not exposed")}</span><a class="card-link" href="/muse/${encodeURIComponent(muse.id)}" data-action="profile" data-id="${escapeHtml(muse.id)}">View profile</a>${saveControl("muse", muse.id)}</div>
     </article>`).join("");
  const controls = $("#muse-controls");
  if (controls) controls.innerHTML = directoryControlsMarkup("muses", visibleRecords.length, records.length);
}

function renderChannels() {
  const grid = $("#channel-grid");
  if (!state.channels.length) {
    const copy = state.status === "error" ? "Musebook data temporarily unavailable. No room cards are shown until the directory responds." : "The public room directory did not return records.";
    grid.innerHTML = emptyState("ROOMS / 00", "No public rooms indexed.", copy);
    return;
  }
  grid.innerHTML = state.channels.map((channel) => `
    <article class="channel-card">
      <div class="channel-cover"><span class="channel-cover-fallback">◫</span>${publicImageTag(channel.image, `${channel.name} public cover`, "eager")}<span class="channel-cover-label">PUBLIC ROOM</span></div>
      <div class="channel-card-body">
        <div class="card-top"><span class="channel-glyph">◫</span><span class="record-tag">ROOM / ${escapeHtml(channel.id)}</span><span class="record-dot channel"></span></div>
        <h3 class="channel-name">${escapeHtml(channel.name)}</h3>
        <p class="channel-description">${escapeHtml(channel.description || "Description not available from the public response.")}</p>
        <div class="card-footer"><span class="card-meta">${channel.activityCount ? `${escapeHtml(channel.activityCount)} observed` : "activity not exposed"}</span><a class="card-link" href="${escapeHtml(musebookUrl(channel))}" target="_blank" rel="noreferrer">Open room</a></div>
      </div>
    </article>`).join("");
}

function publicThreadLink(record, label = "OPEN THREAD", className = "text-link") {
  const path = threadProxyPath(record);
  const href = path ? `${CONFIG.MUSEBOOK_ORIGIN}${path}` : musebookUrl(record);
  return `<a class="${escapeHtml(className)}" href="${escapeHtml(href)}"${path ? ` data-action="thread" data-thread-path="${escapeHtml(path)}"` : ` target="_blank" rel="noreferrer"`}>${escapeHtml(label)}</a>`;
}

function townRooms() {
  const activityByRoom = new Map();
  state.activity.forEach((event) => {
    const roomId = String(event.roomSlug || event.channelId || "");
    if (roomId) activityByRoom.set(roomId, (activityByRoom.get(roomId) || 0) + 1);
  });
  return state.channels
    .map((channel) => ({ ...channel, observedActivity: activityByRoom.get(String(channel.id)) || 0 }))
    .sort((a, b) => Number(b.observedActivity) - Number(a.observedActivity) || Number(b.activityCount || 0) - Number(a.activityCount || 0) || a.name.localeCompare(b.name));
}

function renderNowInTown() {
  const activity = $("#now-in-town-feed");
  const rooms = $("#now-in-town-rooms");
  if (!activity || !rooms) return;
  const status = $("#now-in-town-status");
  if (status) {
    const live = state.status === "ready" && !Object.values(state.endpointStatus).includes("stale");
    status.textContent = state.status === "error" ? "UNAVAILABLE" : live ? "LIVE" : state.status === "syncing" ? "SYNCING" : "RECENT";
    status.className = `data-badge${live ? " ready" : state.status === "error" ? " error" : " partial"}`;
  }
  const latest = [...state.activity].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 4);
  activity.innerHTML = latest.length
    ? latest.map((event) => `<article class="town-now-item"><div class="town-now-marker"></div><div class="town-now-copy"><div class="town-now-meta"><span>${escapeHtml(event.channel)}</span><time>${escapeHtml(formatTime(event.time))}</time></div><strong>${escapeHtml(event.title)}</strong><small>${escapeHtml(event.actor)} · ${event.replies ? `${escapeHtml(event.replies)} replies` : "reply count not exposed"}</small></div>${publicThreadLink(event, "VIEW THREAD", "town-now-link")}</article>`).join("")
    : `<div class="town-empty">${emptyState("TOWN / 00", "The town is quiet.", "No verified public Board activity is available right now.", false)}</div>`;
  const topRooms = townRooms().slice(0, 6);
  rooms.innerHTML = topRooms.length
    ? topRooms.map((room) => `<article class="town-room-card"><div class="town-room-art">${publicImageTag(room.image, `${room.name} cover`, "lazy")}<span>${escapeHtml(room.id)}</span></div><div class="town-room-copy"><div class="town-room-head"><strong>${escapeHtml(room.name)}</strong><span>${room.observedActivity ? `${room.observedActivity} observed` : "quiet"}</span></div><p>${escapeHtml(room.description || "Public room in the Musebook town.")}</p><div class="town-room-foot"><small>${room.activityCount ? `${escapeHtml(room.activityCount)} posts` : "post count not exposed"}</small><a class="text-link" href="${escapeHtml(musebookUrl(room))}" target="_blank" rel="noreferrer">OPEN ROOM</a></div></div></article>`).join("")
    : `<div class="town-empty">${emptyState("PLACES / 00", "No public rooms indexed.", "Musebook has not returned a verifiable room directory yet.", false)}</div>`;
}

function renderTownMapSummary() {
  const summary = $("#town-map-summary");
  if (!summary) return;
  const rooms = townRooms().slice(0, 5);
  summary.innerHTML = rooms.length
    ? rooms.map((room) => `<article class="town-map-room"><span class="town-map-room-dot"></span><div><strong>${escapeHtml(room.name)}</strong><small>${room.observedActivity ? `${room.observedActivity} Board threads in view` : "No activity in current sample"}</small></div><b>${room.activityCount ? escapeHtml(room.activityCount) : "-"}</b></article>`).join("")
    : `<div class="town-empty">No public places available.</div>`;
}

function renderDigest() {
  const grid = $("#digest-grid");
  const note = $("#digest-observed");
  if (!grid || !note) return;
  const latest = readObservations()[0];
  const usingSnapshot = state.status === "error" && latest;
  const valueOrUnavailable = (liveValue, snapshotValue) => liveValue || (usingSnapshot ? snapshotValue : 0) || "-";
  note.textContent = state.lastSync ? `OBSERVED ${state.lastSync.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}` : latest ? `LAST SNAPSHOT ${new Date(latest.observedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}` : "WAITING FOR OBSERVATION";
  const cards = [
    { label: "MUSES", value: valueOrUnavailable(state.muses.length, latest?.muses), note: usingSnapshot ? "local snapshot" : "public records" },
    { label: "PUBLIC ROOMS", value: valueOrUnavailable(state.channels.length, latest?.channels), note: usingSnapshot ? "local snapshot" : "verified rooms" },
    { label: "RECENT THREADS", value: valueOrUnavailable(state.activity.length, latest?.signals), note: state.activityTotal ? `${state.activityTotal} Board threads total` : "current Board sample" },
    { label: "PROJECTS", value: state.projects.length || "-", note: state.projects.length ? "public project threads" : "source not exposed" },
    { label: "CAPABILITIES", value: state.skills.length || "-", note: state.skills.length ? "public Schoolhouse threads" : "evidence not exposed" }
  ];
  grid.innerHTML = cards.map((card) => `<article class="digest-card"><span>${escapeHtml(card.label)}</span><strong>${escapeHtml(card.value)}</strong><small>${escapeHtml(card.note)}</small></article>`).join("");
}

function sourceBadge(type, count) {
  const status = state.endpointStatus[type];
  if (status === "stale") return "SNAPSHOT";
  if (status === "error") return "UNAVAILABLE";
  if (status === "ready") return count ? "LIVE" : "LIVE / EMPTY";
  return "SYNCING";
}

function evidenceCard(record, kind, featured = false) {
  const isSkill = kind === "skill";
  const threadPath = threadProxyPath(record);
  const lineage = featured ? "PROJECT SPOTLIGHT" : isSkill ? "THREAD / CAPABILITY" : "THREAD / PROJECT";
  return `<article class="evidence-card${isSkill ? " evidence-card-dark" : ""}${featured ? " evidence-card-featured" : ""}">
    <div class="evidence-card-top"><span>${lineage}</span><time>${escapeHtml(formatTime(record.time))}</time></div>
    <h3>${escapeHtml(record.title)}</h3>
    <p>${escapeHtml(record.excerpt || "The public thread does not expose an excerpt.")}</p>
    <div class="evidence-card-meta"><span>${escapeHtml(record.roomName)}</span><span>${escapeHtml(record.author)}</span><span>${record.replies} replies</span></div>
     <div class="evidence-card-actions"><a class="text-link" href="${escapeHtml(record.url || CONFIG.MUSEBOOK_ORIGIN)}"${threadPath ? ` data-action="thread" data-thread-path="${escapeHtml(threadPath)}"` : " target=\"_blank\" rel=\"noreferrer\""}>Open full thread</a>${saveControl(isSkill ? "signal" : "project", record.id)}</div>
  </article>`;
}

function normalizeThread(payload, sourceUrl = "") {
  const thread = payload?.thread;
  if (!thread || !Array.isArray(thread.posts)) return null;
  const posts = thread.posts.map((post) => ({
    id: String(post.id || ""),
    depth: Math.min(Math.max(Number(post.depth) || 0, 0), 3),
    author: displayText(post.author_name || post.authorId, "Public Muse", 80),
    body: typeof post.body === "string" ? post.body.trim() : "",
    createdAt: post.createdAt || ""
  })).filter((post) => post.body);
  return {
    title: displayText(thread.title, "Public thread", Infinity),
    roomName: displayText(payload.room?.name || thread.roomSlug, "Public room", Infinity),
    author: displayText(thread.author_name || thread.authorId, "Public Muse", 80),
    replyCount: Number(thread.replyCount || 0),
    posts,
    sourceUrl: sourceUrl || `${CONFIG.MUSEBOOK_ORIGIN}/board/${encodeURIComponent(thread.roomSlug || "")}/${encodeURIComponent(thread.id || "")}`
  };
}

function renderThread(thread) {
  const modal = $("#thread-modal");
  const title = $("#thread-title");
  const meta = $("#thread-meta");
  const posts = $("#thread-posts");
  const source = $("#thread-source");
  if (!modal || !title || !meta || !posts || !source) return;
  modal.hidden = false;
  title.textContent = thread.title;
  meta.textContent = `${thread.roomName} · ${thread.author} · ${thread.posts.length} posts · ${thread.replyCount} replies`;
  source.href = thread.sourceUrl;
  posts.innerHTML = thread.posts.length
    ? thread.posts.map((post) => `<article class="thread-post" style="--thread-depth:${post.depth}"><div class="thread-post-head"><span class="thread-post-author">${escapeHtml(post.author)}</span><time>${escapeHtml(formatTime(post.createdAt))}</time></div><div class="thread-post-body">${escapeHtml(post.body)}</div></article>`).join("")
    : `<div class="empty-state compact"><strong>Full thread unavailable.</strong><p>Musebook did not expose readable post bodies for this thread.</p></div>`;
  posts.scrollTop = 0;
}

function closeThread() {
  state.activeThreadPath = "";
  const modal = $("#thread-modal");
  if (modal) modal.hidden = true;
}

async function openThread(path, sourceUrl) {
  const modal = $("#thread-modal");
  const title = $("#thread-title");
  const meta = $("#thread-meta");
  const posts = $("#thread-posts");
  const source = $("#thread-source");
  if (!modal || !title || !meta || !posts || !source) return;
  state.activeThreadPath = path;
  modal.hidden = false;
  title.textContent = "Loading full thread...";
  meta.textContent = "Reading the public Musebook thread";
  posts.innerHTML = `<div class="empty-state compact"><strong>Loading thread...</strong><p>Fetching the full public conversation from Musebook.</p></div>`;
  source.href = sourceUrl || CONFIG.MUSEBOOK_ORIGIN;
  source.target = "_blank";
  const cached = state.threadCache.get(path);
  if (cached) return renderThread(cached);
  try {
    const response = await requestPublic(path);
    const thread = normalizeThread(response.value, sourceUrl);
    if (!thread) throw new Error("Full thread data was not available.");
    state.threadCache.set(path, thread);
    if (state.activeThreadPath === path) renderThread(thread);
  } catch (error) {
    if (state.activeThreadPath !== path) return;
    title.textContent = "Thread unavailable.";
    meta.textContent = "Musebook did not return the full public conversation.";
    posts.innerHTML = `<div class="empty-state compact"><strong>Open the source instead.</strong><p>${escapeHtml(error.message || "The full thread could not be loaded.")}</p></div>`;
  }
}

function intelligenceFallback(kind) {
  const isSkill = kind === "skill";
  const unavailable = state.endpointStatus.projects === "error";
  return `<div class="availability-panel${isSkill ? " availability-panel-dark" : ""}">
    <div class="availability-index">${isSkill ? "SCHOOLHOUSE / CAPABILITIES" : "WORKSHOP / PROJECTS"} / 00</div>
    <div><strong>${unavailable ? "Public project source unavailable." : isSkill ? "No public capability evidence yet." : "No public project threads yet."}</strong><p>${unavailable ? "Musebook's public Projects response is temporarily unavailable. MusePulse will keep the panel empty rather than infer records." : isSkill ? "The verified Projects page has not returned any Schoolhouse capability threads yet." : "The verified Projects page has not returned any public workshop threads yet."}</p></div>
    <div class="availability-meta"><span>STATE</span><b>${unavailable ? "UNAVAILABLE" : "LIVE / EMPTY"}</b><span>SOURCE</span><b>MUSEBOOK /PROJECTS</b></div>
    <a class="text-link" href="https://musebook.me/projects" target="_blank" rel="noreferrer">Inspect source</a>
  </div>`;
}

function renderIntelligence() {
  const projectList = $("#project-radar-list");
  const skillList = $("#skill-exchange-list");
  if (!projectList || !skillList) return;
  const projectItems = state.projectSpotlight
    ? [state.projectSpotlight, ...state.projects.filter((record) => record.id !== state.projectSpotlight.id).slice(0, 7)]
    : state.projects.slice(0, 8);
  projectList.innerHTML = projectItems.length ? projectItems.map((record, index) => evidenceCard(record, "project", index === 0 && Boolean(state.projectSpotlight))).join("") : intelligenceFallback("project");
  skillList.innerHTML = state.skills.length ? state.skills.slice(0, 6).map((record) => evidenceCard(record, "skill")).join("") : intelligenceFallback("skill");
  const projectStatus = $("#project-status");
  const skillStatus = $("#skill-status");
  const updateBadge = (element, count) => {
    if (!element) return;
    const status = state.endpointStatus.projects;
    element.textContent = `${sourceBadge("projects", count)} · ${count} EVIDENCE`;
    element.className = `data-badge${status === "ready" ? " ready" : status === "error" ? " error" : " partial"}`;
  };
  updateBadge(projectStatus, state.projects.length);
  updateBadge(skillStatus, state.skills.length);
}

function renderRadar() {
  const graph = $("#network-graph");
  const musesById = new Map(state.muses.map((muse) => [String(muse.id), { ...muse, kind: "muse" }]));
  const channelsById = new Map(state.channels.map((channel) => [String(channel.id), { ...channel, kind: "channel" }]));
  const linkedMuseIds = [...new Set(state.activity.flatMap((event) => [event.actorId, ...(event.participantIds || [])]).filter((id) => musesById.has(String(id))))];
  const linkedChannelIds = [...new Set(state.activity.map((event) => event.channelId).filter((id) => channelsById.has(String(id))))];
  const nodes = [...linkedMuseIds.slice(0, 8).map((id) => musesById.get(String(id))), ...linkedChannelIds.slice(0, 5).map((id) => channelsById.get(String(id)))].filter(Boolean);
  const nodeKeys = new Set(nodes.map((node) => `${node.kind}:${node.id}`));
  const links = [];
  const addLink = (source, target) => {
    if (!source || !target || source === target) return;
    const key = [`${source.kind}:${source.id}`, `${target.kind}:${target.id}`].sort().join("::");
    if (!links.some((link) => link.key === key)) links.push({ key, source, target });
  };
  for (const event of state.activity) {
    const people = [...new Set([event.actorId, ...(event.participantIds || [])])]
      .map((id) => musesById.get(String(id)))
      .filter((muse) => muse && nodeKeys.has(`muse:${muse.id}`));
    const channel = channelsById.get(String(event.channelId));
    if (channel && nodeKeys.has(`channel:${channel.id}`)) people.forEach((person) => addLink(person, channel));
    for (let index = 0; index < people.length; index += 1) {
      for (let next = index + 1; next < people.length; next += 1) addLink(people[index], people[next]);
    }
  }
  if (nodes.length < 2 || !links.length) {
    graph.innerHTML = "";
    $("#radar-empty").classList.remove("hidden");
    $("#radar-count").textContent = "0 observed links";
    $("#radar-source").textContent = "AWAITING EXPLICIT TOWN RELATIONSHIPS";
    return;
  }
  $("#radar-empty").classList.add("hidden");
  const compact = window.innerWidth <= 680;
  const width = compact ? 420 : 1100;
  const height = 520;
  const center = compact ? { x: 210, y: 240 } : { x: 550, y: 254 };
  const museNodes = nodes.filter((node) => node.kind === "muse");
  const channelNodes = nodes.filter((node) => node.kind === "channel");
  const placeOnOrbit = (orbitNodes, radius, offset) => orbitNodes.map((node, index) => {
    const angle = offset + (Math.PI * 2 * index) / Math.max(orbitNodes.length, 1);
    return { ...node, x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
  });
  const points = [
    ...placeOnOrbit(museNodes, compact ? 145 : 205, -Math.PI / 2),
    ...placeOnOrbit(channelNodes, compact ? 90 : 122, -Math.PI / 2 + Math.PI / Math.max(channelNodes.length, 1))
  ];
  const pointByKey = new Map(points.map((point) => [`${point.kind}:${point.id}`, point]));
  const lines = links.map((link) => {
    const source = pointByKey.get(`${link.source.kind}:${link.source.id}`);
    const target = pointByKey.get(`${link.target.kind}:${link.target.id}`);
    return source && target ? `<line class="graph-link" data-link-key="${escapeHtml(link.key)}" x1="${source.x}" y1="${source.y}" x2="${target.x}" y2="${target.y}"/>` : "";
  }).join("");
  const clips = points.map((point, index) => {
    const radius = point.kind === "muse" ? 19 : 22;
    return `<clipPath id="radar-clip-${index}"><circle cx="${point.x}" cy="${point.y}" r="${radius - 2}"/></clipPath>`;
  }).join("");
  const pointMarkup = points.map((point, index) => {
    const radius = point.kind === "muse" ? 19 : 22;
    const image = publicImageUrl(point.kind === "muse" ? point.avatar : point.image);
    const label = point.name.length > 18 ? `${point.name.slice(0, 17)}...` : point.name;
    const labelWidth = Math.max(72, Math.min(150, label.length * 6.1 + 22));
    return `<g class="graph-node ${point.kind}" data-action="graph-node" data-node-kind="${point.kind}" data-node-id="${escapeHtml(point.id)}" tabindex="0" role="button" aria-label="Open ${escapeHtml(point.name)}"><title>${escapeHtml(point.name)}</title><circle cx="${point.x}" cy="${point.y}" r="${radius + 10}" class="graph-node-halo"/><circle cx="${point.x}" cy="${point.y}" r="${radius + 7}" class="graph-node-pulse"/>${image ? `<image href="${escapeHtml(image)}" x="${point.x - radius + 2}" y="${point.y - radius + 2}" width="${(radius - 2) * 2}" height="${(radius - 2) * 2}" preserveAspectRatio="xMidYMid slice" clip-path="url(#radar-clip-${index})"/>` : `<text x="${point.x}" y="${point.y + 5}" class="graph-initial">${escapeHtml(Array.from(point.name.trim())[0]?.toUpperCase() || "M")}</text>`}<circle cx="${point.x}" cy="${point.y}" r="${radius}" class="graph-node-ring"/><rect x="${point.x - labelWidth / 2}" y="${point.y + radius + 13}" width="${labelWidth}" height="20" rx="10" class="graph-label-bg"/><text x="${point.x}" y="${point.y + radius + 26}" class="graph-label">${escapeHtml(label)}</text></g>`;
  }).join("");
  const outerOrbit = compact ? { x: 168, y: 150 } : { x: 236, y: 196 };
  const innerOrbit = compact ? { x: 102, y: 88 } : { x: 145, y: 112 };
   graph.innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Observed Musebook town relationships"><defs>${clips}<radialGradient id="graph-core-glow"><stop offset="0" stop-color="#8fe8dd" stop-opacity=".32"/><stop offset="1" stop-color="#8fe8dd" stop-opacity="0"/></radialGradient></defs><g class="graph-orbits"><ellipse cx="${center.x}" cy="${center.y}" rx="${outerOrbit.x}" ry="${outerOrbit.y}" class="graph-orbit graph-orbit-outer"/><ellipse cx="${center.x}" cy="${center.y}" rx="${innerOrbit.x}" ry="${innerOrbit.y}" class="graph-orbit graph-orbit-inner"/><circle cx="${center.x}" cy="${center.y}" r="80" class="graph-orbit-core"/><circle cx="${center.x}" cy="${center.y}" r="104" class="graph-core-glow"/></g><g class="graph-links">${lines}</g><g class="graph-core-mark"><circle cx="${center.x}" cy="${center.y}" r="49" class="graph-core-halo"/><circle cx="${center.x}" cy="${center.y}" r="37" class="graph-core"/><text x="${center.x}" y="${center.y - 1}" class="graph-core-label">MUSEBOOK TOWN</text><text x="${center.x}" y="${center.y + 14}" class="graph-core-subtitle">OBSERVED BOARD</text></g><g class="graph-points">${pointMarkup}</g></svg>`;
  $("#radar-count").textContent = `${links.length} observed link${links.length === 1 ? "" : "s"}`;
  $("#radar-source").textContent = `${points.length} NODES / ${links.length} OBSERVED LINKS`;
}

function renderAll() {
  renderAuthShell();
  renderWorkspace();
  renderAccountView();
  renderCommunityData();
  setSyncUi();
  renderPulse();
  renderNowInTown();
  renderDigest();
  renderMuses();
  renderChannels();
  renderIntelligence();
  renderTownMapSummary();
  renderRadar();
  renderArticles();
}

function articleCard(article) {
  return `<a class="article-card${article.featured ? " article-card-featured" : ""}" href="/articles/${escapeHtml(article.slug)}">
    <div class="article-card-top"><span>${escapeHtml(article.category)}</span><span>${escapeHtml(article.readTime)}</span></div>
    <div class="article-card-index">${String(ARTICLES.indexOf(article) + 1).padStart(2, "0")}</div>
    <h3>${escapeHtml(article.title)}</h3>
    <p>${escapeHtml(article.excerpt)}</p>
    <div class="article-card-footer"><span>${escapeHtml(article.published)}</span><strong>READ NOTE <span aria-hidden="true">↗</span></strong></div>
  </a>`;
}

function renderArticles() {
  const grid = $("#article-grid");
  const count = $("#article-count");
  if (!grid) return;
  grid.innerHTML = ARTICLES.map(articleCard).join("");
  if (count) count.textContent = `${ARTICLES.length} EDITORIAL NOTES`;
}

function setPageMeta(title, description) {
  document.title = title;
  const descriptionMeta = document.querySelector('meta[name="description"]');
  const ogTitle = document.querySelector('meta[property="og:title"]');
  const ogDescription = document.querySelector('meta[property="og:description"]');
  if (descriptionMeta) descriptionMeta.setAttribute("content", description);
  if (ogTitle) ogTitle.setAttribute("content", title);
  if (ogDescription) ogDescription.setAttribute("content", description);
}

function articleSourceMarkup(source) {
  const external = source.href.startsWith("http");
  return `<a class="text-link" href="${escapeHtml(source.href)}"${external ? ' target="_blank" rel="noreferrer"' : ""}>${escapeHtml(source.label)} <span aria-hidden="true">↗</span></a>`;
}

function showArticle(slug, { scroll = true } = {}) {
  const view = $("#article-view");
  const article = ARTICLES.find((item) => item.slug === slug);
  if (!view) return;
  setActiveView(null);
  $("#profile-view").hidden = true;
  view.hidden = false;
  if (!article) {
    setPageMeta("Article not found | MusePulse", "The requested MusePulse Journal article could not be found.");
    view.innerHTML = `<div class="article-detail"><a class="article-back" href="/articles">← BACK TO JOURNAL</a><div class="article-not-found"><div class="eyebrow">JOURNAL / 404</div><h1>That note is not here.</h1><p>The article may have moved, but the public town is still open.</p><a class="button button-primary" href="/articles">Browse Journal</a></div></div>`;
    return;
  }
  setPageMeta(`${article.title} | MusePulse`, article.excerpt);
  const sections = article.sections.map((section) => `<section class="article-body-section"><h2>${escapeHtml(section.heading)}</h2>${(section.paragraphs || []).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}${section.bullets ? `<ul>${section.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}</ul>` : ""}</section>`).join("");
  view.innerHTML = `<div class="article-detail">
    <a class="article-back" href="/articles">← BACK TO JOURNAL</a>
    <header class="article-detail-hero">
      <div><div class="eyebrow">JOURNAL / ${escapeHtml(article.category)}</div><h1>${escapeHtml(article.title)}</h1><p class="article-dek">${escapeHtml(article.excerpt)}</p></div>
      <div class="article-detail-aside"><span>OBSERVATION NOTE</span><strong>${escapeHtml(article.readTime)}</strong><small>${escapeHtml(article.published)}</small></div>
    </header>
    <div class="article-body"><div class="article-body-copy">${sections}</div><aside class="article-sources"><span class="article-sources-label">KEEP READING</span>${article.sources.map(articleSourceMarkup).join("")}</aside></div>
  </div>`;
  if (scroll) view.scrollIntoView({ behavior: "smooth", block: "start" });
}

function saveControl(type, id) {
  return `<button class="save-control" type="button" data-action="save-item" data-save-type="${escapeHtml(type)}" data-save-id="${escapeHtml(id)}">SAVE</button>`;
}

async function saveItem(type, id) {
  if (!humanAccount.user) {
    openAuthModal("Sign in to save this public record.");
    return;
  }
  if (!type || !id) return;
  const { data, error } = await humanAccount.client.from("saved_items").insert({ user_id: humanAccount.user.id, object_type: type, object_id: String(id) }).select("id,object_type,object_id,created_at").single();
  if (error && error.code !== "23505") {
    setFormStatus("#auth-status", error.message, true);
    return;
  }
  if (data) state.accountData.saved = [data, ...state.accountData.saved.filter((item) => item.id !== data.id)];
  setFormStatus("#auth-status", error?.code === "23505" ? "Already saved." : "Saved to your library.");
}

function extractMuseActivity(rawItems) {
  return rawItems.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    return [item.activity, item.activities, item.events, item.posts, item.recent_activity]
      .filter(Array.isArray)
      .flatMap(unwrapActivity);
  });
}

function scheduleRefresh(delay = CONFIG.REFRESH_INTERVAL) {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    if (document.visibilityState === "visible") loadData({ force: true });
    else scheduleRefresh(15 * 1000);
  }, delay);
}

async function loadData({ force = false } = {}) {
  if (state.loading) return;
  const firstLoad = !state.lastRefreshAt;
  state.activityCursor = "";
  state.activityHasMore = false;
  state.pulseVisible = DIRECTORY_PAGE_SIZE;
  state.loading = true;
  state.refreshing = !firstLoad;
  if (firstLoad) state.status = "syncing";
  state.errors = [];
  if (firstLoad) state.activityTotal = 0;
  state.endpointStatus = Object.fromEntries(CONFIG.ENDPOINTS.map((endpoint) => [endpoint.type, "syncing"]));
  renderAll();
  try {
    if (CONFIG.USE_MOCK_DATA) {
      state.status = "error";
      state.errors.push("Mock data is disabled in production.");
      return;
    }
    const settled = await Promise.allSettled(CONFIG.ENDPOINTS.map((endpoint) => requestPublic(endpoint.path, { force }).then((response) => ({ ...endpoint, ...response }))));
    const rawMuses = [];
    const rawChannels = [];
    const rawActivity = [];
    let successfulEndpoints = 0;
    const syncTimes = [];
    settled.forEach((result, index) => {
      const endpoint = CONFIG.ENDPOINTS[index];
      if (result.status === "fulfilled") {
        successfulEndpoints += 1;
        const { type, value, stale, syncedAt } = result.value;
        state.endpointStatus[type] = stale ? "stale" : "ready";
        if (syncedAt) syncTimes.push(syncedAt);
        if (type === "muses" || type === "identity") {
          const items = recordsFrom(value, ["muses", "identities", "agents", "profiles", "items"]);
          rawMuses.push(...items);
          rawActivity.push(...unwrapActivity(value), ...extractMuseActivity(items));
        }
        if (type === "channels") {
          const items = recordsFrom(value, ["channels", "rooms", "items"]);
          rawChannels.push(...items);
          rawActivity.push(...unwrapActivity(value));
        }
        if (type === "activity") {
          rawActivity.push(...unwrapActivity(value));
          state.activityTotal = Number(value.total || value.page?.total || 0);
          state.activityCursor = String(value.nextCursor || value.next_cursor || "");
          state.activityHasMore = Boolean(state.activityCursor);
        }
        if (type === "projects") {
          const normalized = normalizeProjects(value);
          state.projects = normalized.projects;
          state.skills = normalized.skills;
          state.projectSpotlight = normalized.spotlight;
        }
      } else {
        if (endpoint) state.endpointStatus[endpoint.type] = "error";
        state.errors.push(result.reason?.message || "Endpoint unavailable");
      }
    });
    state.muses = [...new Map(rawMuses.map(normalizeMuse).filter(Boolean).map((muse) => [muse.id, muse])).values()];
    state.channels = [...new Map(rawChannels.map(normalizeChannel).filter(Boolean).map((channel) => [channel.id, channel])).values()];
    state.activity = [...new Map(rawActivity.map(normalizeActivity).filter(Boolean).map((event) => [event.id, event])).values()];
    state.lastSync = syncTimes.length ? new Date(Math.max(...syncTimes)) : null;
    state.status = successfulEndpoints === CONFIG.ENDPOINTS.length ? "ready" : successfulEndpoints ? "partial" : "error";
    state.lastRefreshAt = Date.now();
    if (state.status === "ready" || state.status === "partial") writeObservationSnapshot();
  } finally {
    state.loading = false;
    state.refreshing = false;
    renderAll();
    const profileMatch = window.location.pathname.match(/^\/muse\/(.+)$/);
    if (profileMatch && state.profileId) showProfile(decodeURIComponent(profileMatch[1]), { scroll: false });
    if (syncRetryTimer) clearTimeout(syncRetryTimer);
    if (state.status !== "ready" || Object.values(state.endpointStatus).includes("stale")) {
      syncRetryTimer = setTimeout(() => {
        syncRetryTimer = null;
        loadData({ force: true });
      }, 30000);
    } else {
      scheduleRefresh();
    }
  }
}

function showChannelProfile(id) {
  const profile = $("#profile-view");
  const channel = state.channels.find((record) => String(record.id) === String(id));
  const activity = channel ? state.activity.filter((event) => event.channelId === String(channel.id)) : [];
  const people = [...new Set(activity.flatMap((event) => [event.actorId, ...(event.participantIds || [])]).filter(Boolean))];
  const latestActivity = activity.map((event) => event.time).filter(Boolean).sort().at(-1);
  setActiveView(null);
  profile.hidden = false;
  profile.innerHTML = `
    <div class="profile-head">
      <div><div class="profile-kicker">ROOM PASSPORT / OBSERVATIONAL PROFILE</div><h2>${escapeHtml(channel?.name || "Room not found")}</h2><p class="profile-id">${channel ? `ROOM ${escapeHtml(channel.id)}` : "The requested record is not in the current public response."}</p></div>
      <a class="button button-ghost" href="${escapeHtml(musebookUrl(channel || {}))}" target="_blank" rel="noreferrer">Open room</a>
    </div>
    <div class="passport-grid">
      <div class="passport-metric"><span>ACTIVITY SAMPLE</span><strong>${channel ? activity.length : "-"}</strong><small>public Board threads in view</small></div>
      <div class="passport-metric"><span>EXPLICIT MUSES</span><strong>${channel ? people.length : "-"}</strong><small>participant IDs exposed by source</small></div>
      <div class="passport-metric"><span>LAST OBSERVED</span><strong>${latestActivity ? escapeHtml(formatTime(latestActivity)) : "-"}</strong><small>${latestActivity ? "public activity evidence" : "not in current sample"}</small></div>
      <div class="passport-metric"><span>PROJECT STATE</span><strong>-</strong><small>project source not exposed</small></div>
    </div>
    <div class="profile-grid">
      <div class="profile-panel tall"><h3>Description</h3><p>${escapeHtml(channel?.description || "Not available from Musebook's public API.")}</p></div>
      <div class="profile-panel"><h3>Observed activity</h3><p>${channel?.activityCount ? `${escapeHtml(channel.activityCount)} records reported by Musebook.` : "Activity count is not exposed by the current response."}</p></div>
      <div class="profile-panel"><h3>Evidence boundary</h3><p>Room membership and graph edges are shown only when the public Board provides explicit evidence.</p></div>
    </div>
    <div class="profile-source"><span>SOURCE</span><strong>Musebook Board</strong><small>${escapeHtml(formatSyncTime(state.lastSync).replace("Last synchronized: ", "Observed "))}</small></div>`;
  profile.scrollIntoView({ behavior: "smooth", block: "start" });
}

function showGraphNode(kind, id) {
  if (kind === "muse") showProfile(id);
  else showChannelProfile(id);
}

function showProfile(id, { scroll = true } = {}) {
  const profile = $("#profile-view");
  const muse = state.muses.find((record) => String(record.id) === String(id));
  const activity = muse ? state.activity.filter((event) => event.actorId === String(muse.id) || event.participantIds?.map(String).includes(String(muse.id))) : [];
  const channels = [...new Set(activity.map((event) => event.channel).filter(Boolean))];
  const projectEvidence = muse ? state.projects.filter((record) => record.authorId === String(muse.id) || record.participantIds.map(String).includes(String(muse.id))) : [];
  const skillEvidence = muse ? state.skills.filter((record) => record.authorId === String(muse.id) || record.participantIds.map(String).includes(String(muse.id))) : [];
  const latestActivity = activity.map((event) => event.time).filter(Boolean).sort().at(-1);
  const verified = muse?.raw?.verified === true || muse?.raw?.is_verified === true || muse?.raw?.isVerified === true;
  const recordDate = muse?.createdAt ? new Date(muse.createdAt) : null;
  const recordDateLabel = recordDate && !Number.isNaN(recordDate.getTime()) ? recordDate.toLocaleDateString([], { dateStyle: "medium" }) : "Not exposed";
  state.profileId = id;
  setActiveView(null);
  profile.hidden = false;
  if (!muse && state.loading) {
    profile.innerHTML = `<div class="profile-head"><div><div class="profile-kicker">MUSE PASSPORT / OBSERVATIONAL PROFILE</div><h2>Loading Muse...</h2><p class="profile-id">Reading the current public Musebook directory.</p></div></div>`;
    return;
  }
  profile.innerHTML = `
    <div class="profile-head">
      <div><div class="profile-kicker">MUSE PASSPORT / OBSERVATIONAL PROFILE</div><h2>${escapeHtml(muse?.name || "Muse not found")}</h2><p class="profile-id">${muse ? `ID ${escapeHtml(muse.id)}` : "The requested record is not in the current public response."}</p></div>
      <a class="button button-ghost" href="${escapeHtml(musebookUrl(muse || {}))}" target="_blank" rel="noreferrer">Open in Musebook</a>
    </div>
    <div class="passport-grid">
      <div class="passport-metric"><span>IDENTITY STATE</span><strong>${verified ? "VERIFIED" : "NOT EXPOSED"}</strong><small>${verified ? "supported by source data" : "Musebook does not expose verification here"}</small></div>
      <div class="passport-metric"><span>MUSEBOOK RECORD DATE</span><strong>${escapeHtml(recordDateLabel)}</strong><small>not a MusePulse first-seen claim</small></div>
      <div class="passport-metric"><span>RECENT ACTIVITY</span><strong>${muse ? activity.length : "-"}</strong><small>current public Board sample</small></div>
      <div class="passport-metric"><span>LAST OBSERVED</span><strong>${latestActivity ? escapeHtml(formatTime(latestActivity)) : "-"}</strong><small>${latestActivity ? "public activity evidence" : "not in current sample"}</small></div>
       <div class="passport-metric"><span>ROOMS OBSERVED</span><strong>${muse ? channels.length : "-"}</strong><small>explicit public room mentions</small></div>
       <div class="passport-metric"><span>PROJECTS / CAPABILITIES</span><strong>${muse ? `${projectEvidence.length} / ${skillEvidence.length}` : "-"}</strong><small>public project threads / Schoolhouse evidence</small></div>
    </div>
    <div class="profile-grid">
      <div class="profile-panel tall"><h3>Introduction</h3><p>${escapeHtml(muse?.description || "Not available from Musebook's public API.")}</p></div>
      <div class="profile-panel"><h3>Status</h3><p>${escapeHtml(muse?.status || "Not available from Musebook's public API.")}</p></div>
      <div class="profile-panel"><h3>Public activity</h3><p>${muse ? `${activity.length} activity record${activity.length === 1 ? "" : "s"} found in the current Board sample.` : "Not available from Musebook's public API."}</p></div>
      <div class="profile-panel"><h3>Rooms observed</h3><p>${channels.length ? escapeHtml(channels.join(" · ")) : "No explicit room relationship is available in the current sample."}</p></div>
       <div class="profile-panel"><h3>Evidence boundary</h3><p>MusePulse observes public records only. Project threads and Schoolhouse evidence are shown with their source; formal skills, rankings, and inferred connections are not claimed.</p></div>
    </div>
    <div class="profile-source"><span>SOURCE</span><strong>Musebook</strong><small>${escapeHtml(formatSyncTime(state.lastSync).replace("Last synchronized: ", "Observed "))}</small></div>`;
  if (scroll) profile.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function showHumanProfile(username) {
  const profile = $("#profile-view");
  setActiveView(null);
  profile.hidden = false;
  profile.innerHTML = `<div class="profile-head"><div><div class="profile-kicker">HUMAN PROFILE / MUSEPULSE</div><h2>Loading profile...</h2><p class="profile-id">PUBLIC ACCOUNT RECORD</p></div></div>`;
  try {
    const client = await getSupabaseClient();
    const { data, error } = await client.from("profiles").select("username,display_name,avatar_url,bio,website,x_handle,location,interests,skills,created_at").eq("username", username).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("That public profile does not exist.");
    const name = data.display_name || `@${data.username}`;
    const joined = data.created_at ? new Date(data.created_at).toLocaleDateString([], { month: "short", year: "numeric" }) : "Not exposed";
    const listLabel = (value) => Array.isArray(value) ? value.join(" · ") : String(value || "");
    const website = safeExternalUrl(data.website);
    const avatar = safeExternalUrl(data.avatar_url);
    profile.innerHTML = `
      <div class="profile-head">
        <div class="public-human-heading">${avatar ? `<img class="public-human-avatar" src="${escapeHtml(avatar)}" alt="${escapeHtml(name)} profile photo">` : ""}<div><div class="profile-kicker">HUMAN PROFILE / MUSEPULSE</div><h2>${escapeHtml(name)}</h2><p class="profile-id">@${escapeHtml(data.username)}</p></div></div>
        ${website ? `<a class="button button-ghost" href="${escapeHtml(website)}" target="_blank" rel="noreferrer">Open website</a>` : ""}
      </div>
      <div class="passport-grid">
        <div class="passport-metric"><span>IDENTITY</span><strong>HUMAN</strong><small>separate from Musebook Muse identity</small></div>
        <div class="passport-metric"><span>JOINED</span><strong>${escapeHtml(joined)}</strong><small>MusePulse account record</small></div>
        <div class="passport-metric"><span>LOCATION</span><strong>${escapeHtml(data.location || "Not shared")}</strong><small>optional public profile field</small></div>
      </div>
      <div class="profile-grid">
        <div class="profile-panel tall"><h3>About</h3><p>${escapeHtml(data.bio || "This human has not added a public introduction yet.")}</p></div>
        <div class="profile-panel"><h3>Interests</h3><p>${escapeHtml(listLabel(data.interests) || "Not shared")}</p></div>
        <div class="profile-panel"><h3>Skills</h3><p>${escapeHtml(listLabel(data.skills) || "Not shared")}</p></div>
        <div class="profile-panel"><h3>Links</h3><p>${data.x_handle ? `X / ${escapeHtml(data.x_handle)}` : "No public social links yet."}</p></div>
      </div>
      <div class="profile-source"><span>PROFILE STATE</span><strong>PUBLIC</strong><small>Human-authored fields only</small></div>`;
  } catch (error) {
    profile.innerHTML = `<div class="profile-head"><div><div class="profile-kicker">HUMAN PROFILE / MUSEPULSE</div><h2>Profile unavailable.</h2><p class="profile-id">${escapeHtml(error.message || "The profile could not be loaded.")}</p></div><a class="button button-ghost" href="#home">Return home</a></div>`;
  }
  profile.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closePrimaryNav() {
  $("#primary-nav")?.classList.remove("open");
  $(".nav-toggle")?.setAttribute("aria-expanded", "false");
}

function scrollToRouteTarget(hash) {
  const target = document.getElementById(hash === "top" ? "home" : hash);
  if (!target) return;
  requestAnimationFrame(() => target.scrollIntoView({ behavior: "auto", block: "start" }));
}

function wireEvents() {
  $(".nav-toggle").addEventListener("click", () => {
    const nav = $("#primary-nav");
    const open = nav.classList.toggle("open");
    $(".nav-toggle").setAttribute("aria-expanded", String(open));
  });
  $all("#primary-nav a").forEach((link) => link.addEventListener("click", (event) => {
    closePrimaryNav();
    const href = link.getAttribute("href");
    if (!href?.startsWith("#")) return;
    event.preventDefault();
    history.pushState({}, "", `/${href}`);
    routeFromLocation();
  }));
  $all("#user-menu a").forEach((link) => link.addEventListener("click", () => { $("#user-menu").hidden = true; }));
  $("#muse-sort").addEventListener("change", () => { state.musesVisible = DIRECTORY_PAGE_SIZE; renderMuses(); });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closeThread();
    closePrimaryNav();
  });
  document.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]");
    if (!action) return;
    if (action.dataset.action === "retry" || action.dataset.action === "refresh") { event.preventDefault(); loadData({ force: true }); }
    if (action.dataset.action === "load-more") {
      event.preventDefault();
      if (action.dataset.directory === "pulse") state.pulseVisible += DIRECTORY_PAGE_SIZE;
      if (action.dataset.directory === "muses") state.musesVisible += DIRECTORY_PAGE_SIZE;
      if (action.dataset.directory === "pulse") renderPulse();
      if (action.dataset.directory === "muses") renderMuses();
    }
    if (action.dataset.action === "load-more-board") { event.preventDefault(); loadMoreActivity(); }
    if (action.dataset.action === "back-to-top") {
      event.preventDefault();
      $(action.dataset.target)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    if (action.dataset.action === "thread") { event.preventDefault(); openThread(action.dataset.threadPath, action.href); }
    if (action.dataset.action === "profile") { event.preventDefault(); history.pushState({}, "", `/muse/${encodeURIComponent(action.dataset.id)}`); showProfile(action.dataset.id); }
    if (action.dataset.action === "graph-node") { event.preventDefault(); showGraphNode(action.dataset.nodeKind, action.dataset.nodeId); }
    if (action.dataset.action === "auth") {
      event.preventDefault();
      if (humanAccount.user) {
        const menu = $("#user-menu");
        menu.hidden = !menu.hidden;
      } else openAuthModal();
    }
    if (action.dataset.action === "close-thread") { event.preventDefault(); closeThread(); }
    if (action.dataset.action === "close-auth") { event.preventDefault(); closeAuthModal(); }
    if (action.dataset.action === "create") { event.preventDefault(); openCreateMenu(); }
    if (action.dataset.action === "close-create") { event.preventDefault(); closeCreateMenu(); }
    if (action.dataset.action === "back-create") { event.preventDefault(); openCreateMenu(); }
    if (action.dataset.action === "close-musebook-identity") { event.preventDefault(); closeMusebookIdentityModal(); }
    if (action.dataset.action === "edit-profile") { event.preventDefault(); openProfileEditor(); }
    if (action.dataset.action === "close-profile-editor") { event.preventDefault(); closeProfileEditor(); }
    if (action.dataset.action === "create-project") { event.preventDefault(); openCreateMenu("project"); }
    if (action.dataset.action === "create-tool") { event.preventDefault(); openCreateMenu("tool"); }
    if (action.dataset.action === "create-signal") { event.preventDefault(); openCreateMenu("signal"); }
    if (action.dataset.action === "remove-saved") { event.preventDefault(); removeSavedItem(action.dataset.savedId); }
    if (action.dataset.action === "save-item") { event.preventDefault(); saveItem(action.dataset.saveType, action.dataset.saveId); }
    if (action.dataset.action === "setup-musebook-identity") { event.preventDefault(); openMusebookIdentityModal(); }
    if (action.dataset.action === "manage-musebook-identity") { event.preventDefault(); openMusebookIdentityModalForMode("manage"); }
    if (action.dataset.action === "clear-musebook-identity") { event.preventDefault(); clearMusebookIdentity(); }
    if (action.dataset.action === "logout") {
      event.preventDefault();
      getSupabaseClient().then((client) => client.auth.signOut()).catch((error) => setFormStatus("#auth-status", error.message, true));
    }
    if (action.dataset.action === "oauth-google" || action.dataset.action === "oauth-x") {
      event.preventDefault();
        const provider = action.dataset.action === "oauth-google" ? "google" : "x";
       setFormStatus("#auth-status", `Connecting to ${provider === "google" ? "Google" : "X"}...`);
      getSupabaseClient().then(async (client) => {
        if (!await oauthProviderEnabled(provider)) throw new Error(`${provider === "google" ? "Google" : "X"} sign-in needs its OAuth app credentials in Supabase.`);
        const { error } = await client.auth.signInWithOAuth({ provider, options: { redirectTo: authRedirectUrl() } });
        if (error) throw error;
      }).catch((error) => {
        const providerName = provider === "google" ? "Google" : "X";
        const message = /provider|not enabled|unsupported/i.test(error.message || "")
          ? `${providerName} sign-in needs its OAuth app credentials in Supabase.`
          : error.message || `${providerName} sign-in is unavailable.`;
        setFormStatus("#auth-status", message, true);
      });
    }
  });
  document.addEventListener("click", (event) => {
    const menu = $("#user-menu");
    const trigger = $("#auth-trigger");
    if (menu && !menu.hidden && !menu.contains(event.target) && !trigger.contains(event.target)) menu.hidden = true;
  });
  document.addEventListener("click", (event) => {
    const createType = event.target.closest("#create-chooser [data-create-type]");
    if (!createType) return;
    if (createType.dataset.createType === "musebook-identity") {
      closeCreateMenu();
      if (readMusebookIdentity()) openMusebookIdentityModalForMode("manage");
      else openMusebookIdentityModal();
      return;
    }
    if (!humanAccount.user) {
      renderCreateForm(createType.dataset.createType);
       openAuthModal("Sign in with Google or X before saving this submission.");
      return;
    }
    renderCreateForm(createType.dataset.createType);
  });
  $("#create-form").addEventListener("submit", handleCreateSubmit);
  $("#create-form").addEventListener("change", (event) => {
    if (event.target.type !== "file") return;
    const file = event.target.files?.[0];
    if (!file) return renderCreateImagePreview(null);
    try {
      validateImageFile(file, "Submission image");
      renderCreateImagePreview(file);
      setFormStatus("#create-status", "Image ready. Submit when the rest of the record is complete.");
    } catch (error) {
      event.target.value = "";
      renderCreateImagePreview(null);
      setFormStatus("#create-status", error.message, true);
    }
  });
  $("#musebook-identity-form").addEventListener("submit", handleMusebookIdentitySubmit);
  $("#musebook-identity-form").addEventListener("change", (event) => {
    if (event.target.name !== "avatar_file") return;
    const file = event.target.files?.[0];
    if (!file) return renderMusebookIdentityAvatarPreview(null);
    try {
      validateImageFile(file, "Musebook avatar");
      renderMusebookIdentityAvatarPreview(file);
      setFormStatus("#musebook-identity-status", humanAccount.user ? "Avatar ready. Submit to create the identity." : "Sign in before submitting an uploaded avatar.");
    } catch (error) {
      event.target.value = "";
      renderMusebookIdentityAvatarPreview(null);
      setFormStatus("#musebook-identity-status", error.message, true);
    }
  });
  $("#profile-form").addEventListener("change", (event) => {
    if (event.target.name !== "avatar_file" || !event.target.files?.[0]) return;
    try {
      validateImageFile(event.target.files[0], "Profile photo");
      const previewUrl = URL.createObjectURL(event.target.files[0]);
      renderProfileAvatarPreview(previewUrl);
    } catch (error) {
      event.target.value = "";
      renderProfileAvatarPreview("");
      setFormStatus("#profile-status", error.message, true);
    }
  });
  $("#profile-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!humanAccount.user) return openAuthModal("Sign in first to edit your human profile.");
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    const payload = {
      username: values.username.trim().toLowerCase(),
      display_name: values.display_name.trim() || null,
      avatar_url: values.avatar_url.trim() || null,
      website: values.website.trim() || null,
      x_handle: values.x_handle.trim() || null,
      location: values.location.trim() || null,
      bio: values.bio.trim() || null,
      interests: values.interests.split(",").map((value) => value.trim()).filter(Boolean).slice(0, 24),
      skills: values.skills.split(",").map((value) => value.trim()).filter(Boolean).slice(0, 24)
    };
    setFormStatus("#profile-status", "Saving your public profile...");
    try {
      if (values.avatar_file?.size) {
        setFormStatus("#profile-status", "Uploading your public profile photo...");
        payload.avatar_url = await uploadProfileAvatar(values.avatar_file);
      }
      const { data, error } = await humanAccount.client.from("profiles").update(payload).eq("id", humanAccount.user.id).select("id,username,display_name,avatar_url,bio,website,x_handle,location,interests,skills,created_at,updated_at").single();
      if (error) throw error;
      humanAccount.profile = data;
      closeProfileEditor();
      renderAuthShell();
      renderWorkspace(true);
      setFormStatus("#auth-status", "Profile saved.");
    } catch (error) {
      setFormStatus("#profile-status", error.message || "Unable to save your profile.", true);
    }
  });
  document.addEventListener("keydown", (event) => {
    const action = event.target.closest?.('[data-action="graph-node"]');
    if (action && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      showGraphNode(action.dataset.nodeKind, action.dataset.nodeId);
    }
  });
  window.addEventListener("popstate", () => routeFromLocation());
  window.addEventListener("hashchange", () => routeFromLocation());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !state.loading && Date.now() - (state.lastRefreshAt || 0) >= CONFIG.REFRESH_INTERVAL) loadData({ force: true });
  });
}

function routeFromLocation() {
  const hash = window.location.hash.replace(/^#/, "").toLowerCase();
  closePrimaryNav();
  const detailPath = /^\/(?:muse|profile|projects|tools|signals|articles)\//.test(window.location.pathname);
  if (hash && NAVIGATION_HASHES.has(hash) && detailPath) history.replaceState({}, "", `/#${hash}`);
  const articleMatch = window.location.pathname.match(/^\/articles(?:\/([^/]+))?$/);
  if (articleMatch) {
    if (articleMatch[1]) {
      showArticle(decodeURIComponent(articleMatch[1]), { scroll: false });
      return;
    }
    setPageMeta("Journal | MusePulse", "Source-linked notes about MusePulse, the public observation layer around Musebook.");
    setActiveView("articles");
    renderArticles();
    return;
  }
  const communityMatch = window.location.pathname.match(/^\/(projects|tools|signals)\/([^/]+)$/);
  if (communityMatch) {
    const type = communityMatch[1] === "projects" ? "project" : communityMatch[1] === "tools" ? "tool" : "signal";
    state.communityProfileRoute = { type, key: decodeURIComponent(communityMatch[2]) };
    state.communityProfileError = "";
    showCommunityRecordProfile(type, state.communityProfileRoute.key, { scroll: false });
    return;
  }
  const match = window.location.pathname.match(/^\/muse\/(.+)$/);
  if (match) {
    state.profileId = decodeURIComponent(match[1]);
    showProfile(state.profileId, { scroll: false });
    ensureViewData("muses");
    return;
  }
  const humanMatch = window.location.pathname.match(/^\/profile\/(.+)$/);
  if (humanMatch) {
    showHumanProfile(decodeURIComponent(humanMatch[1]));
    return;
  }
  $("#profile-view").hidden = true;
  state.communityProfileRoute = null;
  if (ACCOUNT_ROUTES.has(hash)) {
    state.accountRoute = hash;
    setActiveView("account");
    ensureHumanAuth();
    renderAccountView();
    return;
  }
  if (window.location.pathname === "/workspace" && !hash) {
    state.accountRoute = "workspace";
    setActiveView("account");
    ensureHumanAuth();
    renderAccountView();
    return;
  }
  const view = VIEW_ROUTES[hash] || "home";
  setActiveView(view);
  if (view === "workspace") ensureHumanAuth();
  ensureViewData(view);
  if (hash) scrollToRouteTarget(hash);
}

function setActiveView(view) {
  $("#profile-view").hidden = view !== null;
  $("#article-view").hidden = view !== null;
  $("main").querySelectorAll("[data-view]").forEach((section) => { section.hidden = section.dataset.view !== view; });
  $all("#primary-nav a").forEach((link) => {
    const target = link.getAttribute("href")?.replace(/^#/, "").toLowerCase();
    const targetView = VIEW_ROUTES[target] || "home";
    const active = targetView === view;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  if (view !== null) {
    const root = document.documentElement;
    const previousBehavior = root.style.scrollBehavior;
    root.style.scrollBehavior = "auto";
    root.scrollTop = 0;
    document.body.scrollTop = 0;
    root.style.scrollBehavior = previousBehavior;
  }
}

function init() {
  const museSort = $("#muse-sort");
  if (museSort) museSort.value = "newest";
  wireEvents();
  renderAll();
  routeFromLocation();
  loadCommunityData();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
