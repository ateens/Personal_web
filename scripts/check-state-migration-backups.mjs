import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import pg from "pg";
import { createStorage } from "../server/storage.js";

const { Pool } = pg;
class CheckError extends Error {}

const databaseUrl = String(process.env.DATABASE_URL || "").trim();
if (!databaseUrl) {
  process.stderr.write("Migration backup check requires DATABASE_URL.\n");
  process.exit(1);
}

const suffix = randomBytes(8).toString("hex");
const appStateId = `migration-backup-check-${suffix}`;
const sentinelStateId = `migration-backup-sentinel-${suffix}`;
const marker = `legacy-marker-${suffix}`;
const stateIds = [appStateId, sentinelStateId];
const pool = new Pool({ connectionString: databaseUrl, ssl: databaseSslConfig() });
let storage = createStorage({ databaseUrl, appStateId });

try {
  await storage.ready();
  await cleanupCheckRows();

  const legacyState = legacyV3State(marker);
  const sentinelState = unrelatedSentinelState(suffix);
  await pool.query(
    `
      INSERT INTO app_state (id, state, revision, updated_at)
      VALUES ($1, $2::jsonb, 7, now()), ($3, $4::jsonb, 41, now())
    `,
    [appStateId, JSON.stringify(legacyState), sentinelStateId, JSON.stringify(sentinelState)]
  );
  await pool.query(
    "INSERT INTO app_private_data (id, key, data) VALUES ($1, 'sentinel', $2::jsonb)",
    [sentinelStateId, JSON.stringify({ marker: `private-${suffix}` })]
  );
  const sentinelBefore = await sentinelFingerprint();

  const migrated = await storage.readAppState();
  check(migrated.revision === 7, "automatic migration changed the workspace revision");
  check(migrated.state?.version === 4, "legacy v3 state did not migrate to v4");
  check(!Object.hasOwn(migrated.state?.settings || {}, "appMode"), "legacy appMode survived v4 migration");
  check(!Object.hasOwn(migrated.state?.tasks?.[0] || {}, "kind"), "legacy task kind survived v4 migration");

  const reread = await storage.readAppState();
  check(reread.state?.version === 4 && reread.revision === 7, "migrated state was not stable on a second read");
  const thirdRead = await storage.readAppState();
  check(thirdRead.state?.version === 4 && thirdRead.revision === 7, "migrated state was not stable on a third read");

  const automaticBackups = await storage.listMigrationBackups({ limit: 10 });
  check(
    automaticBackups.length === 1,
    `automatic migration did not create exactly one backup (count=${automaticBackups.length}, reasons=${automaticBackups.map((backup) => backup.reason).join(",")})`
  );
  const migrationBackup = automaticBackups[0];
  check(migrationBackup.sourceVersion === 3, "migration backup did not record source version 3");
  check(migrationBackup.sourceRevision === 7, "migration backup did not record source revision 7");
  check(migrationBackup.reason === "automatic_version_migration_v3_to_v4", "migration backup reason was not version-specific");

  const rawBackup = await pool.query(
    "SELECT state, state_sha256 FROM app_state_migration_backups WHERE id = $1 AND app_state_id = $2",
    [migrationBackup.id, appStateId]
  );
  check(rawBackup.rowCount === 1, "migration backup row is missing");
  check(rawBackup.rows[0].state?.version === 3, "migration backup did not preserve the v3 root");
  check(rawBackup.rows[0].state?.marker === marker, "migration backup did not preserve the legacy marker");
  check(rawBackup.rows[0].state?.settings?.appMode === "personal", "migration backup did not preserve legacy settings");
  check(rawBackup.rows[0].state?.tasks?.[0]?.kind === "task", "migration backup did not preserve legacy collection fields");
  check(/^[a-f0-9]{64}$/.test(rawBackup.rows[0].state_sha256 || ""), "migration backup integrity digest is invalid");

  await storage.end();
  storage = null;

  const createResult = await runCli(["create", "--reason", "isolated_check"]);
  check(createResult.code === 0, "CLI create command failed");
  check(!createResult.stdout.includes(marker), "CLI create output exposed state content");
  const createdPayload = parseJson(createResult.stdout, "CLI create output was not JSON");
  check(createdPayload.backup?.reason === "manual:isolated_check", "CLI create reason was not recorded");

  const listResult = await runCli(["list", "--limit", "10"]);
  check(listResult.code === 0, "CLI list command failed");
  check(!listResult.stdout.includes(marker), "CLI list output exposed state content");
  check(!listResult.stdout.includes('"state"'), "CLI list output included a state payload");
  const listPayload = parseJson(listResult.stdout, "CLI list output was not JSON");
  check(listPayload.count === 2, "CLI list did not return the automatic and manual backups");

  const missingConfirmation = await runCli([
    "restore",
    migrationBackup.id,
    "--expected-revision",
    "7",
  ]);
  check(missingConfirmation.code !== 0, "CLI restore accepted missing workspace confirmation");
  check(parseJson(missingConfirmation.stderr, "missing-confirmation error was not JSON").code === "CONFIRMATION_REQUIRED", "CLI restore returned the wrong missing-confirmation error");

  const missingRevision = await runCli([
    "restore",
    migrationBackup.id,
    "--confirm",
    appStateId,
  ]);
  check(missingRevision.code !== 0, "CLI restore accepted a missing revision precondition");
  check(parseJson(missingRevision.stderr, "missing-revision error was not JSON").code === "STATE_PRECONDITION_REQUIRED", "CLI restore returned the wrong missing-revision error");

  const missingRevisionValue = await runCli([
    "restore",
    migrationBackup.id,
    "--expected-revision",
    "--confirm",
    appStateId,
  ]);
  check(missingRevisionValue.code !== 0, "CLI restore accepted an expected-revision flag without a value");
  check(parseJson(missingRevisionValue.stderr, "missing-revision-value error was not JSON").code === "INVALID_BASE_REVISION", "CLI restore returned the wrong missing-revision-value error");

  const staleRestore = await runCli([
    "restore",
    migrationBackup.id,
    "--expected-revision",
    "6",
    "--confirm",
    appStateId,
  ]);
  check(staleRestore.code !== 0, "CLI restore accepted a stale revision");
  const stalePayload = parseJson(staleRestore.stderr, "stale-revision error was not JSON");
  check(stalePayload.code === "STATE_REVISION_CONFLICT" && stalePayload.currentRevision === 7, "CLI restore did not report the current revision after a conflict");

  const restoreResult = await runCli([
    "restore",
    migrationBackup.id,
    "--expected-revision",
    "7",
    "--confirm",
    appStateId,
  ]);
  check(restoreResult.code === 0, "CLI restore command failed");
  check(!restoreResult.stdout.includes(marker), "CLI restore output exposed state content");
  const restorePayload = parseJson(restoreResult.stdout, "CLI restore output was not JSON");
  check(restorePayload.previousRevision === 7 && restorePayload.restoredRevision === 8, "CLI restore did not advance the revision monotonically");
  check(typeof restorePayload.safetyBackupId === "string" && restorePayload.safetyBackupId, "CLI restore did not create a safety backup");

  const restored = await pool.query("SELECT state, revision FROM app_state WHERE id = $1", [appStateId]);
  check(restored.rowCount === 1, "restored workspace row is missing");
  check(Number(restored.rows[0].revision) === 8 && restored.rows[0].state?.revision === 8, "restored workspace revision is inconsistent");
  check(restored.rows[0].state?.version === 3, "restore did not recover the legacy version");
  check(restored.rows[0].state?.marker === marker, "restore did not recover legacy content");
  check(restored.rows[0].state?.settings?.appMode === "personal", "restore did not recover legacy settings");
  check(restored.rows[0].state?.tasks?.[0]?.kind === "task", "restore did not recover legacy collection fields");

  const restoredRelational = await pool.query(
    `
      SELECT
        (SELECT count(*)::int FROM tasks WHERE app_state_id = $1) AS tasks,
        (SELECT count(*)::int FROM resources WHERE app_state_id = $1) AS resources,
        (SELECT data->>'kind' FROM tasks WHERE app_state_id = $1 AND id = 'legacy-task') AS task_kind
    `,
    [appStateId]
  );
  check(restoredRelational.rows[0]?.tasks === 1 && restoredRelational.rows[0]?.resources === 1, "restore did not rebuild the target relational rows");
  check(restoredRelational.rows[0]?.task_kind === "task", "restore did not preserve legacy relational data");

  const backupSummary = await pool.query(
    `
      SELECT
        count(*)::int AS backups,
        count(*) FILTER (WHERE reason LIKE 'pre_restore:%')::int AS safety_backups,
        (SELECT count(*)::int FROM app_state_restore_history WHERE app_state_id = $1) AS restores
      FROM app_state_migration_backups
      WHERE app_state_id = $1
    `,
    [appStateId]
  );
  check(backupSummary.rows[0]?.backups === 3, "restore did not retain automatic, manual, and safety backups");
  check(backupSummary.rows[0]?.safety_backups === 1 && backupSummary.rows[0]?.restores === 1, "restore history or safety backup is missing");

  const sentinelAfter = await sentinelFingerprint();
  check(JSON.stringify(sentinelAfter) === JSON.stringify(sentinelBefore), "backup/restore touched an unrelated sentinel workspace");

  storage = createStorage({ databaseUrl, appStateId });
  const finalMetadata = await storage.listMigrationBackups({ limit: 10 });
  const restoredBackup = finalMetadata.find((backup) => backup.id === migrationBackup.id);
  check(restoredBackup?.restoredCount === 1 && restoredBackup.lastRestoredAt, "backup metadata did not expose restore history");

  await storage.end();
  storage = null;
  await cleanupCheckRows();
  const leftovers = await pool.query(
    `
      SELECT
        (SELECT count(*)::int FROM app_state WHERE id = ANY($1)) AS states,
        (SELECT count(*)::int FROM app_private_data WHERE id = ANY($1)) AS private_rows,
        (SELECT count(*)::int FROM app_state_migration_backups WHERE app_state_id = ANY($1)) AS backups,
        (SELECT count(*)::int FROM app_state_restore_history WHERE app_state_id = ANY($1)) AS restores,
        (SELECT count(*)::int FROM tasks WHERE app_state_id = ANY($1)) AS tasks,
        (SELECT count(*)::int FROM resources WHERE app_state_id = ANY($1)) AS resources
    `,
    [stateIds]
  );
  check(Object.values(leftovers.rows[0] || {}).every((count) => count === 0), "isolated migration backup check left test rows behind");

  process.stdout.write(`Migration backup check passed for isolated APP_STATE_ID=${appStateId}.\n`);
} catch (error) {
  const message = error instanceof CheckError ? error.message : "unexpected backend error";
  process.stderr.write(`Migration backup check failed: ${message}.\n`);
  process.exitCode = 1;
} finally {
  await storage?.end().catch(() => {});
  await cleanupCheckRows().catch(() => {});
  await pool.end().catch(() => {});
}

