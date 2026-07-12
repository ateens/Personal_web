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
const fixtureInlineColorKeys = new Set(["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"]);
const fixtureCollectionKeys = [
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
const fixtureBlockCollectionKeys = new Set(["boxes", "goals", "projects", "tasks", "resources", "habits", "journals"]);
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
      const validationIssues = [
        ...fixtureGlobalDuplicateIdIssues(body.state),
        ...fixtureResourceHierarchyIssues(body.state),
        ...fixtureInlineColorIssues(body.state),
        ...fixtureUrlBlockIssues(body.state),
        ...fixtureCommentAnchorIssues(body.state),
        ...fixtureCommentReferenceIssues(body.state),
      ];
      if (validationIssues.length) {
        attempt.outcome = "invalid-state";
        sendJson(response, 422, {
          error: "State validation failed.",
          code: "INVALID_STATE",
          revision: serverRevision,
          details: { issues: validationIssues },
        }, stateRevisionHeaders("invalid"));
        return;
      }
      const missingResourceIds = omittedResourceIds(state, body.state);
      if (missingResourceIds.length) {
        attempt.outcome = "resource-permanent-delete-disabled";
        const visibleResourceIds = missingResourceIds.slice(0, 20);
        sendJson(response, 422, {
          error: "Existing Resources must remain in full-state writes; move them to trash instead.",
          code: "RESOURCE_PERMANENT_DELETE_DISABLED",
          revision: serverRevision,
          details: {
            revision: serverRevision,
            issues: [{
              path: "state.resources",
              code: "resource_permanent_delete_disabled",
              message: "Full-state writes may not omit existing Resource IDs.",
              missingResourceCount: missingResourceIds.length,
              missingResourceIds: visibleResourceIds,
              missingResourceIdsTruncated: visibleResourceIds.length < missingResourceIds.length,
            }],
          },
        }, stateRevisionHeaders("resource-permanent-delete-disabled"));
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
      const validationIssues = [
        ...fixtureGlobalDuplicateIdIssues(nextState),
        ...fixtureResourceHierarchyIssues(nextState),
        ...fixtureInlineColorIssues(nextState),
        ...fixtureUrlBlockIssues(nextState),
        ...fixtureCommentAnchorIssues(nextState),
        ...fixtureCommentReferenceIssues(nextState),
      ];
      if (validationIssues.length) {
        attempt.outcome = "invalid-state";
        sendJson(response, 422, {
          error: "State validation failed.",
          code: "INVALID_STATE",
          revision: serverRevision,
          details: { issues: validationIssues },
        }, stateRevisionHeaders("invalid"));
        return;
      }
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
      const resourceId = typeof body.resourceId === "string" && body.resourceId ? body.resourceId : FIXTURE_IDS.resource;
      const nextTitle = typeof body.title === "string" && body.title.trim() ? body.title.trim() : "Remote concurrent edit";
      const nextState = structuredClone(state);
      const resource = (nextState.resources || []).find((entry) => entry.id === resourceId);
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

function omittedResourceIds(currentState, incomingState) {
  const incomingIds = new Set();
  for (const resource of Array.isArray(incomingState?.resources) ? incomingState.resources : []) {
    if (typeof resource?.id === "string" && resource.id) incomingIds.add(resource.id);
  }
  const missingIds = [];
  for (const resource of Array.isArray(currentState?.resources) ? currentState.resources : []) {
    const resourceId = typeof resource?.id === "string" ? resource.id : "";
    if (resourceId && !incomingIds.has(resourceId)) missingIds.push(resourceId);
  }
  return missingIds.sort();
}

function fixtureGlobalDuplicateIdIssues(incomingState) {
  const seenIds = new Map();
  const issues = [];
  const register = (id, path) => {
    if (typeof id !== "string" || !id) return;
    const previous = seenIds.get(id);
    if (previous) {
      issues.push({ path, code: "duplicate_id", message: `ID duplicates ${previous}.` });
      return;
    }
    seenIds.set(id, path);
  };

  for (const collection of fixtureCollectionKeys) {
    const items = Array.isArray(incomingState?.[collection]) ? incomingState[collection] : [];
    for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
      const item = items[itemIndex];
      const itemPath = `state.${collection}[${itemIndex}]`;
      register(item?.id, `${itemPath}.id`);
      if (fixtureBlockCollectionKeys.has(collection)) {
        const blocks = Array.isArray(item?.blocks) ? item.blocks : [];
        for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
          register(blocks[blockIndex]?.id, `${itemPath}.blocks[${blockIndex}].id`);
        }
      }
      if (collection !== "resources") continue;
      const threads = Array.isArray(item?.commentThreads) ? item.commentThreads : [];
      for (let threadIndex = 0; threadIndex < threads.length; threadIndex += 1) {
        const thread = threads[threadIndex];
        const threadPath = `${itemPath}.commentThreads[${threadIndex}]`;
        register(thread?.id, `${threadPath}.id`);
        const replies = Array.isArray(thread?.replies) ? thread.replies : [];
        for (let replyIndex = 0; replyIndex < replies.length; replyIndex += 1) {
          register(replies[replyIndex]?.id, `${threadPath}.replies[${replyIndex}].id`);
        }
      }
    }
  }
  return issues;
}

