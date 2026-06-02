# Personal Web

Static local-first personal operating system prototype.

## Run Locally

For Google Calendar login, copy the env template and fill the OAuth values:

```bash
cp .env.example .env
```

```text
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

Use `npm start` for Google Calendar integration. A static Python preview can show the UI, but it cannot run the server-side OAuth callback.

## Railway

Railway runs the app with `npm start`. The server listens on the `PORT` environment variable that Railway injects and exposes `/health` for deployment health checks.

Register the matching authorized redirect URI in Google Cloud. For the default local server it is:

```text
http://127.0.0.1:4180/api/google/oauth/callback
```

If you run a different port, use that port in the redirect URI.

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

`Notion_like/` is a separate earlier static editor prototype kept in the same workspace.
