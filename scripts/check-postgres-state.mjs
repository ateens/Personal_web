import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { access, rm, writeFile } from "node:fs/promises";
import { Pool } from "pg";
import { createStorage } from "../server/storage.js";

const databaseUrl = process.env.DATABASE_URL || "";
if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const port = Number(process.env.CHECK_PORT || 4199);
const resourcePort = Number(process.env.CHECK_RESOURCE_PORT || port + 1);
const appStateId = process.env.CHECK_APP_STATE_ID || `check-${randomBytes(6).toString("hex")}`;
const resourceAppStateId = `${appStateId}-resource-api`;
const operatorResetStateId = `${appStateId}-operator-reset`;
const tokenStateId = `${appStateId}-private`;
const legacyTokenStateId = `${appStateId}-legacy-token`;
const checkStateIds = [appStateId, resourceAppStateId, operatorResetStateId, tokenStateId, legacyTokenStateId];
const legacyTokenFile = `/tmp/personal-web-legacy-token-${appStateId}.json`;
const baseUrl = `http://127.0.0.1:${port}`;
const resourceBaseUrl = `http://127.0.0.1:${resourcePort}`;
const pool = new Pool({ connectionString: databaseUrl, ssl: databaseSslConfig() });
const COLLECTION_KEYS = [
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
let serverProcess;
let resourceServerProcess;
let tokenStorage;
let legacyTokenStorage;
let operatorResetStorage;
let serverStderr = "";
let resourceServerStderr = "";
let stateEventAbort;
let stateEventIterator;

try {
  serverProcess = spawn("node", ["server.js"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      APP_STATE_ID: appStateId,
      STATIC_ROOT: ".",
      REQUIRE_STATE_PRECONDITION: "1",
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  serverProcess.stderr.on("data", (chunk) => {
    serverStderr += chunk;
  });
  await waitForHealth();

  const statusResult = await requestJson("/api/state/status");
  assert(statusResult.response.ok, "state status request failed");
  const status = statusResult.payload;
  assert(status.configured === true && status.connected === true, "state status did not report a PostgreSQL connection");
  assert(status.tokenStore === "postgresql", "Google token store did not report PostgreSQL");
  assert(status.relationalStore === "postgresql" && status.relationalTables?.includes("tasks"), "state status did not report relational PostgreSQL tables");
  assert(status.collectionSource === "relational", "state status did not report relational collections as the source of truth");
  assert(status.hasState === false && status.revision === 0, "isolated state ID was not empty at bootstrap");
  assert(statusResult.response.headers.get("etag") === '"state-0"', "empty state status did not expose the bootstrap ETag");
  assert(statusResult.response.headers.get("x-state-concurrency") === "required", "state status did not advertise required preconditions");

  stateEventAbort = new AbortController();
  const stateEventResponse = await fetch(`${baseUrl}/api/state/events`, {
    headers: { Accept: "text/event-stream" },
    signal: stateEventAbort.signal,
  });
  assert(stateEventResponse.ok, "state event stream request failed");
  assert(stateEventResponse.headers.get("content-type")?.startsWith("text/event-stream"), "state event stream content type is invalid");
  assert(stateEventResponse.headers.get("cache-control") === "no-store, no-transform", "state event stream must bypass caches and transforms");
  stateEventIterator = stateEvents(stateEventResponse.body)[Symbol.asyncIterator]();
  const initialStateEvent = await nextStateEvent(stateEventIterator);
  assert(initialStateEvent.revision === 0, "state event stream did not emit the initial revision");

  const indexHead = await fetch(`${baseUrl}/`, { method: "HEAD" });
  assert(indexHead.ok, "static index HEAD request failed");
  assert(indexHead.headers.get("cache-control") === "no-store", "static index response should not be cached");
  assert(indexHead.headers.get("x-content-type-options") === "nosniff", "static index response is missing nosniff");
  assert(indexHead.headers.get("content-security-policy")?.includes("frame-ancestors 'none'"), "static index response is missing the application CSP");
  const versionedAppHead = await fetch(`${baseUrl}/app.js?v=check`, { method: "HEAD" });
  assert(versionedAppHead.ok, "versioned static asset HEAD request failed");
  assert(versionedAppHead.headers.get("cache-control") === "no-store", "query-versioned source assets must not be cached");
  const compressedApp = await fetch(`${baseUrl}/app.js?v=check`, { headers: { "Accept-Encoding": "br" } });
  assert(compressedApp.ok && compressedApp.headers.get("content-encoding") === "br", "static JavaScript did not use Brotli compression");
  const staticEtag = compressedApp.headers.get("etag");
  assert(staticEtag, "static JavaScript response is missing an ETag");
  const conditionalApp = await fetch(`${baseUrl}/app.js?v=check`, { headers: { "If-None-Match": staticEtag } });
  assert(conditionalApp.status === 200, "no-store source assets must return a fresh 200 response");

  const invalidJsonResult = await requestJson("/api/state", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: "{bad json",
  });
  assert(invalidJsonResult.response.status === 400 && invalidJsonResult.payload.code === "INVALID_JSON", "invalid JSON state write should return INVALID_JSON/400");

  const initialState = makeValidState();
  const bootstrapResult = await requestJson("/api/state", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "If-Match": '"state-0"',
    },
    body: JSON.stringify({ state: initialState, baseRevision: 0 }),
  });
  assert(bootstrapResult.response.ok && bootstrapResult.payload.ok === true, "conditional state bootstrap failed");
  assert(bootstrapResult.payload.bootstrap === true && bootstrapResult.payload.concurrency === "conditional", "state bootstrap did not report conditional bootstrap semantics");
  assert(bootstrapResult.payload.revision === 1 && bootstrapResult.payload.state?.revision === 1, "state bootstrap did not create revision 1");
  assert(bootstrapResult.response.headers.get("etag") === '"state-1"', "state bootstrap did not return the revision 1 ETag");
  assert(bootstrapResult.response.headers.get("x-state-revision") === "1", "state bootstrap did not return X-State-Revision 1");
  const bootstrapStateEvent = await nextStateEvent(stateEventIterator);
  assert(bootstrapStateEvent.revision === 1, "state event stream did not broadcast the committed revision");

  const firstRead = await readState();
  assert(firstRead.payload.revision === 1 && firstRead.payload.state?.revision === 1, "state read did not return bootstrap revision 1");
  assert(firstRead.response.headers.get("etag") === '"state-1"', "state read did not return the current ETag");
  assert(firstRead.payload.state?.version === 4, "state read did not preserve state version 4");
  for (const key of COLLECTION_KEYS) {
    assert(firstRead.payload.state?.[key]?.length === 1, `state read did not return written ${key}`);
  }
  assert(firstRead.payload.state?.resources?.[0]?.blocks?.[0]?.id === "check-resource-block", "Resource block ID changed during PostgreSQL round trip");
  assert(firstRead.payload.state?.resources?.[0]?.createdAt === "2026-06-02T00:00:00.000Z", "Resource createdAt changed during PostgreSQL round trip");
  assert(firstRead.payload.state?.resources?.[0]?.updatedAt === "2026-06-02T00:00:00.000Z", "Resource updatedAt changed during PostgreSQL round trip");
  assert(firstRead.payload.state?.resources?.[0]?.revision === 1, "Resource revision changed during PostgreSQL round trip");
  assert(firstRead.payload.state?.resources?.[0]?.timestampSource === "native", "Resource timestamp source changed during PostgreSQL round trip");
  assert(firstRead.payload.state?.resources?.[0]?.pageSettings?.font === "serif", "Resource page settings changed during PostgreSQL round trip");
  assert(firstRead.payload.state?.resources?.[0]?.icon === "📚", "Resource icon changed during PostgreSQL round trip");
  assert(
    JSON.stringify(firstRead.payload.state?.resources?.[0]?.cover) === JSON.stringify({ url: "https://example.com/resource-cover.jpg", position: 37 }),
    "Resource cover changed during PostgreSQL round trip",
  );
  assert(firstRead.payload.state?.resources?.[0]?.readOnly === false, "Resource readOnly changed during PostgreSQL round trip");
  assert(firstRead.payload.state?.resources?.[0]?.locked === false, "Resource locked changed during PostgreSQL round trip");
  assert(firstRead.payload.state?.resources?.[0]?.commentThreads?.[0]?.replies?.[0]?.body === "PostgreSQL check reply", "Resource comment thread changed during PostgreSQL round trip");
  assert(firstRead.payload.state?.resources?.[0]?.commentThreads?.[1]?.anchor?.blockId === "check-resource-block", "Resource inline comment anchor changed during PostgreSQL round trip");
  assert(firstRead.payload.state?.settings?.viewControls?.resources?.searchScope === "database", "Resource searchScope changed during PostgreSQL round trip");
  assert(
    JSON.stringify(firstRead.payload.state?.settings?.openPagesIn) === JSON.stringify({ library: "full", list: "center", map: "side" }),
    "Resource openPagesIn changed during PostgreSQL round trip",
  );
  assert(firstRead.payload.state?.settings?.notionParityMode === false, "Resource notionParityMode changed during PostgreSQL round trip");
  assert(firstRead.payload.state?.settings?.advancedWindowMode === true, "Resource advancedWindowMode changed during PostgreSQL round trip");
  assert(firstRead.payload.state?.tasks?.[0]?.status === "scheduled", "legacy someday task status did not migrate to scheduled during PostgreSQL round trip");
  assert(firstRead.payload.state?.tasks?.[0]?.dueDate === "2026-06-02", "task due date changed during PostgreSQL round trip");
  assert(firstRead.payload.state?.habitInstances?.[0]?.date === "2026-06-02", "habit date changed during PostgreSQL round trip");

  await pool.query("UPDATE tasks SET status = 'someday' WHERE app_state_id = $1 AND id = 'check-task'", [appStateId]);
  const healedSomedayRead = await readState();
  assert(healedSomedayRead.payload.state?.tasks?.[0]?.status === "scheduled", "relational someday task did not read-heal to scheduled");
  assert(healedSomedayRead.payload.state?.tasks?.[0]?.dueDate === "2026-06-02", "relational someday read-heal changed the existing task date");
  const healedSomedayRow = await pool.query("SELECT status, due_date FROM tasks WHERE app_state_id = $1 AND id = 'check-task'", [appStateId]);
  assert(healedSomedayRow.rows[0]?.status === "scheduled", "relational someday read-heal was not persisted");
  const healedSomedayDueDate = healedSomedayRow.rows[0]?.due_date;
  const healedSomedayDateKey = typeof healedSomedayDueDate === "string"
    ? healedSomedayDueDate.slice(0, 10)
    : healedSomedayDueDate instanceof Date
      ? `${healedSomedayDueDate.getFullYear()}-${String(healedSomedayDueDate.getMonth() + 1).padStart(2, "0")}-${String(healedSomedayDueDate.getDate()).padStart(2, "0")}`
      : "";
  assert(healedSomedayDateKey === "2026-06-02", "relational someday read-heal did not preserve due_date");

  const missingPreconditionState = structuredClone(firstRead.payload.state);
  missingPreconditionState.updatedAt = "2026-06-02T00:01:00.000Z";
  missingPreconditionState.resources[0].title = "Missing precondition must not persist";
  const missingPreconditionResult = await requestJson("/api/state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state: missingPreconditionState }),
  });
  assert(missingPreconditionResult.response.status === 428, "state update without a revision precondition did not return 428");
  assert(missingPreconditionResult.payload.code === "STATE_PRECONDITION_REQUIRED" && missingPreconditionResult.payload.revision === 1, "missing-precondition response did not expose the current revision");
  await assertStoredRevisionAndTitle(1, "PostgreSQL check resource", "missing-precondition rejection mutated state");

  const staleState = structuredClone(firstRead.payload.state);
  staleState.updatedAt = "2026-06-02T00:02:00.000Z";
  staleState.resources[0].title = "Stale write must not persist";
  const staleResult = await requestJson("/api/state", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "If-Match": '"state-0"',
    },
    body: JSON.stringify({ state: staleState, baseRevision: 0 }),
  });
  assert(staleResult.response.status === 409, "stale state update did not return 409");
  assert(staleResult.payload.code === "STATE_REVISION_CONFLICT" && staleResult.payload.revision === 1, "stale-write response did not expose the current revision");
  assert(staleResult.response.headers.get("etag") === '"state-1"', "stale-write response did not return the current ETag");
  await assertStoredRevisionAndTitle(1, "PostgreSQL check resource", "stale write mutated state");

  const secondState = structuredClone(firstRead.payload.state);
  secondState.updatedAt = "2026-06-02T00:03:00.000Z";
  secondState.resources[0].title = "PostgreSQL updated resource";
  secondState.resources[0].updatedAt = "2026-06-02T00:03:00.000Z";
  secondState.resources[0].revision = 2;
  secondState.resources[0].timestampSource = "server";
  const secondWrite = await requestJson("/api/state", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "If-Match": '"state-1"',
    },
    body: JSON.stringify({ state: secondState, baseRevision: 1 }),
  });
  assert(secondWrite.response.ok && secondWrite.payload.ok === true, "conditional state update failed");
  assert(secondWrite.payload.revision === 2 && secondWrite.payload.state?.revision === 2, "conditional update did not advance the workspace revision monotonically");
  assert(secondWrite.payload.state?.resources?.[0]?.revision === 2, "conditional update did not preserve the Resource revision");
  assert(secondWrite.response.headers.get("etag") === '"state-2"', "conditional update did not return the revision 2 ETag");
  assert(secondWrite.response.headers.get("x-state-concurrency") === "conditional", "conditional update did not report its concurrency mode");

  const committedRead = await readState();
  assert(committedRead.payload.revision === 2 && committedRead.payload.state?.revision === 2, "committed state did not remain at revision 2");
  assert(committedRead.payload.state?.resources?.[0]?.title === "PostgreSQL updated resource", "committed Resource title was not readable");
  assert(committedRead.payload.state?.resources?.[0]?.timestampSource === "server", "committed Resource timestamp source was not readable");
  await assertResourcePermanentDeleteRejectedDoesNotMutate();
  await assertInvalidWriteDoesNotMutate(
    "duplicate ID",
    (draft) => {
      draft.captures[0].id = draft.resources[0].id;
    },
    "duplicate_id"
  );
  await assertInvalidWriteDoesNotMutate(
    "broken relation",
    (draft) => {
      draft.tasks[0].projectId = "missing-project";
    },
    "broken_relation"
  );
  await assertInvalidWriteDoesNotMutate(
    "unsafe URL",
    (draft) => {
      draft.resources[0].url = "javascript:alert(1)";
    },
    "unsafe_url_protocol"
  );
  await assertInvalidWriteDoesNotMutate(
    "missing Resource title",
    (draft) => {
      delete draft.resources[0].title;
    },
    "invalid_resource_title"
  );
  await assertInvalidWriteDoesNotMutate(
    "empty Resource type",
    (draft) => {
      draft.resources[0].type = "";
    },
    "invalid_resource_type"
  );
  await assertInvalidWriteDoesNotMutate(
    "non-string Resource importance",
    (draft) => {
      draft.resources[0].importance = false;
    },
    "invalid_resource_importance"
  );
  await assertInvalidWriteDoesNotMutate(
    "missing Resource pinned",
    (draft) => {
      delete draft.resources[0].pinned;
    },
    "invalid_resource_pinned"
  );
  await assertInvalidWriteDoesNotMutate(
    "non-boolean Resource readLater",
    (draft) => {
      draft.resources[0].readLater = 0;
    },
    "invalid_resource_read_later"
  );
  await assertInvalidWriteDoesNotMutate(
    "invalid Resource createdAt",
    (draft) => {
      draft.resources[0].createdAt = "not-a-date";
    },
    "invalid_resource_created_at"
  );
  await assertInvalidWriteDoesNotMutate(
    "missing Resource updatedAt",
    (draft) => {
      delete draft.resources[0].updatedAt;
    },
    "invalid_resource_updated_at"
  );
  await assertInvalidWriteDoesNotMutate(
    "reversed Resource timestamps",
    (draft) => {
      draft.resources[0].createdAt = "2026-06-03T00:00:00.000Z";
      draft.resources[0].updatedAt = "2026-06-02T00:00:00.000Z";
    },
    "invalid_resource_timestamp_order"
  );
  await assertInvalidWriteDoesNotMutate(
    "invalid Resource revision",
    (draft) => {
      draft.resources[0].revision = 0;
    },
    "invalid_resource_revision"
  );
  await assertInvalidWriteDoesNotMutate(
    "invalid Resource timestampSource",
    (draft) => {
      draft.resources[0].timestampSource = "native source";
    },
    "invalid_resource_timestamp_source"
  );
  for (const unsafeInlineUrl of [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
  ]) {
    await assertInvalidWriteDoesNotMutate(
      `unsafe inline URL ${unsafeInlineUrl.split(":", 1)[0]}`,
      (draft) => {
        draft.resources[0].blocks[0].text = "unsafe";
        draft.resources[0].blocks[0].marks = [{ type: "link", start: 0, end: 6, href: unsafeInlineUrl }];
      },
      "unsafe_url_protocol"
    );
  }
  for (const unsafeBlockUrl of [
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "http://example.com/not-https",
    "https://user:password@example.com/private",
  ]) {
    await assertInvalidWriteDoesNotMutate(
      `unsafe bookmark URL ${unsafeBlockUrl.split(":", 1)[0]}`,
      (draft) => {
        draft.resources[0].blocks[0].type = "bookmark";
        draft.resources[0].blocks[0].text = unsafeBlockUrl;
        draft.resources[0].blocks[0].url = unsafeBlockUrl;
        draft.resources[0].blocks[0].marks = [];
      },
      "unsafe_block_url"
    );
  }
  await assertInvalidWriteDoesNotMutate(
    "mismatched embed URL text",
    (draft) => {
      draft.resources[0].blocks[0].type = "embed";
      draft.resources[0].blocks[0].text = "https://example.com/other";
      draft.resources[0].blocks[0].url = "https://example.com/embed";
      draft.resources[0].blocks[0].marks = [];
    },
    "invalid_url_block_text"
  );
  await assertInvalidWriteDoesNotMutate(
    "invalid Resource block",
    (draft) => {
      draft.resources[0].blocks[0].type = "unsupported-embed";
    },
    "unsupported_block_type"
  );
  await assertInvalidWriteDoesNotMutate(
    "duplicate comment reply ID",
    (draft) => {
      draft.resources[0].commentThreads[0].replies[0].id = draft.resources[0].commentThreads[0].id;
    },
    "duplicate_id"
  );
  await assertInvalidWriteDoesNotMutate(
    "broken inline comment anchor",
    (draft) => {
      draft.resources[0].commentThreads[1].anchor.blockId = "missing-resource-block";
    },
    "broken_comment_anchor"
  );
  await assertInvalidWriteDoesNotMutate(
    "orphan inline comment mark",
    (draft) => {
      draft.resources[0].blocks[0].marks.find((mark) => mark.type === "comment").commentId = "missing-comment-thread";
    },
    "orphan_comment_mark"
  );
  await assertInvalidWriteDoesNotMutate(
    "missing inline comment mark",
    (draft) => {
      draft.resources[0].blocks[0].marks = draft.resources[0].blocks[0].marks.filter((mark) => mark.type !== "comment");
    },
    "missing_comment_mark"
  );
  await assertInvalidWriteDoesNotMutate(
    "mismatched inline comment anchor",
    (draft) => {
      const mark = draft.resources[0].blocks[0].marks.find((entry) => entry.type === "comment");
      mark.start = 1;
    },
    "comment_anchor_mismatch"
  );
  await assertInvalidWriteDoesNotMutate(
    "duplicate inline comment mark",
    (draft) => {
      const mark = draft.resources[0].blocks[0].marks.find((entry) => entry.type === "comment");
      draft.resources[0].blocks[0].marks.push(structuredClone(mark));
    },
    "duplicate_comment_mark"
  );
  await assertInvalidWriteDoesNotMutate(
    "mismatched inline comment body",
    (draft) => {
      draft.resources[0].blocks[0].marks.find((mark) => mark.type === "comment").body = "Different inline discussion";
    },
    "comment_body_mismatch"
  );
  await assertInvalidWriteDoesNotMutate(
    "deleted inline comment retaining a mark",
    (draft) => {
      draft.resources[0].commentThreads[1].deletedAt = "2026-06-02T00:01:00.000Z";
    },
    "deleted_comment_mark"
  );
  await assertInvalidWriteDoesNotMutate(
    "lost page comment retaining a mark",
    (draft) => {
      const thread = draft.resources[0].commentThreads[1];
      thread.scope = "page";
      thread.formerAnchor = structuredClone(thread.anchor);
      thread.anchor = null;
      thread.anchorLostAt = "2026-06-02T00:01:00.000Z";
    },
    "non_inline_comment_mark"
  );
  await assertInvalidWriteDoesNotMutate(
    "overlong comment body",
    (draft) => {
      draft.resources[0].commentThreads[0].body = "x".repeat(20_001);
    },
    "comment_body_too_long"
  );
  await assertInvalidWriteDoesNotMutate(
    "too many comment replies",
    (draft) => {
      const createdAt = "2026-06-02T00:00:00.000Z";
      draft.resources[0].commentThreads[0].replies = Array.from({ length: 501 }, (_, index) => ({
        id: `check-overflow-reply-${index}`,
        body: `Overflow reply ${index}`,
        createdAt,
      }));
    },
    "too_many_comment_replies"
  );
  await assertInvalidWriteDoesNotMutate(
    "invalid Resource page font",
    (draft) => {
      draft.resources[0].pageSettings.font = "script";
    },
    "invalid_page_font"
  );
  await assertInvalidWriteDoesNotMutate(
    "non-string Resource icon",
    (draft) => {
      draft.resources[0].icon = { emoji: "📚" };
    },
    "invalid_resource_icon"
  );
  await assertInvalidWriteDoesNotMutate(
    "overlong Resource icon",
    (draft) => {
      draft.resources[0].icon = "x".repeat(17);
    },
    "invalid_resource_icon"
  );
  await assertInvalidWriteDoesNotMutate(
    "Resource icon with angle brackets",
    (draft) => {
      draft.resources[0].icon = "<svg>";
    },
    "invalid_resource_icon"
  );
  await assertInvalidWriteDoesNotMutate(
    "non-object Resource cover",
    (draft) => {
      draft.resources[0].cover = "https://example.com/resource-cover.jpg";
    },
    "invalid_resource_cover"
  );
  await assertInvalidWriteDoesNotMutate(
    "Resource cover missing URL",
    (draft) => {
      draft.resources[0].cover = { position: 50 };
    },
    "missing_resource_cover_url"
  );
  await assertInvalidWriteDoesNotMutate(
    "Resource cover missing position",
    (draft) => {
      draft.resources[0].cover = { url: "" };
    },
    "missing_resource_cover_position"
  );
  await assertInvalidWriteDoesNotMutate(
    "non-HTTPS Resource cover",
    (draft) => {
      draft.resources[0].cover.url = "http://example.com/resource-cover.jpg";
    },
    "invalid_resource_cover_url"
  );
  await assertInvalidWriteDoesNotMutate(
    "fractional Resource cover position",
    (draft) => {
      draft.resources[0].cover.position = 50.5;
    },
    "invalid_resource_cover_position"
  );
  await assertInvalidWriteDoesNotMutate(
    "out-of-range Resource cover position",
    (draft) => {
      draft.resources[0].cover.position = 101;
    },
    "invalid_resource_cover_position"
  );
  await assertInvalidWriteDoesNotMutate(
    "non-boolean Resource readOnly",
    (draft) => {
      draft.resources[0].readOnly = "false";
    },
    "invalid_resource_read_only"
  );
  await assertInvalidWriteDoesNotMutate(
    "non-boolean Resource locked",
    (draft) => {
      draft.resources[0].locked = "false";
    },
    "invalid_resource_locked"
  );
  await assertInvalidWriteDoesNotMutate(
    "Resource self parent",
    (draft) => {
      draft.resources[0].parentId = draft.resources[0].id;
    },
    "resource_self_parent"
  );
  await assertInvalidWriteDoesNotMutate(
    "Resource parent cycle",
    (draft) => {
      const child = structuredClone(draft.resources[0]);
      child.id = "check-resource-child";
      child.parentId = draft.resources[0].id;
      child.childOrder = [draft.resources[0].id];
      child.blocks = [{ id: "check-resource-child-block", type: "paragraph", text: "Child block", indent: 0, marks: [] }];
      child.commentThreads = [];
      draft.resources[0].parentId = child.id;
      draft.resources[0].childOrder = [child.id];
      draft.resources.push(child);
    },
    "resource_parent_cycle"
  );

  const row = await pool.query(
    "SELECT revision, state->>'version' AS version, state->>'revision' AS state_revision, jsonb_array_length(state->'captures') AS capture_count, jsonb_array_length(state->'boxes') AS box_count, jsonb_array_length(state->'goals') AS goal_count, jsonb_array_length(state->'projects') AS project_count, jsonb_array_length(state->'tasks') AS task_count, jsonb_array_length(state->'resources') AS resource_count, jsonb_array_length(state->'habits') AS habit_count, jsonb_array_length(state->'habitInstances') AS habit_instance_count, jsonb_array_length(state->'journals') AS journal_count, jsonb_array_length(state->'googleCalendars') AS google_calendar_count, jsonb_array_length(state->'googleEvents') AS google_event_count, jsonb_array_length(state->'links') AS link_count FROM app_state WHERE id = $1",
    [appStateId]
  );
  assert(Number(row.rows[0]?.revision) === 2 && row.rows[0]?.state_revision === "2", "app_state row did not store workspace revision 2 consistently");
  assert(row.rows[0]?.version === "4", "app_state row did not contain state version 4");
  for (const field of ["capture_count", "box_count", "goal_count", "project_count", "task_count", "resource_count", "habit_count", "habit_instance_count", "journal_count", "google_calendar_count", "google_event_count", "link_count"]) {
    assert(Number(row.rows[0]?.[field]) === 1, `app_state row did not preserve ${field}`);
  }

  const relationalCounts = await pool.query(
    `
      SELECT
        (SELECT count(*)::int FROM boxes WHERE app_state_id = $1) AS boxes,
        (SELECT count(*)::int FROM goals WHERE app_state_id = $1) AS goals,
        (SELECT count(*)::int FROM projects WHERE app_state_id = $1) AS projects,
        (SELECT count(*)::int FROM tasks WHERE app_state_id = $1) AS tasks,
        (SELECT count(*)::int FROM resources WHERE app_state_id = $1) AS resources,
        (SELECT count(*)::int FROM task_resources WHERE app_state_id = $1) AS task_resources,
        (SELECT count(*)::int FROM habits WHERE app_state_id = $1) AS habits,
        (SELECT count(*)::int FROM habit_instances WHERE app_state_id = $1) AS habit_instances,
        (SELECT count(*)::int FROM captures WHERE app_state_id = $1) AS captures,
        (SELECT count(*)::int FROM journals WHERE app_state_id = $1) AS journals,
        (SELECT count(*)::int FROM google_calendars WHERE app_state_id = $1) AS google_calendars,
        (SELECT count(*)::int FROM google_events WHERE app_state_id = $1) AS google_events,
        (SELECT count(*)::int FROM collection_links WHERE app_state_id = $1) AS collection_links
    `,
    [appStateId]
  );
  const relationalCountRow = relationalCounts.rows[0] || {};
  for (const tableName of ["boxes", "goals", "projects", "tasks", "resources", "task_resources", "habits", "habit_instances", "captures", "journals", "google_calendars", "google_events", "collection_links"]) {
    assert(Number(relationalCountRow[tableName]) === 1, `relational table ${tableName} did not contain the written row`);
  }

  const relationalRefs = await pool.query(
    `
      SELECT
        (SELECT box_id FROM tasks WHERE app_state_id = $1 AND id = 'check-task') AS task_box_id,
        (SELECT goal_id FROM tasks WHERE app_state_id = $1 AND id = 'check-task') AS task_goal_id,
        (SELECT project_id FROM tasks WHERE app_state_id = $1 AND id = 'check-task') AS task_project_id,
        (SELECT box_id FROM resources WHERE app_state_id = $1 AND id = 'check-resource') AS resource_box_id,
        (SELECT goal_id FROM resources WHERE app_state_id = $1 AND id = 'check-resource') AS resource_goal_id,
        (SELECT project_id FROM resources WHERE app_state_id = $1 AND id = 'check-resource') AS resource_project_id,
        (SELECT task_id FROM task_resources WHERE app_state_id = $1 AND task_id = 'check-task' AND resource_id = 'check-resource') AS task_resource_task_id,
        (SELECT resource_id FROM task_resources WHERE app_state_id = $1 AND task_id = 'check-task' AND resource_id = 'check-resource') AS task_resource_resource_id,
        (SELECT project_id FROM habits WHERE app_state_id = $1 AND id = 'check-habit') AS habit_project_id,
        (SELECT habit_id FROM habit_instances WHERE app_state_id = $1 AND id = 'check-habit-instance') AS habit_instance_habit_id,
        (SELECT calendar_id FROM google_events WHERE app_state_id = $1 AND id = 'check-google-event') AS google_event_calendar_id
    `,
    [appStateId]
  );
  const refRow = relationalRefs.rows[0] || {};
  assert(refRow.task_box_id === "check-box" && refRow.task_goal_id === "check-goal" && refRow.task_project_id === "check-project", "relational tasks did not preserve box/goal/project references");
  assert(refRow.resource_box_id === "check-box" && refRow.resource_goal_id === "check-goal" && refRow.resource_project_id === "check-project", "relational resources did not preserve box/goal/project references");
  assert(refRow.task_resource_task_id === "check-task" && refRow.task_resource_resource_id === "check-resource", "task-resource relation was not stored as a separate relationship");
  assert(refRow.habit_project_id === "check-project" && refRow.habit_instance_habit_id === "check-habit", "habit relational references were not stored");
  assert(refRow.google_event_calendar_id === "check-google-calendar", "Google event relational calendar reference was not stored");

  await pool.query("UPDATE tasks SET title = 'Relational table task title', status = 'done' WHERE app_state_id = $1 AND id = 'check-task'", [appStateId]);
  await pool.query("UPDATE resources SET title = 'Relational table resource title', pinned = false WHERE app_state_id = $1 AND id = 'check-resource'", [appStateId]);
  const relationalRead = await readState();
  assert(relationalRead.payload.state?.tasks?.[0]?.title === "Relational table task title", "state read did not use the relational tasks table as source of truth");
  assert(relationalRead.payload.state?.tasks?.[0]?.status === "done", "state read did not use relational task status");
  assert(relationalRead.payload.state?.tasks?.[0]?.resourceId === "check-resource", "state read did not reconstruct task-resource peer relation");
  assert(relationalRead.payload.state?.resources?.[0]?.title === "Relational table resource title", "state read did not use the relational resources table as source of truth");
  assert(relationalRead.payload.state?.resources?.[0]?.pinned === false, "state read did not use relational resource boolean columns");
  assert(relationalRead.payload.revision === 2 && relationalRead.payload.state?.revision === 2, "relational reads changed the workspace revision");

  await pool.query("UPDATE app_state SET state = jsonb_set(state, '{tasks,0,title}', to_jsonb('JSONB stale task title'::text), true) WHERE id = $1", [appStateId]);
  const staleJsonRead = await readState();
  assert(staleJsonRead.payload.state?.tasks?.[0]?.title === "Relational table task title", "stale JSONB app_state overrode the relational task table");

  const pollutedState = {
    version: "not-a-version",
    revision: "not-a-revision",
    createdAt: "not-a-date",
    updatedAt: "not-a-date",
    settings: {
      navOrder: ["unknown-view", "calendar", "today", "calendar"],
      appMode: "legacy-local",
      calendarSources: { tasks: "polluted-tasks", projects: false, google: true },
      visibleGoogleCalendars: { primary: "polluted-primary", work: false },
      viewControls: { resources: { mode: "list", filters: ["active", "pinned"], panels: { sort: true }, toggles: { readLater: true }, type: "article" }, today: "polluted-control" },
    },
    tasks: [null, { id: "polluted-task", kind: "legacy-task-kind" }],
    journals: [{ id: "polluted-journal", kind: "legacy-journal-kind" }, "polluted-journal"],
  };
  await deleteRelationalRows(appStateId);
  await pool.query("UPDATE app_state SET state = $2::jsonb WHERE id = $1", [appStateId, JSON.stringify(pollutedState)]);
  const healedRead = await readState();
  assert(healedRead.payload.state?.version === 4, "state read did not heal an invalid stored version to v4");
  assert(healedRead.payload.revision === 2 && healedRead.payload.state?.revision === 2, "state read did not reconcile the healed state to the stored revision");
  assert(healedRead.response.headers.get("etag") === '"state-2"', "healed state read did not retain the current ETag");
  assert(healedRead.payload.state?.tasks?.length === 1 && !("kind" in healedRead.payload.state.tasks[0]), "state read did not normalize polluted stored tasks");
  assert(healedRead.payload.state?.journals?.length === 1 && !("kind" in healedRead.payload.state.journals[0]), "state read did not normalize polluted stored journals");
  assert(healedRead.payload.state?.settings?.navOrder?.join(",") === "calendar,today,inbox,tasks,projects,goals,boxes,resources,habits,journal,database", "state read did not normalize polluted stored navOrder entries");
  assert(healedRead.payload.state?.settings?.calendarSources?.tasks === true && healedRead.payload.state.settings.calendarSources.projects === false, "state read did not normalize polluted calendar sources");
  assert(!("primary" in healedRead.payload.state?.settings?.visibleGoogleCalendars) && healedRead.payload.state.settings.visibleGoogleCalendars.work === false, "state read did not normalize polluted visible Google calendars");
  assert(healedRead.payload.state?.settings?.viewControls?.resources?.mode === "list" && healedRead.payload.state.settings.viewControls.resources.filters.join(",") === "active,pinned" && healedRead.payload.state.settings.viewControls.resources.panels.sort === true && !("type" in healedRead.payload.state.settings.viewControls.resources) && !("toggles" in healedRead.payload.state.settings.viewControls.resources), "state read did not normalize polluted view controls");
  assert(!("appMode" in (healedRead.payload.state?.settings || {})), "state read returned deprecated settings from polluted storage");

  const healedRow = await pool.query(
    "SELECT revision, state->>'version' AS version, state->>'revision' AS state_revision, jsonb_typeof(state->'tasks') AS tasks_type, jsonb_array_length(state->'tasks') AS task_count, jsonb_array_length(state->'journals') AS journal_count, state->'tasks'->0 ? 'kind' AS task_has_kind, state->'journals'->0 ? 'kind' AS journal_has_kind, array_to_string(ARRAY(SELECT jsonb_array_elements_text(state->'settings'->'navOrder')), ',') AS nav_order, state->'settings'->'calendarSources' AS calendar_sources, state->'settings'->'visibleGoogleCalendars' AS visible_google_calendars, state->'settings' ? 'appMode' AS has_app_mode FROM app_state WHERE id = $1",
    [appStateId]
  );
  assert(Number(healedRow.rows[0]?.revision) === 2 && healedRow.rows[0]?.state_revision === "2", "state read did not preserve the revision while healing PostgreSQL");
  assert(healedRow.rows[0]?.version === "4", "state read did not heal invalid stored version to v4 in PostgreSQL");
  assert(healedRow.rows[0]?.tasks_type === "array" && healedRow.rows[0]?.nav_order === "calendar,today,inbox,tasks,projects,goals,boxes,resources,habits,journal,database", "state read did not heal polluted PostgreSQL collections/settings");
  assert(healedRow.rows[0]?.calendar_sources?.tasks === true && healedRow.rows[0]?.calendar_sources?.projects === false, "state read did not heal polluted calendar sources in PostgreSQL");
  assert(!("primary" in healedRow.rows[0]?.visible_google_calendars) && healedRow.rows[0]?.visible_google_calendars?.work === false, "state read did not heal polluted visible Google calendars in PostgreSQL");
  assert(Number(healedRow.rows[0]?.task_count) === 1 && Number(healedRow.rows[0]?.journal_count) === 1, "state read did not remove polluted collection items from PostgreSQL");
  assert(healedRow.rows[0]?.task_has_kind === false && healedRow.rows[0]?.journal_has_kind === false, "state read did not remove legacy kind fields from PostgreSQL");
  assert(healedRow.rows[0]?.has_app_mode === false, "state read did not remove deprecated settings from PostgreSQL");
  const healedRelationalRows = await pool.query("SELECT count(*)::int AS tasks FROM tasks WHERE app_state_id = $1", [appStateId]);
  assert(Number(healedRelationalRows.rows[0]?.tasks) === 1, "state read did not sync healed PostgreSQL state into relational tables");

  await deleteRelationalRows(appStateId);
  await pool.query("UPDATE app_state SET state = $2::jsonb WHERE id = $1", [appStateId, JSON.stringify("polluted-scalar-state")]);
  const scalarHealedRead = await readState();
  assert(scalarHealedRead.payload.state?.version === 4, "state read did not normalize a scalar PostgreSQL state to v4");
  assert(scalarHealedRead.payload.revision === 2 && scalarHealedRead.payload.state?.revision === 2, "scalar state healing did not reconcile the stored revision");
  assert(Array.isArray(scalarHealedRead.payload.state?.tasks), "state read did not create collections for scalar PostgreSQL state");
  const scalarHealedRow = await pool.query(
    "SELECT revision, state->>'revision' AS state_revision, jsonb_typeof(state) AS state_type, jsonb_typeof(state->'settings') AS settings_type, jsonb_typeof(state->'tasks') AS tasks_type FROM app_state WHERE id = $1",
    [appStateId]
  );
  assert(Number(scalarHealedRow.rows[0]?.revision) === 2 && scalarHealedRow.rows[0]?.state_revision === "2", "scalar state healing changed or lost the stored revision");
  assert(scalarHealedRow.rows[0]?.state_type === "object", "state read did not heal scalar PostgreSQL state into an object");
  assert(scalarHealedRow.rows[0]?.settings_type === "object" && scalarHealedRow.rows[0]?.tasks_type === "array", "state read did not heal scalar PostgreSQL defaults");
  const scalarRelationalRows = await pool.query("SELECT count(*)::int AS tasks FROM tasks WHERE app_state_id = $1", [appStateId]);
  assert(Number(scalarRelationalRows.rows[0]?.tasks) === 0, "scalar state healing did not clear stale relational task rows");

  const tables = await pool.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('app_state', 'app_private_data', 'boxes', 'goals', 'projects', 'tasks', 'resources', 'task_resources', 'habits', 'habit_instances', 'captures', 'journals', 'google_calendars', 'google_events', 'collection_links') ORDER BY tablename"
  );
  const createdTables = tables.rows.map((tableRow) => tableRow.tablename).join(",");
  assert(
    createdTables === "app_private_data,app_state,boxes,captures,collection_links,goals,google_calendars,google_events,habit_instances,habits,journals,projects,resources,task_resources,tasks",
    "required PostgreSQL tables were not created"
  );

  tokenStorage = createStorage({ databaseUrl, appStateId: tokenStateId });
  await tokenStorage.ready();
  const token = {
    access_token: "check-access-token",
    refresh_token: "check-refresh-token",
    created_at: "2026-06-02T00:00:00.000Z",
    updated_at: "2026-06-02T00:00:00.000Z",
  };
  await tokenStorage.writeToken(token);
  const storedToken = await tokenStorage.readToken();
  assert(storedToken?.refresh_token === token.refresh_token, "Google token was not readable from PostgreSQL storage");
  const tokenRow = await pool.query(
    "SELECT data->>'refresh_token' AS refresh_token FROM app_private_data WHERE id = $1 AND key = 'google_token'",
    [tokenStateId]
  );
  assert(tokenRow.rows[0]?.refresh_token === token.refresh_token, "app_private_data row did not contain the written Google token");
  await tokenStorage.deleteToken();

  legacyTokenStorage = createStorage({ databaseUrl, appStateId: legacyTokenStateId, googleTokenFile: legacyTokenFile });
  await legacyTokenStorage.ready();
  const legacyToken = {
    access_token: "legacy-access-token",
    refresh_token: "legacy-refresh-token",
    created_at: "2026-06-02T00:00:00.000Z",
    updated_at: "2026-06-02T00:00:00.000Z",
  };
  await writeFile(legacyTokenFile, JSON.stringify(legacyToken), { mode: 0o600 });
  const migratedToken = await legacyTokenStorage.readToken();
  assert(migratedToken?.refresh_token === legacyToken.refresh_token, "legacy Google token file was not migrated into PostgreSQL");
  const legacyTokenRow = await pool.query(
    "SELECT data->>'refresh_token' AS refresh_token FROM app_private_data WHERE id = $1 AND key = 'google_token'",
    [legacyTokenStateId]
  );
  assert(legacyTokenRow.rows[0]?.refresh_token === legacyToken.refresh_token, "migrated legacy Google token was not stored in app_private_data");
  assert((await fileExists(legacyTokenFile)) === false, "legacy Google token file was not removed after migration");

  await checkIncrementalResourceApi();
  await checkOperatorStateResetBypass();

  console.log(`PostgreSQL state check passed for isolated APP_STATE_ID=${appStateId}.`);
} catch (error) {
  console.error(error.message || error);
  process.exitCode = 1;
} finally {
  stateEventAbort?.abort();
  await stateEventIterator?.return?.().catch(() => {});
  try {
    await cleanupCheckRows();
    await assertCleanupComplete();
  } catch (error) {
    console.error(error.message || "PostgreSQL check cleanup failed.");
    process.exitCode = 1;
  }
  await pool.end().catch(() => {});
  await tokenStorage?.end().catch(() => {});
  await legacyTokenStorage?.end().catch(() => {});
  await operatorResetStorage?.end().catch(() => {});
  await rm(legacyTokenFile, { force: true }).catch(() => {});
  if (resourceServerProcess && !resourceServerProcess.killed) {
    resourceServerProcess.kill("SIGTERM");
    await once(resourceServerProcess, "exit").catch(() => {});
  }
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill("SIGTERM");
    await once(serverProcess, "exit").catch(() => {});
  }
}

