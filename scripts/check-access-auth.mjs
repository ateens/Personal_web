import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import http from "node:http";
import net from "node:net";
import { once } from "node:events";
import { createAccessController } from "../server/access-auth.js";
import {
  deploymentSecurityPolicy,
  PRODUCTION_RAILWAY_SECURITY_POLICY,
  railwayRuntimeDetected,
} from "../server/deployment-security.js";

const accessCode = "correct-access-code";
const passwordSha256 = `sha256:${createHash("sha256").update(accessCode).digest("hex")}`;
const controller = createAccessController({
  required: true,
  passwordSha256,
  sessionTtlSeconds: 600,
  loginMaxAttempts: 4,
  maxLoginKeys: 16,
  requestKey: (request) => String(request.headers["x-test-client"] || request.socket.remoteAddress || "unknown"),
});

assert(controller.configured, "access controller did not accept a valid SHA-256 verifier");
assert(!createAccessController({ required: true }).configured, "missing verifier was reported as configured");

const productionPolicy = deploymentSecurityPolicy({
  RAILWAY_PROJECT_ID: PRODUCTION_RAILWAY_SECURITY_POLICY.projectId,
  RAILWAY_ENVIRONMENT_ID: PRODUCTION_RAILWAY_SECURITY_POLICY.environmentId,
  RAILWAY_SERVICE_ID: PRODUCTION_RAILWAY_SECURITY_POLICY.serviceId,
  PUBLIC_BASE_URL: "https://stale-sites-origin.example",
});
assert(productionPolicy.forceAppAccessAuth, "exact production target did not force access authentication");
assert(productionPolicy.forceStatePrecondition, "exact production target did not force state preconditions");
assert.equal(productionPolicy.publicBaseUrl, "https://personalweb-production-81a6.up.railway.app", "production target inherited a stale public origin");
assert(railwayRuntimeDetected({ RAILWAY_SERVICE_ID: "preview-service" }), "Railway preview runtime was not detected");
assert(!deploymentSecurityPolicy({ RAILWAY_SERVICE_ID: "preview-service" }).forceAppAccessAuth, "preview target was mistaken for the pinned production target");
assert(!railwayRuntimeDetected({}), "local development was mistaken for a Railway runtime");

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url || "/", `http://${request.headers.host}`);
  response.setHeader("X-Frame-Options", "DENY");
  if (requestUrl.pathname === "/health") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end('{"ok":true}');
    return;
  }
  if (await controller.handleAuthRoute(request, response, requestUrl)) return;
  if (controller.enforce(request, response, requestUrl)) return;
  response.writeHead(200, { "Content-Type": "text/plain" });
  response.end(requestUrl.pathname === "/api/google/oauth/callback" ? "callback" : "protected");
});

server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
const origin = `http://127.0.0.1:${address.port}`;

async function request(path, options = {}) {
  return fetch(`${origin}${path}`, { redirect: "manual", ...options });
}

