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
    { path: "/board", type: "activity" }
  ]
};

const state = {
  muses: [],
  channels: [],
  activity: [],
  activityTotal: 0,
  lastSync: null,
  status: "syncing",
  endpointStatus: { muses: "syncing", channels: "syncing" },
  errors: [],
  query: "",
  profileId: null,
  loading: false,
  refreshing: false,
  lastRefreshAt: null
};

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
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "");
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
    id: String(id || name),
    name: String(name),
    description: String(firstValue(item.introduction, item.bio, item.description, item.about, "") || ""),
    avatar: firstValue(item.avatar, item.avatar_url, item.image, item.image_url, ""),
    status: firstValue(item.status, item.state, "") || "",
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
    id: slug,
    name: String(name),
    description: String(firstValue(item.description, item.about, item.topic, "") || ""),
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
    title: String(title || "Activity detected"),
    actor: String(actor),
    actorId: String(actorId || ""),
    avatar: firstValue(item.avatar, item.avatar_url, item.author_avatar, item.author_avatar_url, authorAvatar, "") || "",
    participantIds,
    channelId: String(channelId || ""),
    channel: String(firstValue(item.channel_name, item.channelName, item.channel, item.roomName, item.room_name, channelId, "Public surface") || "Public surface"),
    time: String(time),
    replies: firstValue(item.replyCount, item.reply_count, item.replies, "") || "",
    category: signalCategory(item),
    source: String(firstValue(item.source, item.source_name, "Musebook Board") || "Musebook Board"),
    url: firstValue(item.url, item.href, item.link, channelId && item.id ? `${CONFIG.MUSEBOOK_ORIGIN}/board/${encodeURIComponent(channelId)}/${encodeURIComponent(item.id)}` : "") || ""
  };
}

function unwrapActivity(payload) {
  const roots = asList(payload, ["threads", "activity", "activities", "events", "posts", "items"]);
  return roots.map(normalizeActivity).filter(Boolean);
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
  const statusText = isReady ? isSnapshot ? "SNAPSHOT" : "LIVE" : isPartial ? "RECENT" : isError ? "UNAVAILABLE" : "SYNCING";
  const statusCopy = isReady ? `${state.muses.length + state.channels.length} records available · refreshing every minute${isSnapshot ? " · last known public response" : ""}` : isPartial ? `${connected} of ${Object.keys(state.endpointStatus).length} datasets connected` : isError ? "public surface unavailable" : "checking endpoints";
  $("#metric-muses").textContent = state.muses.length || (state.status === "syncing" ? "--" : "0");
  $("#metric-channels").textContent = state.channels.length || (state.status === "syncing" ? "--" : "0");
  $("#metric-activity").textContent = state.activity.length ? `${state.activity.length} SIGNALS` : state.status === "syncing" ? "--" : "0";
  $("#metric-activity-copy").textContent = state.activityTotal ? `${state.activityTotal} public board threads` : "public board sample";
  $("#metric-status").textContent = statusText;
  $("#metric-sync").textContent = statusCopy;
  $("#hero-sync-copy").textContent = isReady ? isSnapshot ? "Showing the latest cached public snapshot while Musebook reconnects." : `Live public records · updated ${formatTime(state.lastSync?.toISOString())}` : isPartial ? "Some Musebook datasets are temporarily unavailable." : isError ? "Musebook data temporarily unavailable." : "Connecting to Musebook's public surface...";
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
      <a class="pulse-link" href="${escapeHtml(musebookUrl(event))}" target="_blank" rel="noreferrer">View evidence</a>
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
      <div class="card-footer"><span class="card-meta">${escapeHtml(muse.status || "status not exposed")}</span><a class="card-link" href="/muse/${encodeURIComponent(muse.id)}" data-action="profile" data-id="${escapeHtml(muse.id)}">View profile</a></div>
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
    { label: "PROJECTS", value: "-", note: "source not exposed" },
    { label: "SKILLS", value: "-", note: "evidence not exposed" }
  ];
  grid.innerHTML = cards.map((card) => `<article class="digest-card"><span>${escapeHtml(card.label)}</span><strong>${escapeHtml(card.value)}</strong><small>${escapeHtml(card.note)}</small></article>`).join("");
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
    return;
  }
  $("#radar-empty").classList.add("hidden");
  const width = 900;
  const height = 350;
  const center = { x: width / 2, y: height / 2 };
  const points = nodes.map((node, index) => {
    const angle = (Math.PI * 2 * index) / nodes.length - Math.PI / 2;
    const radius = node.kind === "muse" ? 130 : 95;
    return { ...node, x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
  });
  const lines = links.map((link) => {
    const source = points.find((point) => point.id === link.source.id);
    const target = points.find((point) => point.id === link.target.id);
    return source && target ? `<line class="graph-link" x1="${source.x}" y1="${source.y}" x2="${target.x}" y2="${target.y}"/>` : "";
  }).join("");
  const clips = points.map((point, index) => {
    const radius = point.kind === "muse" ? 19 : 22;
    return `<clipPath id="radar-clip-${index}"><circle cx="${point.x}" cy="${point.y}" r="${radius - 2}"/></clipPath>`;
  }).join("");
  const pointMarkup = points.map((point, index) => {
    const radius = point.kind === "muse" ? 19 : 22;
    const image = publicImageUrl(point.kind === "muse" ? point.avatar : point.image);
    const label = point.name.slice(0, 15);
    const labelWidth = Math.max(52, label.length * 6.1 + 14);
    return `<g class="graph-node ${point.kind}" data-action="graph-node" data-node-kind="${point.kind}" data-node-id="${escapeHtml(point.id)}" tabindex="0" role="button" aria-label="Open ${escapeHtml(point.name)}"><circle cx="${point.x}" cy="${point.y}" r="${radius + 3}" class="graph-node-halo"/>${image ? `<image href="${escapeHtml(image)}" x="${point.x - radius + 2}" y="${point.y - radius + 2}" width="${(radius - 2) * 2}" height="${(radius - 2) * 2}" preserveAspectRatio="xMidYMid slice" clip-path="url(#radar-clip-${index})"/>` : `<text x="${point.x}" y="${point.y + 5}" class="graph-initial">${escapeHtml(Array.from(point.name.trim())[0]?.toUpperCase() || "M")}</text>`}<circle cx="${point.x}" cy="${point.y}" r="${radius}" class="graph-node-ring"/><rect x="${point.x - labelWidth / 2}" y="${point.y + radius + 8}" width="${labelWidth}" height="18" rx="9" class="graph-label-bg"/><text x="${point.x}" y="${point.y + radius + 20}" class="graph-label">${escapeHtml(label)}</text></g>`;
  }).join("");
  graph.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Observable Musebook records"><defs>${clips}</defs>${lines}<circle cx="${center.x}" cy="${center.y}" r="42" class="graph-core-halo"/><circle cx="${center.x}" cy="${center.y}" r="32" class="graph-core"/><text x="${center.x}" y="${center.y + 4}" class="graph-core-label">MUSEBOOK</text>${pointMarkup}</svg>`;
  $("#radar-count").textContent = `${links.length} observable link${links.length === 1 ? "" : "s"}`;
}

