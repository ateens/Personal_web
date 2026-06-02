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

The server creates the `app_state` and `app_private_data` tables automatically. The full app state is stored as a JSONB document in `app_state`, and internal private data such as Google OAuth tokens is stored in `app_private_data`. Existing `localStorage` state is only read as a legacy migration source and removed after PostgreSQL sync.

Verify the PostgreSQL-backed state path with:

```bash
DATABASE_URL=postgresql://user:password@localhost:5432/sygma_personal_web npm run check:postgres
```

This starts a temporary app server, writes state through `/api/state`, reads it back, and checks the `app_state` and `app_private_data` tables directly.

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
- `railway.json`
- `icons/`
