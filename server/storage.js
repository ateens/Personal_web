import { readFile, unlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";

const { Pool } = pg;
const STATE_VERSION = 4;
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
const STRING_SETTING_KEYS = ["googleCalendarId", "googleConnectedAt", "lastGoogleFetchAt", "lastGoogleSyncAt"];
const LEGACY_KIND_COLLECTION_KEYS = new Set(["tasks", "journals"]);
const DEFAULT_NAV_ORDER = ["today", "inbox", "tasks", "projects", "goals", "boxes", "resources", "habits", "journal", "calendar", "database"];
const NAV_KEY_SET = new Set(DEFAULT_NAV_ORDER);
const DEFAULT_CALENDAR_SOURCES = {
  tasks: true,
  projects: true,
  google: true,
};
const CALENDAR_SOURCE_KEYS = Object.keys(DEFAULT_CALENDAR_SOURCES);
const CALENDAR_SOURCE_KEY_SET = new Set(CALENDAR_SOURCE_KEYS);
const DEFAULT_VIEW_CONTROLS = {
  today: { filters: ["all"], sort: "date", mode: "overview", panels: { filter: false, sort: false } },
  inbox: { filters: ["all"], sort: "recent", mode: "board", panels: { filter: false, sort: false } },
  tasks: { filters: ["all"], sort: "date", mode: "board", panels: { filter: false, sort: false } },
  projects: { filters: ["all"], sort: "status", mode: "board", panels: { filter: false, sort: false } },
  goals: { filters: ["all"], sort: "target", mode: "cards", panels: { filter: false, sort: false } },
  boxes: { filters: ["all"], sort: "activity", mode: "columns", panels: { filter: false, sort: false } },
  resources: { search: "", searchScope: "fullText", filters: ["active"], sort: "updated", mode: "library", panels: { filter: false, sort: false } },
  habits: { filters: ["all"], sort: "progress", mode: "list", panels: { filter: false, sort: false } },
  journal: { filters: ["all"], sort: "date", mode: "cards", panels: { filter: false, sort: false } },
  calendar: { filters: ["all"], sort: "time", mode: "calendar", panels: { filter: false, sort: false } },
  database: { filters: ["all"], sort: "rows", mode: "grid", panels: { filter: false, sort: false } },
};
const RESOURCE_SEARCH_SCOPES = new Set(["database", "fullText"]);
const RESOURCE_OPEN_PAGE_MODES = new Set(["center", "side", "full"]);
const DEFAULT_RESOURCE_OPEN_PAGES_IN = {
  library: "center",
  list: "side",
  map: "center",
};
const RELATIONAL_DELETE_ORDER = [
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
const RELATIONAL_TABLES = [
  "boxes",
  "goals",
  "projects",
  "tasks",
  "resources",
  "task_resources",
  "habits",
  "habit_instances",
  "captures",
  "journals",
  "google_calendars",
  "google_events",
  "collection_links",
];

export function createStorage({ databaseUrl = "", appStateId = "default", googleTokenFile = "" } = {}) {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for PostgreSQL persistence.");
  }

  const dbPool = new Pool({
    connectionString: databaseUrl,
    ssl: databaseSslConfig(),
  });
  let appStateTableReady = null;
  let appStateBackupTablesReady = null;
  let appPrivateDataTableReady = null;
  let oauthTransactionsTableReady = null;
  let relationalTablesReady = null;

  async function ensureAppStateTable() {
    appStateTableReady ||= dbPool.query(`
      CREATE TABLE IF NOT EXISTS app_state (
        id text PRIMARY KEY,
        state jsonb NOT NULL,
        revision bigint NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      ALTER TABLE app_state ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 0
    `);
    await appStateTableReady;
  }

  async function ensureAppStateBackupTables() {
    await ensureAppStateTable();
    appStateBackupTablesReady ||= dbPool.query(`
      CREATE TABLE IF NOT EXISTS app_state_migration_backups (
        id text PRIMARY KEY,
        app_state_id text NOT NULL,
        source_revision bigint NOT NULL,
        source_version integer,
        reason text NOT NULL,
        state jsonb NOT NULL,
        state_sha256 text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS app_state_migration_backups_workspace_created_idx
        ON app_state_migration_backups(app_state_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS app_state_restore_history (
        id text PRIMARY KEY,
        app_state_id text NOT NULL,
        backup_id text NOT NULL REFERENCES app_state_migration_backups(id) ON DELETE RESTRICT,
        safety_backup_id text NOT NULL REFERENCES app_state_migration_backups(id) ON DELETE RESTRICT,
        previous_revision bigint NOT NULL,
        restored_revision bigint NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS app_state_restore_history_workspace_created_idx
        ON app_state_restore_history(app_state_id, created_at DESC)
    `);
    await appStateBackupTablesReady;
  }

  async function ensureAppPrivateDataTable() {
    appPrivateDataTableReady ||= dbPool.query(`
      CREATE TABLE IF NOT EXISTS app_private_data (
        id text NOT NULL,
        key text NOT NULL,
        data jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (id, key)
      )
    `);
    await appPrivateDataTableReady;
  }

  async function ensureOAuthTransactionsTable() {
    oauthTransactionsTableReady ||= dbPool.query(`
      CREATE TABLE IF NOT EXISTS app_oauth_transactions (
        app_state_id text NOT NULL,
        kind text NOT NULL,
        nonce text NOT NULL,
        data jsonb NOT NULL,
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (app_state_id, kind, nonce)
      );

      CREATE INDEX IF NOT EXISTS app_oauth_transactions_expiry_idx
        ON app_oauth_transactions(app_state_id, expires_at)
    `);
    await oauthTransactionsTableReady;
  }

  async function ensureRelationalTables() {
    relationalTablesReady ||= dbPool.query(`
      CREATE TABLE IF NOT EXISTS boxes (
        app_state_id text NOT NULL REFERENCES app_state(id) ON DELETE CASCADE,
        id text NOT NULL,
        name text NOT NULL DEFAULT '',
        visibility text NOT NULL DEFAULT 'normal',
        color text NOT NULL DEFAULT '',
        position integer NOT NULL DEFAULT 0,
        data jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (app_state_id, id)
      );

      CREATE TABLE IF NOT EXISTS goals (
        app_state_id text NOT NULL REFERENCES app_state(id) ON DELETE CASCADE,
        id text NOT NULL,
        box_id text,
        name text NOT NULL DEFAULT '',
        status text NOT NULL DEFAULT '',
        year text NOT NULL DEFAULT '',
        quarter text NOT NULL DEFAULT '',
        target_date date,
        position integer NOT NULL DEFAULT 0,
        data jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (app_state_id, id),
        FOREIGN KEY (app_state_id, box_id) REFERENCES boxes(app_state_id, id) DEFERRABLE INITIALLY DEFERRED
      );

      CREATE TABLE IF NOT EXISTS projects (
        app_state_id text NOT NULL REFERENCES app_state(id) ON DELETE CASCADE,
        id text NOT NULL,
        box_id text,
        goal_id text,
        name text NOT NULL DEFAULT '',
        status text NOT NULL DEFAULT '',
        start_date date,
        end_date date,
        position integer NOT NULL DEFAULT 0,
        data jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (app_state_id, id),
        FOREIGN KEY (app_state_id, box_id) REFERENCES boxes(app_state_id, id) DEFERRABLE INITIALLY DEFERRED,
        FOREIGN KEY (app_state_id, goal_id) REFERENCES goals(app_state_id, id) DEFERRABLE INITIALLY DEFERRED
      );

      CREATE TABLE IF NOT EXISTS tasks (
        app_state_id text NOT NULL REFERENCES app_state(id) ON DELETE CASCADE,
        id text NOT NULL,
        box_id text,
        goal_id text,
        project_id text,
        title text NOT NULL DEFAULT '',
        status text NOT NULL DEFAULT '',
        due_date date,
        scheduled_start timestamptz,
        scheduled_end timestamptz,
        completed_at timestamptz,
        estimated_minutes integer,
        actual_minutes integer,
        google_event_id text NOT NULL DEFAULT '',
        position integer NOT NULL DEFAULT 0,
        data jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (app_state_id, id),
        FOREIGN KEY (app_state_id, box_id) REFERENCES boxes(app_state_id, id) DEFERRABLE INITIALLY DEFERRED,
        FOREIGN KEY (app_state_id, goal_id) REFERENCES goals(app_state_id, id) DEFERRABLE INITIALLY DEFERRED,
        FOREIGN KEY (app_state_id, project_id) REFERENCES projects(app_state_id, id) DEFERRABLE INITIALLY DEFERRED
      );

      CREATE TABLE IF NOT EXISTS resources (
        app_state_id text NOT NULL REFERENCES app_state(id) ON DELETE CASCADE,
        id text NOT NULL,
        box_id text,
        goal_id text,
        project_id text,
        title text NOT NULL DEFAULT '',
        type text NOT NULL DEFAULT '',
        importance text NOT NULL DEFAULT '',
        pinned boolean NOT NULL DEFAULT false,
        read_later boolean NOT NULL DEFAULT false,
        url text NOT NULL DEFAULT '',
        position integer NOT NULL DEFAULT 0,
        data jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (app_state_id, id),
        FOREIGN KEY (app_state_id, box_id) REFERENCES boxes(app_state_id, id) DEFERRABLE INITIALLY DEFERRED,
        FOREIGN KEY (app_state_id, goal_id) REFERENCES goals(app_state_id, id) DEFERRABLE INITIALLY DEFERRED,
        FOREIGN KEY (app_state_id, project_id) REFERENCES projects(app_state_id, id) DEFERRABLE INITIALLY DEFERRED
      );

      CREATE TABLE IF NOT EXISTS task_resources (
        app_state_id text NOT NULL REFERENCES app_state(id) ON DELETE CASCADE,
        task_id text NOT NULL,
        resource_id text NOT NULL,
        relation text NOT NULL DEFAULT 'related',
        data jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (app_state_id, task_id, resource_id),
        FOREIGN KEY (app_state_id, task_id) REFERENCES tasks(app_state_id, id) DEFERRABLE INITIALLY DEFERRED,
        FOREIGN KEY (app_state_id, resource_id) REFERENCES resources(app_state_id, id) DEFERRABLE INITIALLY DEFERRED
      );

      CREATE TABLE IF NOT EXISTS habits (
        app_state_id text NOT NULL REFERENCES app_state(id) ON DELETE CASCADE,
        id text NOT NULL,
        box_id text,
        project_id text,
        title text NOT NULL DEFAULT '',
        cadence text NOT NULL DEFAULT '',
        status text NOT NULL DEFAULT '',
        target text NOT NULL DEFAULT '',
        position integer NOT NULL DEFAULT 0,
        data jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (app_state_id, id),
        FOREIGN KEY (app_state_id, box_id) REFERENCES boxes(app_state_id, id) DEFERRABLE INITIALLY DEFERRED,
        FOREIGN KEY (app_state_id, project_id) REFERENCES projects(app_state_id, id) DEFERRABLE INITIALLY DEFERRED
      );

      CREATE TABLE IF NOT EXISTS habit_instances (
        app_state_id text NOT NULL REFERENCES app_state(id) ON DELETE CASCADE,
        id text NOT NULL,
        habit_id text,
        date date,
        completed boolean NOT NULL DEFAULT false,
        completed_at timestamptz,
        position integer NOT NULL DEFAULT 0,
        data jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (app_state_id, id),
        FOREIGN KEY (app_state_id, habit_id) REFERENCES habits(app_state_id, id) DEFERRABLE INITIALLY DEFERRED
      );

      CREATE TABLE IF NOT EXISTS captures (
        app_state_id text NOT NULL REFERENCES app_state(id) ON DELETE CASCADE,
        id text NOT NULL,
        title text NOT NULL DEFAULT '',
        url text NOT NULL DEFAULT '',
        status text NOT NULL DEFAULT '',
        converted_to text NOT NULL DEFAULT '',
        converted_id text NOT NULL DEFAULT '',
        captured_at timestamptz,
        processed_at timestamptz,
        position integer NOT NULL DEFAULT 0,
        data jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (app_state_id, id)
      );

      CREATE TABLE IF NOT EXISTS journals (
        app_state_id text NOT NULL REFERENCES app_state(id) ON DELETE CASCADE,
        id text NOT NULL,
        title text NOT NULL DEFAULT '',
        date date,
        satisfaction integer,
        position integer NOT NULL DEFAULT 0,
        data jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (app_state_id, id)
      );

      CREATE TABLE IF NOT EXISTS google_calendars (
        app_state_id text NOT NULL REFERENCES app_state(id) ON DELETE CASCADE,
        id text NOT NULL,
        summary text NOT NULL DEFAULT '',
        position integer NOT NULL DEFAULT 0,
        data jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (app_state_id, id)
      );

      CREATE TABLE IF NOT EXISTS google_events (
        app_state_id text NOT NULL REFERENCES app_state(id) ON DELETE CASCADE,
        id text NOT NULL,
        calendar_id text,
        calendar_summary text NOT NULL DEFAULT '',
        source text NOT NULL DEFAULT '',
        title text NOT NULL DEFAULT '',
        start_time timestamptz,
        end_time timestamptz,
        start_date date,
        end_date date,
        all_day boolean NOT NULL DEFAULT false,
        html_link text NOT NULL DEFAULT '',
        status text NOT NULL DEFAULT '',
        event_updated_at timestamptz,
        position integer NOT NULL DEFAULT 0,
        data jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (app_state_id, id),
        FOREIGN KEY (app_state_id, calendar_id) REFERENCES google_calendars(app_state_id, id) DEFERRABLE INITIALLY DEFERRED
      );

      CREATE TABLE IF NOT EXISTS collection_links (
        app_state_id text NOT NULL REFERENCES app_state(id) ON DELETE CASCADE,
        id text NOT NULL,
        from_type text NOT NULL DEFAULT '',
        from_id text NOT NULL DEFAULT '',
        to_type text NOT NULL DEFAULT '',
        to_id text NOT NULL DEFAULT '',
        relation text NOT NULL DEFAULT 'related',
        position integer NOT NULL DEFAULT 0,
        data jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (app_state_id, id)
      );

      CREATE INDEX IF NOT EXISTS goals_app_box_idx ON goals(app_state_id, box_id);
      CREATE INDEX IF NOT EXISTS projects_app_goal_idx ON projects(app_state_id, goal_id);
      CREATE INDEX IF NOT EXISTS projects_app_box_idx ON projects(app_state_id, box_id);
      CREATE INDEX IF NOT EXISTS tasks_app_goal_idx ON tasks(app_state_id, goal_id);
      CREATE INDEX IF NOT EXISTS tasks_app_box_idx ON tasks(app_state_id, box_id);
      CREATE INDEX IF NOT EXISTS tasks_app_project_idx ON tasks(app_state_id, project_id);
      CREATE INDEX IF NOT EXISTS tasks_app_due_date_idx ON tasks(app_state_id, due_date);
      CREATE INDEX IF NOT EXISTS resources_app_goal_idx ON resources(app_state_id, goal_id);
      CREATE INDEX IF NOT EXISTS resources_app_box_idx ON resources(app_state_id, box_id);
      CREATE INDEX IF NOT EXISTS resources_app_project_idx ON resources(app_state_id, project_id);
      CREATE INDEX IF NOT EXISTS task_resources_app_resource_idx ON task_resources(app_state_id, resource_id);
      CREATE INDEX IF NOT EXISTS habits_app_project_idx ON habits(app_state_id, project_id);
      CREATE INDEX IF NOT EXISTS habit_instances_app_habit_date_idx ON habit_instances(app_state_id, habit_id, date);
      CREATE INDEX IF NOT EXISTS collection_links_app_from_idx ON collection_links(app_state_id, from_type, from_id);
      CREATE INDEX IF NOT EXISTS collection_links_app_to_idx ON collection_links(app_state_id, to_type, to_id);
      CREATE INDEX IF NOT EXISTS google_events_app_calendar_idx ON google_events(app_state_id, calendar_id);
    `);
    await relationalTablesReady;
  }

  async function ready() {
    await ensureAppStateTable();
    await ensureAppStateBackupTables();
    await ensureAppPrivateDataTable();
    await ensureOAuthTransactionsTable();
    await ensureRelationalTables();
  }

  async function authoritativeStateSnapshot(client, storedState) {
    const hasRelationalRows = await relationalStateHasRows(client);
    if (!hasRelationalRows) {
      return { state: cloneJsonValue(storedState), hasRelationalRows: false };
    }
    const baseState = isPlainObject(storedState) ? cloneJsonValue(storedState) : {};
    return {
      state: await readRelationalAppState(client, baseState, { normalize: false }),
      hasRelationalRows: true,
    };
  }

  async function insertMigrationBackup(client, state, sourceRevision, reason) {
    const backupState = cloneJsonValue(state);
    const id = randomUUID();
    const safeReason = migrationBackupReason(reason);
    const sourceVersion = stateVersion(backupState);
    const stateSha256 = jsonSha256(backupState);
    const result = await client.query(
      `
        INSERT INTO app_state_migration_backups (
          id, app_state_id, source_revision, source_version, reason, state, state_sha256
        ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
        RETURNING id, app_state_id, source_revision, source_version, reason, state_sha256, created_at
      `,
      [id, appStateId, nonNegativeRevision(sourceRevision, 0), sourceVersion, safeReason, JSON.stringify(backupState), stateSha256]
    );
    return migrationBackupMetadata(result.rows[0]);
  }

  async function createMigrationBackup({ reason = "manual" } = {}) {
    await ensureAppStateBackupTables();
    await ensureRelationalTables();
    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query("SELECT state, revision FROM app_state WHERE id = $1 FOR UPDATE", [appStateId]);
      const row = result.rows[0];
      if (!row) {
        throw storageError(404, "STATE_NOT_INITIALIZED", "Application state is not initialized.");
      }
      const authoritative = await authoritativeStateSnapshot(client, row.state);
      const backup = await insertMigrationBackup(client, authoritative.state, row.revision, `manual:${manualBackupLabel(reason)}`);
      await client.query("COMMIT");
      return backup;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async function listMigrationBackups({ limit = 20 } = {}) {
    await ensureAppStateBackupTables();
    const safeLimit = boundedInteger(limit, 1, 100, 20);
    const result = await dbPool.query(
      `
        SELECT
          backup.id,
          backup.app_state_id,
          backup.source_revision,
          backup.source_version,
          backup.reason,
          backup.state_sha256,
          backup.created_at,
          count(history.id)::int AS restored_count,
          max(history.created_at) AS last_restored_at
        FROM app_state_migration_backups AS backup
        LEFT JOIN app_state_restore_history AS history
          ON history.backup_id = backup.id AND history.app_state_id = backup.app_state_id
        WHERE backup.app_state_id = $1
        GROUP BY backup.id
        ORDER BY backup.created_at DESC, backup.id DESC
        LIMIT $2
      `,
      [appStateId, safeLimit]
    );
    return result.rows.map(migrationBackupMetadata);
  }

  async function restoreMigrationBackup(backupId, { expectedRevision } = {}) {
    await ensureAppStateBackupTables();
    await ensureRelationalTables();
    const requestedRevision = optionalRevision(expectedRevision);
    if (requestedRevision === null) {
      throw storageError(428, "STATE_PRECONDITION_REQUIRED", "An expected revision is required to restore a backup.");
    }
    if (typeof backupId !== "string" || !backupId.trim()) {
      throw storageError(400, "INVALID_BACKUP_ID", "A backup ID is required.");
    }

    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      const currentResult = await client.query("SELECT state, revision FROM app_state WHERE id = $1 FOR UPDATE", [appStateId]);
      const currentRow = currentResult.rows[0];
      if (!currentRow) {
        throw storageError(404, "STATE_NOT_INITIALIZED", "Application state is not initialized.");
      }
      const currentRevision = nonNegativeRevision(currentRow.revision, 0);
      if (requestedRevision !== currentRevision) {
        throw storageError(409, "STATE_REVISION_CONFLICT", "State revision conflict.", { revision: currentRevision });
      }

      const backupResult = await client.query(
        `
          SELECT id, app_state_id, source_revision, source_version, reason, state, state_sha256, created_at
          FROM app_state_migration_backups
          WHERE id = $1 AND app_state_id = $2
        `,
        [backupId.trim(), appStateId]
      );
      const backupRow = backupResult.rows[0];
      if (!backupRow) {
        throw storageError(404, "BACKUP_NOT_FOUND", "The backup was not found for this workspace.");
      }
      if (!isPlainObject(backupRow.state)) {
        throw storageError(422, "BACKUP_NOT_RESTORABLE", "Only object application-state backups can be restored.");
      }
      if (jsonSha256(backupRow.state) !== backupRow.state_sha256) {
        throw storageError(422, "BACKUP_INTEGRITY_FAILED", "The backup failed its integrity check.");
      }

      const currentAuthoritative = await authoritativeStateSnapshot(client, currentRow.state);
      const safetyBackup = await insertMigrationBackup(client, currentAuthoritative.state, currentRevision, `pre_restore:${backupRow.id}`);
      const restoredRevision = currentRevision + 1;
      const restoredState = cloneJsonValue(backupRow.state);
      restoredState.revision = restoredRevision;
      restoredState.updatedAt = new Date().toISOString();

      await syncRelationalState(client, restoredState);
      await client.query(
        "UPDATE app_state SET state = $2::jsonb, revision = $3, updated_at = now() WHERE id = $1",
        [appStateId, JSON.stringify(restoredState), restoredRevision]
      );
      const historyId = randomUUID();
      const history = await client.query(
        `
          INSERT INTO app_state_restore_history (
            id, app_state_id, backup_id, safety_backup_id, previous_revision, restored_revision
          ) VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id, created_at
        `,
        [historyId, appStateId, backupRow.id, safetyBackup.id, currentRevision, restoredRevision]
      );
      await client.query("COMMIT");
      return {
        backup: migrationBackupMetadata(backupRow),
        safetyBackup,
        restoreId: history.rows[0]?.id || historyId,
        previousRevision: currentRevision,
        restoredRevision,
        restoredAt: history.rows[0]?.created_at?.toISOString?.() || "",
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async function readAppState() {
    await ensureAppStateTable();
    await ensureAppStateBackupTables();
    await ensureRelationalTables();
    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query("SELECT state, revision, updated_at FROM app_state WHERE id = $1 FOR UPDATE", [appStateId]);
      const row = result.rows[0];
      if (!row) {
        await client.query("COMMIT");
        return { state: null, revision: 0, updatedAt: "" };
      }
      const authoritative = await authoritativeStateSnapshot(client, row.state);
      const normalized = normalizeAppStateForStorage(cloneJsonValue(authoritative.state));
      const revision = positiveRevision(row.revision, 1);
      if (normalized.state.revision !== revision) {
        normalized.state.revision = revision;
        normalized.changed = true;
      }
      if (Number(row.revision) !== revision) normalized.changed = true;
      let updatedAt = row.updated_at?.toISOString?.() || "";
      const needsHealing = normalized.changed;
      if (normalized.changed) {
        const sourceVersion = stateVersion(authoritative.state);
        const reason = sourceVersion === STATE_VERSION
          ? "automatic_read_heal"
          : `automatic_version_migration_v${sourceVersion ?? "unknown"}_to_v${STATE_VERSION}`;
        await insertMigrationBackup(client, authoritative.state, row.revision, reason);
        if (authoritative.hasRelationalRows) {
          await syncRelationalState(client, normalized.state);
        }
      }
      if (!authoritative.hasRelationalRows) {
        await syncRelationalState(client, normalized.state);
      }
      const relationalState = await readRelationalAppState(client, normalized.state);
      if (needsHealing) {
        relationalState.revision = revision;
        const healed = await client.query(
          "UPDATE app_state SET state = $2::jsonb, revision = $3, updated_at = now() WHERE id = $1 RETURNING updated_at",
          [appStateId, JSON.stringify(relationalState), revision]
        );
        updatedAt = healed.rows[0]?.updated_at?.toISOString?.() || updatedAt;
      }
      await client.query("COMMIT");
      return { state: relationalState, revision, updatedAt };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async function writeAppState(state, options = {}) {
    await ensureAppStateTable();
    await ensureRelationalTables();
    const normalized = normalizeAppStateForStorage(state);
    const requestedBaseRevision = optionalRevision(options.baseRevision);
    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      const bootstrap = await client.query(
        `
          INSERT INTO app_state (id, state, revision, updated_at)
          VALUES ($1, '{}'::jsonb, 0, now())
          ON CONFLICT (id) DO NOTHING
          RETURNING id
        `,
        [appStateId]
      );
      const isBootstrap = bootstrap.rowCount === 1;
      const current = await client.query("SELECT state, revision FROM app_state WHERE id = $1 FOR UPDATE", [appStateId]);
      const currentRow = current.rows[0];
      const currentRevision = nonNegativeRevision(currentRow?.revision, 0);
      if (requestedBaseRevision !== null && requestedBaseRevision !== currentRevision) {
        throw storageError(409, "STATE_REVISION_CONFLICT", "State revision conflict.", { revision: currentRevision });
      }
      if (!isBootstrap && options.requirePrecondition === true && requestedBaseRevision === null) {
        throw storageError(428, "STATE_PRECONDITION_REQUIRED", "A state revision precondition is required.", { revision: currentRevision });
      }
      // The public full-state API opts into this guard. Trusted operator
      // restore/reset paths intentionally omit the option and retain their
      // ability to replace a workspace from a confirmed snapshot.
      if (!isBootstrap && options.rejectResourcePermanentDelete === true) {
        const authoritative = await authoritativeStateSnapshot(client, currentRow?.state);
        const missingResourceIds = omittedResourceIds(authoritative.state, normalized.state);
        if (missingResourceIds.length) {
          const visibleResourceIds = missingResourceIds.slice(0, 20);
          throw storageError(
            422,
            "RESOURCE_PERMANENT_DELETE_DISABLED",
            "Existing Resources must remain in full-state writes; move them to trash instead.",
            {
              revision: currentRevision,
              issues: [{
                path: "state.resources",
                code: "resource_permanent_delete_disabled",
                message: "Full-state writes may not omit existing Resource IDs.",
                missingResourceCount: missingResourceIds.length,
                missingResourceIds: visibleResourceIds,
                missingResourceIdsTruncated: visibleResourceIds.length < missingResourceIds.length,
              }],
            }
          );
        }
      }
      const revision = currentRevision + 1;
      normalized.state.revision = revision;
      normalized.state.updatedAt = new Date().toISOString();
      const result = await client.query(
        `
          INSERT INTO app_state (id, state, revision, updated_at)
          VALUES ($1, $2::jsonb, $3, now())
          ON CONFLICT (id)
          DO UPDATE SET state = EXCLUDED.state, revision = EXCLUDED.revision, updated_at = now()
          RETURNING revision, updated_at
        `,
        [appStateId, JSON.stringify(normalized.state), revision]
      );
      await syncRelationalState(client, normalized.state);
      const relationalState = await readRelationalAppState(client, normalized.state);
      relationalState.revision = revision;
      await client.query("UPDATE app_state SET state = $2::jsonb, revision = $3 WHERE id = $1", [appStateId, JSON.stringify(relationalState), revision]);
      await client.query("COMMIT");
      return {
        state: relationalState,
        revision,
        bootstrap: isBootstrap,
        updatedAt: result.rows[0]?.updated_at?.toISOString?.() || "",
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async function writeResource(resource, options = {}) {
    await ensureAppStateTable();
    await ensureAppStateBackupTables();
    await ensureRelationalTables();
    const requestedBaseRevision = optionalRevision(options.baseRevision);
    if (typeof options.validateState !== "function") {
      throw new Error("Resource state validation is unavailable.");
    }

    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query(
        "SELECT state, revision FROM app_state WHERE id = $1 FOR UPDATE",
        [appStateId]
      );
      const row = current.rows[0];
      if (!row) {
        throw storageError(404, "STATE_NOT_INITIALIZED", "Application state must be initialized before writing a Resource.");
      }

      const currentRevision = nonNegativeRevision(row.revision, 0);
      if (requestedBaseRevision !== null && requestedBaseRevision !== currentRevision) {
        throw storageError(409, "STATE_REVISION_CONFLICT", "State revision conflict.", { revision: currentRevision });
      }
      if (options.requirePrecondition === true && requestedBaseRevision === null) {
        throw storageError(428, "STATE_PRECONDITION_REQUIRED", "A state revision precondition is required.", { revision: currentRevision });
      }

      const authoritative = await authoritativeStateSnapshot(client, row.state);
      const normalized = normalizeAppStateForStorage(cloneJsonValue(authoritative.state));
      if (normalized.state.revision !== currentRevision) {
        normalized.state.revision = currentRevision;
        normalized.changed = true;
      }
      if (normalized.changed) {
        const sourceVersion = stateVersion(authoritative.state);
        const reason = sourceVersion === STATE_VERSION
          ? "automatic_read_heal_before_resource_write"
          : `automatic_version_migration_v${sourceVersion ?? "unknown"}_to_v${STATE_VERSION}_before_resource_write`;
        await insertMigrationBackup(client, authoritative.state, row.revision, reason);
        if (authoritative.hasRelationalRows) {
          await syncRelationalState(client, normalized.state);
        }
      }
      if (!authoritative.hasRelationalRows) {
        await syncRelationalState(client, normalized.state);
      }
      const currentState = await readRelationalAppState(client, normalized.state);
      currentState.revision = currentRevision;

      const resources = Array.isArray(currentState.resources) ? currentState.resources.slice() : [];
      const existingIndex = resources.findIndex((item) => item?.id === resource.id);
      const resourceIndex = existingIndex === -1 ? resources.length : existingIndex;
      const created = existingIndex === -1;
      if (created) resources.push(resource);
      else resources[existingIndex] = resource;

      const revision = currentRevision + 1;
      const nextState = {
        ...currentState,
        resources,
        revision,
        updatedAt: new Date().toISOString(),
      };

      // The validator runs after reconstructing the authoritative relational
      // workspace and before any Resource mutation reaches PostgreSQL. This
      // catches cross-collection IDs, relations, hierarchy cycles, URLs, and
      // block/comment constraints that cannot be checked on an isolated item.
      await options.validateState(nextState);

      await upsertResource(client, resource, resourceIndex, relationalIdSets(nextState));
      nextState.resources = await readResources(client);
      const savedResource = nextState.resources.find((item) => item.id === resource.id);
      const result = await client.query(
        "UPDATE app_state SET state = $2::jsonb, revision = $3, updated_at = now() WHERE id = $1 RETURNING updated_at",
        [appStateId, JSON.stringify(nextState), revision]
      );
      await client.query("COMMIT");
      return {
        resource: savedResource,
        revision,
        created,
        updatedAt: result.rows[0]?.updated_at?.toISOString?.() || "",
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async function stateStatus() {
    await ready();
    const result = await dbPool.query("SELECT revision, updated_at FROM app_state WHERE id = $1", [appStateId]);
    return {
      configured: true,
      connected: true,
      appStateId,
      hasState: Boolean(result.rows[0]),
      revision: nonNegativeRevision(result.rows[0]?.revision, 0),
      tokenStore: "postgresql",
      relationalStore: "postgresql",
      collectionSource: "relational",
      relationalTables: RELATIONAL_TABLES,
      updatedAt: result.rows[0]?.updated_at?.toISOString?.() || "",
    };
  }

  async function readPrivateData(key) {
    await ensureAppPrivateDataTable();
    const result = await dbPool.query("SELECT data, updated_at FROM app_private_data WHERE id = $1 AND key = $2", [appStateId, key]);
    return result.rows[0] ? { data: result.rows[0].data, updatedAt: result.rows[0].updated_at?.toISOString?.() || "" } : { data: null, updatedAt: "" };
  }

  async function writePrivateData(key, data) {
    await ensureAppPrivateDataTable();
    const result = await dbPool.query(
      `
        INSERT INTO app_private_data (id, key, data, updated_at)
        VALUES ($1, $2, $3::jsonb, now())
        ON CONFLICT (id, key)
        DO UPDATE SET data = EXCLUDED.data, updated_at = now()
        RETURNING updated_at
      `,
      [appStateId, key, JSON.stringify(data)]
    );
    return result.rows[0]?.updated_at?.toISOString?.() || "";
  }

  async function deletePrivateData(key) {
    await ensureAppPrivateDataTable();
    await dbPool.query("DELETE FROM app_private_data WHERE id = $1 AND key = $2", [appStateId, key]);
  }

  async function claimOAuthTransaction(kind, nonce, data, expiresAt) {
    await ensureOAuthTransactionsTable();
    const expiry = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
    if (!Number.isFinite(expiry.getTime())) throw new Error("Invalid OAuth transaction expiry.");
    const result = await dbPool.query(
      `
        WITH cleanup AS (
          DELETE FROM app_oauth_transactions
          WHERE app_state_id = $1 AND expires_at <= now()
        )
        INSERT INTO app_oauth_transactions (app_state_id, kind, nonce, data, expires_at)
        SELECT $1, $2, $3, $4::jsonb, $5::timestamptz
        WHERE $5::timestamptz > now()
        ON CONFLICT (app_state_id, kind, nonce) DO NOTHING
        RETURNING expires_at
      `,
      [appStateId, kind, nonce, JSON.stringify(data), expiry.toISOString()],
    );
    return Boolean(result.rows[0]);
  }

  async function consumeOAuthTransaction(kind, nonce) {
    await ensureOAuthTransactionsTable();
    const result = await dbPool.query(
      `
        WITH consumed AS (
          DELETE FROM app_oauth_transactions
          WHERE app_state_id = $1 AND kind = $2 AND nonce = $3
          RETURNING data, expires_at
        )
        SELECT data, expires_at FROM consumed WHERE expires_at > now()
      `,
      [appStateId, kind, nonce],
    );
    return result.rows[0]
      ? { data: result.rows[0].data, expiresAt: result.rows[0].expires_at?.toISOString?.() || "" }
      : null;
  }

  async function deleteOAuthTransactions() {
    await ensureOAuthTransactionsTable();
    const result = await dbPool.query("DELETE FROM app_oauth_transactions WHERE app_state_id = $1", [appStateId]);
    return result.rowCount;
  }

  async function readTokenFile() {
    if (!googleTokenFile) return null;
    try {
      return JSON.parse(await readFile(googleTokenFile, "utf8"));
    } catch {
      return null;
    }
  }

  async function deleteTokenFile() {
    if (!googleTokenFile) return;
    try {
      await unlink(googleTokenFile);
    } catch {}
  }

  async function readToken() {
    const stored = await readPrivateData("google_token");
    if (stored.data) {
      await deleteTokenFile();
      return stored.data;
    }
    const legacyToken = await readTokenFile();
    if (!legacyToken) return null;
    await writePrivateData("google_token", legacyToken);
    await deleteTokenFile();
    return legacyToken;
  }

  async function writeToken(token) {
    await writePrivateData("google_token", token);
    await deleteTokenFile();
  }

  async function deleteToken() {
    await deletePrivateData("google_token");
    await deleteTokenFile();
  }

  async function end() {
    await dbPool?.end();
  }

  return {
    appStateId,
    claimOAuthTransaction,
    consumeOAuthTransaction,
    createMigrationBackup,
    deletePrivateData,
    deleteOAuthTransactions,
    deleteToken,
    end,
    listMigrationBackups,
    readAppState,
    readPrivateData,
    readToken,
    ready,
    restoreMigrationBackup,
    stateStatus,
    writeAppState,
    writeResource,
    writePrivateData,
    writeToken,
  };

  async function relationalStateHasRows(client) {
    const result = await client.query(
      `
        SELECT EXISTS (
          SELECT 1 FROM boxes WHERE app_state_id = $1
          UNION ALL SELECT 1 FROM goals WHERE app_state_id = $1
          UNION ALL SELECT 1 FROM projects WHERE app_state_id = $1
          UNION ALL SELECT 1 FROM tasks WHERE app_state_id = $1
          UNION ALL SELECT 1 FROM resources WHERE app_state_id = $1
          UNION ALL SELECT 1 FROM habits WHERE app_state_id = $1
          UNION ALL SELECT 1 FROM habit_instances WHERE app_state_id = $1
          UNION ALL SELECT 1 FROM captures WHERE app_state_id = $1
          UNION ALL SELECT 1 FROM journals WHERE app_state_id = $1
          UNION ALL SELECT 1 FROM google_calendars WHERE app_state_id = $1
          UNION ALL SELECT 1 FROM google_events WHERE app_state_id = $1
          UNION ALL SELECT 1 FROM collection_links WHERE app_state_id = $1
        ) AS has_rows
      `,
      [appStateId]
    );
    return result.rows[0]?.has_rows === true;
  }

  async function readRelationalAppState(client, baseState, { normalize = true } = {}) {
    const safeBaseState = isPlainObject(baseState) ? baseState : {};
    const taskResources = await readTaskResourceMap(client);
    const relationalState = {
      ...safeBaseState,
      settings: isPlainObject(safeBaseState.settings) ? safeBaseState.settings : {},
      captures: await readCaptures(client),
      boxes: await readBoxes(client),
      goals: await readGoals(client),
      projects: await readProjects(client),
      tasks: await readTasks(client, taskResources),
      resources: await readResources(client),
      habits: await readHabits(client),
      habitInstances: await readHabitInstances(client),
      journals: await readJournals(client),
      googleCalendars: await readGoogleCalendars(client),
      googleEvents: await readGoogleEvents(client),
      links: await readCollectionLinks(client),
    };
    return normalize ? normalizeAppStateForStorage(relationalState).state : relationalState;
  }

  async function readRows(client, table, columns = "*") {
    const result = await client.query(`SELECT ${columns} FROM ${table} WHERE app_state_id = $1 ORDER BY position ASC, id ASC`, [appStateId]);
    return result.rows;
  }

  async function readBoxes(client) {
    const rows = await readRows(client, "boxes", "id, name, visibility, color, data");
    const items = [];
    for (const row of rows) {
      const item = dataObject(row.data);
      item.id = row.id;
      item.name = textValue(row.name);
      item.visibility = textValue(row.visibility);
      item.color = textValue(row.color);
      items.push(item);
    }
    return items;
  }

  async function readGoals(client) {
    const rows = await readRows(client, "goals", "id, box_id, name, status, year, quarter, target_date, data");
    const items = [];
    for (const row of rows) {
      const item = dataObject(row.data);
      item.id = row.id;
      item.boxId = row.box_id || "";
      item.name = textValue(row.name);
      item.status = textValue(row.status);
      item.year = textValue(row.year);
      item.quarter = textValue(row.quarter);
      item.targetDate = databaseDateString(row.target_date);
      items.push(item);
    }
    return items;
  }

  async function readProjects(client) {
    const rows = await readRows(client, "projects", "id, box_id, goal_id, name, status, start_date, end_date, data");
    const items = [];
    for (const row of rows) {
      const item = dataObject(row.data);
      item.id = row.id;
      item.boxId = row.box_id || "";
      item.goalId = row.goal_id || "";
      item.name = textValue(row.name);
      item.status = textValue(row.status);
      item.startDate = databaseDateString(row.start_date);
      item.endDate = databaseDateString(row.end_date);
      items.push(item);
    }
    return items;
  }

  async function readTasks(client, taskResources) {
    const rows = await readRows(
      client,
      "tasks",
      "id, box_id, goal_id, project_id, title, status, due_date, scheduled_start, scheduled_end, completed_at, estimated_minutes, actual_minutes, google_event_id, data"
    );
    const items = [];
    for (const row of rows) {
      const item = dataObject(row.data);
      item.id = row.id;
      item.boxId = row.box_id || "";
      item.goalId = row.goal_id || "";
      item.projectId = row.project_id || "";
      item.resourceId = taskResources.get(row.id) || "";
      item.title = textValue(row.title);
      item.status = textValue(row.status);
      item.dueDate = databaseDateString(row.due_date);
      item.scheduledStart = databaseTimestampString(row.scheduled_start);
      item.scheduledEnd = databaseTimestampString(row.scheduled_end);
      item.completedAt = databaseTimestampString(row.completed_at);
      item.estimatedMinutes = numberOrDefault(row.estimated_minutes, item.estimatedMinutes);
      item.actualMinutes = numberOrDefault(row.actual_minutes, item.actualMinutes);
      item.googleEventId = textValue(row.google_event_id);
      items.push(item);
    }
    return items;
  }

  async function readResources(client) {
    const rows = await readRows(client, "resources", "id, box_id, goal_id, project_id, title, type, importance, pinned, read_later, url, data");
    const items = [];
    for (const row of rows) {
      const item = dataObject(row.data);
      item.id = row.id;
      item.boxId = row.box_id || "";
      item.goalId = row.goal_id || "";
      item.projectId = row.project_id || "";
      item.title = textValue(row.title);
      item.type = textValue(row.type);
      item.importance = textValue(row.importance);
      item.pinned = row.pinned === true;
      item.readLater = row.read_later === true;
      item.url = textValue(row.url);
      items.push(item);
    }
    return items;
  }

  async function readHabits(client) {
    const rows = await readRows(client, "habits", "id, box_id, project_id, title, cadence, status, target, data");
    const items = [];
    for (const row of rows) {
      const item = dataObject(row.data);
      item.id = row.id;
      item.boxId = row.box_id || "";
      item.projectId = row.project_id || "";
      item.title = textValue(row.title);
      item.cadence = textValue(row.cadence);
      item.status = textValue(row.status);
      item.target = textValue(row.target);
      items.push(item);
    }
    return items;
  }

  async function readHabitInstances(client) {
    const rows = await readRows(client, "habit_instances", "id, habit_id, date, completed, completed_at, data");
    const items = [];
    for (const row of rows) {
      const item = dataObject(row.data);
      item.id = row.id;
      item.habitId = row.habit_id || "";
      item.date = databaseDateString(row.date);
      item.completed = row.completed === true;
      item.completedAt = databaseTimestampString(row.completed_at);
      items.push(item);
    }
    return items;
  }

  async function readCaptures(client) {
    const rows = await readRows(client, "captures", "id, title, url, status, converted_to, converted_id, captured_at, processed_at, data");
    const items = [];
    for (const row of rows) {
      const item = dataObject(row.data);
      item.id = row.id;
      item.title = textValue(row.title);
      item.url = textValue(row.url);
      item.status = textValue(row.status);
      item.convertedTo = textValue(row.converted_to);
      item.convertedId = textValue(row.converted_id);
      item.createdAt = databaseTimestampString(row.captured_at);
      item.processedAt = databaseTimestampString(row.processed_at);
      items.push(item);
    }
    return items;
  }

  async function readJournals(client) {
    const rows = await readRows(client, "journals", "id, title, date, satisfaction, data");
    const items = [];
    for (const row of rows) {
      const item = dataObject(row.data);
      item.id = row.id;
      item.title = textValue(row.title);
      item.date = databaseDateString(row.date);
      item.satisfaction = numberOrDefault(row.satisfaction, item.satisfaction);
      items.push(item);
    }
    return items;
  }

  async function readGoogleCalendars(client) {
    const rows = await readRows(client, "google_calendars", "id, summary, data");
    const items = [];
    for (const row of rows) {
      const item = dataObject(row.data);
      item.id = row.id;
      item.summary = textValue(row.summary);
      items.push(item);
    }
    return items;
  }

  async function readGoogleEvents(client) {
    const rows = await readRows(
      client,
      "google_events",
      "id, calendar_id, calendar_summary, source, title, start_time, end_time, start_date, end_date, all_day, html_link, status, event_updated_at, data"
    );
    const items = [];
    for (const row of rows) {
      const item = dataObject(row.data);
      item.id = row.id;
      item.calendarId = row.calendar_id || "";
      item.calendarSummary = textValue(row.calendar_summary);
      item.source = textValue(row.source);
      item.title = textValue(row.title);
      item.start = databaseTimestampString(row.start_time);
      item.end = databaseTimestampString(row.end_time);
      item.startDate = databaseDateString(row.start_date);
      item.endDate = databaseDateString(row.end_date);
      item.allDay = row.all_day === true;
      item.htmlLink = textValue(row.html_link);
      item.status = textValue(row.status);
      item.updated = databaseTimestampString(row.event_updated_at);
      items.push(item);
    }
    return items;
  }

  async function readCollectionLinks(client) {
    const rows = await readRows(client, "collection_links", "id, from_type, from_id, to_type, to_id, relation, data");
    const items = [];
    for (const row of rows) {
      const item = dataObject(row.data);
      item.id = row.id;
      item.fromType = textValue(row.from_type);
      item.fromId = textValue(row.from_id);
      item.toType = textValue(row.to_type);
      item.toId = textValue(row.to_id);
      item.relation = textValue(row.relation || item.relation || "related");
      items.push(item);
    }
    return items;
  }

  async function readTaskResourceMap(client) {
    const result = await client.query("SELECT task_id, resource_id FROM task_resources WHERE app_state_id = $1 ORDER BY updated_at ASC, resource_id ASC", [appStateId]);
    const taskResources = new Map();
    for (const row of result.rows) {
      if (!taskResources.has(row.task_id)) taskResources.set(row.task_id, row.resource_id);
    }
    return taskResources;
  }

  async function syncRelationalState(client, state) {
    const ids = relationalIdSets(state);
    for (const table of RELATIONAL_DELETE_ORDER) {
      await client.query(`DELETE FROM ${table} WHERE app_state_id = $1`, [appStateId]);
    }
    await insertBoxes(client, state.boxes || []);
    await insertGoals(client, state.goals || [], ids);
    await insertProjects(client, state.projects || [], ids);
    await insertCaptures(client, state.captures || []);
    await insertResources(client, state.resources || [], ids);
    await insertTasks(client, state.tasks || [], ids);
    await insertTaskResources(client, taskResourceRelations(state, ids));
    await insertHabits(client, state.habits || [], ids);
    await insertHabitInstances(client, state.habitInstances || [], ids);
    await insertJournals(client, state.journals || []);
    await insertGoogleCalendars(client, state.googleCalendars || []);
    await insertGoogleEvents(client, state.googleEvents || [], ids);
    await insertCollectionLinks(client, state.links || []);
  }

  async function insertBoxes(client, boxes) {
    for (let index = 0; index < boxes.length; index += 1) {
      const box = boxes[index];
      if (!relationalId(box)) continue;
      await client.query(
        "INSERT INTO boxes (app_state_id, id, name, visibility, color, position, data) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)",
        [appStateId, box.id, textValue(box.name), textValue(box.visibility), textValue(box.color), index, jsonValue(box)]
      );
    }
  }

  async function insertGoals(client, goals, ids) {
    for (let index = 0; index < goals.length; index += 1) {
      const goal = goals[index];
      if (!relationalId(goal)) continue;
      await client.query(
        "INSERT INTO goals (app_state_id, id, box_id, name, status, year, quarter, target_date, position, data) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)",
        [appStateId, goal.id, validRef(goal.boxId, ids.boxes), textValue(goal.name), textValue(goal.status), textValue(goal.year), textValue(goal.quarter), dateValue(goal.targetDate), index, jsonValue(goal)]
      );
    }
  }

  async function insertProjects(client, projects, ids) {
    for (let index = 0; index < projects.length; index += 1) {
      const project = projects[index];
      if (!relationalId(project)) continue;
      await client.query(
        "INSERT INTO projects (app_state_id, id, box_id, goal_id, name, status, start_date, end_date, position, data) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)",
        [appStateId, project.id, validRef(project.boxId, ids.boxes), validRef(project.goalId, ids.goals), textValue(project.name), textValue(project.status), dateValue(project.startDate), dateValue(project.endDate), index, jsonValue(project)]
      );
    }
  }

  async function insertTasks(client, tasks, ids) {
    for (let index = 0; index < tasks.length; index += 1) {
      const task = tasks[index];
      if (!relationalId(task)) continue;
      await client.query(
        `INSERT INTO tasks (
          app_state_id, id, box_id, goal_id, project_id, title, status, due_date, scheduled_start,
          scheduled_end, completed_at, estimated_minutes, actual_minutes, google_event_id, position, data
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb)`,
        [
          appStateId,
          task.id,
          validRef(task.boxId, ids.boxes),
          validRef(task.goalId, ids.goals),
          validRef(task.projectId, ids.projects),
          textValue(task.title),
          textValue(task.status),
          dateValue(task.dueDate),
          timestampValue(task.scheduledStart),
          timestampValue(task.scheduledEnd),
          timestampValue(task.completedAt),
          integerValue(task.estimatedMinutes),
          integerValue(task.actualMinutes),
          textValue(task.googleEventId),
          index,
          jsonValue(task),
        ]
      );
    }
  }

  async function insertResources(client, resources, ids) {
    for (let index = 0; index < resources.length; index += 1) {
      const resource = resources[index];
      if (!relationalId(resource)) continue;
      await client.query(
        `INSERT INTO resources (
          app_state_id, id, box_id, goal_id, project_id, title, type, importance, pinned,
          read_later, url, position, data
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)`,
        [
          appStateId,
          resource.id,
          validRef(resource.boxId, ids.boxes),
          validRef(resource.goalId, ids.goals),
          validRef(resource.projectId, ids.projects),
          textValue(resource.title),
          textValue(resource.type),
          textValue(resource.importance),
          resource.pinned === true,
          resource.readLater === true,
          textValue(resource.url),
          index,
          jsonValue(resource),
        ]
      );
    }
  }

  async function upsertResource(client, resource, position, ids) {
    await client.query(
      `INSERT INTO resources (
        app_state_id, id, box_id, goal_id, project_id, title, type, importance, pinned,
        read_later, url, position, data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
      ON CONFLICT (app_state_id, id) DO UPDATE SET
        box_id = EXCLUDED.box_id,
        goal_id = EXCLUDED.goal_id,
        project_id = EXCLUDED.project_id,
        title = EXCLUDED.title,
        type = EXCLUDED.type,
        importance = EXCLUDED.importance,
        pinned = EXCLUDED.pinned,
        read_later = EXCLUDED.read_later,
        url = EXCLUDED.url,
        position = EXCLUDED.position,
        data = EXCLUDED.data,
        updated_at = now()`,
      [
        appStateId,
        resource.id,
        validRef(resource.boxId, ids.boxes),
        validRef(resource.goalId, ids.goals),
        validRef(resource.projectId, ids.projects),
        textValue(resource.title),
        textValue(resource.type),
        textValue(resource.importance),
        resource.pinned === true,
        resource.readLater === true,
        textValue(resource.url),
        position,
        jsonValue(resource),
      ]
    );
  }

  async function insertTaskResources(client, relations) {
    for (const relation of relations) {
      await client.query(
        "INSERT INTO task_resources (app_state_id, task_id, resource_id, relation, data) VALUES ($1, $2, $3, $4, $5::jsonb)",
        [appStateId, relation.taskId, relation.resourceId, relation.relation, jsonValue(relation.data)]
      );
    }
  }

  async function insertHabits(client, habits, ids) {
    for (let index = 0; index < habits.length; index += 1) {
      const habit = habits[index];
      if (!relationalId(habit)) continue;
      await client.query(
        "INSERT INTO habits (app_state_id, id, box_id, project_id, title, cadence, status, target, position, data) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)",
        [appStateId, habit.id, validRef(habit.boxId, ids.boxes), validRef(habit.projectId, ids.projects), textValue(habit.title), textValue(habit.cadence), textValue(habit.status), textValue(habit.target), index, jsonValue(habit)]
      );
    }
  }

  async function insertHabitInstances(client, instances, ids) {
    for (let index = 0; index < instances.length; index += 1) {
      const instance = instances[index];
      if (!relationalId(instance)) continue;
      await client.query(
        "INSERT INTO habit_instances (app_state_id, id, habit_id, date, completed, completed_at, position, data) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)",
        [appStateId, instance.id, validRef(instance.habitId, ids.habits), dateValue(instance.date), instance.completed === true, timestampValue(instance.completedAt), index, jsonValue(instance)]
      );
    }
  }

  async function insertCaptures(client, captures) {
    for (let index = 0; index < captures.length; index += 1) {
      const capture = captures[index];
      if (!relationalId(capture)) continue;
      await client.query(
        "INSERT INTO captures (app_state_id, id, title, url, status, converted_to, converted_id, captured_at, processed_at, position, data) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)",
        [appStateId, capture.id, textValue(capture.title), textValue(capture.url), textValue(capture.status), textValue(capture.convertedTo), textValue(capture.convertedId), timestampValue(capture.createdAt), timestampValue(capture.processedAt), index, jsonValue(capture)]
      );
    }
  }

  async function insertJournals(client, journals) {
    for (let index = 0; index < journals.length; index += 1) {
      const journal = journals[index];
      if (!relationalId(journal)) continue;
      await client.query(
        "INSERT INTO journals (app_state_id, id, title, date, satisfaction, position, data) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)",
        [appStateId, journal.id, textValue(journal.title), dateValue(journal.date), integerValue(journal.satisfaction), index, jsonValue(journal)]
      );
    }
  }

  async function insertGoogleCalendars(client, calendars) {
    for (let index = 0; index < calendars.length; index += 1) {
      const calendar = calendars[index];
      if (!relationalId(calendar)) continue;
      await client.query(
        "INSERT INTO google_calendars (app_state_id, id, summary, position, data) VALUES ($1, $2, $3, $4, $5::jsonb)",
        [appStateId, calendar.id, textValue(calendar.summary), index, jsonValue(calendar)]
      );
    }
  }

  async function insertGoogleEvents(client, events, ids) {
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      if (!relationalId(event)) continue;
      await client.query(
        `INSERT INTO google_events (
          app_state_id, id, calendar_id, calendar_summary, source, title, start_time, end_time,
          start_date, end_date, all_day, html_link, status, event_updated_at, position, data
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb)`,
        [
          appStateId,
          event.id,
          validRef(event.calendarId, ids.googleCalendars),
          textValue(event.calendarSummary),
          textValue(event.source),
          textValue(event.title),
          timestampValue(event.start),
          timestampValue(event.end),
          dateValue(event.startDate),
          dateValue(event.endDate),
          event.allDay === true,
          textValue(event.htmlLink),
          textValue(event.status),
          timestampValue(event.updated),
          index,
          jsonValue(event),
        ]
      );
    }
  }

  async function insertCollectionLinks(client, links) {
    for (let index = 0; index < links.length; index += 1) {
      const link = links[index];
      if (!relationalId(link)) continue;
      await client.query(
        "INSERT INTO collection_links (app_state_id, id, from_type, from_id, to_type, to_id, relation, position, data) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)",
        [appStateId, link.id, textValue(link.fromType), textValue(link.fromId), textValue(link.toType), textValue(link.toId), textValue(link.relation || "related"), index, jsonValue(link)]
      );
    }
  }
}

function relationalIdSets(state) {
  return {
    boxes: idSet(state.boxes),
    goals: idSet(state.goals),
    projects: idSet(state.projects),
    tasks: idSet(state.tasks),
    resources: idSet(state.resources),
    habits: idSet(state.habits),
    googleCalendars: idSet(state.googleCalendars),
  };
}

function idSet(items) {
  const ids = new Set();
  if (!Array.isArray(items)) return ids;
  for (const item of items) {
    if (relationalId(item)) ids.add(item.id);
  }
  return ids;
}

function taskResourceRelations(state, ids) {
  const relations = [];
  const seen = new Set();
  const tasks = Array.isArray(state.tasks) ? state.tasks : [];
  for (const task of tasks) {
    if (!relationalId(task)) continue;
    const resourceId = validRef(task.resourceId, ids.resources);
    if (!resourceId) continue;
    addTaskResourceRelation(relations, seen, task.id, resourceId, "related", {
      source: "task.resourceId",
      taskId: task.id,
      resourceId,
    });
  }

  const links = Array.isArray(state.links) ? state.links : [];
  for (const link of links) {
    if (!isPlainObject(link)) continue;
    const fromType = relationCollectionType(link.fromType);
    const toType = relationCollectionType(link.toType);
    let taskId = "";
    let resourceId = "";
    if (fromType === "tasks" && toType === "resources") {
      taskId = validRef(link.fromId, ids.tasks);
      resourceId = validRef(link.toId, ids.resources);
    } else if (fromType === "resources" && toType === "tasks") {
      taskId = validRef(link.toId, ids.tasks);
      resourceId = validRef(link.fromId, ids.resources);
    }
    if (!taskId || !resourceId) continue;
    addTaskResourceRelation(relations, seen, taskId, resourceId, textValue(link.relation || "related"), link);
  }
  return relations;
}

function addTaskResourceRelation(relations, seen, taskId, resourceId, relation, data) {
  const key = `${taskId}\u0000${resourceId}`;
  if (seen.has(key)) return;
  seen.add(key);
  relations.push({ taskId, resourceId, relation, data });
}

function relationCollectionType(value) {
  const text = textValue(value);
  if (text === "task") return "tasks";
  if (text === "resource") return "resources";
  if (text === "project") return "projects";
  if (text === "goal") return "goals";
  if (text === "box") return "boxes";
  if (text === "habit") return "habits";
  return text;
}

function relationalId(item) {
  return isPlainObject(item) && typeof item.id === "string" && item.id.trim() !== "";
}

function validRef(value, ids) {
  return typeof value === "string" && ids?.has(value) ? value : null;
}

function textValue(value) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return String(value);
}

function dateValue(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return Number.isFinite(Date.parse(value)) ? value : null;
}

function timestampValue(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  return Number.isFinite(Date.parse(value)) ? value : null;
}

function integerValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

function jsonValue(value) {
  return JSON.stringify(value ?? {});
}

function dataObject(value) {
  return isPlainObject(value) ? { ...value } : {};
}

function databaseDateString(value) {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return "";
}

function databaseTimestampString(value) {
  if (!value) return "";
  if (typeof value === "string") return Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : "";
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  return "";
}

function numberOrDefault(value, fallback = null) {
  const number = Number(value);
  if (Number.isFinite(number)) return number;
  return Number.isFinite(Number(fallback)) ? Number(fallback) : 0;
}

function nonNegativeRevision(value, fallback = 0) {
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : fallback;
}

function positiveRevision(value, fallback = 1) {
  const revision = nonNegativeRevision(value, fallback);
  return revision > 0 ? revision : fallback;
}

function optionalRevision(value) {
  if (value === undefined || value === null || value === "") return null;
  const validNumber = typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  const validString = typeof value === "string" && /^(?:0|[1-9]\d*)$/.test(value);
  const revision = validNumber || validString ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw storageError(400, "INVALID_BASE_REVISION", "baseRevision must be a non-negative integer.");
  }
  return revision;
}

function manualBackupLabel(value) {
  const label = typeof value === "string" ? value.trim() : "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,152}$/.test(label)) {
    throw storageError(400, "INVALID_BACKUP_REASON", "Manual backup labels must use 1-153 letters, numbers, dots, underscores, colons, or hyphens.");
  }
  return label;
}

function boundedInteger(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function migrationBackupReason(value) {
  const reason = typeof value === "string" ? value.trim() : "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(reason)) {
    throw storageError(400, "INVALID_BACKUP_REASON", "Backup reasons must use 1-160 letters, numbers, dots, underscores, colons, or hyphens.");
  }
  return reason;
}

function migrationBackupMetadata(row) {
  const sourceVersion = Number(row?.source_version);
  return {
    id: typeof row?.id === "string" ? row.id : "",
    appStateId: typeof row?.app_state_id === "string" ? row.app_state_id : "",
    sourceRevision: nonNegativeRevision(row?.source_revision, 0),
    sourceVersion: Number.isSafeInteger(sourceVersion) && sourceVersion >= 0 ? sourceVersion : null,
    reason: typeof row?.reason === "string" ? row.reason : "",
    stateSha256: typeof row?.state_sha256 === "string" ? row.state_sha256 : "",
    createdAt: row?.created_at?.toISOString?.() || "",
    restoredCount: boundedInteger(row?.restored_count, 0, Number.MAX_SAFE_INTEGER, 0),
    lastRestoredAt: row?.last_restored_at?.toISOString?.() || "",
  };
}

function stateVersion(state) {
  if (!isPlainObject(state)) return null;
  const version = Number(state.version);
  return Number.isSafeInteger(version) && version >= 0 ? version : null;
}

function cloneJsonValue(value) {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? null : JSON.parse(serialized);
}

function jsonSha256(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
  return `{${entries.join(",")}}`;
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

function storageError(status, code, message, details = undefined) {
  return Object.assign(new Error(message), { status, code, expose: true, details });
}

function normalizeAppStateForStorage(state) {
  const validRoot = isPlainObject(state);
  const nextState = validRoot ? state : {};
  let changed = !validRoot;
  const now = new Date().toISOString();
  const version = Number(nextState.version);
  if (version !== STATE_VERSION || nextState.version !== version) {
    nextState.version = STATE_VERSION;
    changed = true;
  }
  const revision = nonNegativeRevision(nextState.revision, 0);
  if (nextState.revision !== revision) {
    nextState.revision = revision;
    changed = true;
  }
  if (!isValidDateString(nextState.createdAt)) {
    nextState.createdAt = now;
    changed = true;
  }
  if (!isValidDateString(nextState.updatedAt)) {
    nextState.updatedAt = now;
    changed = true;
  }
  if (!nextState.settings || typeof nextState.settings !== "object" || Array.isArray(nextState.settings)) {
    nextState.settings = {};
    changed = true;
  }
  if (Object.prototype.hasOwnProperty.call(nextState.settings, "appMode")) {
    delete nextState.settings.appMode;
    changed = true;
  }
  if (Object.prototype.hasOwnProperty.call(nextState.settings, "notionSyncMode")) {
    delete nextState.settings.notionSyncMode;
    changed = true;
  }
  const normalizedNavOrder = normalizeNavOrder(nextState.settings.navOrder);
  if (!arraysEqual(nextState.settings.navOrder, normalizedNavOrder)) {
    nextState.settings.navOrder = normalizedNavOrder;
    changed = true;
  }
  const normalizedCalendarSources = normalizeCalendarSources(nextState.settings.calendarSources);
  if (!shallowObjectsEqual(nextState.settings.calendarSources, normalizedCalendarSources)) {
    nextState.settings.calendarSources = normalizedCalendarSources;
    changed = true;
  }
  const normalizedVisibleGoogleCalendars = normalizeBooleanMap(nextState.settings.visibleGoogleCalendars);
  if (!shallowObjectsEqual(nextState.settings.visibleGoogleCalendars, normalizedVisibleGoogleCalendars)) {
    nextState.settings.visibleGoogleCalendars = normalizedVisibleGoogleCalendars;
    changed = true;
  }
  const normalizedViewControls = normalizeViewControls(nextState.settings.viewControls);
  if (!jsonValuesEqual(nextState.settings.viewControls, normalizedViewControls)) {
    changed = true;
  }
  nextState.settings.viewControls = normalizedViewControls;
  const normalizedNotionParityMode = typeof nextState.settings.notionParityMode === "boolean"
    ? nextState.settings.notionParityMode
    : true;
  if (nextState.settings.notionParityMode !== normalizedNotionParityMode) {
    nextState.settings.notionParityMode = normalizedNotionParityMode;
    changed = true;
  }
  const normalizedAdvancedWindowMode = nextState.settings.advancedWindowMode === true;
  if (nextState.settings.advancedWindowMode !== normalizedAdvancedWindowMode) {
    nextState.settings.advancedWindowMode = normalizedAdvancedWindowMode;
    changed = true;
  }
  const normalizedOpenPagesIn = normalizeResourceOpenPagesIn(nextState.settings.openPagesIn);
  if (!jsonValuesEqual(nextState.settings.openPagesIn, normalizedOpenPagesIn)) {
    changed = true;
  }
  nextState.settings.openPagesIn = normalizedOpenPagesIn;
  for (const key of STRING_SETTING_KEYS) {
    if (typeof nextState.settings[key] !== "string") {
      nextState.settings[key] = "";
      changed = true;
    }
  }
  if (typeof nextState.settings.statsDemoDataSeeded !== "boolean") {
    nextState.settings.statsDemoDataSeeded = false;
    changed = true;
  }
  for (const key of COLLECTION_KEYS) {
    const items = nextState[key];
    if (!Array.isArray(items)) {
      nextState[key] = [];
      changed = true;
      continue;
    }
    let normalizedItems = null;
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (!isPlainObject(item)) {
        if (!normalizedItems) normalizedItems = items.slice(0, index);
        changed = true;
        continue;
      }
      if (LEGACY_KIND_COLLECTION_KEYS.has(key) && Object.prototype.hasOwnProperty.call(item, "kind")) {
        const { kind, ...cleanItem } = item;
        if (!normalizedItems) normalizedItems = items.slice(0, index);
        normalizedItems.push(cleanItem);
        changed = true;
        continue;
      }
      if (normalizedItems) normalizedItems.push(item);
    }
    if (normalizedItems) nextState[key] = normalizedItems;
  }
  return { state: nextState, changed };
}

function isValidDateString(value) {
  return typeof value === "string" && value !== "" && Number.isFinite(Date.parse(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeNavOrder(order) {
  const normalized = [];
  const seen = new Set();
  if (Array.isArray(order)) {
    for (const key of order) {
      if (!NAV_KEY_SET.has(key) || seen.has(key)) continue;
      normalized.push(key);
      seen.add(key);
    }
  }
  for (const key of DEFAULT_NAV_ORDER) {
    if (seen.has(key)) continue;
    normalized.push(key);
    seen.add(key);
  }
  return normalized;
}

function normalizeCalendarSources(sources) {
  if (calendarSourcesValid(sources)) return sources;
  const normalized = { ...DEFAULT_CALENDAR_SOURCES };
  if (!isPlainObject(sources)) return normalized;
  for (const key of CALENDAR_SOURCE_KEYS) {
    if (typeof sources[key] === "boolean") normalized[key] = sources[key];
  }
  return normalized;
}

function calendarSourcesValid(sources) {
  if (!isPlainObject(sources)) return false;
  let count = 0;
  for (const key in sources) {
    if (!Object.prototype.hasOwnProperty.call(sources, key)) continue;
    if (!CALENDAR_SOURCE_KEY_SET.has(key) || typeof sources[key] !== "boolean") return false;
    count += 1;
  }
  return count === CALENDAR_SOURCE_KEYS.length;
}

function normalizeBooleanMap(map) {
  const normalized = {};
  if (!isPlainObject(map)) return normalized;
  for (const key in map) {
    if (Object.prototype.hasOwnProperty.call(map, key) && typeof map[key] === "boolean") {
      normalized[key] = map[key];
    }
  }
  return normalized;
}

function normalizeViewControls(value) {
  const controls = {};
  for (const key of DEFAULT_NAV_ORDER) {
    const defaults = DEFAULT_VIEW_CONTROLS[key];
    const saved = isPlainObject(value) && isPlainObject(value[key]) ? value[key] : {};
    controls[key] = {
      ...defaults,
      filters: normalizeViewControlFilters(saved, defaults.filters),
      sort: typeof saved.sort === "string" ? saved.sort : defaults.sort,
      mode: typeof saved.mode === "string" ? saved.mode : defaults.mode,
      panels: normalizeViewControlPanels(saved.panels),
    };
    if (key === "resources") {
      controls[key].search = typeof saved.search === "string" ? saved.search : defaults.search;
      controls[key].searchScope = normalizeResourceSearchScope(saved.searchScope);
    }
  }
  return controls;
}

function normalizeResourceSearchScope(value) {
  return RESOURCE_SEARCH_SCOPES.has(value) ? value : "fullText";
}

function normalizeResourceOpenPagesIn(value) {
  const source = isPlainObject(value) ? value : {};
  const normalized = {};
  for (const [view, fallback] of Object.entries(DEFAULT_RESOURCE_OPEN_PAGES_IN)) {
    normalized[view] = RESOURCE_OPEN_PAGE_MODES.has(source[view]) ? source[view] : fallback;
  }
  return normalized;
}

function normalizeViewControlFilters(saved, fallback = ["all"]) {
  const rawValues = Array.isArray(saved?.filters) ? saved.filters : typeof saved?.filter === "string" ? [saved.filter] : fallback;
  const normalized = [];
  for (const value of rawValues) {
    if (typeof value !== "string" || normalized.includes(value)) continue;
    normalized.push(value);
  }
  if (!normalized.length) {
    for (const value of fallback) {
      if (typeof value === "string" && !normalized.includes(value)) normalized.push(value);
    }
  }
  if (normalized.includes("all") && normalized.length > 1) {
    let writeIndex = 0;
    for (const value of normalized) {
      if (value === "all") continue;
      normalized[writeIndex] = value;
      writeIndex += 1;
    }
    normalized.length = writeIndex;
  }
  return normalized.length ? normalized : ["all"];
}

function normalizeViewControlPanels(value) {
  return {
    filter: isPlainObject(value) && value.filter === true,
    sort: isPlainObject(value) && value.sort === true,
  };
}

function arraysEqual(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function jsonValuesEqual(left, right) {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      if (!jsonValuesEqual(left[index], right[index])) return false;
    }
    return true;
  }
  if (!isPlainObject(left) || !isPlainObject(right)) return false;
  let leftCount = 0;
  for (const key in left) {
    if (!Object.prototype.hasOwnProperty.call(left, key)) continue;
    leftCount += 1;
    if (!Object.prototype.hasOwnProperty.call(right, key) || !jsonValuesEqual(left[key], right[key])) return false;
  }
  let rightCount = 0;
  for (const key in right) {
    if (Object.prototype.hasOwnProperty.call(right, key)) rightCount += 1;
  }
  return leftCount === rightCount;
}

function shallowObjectsEqual(left, right) {
  if (!isPlainObject(left) || !isPlainObject(right)) return false;
  let leftCount = 0;
  for (const key in left) {
    if (!Object.prototype.hasOwnProperty.call(left, key)) continue;
    leftCount += 1;
    if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
    if (left[key] !== right[key]) return false;
  }
  let rightCount = 0;
  for (const key in right) {
    if (Object.prototype.hasOwnProperty.call(right, key)) rightCount += 1;
  }
  return leftCount === rightCount;
}

function databaseSslConfig() {
  const mode = String(process.env.PGSSLMODE || process.env.DATABASE_SSL || "").toLowerCase();
  if (["require", "no-verify"].includes(mode)) return { rejectUnauthorized: false };
  if (["verify-ca", "verify-full"].includes(mode)) return true;
  return undefined;
}
