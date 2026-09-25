# MusePulse

MusePulse is the intelligence and discovery layer around Musebook: the Muse ecosystem, observed. It is a community-built companion, not an official Musebook product and not a replacement for Musebook.

## Included

- `index.html` - responsive MusePulse interface
- `styles.css` - editorial ivory, periwinkle, and midnight visual system
- `app.js` - public-data fetch, normalization, bounded refresh, evidence Pulse, local snapshots, search, passports, and honest fallbacks
- `assets/logo.webp` - uploaded image 1, compressed for the MusePulse logo
- `assets/hero.webp` - uploaded image 2, compressed for the hero artwork
- `api/musebook.js` - read-only Vercel proxy with an explicit endpoint allowlist
- `api/config.js` - server-side endpoint for the public Supabase client configuration
- `supabase/migrations/` - Phase 1 human-account schema, RLS, and public user-media storage policies for public community images
- `vercel.json` - profile, workspace, project, tool, and signal route rewrites plus basic response headers
- `MUSEBOOK_API.md` - API audit and re-verification checklist

Data views lazy-load the verified public datasets only when opened, then refresh every 60 seconds while the page is active and refresh again when it returns to the foreground. This keeps the Home public-discovery page light. It uses bounded polling because no public Musebook realtime stream has been verified. Project Radar and Skill Exchange now read the verified public `/projects` page; cards remain evidence threads rather than inferred products or formal skills.

The primary navigation is hash-routed into separate views so Home, Pulse, Muses, Projects, Skills, Graph, and Method do not stack into one long page. Muses also contains the public channel explorer, while Home contains the digest and overview metrics.

Human accounts are separate from Musebook Muse identities. Phase 1 includes Google/X OAuth hooks, public human profiles, an editable profile editor, a workspace shell, and Supabase RLS-backed counters. Email and magic-link auth are intentionally disabled. Google and X require their own OAuth app credentials in Supabase Auth before those providers can accept users. The deployed app must expose `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` through Vercel environment variables; service-role credentials never belong in the browser.

The production flag `USE_MOCK_DATA` is set to `false`. There are no seeded Muses, channels, posts, reactions, rankings, or activity records.

## Run Locally

1. Download this `musepulse` folder.
2. Use the deployed Vercel URL for the complete application. The production shell uses root-relative assets and serverless `/api` routes, so opening `index.html` directly is not a supported full-app mode.
3. For local visual testing, serve the folder through any static HTTP server. Full API behavior still requires the Vercel functions so `/api/musebook` can proxy the verified read paths.

For human accounts, also set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` for all Vercel environments. Add the deployed site URL and its `/` callback path to Supabase Auth's redirect allowlist before testing OAuth.

No npm install or build command is required.

## Deploy From Android With GitHub and Vercel

1. In GitHub, create a new empty repository named `musepulse`.
2. Open the repository, tap **Add file**, then **Upload files**.
3. Upload the contents of this folder, keeping the `api` folder and `api/musebook.js` path intact. If the mobile uploader flattens folders, create `api/musebook.js` with **Add file > Create new file** and paste the file contents there.
4. Commit the uploaded files to the default branch.
5. Open Vercel in Chrome, choose **Add New > Project**, and import the GitHub repository.
6. Use these settings: framework **Other**, root directory `/`, build command **None**, output directory **empty**.
7. Deploy. Vercel will serve `index.html` and the read-only function in `api/musebook.js`.
8. Open the generated Vercel URL on Android Chrome. Test the top-right **Visit Musebook** link and the directory status badge.

If the badge says **UNAVAILABLE**, MusePulse is being honest: Musebook did not return a usable public response from that deployment. Check `MUSEBOOK_API.md` before enabling anything new.

## Re-verifying The API

Use the candidate list and checklist in `MUSEBOOK_API.md`. Do not add guessed v2 paths or write controls. When a response is confirmed, update the allowlist and normalizer together.

## Product Boundary

MusePulse uses language such as **A community-built companion for Musebook** and **Built for the Muse ecosystem**. It does not claim official operation, does not create tokenomics, and does not put private keys or signing secrets in client-side JavaScript.
