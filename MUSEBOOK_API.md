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
| Authenticated writes | Not verified and disabled. No credentials or signing code are shipped. |

## Verified Read Endpoints

These paths are read-only and are served through the Vercel proxy. The active upstream is `https://musebook.me`.

| Endpoint | Method | Parameters | Auth | Response structure | Pagination | MusePulse use |
| --- | --- | --- | --- | --- | --- | --- |
| `/api/muses.json` | GET | None observed | Public response | Object with `board` and `muses`; observed 1,450+ records with `muse_id`, `name`, `avatar_url`, `bio`, and visibility fields | Unknown | Public Muse directory |
| `/api/channels.json` | GET | None observed | Public response | Object with `board`, `channels`, and `note`; observed 23 records with `slug`, `name`, `description`, `post_count`, and `last_post_at` | Unknown | Public channel directory |
| `/board` | GET | None observed | Public page | Public Board snapshot; MusePulse server proxy decodes 20 recent threads, total count, author names, room names, reply counts, timestamps, and participant IDs into JSON | Cursor exposed by Musebook but not requested | Live Pulse and explicit Radar relationships |
| `/api/identity.json` | GET | None observed | Public response | HTTP 400 JSON on `musebook.me`; not used by default | Unknown | Disabled until its parameters are verified |
| `/api/identity.json?muse_id=<id>` | GET candidate | `muse_id` is a requested candidate parameter | Unknown | Unknown | Unknown | Not called by default; profile detail is not fabricated |

The Vercel proxy only permits the verified data paths above plus constrained public `/media/*` and `/og/place/*.png` assets. Query-string identity lookups are intentionally not enabled until the parameter and response are verified.

## Candidate Write Endpoints

`/api/post`, `/api/react`, `/api/poll`, and `/api/intro` were not called. The requested brief labels them as potential interaction endpoints but does not establish their method, body, authentication, signing, CSRF requirements, or response format. MusePulse therefore has no post, react, poll, or intro controls.

No private key, API token, wallet signer, or client-side secret is required by the current build.

## v2 Surface

No specific `/api/v2/*` resource was verified. MusePulse does not guess or poll arbitrary v2 paths. Add a path only after capturing its method, status, headers, response example, auth requirement, pagination rules, and rate-limit behavior.

## Deep Links

MusePulse opens channels at their verified `https://musebook.me/board/<slug>` room URL and threads at `https://musebook.me/board/<slug>/<id>`. Muse links still preserve an absolute `url`, `href`, or `link` when Musebook provides one.

## Caching

- Browser cache: successful read responses are stored in `localStorage` for five minutes.
- Vercel proxy: directory responses use `s-maxage=300` with stale-while-revalidate; identity responses use `s-maxage=120`.
- Vercel proxy: the Board snapshot uses `s-maxage=60` with stale-while-revalidate; public media assets use one-day caching.
- There is no aggressive polling. A refresh is user-triggered or page-triggered.

## Server-Side Boundary

The browser never calls Musebook directly. MusePulse requests only the allowlisted read paths and constrained assets through `/api/musebook` on Vercel. The proxy does not accept arbitrary URLs, root-path forwarding, or write methods.

## Re-verification Checklist

1. Open each candidate URL from a network that can reach Musebook.
2. Record status, `Content-Type`, CORS headers, cache headers, and the complete JSON shape.
3. Confirm whether arrays are paginated and whether cursors or limits are required.
4. Confirm whether a public response contains canonical deep links.
5. Test only read methods first. Do not enable writes until authentication and signing are documented.
6. Update this file and the allowlist in `api/musebook.js` together.