function makeValidState() {
  const createdAt = "2026-06-02T00:00:00.000Z";
  return {
    version: 4,
    revision: 0,
    createdAt,
    updatedAt: createdAt,
    settings: {
      navOrder: ["database", "today"],
      notionParityMode: false,
      advancedWindowMode: true,
      openPagesIn: { library: "full", list: "center", map: "side" },
      viewControls: {
        resources: { search: "", searchScope: "database", filters: ["active"], sort: "updated", mode: "library", panels: { filter: false, sort: false } },
      },
    },
    captures: [{ id: "check-capture", title: "PostgreSQL check capture", url: "https://example.com/capture", convertedTo: "resources", convertedId: "check-resource", createdAt }],
    boxes: [{ id: "check-box", name: "PostgreSQL check box" }],
    goals: [{ id: "check-goal", name: "PostgreSQL check goal", boxId: "check-box" }],
    projects: [{ id: "check-project", name: "PostgreSQL check project", goalId: "check-goal", boxId: "check-box" }],
    tasks: [{ id: "check-task", title: "PostgreSQL check task", status: "someday", boxId: "check-box", goalId: "check-goal", projectId: "check-project", resourceId: "check-resource", dueDate: "2026-06-02" }],
    resources: [{
      id: "check-resource",
      title: "PostgreSQL check resource",
      type: "article",
      importance: "important",
      boxId: "check-box",
      goalId: "check-goal",
      projectId: "check-project",
      url: "https://example.com/resource",
      pinned: true,
      readLater: false,
      createdAt,
      updatedAt: createdAt,
      revision: 1,
      timestampSource: "native",
      parentId: "",
      childOrder: [],
      pageSettings: { font: "serif", smallText: true, fullWidth: false },
      icon: "📚",
      cover: { url: "https://example.com/resource-cover.jpg", position: 37 },
      readOnly: false,
      locked: false,
      trashedAt: "",
      commentThreads: [
        {
          id: "check-resource-page-thread",
          scope: "page",
          anchor: null,
          body: "PostgreSQL check page discussion",
          createdAt,
          updatedAt: createdAt,
          resolvedAt: "",
          deletedAt: "",
          replies: [{
            id: "check-resource-page-reply",
            body: "PostgreSQL check reply",
            createdAt,
            updatedAt: createdAt,
            deletedAt: "",
          }],
        },
        {
          id: "check-resource-inline-thread",
          scope: "inline",
          anchor: { blockId: "check-resource-block", start: 0, end: 10 },
          body: "PostgreSQL inline discussion",
          createdAt,
          updatedAt: createdAt,
          resolvedAt: "",
          deletedAt: "",
          replies: [],
        },
      ],
      blocks: [{
        id: "check-resource-block",
        type: "paragraph",
        text: "PostgreSQL Resource block",
        indent: 0,
        marks: [
          { type: "bold", start: 0, end: 10 },
          {
            type: "comment",
            start: 0,
            end: 10,
            commentId: "check-resource-inline-thread",
            body: "PostgreSQL inline discussion",
          },
        ],
      }],
    }],
    habits: [{ id: "check-habit", title: "PostgreSQL check habit", projectId: "check-project" }],
    habitInstances: [{ id: "check-habit-instance", habitId: "check-habit", date: "2026-06-02", completed: true }],
    journals: [{ id: "check-journal", title: "PostgreSQL check journal" }],
    googleCalendars: [{ id: "check-google-calendar", summary: "PostgreSQL check Google calendar" }],
    googleEvents: [{ id: "check-google-event", calendarId: "check-google-calendar", title: "PostgreSQL check Google event", htmlLink: "https://calendar.google.com/calendar/event?eid=check" }],
    links: [{ id: "check-link", fromType: "tasks", fromId: "check-task", toType: "resources", toId: "check-resource", relation: "related" }],
  };
}

