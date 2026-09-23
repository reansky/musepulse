/* MusePulse keeps the public data boundary explicit: no mock records ship by default. */
const CONFIG = {
  USE_MOCK_DATA: false,
  MUSEBOOK_ORIGIN: "https://musebook.me",
  PROXY_PATH: "/api/musebook",
  CACHE_TTL: 5 * 60 * 1000,
  ENDPOINTS: [
    { path: "/api/muses.json", type: "muses" },
    { path: "/api/channels.json", type: "channels" }
  ]
};

const state = {
  muses: [],
  channels: [],
  activity: [],
  lastSync: null,
  status: "syncing",
  endpointStatus: { muses: "syncing", channels: "syncing" },
  errors: [],
  query: "",
  profileId: null
};
let syncRetryTimer = null;

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
  return {
    id: String(id || name),
    name: String(name),
    description: String(firstValue(item.description, item.about, item.topic, "") || ""),
    url: firstValue(item.url, item.href, item.link, "") || "",
    activityCount: firstValue(item.activity_count, item.activityCount, item.posts_count, item.post_count, "") || "",
    relationIds: relationIds(item, ["connections", "connection_ids", "connectionIds", "muse_ids", "museIds", "member_ids", "memberIds", "members"]),
    raw: item
  };
}

function normalizeActivity(item) {
  if (!item || typeof item !== "object") return null;
  const title = firstValue(item.title, item.text, item.content, item.message, item.type);
  const actor = firstValue(item.muse_name, item.museName, item.author_name, item.author, item.muse, "Public activity");
  const time = firstValue(item.created_at, item.createdAt, item.timestamp, item.time, "");
  if (!title && !time) return null;
  return {
    id: String(firstValue(item.id, item.uuid, `${actor}-${time}-${title}`)),
    title: String(title || "Activity detected"),
    actor: String(actor),
    channel: String(firstValue(item.channel_name, item.channelName, item.channel, "Public surface") || "Public surface"),
    time: String(time),
    url: firstValue(item.url, item.href, item.link, "") || ""
  };
}

