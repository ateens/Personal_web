import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createFixtureState, FIXTURE_IDS } from "./fixtures/state.mjs";

if (process.env.E2E_FIXTURE_SERVER !== "1") {
  throw new Error("Refusing to start: E2E_FIXTURE_SERVER=1 is required for the memory-only fixture server.");
}

const port = Number(process.env.E2E_PORT || 43128);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("E2E_PORT must be an unprivileged TCP port.");
}

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const resetToken = "sygma-local-e2e-reset";
const guardHeaders = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-E2E-Fixture": "memory-only",
  "X-E2E-Production-Write-Guard": "active",
};
const sourceFiles = new Map([
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/manifest.json", ["manifest.json", "application/manifest+json; charset=utf-8"]],
  ["/service-worker.js", ["service-worker.js", "text/javascript; charset=utf-8"]],
  ["/icons/app-icon.svg", ["icons/app-icon.svg", "image/svg+xml"]],
]);

let state = createFixtureState();
let writes = [];
let writeAttempts = [];
let externalWrites = [];
let serverRevision = 1;
let serviceWorkerVersion = 1;

const server = createServer(async (request, response) => {
  if (!localRequestHost(request.headers.host)) {
    sendJson(response, 403, { error: "Fixture server accepts loopback Host headers only." });
    return;
  }

  const requestUrl = new URL(request.url || "/", `http://${request.headers.host}`);
  const path = requestUrl.pathname;

  try {
    if (request.method === "GET" && path === "/health") {
      sendJson(response, 200, { ok: true, database: "memory", appStateId: FIXTURE_IDS.appState });
      return;
    }
    if (request.method === "GET" && path === "/api/state/status") {
      sendJson(response, 200, {
        configured: true,
        connected: true,
        appStateId: FIXTURE_IDS.appState,
        hasState: true,
        tokenStore: "memory",
        relationalStore: "memory",
        collectionSource: "fixture",
        updatedAt: state.updatedAt,
        revision: serverRevision,
      }, stateRevisionHeaders());
      return;
    }
    if (request.method === "GET" && path === "/api/state") {
      sendJson(response, 200, statePayload(), stateRevisionHeaders());
      return;
    }
    if (["PUT", "POST"].includes(request.method || "") && path === "/api/state") {
      const body = await readJsonBody(request);
      if (!body.state || typeof body.state !== "object" || Array.isArray(body.state)) {
        sendJson(response, 400, { error: "state object is required." });
        return;
      }
      const baseRevision = requestBaseRevision(request, body);
      const attempt = {
        method: request.method,
        baseRevision,
        ifMatch: String(request.headers["if-match"] || ""),
        serverRevision,
        outcome: "pending",
      };
      writeAttempts.push(attempt);
      if (baseRevision === null) {
        attempt.outcome = "precondition-required";
        sendJson(response, 428, {
          error: "A state revision precondition is required.",
          code: "STATE_PRECONDITION_REQUIRED",
          revision: serverRevision,
        }, stateRevisionHeaders("required"));
        return;
      }
      if (baseRevision !== serverRevision) {
        attempt.outcome = "conflict";
        sendJson(response, 409, {
          error: "State revision conflict.",
          code: "STATE_REVISION_CONFLICT",
          revision: serverRevision,
        }, stateRevisionHeaders("conflict"));
        return;
      }
      state = structuredClone(body.state);
      serverRevision += 1;
      attempt.outcome = "saved";
      state.version = 4;
      state.revision = serverRevision;
      writes.push({
        method: request.method,
        serverRevision,
        stateUpdatedAt: state.updatedAt || "",
        resourceRevisions: Object.fromEntries((state.resources || []).map((resource) => [resource.id, resource.revision ?? null])),
      });
      sendJson(response, 200, {
        ok: true,
        concurrency: baseRevision === null ? "fixture-unconditional" : "conditional",
        ...statePayload(),
      }, stateRevisionHeaders(baseRevision === null ? "fixture-unconditional" : "conditional"));
      return;
    }
    if (request.method === "PUT" && path.startsWith("/api/resources/")) {
      const resourceId = decodeURIComponent(path.slice("/api/resources/".length));
      const body = await readJsonBody(request);
      if (!body.resource || typeof body.resource !== "object" || Array.isArray(body.resource)) {
        sendJson(response, 400, { error: "resource object is required." });
        return;
      }
      if (!resourceId || body.resource.id !== resourceId) {
        sendJson(response, 400, { error: "Resource path and body IDs must match.", code: "RESOURCE_ID_MISMATCH" });
        return;
      }
      const baseRevision = requestBaseRevision(request, body);
      const attempt = {
        method: request.method,
        resourceId,
        baseRevision,
        ifMatch: String(request.headers["if-match"] || ""),
        serverRevision,
        outcome: "pending",
      };
      writeAttempts.push(attempt);
      if (baseRevision === null) {
        attempt.outcome = "precondition-required";
        sendJson(response, 428, {
          error: "A state revision precondition is required.",
          code: "STATE_PRECONDITION_REQUIRED",
          revision: serverRevision,
        }, stateRevisionHeaders("required"));
        return;
      }
      if (baseRevision !== serverRevision) {
        attempt.outcome = "conflict";
        sendJson(response, 409, {
          error: "State revision conflict.",
          code: "STATE_REVISION_CONFLICT",
          revision: serverRevision,
        }, stateRevisionHeaders("conflict"));
        return;
      }
      const nextState = structuredClone(state);
      const resourceIndex = (nextState.resources || []).findIndex((resource) => resource.id === resourceId);
      if (resourceIndex >= 0) nextState.resources[resourceIndex] = structuredClone(body.resource);
      else nextState.resources.push(structuredClone(body.resource));
      serverRevision += 1;
      attempt.outcome = "saved";
      nextState.version = 4;
      nextState.revision = serverRevision;
      nextState.updatedAt = new Date().toISOString();
      state = nextState;
      writes.push({
        method: request.method,
        resourceId,
        serverRevision,
        stateUpdatedAt: state.updatedAt,
        resourceRevisions: { [resourceId]: body.resource.revision ?? null },
      });
      sendJson(response, 200, {
        ok: true,
        appStateId: FIXTURE_IDS.appState,
        concurrency: "conditional",
        resource: structuredClone(state.resources.find((resource) => resource.id === resourceId)),
        revision: serverRevision,
        updatedAt: state.updatedAt,
      }, stateRevisionHeaders("conditional"));
      return;
    }
    if (request.method === "GET" && path === "/api/google/status") {
      sendJson(response, 200, { configured: false, connected: false, tokenStore: "memory" });
      return;
    }
    if (path.startsWith("/api/")) {
      sendJson(response, 404, { error: "Fixture API route not found." });
      return;
    }
    if (request.method === "POST" && path === "/__e2e__/reset") {
      if (request.headers["x-e2e-reset-token"] !== resetToken) {
        sendJson(response, 403, { error: "Invalid fixture reset token." });
        return;
      }
      state = createFixtureState();
      writes = [];
      writeAttempts = [];
      externalWrites = [];
      serverRevision = 1;
      serviceWorkerVersion = 1;
      sendJson(response, 200, { ok: true, appStateId: FIXTURE_IDS.appState });
      return;
    }
    if (request.method === "POST" && path === "/__e2e__/service-worker-version") {
      if (request.headers["x-e2e-reset-token"] !== resetToken) {
        sendJson(response, 403, { error: "Invalid fixture reset token." });
        return;
      }
      serviceWorkerVersion += 1;
      sendJson(response, 200, { ok: true, version: serviceWorkerVersion });
      return;
    }
    if (request.method === "POST" && path === "/__e2e__/external-write") {
      if (request.headers["x-e2e-reset-token"] !== resetToken) {
        sendJson(response, 403, { error: "Invalid fixture reset token." });
        return;
      }
      const body = await readJsonBody(request);
      const nextTitle = typeof body.title === "string" && body.title.trim() ? body.title.trim() : "Remote concurrent edit";
      const nextState = structuredClone(state);
      const resource = (nextState.resources || []).find((entry) => entry.id === FIXTURE_IDS.resource);
      if (!resource) {
        sendJson(response, 404, { error: "Fixture Resource not found." });
        return;
      }
      serverRevision += 1;
      const updatedAt = new Date(Date.parse(nextState.updatedAt || "") + 1000 || Date.now()).toISOString();
      resource.title = nextTitle;
      resource.updatedAt = updatedAt;
      resource.revision = Number(resource.revision || 0) + 1;
      nextState.updatedAt = updatedAt;
      nextState.revision = serverRevision;
      state = nextState;
      externalWrites.push({ serverRevision, resourceId: resource.id, title: nextTitle });
      sendJson(response, 200, { ok: true, revision: serverRevision, title: nextTitle }, stateRevisionHeaders("external"));
      return;
    }
    if (request.method === "GET" && path === "/__e2e__/state") {
      sendJson(response, 200, {
        backend: "memory",
        databaseAccess: false,
        productionWritesBlocked: true,
        appStateId: FIXTURE_IDS.appState,
        serverRevision,
        writes: structuredClone(writes),
        writeAttempts: structuredClone(writeAttempts),
        externalWrites: structuredClone(externalWrites),
        serviceWorkerVersion,
        state: structuredClone(state),
      });
      return;
    }
    if (!["GET", "HEAD"].includes(request.method || "")) {
      response.writeHead(405, { ...guardHeaders, Allow: "GET, HEAD" });
      response.end();
      return;
    }

    const sourcePath = path === "/" ? "/index.html" : path;
    if (sourcePath === "/service-worker.js") {
      await sendServiceWorker(request, response);
      return;
    }
    const sourceEntry = sourceFiles.get(sourcePath);
    if (sourceEntry) {
      await sendSourceFile(request, response, ...sourceEntry);
      return;
    }
    if (request.method === "GET" && String(request.headers.accept || "").includes("text/html")) {
      await sendSourceFile(request, response, "index.html", "text/html; charset=utf-8");
      return;
    }
    response.writeHead(404, guardHeaders);
    response.end();
  } catch (error) {
    sendJson(response, error.status || 500, { error: error.message || "Fixture server error." });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Memory-only Playwright fixture listening on http://127.0.0.1:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

function statePayload() {
  return {
    configured: true,
    connected: true,
    appStateId: FIXTURE_IDS.appState,
    updatedAt: state.updatedAt,
    revision: serverRevision,
    state: structuredClone(state),
  };
}

function requestBaseRevision(request, body) {
  const ifMatch = String(request.headers["if-match"] || "").trim();
  const headerMatch = ifMatch.match(/^(?:W\/)?"?(?:state-)?(\d+)"?$/i);
  if (ifMatch && !headerMatch) {
    const error = new Error("If-Match must contain a fixture state revision ETag.");
    error.status = 400;
    throw error;
  }
  const headerRevision = headerMatch ? Number(headerMatch[1]) : null;
  const bodyRevision = body.baseRevision === undefined || body.baseRevision === null || body.baseRevision === ""
    ? null
    : Number(body.baseRevision);
  if (bodyRevision !== null && (!Number.isSafeInteger(bodyRevision) || bodyRevision < 0)) {
    const error = new Error("baseRevision must be a non-negative integer.");
    error.status = 400;
    throw error;
  }
  if (headerRevision !== null && bodyRevision !== null && headerRevision !== bodyRevision) {
    const error = new Error("If-Match and baseRevision must match.");
    error.status = 400;
    throw error;
  }
  return headerRevision ?? bodyRevision;
}

function stateRevisionHeaders(mode = "fixture-optional") {
  return {
    ETag: `"state-${serverRevision}"`,
    "X-State-Revision": String(serverRevision),
    "X-State-Concurrency": mode,
  };
}

function localRequestHost(host = "") {
  try {
    const hostname = new URL(`http://${host}`).hostname;
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
  } catch {
    return false;
  }
}

async function readJsonBody(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (Buffer.byteLength(raw) > 5_000_000) {
      const error = new Error("Fixture request body is too large.");
      error.status = 413;
      throw error;
    }
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    const error = new Error("Invalid JSON body.");
    error.status = 400;
    throw error;
  }
}

async function sendSourceFile(request, response, relativePath, contentType) {
  const content = await readFile(resolve(root, relativePath));
  response.writeHead(200, { ...guardHeaders, "Content-Type": contentType, "Content-Length": content.byteLength });
  response.end(request.method === "HEAD" ? undefined : content);
}

async function sendServiceWorker(request, response) {
  const source = await readFile(resolve(root, "service-worker.js"), "utf8");
  const body = Buffer.from(`${source}\n// fixture-service-worker-version:${serviceWorkerVersion}\n`);
  response.writeHead(200, {
    ...guardHeaders,
    "Content-Type": "text/javascript; charset=utf-8",
    "Content-Length": body.byteLength,
    "Service-Worker-Allowed": "/",
  });
  response.end(request.method === "HEAD" ? undefined : body);
}

function sendJson(response, status, payload, headers = {}) {
  const body = Buffer.from(JSON.stringify(payload));
  response.writeHead(status, { ...guardHeaders, ...headers, "Content-Type": "application/json; charset=utf-8", "Content-Length": body.byteLength });
  response.end(body);
}