function makeIncrementalResource(id, title) {
  const createdAt = "2026-06-02T00:00:00.000Z";
  return {
    id,
    title,
    type: "article",
    importance: "normal",
    boxId: "check-box",
    goalId: "check-goal",
    projectId: "check-project",
    url: `https://example.com/resources/${encodeURIComponent(id)}`,
    pinned: false,
    readLater: false,
    createdAt,
    updatedAt: createdAt,
    revision: 1,
    timestampSource: "native",
    parentId: "",
    childOrder: [],
    pageSettings: { font: "default", smallText: false, fullWidth: false },
    icon: "",
    cover: { url: "", position: 50 },
    readOnly: false,
    locked: false,
    trashedAt: "",
    commentThreads: [],
    blocks: [{ id: `${id}-block`, type: "paragraph", text: `${title} block`, indent: 0, marks: [] }],
  };
}

async function checkIncrementalResourceApi() {
  resourceServerProcess = spawn("node", ["server.js"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      PORT: String(resourcePort),
      HOST: "127.0.0.1",
      APP_STATE_ID: resourceAppStateId,
      STATIC_ROOT: ".",
      REQUIRE_STATE_PRECONDITION: "1",
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  resourceServerProcess.stderr.on("data", (chunk) => {
    resourceServerStderr += chunk;
  });
  await waitForServerHealth(resourceServerProcess, resourceBaseUrl, () => resourceServerStderr);

  const initialState = makeValidState();
  const peerResource = makeIncrementalResource("check-resource-peer", "Unrelated Resource baseline");
  const hierarchyOldParent = makeIncrementalResource("check-resource-hierarchy-old", "Hierarchy old parent");
  const hierarchyNewParent = makeIncrementalResource("check-resource-hierarchy-new", "Hierarchy new parent");
  const hierarchyMovedResource = makeIncrementalResource("check-resource-hierarchy-moved", "Hierarchy moved Resource");
  hierarchyOldParent.childOrder = [hierarchyMovedResource.id];
  hierarchyMovedResource.parentId = hierarchyOldParent.id;
  initialState.resources.push(peerResource, hierarchyOldParent, hierarchyNewParent, hierarchyMovedResource);
  const bootstrap = await requestJsonAt(resourceBaseUrl, "/api/state", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "If-Match": '"state-0"' },
    body: JSON.stringify({ state: initialState, baseRevision: 0 }),
  });
  assert(bootstrap.response.ok && bootstrap.payload.revision === 1, "incremental Resource check bootstrap failed");

  const beforeInvalidResourceWrite = await pool.query(
    "SELECT revision, state::text AS state_text FROM app_state WHERE id = $1",
    [resourceAppStateId]
  );
  const beforeInvalidResourceRows = await pool.query(
    "SELECT id, data::text AS data_text FROM resources WHERE app_state_id = $1 ORDER BY id",
    [resourceAppStateId]
  );
  const invalidRequiredResource = structuredClone(initialState.resources[0]);
  delete invalidRequiredResource.readLater;
  const invalidRequiredWrite = await requestJsonAt(resourceBaseUrl, "/api/resources/check-resource", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "If-Match": '"state-1"' },
    body: JSON.stringify({ resource: invalidRequiredResource, baseRevision: 1 }),
  });
  assert(
    invalidRequiredWrite.response.status === 422
      && invalidRequiredWrite.payload.code === "INVALID_STATE"
      && invalidRequiredWrite.payload.details?.issues?.some((issue) => issue.code === "invalid_resource_read_later"),
    "incremental Resource write missing a required field was not rejected"
  );
  const afterInvalidResourceWrite = await pool.query(
    "SELECT revision, state::text AS state_text FROM app_state WHERE id = $1",
    [resourceAppStateId]
  );
  const afterInvalidResourceRows = await pool.query(
    "SELECT id, data::text AS data_text FROM resources WHERE app_state_id = $1 ORDER BY id",
    [resourceAppStateId]
  );
  assert(
    Number(afterInvalidResourceWrite.rows[0]?.revision) === 1
      && afterInvalidResourceWrite.rows[0]?.state_text === beforeInvalidResourceWrite.rows[0]?.state_text
      && JSON.stringify(afterInvalidResourceRows.rows) === JSON.stringify(beforeInvalidResourceRows.rows),
    "rejected incremental Resource required-field write mutated JSONB state or relational Resource rows"
  );

  const missingPrecondition = await requestJsonAt(resourceBaseUrl, "/api/resources/check-resource", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resource: structuredClone(initialState.resources[0]) }),
  });
  assert(
    missingPrecondition.response.status === 428
      && missingPrecondition.payload.code === "STATE_PRECONDITION_REQUIRED"
      && missingPrecondition.payload.revision === 1,
    "incremental Resource write without a precondition did not return 428 with the current revision"
  );

  const peerUpdate = structuredClone(peerResource);
  peerUpdate.title = "Unrelated Resource committed first";
  peerUpdate.updatedAt = "2026-06-02T00:01:00.000Z";
  peerUpdate.revision = 2;
  const peerWrite = await requestJsonAt(resourceBaseUrl, "/api/resources/check-resource-peer", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resource: peerUpdate, baseRevision: 1 }),
  });
  assert(peerWrite.response.ok && peerWrite.payload.revision === 2, "baseRevision-only incremental Resource update failed");
  assert(peerWrite.payload.created === false && peerWrite.payload.resource?.title === peerUpdate.title, "incremental Resource update returned the wrong Resource");
  assert(peerWrite.payload.state === undefined && peerWrite.response.headers.get("etag") === '"state-2"', "incremental Resource response did not return compact conditional metadata");

  const primaryUpdate = structuredClone(initialState.resources[0]);
  primaryUpdate.title = "Primary Resource updated incrementally";
  primaryUpdate.updatedAt = "2026-06-02T00:02:00.000Z";
  primaryUpdate.revision = 2;
  const primaryWrite = await requestJsonAt(resourceBaseUrl, "/api/resources/check-resource", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "If-Match": '"state-2"' },
    body: JSON.stringify({ resource: primaryUpdate }),
  });
  assert(primaryWrite.response.ok && primaryWrite.payload.revision === 3, "If-Match-only incremental Resource update failed");

  const afterPrimary = await requestJsonAt(resourceBaseUrl, "/api/state");
  const afterPrimaryResources = new Map(afterPrimary.payload.state?.resources?.map((resource) => [resource.id, resource]));
  assert(afterPrimary.payload.revision === 3, "incremental Resource updates did not advance the workspace revision monotonically");
  assert(afterPrimaryResources.get("check-resource")?.title === primaryUpdate.title, "incremental Resource update did not persist the target Resource");
  assert(afterPrimaryResources.get("check-resource-peer")?.title === peerUpdate.title, "incremental Resource update clobbered an unrelated committed Resource");
  assert(afterPrimary.payload.state?.tasks?.[0]?.title === "PostgreSQL check task", "incremental Resource update clobbered an unrelated collection");

  const staleUpdate = structuredClone(primaryUpdate);
  staleUpdate.title = "Stale Resource update must not persist";
  const staleWrite = await requestJsonAt(resourceBaseUrl, "/api/resources/check-resource", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "If-Match": '"state-2"' },
    body: JSON.stringify({ resource: staleUpdate, baseRevision: 2 }),
  });
  assert(
    staleWrite.response.status === 409
      && staleWrite.payload.code === "STATE_REVISION_CONFLICT"
      && staleWrite.payload.revision === 3
      && staleWrite.response.headers.get("etag") === '"state-3"',
    "stale incremental Resource update did not return 409 with the current revision"
  );

  const invalidUpdate = structuredClone(primaryUpdate);
  invalidUpdate.blocks[0].id = peerResource.blocks[0].id;
  const invalidWrite = await requestJsonAt(resourceBaseUrl, "/api/resources/check-resource", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "If-Match": '"state-3"' },
    body: JSON.stringify({ resource: invalidUpdate, baseRevision: 3 }),
  });
  assert(invalidWrite.response.status === 422 && invalidWrite.payload.code === "INVALID_STATE", "invalid incremental Resource did not return INVALID_STATE/422");
  assert(
    invalidWrite.payload.details?.issues?.some((issue) => issue.code === "duplicate_id"),
    "incremental Resource validation did not detect a cross-Resource duplicate block ID"
  );

  const afterRejections = await requestJsonAt(resourceBaseUrl, "/api/state");
  const rejectedResources = new Map(afterRejections.payload.state?.resources?.map((resource) => [resource.id, resource]));
  assert(afterRejections.payload.revision === 3, "rejected incremental Resource write changed the workspace revision");
  assert(rejectedResources.get("check-resource")?.title === primaryUpdate.title, "rejected incremental Resource write mutated the target Resource");
  assert(rejectedResources.get("check-resource-peer")?.title === peerUpdate.title, "rejected incremental Resource write mutated an unrelated Resource");

  const createdResource = makeIncrementalResource("check-resource-created", "Created incrementally");
  delete createdResource.icon;
  delete createdResource.cover;
  delete createdResource.readOnly;
  delete createdResource.locked;
  const createWrite = await requestJsonAt(resourceBaseUrl, "/api/resources/check-resource-created", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "If-Match": '"state-3"' },
    body: JSON.stringify({ resource: createdResource, baseRevision: 3 }),
  });
  assert(
    createWrite.response.ok
      && createWrite.payload.created === true
      && createWrite.payload.revision === 4
      && createWrite.payload.resource?.id === createdResource.id,
    "backward-compatible incremental Resource create without media/readOnly/locked fields did not return the created Resource at revision 4"
  );

  const idMismatch = await requestJsonAt(resourceBaseUrl, "/api/resources/check-resource-created", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "If-Match": '"state-4"' },
    body: JSON.stringify({ resource: { ...createdResource, id: "check-resource-mismatched" }, baseRevision: 4 }),
  });
  assert(idMismatch.response.status === 400 && idMismatch.payload.code === "RESOURCE_ID_MISMATCH", "Resource path/body ID mismatch was not rejected");

  const softTrashedResource = structuredClone(createWrite.payload.resource);
  softTrashedResource.trashedAt = "2026-06-02T00:04:00.000Z";
  softTrashedResource.updatedAt = "2026-06-02T00:04:00.000Z";
  softTrashedResource.revision = Number(softTrashedResource.revision || 0) + 1;
  const softTrashWrite = await requestJsonAt(resourceBaseUrl, "/api/resources/check-resource-created", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "If-Match": '"state-4"' },
    body: JSON.stringify({ resource: softTrashedResource, baseRevision: 4 }),
  });
  assert(
    softTrashWrite.response.ok
      && softTrashWrite.payload.revision === 5
      && softTrashWrite.payload.resource?.trashedAt === softTrashedResource.trashedAt,
    "incremental Resource soft trash did not persist at revision 5"
  );

  const trashedRead = await requestJsonAt(resourceBaseUrl, "/api/state");
  const omissionState = structuredClone(trashedRead.payload.state);
  omissionState.resources = omissionState.resources.filter((resource) => resource.id !== softTrashedResource.id);
  const trashedOmission = await requestJsonAt(resourceBaseUrl, "/api/state", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "If-Match": '"state-5"' },
    body: JSON.stringify({ state: omissionState, baseRevision: 5 }),
  });
  assert(
    trashedOmission.response.status === 422
      && trashedOmission.payload.code === "RESOURCE_PERMANENT_DELETE_DISABLED"
      && trashedOmission.payload.revision === 5
      && trashedOmission.response.headers.get("etag") === '"state-5"',
    "full-state write was allowed to omit a soft-trashed Resource"
  );
  const afterTrashedOmission = await requestJsonAt(resourceBaseUrl, "/api/state");
  assert(
    afterTrashedOmission.payload.revision === 5
      && afterTrashedOmission.payload.state?.resources?.find((resource) => resource.id === softTrashedResource.id)?.trashedAt === softTrashedResource.trashedAt,
    "rejected soft-trashed Resource omission changed revision or stored Resource state"
  );

  const restoredResource = structuredClone(softTrashWrite.payload.resource);
  restoredResource.trashedAt = "";
  restoredResource.updatedAt = "2026-06-02T00:05:00.000Z";
  restoredResource.revision = Number(restoredResource.revision || 0) + 1;
  const restoreWrite = await requestJsonAt(resourceBaseUrl, "/api/resources/check-resource-created", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "If-Match": '"state-5"' },
    body: JSON.stringify({ resource: restoredResource, baseRevision: 5 }),
  });
  assert(
    restoreWrite.response.ok
      && restoreWrite.payload.revision === 6
      && restoreWrite.payload.resource?.trashedAt === "",
    "incremental Resource restore did not persist at revision 6"
  );

  const unsafeNewParent = structuredClone(hierarchyNewParent);
  unsafeNewParent.childOrder = [hierarchyMovedResource.id];
  const unsafeHierarchyWrite = await requestJsonAt(resourceBaseUrl, `/api/resources/${hierarchyNewParent.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "If-Match": '"state-6"' },
    body: JSON.stringify({ resource: unsafeNewParent, baseRevision: 6 }),
  });
  assert(
    unsafeHierarchyWrite.response.status === 422
      && unsafeHierarchyWrite.payload.code === "INVALID_STATE"
      && unsafeHierarchyWrite.payload.details?.issues?.some((issue) => issue.code === "invalid_child_parent"),
    "new-parent-first hierarchy write was not rejected without changing revision 6"
  );
  await assertIncrementalHierarchy(resourceBaseUrl, 6, hierarchyMovedResource.id, hierarchyOldParent.id, [hierarchyMovedResource.id], []);

  const detachedOldParent = structuredClone(hierarchyOldParent);
  detachedOldParent.childOrder = [];
  detachedOldParent.updatedAt = "2026-06-02T00:06:00.000Z";
  detachedOldParent.revision += 1;
  const detachOldWrite = await requestJsonAt(resourceBaseUrl, `/api/resources/${hierarchyOldParent.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "If-Match": '"state-6"' },
    body: JSON.stringify({ resource: detachedOldParent, baseRevision: 6 }),
  });
  assert(detachOldWrite.response.ok && detachOldWrite.payload.revision === 7, "old parent was not detached first at revision 7");

  const movedToNewParent = structuredClone(hierarchyMovedResource);
  movedToNewParent.parentId = hierarchyNewParent.id;
  movedToNewParent.updatedAt = "2026-06-02T00:07:00.000Z";
  movedToNewParent.revision += 1;
  const moveResourceWrite = await requestJsonAt(resourceBaseUrl, `/api/resources/${hierarchyMovedResource.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "If-Match": '"state-7"' },
    body: JSON.stringify({ resource: movedToNewParent, baseRevision: 7 }),
  });
  assert(moveResourceWrite.response.ok && moveResourceWrite.payload.revision === 8, "moved Resource parentId was not committed second at revision 8");

  const attachedNewParent = structuredClone(hierarchyNewParent);
  attachedNewParent.childOrder = [hierarchyMovedResource.id];
  attachedNewParent.updatedAt = "2026-06-02T00:08:00.000Z";
  attachedNewParent.revision += 1;
  const attachNewWrite = await requestJsonAt(resourceBaseUrl, `/api/resources/${hierarchyNewParent.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "If-Match": '"state-8"' },
    body: JSON.stringify({ resource: attachedNewParent, baseRevision: 8 }),
  });
  assert(attachNewWrite.response.ok && attachNewWrite.payload.revision === 9, "new parent was not attached third at revision 9");
  await assertIncrementalHierarchy(resourceBaseUrl, 9, hierarchyMovedResource.id, hierarchyNewParent.id, [], [hierarchyMovedResource.id]);

  const detachedNewParent = structuredClone(attachedNewParent);
  detachedNewParent.childOrder = [];
  detachedNewParent.updatedAt = "2026-06-02T00:09:00.000Z";
  detachedNewParent.revision += 1;
  const detachForRootWrite = await requestJsonAt(resourceBaseUrl, `/api/resources/${hierarchyNewParent.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "If-Match": '"state-9"' },
    body: JSON.stringify({ resource: detachedNewParent, baseRevision: 9 }),
  });
  assert(detachForRootWrite.response.ok && detachForRootWrite.payload.revision === 10, "parent was not detached before moving to root at revision 10");

  const movedToRoot = structuredClone(movedToNewParent);
  movedToRoot.parentId = "";
  movedToRoot.updatedAt = "2026-06-02T00:10:00.000Z";
  movedToRoot.revision += 1;
  const moveToRootWrite = await requestJsonAt(resourceBaseUrl, `/api/resources/${hierarchyMovedResource.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "If-Match": '"state-10"' },
    body: JSON.stringify({ resource: movedToRoot, baseRevision: 10 }),
  });
  assert(moveToRootWrite.response.ok && moveToRootWrite.payload.revision === 11, "Resource was not moved to root at revision 11");
  await assertIncrementalHierarchy(resourceBaseUrl, 11, hierarchyMovedResource.id, "", [], []);

  const movedBackToOldParent = structuredClone(movedToRoot);
  movedBackToOldParent.parentId = hierarchyOldParent.id;
  movedBackToOldParent.updatedAt = "2026-06-02T00:11:00.000Z";
  movedBackToOldParent.revision += 1;
  const moveBackWrite = await requestJsonAt(resourceBaseUrl, `/api/resources/${hierarchyMovedResource.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "If-Match": '"state-11"' },
    body: JSON.stringify({ resource: movedBackToOldParent, baseRevision: 11 }),
  });
  assert(moveBackWrite.response.ok && moveBackWrite.payload.revision === 12, "root Resource parentId was not committed before the parent childOrder at revision 12");

  const attachedOldParent = structuredClone(detachedOldParent);
  attachedOldParent.childOrder = [hierarchyMovedResource.id];
  attachedOldParent.updatedAt = "2026-06-02T00:12:00.000Z";
  attachedOldParent.revision += 1;
  const attachOldWrite = await requestJsonAt(resourceBaseUrl, `/api/resources/${hierarchyOldParent.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "If-Match": '"state-12"' },
    body: JSON.stringify({ resource: attachedOldParent, baseRevision: 12 }),
  });
  assert(attachOldWrite.response.ok && attachOldWrite.payload.revision === 13, "old parent childOrder was not committed after root-to-parent move at revision 13");
  await assertIncrementalHierarchy(resourceBaseUrl, 13, hierarchyMovedResource.id, hierarchyOldParent.id, [hierarchyMovedResource.id], []);

  const finalRead = await requestJsonAt(resourceBaseUrl, "/api/state");
  const finalResources = new Map(finalRead.payload.state?.resources?.map((resource) => [resource.id, resource]));
  assert(finalRead.payload.revision === 13 && finalResources.size === 6, "incremental Resource and hierarchy writes did not preserve exactly six Resources at revision 13");
  assert(finalResources.get("check-resource")?.title === primaryUpdate.title, "Resource create clobbered the existing target Resource");
  assert(finalResources.get("check-resource-peer")?.title === peerUpdate.title, "Resource create clobbered the unrelated Resource");
  assert(finalResources.get("check-resource-created")?.trashedAt === "", "incrementally restored Resource did not remain present and active");

  const relationalResources = await pool.query(
    "SELECT id, title FROM resources WHERE app_state_id = $1 ORDER BY id",
    [resourceAppStateId]
  );
  assert(relationalResources.rowCount === 6, "incremental Resource API did not synchronize the relational Resource table");
  assert(
    relationalResources.rows.find((row) => row.id === "check-resource-peer")?.title === peerUpdate.title,
    "incremental Resource API did not preserve the unrelated relational Resource row"
  );
}

