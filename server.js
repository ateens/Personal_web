import { createReadStream, existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import http from "node:http";
import { isIP } from "node:net";
import { promisify } from "node:util";
import { brotliCompress, constants as zlibConstants, gzip } from "node:zlib";
import { deploymentSecurityPolicy } from "./server/deployment-security.js";
import { createStorage } from "./server/storage.js";

const root = fileURLToPath(new URL(".", import.meta.url));
const sourceStaticRoot = resolve(root);
const assetProxyPrefix = "/_sygma/assets/";
const sourceStaticFiles = new Set([
  "/app.js",
  "/index.html",
  "/manifest.json",
  "/service-worker.js",
  "/styles.css",
  "/assets/sygma-social-preview.png",
]);
const STATE_VERSION = 4;
const STATE_BODY_LIMIT = 5_000_000;
const MAX_STATE_DEPTH = 32;
const MAX_STATE_NODES = 200_000;
const MAX_ARRAY_ITEMS = 20_000;
const MAX_COLLECTION_ITEMS = 50_000;
const MAX_STRING_LENGTH = 250_000;
const MAX_ID_LENGTH = 256;
const MAX_BLOCKS_PER_ITEM = 5_000;
const MAX_BLOCK_INDENT = 32;
const MAX_MARKS_PER_BLOCK = 1_000;
const MAX_RESOURCE_CHILDREN = 5_000;
const MAX_COMMENT_THREADS_PER_RESOURCE = 1_000;
const MAX_COMMENT_REPLIES_PER_THREAD = 500;
const MAX_COMMENT_BODY_LENGTH = 20_000;
const MAX_VALIDATION_ISSUES = 24;
const REQUIRED_COLLECTION_KEYS = [
  "captures",
  "boxes",
  "goals",
  "projects",
  "tasks",
  "resources",
  "habits",
  "habitInstances",
  "journals",
  "googleCalendars",
  "googleEvents",
  "links",
];
const PRIMARY_COLLECTION_KEYS = ["captures", "boxes", "goals", "projects", "tasks", "resources", "habits", "journals"];
const BLOCK_COLLECTION_KEYS = new Set(["boxes", "goals", "projects", "tasks", "resources", "habits", "journals"]);
const SUPPORTED_BLOCK_TYPES = new Set([
  "paragraph",
  "heading1",
  "heading2",
  "heading3",
  "bullet",
  "numbered",
  "todo",
  "toggle",
  "quote",
  "callout",
  "divider",
  "code",
]);
const SUPPORTED_MARK_TYPES = new Set(["bold", "italic", "underline", "strike", "code", "comment", "mention", "equation", "link"]);
const SUPPORTED_RESOURCE_FONTS = new Set(["default", "serif", "mono"]);
const SUPPORTED_COMMENT_SCOPES = new Set(["page", "inline"]);
const RELATION_COLLECTION_ALIASES = new Map([
  ["capture", "captures"],
  ["box", "boxes"],
  ["goal", "goals"],
  ["project", "projects"],
  ["task", "tasks"],
  ["resource", "resources"],
  ["habit", "habits"],
  ["journal", "journals"],
  ["captures", "captures"],
  ["boxes", "boxes"],
  ["goals", "goals"],
  ["projects", "projects"],
  ["tasks", "tasks"],
  ["resources", "resources"],
  ["habits", "habits"],
  ["journals", "journals"],
]);
const API_PROXY_AUTH_PRIVATE_DATA_KEY = "api_proxy_auth";
const API_PROXY_AUTH_CONFIG_VERSION = 1;
const API_PROXY_AUTH_TOKEN_MIN_LENGTH = 32;
const API_PROXY_AUTH_TOKEN_MAX_LENGTH = 512;

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

const builtStaticRoot = resolve(sourceStaticRoot, "dist/client");
const staticRoot = process.env.STATIC_ROOT
  ? resolve(sourceStaticRoot, process.env.STATIC_ROOT)
  : existsSync(join(builtStaticRoot, "index.html"))
    ? builtStaticRoot
    : sourceStaticRoot;
const port = Number(process.env.PORT || 4180);
const host = process.env.HOST || "0.0.0.0";
const databaseUrl = process.env.DATABASE_URL || "";
const appStateId = process.env.APP_STATE_ID || "default";
const deploymentSecurity = deploymentSecurityPolicy(process.env);
const requireStatePrecondition = deploymentSecurity.forceStatePrecondition || envFlag("REQUIRE_STATE_PRECONDITION");
const failClosedApiAuth = deploymentSecurity.forceApiAuth || envFlag("FAIL_CLOSED_API_AUTH");
const apiBearerToken = process.env.API_BEARER_TOKEN || "";
const configuredApiBearerTokenSha256 = deploymentSecurity.apiBearerTokenSha256
  || String(process.env.API_BEARER_TOKEN_SHA256 || "").trim();
const apiBearerTokenDigest = configuredApiBearerTokenSha256
  ? parseSha256Digest(configuredApiBearerTokenSha256)
  : apiBearerToken
    ? tokenDigest(apiBearerToken)
    : null;
const apiProxyAuthCacheTtlMs = envInteger("API_PROXY_AUTH_CACHE_TTL_MS", 1_000, 100, 5_000);
const trustProxyIpHeaders = envFlag("TRUST_PROXY_IP_HEADERS");
const apiRateLimitWindowMs = envInteger("API_RATE_LIMIT_WINDOW_MS", 60_000, 100, 3_600_000);
const apiRateLimitStateReadMax = envInteger("API_RATE_LIMIT_STATE_READ_MAX", 240, 0, 100_000);
const apiRateLimitStateWriteMax = envInteger("API_RATE_LIMIT_STATE_WRITE_MAX", 120, 0, 100_000);
const apiRateLimitGoogleMutationMax = envInteger("API_RATE_LIMIT_GOOGLE_MUTATION_MAX", 20, 0, 100_000);
const apiRateLimitMaxKeys = envInteger("API_RATE_LIMIT_MAX_KEYS", 10_000, 1, 100_000);
const stateWriteMaxConcurrency = envInteger("STATE_WRITE_MAX_CONCURRENCY", 2, 1, 32);
const stateWriteMaxQueue = envInteger("STATE_WRITE_MAX_QUEUE", 16, 0, 1_000);
const stateWriteQueueTimeoutMs = envInteger("STATE_WRITE_QUEUE_TIMEOUT_MS", 10_000, 100, 120_000);

const requestIdSymbol = Symbol("requestId");
const apiOperationSymbol = Symbol("apiOperation");
const rateLimitBuckets = new Map();
const stateWriteQueue = [];
let rateLimitChecks = 0;
let activeStateWrites = 0;
let apiProxyAuthCache = null;
let apiProxyAuthRefresh = null;
let apiProxyAuthCacheGeneration = 0;

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
  ".png": "image/png",
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

function envFlag(name) {
  return /^(1|true|yes|on)$/i.test(String(process.env[name] || ""));
}

function envInteger(name, fallback, minimum, maximum) {
  const raw = String(process.env[name] ?? "").trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

function apiOperation(request, requestUrl) {
  const method = String(request.method || "GET").toUpperCase();
  const pathname = requestUrl.pathname;
  if (method === "GET" && pathname === "/api/state/status") return "state.status";
  if (method === "GET" && pathname === "/api/state") return "state.read";
  if ((method === "PUT" || method === "POST") && pathname === "/api/state") return "state.write";
  if (method === "PUT" && /^\/api\/resources\/[^/]+$/.test(pathname)) return "resource.write";
  if (method === "GET" && pathname === "/api/google/status") return "google.status";
  if (method === "GET" && pathname === "/api/google/auth/start") return "google.connect.start";
  if (method === "GET" && pathname === "/api/google/oauth/callback") return "google.connect.callback";
  if (method === "GET" && pathname === "/api/google/calendar-data") return "google.calendar.read";
  if (method === "POST" && pathname === "/api/google/events") return "google.event.insert";
  if (method === "POST" && pathname === "/api/google/disconnect") return "google.disconnect";
  return pathname.startsWith("/api/") ? "api.unknown" : "";
}

function operationRateLimit(operation) {
  if (operation === "state.status" || operation === "state.read") return apiRateLimitStateReadMax;
  if (
    operation === "state.write"
    || operation === "resource.write"
    || operation === "google.connect.start"
    || operation === "google.connect.callback"
    || operation === "google.event.insert"
    || operation === "google.disconnect"
  ) {
    return operation === "state.write" || operation === "resource.write" ? apiRateLimitStateWriteMax : apiRateLimitGoogleMutationMax;
  }
  return 0;
}

function normalizedIpAddress(value) {
  let candidate = String(value || "").trim();
  if (!candidate || candidate.length > 128 || /[\u0000-\u001f\u007f]/.test(candidate)) return "";
  if (candidate.startsWith("[") && candidate.includes("]")) candidate = candidate.slice(1, candidate.indexOf("]"));
  if (candidate.toLowerCase().startsWith("::ffff:") && isIP(candidate.slice(7)) === 4) candidate = candidate.slice(7);
  return isIP(candidate) ? candidate.toLowerCase() : "";
}

function requestClientKey(request) {
  if (trustProxyIpHeaders) {
    const forwarded = String(request.headers["x-forwarded-for"] || "").split(",", 1)[0];
    const proxyAddress = normalizedIpAddress(forwarded)
      || normalizedIpAddress(request.headers["cf-connecting-ip"])
      || normalizedIpAddress(request.headers["x-real-ip"]);
    if (proxyAddress) return proxyAddress;
  }
  return normalizedIpAddress(request.socket?.remoteAddress) || "unknown-socket";
}

function auditScalar(value, fallback = "") {
  const candidate = String(value ?? "");
  return /^[a-zA-Z0-9_.:-]{1,64}$/.test(candidate) ? candidate : fallback;
}

function auditEvent(request, event, details = {}) {
  const record = {
    timestamp: new Date().toISOString(),
    type: "audit",
    event: auditScalar(event, "unknown"),
    requestId: auditScalar(request?.[requestIdSymbol], "unassigned"),
    operation: auditScalar(request?.[apiOperationSymbol], "api.unknown"),
    method: auditScalar(String(request?.method || "UNKNOWN").toUpperCase(), "UNKNOWN"),
  };
  for (const field of ["outcome", "reason", "code", "concurrency"]) {
    const value = auditScalar(details[field]);
    if (value) record[field] = value;
  }
  for (const field of ["status", "revision", "issueCount", "retryAfter"]) {
    const value = Number(details[field]);
    if (Number.isSafeInteger(value) && value >= 0) record[field] = value;
  }
  console.info(JSON.stringify(record));
}

function cleanupRateLimitBuckets(now, force = false) {
  rateLimitChecks += 1;
  if (!force && rateLimitChecks % 256 !== 0) return;
  for (const [key, bucket] of rateLimitBuckets) {
    if (now - bucket.windowStartedAt >= apiRateLimitWindowMs) rateLimitBuckets.delete(key);
  }
}

function apiRateLimitDecision(request, operation) {
  const limit = operationRateLimit(operation);
  if (limit === 0) return { allowed: true };
  const now = Date.now();
  cleanupRateLimitBuckets(now);
  const key = JSON.stringify([requestClientKey(request), operation]);
  let bucket = rateLimitBuckets.get(key);
  if (bucket && now - bucket.windowStartedAt >= apiRateLimitWindowMs) {
    rateLimitBuckets.delete(key);
    bucket = null;
  }
  if (!bucket) {
    if (rateLimitBuckets.size >= apiRateLimitMaxKeys) {
      cleanupRateLimitBuckets(now, true);
      if (rateLimitBuckets.size >= apiRateLimitMaxKeys) {
        return {
          allowed: false,
          reason: "capacity",
          retryAfterSeconds: Math.max(1, Math.ceil(apiRateLimitWindowMs / 1_000)),
        };
      }
    }
    rateLimitBuckets.set(key, { count: 1, windowStartedAt: now });
    return { allowed: true };
  }
  bucket.count = Math.min(Number.MAX_SAFE_INTEGER, bucket.count + 1);
  if (bucket.count <= limit) return { allowed: true };
  const remainingMs = Math.max(1, apiRateLimitWindowMs - (now - bucket.windowStartedAt));
  return {
    allowed: false,
    reason: "route_limit",
    retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1_000)),
  };
}

