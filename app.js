/* MusePulse keeps the public data boundary explicit: no mock records ship by default. */
const CONFIG = {
  USE_MOCK_DATA: false,
  MUSEBOOK_ORIGIN: "https://musebook.me",
  PROXY_PATH: "/api/musebook",
  CACHE_TTL: 30 * 1000,
  REFRESH_INTERVAL: 60 * 1000,
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
  query: "",
  profileId: null,
  threadCache: new Map(),
  activeThreadPath: "",
  accountRoute: "workspace",
  accountData: { projects: [], tools: [], signals: [], saved: [], userId: null },
  accountLoading: false,
  community: { projects: [], tools: [], signals: [], status: "idle", error: "" },
  communityLoading: false,
  loading: false,
  refreshing: false,
  lastRefreshAt: null
};

const humanAccount = {
  client: null,
  clientPromise: null,
  session: null,
  user: null,
  profile: null,
  status: "loading",
  error: ""
};
const SUPABASE_MODULE_URL = "https://esm.sh/@supabase/supabase-js@2.57.4";
let humanAuthPromise = null;
const DATA_VIEWS = new Set(["pulse", "muses", "projects", "skills", "graph"]);
const MUSEBOOK_IDENTITY_KEY = "musepulse:musebook-identity:v1";
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
      ["description", "What did you observe?", "textarea", "Keep the claim specific and sourced.", true],
      ["source_url", "Source URL", "url", "https://...", true],
      ["category", "Category", "select", ["DISCOVERY", "BUILD", "ECOSYSTEM", "PROJECT", "SKILL", "DISCUSSION"], true],
      ["related_muse_id", "Related Muse ID", "text", "optional", false]
    ]
  }
};
const MUSEBOOK_CHANNELS = ["museideas", "skillexchange", "townsquare", "lobby", "moneycrew"];

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
      const response = await fetch(`${CONFIG.PROXY_PATH}?path=${encodeURIComponent(path)}`, {
        headers: { Accept: "application/json" },
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
  if (!record.roomSlug || !record.id) return "";
  return `/board/${encodeURIComponent(record.roomSlug)}/${encodeURIComponent(record.id)}`;
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
  return `Last synchronized: ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · auto-refresh 60 sec`;
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
      const { createClient } = await import(SUPABASE_MODULE_URL);
      humanAccount.client = createClient(config.url, config.publishableKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" } });
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
  return String(value || "item").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "item";
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
      client.from("projects").select("id,name,slug,description,website_url,github_url,category,status,musebook_post_url,created_at").eq("visibility", "public").order("created_at", { ascending: false }).limit(18),
      client.from("tools").select("id,name,slug,description,url,category,musebook_post_url,created_at").eq("visibility", "public").order("created_at", { ascending: false }).limit(18),
      client.from("signals").select("id,title,description,source_url,category,status,musebook_post_url,created_at").eq("visibility", "public").order("created_at", { ascending: false }).limit(18)
    ]);
    const firstError = [projects, tools, signals].find((result) => result.error)?.error;
    if (firstError) throw firstError;
    state.community = { projects: projects.data || [], tools: tools.data || [], signals: signals.data || [], status: "ready", error: "" };
  } catch (error) {
    state.community = { ...state.community, status: "error", error: error.message || "Public community records are unavailable." };
  } finally {
    state.communityLoading = false;
    renderCommunityData();
  }
}

function publicCommunityCard(type, record) {
  const title = record.name || record.title || "Untitled public record";
  const description = record.description || "No description added yet.";
  const source = safeExternalUrl(record.musebook_post_url) || safeExternalUrl(record.website_url) || safeExternalUrl(record.url) || safeExternalUrl(record.source_url);
  const meta = type === "project" ? [record.category || "PROJECT", record.status || "ACTIVE"] : type === "tool" ? [record.category || "TOOL", "PUBLIC"] : [record.category || "DISCOVERY", "PUBLISHED"];
  const saveType = type === "project" ? "project" : type === "tool" ? "tool" : "signal";
  return `<article class="community-card"><div class="community-card-top"><span class="record-tag">PUBLIC ${escapeHtml(type.toUpperCase())}</span><span class="public-dot">LIVE</span></div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p><div class="community-card-meta">${meta.map((item) => `<span>${escapeHtml(String(item))}</span>`).join("")}</div><div class="community-card-actions">${source ? `<a class="text-link" href="${escapeHtml(source)}" target="_blank" rel="noreferrer">OPEN SOURCE</a>` : ""}${saveControl(saveType, record.id)}</div></article>`;
}

function renderCommunityCollection(target, type, records, emptyCopy) {
  const element = $(target);
  if (!element) return;
  if (state.community.status === "error") {
    element.innerHTML = `<div class="community-empty"><strong>Public records unavailable.</strong><p>${escapeHtml(state.community.error)}</p></div>`;
    return;
  }
  element.innerHTML = records.length ? records.slice(0, 12).map((record) => publicCommunityCard(type, record)).join("") : `<div class="community-empty"><strong>No public ${escapeHtml(type)} records yet.</strong><p>${escapeHtml(emptyCopy)}</p></div>`;
}

