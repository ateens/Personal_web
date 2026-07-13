import { spawn } from "node:child_process";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer as createNetServer } from "node:net";
import { PRODUCTION_RAILWAY_SECURITY_POLICY, deploymentSecurityPolicy } from "../server/deployment-security.js";
import { createStorage } from "../server/storage.js";
import sitesWorker from "../worker/index.js";

const databaseUrl = String(process.env.DATABASE_URL || "").trim();
if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const PRIVATE_DATA_KEY = "api_proxy_auth";
const CONFIG_VERSION = 1;
const CACHE_TTL_MS = 150;
const appStateId = `check-api-proxy-auth-${randomBytes(12).toString("hex")}`;
const databaseToken = randomBytes(32).toString("base64url");
const environmentToken = randomBytes(32).toString("base64url");
const environmentTokenSha256 = createHash("sha256").update(environmentToken).digest("hex");
const wrongToken = randomBytes(32).toString("base64url");
const googleOAuthHandoffSecret = randomBytes(32).toString("base64url");
const googleOAuthClientSecret = "proxy-auth-check-google-client-secret";
const injectedEmail = "proxy-auth-check@example.invalid";
const observedBodies = [];
const serverLogs = [];
let storage;
let runningServer;
let peerServer;

try {
  const productionDeployment = deploymentSecurityPolicy({
    RAILWAY_PROJECT_ID: PRODUCTION_RAILWAY_SECURITY_POLICY.projectId,
    RAILWAY_ENVIRONMENT_ID: PRODUCTION_RAILWAY_SECURITY_POLICY.environmentId,
    RAILWAY_SERVICE_ID: PRODUCTION_RAILWAY_SECURITY_POLICY.serviceId,
  });
  assert(productionDeployment.isProductionTarget, "production Railway target was not identified");
  assert(productionDeployment.forceApiAuth, "production Railway target did not force API authentication");
  assert(productionDeployment.forceStatePrecondition, "production Railway target did not force state preconditions");
  assert(
    productionDeployment.apiBearerTokenSha256 === PRODUCTION_RAILWAY_SECURITY_POLICY.apiBearerTokenSha256,
    "production Railway target did not select its one-way bearer verifier",
  );
  assert(
    productionDeployment.googleRedirectUri === PRODUCTION_RAILWAY_SECURITY_POLICY.googleRedirectUri,
    "production Railway target did not select its exact Google callback URI",
  );
  assert(
    productionDeployment.publicBaseUrl === PRODUCTION_RAILWAY_SECURITY_POLICY.publicBaseUrl,
    "production Railway target did not select its exact public Sites origin",
  );
  for (const [label, ids] of [
    ["project", { RAILWAY_PROJECT_ID: "copied-project" }],
    ["environment", { RAILWAY_ENVIRONMENT_ID: "preview-environment" }],
    ["service", { RAILWAY_SERVICE_ID: "replacement-service" }],
  ]) {
    const otherDeployment = deploymentSecurityPolicy({
      RAILWAY_PROJECT_ID: PRODUCTION_RAILWAY_SECURITY_POLICY.projectId,
      RAILWAY_ENVIRONMENT_ID: PRODUCTION_RAILWAY_SECURITY_POLICY.environmentId,
      RAILWAY_SERVICE_ID: PRODUCTION_RAILWAY_SECURITY_POLICY.serviceId,
      ...ids,
    });
    assert(!otherDeployment.forceApiAuth, `mismatched Railway ${label} inherited the production verifier`);
    assert(!otherDeployment.isProductionTarget, `mismatched Railway ${label} was identified as production`);
  }

  storage = createStorage({ databaseUrl, appStateId });
  await storage.deletePrivateData(PRIVATE_DATA_KEY);
  await writePolicy(false, databaseToken);

  const oauthServerEnvironment = {
    FAIL_CLOSED_API_AUTH: "0",
    API_BEARER_TOKEN: "",
    PUBLIC_BASE_URL: "https://sygma.example",
    GOOGLE_REDIRECT_URI: "https://railway.example/api/google/oauth/callback",
    GOOGLE_OAUTH_HANDOFF_SECRET: googleOAuthHandoffSecret,
    API_RATE_LIMIT_GOOGLE_MUTATION_MAX: "1",
  };
  runningServer = await startServer(oauthServerEnvironment);

  const stagedAccess = await requestJson(runningServer, "/api/state/status", {
    headers: {
      Authorization: "Bearer browser-injected-token-is-ignored",
      "X-Authenticated-User-Email": injectedEmail,
    },
  });
  assert(stagedAccess.response.status === 200, "staged enforced=false policy did not allow access");

  await writePolicy(true, databaseToken);
  await delay(CACHE_TTL_MS + 100);

  const anonymous = await requestJson(runningServer, "/api/state/status");
  assertUnauthorized(anonymous, "anonymous request after cache expiry");
  const wrong = await requestJson(runningServer, "/api/state/status", {
    headers: {
      Authorization: `Bearer ${wrongToken}`,
      "X-Authenticated-User-Email": injectedEmail,
    },
  });
  assertUnauthorized(wrong, "wrong database bearer token");
  const authorized = await requestJson(runningServer, "/api/state/status", {
    headers: { Authorization: `Bearer ${databaseToken}` },
  });
  assert(authorized.response.status === 200, "correct database bearer token was rejected");

  const oauthCallback = await request(runningServer, "/api/google/oauth/callback?state=invalid&code=invalid", {
    redirect: "manual",
  });
  assert(oauthCallback.response.status === 302, "OAuth callback was incorrectly blocked by API bearer auth");
  assert(
    oauthCallback.response.headers.get("location") === "https://sygma.example/?google=failed",
    "OAuth callback no longer returns failures to the public app origin",
  );
  const repeatedInvalidCallback = await request(runningServer, "/api/google/oauth/callback?state=invalid&code=invalid", {
    redirect: "manual",
  });
  assert(repeatedInvalidCallback.response.status === 302, "invalid OAuth traffic exhausted a shared callback IP bucket");

  const rawOauthStart = await requestJson(runningServer, "/api/google/auth/start?returnTo=%2F%3Fview%3Dcalendar", {
    redirect: "manual",
  });
  assert(rawOauthStart.response.status === 403, "raw OAuth start was not rejected");
  assert(rawOauthStart.payload.code === "GOOGLE_OAUTH_HANDOFF_INVALID", "raw OAuth start returned the wrong failure code");
  const repeatedRawOauthStart = await requestJson(runningServer, "/api/google/auth/start?returnTo=%2F%3Fview%3Dcalendar", {
    redirect: "manual",
  });
  assert(repeatedRawOauthStart.response.status === 403, "invalid OAuth traffic exhausted a shared start IP bucket");

  const expiredHandoff = createGoogleOAuthHandoff({
    issuedAt: Math.floor(Date.now() / 1_000) - 240,
    expiresAt: Math.floor(Date.now() / 1_000) - 120,
  });
  const expiredOauthStart = await requestJson(runningServer, `/api/google/auth/start?handoff=${encodeURIComponent(expiredHandoff)}`, {
    redirect: "manual",
  });
  assert(expiredOauthStart.response.status === 403, "expired OAuth handoff was not rejected");

  const externalReturnHandoff = createGoogleOAuthHandoff({ returnTo: "https://attacker.example/" });
  const externalReturnStart = await requestJson(runningServer, `/api/google/auth/start?handoff=${encodeURIComponent(externalReturnHandoff)}`, {
    redirect: "manual",
  });
  assert(externalReturnStart.response.status === 403, "external OAuth return target was not rejected");

  const validHandoff = await createSitesWorkerHandoff("/?view=calendar&googlePopup=1");
  const [handoffPayload, handoffSignature] = validHandoff.split(".");
  const tamperedHandoff = `${handoffPayload}.${handoffSignature[0] === "A" ? "B" : "A"}${handoffSignature.slice(1)}`;
  const tamperedOauthStart = await requestJson(runningServer, `/api/google/auth/start?handoff=${encodeURIComponent(tamperedHandoff)}`, {
    redirect: "manual",
  });
  assert(tamperedOauthStart.response.status === 403, "tampered OAuth handoff was not rejected");

  const oauthStart = await request(runningServer, `/api/google/auth/start?handoff=${encodeURIComponent(validHandoff)}`, {
    redirect: "manual",
    headers: { "x-forwarded-proto": "https" },
  });
  assert(oauthStart.response.status === 302, "valid OAuth handoff was incorrectly blocked");
  const oauthAuthorizationUrl = new URL(oauthStart.response.headers.get("location"));
  assert(oauthAuthorizationUrl.origin === "https://accounts.google.com", "OAuth start no longer redirects to Google");
  assert(
    oauthAuthorizationUrl.searchParams.get("redirect_uri") === "https://railway.example/api/google/oauth/callback",
    "OAuth start did not use the explicit backend callback URI",
  );
  const oauthState = oauthAuthorizationUrl.searchParams.get("state");
  const oauthStatePayload = decodeSignedPayload(oauthState);
  assert(oauthStatePayload.aud === "google-oauth-state", "OAuth state did not use the signed state audience");
  assert(oauthStatePayload.returnTo === "/?view=calendar&googlePopup=1", "OAuth state lost the approved return target");
  const oauthCookie = oauthStart.response.headers.get("set-cookie") || "";
  assert(oauthCookie.includes(`sygma_google_oauth_state=${oauthStatePayload.nonce}`), "OAuth state cookie did not match signed state");
  assert(oauthCookie.includes("HttpOnly"), "OAuth state cookie was not HttpOnly");
  assert(oauthCookie.includes("SameSite=Lax"), "OAuth state cookie did not use SameSite=Lax");
  assert(oauthCookie.includes("Secure"), "OAuth state cookie was not Secure on HTTPS");

  await stopServer(runningServer);
  runningServer = null;
  runningServer = await startServer(oauthServerEnvironment);

  const replayedHandoff = await requestJson(runningServer, `/api/google/auth/start?handoff=${encodeURIComponent(validHandoff)}`, {
    redirect: "manual",
  });
  assert(replayedHandoff.response.status === 403, "replayed OAuth handoff was not rejected after a server restart");

  const [statePayloadPart, stateSignaturePart] = oauthState.split(".");
  const tamperedState = `${statePayloadPart}.${stateSignaturePart[0] === "A" ? "B" : "A"}${stateSignaturePart.slice(1)}`;
  const callbackCookie = `sygma_google_oauth_state=${oauthStatePayload.nonce}`;
  const tamperedStateCallback = await request(runningServer, `/api/google/oauth/callback?state=${encodeURIComponent(tamperedState)}`, {
    redirect: "manual",
    headers: { cookie: callbackCookie },
  });
  assert(
    tamperedStateCallback.response.headers.get("location") === "https://sygma.example/?google=failed",
    "tampered OAuth state did not return to the fixed failure location",
  );

  const missingCodeCallback = await request(runningServer, `/api/google/oauth/callback?state=${encodeURIComponent(oauthState)}`, {
    redirect: "manual",
    headers: { cookie: callbackCookie },
  });
  assert(
    missingCodeCallback.response.headers.get("location") === "https://sygma.example/?view=calendar&googlePopup=1&google=failed",
    "valid OAuth state without a code did not return to its approved app location",
  );
  const replayedStateCallback = await request(runningServer, `/api/google/oauth/callback?state=${encodeURIComponent(oauthState)}`, {
    redirect: "manual",
    headers: { cookie: callbackCookie },
  });
  assert(
    replayedStateCallback.response.headers.get("location") === "https://sygma.example/?google=failed",
    "replayed OAuth state was not rejected at the fixed failure location",
  );

  peerServer = await startServer(oauthServerEnvironment);
  const concurrentHandoff = await createSitesWorkerHandoff("/?view=calendar&googlePopup=1");
  const concurrentPath = `/api/google/auth/start?handoff=${encodeURIComponent(concurrentHandoff)}`;
  const concurrentClaims = await Promise.all([
    request(runningServer, concurrentPath, { redirect: "manual" }),
    request(peerServer, concurrentPath, { redirect: "manual" }),
  ]);
  assert(
    concurrentClaims.map((result) => result.response.status).sort((left, right) => left - right).join(",") === "302,403",
    "concurrent OAuth handoff claims were not atomic across server processes",
  );
  await stopServer(peerServer);
  peerServer = null;

  await storage.writePrivateData(PRIVATE_DATA_KEY, { version: CONFIG_VERSION, enforced: true, token: "" });
  runningServer.process.kill("SIGHUP");
  await delay(25);
  const malformed = await requestJson(runningServer, "/api/state/status");
  assertServiceUnavailable(malformed, "malformed enforced policy");

  await writePolicy(false, databaseToken);
  runningServer.process.kill("SIGHUP");
  await delay(25);
  const disabled = await requestJson(runningServer, "/api/state/status", {
    headers: { Authorization: `Bearer ${wrongToken}` },
  });
  assert(disabled.response.status === 200, "disabled database policy did not take effect after explicit cache invalidation");
  await stopServer(runningServer);
  runningServer = null;

  await writePolicy(true, databaseToken);
  runningServer = await startServer({
    FAIL_CLOSED_API_AUTH: "1",
    API_BEARER_TOKEN: environmentToken,
  });
  assertUnauthorized(await requestJson(runningServer, "/api/state/status"), "environment override anonymous request");
  assertUnauthorized(
    await requestJson(runningServer, "/api/state/status", { headers: { Authorization: `Bearer ${databaseToken}` } }),
    "database token while environment override is active",
  );
  const environmentAuthorized = await requestJson(runningServer, "/api/state/status", {
    headers: { Authorization: `Bearer ${environmentToken}` },
  });
  assert(environmentAuthorized.response.status === 200, "environment bearer token did not remain the highest-priority credential");
  await stopServer(runningServer);
  runningServer = null;

  runningServer = await startServer({
    FAIL_CLOSED_API_AUTH: "1",
    API_BEARER_TOKEN: wrongToken,
    API_BEARER_TOKEN_SHA256: `sha256:${environmentTokenSha256}`,
  });
  assertUnauthorized(await requestJson(runningServer, "/api/state/status"), "digest override anonymous request");
  assertUnauthorized(
    await requestJson(runningServer, "/api/state/status", { headers: { Authorization: `Bearer ${wrongToken}` } }),
    "wrong token while digest override is active",
  );
  const digestAuthorized = await requestJson(runningServer, "/api/state/status", {
    headers: { Authorization: `Bearer ${environmentToken}` },
  });
  assert(digestAuthorized.response.status === 200, "correct bearer token was rejected by its SHA-256 verifier");
  await stopServer(runningServer);
  runningServer = null;

  runningServer = await startServer({
    FAIL_CLOSED_API_AUTH: "1",
    API_BEARER_TOKEN: "",
    API_BEARER_TOKEN_SHA256: "sha256:not-a-valid-digest",
  });
  assertServiceUnavailable(
    await requestJson(runningServer, "/api/state/status", {
      headers: { Authorization: `Bearer ${environmentToken}` },
    }),
    "malformed environment token digest",
  );
  await stopServer(runningServer);
  runningServer = null;

  runningServer = await startServer({
    FAIL_CLOSED_API_AUTH: "1",
    API_BEARER_TOKEN: "",
    API_BEARER_TOKEN_SHA256: "",
  });
  const missingEnvironmentToken = await requestJson(runningServer, "/api/state/status", {
    headers: { Authorization: `Bearer ${databaseToken}` },
  });
  assertServiceUnavailable(missingEnvironmentToken, "missing environment token override");
  await stopServer(runningServer);
  runningServer = null;

  const productionGoogleEnvironment = {
    RAILWAY_PROJECT_ID: PRODUCTION_RAILWAY_SECURITY_POLICY.projectId,
    RAILWAY_ENVIRONMENT_ID: PRODUCTION_RAILWAY_SECURITY_POLICY.environmentId,
    RAILWAY_SERVICE_ID: PRODUCTION_RAILWAY_SECURITY_POLICY.serviceId,
    GOOGLE_REDIRECT_URI: PRODUCTION_RAILWAY_SECURITY_POLICY.googleRedirectUri,
    PUBLIC_BASE_URL: PRODUCTION_RAILWAY_SECURITY_POLICY.publicBaseUrl,
    GOOGLE_OAUTH_HANDOFF_SECRET: googleOAuthHandoffSecret,
  };
  await assertServerStartupRejected({
    ...productionGoogleEnvironment,
    GOOGLE_REDIRECT_URI: "https://wrong.example/api/google/oauth/callback",
  }, "wrong production Google callback URI");
  await assertServerStartupRejected({
    ...productionGoogleEnvironment,
    PUBLIC_BASE_URL: "https://wrong.example",
  }, "wrong production public app origin");
  await assertServerStartupRejected({
    ...productionGoogleEnvironment,
    GOOGLE_OAUTH_HANDOFF_SECRET: "too-short",
  }, "short production OAuth handoff secret");
  await assertServerStartupRejected({
    ...productionGoogleEnvironment,
    GOOGLE_OAUTH_HANDOFF_SECRET: ` ${googleOAuthHandoffSecret}`,
  }, "whitespace-altered production OAuth handoff secret");
  await assertServerStartupRejected({
    ...productionGoogleEnvironment,
    GOOGLE_CLIENT_SECRET: "",
  }, "missing production Google client secret");
  runningServer = await startServer(productionGoogleEnvironment);
  await stopServer(runningServer);
  runningServer = null;

  const sensitiveOutput = [...observedBodies, ...serverLogs].join("\n");
  for (const secret of [databaseToken, environmentToken, wrongToken, injectedEmail, googleOAuthHandoffSecret, googleOAuthClientSecret]) {
    assert(!sensitiveOutput.includes(secret), "authentication secret or identity leaked into a response or server log");
  }

  console.log("Database-backed API proxy authentication check passed.");
} catch (error) {
  console.error(error?.message || "Database-backed API proxy authentication check failed.");
  process.exitCode = 1;
} finally {
  await stopServer(peerServer).catch(() => {});
  await stopServer(runningServer).catch(() => {});
  if (storage) {
    try {
      await storage.deleteOAuthTransactions();
      const remainingOAuthTransactions = await storage.deleteOAuthTransactions();
      if (remainingOAuthTransactions !== 0) throw new Error("OAuth transaction rows remained after cleanup.");
    } catch {
      console.error("OAuth transaction check row cleanup failed.");
      process.exitCode = 1;
    }
    await storage.deletePrivateData(PRIVATE_DATA_KEY).catch(() => {});
    const remaining = await storage.readPrivateData(PRIVATE_DATA_KEY).catch(() => ({ data: "unavailable" }));
    if (remaining.data !== null) {
      console.error("API proxy authentication check row cleanup failed.");
      process.exitCode = 1;
    }
    await storage.end().catch(() => {});
  }
}