async function assertIncrementalHierarchy(baseUrl, expectedRevision, movedResourceId, expectedParentId, expectedOldChildOrder, expectedNewChildOrder) {
  const read = await requestJsonAt(baseUrl, "/api/state");
  const resources = new Map(read.payload.state?.resources?.map((resource) => [resource.id, resource]));
  assert(read.payload.revision === expectedRevision, `incremental hierarchy read did not remain at revision ${expectedRevision}`);
  assert(resources.get(movedResourceId)?.parentId === expectedParentId, `incremental hierarchy parentId was wrong at revision ${expectedRevision}`);
  assert(JSON.stringify(resources.get("check-resource-hierarchy-old")?.childOrder) === JSON.stringify(expectedOldChildOrder), `old parent childOrder was wrong at revision ${expectedRevision}`);
  assert(JSON.stringify(resources.get("check-resource-hierarchy-new")?.childOrder) === JSON.stringify(expectedNewChildOrder), `new parent childOrder was wrong at revision ${expectedRevision}`);
}

async function assertResourcePermanentDeleteRejectedDoesNotMutate() {
  const beforeState = await pool.query("SELECT revision, state::text AS state_text FROM app_state WHERE id = $1", [appStateId]);
  const beforeResources = await pool.query(
    "SELECT id, title, data::text AS data_text FROM resources WHERE app_state_id = $1 ORDER BY id",
    [appStateId]
  );
  const draft = structuredClone(await currentState());
  const removedResourceId = draft.resources[0].id;
  draft.resources = draft.resources.filter((resource) => resource.id !== removedResourceId);
  for (const task of draft.tasks) {
    if (task.resourceId === removedResourceId) task.resourceId = "";
  }
  for (const capture of draft.captures) {
    if (capture.convertedId === removedResourceId) {
      capture.convertedTo = "";
      capture.convertedId = "";
    }
  }
  draft.links = draft.links.filter((link) => !(
    (link.fromType === "resources" && link.fromId === removedResourceId)
    || (link.toType === "resources" && link.toId === removedResourceId)
  ));

  const result = await requestJson("/api/state", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "If-Match": '"state-2"' },
    body: JSON.stringify({ state: draft, baseRevision: 2 }),
  });
  assert(
    result.response.status === 422
      && result.payload.code === "RESOURCE_PERMANENT_DELETE_DISABLED"
      && result.payload.revision === 2,
    "full-state Resource omission did not return RESOURCE_PERMANENT_DELETE_DISABLED/422 at the current revision"
  );
  assert(result.response.headers.get("etag") === '"state-2"', "Resource omission rejection did not return the current ETag");
  assert(
    result.payload.details?.issues?.some((issue) => (
      issue.path === "state.resources"
      && issue.code === "resource_permanent_delete_disabled"
      && issue.missingResourceCount === 1
      && issue.missingResourceIds?.includes(removedResourceId)
    )),
    "Resource omission rejection did not identify the missing existing Resource"
  );

  const afterState = await pool.query("SELECT revision, state::text AS state_text FROM app_state WHERE id = $1", [appStateId]);
  const afterResources = await pool.query(
    "SELECT id, title, data::text AS data_text FROM resources WHERE app_state_id = $1 ORDER BY id",
    [appStateId]
  );
  assert(Number(afterState.rows[0]?.revision) === Number(beforeState.rows[0]?.revision), "Resource omission rejection changed the stored revision");
  assert(afterState.rows[0]?.state_text === beforeState.rows[0]?.state_text, "Resource omission rejection mutated the stored JSONB state");
  assert(JSON.stringify(afterResources.rows) === JSON.stringify(beforeResources.rows), "Resource omission rejection mutated relational Resource rows");
  await assertStoredRevisionAndTitle(2, "PostgreSQL updated resource", "Resource omission rejection mutated readable state");
}

