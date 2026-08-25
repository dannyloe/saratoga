# Loe Group Trip Site — Railway deployment

This replaces the claude.ai artifact version with a real backend (Express +
SQLite) so the site has a permanent URL and everyone's edits land in an
actual database instead of claude.ai's per-session storage.

## One-time setup (about 10 minutes, no command line needed)

### 1. Put this folder on GitHub
- Go to github.com, click **New repository**, name it something like `loe-trip-site`.
  Make it **Private** — this site has real addresses, phone numbers, and
  confirmation numbers on it.
- On the new repo's page, click **uploading an existing file**, then drag
  in every file from this folder (keep `public/index.html` inside a `public`
  subfolder — GitHub's uploader supports drag-and-drop of folders in most
  browsers; if not, create the `public` folder first via "Add file → Create
  new file" and name it `public/index.html`, then paste the contents).
- Commit the files.

### 2. Deploy on Railway
- Go to railway.app, sign in (GitHub login is easiest), click **New Project**.
- Choose **Deploy from GitHub repo**, pick `loe-trip-site`.
- Railway will detect the Node app automatically (via `railway.toml` +
  `package.json`) and build it.
- Once it's deployed, go to the service's **Settings → Networking** and
  click **Generate Domain**. You'll get a permanent URL like
  `loe-trip-site-production.up.railway.app`. This URL never changes across
  future deploys.

### 3. Add persistent storage (so edits survive redeploys)
- In the Railway project, click **+ New → Volume**.
- Mount it at `/data`.
- Go to the service's **Variables** tab and add:
  `DB_PATH` = `/data/trip.db`
- Redeploy (Railway usually does this automatically after a variable change).

That's it — the site is now live at a permanent URL, and every edit anyone
makes through the "Edit" buttons is stored in a real SQLite database on that
volume.

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
- `server.js` — Express server; serves the site and a small JSON API backed
  by SQLite (`/api/overrides`, `/api/meta/:key`).
- `public/index.html` — the trip site itself (same content/design as before,
  just pointed at the new API instead of claude.ai's `window.storage`).
- `package.json` — dependencies (`express`, `better-sqlite3`).
- `railway.toml` — tells Railway how to build/start the app.