function fixtureResourceHierarchyIssues(incomingState) {
  const resources = Array.isArray(incomingState?.resources) ? incomingState.resources : [];
  const resourcesById = new Map();
  for (const resource of resources) {
    if (typeof resource?.id === "string" && resource.id && !resourcesById.has(resource.id)) resourcesById.set(resource.id, resource);
  }
  const resourceIds = new Set(resourcesById.keys());
  const orderedChildOwners = new Map();
  const issues = [];
  const addIssue = (path, code, message) => issues.push({ path, code, message });

  for (let index = 0; index < resources.length; index += 1) {
    const resource = resources[index];
    if (!resource || typeof resource !== "object" || Array.isArray(resource) || typeof resource.id !== "string" || !resource.id) continue;
    const resourcePath = `state.resources[${index}]`;
    if (resource.locked !== undefined && typeof resource.locked !== "boolean") {
      addIssue(`${resourcePath}.locked`, "invalid_resource_locked", "Resource locked must be a boolean.");
    }
    if (resource.parentId === resource.id) {
      addIssue(`${resourcePath}.parentId`, "resource_self_parent", "A Resource may not be its own parent.");
    } else if (resource.parentId && (typeof resource.parentId !== "string" || !resourceIds.has(resource.parentId))) {
      addIssue(`${resourcePath}.parentId`, "broken_relation", "parentId does not reference an existing item.");
    }
    if (!Array.isArray(resource.childOrder)) continue;
    for (let childIndex = 0; childIndex < resource.childOrder.length; childIndex += 1) {
      const childId = resource.childOrder[childIndex];
      const childPath = `${resourcePath}.childOrder[${childIndex}]`;
      if (typeof childId !== "string" || !childId) continue;
      if (!resourceIds.has(childId)) {
        addIssue(childPath, "broken_child_relation", "childOrder must reference an existing Resource.");
        continue;
      }
      if (childId === resource.id) {
        addIssue(childPath, "resource_self_child", "A Resource may not list itself as a child.");
        continue;
      }
      const previousOwner = orderedChildOwners.get(childId);
      if (previousOwner && previousOwner !== resource.id) {
        addIssue(childPath, "duplicate_child_parent", "A Resource may be ordered under only one parent.");
      } else {
        orderedChildOwners.set(childId, resource.id);
      }
      if (resourcesById.get(childId)?.parentId !== resource.id) {
        addIssue(childPath, "invalid_child_parent", "childOrder may contain only direct children whose parentId matches this Resource.");
      }
    }
  }

  for (let index = 0; index < resources.length; index += 1) {
    const resource = resources[index];
    if (!resource || typeof resource.id !== "string" || !resource.id || !resource.parentId || resource.parentId === resource.id) continue;
    const ancestors = new Set([resource.id]);
    let cursor = resource;
    while (typeof cursor?.parentId === "string" && cursor.parentId) {
      if (ancestors.has(cursor.parentId)) {
        addIssue(`state.resources[${index}].parentId`, "resource_parent_cycle", "Resource parent relationships may not form a cycle.");
        break;
      }
      ancestors.add(cursor.parentId);
      cursor = resourcesById.get(cursor.parentId);
      if (!cursor) break;
    }
  }
  return issues;
}

