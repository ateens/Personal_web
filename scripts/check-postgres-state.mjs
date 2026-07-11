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
const tokenStateId = `${appStateId}-private`;
const legacyTokenStateId = `${appStateId}-legacy-token`;
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
let serverStderr = "";
let resourceServerStderr = "";

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

  const indexHead = await fetch(`${baseUrl}/`, { method: "HEAD" });
  assert(indexHead.ok, "static index HEAD request failed");
  assert(indexHead.headers.get("cache-control") === "no-store", "static index response should not be cached");
  assert(indexHead.headers.get("x-content-type-options") === "nosniff", "static index response is missing nosniff");
  assert(indexHead.headers.get("content-security-policy")?.includes("frame-ancestors 'none'"), "static index response is missing the application CSP");
  const versionedAppHead = await fetch(`${baseUrl}/app.js?v=check`, { method: "HEAD" });
  assert(versionedAppHead.ok, "versioned static asset HEAD request failed");
  assert(versionedAppHead.headers.get("cache-control")?.includes("immutable"), "versioned static asset should be immutable cached");
  const compressedApp = await fetch(`${baseUrl}/app.js?v=check`, { headers: { "Accept-Encoding": "br" } });
  assert(compressedApp.ok && compressedApp.headers.get("content-encoding") === "br", "static JavaScript did not use Brotli compression");
  const staticEtag = compressedApp.headers.get("etag");
  assert(staticEtag, "static JavaScript response is missing an ETag");
  const conditionalApp = await fetch(`${baseUrl}/app.js?v=check`, { headers: { "If-None-Match": staticEtag } });
  assert(conditionalApp.status === 304, "conditional static request did not return 304");

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
  assert(firstRead.payload.state?.resources?.[0]?.commentThreads?.[0]?.replies?.[0]?.body === "PostgreSQL check reply", "Resource comment thread changed during PostgreSQL round trip");
  assert(firstRead.payload.state?.resources?.[0]?.commentThreads?.[1]?.anchor?.blockId === "check-resource-block", "Resource inline comment anchor changed during PostgreSQL round trip");
  assert(firstRead.payload.state?.settings?.viewControls?.resources?.searchScope === "database", "Resource searchScope changed during PostgreSQL round trip");
  assert(
    JSON.stringify(firstRead.payload.state?.settings?.openPagesIn) === JSON.stringify({ library: "full", list: "center", map: "side" }),
    "Resource openPagesIn changed during PostgreSQL round trip",
  );
  assert(firstRead.payload.state?.settings?.notionParityMode === false, "Resource notionParityMode changed during PostgreSQL round trip");
  assert(firstRead.payload.state?.settings?.advancedWindowMode === true, "Resource advancedWindowMode changed during PostgreSQL round trip");
  assert(firstRead.payload.state?.tasks?.[0]?.dueDate === "2026-06-02", "task due date changed during PostgreSQL round trip");
  assert(firstRead.payload.state?.habitInstances?.[0]?.date === "2026-06-02", "habit date changed during PostgreSQL round trip");

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

  console.log(`PostgreSQL state check passed for isolated APP_STATE_ID=${appStateId}.`);
} catch (error) {
  console.error(error.message || error);
  process.exitCode = 1;
} finally {
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
    tasks: [{ id: "check-task", title: "PostgreSQL check task", boxId: "check-box", goalId: "check-goal", projectId: "check-project", resourceId: "check-resource", dueDate: "2026-06-02" }],
    resources: [{
      id: "check-resource",
      title: "PostgreSQL check resource",
      boxId: "check-box",
      goalId: "check-goal",
      projectId: "check-project",
      url: "https://example.com/resource",
      pinned: true,
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
      blocks: [{ id: "check-resource-block", type: "paragraph", text: "PostgreSQL Resource block", indent: 0, marks: [{ type: "bold", start: 0, end: 10 }] }],
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
  initialState.resources.push(peerResource);
  const bootstrap = await requestJsonAt(resourceBaseUrl, "/api/state", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "If-Match": '"state-0"' },
    body: JSON.stringify({ state: initialState, baseRevision: 0 }),
  });
  assert(bootstrap.response.ok && bootstrap.payload.revision === 1, "incremental Resource check bootstrap failed");

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
    "backward-compatible incremental Resource create without media/readOnly fields did not return the created Resource at revision 4"
  );

  const idMismatch = await requestJsonAt(resourceBaseUrl, "/api/resources/check-resource-created", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "If-Match": '"state-4"' },
    body: JSON.stringify({ resource: { ...createdResource, id: "check-resource-mismatched" }, baseRevision: 4 }),
  });
  assert(idMismatch.response.status === 400 && idMismatch.payload.code === "RESOURCE_ID_MISMATCH", "Resource path/body ID mismatch was not rejected");

  const finalRead = await requestJsonAt(resourceBaseUrl, "/api/state");
  const finalResources = new Map(finalRead.payload.state?.resources?.map((resource) => [resource.id, resource]));
  assert(finalRead.payload.revision === 4 && finalResources.size === 3, "incremental Resource create did not persist exactly one Resource");
  assert(finalResources.get("check-resource")?.title === primaryUpdate.title, "Resource create clobbered the existing target Resource");
  assert(finalResources.get("check-resource-peer")?.title === peerUpdate.title, "Resource create clobbered the unrelated Resource");

  const relationalResources = await pool.query(
    "SELECT id, title FROM resources WHERE app_state_id = $1 ORDER BY id",
    [resourceAppStateId]
  );
  assert(relationalResources.rowCount === 3, "incremental Resource API did not synchronize the relational Resource table");
  assert(
    relationalResources.rows.find((row) => row.id === "check-resource-peer")?.title === peerUpdate.title,
    "incremental Resource API did not preserve the unrelated relational Resource row"
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
  const stateIds = [appStateId, resourceAppStateId, tokenStateId, legacyTokenStateId];
  await pool.query("DELETE FROM app_private_data WHERE id = ANY($1)", [stateIds]);
  await pool.query("DELETE FROM app_state WHERE id = ANY($1)", [stateIds]);
}

async function assertCleanupComplete() {
  const stateIds = [appStateId, resourceAppStateId, tokenStateId, legacyTokenStateId];
  const remainingState = await pool.query("SELECT count(*)::int AS count FROM app_state WHERE id = ANY($1)", [stateIds]);
  const remainingPrivate = await pool.query("SELECT count(*)::int AS count FROM app_private_data WHERE id = ANY($1)", [stateIds]);
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