async function writePolicy(enforced, token) {
  await storage.writePrivateData(PRIVATE_DATA_KEY, {
    version: CONFIG_VERSION,
    token,
    enforced,
  });
}

function createGoogleOAuthHandoff({
  issuedAt = Math.floor(Date.now() / 1_000),
  expiresAt = issuedAt + 120,
  nonce = randomBytes(24).toString("base64url"),
  returnTo = "/?view=calendar",
} = {}) {
  const subject = createHmac("sha256", googleOAuthHandoffSecret)
    .update("sygma-google-oauth-user-v1.proxy-auth-check@example.invalid", "utf8")
    .digest("base64url");
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    aud: "google-oauth-start",
    iat: issuedAt,
    exp: expiresAt,
    nonce,
    sub: subject,
    returnTo,
  })).toString("base64url");
  const signature = createHmac("sha256", googleOAuthHandoffSecret)
    .update(`sygma-google-oauth-handoff-v1.${payload}`, "utf8")
    .digest("base64url");
  return `${payload}.${signature}`;
}

async function createSitesWorkerHandoff(returnTo) {
  const requestUrl = new URL("https://sygma.example/api/google/auth/start");
  requestUrl.searchParams.set("returnTo", returnTo);
  const response = await sitesWorker.fetch(new Request(requestUrl, {
    headers: { "oai-authenticated-user-email": "proxy-auth-check@example.invalid" },
  }), {
    REQUIRE_AUTHENTICATED_PROXY: "1",
    API_BEARER_TOKEN: databaseToken,
    GOOGLE_OAUTH_HANDOFF_SECRET: googleOAuthHandoffSecret,
    API_ORIGIN: "https://railway.example",
  });
  assert(response.status === 302, "Sites Worker did not create an OAuth handoff redirect");
  const location = new URL(response.headers.get("location"));
  assert(location.origin === "https://railway.example", "Sites Worker handoff used the wrong Railway origin");
  return location.searchParams.get("handoff");
}