function fixtureInlineColorIssues(incomingState) {
  const issues = [];
  const collections = ["boxes", "goals", "projects", "tasks", "resources", "habits", "journals"];
  for (const collection of collections) {
    const items = Array.isArray(incomingState?.[collection]) ? incomingState[collection] : [];
    for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
      const blocks = Array.isArray(items[itemIndex]?.blocks) ? items[itemIndex].blocks : [];
      for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
        const marks = Array.isArray(blocks[blockIndex]?.marks) ? blocks[blockIndex].marks : [];
        for (let markIndex = 0; markIndex < marks.length; markIndex += 1) {
          const mark = marks[markIndex];
          if (!["textColor", "backgroundColor"].includes(mark?.type) || fixtureInlineColorKeys.has(mark.color)) continue;
          issues.push({
            path: `state.${collection}[${itemIndex}].blocks[${blockIndex}].marks[${markIndex}].color`,
            code: "unsupported_inline_color",
            message: "Inline color must use a supported palette key.",
          });
        }
      }
    }
  }
  return issues;
}

function fixtureUrlBlockIssues(incomingState) {
  const issues = [];
  const resources = Array.isArray(incomingState?.resources) ? incomingState.resources : [];
  for (let resourceIndex = 0; resourceIndex < resources.length; resourceIndex += 1) {
    const blocks = Array.isArray(resources[resourceIndex]?.blocks) ? resources[resourceIndex].blocks : [];
    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
      const block = blocks[blockIndex];
      if (!block || !["bookmark", "embed"].includes(block.type)) continue;
      const path = `state.resources[${resourceIndex}].blocks[${blockIndex}]`;
      if (!fixtureSafeHttpsBlockUrl(block.url)) {
        issues.push({
          path: `${path}.url`,
          code: "unsafe_block_url",
          message: "Bookmark and embed blocks require a credential-free HTTPS URL.",
        });
      } else if (block.text !== block.url) {
        issues.push({
          path: `${path}.text`,
          code: "invalid_url_block_text",
          message: "Bookmark and embed block text must match block.url.",
        });
      }
    }
  }
  return issues;
}

function fixtureCommentAnchorIssues(incomingState) {
  const issues = [];
  const resources = Array.isArray(incomingState?.resources) ? incomingState.resources : [];
  for (let resourceIndex = 0; resourceIndex < resources.length; resourceIndex += 1) {
    const resource = resources[resourceIndex];
    const blockTextLengths = new Map((Array.isArray(resource?.blocks) ? resource.blocks : []).map((block) => [block?.id, typeof block?.text === "string" ? block.text.length : 0]));
    const threads = Array.isArray(resource?.commentThreads) ? resource.commentThreads : [];
    for (let threadIndex = 0; threadIndex < threads.length; threadIndex += 1) {
      const thread = threads[threadIndex];
      const path = `state.resources[${resourceIndex}].commentThreads[${threadIndex}]`;
      if (thread?.scope === "page") {
        if (thread.anchor !== undefined && thread.anchor !== null) {
          issues.push({ path: `${path}.anchor`, code: "invalid_comment_anchor", message: "Page comments may not have an inline anchor." });
        }
        continue;
      }
      if (thread?.scope !== "inline") continue;
      const anchor = thread.anchor;
      const textLength = blockTextLengths.get(anchor?.blockId);
      if (!anchor || typeof anchor.blockId !== "string" || textLength === undefined) {
        issues.push({ path: `${path}.anchor.blockId`, code: "broken_comment_anchor", message: "Inline comment anchor must reference a block in the same Resource." });
        continue;
      }
      if (!Number.isInteger(anchor.start) || !Number.isInteger(anchor.end) || anchor.start < 0 || anchor.end <= anchor.start || anchor.end > textLength) {
        issues.push({ path: `${path}.anchor`, code: "invalid_comment_range", message: "Inline comment range must be within the referenced block text and have positive length." });
      }
    }
  }
  return issues;
}

