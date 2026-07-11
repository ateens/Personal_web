import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer as createNetServer } from "node:net";
import { createStorage } from "../server/storage.js";

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
const wrongToken = randomBytes(32).toString("base64url");
const injectedEmail = "proxy-auth-check@example.invalid";
const observedBodies = [];
const serverLogs = [];
let storage;
let runningServer;

try {
  storage = createStorage({ databaseUrl, appStateId });
  await storage.deletePrivateData(PRIVATE_DATA_KEY);
  await writePolicy(false, databaseToken);

  runningServer = await startServer({
    FAIL_CLOSED_API_AUTH: "0",
    API_BEARER_TOKEN: "",
  });

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
    String(oauthCallback.response.headers.get("location") || "").includes("google=failed"),
    "OAuth callback no longer enforces its state-cookie protection",
  );

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
    API_BEARER_TOKEN: "",
  });
  const missingEnvironmentToken = await requestJson(runningServer, "/api/state/status", {
    headers: { Authorization: `Bearer ${databaseToken}` },
  });
  assertServiceUnavailable(missingEnvironmentToken, "missing environment token override");
  await stopServer(runningServer);
  runningServer = null;

  const sensitiveOutput = [...observedBodies, ...serverLogs].join("\n");
  for (const secret of [databaseToken, environmentToken, wrongToken, injectedEmail]) {
    assert(!sensitiveOutput.includes(secret), "authentication secret or identity leaked into a response or server log");
  }

  console.log("Database-backed API proxy authentication check passed.");
} catch (error) {
  console.error(error?.message || "Database-backed API proxy authentication check failed.");
  process.exitCode = 1;
} finally {
  await stopServer(runningServer).catch(() => {});
  if (storage) {
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
      GOOGLE_CLIENT_SECRET: "proxy-auth-check-secret",
      TRUST_PROXY_IP_HEADERS: "0",
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
  await waitForHealth(target);
  return target;
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
