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

Use `npm start` for PostgreSQL persistence and Google Calendar integration. PostgreSQL remains the remote source of truth. The browser also keeps a workspace-scoped IndexedDB snapshot and pending-operation queue so Resource drafts survive reloads and reconnect safely; it never stores Google OAuth tokens or the access code. A static Python preview can show the UI, but it cannot run the server-side DB/API paths.

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

Verify the Railway-native access-code session gate with:

```bash
npm run check:access-auth
```

This isolated check covers anonymous rejection, access-code login, HttpOnly/Secure/SameSite cookies, mutation origin checks, logout, OAuth callback admission, and redirect safety. It does not require PostgreSQL or change production data.

## Production Build

Create and verify the optimized production bundle with:

```bash
npm run check
npm run check:build
npm run check:postgres
npm run check:access-auth
```

The build writes content-hashed, minified JS/CSS to `dist/client/`. To preview that exact bundle locally:

```bash
npm run preview
```

The Node server compresses responses when supported, validates conditional requests with ETags, and gives content-hashed assets immutable cache headers. The service worker uses cache-first delivery for those immutable assets while leaving API traffic uncached.

## Railway

Railway is the only production hosting and runtime target. `railway.json` runs `npm run check && npm run check:build` during the image build, then starts the verified bundle with `npm run start:production`. The server listens on Railway's injected `PORT`, serves the optimized client and API from one origin, and exposes `/health` for deployment health checks.

Production is private by default. Every Railway runtime and every `NODE_ENV=production` process fails closed unless the single-owner access-code gate has a valid SHA-256 verifier. The exact production project/environment/service IDs supply the committed verifier; Railway preview services must provide `APP_ACCESS_PASSWORD_SHA256`. Successful login creates a bounded in-memory session with an HttpOnly, Secure, SameSite cookie; unsafe authenticated requests must also come from the exact request origin. `/health` and the state-validated Google OAuth callback are the only public runtime paths. A restart invalidates sessions and requires login again.

The access code for this deployment is stored in the macOS login keychain, not in the repository. Retrieve it locally with:

```bash
security find-generic-password -a "$USER" -s "SYGMA Railway Access" -w
```

For a local non-production deployment, set `REQUIRE_APP_ACCESS_AUTH=1` and provide a high-entropy `APP_ACCESS_PASSWORD_SHA256`. The exact production target uses the target-scoped one-way verifier in `server/deployment-security.js`, so a credential rotation is an intentional reviewed code change. Any other Railway service or production-mode start without its own verifier exits before the server begins listening.

Register the matching authorized redirect URI in Google Cloud. For the default local server it is:

```text
http://127.0.0.1:4180/api/google/oauth/callback
```

If you run a different port, use that port in the redirect URI.

Production OAuth starts and finishes on the same Railway origin. Register this exact redirect URI:

```text
https://personalweb-production-81a6.up.railway.app/api/google/oauth/callback
```

After Google finishes, the backend redirects the popup to the Railway app origin.

Set these Railway variables for persistence:

```text
DATABASE_URL
APP_STATE_ID=default
```

Recommended production settings are documented in `.env.example`; the limits below use the code defaults, while the state-write precondition is deliberately enabled for production:

```text
REQUIRE_STATE_PRECONDITION=1
API_RATE_LIMIT_WINDOW_MS=60000
API_RATE_LIMIT_STATE_READ_MAX=240
API_RATE_LIMIT_STATE_WRITE_MAX=120
API_RATE_LIMIT_GOOGLE_MUTATION_MAX=20
API_RATE_LIMIT_MAX_KEYS=10000
STATE_WRITE_MAX_CONCURRENCY=2
STATE_WRITE_MAX_QUEUE=16
STATE_WRITE_QUEUE_TIMEOUT_MS=10000
```

The exact production Railway target automatically uses Railway's `X-Real-IP` header for per-client rate limits. Outside that pinned target, never enable `TRUST_PROXY_IP_HEADERS` unless the only reachable ingress strips and recreates forwarded IP headers.

Set these Railway variables before using Google Calendar:

```text
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI=https://personalweb-production-81a6.up.railway.app/api/google/oauth/callback
PUBLIC_BASE_URL=https://personalweb-production-81a6.up.railway.app
```

The production Railway target pins the callback and public origin in code, checks Google credentials during startup, and refuses to start if the protected production configuration is incomplete. Legacy Sites proxy and OAuth handoff variables are not used.

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
- `server/access-auth.js`
- `server/deployment-security.js`
- `scripts/build.mjs`
- `scripts/check-access-auth.mjs`
- `railway.json`
- `icons/`