function enforceApiRateLimit(request, response, operation) {
  const decision = apiRateLimitDecision(request, operation);
  if (decision.allowed) return false;
  auditEvent(request, "api.rate_limited", {
    status: 429,
    code: "API_RATE_LIMITED",
    reason: decision.reason,
    retryAfter: decision.retryAfterSeconds,
  });
  sendJson(
    response,
    429,
    { error: "Too many requests.", code: "API_RATE_LIMITED" },
    { "Retry-After": String(decision.retryAfterSeconds) }
  );
  return true;
}

function stateWriteCapacityError(reason) {
  return Object.assign(
    apiError(429, "STATE_WRITE_BUSY", "State write capacity is temporarily busy."),
    {
      retryAfter: Math.max(1, Math.ceil(stateWriteQueueTimeoutMs / 1_000)),
      capacityReason: reason,
    }
  );
}

function stateWriteRelease() {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = stateWriteQueue.shift();
    if (next) {
      clearTimeout(next.timer);
      next.resolve(stateWriteRelease());
      return;
    }
    activeStateWrites = Math.max(0, activeStateWrites - 1);
  };
}

function acquireStateWriteSlot() {
  if (activeStateWrites < stateWriteMaxConcurrency) {
    activeStateWrites += 1;
    return Promise.resolve(stateWriteRelease());
  }
  if (stateWriteQueue.length >= stateWriteMaxQueue) return Promise.reject(stateWriteCapacityError("queue_full"));
  return new Promise((resolve, reject) => {
    const queued = { resolve, timer: null };
    queued.timer = setTimeout(() => {
      const index = stateWriteQueue.indexOf(queued);
      if (index !== -1) stateWriteQueue.splice(index, 1);
      reject(stateWriteCapacityError("queue_timeout"));
    }, stateWriteQueueTimeoutMs);
    queued.timer.unref?.();
    stateWriteQueue.push(queued);
  });
}

function applySecurityHeaders(request, response) {
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'"
  );
  response.setHeader("Referrer-Policy", "same-origin");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (isSecureRequest(request)) response.setHeader("Strict-Transport-Security", "max-age=31536000");
}

function apiError(status, code, message, details = undefined) {
  return Object.assign(new Error(message), { status, code, expose: true, details });
}

