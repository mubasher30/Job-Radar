# Job Radar — live deploy

A live-refreshing dashboard of remote UX/Product Design jobs. The page calls
`/api/jobs`, which runs a Netlify serverless function that queries Remotive,
RemoteOK, and We Work Remotely on every request — no database, no cron job,
no API keys to manage.

## What's included
- `public/index.html` — the dashboard (static, no build step)
- `netlify/functions/jobs.js` — the serverless function that fetches + scores jobs live
- `netlify.toml` — routes `/api/jobs` to the function and points Netlify at `public/` as the site root

## Deploy option A — Netlify Drop (fastest, ~2 minutes, no account required to start)
1. Go to **https://app.netlify.com/drop**
2. Drag the whole `job-radar` folder onto the page.
3. Netlify gives you a live URL immediately, like `https://random-name-123.netlify.app`.
4. The site works right away — open it and jobs should load within a few seconds.
5. **To keep it alive long-term and pick your own name:** click "Claim site" in the banner Netlify shows after deploy (needs a free Netlify account — email/GitHub/Google login). Unclaimed Drop sites can be reclaimed by anyone or expire; claiming takes 30 seconds and is free.
6. Once claimed, go to **Site settings → Domain management → Options → Edit site name** to pick a memorable subdomain (e.g. `junaid-job-radar.netlify.app`) — that's your bookmarkable URL.

## Deploy option B — GitHub + Netlify (best for the long run)
Use this if you want the site to auto-redeploy whenever you tweak the code, and easier custom-domain support later.
1. Create a new GitHub repo (e.g. `job-radar`) and push this folder to it:
   ```bash
   cd job-radar
   git init
   git add .
   git commit -m "Job Radar live dashboard"
   git branch -M main
   git remote add origin https://github.com/<your-username>/job-radar.git
   git push -u origin main
   ```
2. Go to **https://app.netlify.com** → "Add new site" → "Import an existing project" → connect GitHub → pick the repo.
3. Netlify auto-detects `netlify.toml`. Leave build command blank (there's no build step) and publish directory as `public` — it's already set in the config. Click **Deploy**.
4. You get a URL like `https://job-radar-xyz.netlify.app` immediately, and every future `git push` redeploys automatically.
5. Optional: **Site settings → Domain management** to rename the subdomain or attach a domain you own.

## Bookmark it
Whichever path you use, once you've claimed/renamed the site, that `https://<your-name>.netlify.app` URL is permanent — bookmark it and it'll show fresh listings every time you open it (each page load re-queries the three sources live).

## Known limits, on purpose
- **Sources:** Remotive, RemoteOK, We Work Remotely only. Indeed, Dice, ZipRecruiter, and LinkedIn require an authenticated session and can only be queried from inside a Claude chat — ask Claude there for a periodic supplementary pass over those four.
- **Scoring:** a transparent keyword-weight heuristic (see `RESUME_WEIGHTS` in `jobs.js`), not an LLM judgment call. Edit that list any time your target skills/industries change — no redeploy pipeline needed beyond a normal git push (option B) or a fresh Drop upload (option A).
- **"Copy for Claude"** on each card copies a ready-made prompt to your clipboard so you can paste it into a Claude chat and get a tailored resume + cover letter for that specific listing.
