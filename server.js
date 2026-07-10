import { createReadStream, existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import http from "node:http";
import { promisify } from "node:util";
import { brotliCompress, constants as zlibConstants, gzip } from "node:zlib";
import { createStorage } from "./server/storage.js";

const root = fileURLToPath(new URL(".", import.meta.url));

async function loadLocalEnv() {
  try {
    const raw = await readFile(join(root, ".env"), "utf8");
    for (const rawLine of raw.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const index = line.indexOf("=");
      const key = line.slice(0, index).trim();
      const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  } catch {}
}

await loadLocalEnv();

const builtStaticRoot = resolve(root, "dist/client");
const staticRoot = process.env.STATIC_ROOT
  ? resolve(root, process.env.STATIC_ROOT)
  : existsSync(join(builtStaticRoot, "index.html"))
    ? builtStaticRoot
    : resolve(root);
const port = Number(process.env.PORT || 4180);
const host = process.env.HOST || "0.0.0.0";
const databaseUrl = process.env.DATABASE_URL || "";
const appStateId = process.env.APP_STATE_ID || "default";

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
let storage;

try {
  storage = createStorage({ databaseUrl, appStateId, googleTokenFile });
} catch (error) {
  console.error(error.message || "PostgreSQL storage initialization failed.");
  process.exit(1);
}

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
  const cookies = Object.create(null);
  for (const rawPart of String(request.headers.cookie || "").split(";")) {
    const part = rawPart.trim();
    if (!part) continue;
    const index = part.indexOf("=");
    if (index === -1) {
      cookies[part] = "";
      continue;
    }
    cookies[part.slice(0, index)] = decodeURIComponent(part.slice(index + 1));
  }
  return cookies;
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
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  response.end(JSON.stringify(payload));
}

function redirect(response, location, headers = {}) {
  response.writeHead(302, { Location: location, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers });
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

async function readBody(request, limit = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("Request body too large"), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readJsonBody(request, limit) {
  const raw = await readBody(request, limit);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error("Invalid JSON body."), { status: 400 });
  }
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
  const token = await storage.readToken();
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
  await storage.writeToken(nextToken);
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
  const token = await storage.readToken();
  sendJson(response, 200, {
    configured: googleConfigured(),
    connected: Boolean(token?.refresh_token || token?.access_token),
    connectedAt: token?.created_at || "",
    updatedAt: token?.updated_at || "",
    tokenStore: "postgresql",
  });
}

async function handleStateStatus(response) {
  try {
    sendJson(response, 200, await storage.stateStatus());
  } catch (error) {
    sendJson(response, error.status || 500, {
      configured: true,
      connected: false,
      appStateId: storage.appStateId,
      error: error.message || "PostgreSQL connection failed.",
    });
  }
}

async function handleStateRead(response) {
  const payload = await storage.readAppState();
  sendJson(response, 200, {
    configured: true,
    connected: true,
    appStateId: storage.appStateId,
    ...payload,
  });
}

async function handleStateWrite(request, response) {
  const body = await readJsonBody(request, 10_000_000);
  if (!body.state || typeof body.state !== "object" || Array.isArray(body.state)) {
    sendJson(response, 400, { error: "state object is required." });
    return;
  }
  const saved = await storage.writeAppState(body.state);
  sendJson(response, 200, {
    ok: true,
    configured: true,
    connected: true,
    appStateId: storage.appStateId,
    ...saved,
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
    const previousToken = await storage.readToken();
    const nextToken = {
      ...previousToken,
      ...token,
      refresh_token: token.refresh_token || previousToken?.refresh_token || "",
      expires_at: Date.now() + Number(token.expires_in || 3600) * 1000,
      created_at: previousToken?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await storage.writeToken(nextToken);
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
  const eventRequests = [];
  for (const calendar of calendars) {
    eventRequests.push(listGoogleCalendarEvents(calendar.id, params).catch(() => []));
  }
  const eventGroups = await Promise.all(eventRequests);
  const events = [];
  for (let index = 0; index < eventGroups.length; index += 1) {
    const calendar = calendars[index];
    const calendarEvents = eventGroups[index];
    for (const event of calendarEvents) {
      events.push({ calendar, event });
    }
  }
  sendJson(response, 200, { calendars, events });
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
  await storage.deleteToken();
  sendJson(response, 200, { ok: true });
}

async function handleApiRequest(request, response, requestUrl) {
  try {
    if (request.method === "GET" && requestUrl.pathname === "/api/state/status") {
      await handleStateStatus(response);
      return true;
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/state") {
      await handleStateRead(response);
      return true;
    }
    if ((request.method === "PUT" || request.method === "POST") && requestUrl.pathname === "/api/state") {
      await handleStateWrite(request, response);
      return true;
    }
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
  const absolute = resolve(join(staticRoot, normalize(requested)));
  return absolute === staticRoot || absolute.startsWith(`${staticRoot}${sep}`) ? absolute : "";
}

const compressibleExtensions = new Set([".css", ".html", ".js", ".json", ".md", ".svg", ".txt"]);
const compressedStaticCache = new Map();
const brotliCompressAsync = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

function responseEncoding(request, extension, size) {
  if (size < 1024 || !compressibleExtensions.has(extension)) return "";
  const accepted = String(request.headers["accept-encoding"] || "").toLowerCase();
  if (accepted.includes("br")) return "br";
  if (accepted.includes("gzip")) return "gzip";
  return "";
}

async function compressedStaticFile(filePath, fileStat, encoding) {
  const key = `${filePath}:${fileStat.size}:${Math.trunc(fileStat.mtimeMs)}:${encoding}`;
  const cached = compressedStaticCache.get(key);
  if (cached) return cached;
  const source = await readFile(filePath);
  const compressed = encoding === "br"
    ? await brotliCompressAsync(source, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 } })
    : await gzipAsync(source, { level: 6 });
  if (compressedStaticCache.size >= 32) compressedStaticCache.clear();
  compressedStaticCache.set(key, compressed);
  return compressed;
}

async function sendFile(request, response, requestUrl, filePath) {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) throw new Error("Not a file");
  const extension = extname(filePath);
  const encoding = responseEncoding(request, extension, fileStat.size);
  const etag = `\"${fileStat.size.toString(16)}-${Math.trunc(fileStat.mtimeMs).toString(16)}\"`;
  const headers = {
    "Content-Type": contentTypes[extension] || "application/octet-stream",
    "Cache-Control": staticCacheControl(filePath, requestUrl),
    ETag: etag,
    Vary: "Accept-Encoding",
    "X-Content-Type-Options": "nosniff",
  };
  if (request.headers["if-none-match"] === etag) {
    response.writeHead(304, headers);
    response.end();
    return;
  }
  if (encoding) headers["Content-Encoding"] = encoding;
  else headers["Content-Length"] = fileStat.size;
  response.writeHead(200, headers);
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  if (encoding) {
    response.end(await compressedStaticFile(filePath, fileStat, encoding));
    return;
  }
  createReadStream(filePath).pipe(response);
}

function staticCacheControl(filePath, requestUrl) {
  const name = filePath.slice(staticRoot.length).replace(/^[/\\]+/, "");
  if (name === "index.html" || name === "service-worker.js" || name === "manifest.json") return "no-store";
  if (/^assets\/[^/]+\.[a-f0-9]{10,}\./.test(name)) return "public, max-age=31536000, immutable";
  if (requestUrl.searchParams.has("v")) return "public, max-age=31536000, immutable";
  return "public, max-age=3600";
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url || "/", requestOrigin(request));

  if (requestUrl.pathname === "/health") {
    try {
      await storage.stateStatus();
      sendJson(response, 200, { ok: true, database: "postgresql" });
    } catch (error) {
      sendJson(response, error.status || 503, { ok: false, error: error.message || "PostgreSQL connection failed." });
    }
    return;
  }

  if (await handleApiRequest(request, response, requestUrl)) return;

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      Allow: "GET, HEAD",
    });
    response.end("Method not allowed");
    return;
  }

  const filePath = resolveRequestPath(request.url || "/");
  if (!filePath) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    response.end("Forbidden");
    return;
  }

  try {
    await sendFile(request, response, requestUrl, filePath);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    response.end("Not found");
  }
});

try {
  await storage.ready();
  server.listen(port, host, () => {
    console.log(`Personal Web listening on ${host}:${port}`);
  });
} catch (error) {
  console.error(error.message || "PostgreSQL initialization failed.");
  await storage.end().catch(() => {});
  process.exit(1);
}