async function checkOperatorStateResetBypass() {
  operatorResetStorage = createStorage({ databaseUrl, appStateId: operatorResetStateId });
  await operatorResetStorage.ready();
  const initialState = makeValidState();
  initialState.resources.push(makeIncrementalResource("check-operator-extra", "Operator-only reset extra"));
  const bootstrap = await operatorResetStorage.writeAppState(initialState, {
    baseRevision: 0,
    requirePrecondition: true,
  });
  assert(bootstrap.revision === 1 && bootstrap.state.resources.length === 2, "operator reset check bootstrap failed");

  const resetState = structuredClone(bootstrap.state);
  resetState.resources = resetState.resources.filter((resource) => resource.id !== "check-operator-extra");
  const reset = await operatorResetStorage.writeAppState(resetState, {
    baseRevision: 1,
    requirePrecondition: true,
  });
  assert(
    reset.revision === 2
      && reset.state.resources.length === 1
      && reset.state.resources[0]?.id === "check-resource",
    "trusted operator storage reset could not intentionally replace Resource membership"
  );
}

async function assertInvalidWriteDoesNotMutate(label, mutate, expectedIssueCode) {
  const before = await pool.query("SELECT revision, state::text AS state_text FROM app_state WHERE id = $1", [appStateId]);
  const draft = structuredClone(await currentState());
  mutate(draft);
  const result = await requestJson("/api/state", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "If-Match": '"state-2"',
    },
    body: JSON.stringify({ state: draft, baseRevision: 2 }),
  });
  assert(result.response.status === 422 && result.payload.code === "INVALID_STATE", `${label} payload did not return INVALID_STATE/422`);
  assert(result.payload.details?.issues?.some((issue) => issue.code === expectedIssueCode), `${label} payload did not report ${expectedIssueCode}`);
  const after = await pool.query("SELECT revision, state::text AS state_text FROM app_state WHERE id = $1", [appStateId]);
  assert(Number(after.rows[0]?.revision) === Number(before.rows[0]?.revision), `${label} rejection changed the stored revision`);
  assert(after.rows[0]?.state_text === before.rows[0]?.state_text, `${label} rejection mutated the stored state`);
  await assertStoredRevisionAndTitle(2, "PostgreSQL updated resource", `${label} rejection mutated readable state`);
}

