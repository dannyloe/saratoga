# Loe Group Trip Site — Railway deployment

This replaces the claude.ai artifact version with a real backend (Express)
so the site has a permanent URL and everyone's edits land in real
server-side storage instead of claude.ai's per-session storage.

Storage is a JSON file on a persistent Railway Volume — not a SQL database.
The first version of this used SQLite (`better-sqlite3`), but that package
needs to compile native code at build time, and Railway's build environment
doesn't have Python available for that step, so the build failed. Plain
JSON-file storage needs no compilation at all, so it can't hit that problem.
For a site with a handful of family members occasionally editing a few
dozen events, it's just as reliable as a real database — the data is still
structured, still persists across redeploys, and is trivial to inspect or
back up (it's literally a text file).

## One-time setup (about 10 minutes, no command line needed)

### 1. Put this folder on GitHub
- Go to github.com, click **New repository**, name it something like `loe-trip-site`.
  Make it **Private** — this site has real addresses, phone numbers, and
  confirmation numbers on it.
- On the new repo's page, click **uploading an existing file**, then drag
  in every file from this folder (keep `public/index.html` inside a `public`
  subfolder). Don't forget `.gitignore` — it's a hidden file, so if your
  file picker doesn't show it, add it separately afterward via
  "Add file → Create new file" and name it `.gitignore`.
- Commit the files.

### 2. Deploy on Railway
- Go to railway.app, sign in (GitHub login is easiest), click **New Project**.
- Choose **Deploy from GitHub repo**, pick your repo.
- Railway will detect the Node app automatically (via `railway.toml` +
  `package.json`) and build it. This build has no native compile step, so
  it should just work.
- Once it's deployed, go to the service's **Settings → Networking** and
  click **Generate Domain**. You'll get a permanent URL like
  `loe-trip-site-production.up.railway.app`. This URL never changes across
  future deploys.

### 3. Add persistent storage (so edits survive redeploys)
- In the Railway project, click **+ New → Volume**.
- Mount it at `/data`.
- Go to the service's **Variables** tab and add:
  `DATA_PATH` = `/data/trip-data.json`
- Redeploy (Railway usually does this automatically after a variable change).

That's it — the site is now live at a permanent URL, and every edit anyone
makes through the "Edit" buttons is stored in that JSON file on the volume.

## Updating the trip data going forward

When new confirmations come in, send them to Claude in your existing chat.
Claude will hand you an updated `public/index.html`. To push the update:
- On GitHub, open `public/index.html` in the repo, click the pencil (edit)
  icon, select all, paste in the new content, and commit.
- Railway auto-redeploys on every commit to the connected branch — same URL,
  updated content, usually live within a minute or two.

No command line or `git` installation required for any of this — everything
above uses GitHub's and Railway's web interfaces.

## What's in this folder
- `server.js` — Express server; serves the site and a small JSON API
  (`/api/overrides`, `/api/meta/:key`) backed by a JSON file on disk.
- `public/index.html` — the trip site itself (same content/design as before,
  just pointed at the new API instead of claude.ai's `window.storage`).
- `package.json` — dependencies (just `express`).
- `railway.toml` — tells Railway how to build/start the app.
- `.gitignore` — keeps `node_modules` and the local data file out of git.
