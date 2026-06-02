import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import http from "node:http";

const root = fileURLToPath(new URL(".", import.meta.url));

async function loadLocalEnv() {
  try {
    const raw = await readFile(join(root, ".env"), "utf8");
    raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .forEach((line) => {
        const index = line.indexOf("=");
        const key = line.slice(0, index).trim();
        const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
        if (key && process.env[key] === undefined) process.env[key] = value;
      });
  } catch {}
}

await loadLocalEnv();

const port = Number(process.env.PORT || 4180);
const host = process.env.HOST || "0.0.0.0";

const googleClientId = process.env.GOOGLE_CLIENT_ID || "";
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
const googleTokenFile = resolve(process.env.GOOGLE_TOKEN_FILE || join(root, ".data/google-token.json"));
const googleScopes = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
];

const googleAuthUrl = "https://accounts.google.com/o/oauth2/v2/auth";
const googleTokenUrl = "https://oauth2.googleapis.com/token";
const googleCalendarApi = "https://www.googleapis.com/calendar/v3";
const oauthStateCookie = "sygma_google_oauth_state";

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

function googleConfigured() {
  return Boolean(googleClientId && googleClientSecret);
}

function requestOrigin(request) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  const proto = request.headers["x-forwarded-proto"] || (request.socket.encrypted ? "https" : "http");
  const requestHost = request.headers["x-forwarded-host"] || request.headers.host || `${host}:${port}`;
  return `${proto}://${requestHost}`;
}

function redirectUri(request) {
  return process.env.GOOGLE_REDIRECT_URI || `${requestOrigin(request)}/api/google/oauth/callback`;
}

function isSecureRequest(request) {
  return request.headers["x-forwarded-proto"] === "https" || Boolean(request.socket.encrypted);
}