async function currentState() {
  const result = await readState();
  return result.payload.state;
}

async function assertStoredRevisionAndTitle(expectedRevision, expectedTitle, message) {
  const read = await readState();
  assert(read.payload.revision === expectedRevision && read.payload.state?.revision === expectedRevision, `${message}: revision changed`);
  assert(read.payload.state?.resources?.[0]?.title === expectedTitle, `${message}: Resource title changed`);
}

async function readState() {
  const result = await requestJson("/api/state");
  assert(result.response.ok, "state read failed");
  return result;
}

async function cleanupCheckRows() {
  await pool.query("DELETE FROM app_private_data WHERE id = ANY($1)", [checkStateIds]);
  await pool.query("DELETE FROM app_state WHERE id = ANY($1)", [checkStateIds]);
}

async function assertCleanupComplete() {
  const remainingState = await pool.query("SELECT count(*)::int AS count FROM app_state WHERE id = ANY($1)", [checkStateIds]);
  const remainingPrivate = await pool.query("SELECT count(*)::int AS count FROM app_private_data WHERE id = ANY($1)", [checkStateIds]);
  assert(Number(remainingState.rows[0]?.count) === 0 && Number(remainingPrivate.rows[0]?.count) === 0, "PostgreSQL check rows were not cleaned up");
}