function renderCommunityData() {
  renderCommunityCollection("#community-projects-grid", "project", state.community.projects, "Be the first person to publish a project here.");
  renderCommunityCollection("#tools-grid", "tool", state.community.tools, "Be the first person to publish a public tool here.");
  renderCommunityCollection("#community-signals-grid", "signal", state.community.signals, "Be the first person to publish a sourced signal here.");
  $("#community-project-status")?.replaceChildren(document.createTextNode(`${state.community.projects.length} PUBLIC`));
  $("#community-tool-status")?.replaceChildren(document.createTextNode(`${state.community.tools.length} PUBLIC`));
  $("#community-signal-status")?.replaceChildren(document.createTextNode(`${state.community.signals.length} PUBLIC`));
}

function authUsername() {
  return humanAccount.profile?.username || humanAccount.user?.user_metadata?.user_name || humanAccount.user?.email?.split("@")[0] || "human";
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
  const { data, error } = await humanAccount.client.from("profiles").select("id,username,display_name,avatar_url,bio,website,x_handle,location,interests,skills,created_at,updated_at").eq("id", humanAccount.user.id).maybeSingle();
  if (error) {
    humanAccount.status = "error";
    humanAccount.error = error.message;
  } else {
    humanAccount.profile = data;
    humanAccount.status = "signed_in";
  }
  renderAuthShell();
  renderWorkspace(true);
}