function decodeSignedPayload(value) {
  const [payload] = String(value || "").split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

async function startServer(overrides) {
  const port = await reservePort();
  const child = spawn("node", ["server.js"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      DATABASE_URL: databaseUrl,
      APP_STATE_ID: appStateId,
      STATIC_ROOT: ".",
      REQUIRE_STATE_PRECONDITION: "1",
      API_PROXY_AUTH_CACHE_TTL_MS: String(CACHE_TTL_MS),
      API_RATE_LIMIT_STATE_READ_MAX: "1000",
      GOOGLE_CLIENT_ID: "proxy-auth-check-client",
      GOOGLE_CLIENT_SECRET: googleOAuthClientSecret,
      GOOGLE_OAUTH_HANDOFF_SECRET: "",
      TRUST_PROXY_IP_HEADERS: "0",
      FAIL_CLOSED_API_AUTH: "0",
      API_BEARER_TOKEN: "",
      API_BEARER_TOKEN_SHA256: "",
      RAILWAY_PROJECT_ID: "",
      RAILWAY_ENVIRONMENT_ID: "",
      RAILWAY_SERVICE_ID: "",
      ...overrides,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const target = {
    process: child,
    baseUrl: `http://127.0.0.1:${port}`,
    output: "",
  };
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (chunk) => {
      target.output += chunk.toString();
    });
  }
  try {
    await waitForHealth(target);
    return target;
  } catch (error) {
    await stopServer(target).catch(() => {});
    error.serverOutput = target.output;
    throw error;
  }
}

async function stopServer(target) {
  if (!target) return;
  if (target.process.exitCode === null) {
    target.process.kill("SIGTERM");
    await Promise.race([
      once(target.process, "exit"),
      delay(2_000).then(() => {
        if (target.process.exitCode === null) target.process.kill("SIGKILL");
      }),
    ]).catch(() => {});
  }
  serverLogs.push(target.output);
}

async function assertServerStartupRejected(overrides, label) {
  let target;
  try {
    target = await startServer(overrides);
  } catch (error) {
    assert(
      String(error?.message || "").includes("exited before becoming healthy"),
      `${label} did not fail during startup`,
    );
    assert(
      String(error?.serverOutput || "").includes("Production Google OAuth configuration is invalid."),
      `${label} exited for an unrelated reason`,
    );
    return;
  }
  await stopServer(target);
  throw new Error(`${label} unexpectedly started the production server`);
}

async function waitForHealth(target) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (target.process.exitCode !== null) throw new Error("API proxy authentication check server exited before becoming healthy");
    try {
      const response = await fetch(`${target.baseUrl}/health`);
      if (response.ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error("API proxy authentication check server health timed out");
}

async function requestJson(target, path, options = {}) {
  const result = await request(target, path, options);
  return { ...result, payload: JSON.parse(result.body || "{}") };
}

async function request(target, path, options = {}) {
  const response = await fetch(`${target.baseUrl}${path}`, options);
  const body = await response.text();
  observedBodies.push(body);
  return { response, body };
}

function assertUnauthorized(result, label) {
  assert(result.response.status === 401, `${label} did not return 401`);
  assert(result.payload.code === "AUTH_REQUIRED", `${label} did not return AUTH_REQUIRED`);
  assert(result.response.headers.get("www-authenticate") === "Bearer", `${label} did not return a Bearer challenge`);
  assert(result.response.headers.get("cache-control") === "no-store", `${label} response was cacheable`);
}

function assertServiceUnavailable(result, label) {
  assert(result.response.status === 503, `${label} did not return 503`);
  assert(result.payload.code === "API_AUTH_NOT_CONFIGURED", `${label} did not fail closed with API_AUTH_NOT_CONFIGURED`);
  assert(result.response.headers.get("cache-control") === "no-store", `${label} response was cacheable`);
}

async function reservePort() {
  const probe = createNetServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  const port = typeof address === "object" && address ? address.port : 0;
  probe.close();
  await once(probe, "close");
  if (!port) throw new Error("Could not reserve a local API proxy authentication check port");
  return port;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