async function deleteRelationalRows(stateId) {
  const tables = [
    "task_resources",
    "collection_links",
    "habit_instances",
    "google_events",
    "tasks",
    "resources",
    "habits",
    "projects",
    "goals",
    "boxes",
    "captures",
    "journals",
    "google_calendars",
  ];
  for (const table of tables) {
    await pool.query(`DELETE FROM ${table} WHERE app_state_id = $1`, [stateId]);
  }
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function databaseSslConfig() {
  const mode = String(process.env.PGSSLMODE || process.env.DATABASE_SSL || "").toLowerCase();
  if (["require", "no-verify"].includes(mode)) return { rejectUnauthorized: false };
  if (["verify-ca", "verify-full"].includes(mode)) return true;
  return undefined;
}

async function waitForHealth() {
  await waitForServerHealth(serverProcess, baseUrl, () => serverStderr);
}

async function waitForServerHealth(process, url, stderr) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) {
      const errorOutput = stderr().trim();
      throw new Error(`server exited before health check passed, exitCode=${process.exitCode}${errorOutput ? `, stderr=${errorOutput}` : ""}`);
    }
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("server health check timed out");
}

async function requestJson(path, options = {}) {
  return requestJsonAt(baseUrl, path, options);
}

async function requestJsonAt(url, path, options = {}) {
  const response = await fetch(`${url}${path}`, options);
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function* stateEvents(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const separator = buffer.indexOf("\n\n");
      if (separator >= 0) {
        const frame = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (data) yield JSON.parse(data);
        continue;
      }
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n");
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

async function nextStateEvent(iterator, timeoutMs = 5_000) {
  let timeout;
  try {
    const result = await Promise.race([
      iterator.next(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("state event stream timed out")), timeoutMs);
      }),
    ]);
    assert(!result.done && Number.isSafeInteger(result.value?.revision), "state event stream returned an invalid event");
    return result.value;
  } finally {
    clearTimeout(timeout);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
