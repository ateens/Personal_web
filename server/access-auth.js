import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const ACCESS_COOKIE = "sygma_access_session";
const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const DEFAULT_LOGIN_WINDOW_MS = 5 * 60 * 1_000;
const DEFAULT_LOGIN_MAX_ATTEMPTS = 10;
const DEFAULT_MAX_SESSIONS = 32;
const DEFAULT_MAX_LOGIN_KEYS = 10_000;
const FORM_BODY_LIMIT = 4_096;

function sha256(value) {
  return createHash("sha256").update(String(value || ""), "utf8").digest();
}

export function parseSha256Digest(value) {
  const normalized = String(value || "").trim().replace(/^sha256:/i, "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) return null;
  return Buffer.from(normalized, "hex");
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function parseCookies(request) {
  const cookies = Object.create(null);
  for (const rawPart of String(request.headers.cookie || "").split(";")) {
    const part = rawPart.trim();
    if (!part) continue;
    const index = part.indexOf("=");
    if (index < 0) {
      cookies[part] = "";
      continue;
    }
    try {
      cookies[part.slice(0, index)] = decodeURIComponent(part.slice(index + 1));
    } catch {
      cookies[part.slice(0, index)] = "";
    }
  }
  return cookies;
}

function safeReturnTo(value = "/") {
  if (typeof value !== "string" || value.length > 2_048 || /[\u0000-\u001f\u007f]/.test(value)) return "/";
  try {
    const parsed = new URL(value, "http://local.invalid");
    if (parsed.origin !== "http://local.invalid") return "/";
    return `${parsed.pathname}${parsed.search}${parsed.hash}` || "/";
  } catch {
    return "/";
  }
}

function html(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function loginPage(returnTo = "/", message = "") {
  const safeTarget = safeReturnTo(returnTo);
  const feedback = message ? `<p class="message" role="alert">${html(message)}</p>` : "";
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>SYGMA 로그인</title>
  <style>
    :root { color-scheme: light dark; font-family: Inter, Pretendard, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 24px; background: #f5f4f1; color: #24231f; }
    main { width: min(100%, 380px); padding: 32px; border: 1px solid #dedbd2; border-radius: 18px; background: #fff; box-shadow: 0 18px 50px rgb(46 42 31 / 10%); }
    .mark { width: 42px; height: 42px; display: grid; place-items: center; margin-bottom: 24px; border-radius: 12px; background: #24231f; color: #fff; font-weight: 750; }
    h1 { margin: 0 0 8px; font-size: 24px; letter-spacing: -.03em; }
    p { margin: 0 0 24px; color: #69665e; line-height: 1.55; }
    label { display: block; margin-bottom: 8px; font-size: 13px; font-weight: 650; }
    input { width: 100%; min-height: 46px; padding: 10px 12px; border: 1px solid #c9c5ba; border-radius: 10px; background: #fff; color: #24231f; font: inherit; }
    input:focus { outline: 3px solid rgb(69 111 89 / 18%); border-color: #456f59; }
    button { width: 100%; min-height: 46px; margin-top: 14px; border: 0; border-radius: 10px; background: #24231f; color: #fff; font: inherit; font-weight: 700; cursor: pointer; }
    .message { margin: 0 0 16px; padding: 10px 12px; border-radius: 9px; background: #fff0ed; color: #9b3024; font-size: 13px; }
    @media (prefers-color-scheme: dark) {
      body { background: #171714; color: #f2f0e8; }
      main { border-color: #3e3c35; background: #22221e; box-shadow: none; }
      .mark, button { background: #f2f0e8; color: #22221e; }
      p { color: #aaa69b; }
      input { border-color: #555147; background: #171714; color: #f2f0e8; }
      .message { background: #43251f; color: #ffb8aa; }
    }
  </style>
</head>
<body>
  <main>
    <div class="mark" aria-hidden="true">S</div>
    <h1>SYGMA</h1>
    <p>Railway에서 실행 중인 개인 워크스페이스입니다.</p>
    ${feedback}
    <form method="post" action="/auth/login">
      <input type="hidden" name="returnTo" value="${html(safeTarget)}">
      <label for="access-code">접근 코드</label>
      <input id="access-code" name="accessCode" type="password" autocomplete="current-password" required autofocus>
      <button type="submit">계속</button>
    </form>
  </main>
</body>
</html>`;
}

function writeResponse(request, response, status, headers, body = "") {
  response.writeHead(status, headers);
  if (request.method === "HEAD") response.end();
  else response.end(body);
}

function sendJson(request, response, status, payload) {
  writeResponse(request, response, status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  }, JSON.stringify(payload));
}

function redirect(request, response, location) {
  writeResponse(request, response, 303, {
    Location: location,
    "Cache-Control": "no-store",
  });
}

function secureRequest(request) {
  return request.headers["x-forwarded-proto"] === "https" || Boolean(request.socket.encrypted);
}

function sessionCookie(value, maxAge, secure) {
  const parts = [
    `${ACCESS_COOKIE}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function originMatches(request, requestUrl) {
  const supplied = String(request.headers.origin || "").trim();
  if (!supplied) return false;
  try {
    return new URL(supplied).origin === requestUrl.origin;
  } catch {
    return false;
  }
}

function requestWantsHtml(request) {
  return request.headers["sec-fetch-mode"] === "navigate"
    || String(request.headers.accept || "").toLowerCase().includes("text/html");
}

function defaultRequestKey(request) {
  return String(request.socket.remoteAddress || "unknown");
}

async function readForm(request) {
  const contentType = String(request.headers["content-type"] || "").toLowerCase();
  if (!contentType.startsWith("application/x-www-form-urlencoded")) return null;
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of request) {
      size += chunk.length;
      if (size > FORM_BODY_LIMIT) return null;
      chunks.push(chunk);
    }
  } catch (error) {
    if (
      request.aborted
      || responseStreamError(error)
    ) return null;
    throw error;
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function responseStreamError(error) {
  return ["ECONNRESET", "ERR_STREAM_PREMATURE_CLOSE"].includes(String(error?.code || ""))
    || String(error?.message || "").toLowerCase() === "aborted";
}

export function createAccessController(options = {}) {
  const required = options.required === true;
  const passwordDigest = parseSha256Digest(options.passwordSha256);
  const sessionTtlSeconds = boundedInteger(options.sessionTtlSeconds, DEFAULT_SESSION_TTL_SECONDS, 300, 60 * 60 * 24 * 365);
  const loginWindowMs = boundedInteger(options.loginWindowMs, DEFAULT_LOGIN_WINDOW_MS, 10_000, 60 * 60 * 1_000);
  const loginMaxAttempts = boundedInteger(options.loginMaxAttempts, DEFAULT_LOGIN_MAX_ATTEMPTS, 1, 100);
  const maxSessions = boundedInteger(options.maxSessions, DEFAULT_MAX_SESSIONS, 1, 1_000);
  const maxLoginKeys = boundedInteger(options.maxLoginKeys, DEFAULT_MAX_LOGIN_KEYS, 1, 100_000);
  const requestKey = typeof options.requestKey === "function" ? options.requestKey : defaultRequestKey;
  const sessions = new Map();
  const loginAttempts = new Map();

  function cleanup(now = Date.now()) {
    for (const [key, session] of sessions) {
      if (session.expiresAt <= now) sessions.delete(key);
    }
    for (const [key, attempt] of loginAttempts) {
      if (attempt.resetAt <= now) loginAttempts.delete(key);
    }
    while (sessions.size > maxSessions) sessions.delete(sessions.keys().next().value);
    while (loginAttempts.size > maxLoginKeys) loginAttempts.delete(loginAttempts.keys().next().value);
  }

  function sessionKey(token) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(String(token || ""))) return "";
    return sha256(token).toString("hex");
  }

  function authorized(request) {
    if (!required) return true;
    cleanup();
    const key = sessionKey(parseCookies(request)[ACCESS_COOKIE]);
    if (!key) return false;
    const session = sessions.get(key);
    return Boolean(session && session.expiresAt > Date.now());
  }

  function destroySession(request) {
    const key = sessionKey(parseCookies(request)[ACCESS_COOKIE]);
    if (key) sessions.delete(key);
  }

  function createSession() {
    cleanup();
    const token = randomBytes(32).toString("base64url");
    sessions.set(sessionKey(token), {
      createdAt: Date.now(),
      expiresAt: Date.now() + sessionTtlSeconds * 1_000,
    });
    cleanup();
    return token;
  }

  function attemptState(request) {
    const now = Date.now();
    cleanup(now);
    const key = String(requestKey(request) || "unknown").slice(0, 256);
    const current = loginAttempts.get(key);
    if (!current || current.resetAt <= now) {
      while (loginAttempts.size >= maxLoginKeys) loginAttempts.delete(loginAttempts.keys().next().value);
      const next = { count: 0, resetAt: now + loginWindowMs };
      loginAttempts.set(key, next);
      return { key, value: next };
    }
    return { key, value: current };
  }

  async function handleLogin(request, response, requestUrl) {
    const returnTo = safeReturnTo(requestUrl.searchParams.get("returnTo") || "/");
    if (!required) {
      redirect(request, response, returnTo);
      return true;
    }
    if (!passwordDigest) {
      sendJson(request, response, 503, { error: "Application access is not configured.", code: "APP_ACCESS_NOT_CONFIGURED" });
      return true;
    }
    if (request.method === "GET" || request.method === "HEAD") {
      if (authorized(request)) {
        redirect(request, response, returnTo);
        return true;
      }
      writeResponse(request, response, 200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
      }, loginPage(returnTo));
      return true;
    }
    if (request.method !== "POST") {
      writeResponse(request, response, 405, { Allow: "GET, HEAD, POST", "Cache-Control": "no-store" }, "Method not allowed");
      return true;
    }
    if (!originMatches(request, requestUrl)) {
      sendJson(request, response, 403, { error: "Request origin is not allowed.", code: "ORIGIN_NOT_ALLOWED" });
      return true;
    }
    const attempt = attemptState(request);
    if (attempt.value.count >= loginMaxAttempts) {
      const retryAfter = Math.max(1, Math.ceil((attempt.value.resetAt - Date.now()) / 1_000));
      response.setHeader("Retry-After", String(retryAfter));
      sendJson(request, response, 429, { error: "Too many login attempts.", code: "LOGIN_RATE_LIMITED" });
      return true;
    }
    // Reserve the attempt before awaiting the request body so concurrent
    // requests from the same client cannot all observe the same free slot.
    attempt.value.count += 1;
    const form = await readForm(request);
    if (request.aborted || response.destroyed || response.writableEnded) return true;
    const suppliedDigest = sha256(form?.get("accessCode") || "");
    if (!form || !timingSafeEqual(suppliedDigest, passwordDigest)) {
      const target = safeReturnTo(form?.get("returnTo") || returnTo);
      writeResponse(request, response, 401, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
      }, loginPage(target, "접근 코드가 올바르지 않습니다."));
      return true;
    }
    loginAttempts.delete(attempt.key);
    const target = safeReturnTo(form.get("returnTo") || returnTo);
    response.setHeader("Set-Cookie", sessionCookie(createSession(), sessionTtlSeconds, secureRequest(request)));
    redirect(request, response, target);
    return true;
  }

  function handleLogout(request, response, requestUrl) {
    if (request.method !== "POST") {
      writeResponse(request, response, 405, { Allow: "POST", "Cache-Control": "no-store" }, "Method not allowed");
      return true;
    }
    if (!originMatches(request, requestUrl)) {
      sendJson(request, response, 403, { error: "Request origin is not allowed.", code: "ORIGIN_NOT_ALLOWED" });
      return true;
    }
    destroySession(request);
    response.setHeader("Set-Cookie", sessionCookie("", 0, secureRequest(request)));
    redirect(request, response, "/auth/login");
    return true;
  }

  async function handleAuthRoute(request, response, requestUrl) {
    if (requestUrl.pathname === "/auth/login") return handleLogin(request, response, requestUrl);
    if (requestUrl.pathname === "/auth/logout") return handleLogout(request, response, requestUrl);
    return false;
  }

  function enforce(request, response, requestUrl) {
    if (!required || requestUrl.pathname === "/api/google/oauth/callback") return false;
    if (!authorized(request)) {
      if ((request.method === "GET" || request.method === "HEAD") && !requestUrl.pathname.startsWith("/api/") && requestWantsHtml(request)) {
        const returnTo = safeReturnTo(`${requestUrl.pathname}${requestUrl.search}${requestUrl.hash}`);
        redirect(request, response, `/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
      } else {
        sendJson(request, response, 401, { error: "Authentication is required.", code: "AUTH_REQUIRED" });
      }
      return true;
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(String(request.method || "GET").toUpperCase()) && !originMatches(request, requestUrl)) {
      sendJson(request, response, 403, { error: "Request origin is not allowed.", code: "ORIGIN_NOT_ALLOWED" });
      return true;
    }
    return false;
  }

  return Object.freeze({
    configured: Boolean(passwordDigest),
    required,
    authorized,
    enforce,
    handleAuthRoute,
  });
}