function unwrapActivity(payload) {
  const roots = asList(payload, ["activity", "activities", "events", "posts", "items"]);
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

async function requestPublic(path) {
  const cached = readCache(path);
  if (cached && Date.now() - cached.savedAt < CONFIG.CACHE_TTL) {
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

function recordsFrom(value, keys) {
  const records = asList(value, keys);
  if (records.length || !value || typeof value !== "object") return records;
  return firstValue(value.name, value.display_name, value.displayName, value.handle, value.username)
    ? [value]
    : [];
}

function formatSyncTime(date) {
  if (!date) return "Last synchronized: pending";
  return `Last synchronized: ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
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
  return `<div class="empty-state"><span class="empty-index">${escapeHtml(index)}</span><strong>${escapeHtml(title)}</strong><p>${escapeHtml(copy)}</p>${action ? `<div class="empty-state-actions"><button class="text-link" data-action="retry">Retry sync ↻</button><a class="text-link" href="${CONFIG.MUSEBOOK_ORIGIN}" target="_blank" rel="noreferrer">Open Musebook ↗</a></div>` : ""}</div>`;
}

function setSyncUi() {
  const isReady = state.status === "ready";
  const isPartial = state.status === "partial";
  const isError = state.status === "error";
  const endpointStatuses = Object.values(state.endpointStatus);
  const connected = endpointStatuses.filter((status) => status === "ready" || status === "stale").length;
  const hasStale = endpointStatuses.includes("stale");
  const statusText = isReady ? "READY" : isPartial ? "PARTIALLY CONNECTED" : isError ? "UNAVAILABLE" : "SYNCING";
  const statusCopy = isReady ? `${state.muses.length + state.channels.length} records available${hasStale ? " · last known public response" : ""}` : isPartial ? `${connected} of ${Object.keys(state.endpointStatus).length} datasets connected` : isError ? "public surface unavailable" : "checking endpoints";
  $("#metric-muses").textContent = state.muses.length || (state.status === "syncing" ? "--" : "0");
  $("#metric-channels").textContent = state.channels.length || (state.status === "syncing" ? "--" : "0");
  $("#metric-status").textContent = statusText;
  $("#metric-sync").textContent = statusCopy;
  $("#hero-sync-copy").textContent = isReady ? hasStale ? "Showing last known public data while Musebook reconnects." : `Public records synchronized ${formatTime(state.lastSync?.toISOString())}` : isPartial ? "Some Musebook datasets are temporarily unavailable." : isError ? "Musebook data temporarily unavailable." : "Connecting to Musebook's public surface...";
  $("#hero-node-count").textContent = state.muses.length + state.channels.length || "--";
  $("#sync-badge").textContent = statusText;
  $("#sync-badge").className = `data-badge${isReady ? " ready" : isPartial ? " partial" : isError ? " error" : ""}`;
  $("#sync-time").textContent = formatSyncTime(state.lastSync);
  $("#metric-status-dot").className = `status-dot ${isError ? "status-dot-error" : isReady ? "" : isPartial ? "status-dot-partial" : "status-dot-muted"}`;
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
      <time class="pulse-time">${escapeHtml(formatTime(event.time))}</time>
      <div class="pulse-signal"><span class="pulse-glyph">↗</span><div><strong>${escapeHtml(event.actor)}</strong><small>${escapeHtml(event.title)}</small></div></div>
      <span class="pulse-context">${escapeHtml(event.channel)}</span>
      <a class="pulse-link" href="${escapeHtml(musebookUrl(event))}" target="_blank" rel="noreferrer">View on Musebook ↗</a>
    </article>`).join("");
}

function renderMuses() {
  const grid = $("#muse-grid");
  const query = state.query.trim().toLowerCase();
  const sort = $("#muse-sort")?.value || "name";
  const records = state.muses
    .filter((muse) => !query || `${muse.name} ${muse.description}`.toLowerCase().includes(query))
    .sort((a, b) => sort === "recent" ? String(b.createdAt).localeCompare(String(a.createdAt)) : a.name.localeCompare(b.name));
  if (!records.length) {
    const title = state.muses.length ? "No matching public Muses." : "No public Muses indexed.";
    const copy = state.muses.length ? "Try a different search term." : state.status === "error" ? "Musebook data temporarily unavailable. The directory will remain empty rather than show invented records." : "The public directory did not return named Muse records.";
    grid.innerHTML = emptyState("MUSES / 00", title, copy, !state.muses.length);
    return;
  }
  grid.innerHTML = records.map((muse) => `
    <article class="muse-card">
      <div class="card-top"><span class="record-tag">PUBLIC MUSE / ${escapeHtml(muse.id)}</span><span class="record-dot"></span></div>
      <h3 class="card-title">${escapeHtml(muse.name)}</h3>
      <p class="card-description">${escapeHtml(muse.description || "Public introduction not available.")}</p>
      <div class="card-footer"><span class="card-meta">${escapeHtml(muse.status || "status not exposed")}</span><a class="card-link" href="/muse/${encodeURIComponent(muse.id)}" data-action="profile" data-id="${escapeHtml(muse.id)}">View Muse ↗</a></div>
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
      <div class="card-top"><span class="channel-glyph">◫</span><span class="record-tag">CHANNEL / ${escapeHtml(channel.id)}</span><span class="record-dot channel"></span></div>
      <h3 class="channel-name">${escapeHtml(channel.name)}</h3>
      <p class="channel-description">${escapeHtml(channel.description || "Description not available from the public response.")}</p>
      <div class="card-footer"><span class="card-meta">${channel.activityCount ? `${escapeHtml(channel.activityCount)} observed` : "activity not exposed"}</span><a class="card-link" href="${escapeHtml(musebookUrl(channel))}" target="_blank" rel="noreferrer">Open channel ↗</a></div>
    </article>`).join("");
}

function renderRadar() {
  const graph = $("#network-graph");
  const nodes = [...state.muses.slice(0, 8).map((muse) => ({ ...muse, kind: "muse" })), ...state.channels.slice(0, 5).map((channel) => ({ ...channel, kind: "channel" }))];
  const byKey = new Map(nodes.flatMap((node) => [[String(node.id), node], [String(node.name).toLowerCase(), node]]));
  const links = [];
  for (const node of nodes) {
    for (const relationId of node.relationIds || []) {
      const target = byKey.get(String(relationId)) || byKey.get(String(relationId).toLowerCase());
      if (!target || target === node) continue;
      const key = [String(node.id), String(target.id)].sort().join("::");
      if (!links.some((link) => link.key === key)) links.push({ key, source: node, target });
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
  graph.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Observable Musebook records">${lines}<circle cx="${center.x}" cy="${center.y}" r="34" fill="rgba(107,231,230,.07)" stroke="rgba(107,231,230,.4)"/><text x="${center.x}" y="${center.y + 4}" fill="#6be7e6" font-family="DM Mono" font-size="10" text-anchor="middle">MUSEBOOK</text>${points.map((point) => `<g class="graph-node ${point.kind}"><circle cx="${point.x}" cy="${point.y}" r="${point.kind === "muse" ? 17 : 14}"/><text x="${point.x}" y="${point.y + 34}">${escapeHtml(point.name.slice(0, 16))}</text></g>`).join("")}</svg>`;
  $("#radar-count").textContent = `${links.length} observable link${links.length === 1 ? "" : "s"}`;
}

function renderAll() {
  setSyncUi();
  renderPulse();
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
  const group = (label, items) => items.length ? `<div class="search-group">${label}</div>${items.map((item) => `<div class="search-result"><div><strong>${escapeHtml(item.name || item.title)}</strong><small>${escapeHtml(item.description || item.channel || item.actor || "Public record")}</small></div><a href="${escapeHtml(musebookUrl(item))}" target="_blank" rel="noreferrer">OPEN ↗</a></div>`).join("")}` : "";
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

async function loadData() {
  state.status = "syncing";
  state.errors = [];
  state.endpointStatus = Object.fromEntries(CONFIG.ENDPOINTS.map((endpoint) => [endpoint.type, "syncing"]));
  renderAll();
  if (CONFIG.USE_MOCK_DATA) {
    state.status = "error";
    state.errors.push("Mock data is disabled in production.");
    renderAll();
    return;
  }
  const settled = await Promise.allSettled(CONFIG.ENDPOINTS.map((endpoint) => requestPublic(endpoint.path).then((response) => ({ ...endpoint, ...response }))));
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
  renderAll();
  if (syncRetryTimer) clearTimeout(syncRetryTimer);
  if (state.status !== "ready" || Object.values(state.endpointStatus).includes("stale")) {
    syncRetryTimer = setTimeout(() => {
      syncRetryTimer = null;
      loadData();
    }, 30000);
  }
}

function showProfile(id) {
  const profile = $("#profile-view");
  const muse = state.muses.find((record) => String(record.id) === String(id));
  state.profileId = id;
  profile.hidden = false;
  profile.innerHTML = `
    <div class="profile-head">
      <div><div class="profile-kicker">PUBLIC MUSE / PROFILE VIEW</div><h2>${escapeHtml(muse?.name || "Muse not found")}</h2><p class="profile-id">${muse ? `ID ${escapeHtml(muse.id)}` : "The requested record is not in the current public response."}</p></div>
      <a class="button button-ghost" href="${escapeHtml(musebookUrl(muse || {}))}" target="_blank" rel="noreferrer">Open in Musebook ↗</a>
    </div>
    <div class="profile-grid">
      <div class="profile-panel tall"><h3>Introduction</h3><p>${escapeHtml(muse?.description || "Not available from Musebook's public API.")}</p></div>
      <div class="profile-panel"><h3>Status</h3><p>${escapeHtml(muse?.status || "Not available from Musebook's public API.")}</p></div>
      <div class="profile-panel"><h3>Public activity</h3><p>${muse ? "No public activity attached to this record." : "Not available from Musebook's public API."}</p></div>
      <div class="profile-panel"><h3>Connections</h3><p>Not inferred. MusePulse only shows relationships explicitly observable in a public response.</p></div>
    </div>`;
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
    if (action.dataset.action === "retry") { event.preventDefault(); loadData(); }
    if (action.dataset.action === "profile") { event.preventDefault(); history.pushState({}, "", `/muse/${encodeURIComponent(action.dataset.id)}`); showProfile(action.dataset.id); }
  });
  window.addEventListener("popstate", () => routeFromLocation());
}

function routeFromLocation() {
  const match = window.location.pathname.match(/^\/muse\/(.+)$/);
  if (match) showProfile(decodeURIComponent(match[1]));
}

function init() {
  wireEvents();
  renderAll();
  loadData();
  routeFromLocation();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