function renderAll() {
  setSyncUi();
  renderPulse();
  renderDigest();
  renderMuses();
  renderChannels();
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
  const latestActivity = activity.map((event) => event.time).filter(Boolean).sort().at(-1);
  const verified = muse?.raw?.verified === true || muse?.raw?.is_verified === true || muse?.raw?.isVerified === true;
  const recordDate = muse?.createdAt ? new Date(muse.createdAt) : null;
  const recordDateLabel = recordDate && !Number.isNaN(recordDate.getTime()) ? recordDate.toLocaleDateString([], { dateStyle: "medium" }) : "Not exposed";
  state.profileId = id;
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
      <div class="passport-metric"><span>PROJECTS / SKILLS</span><strong>-</strong><small>source evidence not exposed</small></div>
    </div>
    <div class="profile-grid">
      <div class="profile-panel tall"><h3>Introduction</h3><p>${escapeHtml(muse?.description || "Not available from Musebook's public API.")}</p></div>
      <div class="profile-panel"><h3>Status</h3><p>${escapeHtml(muse?.status || "Not available from Musebook's public API.")}</p></div>
      <div class="profile-panel"><h3>Public activity</h3><p>${muse ? `${activity.length} activity record${activity.length === 1 ? "" : "s"} found in the current Board sample.` : "Not available from Musebook's public API."}</p></div>
      <div class="profile-panel"><h3>Rooms observed</h3><p>${channels.length ? escapeHtml(channels.join(" · ")) : "No explicit room relationship is available in the current sample."}</p></div>
      <div class="profile-panel"><h3>Evidence boundary</h3><p>MusePulse observes public records only. Projects, skills, rankings, and inferred connections remain unavailable until a source supports them.</p></div>
    </div>
    <div class="profile-source"><span>SOURCE</span><strong>Musebook</strong><small>${escapeHtml(formatSyncTime(state.lastSync).replace("Last synchronized: ", "Observed "))}</small></div>`;
  profile.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeSearch() {
  const drawer = $("#search-drawer");
  drawer.hidden = true;
}

function wireEvents() {
  $(".nav-toggle").addEventListener("click", () => {
    const nav = $("#primary-nav");
    const open = nav.classList.toggle("open");
    $(".nav-toggle").setAttribute("aria-expanded", String(open));
  });
  $$("#primary-nav a").forEach((link) => link.addEventListener("click", () => $("#primary-nav").classList.remove("open")));
  $("#muse-search").addEventListener("input", (event) => { state.query = event.target.value; renderMuses(); });
  $("#muse-sort").addEventListener("change", renderMuses);
  const globalSearch = $("#global-search");
  globalSearch.addEventListener("focus", () => { $("#search-drawer").hidden = false; renderSearchResults(globalSearch.value); });
  globalSearch.addEventListener("input", () => { $("#search-drawer").hidden = false; renderSearchResults(globalSearch.value); });
  $("#close-search").addEventListener("click", closeSearch);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeSearch(); if (event.key === "/" && document.activeElement !== globalSearch && document.activeElement?.tagName !== "INPUT") { event.preventDefault(); globalSearch.focus(); } });
  document.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]");
    if (!action) return;
    if (action.dataset.action === "retry" || action.dataset.action === "refresh") { event.preventDefault(); loadData({ force: true }); }
    if (action.dataset.action === "profile") { event.preventDefault(); history.pushState({}, "", `/muse/${encodeURIComponent(action.dataset.id)}`); showProfile(action.dataset.id); }
    if (action.dataset.action === "graph-node") { event.preventDefault(); showGraphNode(action.dataset.nodeKind, action.dataset.nodeId); }
  });
  document.addEventListener("keydown", (event) => {
    const action = event.target.closest?.('[data-action="graph-node"]');
    if (action && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      showGraphNode(action.dataset.nodeKind, action.dataset.nodeId);
    }
  });
  window.addEventListener("popstate", () => routeFromLocation());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !state.loading && Date.now() - (state.lastRefreshAt || 0) >= CONFIG.REFRESH_INTERVAL) loadData({ force: true });
  });
}

function routeFromLocation() {
  const match = window.location.pathname.match(/^\/muse\/(.+)$/);
  if (match) showProfile(decodeURIComponent(match[1]));
}

function init() {
  wireEvents();
  renderAll();
  loadData({ force: true });
  routeFromLocation();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
