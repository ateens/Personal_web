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

const port = Number(process.env.PORT || 4199);
const appStateId = process.env.APP_STATE_ID || `check-${randomBytes(6).toString("hex")}`;
const tokenStateId = `${appStateId}-private`;
const legacyTokenStateId = `${appStateId}-legacy-token`;
const legacyTokenFile = `/tmp/personal-web-legacy-token-${appStateId}.json`;
const baseUrl = `http://127.0.0.1:${port}`;
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
let tokenStorage;
let legacyTokenStorage;
let serverStderr = "";

try {
  serverProcess = spawn("node", ["server.js"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      APP_STATE_ID: appStateId,
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  serverProcess.stderr.on("data", (chunk) => {
    serverStderr += chunk;
  });
  await waitForHealth();

  const status = await fetchJson("/api/state/status");
  assert(status.configured === true && status.connected === true, "state status did not report a PostgreSQL connection");
  assert(status.tokenStore === "postgresql", "Google token store did not report PostgreSQL");
  const indexHead = await fetch(`${baseUrl}/`, { method: "HEAD" });
  assert(indexHead.ok, "static index HEAD request failed");
  assert(indexHead.headers.get("cache-control") === "no-store", "static index response should not be cached");
  assert(indexHead.headers.get("x-content-type-options") === "nosniff", "static index response is missing nosniff");
  const versionedAppHead = await fetch(`${baseUrl}/app.js?v=check`, { method: "HEAD" });
  assert(versionedAppHead.ok, "versioned static asset HEAD request failed");
  assert(versionedAppHead.headers.get("cache-control")?.includes("immutable"), "versioned static asset should be immutable cached");
  const invalidJsonResponse = await fetch(`${baseUrl}/api/state`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: "{bad json",
  });
  const invalidJsonPayload = await invalidJsonResponse.json().catch(() => ({}));
  assert(invalidJsonResponse.status === 400 && invalidJsonPayload.error === "Invalid JSON body.", "invalid JSON state write should return 400");

  const state = {
    version: 1000,
    createdAt: new Date().toISOString(),
    updatedAt: "2026-06-02T00:00:00.000Z",
    settings: { navOrder: ["database", "today"], appMode: "legacy-local", notionSyncMode: "obsolete" },
    captures: [{ id: "check-capture", title: "PostgreSQL check capture" }],
    boxes: [{ id: "check-box", name: "PostgreSQL check box" }],
    goals: [{ id: "check-goal", name: "PostgreSQL check goal", boxId: "check-box" }],
    projects: [{ id: "check-project", name: "PostgreSQL check project", goalId: "check-goal", boxId: "check-box" }],
    tasks: [{ id: "check-task", title: "PostgreSQL check task" }],
    resources: [{ id: "check-resource", title: "PostgreSQL check resource", projectId: "check-project" }],
    habits: [{ id: "check-habit", title: "PostgreSQL check habit", projectId: "check-project" }],
    habitInstances: [{ id: "check-habit-instance", habitId: "check-habit", date: "2026-06-02", completed: true }],
    journals: [{ id: "check-journal", title: "PostgreSQL check journal" }],
    googleCalendars: [{ id: "check-google-calendar", summary: "PostgreSQL check Google calendar" }],
    googleEvents: [{ id: "check-google-event", calendarId: "check-google-calendar", title: "PostgreSQL check Google event" }],
    links: [{ id: "check-link", fromType: "tasks", fromId: "check-task", toType: "projects", toId: "check-project" }],
  };

  const writeResult = await fetchJson("/api/state", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state }),
  });
  assert(writeResult.ok === true, "state write did not return ok=true");

  const readResult = await fetchJson("/api/state");
  assert(readResult.state?.version === 1000, "state read did not return the written version");
  for (const key of COLLECTION_KEYS) {
    assert(readResult.state?.[key]?.length === 1, `state read did not return written ${key}`);
  }

  const postState = {
    ...state,
    version: 1001,
    settings: {
      navOrder: ["database", "unknown-view", "today", "database", 17],
      calendarSources: { tasks: false, projects: "invalid-projects-source", google: true, extra: false },
      visibleGoogleCalendars: { primary: false, secondary: "invalid-visible", tertiary: true },
      viewControls: {
        resources: {
          search: "check resource",
          filter: "active",
          sort: "title",
          mode: "map",
          type: "article",
          toggles: { pinned: true, readLater: "invalid-toggle", important: true, linked: false },
        },
      },
      googleCalendarId: 123,
      statsDemoDataSeeded: "yes",
      appMode: "legacy-local",
      notionSyncMode: "obsolete",
    },
    updatedAt: 123,
    tasks: [{ id: "check-task", title: "PostgreSQL check task", kind: "legacy-task-kind" }, null, "invalid-task"],
    resources: [null, "invalid-resource", { id: "check-resource", title: "PostgreSQL check resource" }],
    journals: [{ id: "check-journal", title: "PostgreSQL check journal", kind: "legacy-journal-kind" }, false],
  };
  const postWriteResult = await fetchJson("/api/state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state: postState }),
  });
  assert(postWriteResult.ok === true, "state POST write did not return ok=true");
  assert(postWriteResult.state?.version === 1001, "state POST write did not return the normalized state");
  assert(postWriteResult.state?.settings?.navOrder?.join(",") === "database,today,inbox,tasks,projects,goals,boxes,resources,habits,journal,calendar", "state POST write response did not normalize navOrder entries");
  assert(postWriteResult.state?.settings?.calendarSources?.tasks === false && postWriteResult.state.settings.calendarSources.projects === true, "state POST write response did not normalize calendar source values");
  assert(postWriteResult.state?.settings?.visibleGoogleCalendars?.primary === false && !("secondary" in postWriteResult.state.settings.visibleGoogleCalendars) && postWriteResult.state.settings.visibleGoogleCalendars.tertiary === true, "state POST write response did not normalize visible Google calendar values");
  assert(postWriteResult.state?.settings?.viewControls?.resources?.mode === "map", "state POST write response did not preserve resource view mode");
  assert(postWriteResult.state?.settings?.viewControls?.resources?.toggles?.pinned === true && postWriteResult.state.settings.viewControls.resources.toggles.readLater === false, "state POST write response did not normalize resource view toggles");
  assert(postWriteResult.state?.tasks?.length === 1 && !("kind" in postWriteResult.state.tasks[0]), "state POST write response did not normalize invalid or legacy task entries");
  assert(postWriteResult.state?.resources?.length === 1 && postWriteResult.state.resources[0]?.id === "check-resource", "state POST write response did not normalize invalid resource entries");
  assert(postWriteResult.state?.journals?.length === 1 && !("kind" in postWriteResult.state.journals[0]), "state POST write response did not normalize invalid or legacy journal entries");
  assert(!("appMode" in (postWriteResult.state?.settings || {})) && !("notionSyncMode" in (postWriteResult.state?.settings || {})), "state POST write response included deprecated settings");

  const row = await pool.query(
    "SELECT state->>'version' AS version, array_to_string(ARRAY(SELECT jsonb_array_elements_text(state->'settings'->'navOrder')), ',') AS nav_order, jsonb_typeof(state->'settings'->'calendarSources') AS calendar_sources_type, state->'settings'->'calendarSources' AS calendar_sources, jsonb_typeof(state->'settings'->'visibleGoogleCalendars') AS visible_google_calendars_type, state->'settings'->'visibleGoogleCalendars' AS visible_google_calendars, jsonb_typeof(state->'settings'->'statsDemoDataSeeded') AS stats_seeded_type, jsonb_typeof(state->'settings'->'googleCalendarId') AS google_calendar_id_type, jsonb_typeof(state->'updatedAt') AS updated_at_type, jsonb_array_length(state->'captures') AS capture_count, jsonb_array_length(state->'boxes') AS box_count, jsonb_array_length(state->'goals') AS goal_count, jsonb_array_length(state->'projects') AS project_count, jsonb_array_length(state->'tasks') AS task_count, jsonb_array_length(state->'resources') AS resource_count, jsonb_array_length(state->'habits') AS habit_count, jsonb_array_length(state->'habitInstances') AS habit_instance_count, jsonb_array_length(state->'journals') AS journal_count, jsonb_array_length(state->'googleCalendars') AS google_calendar_count, jsonb_array_length(state->'googleEvents') AS google_event_count, jsonb_array_length(state->'links') AS link_count, state->'tasks'->0 ? 'kind' AS task_has_kind, state->'journals'->0 ? 'kind' AS journal_has_kind, state->'settings' ? 'appMode' AS has_app_mode, state->'settings' ? 'notionSyncMode' AS has_notion_sync_mode FROM app_state WHERE id = $1",
    [appStateId]
  );
  assert(row.rows[0]?.version === "1001", "app_state row did not contain the POST-written version");
  assert(Number(row.rows[0]?.capture_count) === 1, "app_state row did not contain the written capture");
  assert(Number(row.rows[0]?.box_count) === 1, "app_state row did not contain the written box");
  assert(Number(row.rows[0]?.goal_count) === 1, "app_state row did not contain the written goal");
  assert(Number(row.rows[0]?.project_count) === 1, "app_state row did not contain the written project");
  assert(Number(row.rows[0]?.task_count) === 1, "app_state row did not contain the written task");
  assert(Number(row.rows[0]?.habit_count) === 1, "app_state row did not contain the written habit");
  assert(Number(row.rows[0]?.habit_instance_count) === 1, "app_state row did not contain the written habit instance");
  assert(Number(row.rows[0]?.google_calendar_count) === 1, "app_state row did not contain the written Google calendar");
  assert(Number(row.rows[0]?.google_event_count) === 1, "app_state row did not contain the written Google event");
  assert(Number(row.rows[0]?.link_count) === 1, "app_state row did not contain the written link");
  assert(Number(row.rows[0]?.resource_count) === 1 && Number(row.rows[0]?.journal_count) === 1, "server did not normalize invalid collection item values before storage");
  assert(row.rows[0]?.task_has_kind === false && row.rows[0]?.journal_has_kind === false, "server stored legacy kind fields on task or journal entries");
  assert(row.rows[0]?.nav_order === "database,today,inbox,tasks,projects,goals,boxes,resources,habits,journal,calendar", "server did not normalize invalid navOrder entries before storage");
  assert(row.rows[0]?.calendar_sources_type === "object" && row.rows[0]?.visible_google_calendars_type === "object", "server did not normalize settings object maps before storage");
  assert(row.rows[0]?.calendar_sources?.tasks === false && row.rows[0]?.calendar_sources?.projects === true && row.rows[0]?.calendar_sources?.google === true && !("extra" in row.rows[0].calendar_sources), "server did not normalize calendar source values before storage");
  assert(row.rows[0]?.visible_google_calendars?.primary === false && !("secondary" in row.rows[0].visible_google_calendars) && row.rows[0]?.visible_google_calendars?.tertiary === true, "server did not normalize visible Google calendar values before storage");
  assert(row.rows[0]?.stats_seeded_type === "boolean" && row.rows[0]?.google_calendar_id_type === "string" && row.rows[0]?.updated_at_type === "string", "server did not normalize scalar settings or timestamps before storage");
  assert(row.rows[0]?.has_app_mode === false && row.rows[0]?.has_notion_sync_mode === false, "server stored deprecated settings keys");
  const viewControlRow = await pool.query(
    "SELECT state->'settings'->'viewControls'->'resources'->>'mode' AS resource_mode, state->'settings'->'viewControls'->'resources'->>'type' AS resource_type, state->'settings'->'viewControls'->'resources'->'toggles'->>'pinned' AS pinned_toggle, state->'settings'->'viewControls'->'resources'->'toggles'->>'readLater' AS read_later_toggle FROM app_state WHERE id = $1",
    [appStateId]
  );
  assert(viewControlRow.rows[0]?.resource_mode === "map" && viewControlRow.rows[0]?.resource_type === "article", "server did not store resource view controls in PostgreSQL");
  assert(viewControlRow.rows[0]?.pinned_toggle === "true" && viewControlRow.rows[0]?.read_later_toggle === "false", "server did not normalize resource view control toggles before storage");

  const pollutedState = {
    version: "not-a-version",
    createdAt: "not-a-date",
    updatedAt: "not-a-date",
    settings: {
      navOrder: ["unknown-view", "calendar", "today", "calendar"],
      appMode: "legacy-local",
      calendarSources: { tasks: "polluted-tasks", projects: false, google: true },
      visibleGoogleCalendars: { primary: "polluted-primary", work: false },
      viewControls: { resources: { mode: "list", toggles: { readLater: true } }, today: "polluted-control" },
    },
    tasks: [null, { id: "polluted-task", kind: "legacy-task-kind" }],
    journals: [{ id: "polluted-journal", kind: "legacy-journal-kind" }, "polluted-journal"],
  };
  await pool.query("UPDATE app_state SET state = $2::jsonb WHERE id = $1", [appStateId, JSON.stringify(pollutedState)]);
  const healedReadResult = await fetchJson("/api/state");
  assert(healedReadResult.state?.version === 3, "state read did not normalize an invalid stored version");
  assert(healedReadResult.state?.tasks?.length === 1 && !("kind" in healedReadResult.state.tasks[0]), "state read did not normalize polluted stored tasks");
  assert(healedReadResult.state?.journals?.length === 1 && !("kind" in healedReadResult.state.journals[0]), "state read did not normalize polluted stored journals");
  assert(healedReadResult.state?.settings?.navOrder?.join(",") === "calendar,today,inbox,tasks,projects,goals,boxes,resources,habits,journal,database", "state read did not normalize polluted stored navOrder entries");
  assert(healedReadResult.state?.settings?.calendarSources?.tasks === true && healedReadResult.state.settings.calendarSources.projects === false, "state read did not normalize polluted calendar sources");
  assert(!("primary" in healedReadResult.state?.settings?.visibleGoogleCalendars) && healedReadResult.state.settings.visibleGoogleCalendars.work === false, "state read did not normalize polluted visible Google calendars");
  assert(healedReadResult.state?.settings?.viewControls?.resources?.mode === "list" && healedReadResult.state.settings.viewControls.resources.toggles.readLater === true, "state read did not normalize polluted view controls");
  assert(!("appMode" in (healedReadResult.state?.settings || {})), "state read returned deprecated settings from polluted storage");

  const healedRow = await pool.query(
    "SELECT state->>'version' AS version, jsonb_typeof(state->'tasks') AS tasks_type, jsonb_array_length(state->'tasks') AS task_count, jsonb_array_length(state->'journals') AS journal_count, state->'tasks'->0 ? 'kind' AS task_has_kind, state->'journals'->0 ? 'kind' AS journal_has_kind, array_to_string(ARRAY(SELECT jsonb_array_elements_text(state->'settings'->'navOrder')), ',') AS nav_order, state->'settings'->'calendarSources' AS calendar_sources, state->'settings'->'visibleGoogleCalendars' AS visible_google_calendars, state->'settings' ? 'appMode' AS has_app_mode FROM app_state WHERE id = $1",
    [appStateId]
  );
  assert(healedRow.rows[0]?.version === "3", "state read did not heal invalid stored version in PostgreSQL");
  assert(healedRow.rows[0]?.tasks_type === "array" && healedRow.rows[0]?.nav_order === "calendar,today,inbox,tasks,projects,goals,boxes,resources,habits,journal,database", "state read did not heal polluted PostgreSQL collections/settings");
  assert(healedRow.rows[0]?.calendar_sources?.tasks === true && healedRow.rows[0]?.calendar_sources?.projects === false, "state read did not heal polluted calendar sources in PostgreSQL");
  assert(!("primary" in healedRow.rows[0]?.visible_google_calendars) && healedRow.rows[0]?.visible_google_calendars?.work === false, "state read did not heal polluted visible Google calendars in PostgreSQL");
  assert(Number(healedRow.rows[0]?.task_count) === 1 && Number(healedRow.rows[0]?.journal_count) === 1, "state read did not remove polluted collection items from PostgreSQL");
  assert(healedRow.rows[0]?.task_has_kind === false && healedRow.rows[0]?.journal_has_kind === false, "state read did not remove legacy kind fields from PostgreSQL");
  assert(healedRow.rows[0]?.has_app_mode === false, "state read did not remove deprecated settings from PostgreSQL");

  await pool.query("UPDATE app_state SET state = $2::jsonb WHERE id = $1", [appStateId, JSON.stringify("polluted-scalar-state")]);
  const scalarHealedReadResult = await fetchJson("/api/state");
  assert(scalarHealedReadResult.state?.version === 3, "state read did not normalize a scalar PostgreSQL state");
  assert(Array.isArray(scalarHealedReadResult.state?.tasks), "state read did not create collections for scalar PostgreSQL state");
  const scalarHealedRow = await pool.query(
    "SELECT jsonb_typeof(state) AS state_type, jsonb_typeof(state->'settings') AS settings_type, jsonb_typeof(state->'tasks') AS tasks_type FROM app_state WHERE id = $1",
    [appStateId]
  );
  assert(scalarHealedRow.rows[0]?.state_type === "object", "state read did not heal scalar PostgreSQL state into an object");
  assert(scalarHealedRow.rows[0]?.settings_type === "object" && scalarHealedRow.rows[0]?.tasks_type === "array", "state read did not heal scalar PostgreSQL defaults");

  const tables = await pool.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('app_state', 'app_private_data') ORDER BY tablename"
  );
  assert(tables.rows.map((row) => row.tablename).join(",") === "app_private_data,app_state", "required PostgreSQL tables were not created");

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

  console.log(`PostgreSQL state check passed for APP_STATE_ID=${appStateId}.`);
} catch (error) {
  console.error(error.message || error);
  process.exitCode = 1;
} finally {
  await cleanupCheckRows().catch(() => {});
  await pool.end().catch(() => {});
  await tokenStorage?.end().catch(() => {});
  await legacyTokenStorage?.end().catch(() => {});
  await rm(legacyTokenFile, { force: true }).catch(() => {});
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill("SIGTERM");
    await once(serverProcess, "exit").catch(() => {});
  }
}

async function cleanupCheckRows() {
  await pool.query("DELETE FROM app_private_data WHERE id = ANY($1)", [[appStateId, tokenStateId, legacyTokenStateId]]);
  await pool.query("DELETE FROM app_state WHERE id = $1", [appStateId]);
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
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null) {
      const stderr = serverStderr.trim();
      throw new Error(`server exited before health check passed, exitCode=${serverProcess.exitCode}${stderr ? `, stderr=${stderr}` : ""}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("server health check timed out");
}

async function fetchJson(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `${path} failed with ${response.status}`);
  return payload;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