try {
  const health = await request("/health");
  assert.equal(health.status, 200, "health endpoint was not public");

  await new Promise((resolve, reject) => {
    const socket = net.createConnection(address.port, "127.0.0.1");
    socket.once("error", reject);
    socket.once("close", resolve);
    socket.once("connect", () => {
      socket.write([
        "POST /auth/login HTTP/1.1",
        `Host: 127.0.0.1:${address.port}`,
        `Origin: ${origin}`,
        "Content-Type: application/x-www-form-urlencoded",
        "Content-Length: 100",
        "Connection: close",
        "",
        "a",
      ].join("\r\n"));
      setImmediate(() => socket.destroy());
    });
  });
  const healthAfterAbort = await request("/health");
  assert.equal(healthAfterAbort.status, 200, "aborted login request terminated the server");

  const navigation = await request("/private?view=calendar", { headers: { accept: "text/html" } });
  assert.equal(navigation.status, 303, "anonymous navigation was not redirected to login");
  assert.equal(navigation.headers.get("location"), "/auth/login?returnTo=%2Fprivate%3Fview%3Dcalendar");

  const anonymousApi = await request("/api/state");
  assert.equal(anonymousApi.status, 401, "anonymous API request was not rejected");
  assert.equal((await anonymousApi.json()).code, "AUTH_REQUIRED");

  const loginPage = await request("/auth/login?returnTo=%2Fprivate");
  assert.equal(loginPage.status, 200, "login page was not available");
  assert((await loginPage.text()).includes("접근 코드"), "login page did not render the access-code form");

  const wrongLogin = await request("/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin,
    },
    body: new URLSearchParams({ accessCode: "wrong", returnTo: "/private" }),
  });
  assert.equal(wrongLogin.status, 401, "wrong access code was accepted");

  const login = await request("/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-forwarded-proto": "https",
      origin,
    },
    body: new URLSearchParams({ accessCode, returnTo: "/private" }),
  });
  assert.equal(login.status, 303, "correct access code did not create a session");
  assert.equal(login.headers.get("location"), "/private");
  const setCookie = login.headers.get("set-cookie") || "";
  assert(setCookie.includes("sygma_access_session="), "session cookie was not issued");
  assert(setCookie.includes("HttpOnly") && setCookie.includes("SameSite=Lax") && setCookie.includes("Secure"), "session cookie security flags are incomplete");
  const cookie = setCookie.split(";", 1)[0];

  const protectedPage = await request("/private", { headers: { cookie } });
  assert.equal(protectedPage.status, 200, "authenticated navigation was rejected");

  const missingOrigin = await request("/api/state", { method: "POST", headers: { cookie } });
  assert.equal(missingOrigin.status, 403, "authenticated mutation without Origin was accepted");
  assert.equal((await missingOrigin.json()).code, "ORIGIN_NOT_ALLOWED");

  const sameOriginMutation = await request("/api/state", {
    method: "POST",
    headers: { cookie, origin },
  });
  assert.equal(sameOriginMutation.status, 200, "same-origin authenticated mutation was rejected");

  const callback = await request("/api/google/oauth/callback?code=test&state=test");
  assert.equal(callback.status, 200, "OAuth callback was incorrectly blocked by the access gate");

  const logout = await request("/auth/logout", {
    method: "POST",
    headers: { cookie, origin },
  });
  assert.equal(logout.status, 303, "logout did not redirect");
  assert((logout.headers.get("set-cookie") || "").includes("Max-Age=0"), "logout did not expire the session cookie");

  const expiredSession = await request("/api/state", { headers: { cookie } });
  assert.equal(expiredSession.status, 401, "logged-out session remained authorized");

  const unsafeReturn = await request("/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin,
    },
    body: new URLSearchParams({ accessCode, returnTo: "https://example.com/phish" }),
  });
  assert.equal(unsafeReturn.headers.get("location"), "/", "external login redirect was accepted");

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const rejected = await request("/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-test-client": "brute-force-check",
        origin,
      },
      body: new URLSearchParams({ accessCode: "wrong" }),
    });
    assert.equal(rejected.status, 401, "login attempt was rejected before the configured limit");
  }
  const limited = await request("/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-test-client": "brute-force-check",
      origin,
    },
    body: new URLSearchParams({ accessCode }),
  });
  assert.equal(limited.status, 429, "login rate limit was not enforced");
  assert(Number(limited.headers.get("retry-after")) >= 1, "login rate limit did not return Retry-After");

} finally {
  server.close();
  await once(server, "close");
}

async function checkConcurrentLoginLimit() {
  let markFirstAttemptStarted;
  let requestKeyCalls = 0;
  const firstAttemptStarted = new Promise((resolve) => {
    markFirstAttemptStarted = resolve;
  });
  const concurrentController = createAccessController({
    required: true,
    passwordSha256,
    loginMaxAttempts: 1,
    requestKey: () => {
      requestKeyCalls += 1;
      if (requestKeyCalls === 1) markFirstAttemptStarted();
      return "parallel-client";
    },
  });
  const concurrentServer = http.createServer(async (incomingRequest, outgoingResponse) => {
    const requestUrl = new URL(incomingRequest.url || "/", `http://${incomingRequest.headers.host}`);
    if (await concurrentController.handleAuthRoute(incomingRequest, outgoingResponse, requestUrl)) return;
    outgoingResponse.writeHead(404).end();
  });
  concurrentServer.listen(0, "127.0.0.1");
  await once(concurrentServer, "listening");
  const concurrentAddress = concurrentServer.address();
  const concurrentOrigin = `http://127.0.0.1:${concurrentAddress.port}`;
  const body = new URLSearchParams({ accessCode: "wrong" }).toString();

  function pendingLogin() {
    const clientRequest = http.request(`${concurrentOrigin}/auth/login`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": Buffer.byteLength(body),
        origin: concurrentOrigin,
      },
    });
    const status = new Promise((resolve, reject) => {
      clientRequest.once("error", reject);
      clientRequest.once("response", (clientResponse) => {
        clientResponse.resume();
        clientResponse.once("end", () => resolve(clientResponse.statusCode));
      });
    });
    return { clientRequest, status };
  }

  try {
    const first = pendingLogin();
    first.clientRequest.flushHeaders();
    await firstAttemptStarted;
    const second = pendingLogin();
    second.clientRequest.end(body);
    first.clientRequest.end(body);
    const statuses = await Promise.all([first.status, second.status]);
    assert.deepEqual(statuses.sort(), [401, 429], "concurrent login rate limit was bypassed");
  } finally {
    concurrentServer.close();
    await once(concurrentServer, "close");
  }
}

await checkConcurrentLoginLimit();
console.log("Railway access authentication check passed.");