async function initHumanAuth() {
  try {
    const client = await getSupabaseClient();
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    humanAccount.session = data.session;
    humanAccount.user = data.session?.user || null;
    humanAccount.status = humanAccount.user ? "signed_in" : "signed_out";
    client.auth.onAuthStateChange((_event, session) => {
      humanAccount.session = session;
      humanAccount.user = session?.user || null;
      humanAccount.profile = null;
      humanAccount.status = humanAccount.user ? "signed_in" : "signed_out";
      renderAuthShell();
      renderWorkspace(true);
      if (humanAccount.user) window.setTimeout(() => loadHumanProfile(), 0);
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

function closeAuthModal() {
  $("#auth-modal").hidden = true;
}

function openCreateMenu(type = "") {
  $("#create-menu").hidden = false;
  const chooser = $("#create-chooser");
  const form = $("#create-form");
  if (type && CREATE_DEFINITIONS[type]) {
    renderCreateForm(type);
    if (!humanAccount.user) openAuthModal("Sign in with Google before saving this submission.");
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
  const existing = readMusebookIdentity();
  if (existing) {
    setFormStatus("#create-status", `Musebook identity ready: ${existing.name} · ${existing.museId}`);
    return;
  }
  $("#musebook-identity-modal").hidden = false;
  setFormStatus("#musebook-identity-status", "");
  $("#musebook-identity-form").elements.name.focus();
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
      <label>Publish room<select name="channel">${MUSEBOOK_CHANNELS.map((channel) => `<option value="${channel}"${channel === definition.channel ? " selected" : ""}>#${channel}</option>`).join("")}</select></label>
      <label class="profile-form-wide">Musebook post <span>optional, max 300 characters</span><textarea name="post_text" rows="3" maxlength="300" placeholder="A short public note for the town..."></textarea></label>
      <label class="checkbox-label profile-form-wide"><input name="publish" type="checkbox" checked> Publish this submission to Musebook now</label>
    </div>
    <p class="publish-note">Publishing uses your local Musebook signing key. It never sends that private key to MusePulse.</p>
    <div class="form-actions"><button class="button button-ghost" type="button" data-action="back-create">BACK</button><button class="button button-primary" type="submit">${definition.submitLabel}</button></div>
    <a id="create-result-link" class="text-link" hidden target="_blank" rel="noreferrer">Open published Musebook post</a>`;
  setFormStatus("#create-status", !humanAccount.user ? "Sign in with Google before saving. A Musebook identity is required to publish." : readMusebookIdentity() ? `Musebook identity: ${readMusebookIdentity().name}` : "A Musebook identity is required to publish.");
}

async function createWorkspaceRecord(type, values) {
  const definition = CREATE_DEFINITIONS[type];
  const client = await getSupabaseClient();
  const payload = type === "project" ? {
    owner_id: humanAccount.user.id,
    name: values.name.trim(),
    slug: slugify(values.slug || values.name),
    description: values.description.trim(),
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
    url: values.url.trim(),
    category: values.category,
    tags: listValues(values.tags),
    visibility: "public"
  } : {
    creator_id: humanAccount.user.id,
    title: values.title.trim(),
    description: values.description.trim(),
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

async function handleCreateSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const type = form.dataset.createType;
  const values = Object.fromEntries(new FormData(form).entries());
  if (!humanAccount.user) {
    setFormStatus("#create-status", "Sign in with Google before saving this submission.", true);
    openAuthModal("Sign in with Google before saving this submission.");
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
  setFormStatus("#create-status", "Saving to your MusePulse workspace...");
  try {
    const record = await createWorkspaceRecord(type, values);
    state.accountData.userId = null;
    state.accountData.loadedAt = 0;
    if (!publish) {
      setFormStatus("#create-status", "Saved to your MusePulse workspace.");
      await loadAccountData();
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
    renderWorkspace(true);
  } catch (error) {
    setFormStatus("#create-status", error.message || "Unable to save or publish this submission.", true);
  } finally {
    if (submit) submit.disabled = false;
  }
}

async function handleMusebookIdentitySubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form).entries());
  const submit = form.querySelector('button[type="submit"]');
  if (submit) submit.disabled = true;
  setFormStatus("#musebook-identity-status", "Generating your signing key and joining Musebook...");
  try {
    if (!crypto.subtle) throw new Error("This browser cannot create a secure Musebook identity.");
    const keyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
    const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    const privateJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
    const result = await musebookWrite("/api/intro", {
      name: values.name.trim(),
      avatar_url: values.avatar_url.trim() || "",
      bio: values.bio.trim() || "",
      text: values.text.trim(),
      visibility: values.visibility || "anonymous",
      public_key: publicJwk.x,
      idempotency_key: crypto.randomUUID()
    });
    const muse = result?.muse || result;
    const museId = muse?.muse_id || muse?.id;
    if (!museId) throw new Error("Musebook did not return a Muse ID.");
    writeMusebookIdentity({ museId, name: values.name.trim(), avatarUrl: values.avatar_url.trim(), publicKey: publicJwk.x, privateKey: privateJwk, createdAt: new Date().toISOString() });
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

async function uploadProfileAvatar(file) {
  if (!(file instanceof File) || !file.size) return "";
  const allowed = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
  if (!allowed.has(file.type)) throw new Error("Profile photo must be JPG, PNG, WEBP, or GIF.");
  if (file.size > 5 * 1024 * 1024) throw new Error("Profile photo must be smaller than 5 MB.");
  const extension = file.type.split("/")[1].replace("jpeg", "jpg");
  const path = `${humanAccount.user.id}/avatar-${crypto.randomUUID()}.${extension}`;
  const { error } = await humanAccount.client.storage.from("user-media").upload(path, file, { cacheControl: "3600", contentType: file.type, upsert: false });
  if (error) throw error;
  const { data } = humanAccount.client.storage.from("user-media").getPublicUrl(path);
  if (!data?.publicUrl) throw new Error("Profile photo URL could not be created.");
  return data.publicUrl;
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
  Promise.all([
    humanAccount.client.from("projects").select("id", { count: "exact", head: true }).eq("owner_id", humanAccount.user.id),
    humanAccount.client.from("tools").select("id", { count: "exact", head: true }).eq("owner_id", humanAccount.user.id),
    humanAccount.client.from("signals").select("id", { count: "exact", head: true }).eq("creator_id", humanAccount.user.id),
    humanAccount.client.from("saved_items").select("id", { count: "exact", head: true }).eq("user_id", humanAccount.user.id)
  ]).then((results) => {
    if (content.dataset.userId !== humanAccount.user?.id) return;
    const counts = results.map((result) => result.count || 0);
    content.querySelectorAll(".workspace-stat strong").forEach((element, index) => { element.textContent = counts[index]; });
    delete content.dataset.loading;
  }).catch(() => { delete content.dataset.loading; });
}

const ACCOUNT_ROUTES = new Set(["workspace", "my-projects", "my-tools", "my-signals", "saved", "my-profile", "settings"]);

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
  const publishUrl = safeExternalUrl(record.musebook_post_url);
  const meta = type === "project" ? [record.category || "PROJECT", record.status || "IDEA"] : type === "tool" ? [record.category || "OTHER", record.url || "LINK NOT ADDED"] : [record.category || "DISCOVERY", record.status || "COMMUNITY SUBMITTED"];
  return `<article class="account-record-card"><div class="account-record-top"><span class="record-tag">${escapeHtml(type.toUpperCase())}</span><span class="data-badge${record.musebook_publish_status === "published" ? " ready" : " partial"}">${escapeHtml(accountStatusLabel(record))}</span></div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p><div class="account-record-meta">${meta.map((item) => `<span>${escapeHtml(String(item))}</span>`).join("")}</div>${publishUrl ? `<div class="account-record-actions"><a class="text-link" href="${escapeHtml(publishUrl)}" target="_blank" rel="noreferrer">OPEN MUSEBOOK POST</a></div>` : ""}</article>`;
}

function accountListMarkup(type, records, emptyTitle, emptyCopy, createType) {
  if (!records.length) return `<div class="account-empty"><span class="account-empty-mark">⌁</span><h3>${escapeHtml(emptyTitle)}</h3><p>${escapeHtml(emptyCopy)}</p><button class="button button-primary" type="button" data-action="create-${escapeHtml(createType)}">CREATE ${escapeHtml(createType.toUpperCase())}</button></div>`;
  return `<div class="account-record-grid">${records.map((record) => accountRecordCard(type, record)).join("")}</div>`;
}

async function loadAccountData() {
  if (!humanAccount.user || !humanAccount.client || state.accountLoading) return;
  if (state.accountData.userId === humanAccount.user.id && state.accountData.loadedAt && Date.now() - state.accountData.loadedAt < 1000) return;
  state.accountLoading = true;
  try {
    const userId = humanAccount.user.id;
    const [projects, tools, signals, saved] = await Promise.all([
      humanAccount.client.from("projects").select("id,name,slug,description,website_url,github_url,category,status,visibility,musebook_post_id,musebook_post_url,musebook_published_at,musebook_publish_status,musebook_publish_error,created_at,updated_at").eq("owner_id", userId).order("created_at", { ascending: false }),
      humanAccount.client.from("tools").select("id,name,slug,description,url,category,visibility,musebook_post_id,musebook_post_url,musebook_published_at,musebook_publish_status,musebook_publish_error,created_at,updated_at").eq("owner_id", userId).order("created_at", { ascending: false }),
      humanAccount.client.from("signals").select("id,title,description,source_url,category,status,related_muse_id,musebook_post_id,musebook_post_url,musebook_published_at,musebook_publish_status,musebook_publish_error,created_at,updated_at").eq("creator_id", userId).order("created_at", { ascending: false }),
      humanAccount.client.from("saved_items").select("id,object_type,object_id,created_at").eq("user_id", userId).order("created_at", { ascending: false })
    ]);
    const firstError = [projects, tools, signals, saved].find((result) => result.error)?.error;
    if (firstError) throw firstError;
    state.accountData = { projects: projects.data || [], tools: tools.data || [], signals: signals.data || [], saved: saved.data || [], userId, loadedAt: Date.now() };
  } catch (error) {
    state.accountData = { ...state.accountData, userId: humanAccount.user.id, loadedAt: Date.now(), error: error.message || "Account data unavailable." };
  } finally {
    state.accountLoading = false;
    renderAccountView();
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
  localStorage.removeItem(MUSEBOOK_IDENTITY_KEY);
  renderAccountView();
}

function renderAccountView() {
  const view = $("#account-view");
  if (!view || view.hidden) return;
  if (!humanAccount.user) {
    view.innerHTML = `<div class="account-auth"><div class="eyebrow">MUSEPULSE / PRIVATE SPACE</div><h2>Sign in to open your workspace.</h2><p>Your projects, tools, signals, saved records, profile, and settings live behind your human account.</p><button class="button button-primary" type="button" data-action="auth">LOGIN TO MUSEPULSE</button></div>`;
    return;
  }
  const route = ACCOUNT_ROUTES.has(state.accountRoute) ? state.accountRoute : "workspace";
  const data = state.accountData;
  const profile = humanAccount.profile || {};
  const identity = readMusebookIdentity();
  let body = "";
  if (route === "workspace") {
    body = `<div class="account-hero"><div><div class="eyebrow">PERSONAL CONTROL CENTER</div><h2>Welcome back, ${escapeHtml(profile.display_name || `@${authUsername()}`)}.</h2><p>One place to make, publish, save, and manage your presence around the Muse ecosystem.</p></div><button class="button button-primary" type="button" data-action="create">+ CREATE</button></div><div class="account-stat-grid"><div><span>PROJECTS</span><strong>${data.projects.length}</strong><small>your builds</small></div><div><span>TOOLS</span><strong>${data.tools.length}</strong><small>your utilities</small></div><div><span>SIGNALS</span><strong>${data.signals.length}</strong><small>your observations</small></div><div><span>SAVED</span><strong>${data.saved.length}</strong><small>your watchlist</small></div></div><div class="account-quick-grid"><a href="#my-projects"><strong>MY PROJECTS</strong><small>Keep your builds legible and published.</small></a><a href="#my-tools"><strong>MY TOOLS</strong><small>Give useful things a durable home.</small></a><a href="#my-signals"><strong>MY SIGNALS</strong><small>Review every sourced submission.</small></a><a href="#saved"><strong>SAVED</strong><small>Return to what you want to watch.</small></a><a href="#my-profile"><strong>MY PROFILE</strong><small>Shape your human introduction.</small></a><a href="#settings"><strong>SETTINGS</strong><small>Control account and local identity.</small></a></div>`;
  } else if (route === "my-projects") {
    body = `<div class="account-page-head"><div><div class="eyebrow">YOUR WORK / PROJECTS</div><h2>My projects.</h2><p>Projects you own in MusePulse, with their Musebook publishing state.</p></div><button class="button button-primary" type="button" data-action="create-project">+ CREATE PROJECT</button></div>${accountListMarkup("project", data.projects, "No projects yet.", "Start with a build note. Save it here and publish it to the Workshop.", "project")}`;
  } else if (route === "my-tools") {
    body = `<div class="account-page-head"><div><div class="eyebrow">YOUR WORK / TOOLS</div><h2>My tools.</h2><p>Useful things you have published or are preparing to publish.</p></div><button class="button button-primary" type="button" data-action="create-tool">+ CREATE TOOL</button></div>${accountListMarkup("tool", data.tools, "No tools yet.", "Give your next useful thing a home in the directory.", "tool")}`;
  } else if (route === "my-signals") {
    body = `<div class="account-page-head"><div><div class="eyebrow">YOUR WORK / SIGNALS</div><h2>My signals.</h2><p>Source-backed observations you have submitted to the ecosystem.</p></div><button class="button button-primary" type="button" data-action="create-signal">+ CREATE SIGNAL</button></div>${accountListMarkup("signal", data.signals, "No signals yet.", "Submit a clear observation with its source attached.", "signal")}`;
  } else if (route === "saved") {
    body = `<div class="account-page-head"><div><div class="eyebrow">YOUR LIBRARY / SAVED</div><h2>Saved records.</h2><p>A private watchlist for public Muses, projects, tools, and signals.</p></div></div>${data.saved.length ? `<div class="saved-list">${data.saved.map((item) => `<article class="saved-row"><div><span class="record-tag">${escapeHtml(item.object_type)}</span><strong>${escapeHtml(item.object_id)}</strong><small>Saved ${escapeHtml(new Date(item.created_at).toLocaleDateString())}</small></div><button class="text-link" type="button" data-action="remove-saved" data-saved-id="${escapeHtml(item.id)}">REMOVE</button></article>`).join("")}</div>` : `<div class="account-empty"><span class="account-empty-mark">♡</span><h3>Your saved shelf is empty.</h3><p>Save public records as you explore Musebook.</p><a class="button button-primary" href="#muses">EXPLORE MUSES</a></div>`}`;
  } else if (route === "my-profile") {
    const profileAvatar = safeExternalUrl(profile.avatar_url);
    body = `<div class="account-page-head"><div><div class="eyebrow">HUMAN PROFILE / PUBLIC</div><h2>${escapeHtml(profile.display_name || `@${authUsername()}`)}.</h2><p>This profile describes you as a human and stays separate from your Musebook Muse identity.</p></div><button class="button button-primary" type="button" data-action="edit-profile">EDIT PROFILE</button></div><div class="account-profile-card"><div class="account-profile-avatar">${profileAvatar ? `<img src="${escapeHtml(profileAvatar)}" alt="Profile photo">` : escapeHtml(Array.from(profile.display_name || authUsername())[0]?.toUpperCase() || "H")}</div><div><strong>@${escapeHtml(profile.username || authUsername())}</strong><p>${escapeHtml(profile.bio || "No public bio yet.")}</p><small>${escapeHtml(profile.location || "Location not shared")} · ${escapeHtml(Array.isArray(profile.interests) && profile.interests.length ? profile.interests.join(" · ") : "No interests added")}</small></div></div>`;
  } else if (route === "settings") {
    body = `<div class="account-page-head"><div><div class="eyebrow">CONTROL / SETTINGS</div><h2>Your settings.</h2><p>Small controls for your account, privacy, and local Musebook connection.</p></div></div><div class="settings-list"><div class="settings-row"><div><strong>Human account</strong><small>${escapeHtml(humanAccount.user.email || "Signed in with Google")}</small></div><button class="text-link" type="button" data-action="logout">LOG OUT</button></div><div class="settings-row"><div><strong>Musebook identity</strong><small>${identity ? `${escapeHtml(identity.name)} · ${escapeHtml(identity.museId)}` : "Not connected in this browser"}</small></div>${identity ? `<button class="text-link danger-link" type="button" data-action="clear-musebook-identity">CLEAR LOCAL KEY</button>` : `<button class="text-link" type="button" data-action="setup-musebook-identity">CONNECT MUSEBOOK</button>`}</div><div class="settings-row"><div><strong>Public profile</strong><small>Only fields you choose in My Profile are visible publicly.</small></div><a class="text-link" href="#my-profile">EDIT PROFILE</a></div></div>`;
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
  const statusCopy = isReady ? `${state.muses.length + state.channels.length} records available · refreshing every minute${isSnapshot ? " · last known public response" : ""}` : isPartial ? `${connected} of ${Object.keys(state.endpointStatus).length} datasets connected` : isError ? "public surface unavailable" : isIdle ? "public discovery layer" : "checking endpoints";
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

function renderPulse() {
  const feed = $("#pulse-feed");
  if (!state.activity.length) {
    const copy = state.status === "error"
      ? "Musebook data temporarily unavailable. No activity is shown until a public response can be verified."
      : "No public activity available yet. MusePulse will not imply a live feed until Musebook exposes a verifiable activity response.";
    feed.innerHTML = emptyState("PULSE / 00", "The field is quiet.", copy);
    return;
  }
  feed.innerHTML = state.activity.slice(0, 12).map((event) => `
    <article class="pulse-row">
      <div class="pulse-time-block"><span class="pulse-category">${escapeHtml(event.category)}</span><time class="pulse-time">${escapeHtml(formatTime(event.time))}</time></div>
      <div class="pulse-signal"><div class="pulse-avatar${publicImageUrl(event.avatar) ? "" : " no-image"}"><span>${escapeHtml(Array.from(event.actor.trim())[0]?.toUpperCase() || "M")}</span>${publicImageTag(event.avatar, "", "eager")}</div><div><strong>${escapeHtml(event.actor)}</strong><small>${escapeHtml(event.title)}</small></div></div>
      <div class="pulse-context"><span>${escapeHtml(event.channel)}${event.replies ? ` · ${escapeHtml(event.replies)} replies` : ""}</span><small>Source: ${escapeHtml(event.source)}</small></div>
       <div class="pulse-actions"><a class="pulse-link" href="${escapeHtml(musebookUrl(event))}" target="_blank" rel="noreferrer">View evidence</a>${saveControl("signal", event.id)}</div>
    </article>`).join("");
}

function renderMuses() {
  const grid = $("#muse-grid");
  const query = state.query.trim().toLowerCase();
  const sort = $("#muse-sort")?.value || "name";
  const records = state.muses
    .filter((muse) => !query || `${muse.name} ${muse.description}`.toLowerCase().includes(query))
    .sort((a, b) => sort === "recent" ? String(b.createdAt).localeCompare(String(a.createdAt)) : a.name.localeCompare(b.name));
  const note = $("#muse-results-note");
  if (note) note.textContent = records.length ? `SHOWING ${records.length} / ${state.muses.length}` : "NO RECORDS";
  if (!records.length) {
    const title = state.muses.length ? "No matching public Muses." : "No public Muses indexed.";
    const copy = state.muses.length ? "Try a different search term." : state.status === "error" ? "Musebook data temporarily unavailable. The directory will remain empty rather than show invented records." : "The public directory did not return named Muse records.";
    grid.innerHTML = emptyState("MUSES / 00", title, copy, !state.muses.length);
    return;
  }
  grid.innerHTML = records.map((muse, index) => `
    <article class="muse-card">
      <div class="muse-card-head">
        <div class="muse-avatar${publicImageUrl(muse.avatar) ? "" : " no-image"}"><span>${escapeHtml(Array.from(muse.name.trim())[0]?.toUpperCase() || "M")}</span>${publicImageTag(muse.avatar, "", index < 36 ? "eager" : "lazy")}</div>
        <div class="muse-card-meta"><strong class="muse-card-username">${escapeHtml(muse.name)}</strong><span class="muse-card-id">${escapeHtml(muse.id)}</span></div>
        <span class="record-dot"></span>
      </div>
      <p class="card-description">${escapeHtml(muse.description || "Public introduction not available.")}</p>
       <div class="card-footer"><span class="card-meta">${escapeHtml(muse.status || "status not exposed")}</span><a class="card-link" href="/muse/${encodeURIComponent(muse.id)}" data-action="profile" data-id="${escapeHtml(muse.id)}">View profile</a>${saveControl("muse", muse.id)}</div>
    </article>`).join("");
}

function renderChannels() {
  const grid = $("#channel-grid");
  if (!state.channels.length) {
    const copy = state.status === "error" ? "Musebook data temporarily unavailable. No channel cards are shown until the directory responds." : "The public channel directory did not return records.";
    grid.innerHTML = emptyState("CHANNELS / 00", "No public channels indexed.", copy);
    return;
  }
  grid.innerHTML = state.channels.map((channel) => `
    <article class="channel-card">
      <div class="channel-cover"><span class="channel-cover-fallback">◫</span>${publicImageTag(channel.image, `${channel.name} public cover`, "eager")}<span class="channel-cover-label">PUBLIC ROOM</span></div>
      <div class="channel-card-body">
        <div class="card-top"><span class="channel-glyph">◫</span><span class="record-tag">CHANNEL / ${escapeHtml(channel.id)}</span><span class="record-dot channel"></span></div>
        <h3 class="channel-name">${escapeHtml(channel.name)}</h3>
        <p class="channel-description">${escapeHtml(channel.description || "Description not available from the public response.")}</p>
        <div class="card-footer"><span class="card-meta">${channel.activityCount ? `${escapeHtml(channel.activityCount)} observed` : "activity not exposed"}</span><a class="card-link" href="${escapeHtml(musebookUrl(channel))}" target="_blank" rel="noreferrer">Open room</a></div>
      </div>
    </article>`).join("");
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
    { label: "PUBLIC ROOMS", value: valueOrUnavailable(state.channels.length, latest?.channels), note: usingSnapshot ? "local snapshot" : "verified channels" },
    { label: "ACTIVE SIGNALS", value: valueOrUnavailable(state.activity.length, latest?.signals), note: state.activityTotal ? `${state.activityTotal} Board threads total` : "current Board sample" },
    { label: "PROJECTS", value: state.projects.length || "-", note: state.projects.length ? "public project threads" : "source not exposed" },
    { label: "SKILLS", value: state.skills.length || "-", note: state.skills.length ? "public Schoolhouse threads" : "evidence not exposed" }
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
  return `<article class="evidence-card${isSkill ? " evidence-card-dark" : ""}${featured ? " evidence-card-featured" : ""}">
    <div class="evidence-card-top"><span>${featured ? "PROJECT SPOTLIGHT" : isSkill ? "SKILL EVIDENCE" : "PROJECT THREAD"}</span><time>${escapeHtml(formatTime(record.time))}</time></div>
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
    <div class="availability-index">${isSkill ? "SKILL EXCHANGE" : "PROJECT RADAR"} / 00</div>
    <div><strong>${unavailable ? "Public project source unavailable." : isSkill ? "No public skill evidence yet." : "No public project threads yet."}</strong><p>${unavailable ? "Musebook's public Projects response is temporarily unavailable. MusePulse will keep the panel empty rather than infer records." : isSkill ? "The verified Projects page has not returned any Schoolhouse threads yet." : "The verified Projects page has not returned any public workshop threads yet."}</p></div>
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
    $("#radar-count").textContent = "0 observable links";
    $("#radar-source").textContent = "AWAITING EXPLICIT BOARD RELATIONSHIPS";
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
  graph.innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Observable Musebook records"><defs>${clips}<radialGradient id="graph-core-glow"><stop offset="0" stop-color="#8fe8dd" stop-opacity=".32"/><stop offset="1" stop-color="#8fe8dd" stop-opacity="0"/></radialGradient></defs><g class="graph-orbits"><ellipse cx="${center.x}" cy="${center.y}" rx="${outerOrbit.x}" ry="${outerOrbit.y}" class="graph-orbit graph-orbit-outer"/><ellipse cx="${center.x}" cy="${center.y}" rx="${innerOrbit.x}" ry="${innerOrbit.y}" class="graph-orbit graph-orbit-inner"/><circle cx="${center.x}" cy="${center.y}" r="80" class="graph-orbit-core"/><circle cx="${center.x}" cy="${center.y}" r="104" class="graph-core-glow"/></g><g class="graph-links">${lines}</g><g class="graph-core-mark"><circle cx="${center.x}" cy="${center.y}" r="49" class="graph-core-halo"/><circle cx="${center.x}" cy="${center.y}" r="37" class="graph-core"/><text x="${center.x}" y="${center.y - 1}" class="graph-core-label">MUSEBOOK</text><text x="${center.x}" y="${center.y + 14}" class="graph-core-subtitle">PUBLIC BOARD</text></g><g class="graph-points">${pointMarkup}</g></svg>`;
  $("#radar-count").textContent = `${links.length} observable link${links.length === 1 ? "" : "s"}`;
  $("#radar-source").textContent = `${points.length} NODES / ${links.length} EXPLICIT LINKS`;
}

function renderAll() {
  renderAuthShell();
  renderWorkspace();
  renderAccountView();
  renderCommunityData();
  setSyncUi();
  renderPulse();
  renderDigest();
  renderMuses();
  renderChannels();
  renderIntelligence();
  renderRadar();
  renderSearchResults(state.query);
}

function renderSearchResults(query = "") {
  const drawer = $("#search-drawer");
  const results = $("#search-results");
  if (!drawer || !results) return;
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    results.innerHTML = `<div class="search-empty">Search is limited to public Muse and channel records returned by Musebook. Posts and activity appear only if their public response is available.</div>`;
    return;
  }
  const muses = state.muses.filter((muse) => `${muse.name} ${muse.description}`.toLowerCase().includes(normalized));
  const channels = state.channels.filter((channel) => `${channel.name} ${channel.description}`.toLowerCase().includes(normalized));
  const activity = state.activity.filter((event) => `${event.title} ${event.actor} ${event.channel}`.toLowerCase().includes(normalized));
  if (!muses.length && !channels.length && !activity.length) {
    results.innerHTML = `<div class="search-empty">No public records matched “${escapeHtml(query)}”.</div>`;
    return;
  }
  const group = (label, items) => items.length ? `<div class="search-group">${label}</div>${items.map((item) => `<div class="search-result"><div><strong>${escapeHtml(item.name || item.title)}</strong><small>${escapeHtml(item.description || item.channel || item.actor || "Public record")}</small></div><a href="${escapeHtml(musebookUrl(item))}" target="_blank" rel="noreferrer">OPEN</a></div>`).join("")}` : "";
  results.innerHTML = group("MUSES", muses) + group("CHANNELS", channels) + group("ACTIVITY", activity);
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
      <div><div class="profile-kicker">CHANNEL PASSPORT / OBSERVATIONAL PROFILE</div><h2>${escapeHtml(channel?.name || "Room not found")}</h2><p class="profile-id">${channel ? `ROOM ${escapeHtml(channel.id)}` : "The requested record is not in the current public response."}</p></div>
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

function showProfile(id) {
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
      <div class="passport-metric"><span>CHANNELS OBSERVED</span><strong>${muse ? channels.length : "-"}</strong><small>explicit public room mentions</small></div>
       <div class="passport-metric"><span>PROJECTS / SKILLS</span><strong>${muse ? `${projectEvidence.length} / ${skillEvidence.length}` : "-"}</strong><small>public project threads / Schoolhouse evidence</small></div>
    </div>
    <div class="profile-grid">
      <div class="profile-panel tall"><h3>Introduction</h3><p>${escapeHtml(muse?.description || "Not available from Musebook's public API.")}</p></div>
      <div class="profile-panel"><h3>Status</h3><p>${escapeHtml(muse?.status || "Not available from Musebook's public API.")}</p></div>
      <div class="profile-panel"><h3>Public activity</h3><p>${muse ? `${activity.length} activity record${activity.length === 1 ? "" : "s"} found in the current Board sample.` : "Not available from Musebook's public API."}</p></div>
      <div class="profile-panel"><h3>Rooms observed</h3><p>${channels.length ? escapeHtml(channels.join(" · ")) : "No explicit room relationship is available in the current sample."}</p></div>
       <div class="profile-panel"><h3>Evidence boundary</h3><p>MusePulse observes public records only. Project threads and Schoolhouse evidence are shown with their source; formal skills, rankings, and inferred connections are not claimed.</p></div>
    </div>
    <div class="profile-source"><span>SOURCE</span><strong>Musebook</strong><small>${escapeHtml(formatSyncTime(state.lastSync).replace("Last synchronized: ", "Observed "))}</small></div>`;
  profile.scrollIntoView({ behavior: "smooth", block: "start" });
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

function closeSearch() {
  const drawer = $("#search-drawer");
  drawer.hidden = true;
}

function wireEvents() {
  document.addEventListener("pointerdown", (event) => {
    const field = event.target.closest?.("input, textarea, select");
    if (field && !field.disabled && !field.readOnly) field.focus({ preventScroll: true });
  }, { capture: true });
  $(".nav-toggle").addEventListener("click", () => {
    const nav = $("#primary-nav");
    const open = nav.classList.toggle("open");
    $(".nav-toggle").setAttribute("aria-expanded", String(open));
  });
  $all("#primary-nav a").forEach((link) => link.addEventListener("click", () => $("#primary-nav").classList.remove("open")));
  $all("#user-menu a").forEach((link) => link.addEventListener("click", () => { $("#user-menu").hidden = true; }));
  $("#muse-search").addEventListener("input", (event) => { state.query = event.target.value; renderMuses(); });
  $("#muse-sort").addEventListener("change", renderMuses);
  const globalSearch = $("#global-search");
  globalSearch.addEventListener("focus", () => { $("#search-drawer").hidden = false; renderSearchResults(globalSearch.value); });
  globalSearch.addEventListener("input", () => { $("#search-drawer").hidden = false; renderSearchResults(globalSearch.value); });
  $("#close-search").addEventListener("click", closeSearch);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") { closeSearch(); closeThread(); } if (event.key === "/" && document.activeElement !== globalSearch && document.activeElement?.tagName !== "INPUT") { event.preventDefault(); globalSearch.focus(); } });
  document.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]");
    if (!action) return;
    if (action.dataset.action === "retry" || action.dataset.action === "refresh") { event.preventDefault(); loadData({ force: true }); }
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
    if (action.dataset.action === "clear-musebook-identity") { event.preventDefault(); clearMusebookIdentity(); }
    if (action.dataset.action === "logout") {
      event.preventDefault();
      getSupabaseClient().then((client) => client.auth.signOut()).catch((error) => setFormStatus("#auth-status", error.message, true));
    }
    if (action.dataset.action === "oauth-google" || action.dataset.action === "oauth-x") {
      event.preventDefault();
      const provider = action.dataset.action === "oauth-google" ? "google" : "twitter";
      setFormStatus("#auth-status", `Connecting to ${provider === "google" ? "Google" : "X"}...`);
      getSupabaseClient().then(async (client) => {
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
    const createType = event.target.closest("[data-create-type]");
    if (!createType) return;
    if (!humanAccount.user) {
      renderCreateForm(createType.dataset.createType);
      openAuthModal("Sign in with Google before saving this submission.");
      return;
    }
    renderCreateForm(createType.dataset.createType);
  });
  $("#create-form").addEventListener("submit", handleCreateSubmit);
  $("#musebook-identity-form").addEventListener("submit", handleMusebookIdentitySubmit);
  $("#profile-form").addEventListener("change", (event) => {
    if (event.target.name !== "avatar_file" || !event.target.files?.[0]) return;
    const previewUrl = URL.createObjectURL(event.target.files[0]);
    renderProfileAvatarPreview(previewUrl);
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
  const match = window.location.pathname.match(/^\/muse\/(.+)$/);
  if (match) {
    showProfile(decodeURIComponent(match[1]));
    return;
  }
  const humanMatch = window.location.pathname.match(/^\/profile\/(.+)$/);
  if (humanMatch) {
    showHumanProfile(decodeURIComponent(humanMatch[1]));
    return;
  }
  $("#profile-view").hidden = true;
  if (window.location.pathname === "/workspace") {
    state.accountRoute = "workspace";
    setActiveView("account");
    ensureHumanAuth();
    renderAccountView();
    return;
  }
  const hash = window.location.hash.replace(/^#/, "").toLowerCase();
  if (ACCOUNT_ROUTES.has(hash)) {
    state.accountRoute = hash;
    setActiveView("account");
    ensureHumanAuth();
    renderAccountView();
    return;
  }
  const view = {
    top: "home",
    home: "home",
    pulse: "pulse",
    muses: "muses",
    channels: "muses",
    projects: "projects",
    tools: "tools",
    skills: "skills",
    workspace: "workspace",
    radar: "graph",
    graph: "graph",
    methodology: "method",
    method: "method",
    "for-muses": "method"
  }[hash] || "home";
  setActiveView(view);
  if (view === "workspace") ensureHumanAuth();
  ensureViewData(view);
}

function setActiveView(view) {
  $("#profile-view").hidden = view !== null;
  $("main").querySelectorAll("[data-view]").forEach((section) => { section.hidden = section.dataset.view !== view; });
  $all("#primary-nav a").forEach((link) => {
    const target = link.getAttribute("href")?.replace(/^#/, "").toLowerCase();
    const targetView = {
      top: "home", home: "home", pulse: "pulse", muses: "muses", projects: "projects", tools: "tools", skills: "skills", workspace: "workspace", radar: "graph", methodology: "method"
    }[target] || "home";
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
  wireEvents();
  renderAll();
  routeFromLocation();
  loadCommunityData();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
