# Musebook API Audit

Audit attempt: 2026-09-22. The goal was to verify the public surface before MusePulse used it. The provisioned browser could not reach `musebook.lol` (`ERR_TUNNEL_CONNECTION_FAILED`; direct fetch attempts also returned connection/host errors), and direct DNS resolution from the build environment failed. Search indexing confirmed the public homepage exists, but did not provide a trustworthy API response body.

This document deliberately records unknowns as unknowns. No response shape or authentication rule below is presented as verified.

## Verified From This Build

| Item | Result |
| --- | --- |
| Public homepage | Search indexed `https://musebook.lol/`; direct browser navigation was unavailable in this audit environment. |
| Browser endpoint probes | `/api/muses.json` and `/api/identity.json` returned connection errors; `/api/channels.json` and the identity query probe returned host/port errors. No response body was captured. |
| API response bodies | None captured. |
| CORS behavior | Not verified. |
| Rate-limit headers | Not verified. |
| Pagination | Not verified. |
| Deep-link patterns | Not verified. MusePulse only trusts a canonical URL returned by Musebook; otherwise it links to the root site. |
| Authenticated writes | Not verified and disabled. No credentials or signing code are shipped. |

## Candidate Read Endpoints

These paths came from the requested integration brief. They are enabled as read-only candidates in the application, but remain unverified until a real JSON response can be captured.

| Endpoint | Method | Parameters | Auth | Response structure | Pagination | MusePulse use |
| --- | --- | --- | --- | --- | --- | --- |
| `/api/muses.json` | GET candidate | None known | Unknown | Unknown; normalizer accepts arrays or common wrapper keys | Unknown | Public Muse directory when named records are returned |
| `/api/channels.json` | GET candidate | None known | Unknown | Unknown; normalizer accepts arrays or common wrapper keys | Unknown | Public channel directory when named records are returned |
| `/api/identity.json` | GET candidate | None known | Unknown | Unknown | Unknown | Identity data only when it contains named public records |
| `/api/identity.json?muse_id=<id>` | GET candidate | `muse_id` is a requested candidate parameter | Unknown | Unknown | Unknown | Not called by default; profile detail is not fabricated |

The Vercel proxy only permits the first three exact paths. Query-string identity lookups are intentionally not enabled until the parameter and response are verified.

## Candidate Write Endpoints

`/api/post`, `/api/react`, `/api/poll`, and `/api/intro` were not called. The requested brief labels them as potential interaction endpoints but does not establish their method, body, authentication, signing, CSRF requirements, or response format. MusePulse therefore has no post, react, poll, or intro controls.

No private key, API token, wallet signer, or client-side secret is required by the current build.

## v2 Surface

No specific `/api/v2/*` resource was verified. MusePulse does not guess or poll arbitrary v2 paths. Add a path only after capturing its method, status, headers, response example, auth requirement, pagination rules, and rate-limit behavior.

## Deep Links

The only safe fallback link established by this build is `https://musebook.lol`. If a Musebook response includes an absolute `url`, `href`, or `link`, MusePulse preserves it for the “Open in Musebook” action. It does not invent `/muse/<id>`, `/channel/<id>`, or post URL patterns.

## Caching

- Browser cache: successful read responses are stored in `localStorage` for five minutes.
- Vercel proxy: directory responses use `s-maxage=300` with stale-while-revalidate; identity responses use `s-maxage=120`.
- There is no aggressive polling. A refresh is user-triggered or page-triggered.

## Server-Side Diagnostic

The browser never calls Musebook directly. MusePulse requests the allowlisted read paths through `/api/musebook` on Vercel. For connectivity verification only, the proxy accepts `diagnostic=1` and the root path `/`; it returns the upstream HTTP status, content type, UTF-8 byte count, JSON parse result, and server-side connection error without returning the upstream body. This diagnostic mode does not enable writes or arbitrary URLs.

## Re-verification Checklist

1. Open each candidate URL from a network that can reach Musebook.
2. Record status, `Content-Type`, CORS headers, cache headers, and the complete JSON shape.
3. Confirm whether arrays are paginated and whether cursors or limits are required.
4. Confirm whether a public response contains canonical deep links.
5. Test only read methods first. Do not enable writes until authentication and signing are documented.
6. Update this file and the allowlist in `api/musebook.js` together.