function parseCookies(request) {
  return Object.fromEntries(
    String(request.headers.cookie || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        if (index === -1) return [part, ""];
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function setCookie(response, request, name, value, maxAgeSeconds = 600) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (isSecureRequest(request)) parts.push("Secure");
  response.setHeader("Set-Cookie", parts.join("; "));
}

function clearCookie(response, request, name) {
  setCookie(response, request, name, "", 0);
}

function sendJson(response, status, payload, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  response.end(JSON.stringify(payload));
}

function redirect(response, location, headers = {}) {
  response.writeHead(302, { Location: location, "Cache-Control": "no-store", ...headers });
  response.end();
}

function encodeState(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decodeState(value) {
  try {
    return JSON.parse(Buffer.from(String(value || ""), "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function safeReturnTo(value = "/") {
  try {
    const parsed = new URL(value, "http://local.invalid");
    if (parsed.origin !== "http://local.invalid") return "/";
    return `${parsed.pathname}${parsed.search}${parsed.hash}` || "/";
  } catch {
    return "/";
  }
}

function appendQuery(path, key, value) {
  const parsed = new URL(path, "http://local.invalid");
  parsed.searchParams.set(key, value);
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readJsonBody(request) {
  const raw = await readBody(request);
  return raw ? JSON.parse(raw) : {};
}

async function readToken() {
  try {
    return JSON.parse(await readFile(googleTokenFile, "utf8"));
  } catch {
    return null;
  }
}

async function writeToken(token) {
  await mkdir(dirname(googleTokenFile), { recursive: true });
  await writeFile(googleTokenFile, JSON.stringify(token, null, 2), { mode: 0o600 });
}

async function deleteToken() {
  try {
    await unlink(googleTokenFile);
  } catch {}
}

async function exchangeToken(params) {
  const response = await fetch(googleTokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error_description || payload.error || "Google token request failed");
  }
  return payload;
}

async function getGoogleAccessToken() {
  if (!googleConfigured()) throw Object.assign(new Error("Google OAuth is not configured"), { status: 501 });
  const token = await readToken();
  if (!token) throw Object.assign(new Error("Google is not connected"), { status: 401 });
  if (token.access_token && token.expires_at && token.expires_at > Date.now() + 60_000) {
    return token.access_token;
  }
  if (!token.refresh_token) throw Object.assign(new Error("Google refresh token is missing"), { status: 401 });
  const refreshed = await exchangeToken({
    client_id: googleClientId,
    client_secret: googleClientSecret,
    refresh_token: token.refresh_token,
    grant_type: "refresh_token",
  });
  const nextToken = {
    ...token,
    ...refreshed,
    refresh_token: refreshed.refresh_token || token.refresh_token,
    expires_at: Date.now() + Number(refreshed.expires_in || 3600) * 1000,
    updated_at: new Date().toISOString(),
  };
  await writeToken(nextToken);
  return nextToken.access_token;
}

async function googleFetch(path, options = {}) {
  const accessToken = await getGoogleAccessToken();
  const response = await fetch(`${googleCalendarApi}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(payload.error?.message || "Google Calendar API request failed"), { status: response.status });
  }
  return payload;
}

async function listGoogleCalendars() {
  const calendars = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({
      showHidden: "false",
      minAccessRole: "reader",
      maxResults: "250",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const payload = await googleFetch(`/users/me/calendarList?${params}`);
    calendars.push(...(payload.items || []));
    pageToken = payload.nextPageToken || "";
  } while (pageToken);
  return calendars;
}

async function listGoogleCalendarEvents(calendarId, query) {
  const payload = await googleFetch(`/calendars/${encodeURIComponent(calendarId)}/events?${query}`);
  return payload.items || [];
}

async function handleGoogleStatus(response) {
  const token = await readToken();
  sendJson(response, 200, {
    configured: googleConfigured(),
    connected: Boolean(token?.refresh_token || token?.access_token),
    connectedAt: token?.created_at || "",
    updatedAt: token?.updated_at || "",
  });
}

function handleGoogleAuthStart(request, response, requestUrl) {
  if (!googleConfigured()) {
    sendJson(response, 501, { error: "Google OAuth server credentials are not configured." });
    return;
  }
  const nonce = randomBytes(24).toString("base64url");
  const returnTo = safeReturnTo(requestUrl.searchParams.get("returnTo") || "/");
  const state = encodeState({ nonce, returnTo });
  const params = new URLSearchParams({
    client_id: googleClientId,
    redirect_uri: redirectUri(request),
    response_type: "code",
    scope: googleScopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  setCookie(response, request, oauthStateCookie, nonce);
  redirect(response, `${googleAuthUrl}?${params}`);
}

async function handleGoogleCallback(request, response, requestUrl) {
  const state = decodeState(requestUrl.searchParams.get("state"));
  const code = requestUrl.searchParams.get("code");
  const cookies = parseCookies(request);
  clearCookie(response, request, oauthStateCookie);
  if (!state?.nonce || state.nonce !== cookies[oauthStateCookie] || !code) {
    redirect(response, appendQuery(safeReturnTo(state?.returnTo), "google", "failed"));
    return;
  }
  try {
    const token = await exchangeToken({
      client_id: googleClientId,
      client_secret: googleClientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri(request),
    });
    const previousToken = await readToken();
    const nextToken = {
      ...previousToken,
      ...token,
      refresh_token: token.refresh_token || previousToken?.refresh_token || "",
      expires_at: Date.now() + Number(token.expires_in || 3600) * 1000,
      created_at: previousToken?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await writeToken(nextToken);
    redirect(response, appendQuery(safeReturnTo(state.returnTo), "google", "connected"));
  } catch {
    redirect(response, appendQuery(safeReturnTo(state.returnTo), "google", "failed"));
  }
}

async function handleGoogleCalendarData(requestUrl, response) {
  const timeMin = requestUrl.searchParams.get("timeMin");
  const timeMax = requestUrl.searchParams.get("timeMax");
  if (!timeMin || !timeMax) {
    sendJson(response, 400, { error: "timeMin and timeMax are required." });
    return;
  }
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "2500",
  });
  const calendars = await listGoogleCalendars();
  const eventGroups = await Promise.all(
    calendars.map(async (calendar) => {
      const events = await listGoogleCalendarEvents(calendar.id, params).catch(() => []);
      return events.map((event) => ({ calendar, event }));
    })
  );
  sendJson(response, 200, { calendars, events: eventGroups.flat() });
}

async function handleGoogleEventInsert(request, response) {
  const body = await readJsonBody(request);
  const calendarId = body.calendarId || "primary";
  const event = body.event || {};
  if (!event.summary || !event.start || !event.end) {
    sendJson(response, 400, { error: "summary, start, and end are required." });
    return;
  }
  const created = await googleFetch(`/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: "POST",
    body: JSON.stringify(event),
  });
  sendJson(response, 200, { calendarId, event: created });
}

async function handleGoogleDisconnect(response) {
  await deleteToken();
  sendJson(response, 200, { ok: true });
}

async function handleApiRequest(request, response, requestUrl) {
  try {
    if (request.method === "GET" && requestUrl.pathname === "/api/google/status") {
      await handleGoogleStatus(response);
      return true;
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/google/auth/start") {
      handleGoogleAuthStart(request, response, requestUrl);
      return true;
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/google/oauth/callback") {
      await handleGoogleCallback(request, response, requestUrl);
      return true;
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/google/calendar-data") {
      await handleGoogleCalendarData(requestUrl, response);
      return true;
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/google/events") {
      await handleGoogleEventInsert(request, response);
      return true;
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/google/disconnect") {
      await handleGoogleDisconnect(response);
      return true;
    }
    if (requestUrl.pathname.startsWith("/api/")) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
  } catch (error) {
    sendJson(response, error.status || 500, { error: error.message || "Server error" });
    return true;
  }
  return false;
}

function resolveRequestPath(url) {
  const { pathname } = new URL(url, `http://${host}:${port}`);
  const decoded = decodeURIComponent(pathname);
  const requested = decoded === "/" ? "/index.html" : decoded;
  const absolute = resolve(join(root, normalize(requested)));
  return absolute.startsWith(root) ? absolute : "";
}

async function sendFile(response, filePath) {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) throw new Error("Not a file");
  response.writeHead(200, {
    "Content-Length": fileStat.size,
    "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream",
  });
  createReadStream(filePath).pipe(response);
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url || "/", requestOrigin(request));

  if (requestUrl.pathname === "/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (await handleApiRequest(request, response, requestUrl)) return;

  const filePath = resolveRequestPath(request.url || "/");
  if (!filePath) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  try {
    await sendFile(response, filePath);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.listen(port, host, () => {
  console.log(`Personal Web listening on ${host}:${port}`);
});