function fixtureCommentReferenceIssues(incomingState) {
  const issues = [];
  const resources = Array.isArray(incomingState?.resources) ? incomingState.resources : [];
  for (let resourceIndex = 0; resourceIndex < resources.length; resourceIndex += 1) {
    const resource = resources[resourceIndex];
    const resourcePath = `state.resources[${resourceIndex}]`;
    const threads = Array.isArray(resource?.commentThreads) ? resource.commentThreads : [];
    const threadLocationsById = new Map();
    const markLocationsByCommentId = new Map();

    for (let threadIndex = 0; threadIndex < threads.length; threadIndex += 1) {
      const thread = threads[threadIndex];
      if (!thread || typeof thread !== "object" || Array.isArray(thread) || typeof thread.id !== "string" || !thread.id) continue;
      const locations = threadLocationsById.get(thread.id) || [];
      locations.push({ thread, path: `${resourcePath}.commentThreads[${threadIndex}]` });
      threadLocationsById.set(thread.id, locations);
    }

    const blocks = Array.isArray(resource?.blocks) ? resource.blocks : [];
    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
      const block = blocks[blockIndex];
      const marks = Array.isArray(block?.marks) ? block.marks : [];
      for (let markIndex = 0; markIndex < marks.length; markIndex += 1) {
        const mark = marks[markIndex];
        if (!mark || typeof mark !== "object" || Array.isArray(mark) || mark.type !== "comment") continue;
        const markPath = `${resourcePath}.blocks[${blockIndex}].marks[${markIndex}]`;
        if (typeof mark.commentId !== "string" || !mark.commentId.trim() || mark.commentId.length > 256) {
          issues.push({ path: `${markPath}.commentId`, code: "invalid_comment_id", message: "Comment mark ID must be a non-empty string of at most 256 characters." });
          continue;
        }
        if (typeof mark.body !== "string" || !mark.body.trim()) {
          issues.push({ path: `${markPath}.body`, code: "invalid_comment_body", message: "Comment body must be a non-empty string." });
        }
        const markLocations = markLocationsByCommentId.get(mark.commentId) || [];
        markLocations.push({ block, mark, path: markPath });
        markLocationsByCommentId.set(mark.commentId, markLocations);

        const threadLocations = threadLocationsById.get(mark.commentId) || [];
        if (!threadLocations.length) {
          issues.push({ path: `${markPath}.commentId`, code: "orphan_comment_mark", message: "Comment mark must reference a comment thread in the same Resource." });
          continue;
        }
        if (threadLocations.length !== 1) continue;
        const { thread } = threadLocations[0];
        if (thread.deletedAt) {
          issues.push({ path: `${markPath}.commentId`, code: "deleted_comment_mark", message: "Deleted comment threads may not retain inline marks." });
          continue;
        }
        if (thread.scope !== "inline") {
          issues.push({ path: `${markPath}.commentId`, code: "non_inline_comment_mark", message: "Page comments, including comments with lost anchors, may not retain inline marks." });
          continue;
        }
        if (block?.id !== thread.anchor?.blockId || mark.start !== thread.anchor?.start || mark.end !== thread.anchor?.end) {
          issues.push({ path: markPath, code: "comment_anchor_mismatch", message: "Comment mark location must exactly match its inline thread anchor." });
        }
        if (
          typeof mark.body === "string"
          && mark.body.trim()
          && typeof thread.body === "string"
          && mark.body.trim() !== thread.body.trim()
        ) {
          issues.push({ path: `${markPath}.body`, code: "comment_body_mismatch", message: "Comment mark body must match its thread body after trimming." });
        }
      }
    }

    for (const locations of threadLocationsById.values()) {
      if (locations.length !== 1) continue;
      const { thread, path: threadPath } = locations[0];
      if (thread.scope !== "inline" || thread.deletedAt) continue;
      const markLocations = markLocationsByCommentId.get(thread.id) || [];
      const matchingLocations = markLocations.filter(({ block, mark }) => (
        block?.id === thread.anchor?.blockId
        && mark.start === thread.anchor?.start
        && mark.end === thread.anchor?.end
      ));
      if (matchingLocations.length === 0) {
        issues.push({ path: `${threadPath}.anchor`, code: "missing_comment_mark", message: "Every live inline comment thread requires one matching comment mark." });
      }
      if (markLocations.length > 1) {
        issues.push({ path: `${threadPath}.id`, code: "duplicate_comment_mark", message: "A live inline comment thread may have exactly one comment mark." });
      }
    }
  }
  return issues;
}

function fixtureSafeHttpsBlockUrl(value) {
  if (typeof value !== "string" || !value || value !== value.trim() || value.length > 4096) return false;
  if (!/^https:\/\//i.test(value) || /[\u0000-\u0020\u007f<>"'`]/.test(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && Boolean(parsed.hostname) && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
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
