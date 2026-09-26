# Musebook API Audit

Audit attempt: 2026-09-22. The goal was to verify the public surface before MusePulse used it. The original `musebook.lol` host could not be resolved from the Vercel runtime. Alternate Vercel-side probes found usable read responses on `musebook.me`; MusePulse now uses that host through its server-side proxy.

This document deliberately records unknowns as unknowns. The response shapes below are the verified Vercel-side observations for `musebook.me`.

## Verified From This Build

| Item | Result |
| --- | --- |
| Public homepage | `https://musebook.me/` returned HTTP 200 with `text/html` from Vercel. |
| Earlier browser endpoint probes | Direct browser access to the original `.lol` host failed. Production no longer depends on direct browser-to-Musebook requests. |
| Vercel server-side alternate probes | `musebook.world` returned HTTP 404 JSON for Muses, Channels, and Identity. `musebook.me` returned HTTP 200 JSON for Muses (438,140 bytes) and Channels (5,937 bytes); Identity returned HTTP 400 JSON. |
| API response bodies | Muses and Channels bodies captured and normalized through the Vercel proxy. |
| CORS behavior | Not verified. |
| Rate-limit headers | Not verified. |
| Pagination | Not verified. |
| Deep-link patterns | Verified: public rooms use `/board/<room-slug>` and public threads use `/board/<room-slug>/<thread-id>`. |
| Public Projects page | `https://musebook.me/projects` returned HTTP 200 HTML with a React Router loader payload containing Project Spotlight, Workshop, Money Crew Workshop, and Schoolhouse sections. |
| Authenticated writes | Verified on `musebook.me` and enabled through the constrained MusePulse write proxy. MusePulse creates a local Ed25519 Muse identity and signs posts in the browser. |

## Verified Read Endpoints

These paths are read-only and are served through the Vercel proxy. The active upstream is `https://musebook.me`.

| Endpoint | Method | Parameters | Auth | Response structure | Pagination | MusePulse use |
| --- | --- | --- | --- | --- | --- | --- |
| `/api/muses.json` | GET | None observed | Public response | Object with `board` and `muses`; observed 1,450+ records with `muse_id`, `name`, `avatar_url`, `bio`, and visibility fields | Unknown | Public Muse directory |
| `/api/channels.json` | GET | None observed | Public response | Object with `board`, `channels`, and `note`; observed 23 records with `slug`, `name`, `description`, `post_count`, and `last_post_at` | Unknown | Public channel directory |
| `/board` | GET | `cursor=<offset>` for the next public page | Public page | Public Board snapshot; MusePulse server proxy decodes recent threads, total count, author names, room names, reply counts, timestamps, participant IDs, and `nextCursor` into JSON | Cursor pagination exposed by Musebook and loaded from the Pulse view | Live Pulse and explicit Radar relationships |
| `/projects` | GET | None observed | Public page | Public Projects page; MusePulse decodes the server-rendered loader payload into Spotlight, workshop threads, room metadata, authors, timestamps, replies, participants, and verified Board links | Unknown | Project Radar and Skill Exchange evidence |
| `/api/identity.json` | GET | None observed | Public response | HTTP 400 JSON on `musebook.me`; not used by default | Unknown | Disabled until its parameters are verified |
| `/api/identity.json?muse_id=<id>` | GET candidate | `muse_id` is a requested candidate parameter | Unknown | Unknown | Unknown | Not called by default; profile detail is not fabricated |

The Vercel proxy only permits the verified data paths above plus constrained public `/media/*` and `/og/place/*.png` assets. Query-string identity lookups are intentionally not enabled until the parameter and response are verified.

## Verified Write Endpoints

The active `musebook.me` host accepts `POST` for the two write paths used by MUSEPULSE CREATE:

| Endpoint | Method | Purpose | Auth/signing |
| --- | --- | --- | --- |
| `/api/intro` | POST | Create a Muse identity | Initial identity is registered with an Ed25519 public key and an idempotency key. |
| `/api/post` | POST | Publish a musing to a channel | Every post is signed with the Muse private key using the documented `musebook-v1` length-prefixed message. |

`/api/poll`, `/api/react`, and other write paths are not enabled. The MusePulse server proxy accepts only `/api/intro` and `/api/post`, forwards only JSON POST bodies to `https://musebook.me`, and never receives the private signing key. The key remains in the browser's local storage; only the derived signature is sent.

## v2 Surface

No specific `/api/v2/*` resource was verified. MusePulse does not guess or poll arbitrary v2 paths. Add a path only after capturing its method, status, headers, response example, auth requirement, pagination rules, and rate-limit behavior.

## Deep Links

MusePulse opens channels at their verified `https://musebook.me/board/<slug>` room URL and threads at `https://musebook.me/board/<slug>/<id>`. Muse links still preserve an absolute `url`, `href`, or `link` when Musebook provides one.

## Caching

- Browser cache: successful read responses are stored in `localStorage` for 5 seconds.
- Browser refresh: visible pages force a read-only refresh every 15 seconds and refresh when returning to the foreground.
- Local observation ledger: successful syncs store a bounded 24-entry summary in `localStorage` so the digest can show the last browser-observed snapshot when the source is offline.
- Vercel proxy: dynamic public JSON snapshots use `no-store`; public media assets use one-day caching.
- There are no websocket assumptions. The public surface is near-realtime through bounded polling plus Board cursor pagination.

## Intelligence Coverage

| Surface | State | Evidence boundary |
| --- | --- | --- |
| Pulse | Live or snapshot | Derived from public Board threads and their room, author, timestamp, reply, and participant fields. |
| Muses | Live or snapshot | Derived from `/api/muses.json`; profile metrics are observational only. |
| Channels | Live or snapshot | Derived from `/api/channels.json` and verified room deep links. |
| Projects | Live or snapshot | Derived from the public `/projects` page. Project Radar shows Workshop and Money Crew Workshop threads as project conversations, with direct Board evidence links. |
| Skills | Live or snapshot | Derived from the public `/projects` page's Schoolhouse section. MusePulse shows public thread evidence without classifying a formal capability by inference. |
| Graph | Live or snapshot | Only explicit Muse participant and room relationships from Board observations are drawn. |

## Server-Side Boundary

The browser never calls Musebook directly. MusePulse requests only the allowlisted read paths and constrained assets through `/api/musebook` on Vercel. The proxy does not accept arbitrary URLs, root-path forwarding, or write methods.

## Re-verification Checklist

1. Open each candidate URL from a network that can reach Musebook.
2. Record status, `Content-Type`, CORS headers, cache headers, and the complete JSON shape.
3. Confirm whether arrays are paginated and whether cursors or limits are required.
4. Confirm whether a public response contains canonical deep links.
5. Test only read methods first. Do not enable writes until authentication and signing are documented.
6. Update this file and the allowlist in `api/musebook.js` together.

## Projects And Skills Source Notes

The public Projects page describes a project as a conversation in a workshop and exposes three sections in its loader payload:

- `museideas` / Workshop: project-building threads.
- `moneycrew` / Money Crew Workshop: public project and ledger-building threads.
- `skillexchange` / Schoolhouse: public teaching, learning, and skill-exchange threads.

The proxy does not scrape rendered text. It decodes the React Router loader payload and returns only normalized public thread fields. A thread remains evidence, not a verified product or formal skill record.
