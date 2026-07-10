# Personal Web

Personal operating system prototype with PostgreSQL-backed app state.

## Run Locally

Copy the env template and fill the PostgreSQL URL. Google Calendar values are optional unless you use calendar sync:

```bash
cp .env.example .env
```

```text
DATABASE_URL=postgresql://user:password@localhost:5432/sygma_personal_web
APP_STATE_ID=default
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

```bash
npm start
```

Then open:

```text
http://127.0.0.1:4180/
```

Use `npm start` for PostgreSQL persistence and Google Calendar integration. The server requires `DATABASE_URL` and does not persist app data to browser storage or token files. A static Python preview can show the UI, but it cannot run the server-side DB/API paths.

The server creates the `app_state` and `app_private_data` tables automatically. The full app state is still stored as a JSONB document in `app_state` for backup, settings, migration, and client compatibility. Internal private data such as Google OAuth tokens is stored in `app_private_data`. Existing `localStorage` state is only read as a legacy migration source and removed after PostgreSQL sync.

For maintainability, collection data is managed from relational tables. `/api/state` keeps its client-facing shape, but the server reconstructs `tasks`, `resources`, `projects`, `goals`, `habits`, and the other app collections from these tables:

```text
boxes
goals
projects
tasks
resources
task_resources
habits
habit_instances
captures
journals
google_calendars
google_events
collection_links
```

`tasks` references `boxes`, `goals`, and `projects` as parent context. `resources` also references `boxes`, `goals`, and `projects`. Task-resource relationships are peer relationships, so they are stored in `task_resources` rather than as a parent/child foreign key.

On writes, the server normalizes the incoming state, writes the relational rows, then updates `app_state` as a backup snapshot. On reads, relational rows are the source of truth for app collections. `app_state` is only used for settings, backup, and one-time bootstrap when relational rows do not exist yet.

Verify the PostgreSQL-backed state path with:

```bash
DATABASE_URL=postgresql://user:password@localhost:5432/sygma_personal_web npm run check:postgres
```

This starts a temporary app server, writes state through `/api/state`, reads it back, and checks the JSONB tables plus the relational collection tables directly.

## Production Build

Create and verify the optimized production bundle with:

```bash
npm run check
npm run check:build
npm run check:postgres
```

The build writes content-hashed, minified JS/CSS and the Sites Worker entry point to `dist/`. To preview that exact bundle locally:

```bash
npm run preview
```

The Node server serves Brotli or gzip when supported, validates conditional requests with ETags, and gives content-hashed assets immutable cache headers. The service worker uses cache-first delivery for those immutable assets while leaving API traffic uncached.

## OpenAI Sites

`.openai/hosting.json` identifies the Sites project. `worker/index.js` serves the optimized static bundle through the Sites asset binding and forwards `/api/*` plus `/health` to the existing PostgreSQL-backed Railway service. This keeps the current data and Google Calendar integration available from the Sites deployment without duplicating browser state.

## Railway

Railway runs the app with `npm start`. The server listens on the `PORT` environment variable that Railway injects and exposes `/health` for deployment health checks.

Register the matching authorized redirect URI in Google Cloud. For the default local server it is:

```text
http://127.0.0.1:4180/api/google/oauth/callback
```

If you run a different port, use that port in the redirect URI.

Set these Railway variables for persistence:

```text
DATABASE_URL
APP_STATE_ID=default
```

Set these Railway variables before using Google Calendar:

```text
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
PUBLIC_BASE_URL=https://personalweb-production-81a6.up.railway.app
```

Production URL:

```text
https://personalweb-production-81a6.up.railway.app/
```

## Main Files

- `index.html`
- `styles.css`
- `app.js`
- `manifest.json`
- `service-worker.js`
- `server.js`
- `worker/index.js`
- `scripts/build.mjs`
- `railway.json`
- `icons/`
