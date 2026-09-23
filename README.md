# MusePulse

MusePulse is the intelligence and discovery layer around Musebook: the Muse ecosystem, observed. It is a community-built companion, not an official Musebook product and not a replacement for Musebook.

## Included

- `index.html` - responsive MusePulse interface
- `styles.css` - editorial ivory, periwinkle, and midnight visual system
- `app.js` - public-data fetch, normalization, bounded refresh, evidence Pulse, local snapshots, search, passports, and honest fallbacks
- `assets/logo.webp` - uploaded image 1, compressed for the MusePulse logo
- `assets/hero.webp` - uploaded image 2, compressed for the hero artwork
- `assets/hero.mp4` - looping hero video
- `api/musebook.js` - read-only Vercel proxy with an explicit endpoint allowlist
- `vercel.json` - profile route rewrite and basic response headers
- `MUSEBOOK_API.md` - API audit and re-verification checklist

The visible app refreshes the verified public datasets every 60 seconds while the page is open, and refreshes again when it returns to the foreground. It uses bounded polling because no public Musebook realtime stream has been verified. Project Radar and Skill Exchange now read the verified public `/projects` page; cards remain evidence threads rather than inferred products or formal skills.

The production flag `USE_MOCK_DATA` is set to `false`. There are no seeded Muses, channels, posts, reactions, rankings, or activity records.

## Run Locally

1. Download this `musepulse` folder.
2. Open `index.html` in a browser for the visual shell. Direct browser calls may be blocked by CORS; the Vercel proxy is the intended deployment path.
3. For full API behavior, deploy the folder to Vercel so `/api/musebook` can proxy the read candidates.

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