function check(condition, message) {
  if (!condition) throw new CheckError(message);
}

function parseJson(value, message) {
  try {
    return JSON.parse(value);
  } catch {
    throw new CheckError(message);
  }
}

function runCli(argumentsList) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/manage-state-backups.mjs", ...argumentsList], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: databaseUrl, APP_STATE_ID: appStateId },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function sentinelFingerprint() {
  const result = await pool.query(
    `
      SELECT
        state::text AS state_text,
        revision::text,
        updated_at::text,
        (SELECT data::text FROM app_private_data WHERE id = $1 AND key = 'sentinel') AS private_text
      FROM app_state
      WHERE id = $1
    `,
    [sentinelStateId]
  );
  return result.rows[0] || null;
}

async function cleanupCheckRows() {
  await pool.query("DELETE FROM app_state_restore_history WHERE app_state_id = ANY($1)", [stateIds]);
  await pool.query("DELETE FROM app_state_migration_backups WHERE app_state_id = ANY($1)", [stateIds]);
  await pool.query("DELETE FROM app_private_data WHERE id = ANY($1)", [stateIds]);
  await pool.query("DELETE FROM app_state WHERE id = ANY($1)", [stateIds]);
}

function legacyV3State(legacyMarker) {
  return {
    version: 3,
    revision: 7,
    marker: legacyMarker,
    createdAt: "2026-01-02T03:04:05.000Z",
    updatedAt: "2026-02-03T04:05:06.000Z",
    settings: {
      appMode: "personal",
      navOrder: ["resources", "tasks"],
      calendarSources: { tasks: true },
    },
    captures: [],
    boxes: [],
    goals: [],
    projects: [],
    tasks: [{ id: "legacy-task", kind: "task", title: "Legacy task", resourceId: "legacy-resource" }],
    resources: [{ id: "legacy-resource", title: "Legacy resource", type: "Note", blocks: [] }],
    habits: [],
    habitInstances: [],
    journals: [{ id: "legacy-journal", kind: "journal", title: "Legacy journal", date: "2026-01-02" }],
    googleCalendars: [],
    googleEvents: [],
    links: [],
  };
}

function unrelatedSentinelState(value) {
  return {
    version: 4,
    revision: 41,
    marker: `unrelated-${value}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    settings: {},
    captures: [], boxes: [], goals: [], projects: [], tasks: [], resources: [], habits: [], habitInstances: [], journals: [], googleCalendars: [], googleEvents: [], links: [],
  };
}

function databaseSslConfig() {
  const mode = String(process.env.PGSSLMODE || process.env.DATABASE_SSL || "").toLowerCase();
  if (["require", "no-verify"].includes(mode)) return { rejectUnauthorized: false };
  if (["verify-ca", "verify-full"].includes(mode)) return true;
  return undefined;
}
