# Personal Web

Static local-first personal operating system prototype.

## Run Locally

```bash
npm start
```

Then open:

```text
http://127.0.0.1:4180/
```

You can also keep using Python for a quick static preview:

```bash
python3 -m http.server 4180 --bind 127.0.0.1
```

## Railway

Railway runs the app with `npm start`. The server listens on the `PORT` environment variable that Railway injects and exposes `/health` for deployment health checks.

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