function sendApiError(response, error) {
  const status = Number.isInteger(error?.status) && error.status >= 400 && error.status < 600 ? error.status : 500;
  const exposed = error?.expose === true;
  const payload = {
    error: exposed ? error?.message || "Request failed." : status >= 500 ? "Internal server error." : "Request failed.",
    code: exposed ? error?.code || "REQUEST_FAILED" : status >= 500 ? "INTERNAL_ERROR" : "REQUEST_FAILED",
  };
  if (exposed && error?.details !== undefined) payload.details = error.details;
  if (Number.isSafeInteger(error?.revision)) payload.revision = error.revision;
  if (Number.isSafeInteger(error?.details?.revision)) payload.revision = error.details.revision;
  const headers = Number.isSafeInteger(payload.revision) ? stateRevisionHeaders(payload.revision) : {};
  if (status === 429 && Number.isSafeInteger(error?.retryAfter) && error.retryAfter > 0) {
    headers["Retry-After"] = String(error.retryAfter);
  }
  sendJson(response, status, payload, headers);
}

function tokenDigest(value) {
  return createHash("sha256").update(String(value || ""), "utf8").digest();
}

function parseSha256Digest(value) {
  const normalized = String(value || "").trim().replace(/^sha256:/i, "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) return null;
  return Buffer.from(normalized, "hex");
}

function suppliedBearerToken(request) {
  const authorization = String(request.headers.authorization || "");
  if (!authorization.startsWith("Bearer ")) return "";
  return authorization.slice(7);
}

function bearerTokenMatchesDigest(request, expectedDigest) {
  const suppliedDigest = tokenDigest(suppliedBearerToken(request));
  return timingSafeEqual(suppliedDigest, expectedDigest);
}

function validProxyAuthConfiguration(value) {
  return isPlainObject(value)
    && value.version === API_PROXY_AUTH_CONFIG_VERSION
    && typeof value.token === "string"
    && value.token.length >= API_PROXY_AUTH_TOKEN_MIN_LENGTH
    && value.token.length <= API_PROXY_AUTH_TOKEN_MAX_LENGTH
    && typeof value.enforced === "boolean";
}

function proxyAuthPolicyFromStoredData(value) {
  if (value === null || value === undefined) return { mode: "disabled" };
  if (!validProxyAuthConfiguration(value)) return { mode: "misconfigured" };
  if (!value.enforced) return { mode: "disabled" };
  return { mode: "enforced", tokenDigest: tokenDigest(value.token) };
}

function invalidateApiProxyAuthCache() {
  apiProxyAuthCacheGeneration += 1;
  apiProxyAuthCache = null;
  apiProxyAuthRefresh = null;
}

async function readApiProxyAuthPolicy() {
  const now = Date.now();
  if (apiProxyAuthCache && apiProxyAuthCache.expiresAt > now) return apiProxyAuthCache.policy;
  if (apiProxyAuthRefresh) return apiProxyAuthRefresh;

  const generation = apiProxyAuthCacheGeneration;
  const refresh = (async () => {
    let policy;
    try {
      const stored = await storage.readPrivateData(API_PROXY_AUTH_PRIVATE_DATA_KEY);
      policy = proxyAuthPolicyFromStoredData(stored.data);
    } catch {
      policy = { mode: "unavailable" };
    }
    if (generation === apiProxyAuthCacheGeneration) {
      apiProxyAuthCache = {
        expiresAt: Date.now() + apiProxyAuthCacheTtlMs,
        policy,
      };
    }
    return policy;
  })();
  apiProxyAuthRefresh = refresh;

  try {
    return await refresh;
  } finally {
    if (apiProxyAuthRefresh === refresh) apiProxyAuthRefresh = null;
  }
}

function denyApiAuthentication(request, response, status, code, reason) {
  auditEvent(request, "auth.denied", {
    status,
    code,
    reason,
    outcome: "denied",
  });
  if (status === 401) {
    sendJson(response, 401, { error: "Authentication is required.", code }, { "WWW-Authenticate": "Bearer" });
  } else {
    sendJson(response, 503, { error: "API access is temporarily unavailable.", code });
  }
  return true;
}

async function enforceApiAuthentication(request, response, requestUrl) {
  if (!requestUrl.pathname.startsWith("/api/")) return false;
  if (requestUrl.pathname === "/api/google/oauth/callback") return false;

  // The deployment-time environment switch is the authoritative override and
  // deliberately bypasses the database policy, preserving its fail-closed behavior.
  if (failClosedApiAuth) {
    if (!apiBearerTokenDigest) {
      return denyApiAuthentication(request, response, 503, "API_AUTH_NOT_CONFIGURED", "server_misconfigured");
    }
    if (bearerTokenMatchesDigest(request, apiBearerTokenDigest)) return false;
    return denyApiAuthentication(request, response, 401, "AUTH_REQUIRED", "invalid_or_missing_credential");
  }

  const policy = await readApiProxyAuthPolicy();
  if (policy.mode === "disabled") return false;
  if (policy.mode !== "enforced") {
    return denyApiAuthentication(
      request,
      response,
      503,
      "API_AUTH_NOT_CONFIGURED",
      policy.mode === "unavailable" ? "auth_store_unavailable" : "server_misconfigured",
    );
  }
  if (bearerTokenMatchesDigest(request, policy.tokenDigest)) return false;
  return denyApiAuthentication(request, response, 401, "AUTH_REQUIRED", "invalid_or_missing_credential");
}

process.on("SIGHUP", invalidateApiProxyAuthCache);

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
    if (size > limit) throw apiError(413, "REQUEST_BODY_TOO_LARGE", "Request body too large.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readJsonBody(request, limit) {
  const contentType = String(request.headers["content-type"] || "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    throw apiError(415, "JSON_CONTENT_TYPE_REQUIRED", "Content-Type must be application/json.");
  }
  const raw = await readBody(request, limit);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(apiError(400, "INVALID_JSON", "Invalid JSON body."), { status: 400 });
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function addValidationIssue(issues, path, code, message) {
  if (issues.length >= MAX_VALIDATION_ISSUES) return;
  issues.push({ path, code, message });
}

function validateStateTree(value, issues, path = "state", depth = 0, counter = { nodes: 0 }) {
  counter.nodes += 1;
  if (counter.nodes > MAX_STATE_NODES) {
    addValidationIssue(issues, path, "too_many_nodes", `State exceeds ${MAX_STATE_NODES} values.`);
    return;
  }
  if (depth > MAX_STATE_DEPTH) {
    addValidationIssue(issues, path, "too_deep", `State depth exceeds ${MAX_STATE_DEPTH}.`);
    return;
  }
  if (typeof value === "string") {
    if (value.length > MAX_STRING_LENGTH) addValidationIssue(issues, path, "string_too_long", `String exceeds ${MAX_STRING_LENGTH} characters.`);
    return;
  }
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_ITEMS) addValidationIssue(issues, path, "array_too_large", `Array exceeds ${MAX_ARRAY_ITEMS} items.`);
    for (let index = 0; index < value.length && issues.length < MAX_VALIDATION_ISSUES; index += 1) {
      validateStateTree(value[index], issues, `${path}[${index}]`, depth + 1, counter);
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (issues.length >= MAX_VALIDATION_ISSUES) break;
    validateStateTree(child, issues, `${path}.${key}`, depth + 1, counter);
  }
}

function validEntityId(value) {
  return typeof value === "string" && value.trim() !== "" && value.length <= MAX_ID_LENGTH && !/[\u0000-\u001f\u007f]/.test(value);
}

function registerUniqueId(seenIds, issues, id, path) {
  if (!validEntityId(id)) {
    addValidationIssue(issues, path, "invalid_id", `ID must be a non-empty string of at most ${MAX_ID_LENGTH} characters.`);
    return false;
  }
  const previous = seenIds.get(id);
  if (previous) {
    addValidationIssue(issues, path, "duplicate_id", `ID duplicates ${previous}.`);
    return false;
  }
  seenIds.set(id, path);
  return true;
}

function isSafeStoredUrl(value) {
  if (value === undefined || value === null || value === "") return true;
  if (typeof value !== "string" || /[\u0000-\u001f\u007f\s]/.test(value.trim())) return false;
  const raw = value.trim();
  const scheme = raw.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase() || "";
  if (!scheme) return true;
  if (!["http", "https", "mailto", "tel"].includes(scheme)) return false;
  if (scheme === "http" || scheme === "https") {
    try {
      const parsed = new URL(raw);
      return parsed.protocol === `${scheme}:` && Boolean(parsed.hostname);
    } catch {
      return false;
    }
  }
  return raw.length > scheme.length + 1;
}

function isSafeHttpsCoverUrl(value) {
  if (value === "") return true;
  if (typeof value !== "string" || value !== value.trim() || /[\u0000-\u001f\u007f\s]/.test(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

function validateBlocks(item, collectionKey, itemIndex, seenIds, issues) {
  const path = `state.${collectionKey}[${itemIndex}].blocks`;
  if (item.blocks === undefined && collectionKey !== "resources") return;
  if (!Array.isArray(item.blocks)) {
    addValidationIssue(issues, path, "invalid_blocks", "blocks must be an array.");
    return;
  }
  if (item.blocks.length > MAX_BLOCKS_PER_ITEM) {
    addValidationIssue(issues, path, "too_many_blocks", `blocks exceeds ${MAX_BLOCKS_PER_ITEM} entries.`);
  }
  for (let index = 0; index < item.blocks.length && issues.length < MAX_VALIDATION_ISSUES; index += 1) {
    const block = item.blocks[index];
    const blockPath = `${path}[${index}]`;
    if (!isPlainObject(block)) {
      addValidationIssue(issues, blockPath, "invalid_block", "Block must be an object.");
      continue;
    }
    registerUniqueId(seenIds, issues, block.id, `${blockPath}.id`);
    if (!SUPPORTED_BLOCK_TYPES.has(block.type)) {
      addValidationIssue(issues, `${blockPath}.type`, "unsupported_block_type", "Unsupported Resource block type.");
    }
    if (typeof block.text !== "string") addValidationIssue(issues, `${blockPath}.text`, "invalid_block_text", "Block text must be a string.");
    const indent = block.indent === undefined ? 0 : block.indent;
    if (!Number.isInteger(indent) || indent < 0 || indent > MAX_BLOCK_INDENT) {
      addValidationIssue(issues, `${blockPath}.indent`, "invalid_indent", `Block indent must be between 0 and ${MAX_BLOCK_INDENT}.`);
    }
    if (block.marks === undefined) continue;
    if (!Array.isArray(block.marks)) {
      addValidationIssue(issues, `${blockPath}.marks`, "invalid_marks", "marks must be an array.");
      continue;
    }
    if (block.marks.length > MAX_MARKS_PER_BLOCK) {
      addValidationIssue(issues, `${blockPath}.marks`, "too_many_marks", `marks exceeds ${MAX_MARKS_PER_BLOCK} entries.`);
    }
    const textLength = typeof block.text === "string" ? block.text.length : 0;
    for (let markIndex = 0; markIndex < block.marks.length && issues.length < MAX_VALIDATION_ISSUES; markIndex += 1) {
      const mark = block.marks[markIndex];
      const markPath = `${blockPath}.marks[${markIndex}]`;
      if (!isPlainObject(mark)) {
        addValidationIssue(issues, markPath, "invalid_mark", "Mark must be an object.");
        continue;
      }
      if (!SUPPORTED_MARK_TYPES.has(mark.type)) addValidationIssue(issues, `${markPath}.type`, "unsupported_mark_type", "Unsupported inline mark type.");
      if (!Number.isInteger(mark.start) || !Number.isInteger(mark.end) || mark.start < 0 || mark.end <= mark.start || mark.end > textLength) {
        addValidationIssue(issues, markPath, "invalid_mark_range", "Mark range must be within block text and have positive length.");
      }
      if (mark.type === "link" && !isSafeStoredUrl(mark.href || mark.url || "")) {
        addValidationIssue(issues, `${markPath}.href`, "unsafe_url_protocol", "Link URL uses an unsupported or unsafe protocol.");
      }
    }
  }
}

function validateRequiredTimestamp(value, issues, path) {
  if (typeof value !== "string" || value === "" || !Number.isFinite(Date.parse(value))) {
    addValidationIssue(issues, path, "invalid_timestamp", "Timestamp must be a non-empty ISO-compatible string.");
  }
}

function validateOptionalTimestamp(value, issues, path) {
  if (value === undefined || value === null || value === "") return;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    addValidationIssue(issues, path, "invalid_timestamp", "Timestamp must be empty or an ISO-compatible string.");
  }
}

function validateCommentBody(value, issues, path) {
  if (typeof value !== "string" || value.trim() === "") {
    addValidationIssue(issues, path, "invalid_comment_body", "Comment body must be a non-empty string.");
    return;
  }
  if (value.length > MAX_COMMENT_BODY_LENGTH) {
    addValidationIssue(issues, path, "comment_body_too_long", `Comment body exceeds ${MAX_COMMENT_BODY_LENGTH} characters.`);
  }
}

function validateCommentAnchor(thread, threadPath, blockTextLengths, issues) {
  if (thread.scope === "page") {
    if (thread.anchor !== undefined && thread.anchor !== null) {
      addValidationIssue(issues, `${threadPath}.anchor`, "invalid_comment_anchor", "Page comments may not have an inline anchor.");
    }
    return;
  }
  if (thread.scope !== "inline") return;
  const anchor = thread.anchor;
  if (!isPlainObject(anchor)) {
    addValidationIssue(issues, `${threadPath}.anchor`, "invalid_comment_anchor", "Inline comments require an anchor object.");
    return;
  }
  const textLength = blockTextLengths.get(anchor.blockId);
  if (!validEntityId(anchor.blockId) || textLength === undefined) {
    addValidationIssue(issues, `${threadPath}.anchor.blockId`, "broken_comment_anchor", "Inline comment anchor must reference a block in the same Resource.");
    return;
  }
  if (!Number.isInteger(anchor.start) || !Number.isInteger(anchor.end) || anchor.start < 0 || anchor.end <= anchor.start || anchor.end > textLength) {
    addValidationIssue(issues, `${threadPath}.anchor`, "invalid_comment_range", "Inline comment range must be within the referenced block text and have positive length.");
  }
}

function validateCommentReplies(thread, threadPath, seenIds, issues) {
  const repliesPath = `${threadPath}.replies`;
  if (!Array.isArray(thread.replies)) {
    addValidationIssue(issues, repliesPath, "invalid_comment_replies", "Comment replies must be an array.");
    return;
  }
  if (thread.replies.length > MAX_COMMENT_REPLIES_PER_THREAD) {
    addValidationIssue(issues, repliesPath, "too_many_comment_replies", `Comment replies exceed ${MAX_COMMENT_REPLIES_PER_THREAD} entries.`);
  }
  for (let index = 0; index < thread.replies.length && issues.length < MAX_VALIDATION_ISSUES; index += 1) {
    const reply = thread.replies[index];
    const replyPath = `${repliesPath}[${index}]`;
    if (!isPlainObject(reply)) {
      addValidationIssue(issues, replyPath, "invalid_comment_reply", "Comment reply must be an object.");
      continue;
    }
    registerUniqueId(seenIds, issues, reply.id, `${replyPath}.id`);
    validateCommentBody(reply.body, issues, `${replyPath}.body`);
    validateRequiredTimestamp(reply.createdAt, issues, `${replyPath}.createdAt`);
    if (reply.updatedAt !== undefined) validateRequiredTimestamp(reply.updatedAt, issues, `${replyPath}.updatedAt`);
    validateOptionalTimestamp(reply.deletedAt, issues, `${replyPath}.deletedAt`);
  }
}

function validateResourcePageFields(item, itemIndex, seenIds, issues) {
  const itemPath = `state.resources[${itemIndex}]`;
  if (item.icon !== undefined && (typeof item.icon !== "string" || item.icon.length > 16 || /[<>]/.test(item.icon))) {
    addValidationIssue(issues, `${itemPath}.icon`, "invalid_resource_icon", "Resource icon must be a string of at most 16 characters without angle brackets.");
  }

  if (item.cover !== undefined) {
    if (!isPlainObject(item.cover)) {
      addValidationIssue(issues, `${itemPath}.cover`, "invalid_resource_cover", "Resource cover must be an object with url and position fields.");
    } else {
      if (!Object.prototype.hasOwnProperty.call(item.cover, "url")) {
        addValidationIssue(issues, `${itemPath}.cover.url`, "missing_resource_cover_url", "Resource cover url is required when cover is present.");
      } else if (!isSafeHttpsCoverUrl(item.cover.url)) {
        addValidationIssue(issues, `${itemPath}.cover.url`, "invalid_resource_cover_url", "Resource cover URL must be empty or use HTTPS.");
      }
      if (!Object.prototype.hasOwnProperty.call(item.cover, "position")) {
        addValidationIssue(issues, `${itemPath}.cover.position`, "missing_resource_cover_position", "Resource cover position is required when cover is present.");
      } else if (!Number.isInteger(item.cover.position) || item.cover.position < 0 || item.cover.position > 100) {
        addValidationIssue(issues, `${itemPath}.cover.position`, "invalid_resource_cover_position", "Resource cover position must be an integer from 0 through 100.");
      }
    }
  }

  if (item.readOnly !== undefined && typeof item.readOnly !== "boolean") {
    addValidationIssue(issues, `${itemPath}.readOnly`, "invalid_resource_read_only", "Resource readOnly must be a boolean.");
  }

  if (item.childOrder !== undefined) {
    if (!Array.isArray(item.childOrder)) {
      addValidationIssue(issues, `${itemPath}.childOrder`, "invalid_child_order", "childOrder must be an array.");
    } else {
      if (item.childOrder.length > MAX_RESOURCE_CHILDREN) {
        addValidationIssue(issues, `${itemPath}.childOrder`, "too_many_resource_children", `childOrder exceeds ${MAX_RESOURCE_CHILDREN} entries.`);
      }
      const seenChildren = new Set();
      for (let index = 0; index < item.childOrder.length && issues.length < MAX_VALIDATION_ISSUES; index += 1) {
        const childId = item.childOrder[index];
        const childPath = `${itemPath}.childOrder[${index}]`;
        if (!validEntityId(childId)) {
          addValidationIssue(issues, childPath, "invalid_child_id", `Child ID must be a non-empty string of at most ${MAX_ID_LENGTH} characters.`);
        } else if (seenChildren.has(childId)) {
          addValidationIssue(issues, childPath, "duplicate_child_id", "childOrder may not contain the same Resource more than once.");
        }
        seenChildren.add(childId);
      }
    }
  }

  if (item.pageSettings !== undefined) {
    if (!isPlainObject(item.pageSettings)) {
      addValidationIssue(issues, `${itemPath}.pageSettings`, "invalid_page_settings", "pageSettings must be an object.");
    } else {
      if (item.pageSettings.font !== undefined && !SUPPORTED_RESOURCE_FONTS.has(item.pageSettings.font)) {
        addValidationIssue(issues, `${itemPath}.pageSettings.font`, "invalid_page_font", "Resource page font must be default, serif, or mono.");
      }
      for (const field of ["smallText", "fullWidth"]) {
        if (item.pageSettings[field] !== undefined && typeof item.pageSettings[field] !== "boolean") {
          addValidationIssue(issues, `${itemPath}.pageSettings.${field}`, "invalid_page_setting", `${field} must be a boolean.`);
        }
      }
    }
  }

  validateOptionalTimestamp(item.trashedAt, issues, `${itemPath}.trashedAt`);
  if (item.commentThreads === undefined) return;
  const threadsPath = `${itemPath}.commentThreads`;
  if (!Array.isArray(item.commentThreads)) {
    addValidationIssue(issues, threadsPath, "invalid_comment_threads", "commentThreads must be an array.");
    return;
  }
  if (item.commentThreads.length > MAX_COMMENT_THREADS_PER_RESOURCE) {
    addValidationIssue(issues, threadsPath, "too_many_comment_threads", `commentThreads exceeds ${MAX_COMMENT_THREADS_PER_RESOURCE} entries.`);
  }
  const blockTextLengths = new Map(
    (Array.isArray(item.blocks) ? item.blocks : [])
      .filter((block) => isPlainObject(block) && validEntityId(block.id))
      .map((block) => [block.id, typeof block.text === "string" ? block.text.length : 0]),
  );
  for (let index = 0; index < item.commentThreads.length && issues.length < MAX_VALIDATION_ISSUES; index += 1) {
    const thread = item.commentThreads[index];
    const threadPath = `${threadsPath}[${index}]`;
    if (!isPlainObject(thread)) {
      addValidationIssue(issues, threadPath, "invalid_comment_thread", "Comment thread must be an object.");
      continue;
    }
    registerUniqueId(seenIds, issues, thread.id, `${threadPath}.id`);
    if (!SUPPORTED_COMMENT_SCOPES.has(thread.scope)) {
      addValidationIssue(issues, `${threadPath}.scope`, "invalid_comment_scope", "Comment scope must be page or inline.");
    }
    validateCommentBody(thread.body, issues, `${threadPath}.body`);
    validateRequiredTimestamp(thread.createdAt, issues, `${threadPath}.createdAt`);
    validateRequiredTimestamp(thread.updatedAt, issues, `${threadPath}.updatedAt`);
    validateOptionalTimestamp(thread.resolvedAt, issues, `${threadPath}.resolvedAt`);
    validateOptionalTimestamp(thread.deletedAt, issues, `${threadPath}.deletedAt`);
    validateCommentAnchor(thread, threadPath, blockTextLengths, issues);
    validateCommentReplies(thread, threadPath, seenIds, issues);
  }
}

function validateResourceHierarchy(items, resourceIds, issues) {
  const resourcesById = new Map();
  for (const item of items) {
    if (isPlainObject(item) && validEntityId(item.id) && !resourcesById.has(item.id)) resourcesById.set(item.id, item);
  }
  const orderedChildOwners = new Map();
  for (let index = 0; index < items.length && issues.length < MAX_VALIDATION_ISSUES; index += 1) {
    const item = items[index];
    if (!isPlainObject(item) || !validEntityId(item.id)) continue;
    const itemPath = `state.resources[${index}]`;
    if (item.parentId === item.id) {
      addValidationIssue(issues, `${itemPath}.parentId`, "resource_self_parent", "A Resource may not be its own parent.");
    }
    if (!Array.isArray(item.childOrder)) continue;
    for (let childIndex = 0; childIndex < item.childOrder.length && issues.length < MAX_VALIDATION_ISSUES; childIndex += 1) {
      const childId = item.childOrder[childIndex];
      const childPath = `${itemPath}.childOrder[${childIndex}]`;
      if (!validEntityId(childId)) continue;
      if (!resourceIds?.has(childId)) {
        addValidationIssue(issues, childPath, "broken_child_relation", "childOrder must reference an existing Resource.");
        continue;
      }
      if (childId === item.id) {
        addValidationIssue(issues, childPath, "resource_self_child", "A Resource may not list itself as a child.");
        continue;
      }
      const previousOwner = orderedChildOwners.get(childId);
      if (previousOwner && previousOwner !== item.id) {
        addValidationIssue(issues, childPath, "duplicate_child_parent", "A Resource may be ordered under only one parent.");
      } else {
        orderedChildOwners.set(childId, item.id);
      }
      if (resourcesById.get(childId)?.parentId !== item.id) {
        addValidationIssue(issues, childPath, "invalid_child_parent", "childOrder may contain only direct children whose parentId matches this Resource.");
      }
    }
  }

  for (let index = 0; index < items.length && issues.length < MAX_VALIDATION_ISSUES; index += 1) {
    const item = items[index];
    if (!isPlainObject(item) || !validEntityId(item.id) || !item.parentId || item.parentId === item.id) continue;
    const ancestors = new Set([item.id]);
    let cursor = item;
    while (typeof cursor?.parentId === "string" && cursor.parentId !== "") {
      if (ancestors.has(cursor.parentId)) {
        addValidationIssue(issues, `state.resources[${index}].parentId`, "resource_parent_cycle", "Resource parent relationships may not form a cycle.");
        break;
      }
      ancestors.add(cursor.parentId);
      cursor = resourcesById.get(cursor.parentId);
      if (!cursor) break;
    }
  }
}

function validateOptionalReference(item, field, targetIds, issues, path) {
  const value = item[field];
  if (value === undefined || value === null || value === "") return;
  if (typeof value !== "string" || !targetIds?.has(value)) addValidationIssue(issues, `${path}.${field}`, "broken_relation", `${field} does not reference an existing item.`);
}

function relationCollectionKey(value) {
  return RELATION_COLLECTION_ALIASES.get(String(value || "").trim()) || "";
}

function validateIncomingState(state) {
  const issues = [];
  validateStateTree(state, issues);
  if (!isPlainObject(state)) {
    throw apiError(422, "INVALID_STATE", "State validation failed.", { issues: [{ path: "state", code: "invalid_root", message: "state must be an object." }] });
  }
  if (state.version !== STATE_VERSION) addValidationIssue(issues, "state.version", "unsupported_version", `State version must be ${STATE_VERSION}.`);
  if (!Number.isFinite(Date.parse(state.createdAt || ""))) addValidationIssue(issues, "state.createdAt", "invalid_timestamp", "createdAt must be an ISO-compatible timestamp.");
  if (!Number.isFinite(Date.parse(state.updatedAt || ""))) addValidationIssue(issues, "state.updatedAt", "invalid_timestamp", "updatedAt must be an ISO-compatible timestamp.");
  if (!isPlainObject(state.settings)) addValidationIssue(issues, "state.settings", "invalid_settings", "settings must be an object.");

  let totalItems = 0;
  for (const key of REQUIRED_COLLECTION_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(state, key)) {
      addValidationIssue(issues, `state.${key}`, "missing_collection", `${key} is required.`);
      continue;
    }
    if (!Array.isArray(state[key])) {
      addValidationIssue(issues, `state.${key}`, "invalid_collection", `${key} must be an array.`);
      continue;
    }
    totalItems += state[key].length;
  }
  if (totalItems > MAX_COLLECTION_ITEMS) addValidationIssue(issues, "state", "too_many_collection_items", `Collections exceed ${MAX_COLLECTION_ITEMS} total items.`);
  if (PRIMARY_COLLECTION_KEYS.every((key) => Array.isArray(state[key]) && state[key].length === 0)) {
    addValidationIssue(issues, "state", "empty_destructive_state", "A state write may not remove every primary collection item.");
  }

  const seenIds = new Map();
  const idSets = new Map();
  for (const key of REQUIRED_COLLECTION_KEYS) {
    const ids = new Set();
    idSets.set(key, ids);
    const items = Array.isArray(state[key]) ? state[key] : [];
    for (let index = 0; index < items.length && issues.length < MAX_VALIDATION_ISSUES; index += 1) {
      const item = items[index];
      const itemPath = `state.${key}[${index}]`;
      if (!isPlainObject(item)) {
        addValidationIssue(issues, itemPath, "invalid_item", "Collection item must be an object.");
        continue;
      }
      if (registerUniqueId(seenIds, issues, item.id, `${itemPath}.id`)) ids.add(item.id);
      if (BLOCK_COLLECTION_KEYS.has(key)) validateBlocks(item, key, index, seenIds, issues);
      if (key === "resources") validateResourcePageFields(item, index, seenIds, issues);
      if ((key === "captures" || key === "resources") && !isSafeStoredUrl(item.url)) {
        addValidationIssue(issues, `${itemPath}.url`, "unsafe_url_protocol", "URL uses an unsupported or unsafe protocol.");
      }
      if (key === "googleEvents" && !isSafeStoredUrl(item.htmlLink)) {
        addValidationIssue(issues, `${itemPath}.htmlLink`, "unsafe_url_protocol", "Google event URL uses an unsupported or unsafe protocol.");
      }
    }
  }

  const boxes = idSets.get("boxes");
  const goals = idSets.get("goals");
  const projects = idSets.get("projects");
  const resources = idSets.get("resources");
  const habits = idSets.get("habits");
  const calendars = idSets.get("googleCalendars");
  for (const [key, fields] of Object.entries({
    goals: [["boxId", boxes]],
    projects: [["boxId", boxes], ["goalId", goals]],
    tasks: [["boxId", boxes], ["goalId", goals], ["projectId", projects], ["resourceId", resources]],
    resources: [["boxId", boxes], ["goalId", goals], ["projectId", projects], ["parentId", resources]],
    habits: [["boxId", boxes], ["projectId", projects]],
    habitInstances: [["habitId", habits]],
    googleEvents: [["calendarId", calendars]],
  })) {
    const items = Array.isArray(state[key]) ? state[key] : [];
    for (let index = 0; index < items.length; index += 1) {
      if (!isPlainObject(items[index])) continue;
      for (const [field, targetIds] of fields) validateOptionalReference(items[index], field, targetIds, issues, `state.${key}[${index}]`);
    }
  }
  validateResourceHierarchy(Array.isArray(state.resources) ? state.resources : [], resources, issues);

  const captures = Array.isArray(state.captures) ? state.captures : [];
  for (let index = 0; index < captures.length; index += 1) {
    const capture = captures[index];
    if (!isPlainObject(capture) || (!capture.convertedTo && !capture.convertedId)) continue;
    const targetKey = relationCollectionKey(capture.convertedTo);
    if (!targetKey || !idSets.get(targetKey)?.has(capture.convertedId)) {
      addValidationIssue(issues, `state.captures[${index}].convertedId`, "broken_relation", "Converted capture target does not exist.");
    }
  }

  const links = Array.isArray(state.links) ? state.links : [];
  for (let index = 0; index < links.length; index += 1) {
    const link = links[index];
    if (!isPlainObject(link)) continue;
    for (const side of ["from", "to"]) {
      const typeKey = relationCollectionKey(link[`${side}Type`]);
      const targetId = link[`${side}Id`];
      if (!typeKey || typeof targetId !== "string" || !idSets.get(typeKey)?.has(targetId)) {
        addValidationIssue(issues, `state.links[${index}].${side}Id`, "broken_relation", `${side} relation target does not exist.`);
      }
    }
  }

  if (issues.length) throw apiError(422, "INVALID_STATE", "State validation failed.", { issues });
}

function revisionValue(value, source) {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0) throw apiError(400, "INVALID_BASE_REVISION", `${source} must contain a non-negative integer revision.`);
  return revision;
}

function requestBaseRevision(request, body) {
  let headerRevision = null;
  const ifMatch = String(request.headers["if-match"] || "").trim();
  if (ifMatch) {
    const match = ifMatch.match(/^(?:W\/)?"?(?:state-)?(\d+)"?$/i);
    if (!match) throw apiError(400, "INVALID_IF_MATCH", "If-Match must contain a state revision ETag.");
    headerRevision = revisionValue(match[1], "If-Match");
  }
  const bodyRevision = body.baseRevision === undefined || body.baseRevision === null || body.baseRevision === ""
    ? null
    : revisionValue(body.baseRevision, "baseRevision");
  if (headerRevision !== null && bodyRevision !== null && headerRevision !== bodyRevision) {
    throw apiError(400, "REVISION_PRECONDITION_MISMATCH", "If-Match and baseRevision must match.");
  }
  return headerRevision ?? bodyRevision;
}

function resourcePathId(requestUrl) {
  const match = requestUrl.pathname.match(/^\/api\/resources\/([^/]+)$/);
  if (!match) return "";
  let id;
  try {
    id = decodeURIComponent(match[1]);
  } catch {
    throw apiError(400, "INVALID_RESOURCE_ID", "Resource path ID is invalid.");
  }
  if (!validEntityId(id)) throw apiError(400, "INVALID_RESOURCE_ID", "Resource path ID is invalid.");
  return id;
}

function stateRevisionHeaders(revision, mode = "conditional") {
  const value = Number.isSafeInteger(Number(revision)) && Number(revision) >= 0 ? Number(revision) : 0;
  return {
    ETag: `"state-${value}"`,
    "X-State-Revision": String(value),
    "X-State-Concurrency": mode,
  };
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
    const status = await storage.stateStatus();
    sendJson(response, 200, status, stateRevisionHeaders(status.revision, requireStatePrecondition ? "required" : "optional"));
  } catch (error) {
    sendJson(response, 503, {
      configured: true,
      connected: false,
      appStateId: storage.appStateId,
      error: "PostgreSQL connection failed.",
      code: "DATABASE_UNAVAILABLE",
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
  }, stateRevisionHeaders(payload.revision, requireStatePrecondition ? "required" : "optional"));
}

async function handleStateWrite(request, response) {
  const body = await readJsonBody(request, STATE_BODY_LIMIT);
  if (!body.state || typeof body.state !== "object" || Array.isArray(body.state)) {
    throw apiError(400, "STATE_REQUIRED", "state object is required.");
  }
  validateIncomingState(body.state);
  const baseRevision = requestBaseRevision(request, body);
  const releaseStateWrite = await acquireStateWriteSlot();
  let saved;
  try {
    saved = await storage.writeAppState(body.state, {
      baseRevision,
      requirePrecondition: requireStatePrecondition,
    });
  } finally {
    releaseStateWrite();
  }
  const concurrencyMode = baseRevision === null ? (saved.bootstrap ? "bootstrap" : "legacy-unconditional") : "conditional";
  sendJson(response, 200, {
    ok: true,
    configured: true,
    connected: true,
    appStateId: storage.appStateId,
    concurrency: concurrencyMode,
    preconditionRequired: requireStatePrecondition,
    ...saved,
  }, stateRevisionHeaders(saved.revision, concurrencyMode));
  auditEvent(request, "state.write", {
    status: 200,
    outcome: "succeeded",
    revision: saved.revision,
    concurrency: concurrencyMode,
  });
}

async function handleResourceWrite(request, response, requestUrl) {
  const pathId = resourcePathId(requestUrl);
  const body = await readJsonBody(request, STATE_BODY_LIMIT);
  if (!isPlainObject(body.resource)) {
    throw apiError(400, "RESOURCE_REQUIRED", "resource object is required.");
  }
  if (!validEntityId(body.resource.id)) {
    throw apiError(400, "INVALID_RESOURCE_ID", "Resource body ID is invalid.");
  }
  if (body.resource.id !== pathId) {
    throw apiError(400, "RESOURCE_ID_MISMATCH", "Resource path and body IDs must match.");
  }

  const baseRevision = requestBaseRevision(request, body);
  const releaseStateWrite = await acquireStateWriteSlot();
  let saved;
  try {
    saved = await storage.writeResource(body.resource, {
      baseRevision,
      requirePrecondition: true,
      validateState: validateIncomingState,
    });
  } finally {
    releaseStateWrite();
  }

  sendJson(response, 200, {
    ok: true,
    configured: true,
    connected: true,
    appStateId: storage.appStateId,
    concurrency: "conditional",
    preconditionRequired: true,
    ...saved,
  }, stateRevisionHeaders(saved.revision, "conditional"));
  auditEvent(request, "resource.write", {
    status: 200,
    outcome: "succeeded",
    revision: saved.revision,
    concurrency: "conditional",
  });
}

function handleGoogleAuthStart(request, response, requestUrl) {
  if (!googleConfigured()) {
    auditEvent(request, "google.connect", {
      status: 501,
      outcome: "rejected",
      reason: "not_configured",
    });
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
  auditEvent(request, "google.connect", { status: 302, outcome: "started" });
  redirect(response, `${googleAuthUrl}?${params}`);
}

async function handleGoogleCallback(request, response, requestUrl) {
  const state = decodeState(requestUrl.searchParams.get("state"));
  const code = requestUrl.searchParams.get("code");
  const cookies = parseCookies(request);
  clearCookie(response, request, oauthStateCookie);
  if (!state?.nonce || state.nonce !== cookies[oauthStateCookie] || !code) {
    auditEvent(request, "google.connect", {
      status: 302,
      outcome: "rejected",
      reason: "oauth_state_invalid",
    });
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
    auditEvent(request, "google.connect", { status: 302, outcome: "succeeded" });
    redirect(response, appendQuery(safeReturnTo(state.returnTo), "google", "connected"));
  } catch {
    auditEvent(request, "google.connect", {
      status: 302,
      outcome: "failed",
      reason: "oauth_exchange_failed",
    });
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
    auditEvent(request, "google.mutation", {
      status: 400,
      outcome: "rejected",
      reason: "validation",
      code: "GOOGLE_EVENT_REQUIRED_FIELDS",
    });
    sendJson(response, 400, { error: "summary, start, and end are required." });
    return;
  }
  const created = await googleFetch(`/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: "POST",
    body: JSON.stringify(event),
  });
  auditEvent(request, "google.mutation", { status: 200, outcome: "succeeded" });
  sendJson(response, 200, { calendarId, event: created });
}

async function handleGoogleDisconnect(request, response) {
  await storage.deleteToken();
  auditEvent(request, "google.disconnect", { status: 200, outcome: "succeeded" });
  sendJson(response, 200, { ok: true });
}

function apiErrorStatus(error) {
  return Number.isInteger(error?.status) && error.status >= 400 && error.status < 600 ? error.status : 500;
}

function auditApiFailure(request, error) {
  const operation = request[apiOperationSymbol] || "api.unknown";
  const status = apiErrorStatus(error);
  const code = auditScalar(error?.code, status >= 500 ? "INTERNAL_ERROR" : "REQUEST_FAILED");
  const revision = Number.isSafeInteger(error?.revision)
    ? error.revision
    : Number.isSafeInteger(error?.details?.revision)
      ? error.details.revision
      : undefined;

  if (operation === "state.write" || operation === "resource.write") {
    const eventPrefix = operation === "resource.write" ? "resource" : "state";
    if (code === "STATE_REVISION_CONFLICT") {
      auditEvent(request, `${eventPrefix}.revision_conflict`, { status, code, revision, outcome: "rejected" });
      return;
    }
    if (
      code === "STATE_PRECONDITION_REQUIRED"
      || code === "REVISION_PRECONDITION_MISMATCH"
      || code === "INVALID_IF_MATCH"
      || code === "INVALID_BASE_REVISION"
    ) {
      auditEvent(request, `${eventPrefix}.precondition_rejected`, { status, code, revision, outcome: "rejected" });
      return;
    }
    if (code === "STATE_WRITE_BUSY") {
      auditEvent(request, `${eventPrefix}.write_throttled`, {
        status,
        code,
        outcome: "rejected",
        reason: error?.capacityReason,
        retryAfter: error?.retryAfter,
      });
      return;
    }
    if ([400, 404, 413, 415, 422].includes(status)) {
      auditEvent(request, `${eventPrefix}.validation_rejected`, {
        status,
        code,
        outcome: "rejected",
        issueCount: Array.isArray(error?.details?.issues) ? error.details.issues.length : undefined,
      });
      return;
    }
  }

  if (operation === "google.event.insert") {
    auditEvent(request, "google.mutation", {
      status,
      code,
      outcome: status >= 500 ? "failed" : "rejected",
    });
    return;
  }
  if (operation === "google.disconnect") {
    auditEvent(request, "google.disconnect", { status, code, outcome: status >= 500 ? "failed" : "rejected" });
    return;
  }
  if (operation === "google.connect.start") {
    auditEvent(request, "google.connect", { status, code, outcome: "failed" });
    return;
  }
  if (status >= 500) auditEvent(request, "api.failure", { status, code, outcome: "failed" });
}

async function handleApiRequest(request, response, requestUrl) {
  try {
    const operation = apiOperation(request, requestUrl);
    request[apiOperationSymbol] = operation;
    if (enforceApiRateLimit(request, response, operation)) return true;
    if (await enforceApiAuthentication(request, response, requestUrl)) return true;
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
    if (request.method === "PUT" && /^\/api\/resources\/[^/]+$/.test(requestUrl.pathname)) {
      await handleResourceWrite(request, response, requestUrl);
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
      await handleGoogleDisconnect(request, response);
      return true;
    }
    if (requestUrl.pathname.startsWith("/api/")) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
  } catch (error) {
    auditApiFailure(request, error);
    sendApiError(response, error);
    return true;
  }
  return false;
}

function resolveRequestPath(url) {
  const { pathname } = new URL(url, `http://${host}:${port}`);
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return "";
  }
  const requested = decoded === "/"
    ? "/index.html"
    : decoded.startsWith(assetProxyPrefix)
      ? `/assets/${decoded.slice(assetProxyPrefix.length)}`
      : decoded;
  const normalizedRequest = normalize(requested).replaceAll("\\", "/");
  if (staticRoot === sourceStaticRoot && !sourceStaticFiles.has(normalizedRequest) && !normalizedRequest.startsWith("/icons/")) return "";
  const absolute = resolve(join(staticRoot, normalizedRequest));
  return absolute === staticRoot || absolute.startsWith(`${staticRoot}${sep}`) ? absolute : "";
}

function decodedRawRequestPath(url) {
  const raw = String(url || "/");
  const rawPath = raw.startsWith("/") ? raw.split(/[?#]/, 1)[0] : new URL(raw, `http://${host}:${port}`).pathname;
  try {
    return decodeURIComponent(rawPath);
  } catch {
    return "";
  }
}

function hasForbiddenRequestPath(url) {
  const decoded = decodedRawRequestPath(url);
  if (!decoded || /[\u0000-\u001f\u007f\\]/.test(decoded)) return true;
  return decoded.split("/").some((segment) => segment === "." || segment === "..");
}

function isSpaNavigationRequest(request, requestUrl) {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  if (hasForbiddenRequestPath(request.url || "/")) return false;
  const pathname = requestUrl.pathname;
  if (pathname === "/api" || pathname.startsWith("/api/") || pathname === "/health") return false;
  if (pathname.startsWith(assetProxyPrefix) || pathname.startsWith("/assets/") || pathname.startsWith("/icons/") || pathname.startsWith("/.")) return false;
  if (extname(pathname)) return false;
  return true;
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
  request[requestIdSymbol] = randomBytes(12).toString("hex");
  response.setHeader("X-Request-ID", request[requestIdSymbol]);
  const requestUrl = new URL(request.url || "/", requestOrigin(request));
  applySecurityHeaders(request, response);

  if (requestUrl.pathname === "/health") {
    try {
      await storage.stateStatus();
      sendJson(response, 200, { ok: true, database: "postgresql" });
    } catch {
      sendJson(response, 503, { ok: false, error: "PostgreSQL connection failed.", code: "DATABASE_UNAVAILABLE" });
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

  if (hasForbiddenRequestPath(request.url || "/")) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    response.end("Forbidden");
    return;
  }

  const filePath = resolveRequestPath(request.url || "/");
  const spaNavigation = isSpaNavigationRequest(request, requestUrl);
  const indexPath = resolve(staticRoot, "index.html");
  if (!filePath) {
    if (spaNavigation) {
      try {
        await sendFile(request, response, requestUrl, indexPath);
      } catch {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
        response.end("Not found");
      }
      return;
    }
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    response.end("Forbidden");
    return;
  }

  try {
    await sendFile(request, response, requestUrl, filePath);
  } catch {
    if (spaNavigation && filePath !== indexPath) {
      try {
        await sendFile(request, response, requestUrl, indexPath);
        return;
      } catch {}
    }
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
