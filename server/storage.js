import { readFile, unlink } from "node:fs/promises";
import pg from "pg";

const { Pool } = pg;
const STATE_VERSION = 3;
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
  today: { search: "", filter: "all", sort: "date", mode: "overview" },
  inbox: { search: "", filter: "all", sort: "recent", mode: "board" },
  tasks: { search: "", filter: "all", sort: "date", mode: "board" },
  projects: { search: "", filter: "all", sort: "status", mode: "board" },
  goals: { search: "", filter: "all", sort: "target", mode: "cards" },
  boxes: { search: "", filter: "all", sort: "activity", mode: "columns" },
  resources: { search: "", filter: "active", sort: "updated", mode: "library", type: "all", toggles: { pinned: false, readLater: false, important: false, linked: false } },
  habits: { search: "", filter: "all", sort: "progress", mode: "list" },
  journal: { search: "", filter: "all", sort: "date", mode: "cards" },
  calendar: { search: "", filter: "all", sort: "time", mode: "calendar" },
  database: { search: "", filter: "all", sort: "rows", mode: "grid" },
};

export function createStorage({ databaseUrl = "", appStateId = "default", googleTokenFile = "" } = {}) {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for PostgreSQL persistence.");
  }

  const dbPool = new Pool({
    connectionString: databaseUrl,
    ssl: databaseSslConfig(),
  });
  let appStateTableReady = null;
  let appPrivateDataTableReady = null;

  async function ensureAppStateTable() {
    appStateTableReady ||= dbPool.query(`
      CREATE TABLE IF NOT EXISTS app_state (
        id text PRIMARY KEY,
        state jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await appStateTableReady;
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

  async function ready() {
    await ensureAppStateTable();
    await ensureAppPrivateDataTable();
  }

  async function readAppState() {
    await ensureAppStateTable();
    const result = await dbPool.query("SELECT state, updated_at FROM app_state WHERE id = $1", [appStateId]);
    const row = result.rows[0];
    if (!row) return { state: null, updatedAt: "" };
    const normalized = normalizeAppStateForStorage(row.state);
    if (normalized.changed) {
      const healed = await dbPool.query("UPDATE app_state SET state = $2::jsonb, updated_at = now() WHERE id = $1 RETURNING updated_at", [
        appStateId,
        JSON.stringify(normalized.state),
      ]);
      return { state: normalized.state, updatedAt: healed.rows[0]?.updated_at?.toISOString?.() || "" };
    }
    return { state: normalized.state, updatedAt: row.updated_at?.toISOString?.() || "" };
  }

  async function writeAppState(state) {
    await ensureAppStateTable();
    const normalized = normalizeAppStateForStorage(state);
    const result = await dbPool.query(
      `
        INSERT INTO app_state (id, state, updated_at)
        VALUES ($1, $2::jsonb, now())
        ON CONFLICT (id)
        DO UPDATE SET state = EXCLUDED.state, updated_at = now()
        RETURNING updated_at
      `,
      [appStateId, JSON.stringify(normalized.state)]
    );
    return {
      state: normalized.state,
      updatedAt: result.rows[0]?.updated_at?.toISOString?.() || "",
    };
  }

  async function stateStatus() {
    await ready();
    const result = await dbPool.query("SELECT updated_at FROM app_state WHERE id = $1", [appStateId]);
    return {
      configured: true,
      connected: true,
      appStateId,
      hasState: Boolean(result.rows[0]),
      tokenStore: "postgresql",
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
    deleteToken,
    end,
    readAppState,
    readToken,
    ready,
    stateStatus,
    writeAppState,
    writeToken,
  };
}

function normalizeAppStateForStorage(state) {
  const validRoot = isPlainObject(state);
  const nextState = validRoot ? state : {};
  let changed = !validRoot;
  const now = new Date().toISOString();
  const version = Number(nextState.version);
  if (!Number.isFinite(version) || nextState.version !== version) {
    nextState.version = Number.isFinite(version) ? version : STATE_VERSION;
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
  if (JSON.stringify(nextState.settings.viewControls) !== JSON.stringify(normalizedViewControls)) {
    nextState.settings.viewControls = normalizedViewControls;
    changed = true;
  }
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
      search: typeof saved.search === "string" ? saved.search : defaults.search,
      filter: typeof saved.filter === "string" ? saved.filter : defaults.filter,
      sort: typeof saved.sort === "string" ? saved.sort : defaults.sort,
      mode: typeof saved.mode === "string" ? saved.mode : defaults.mode,
    };
    if (key === "resources") {
      controls[key].type = typeof saved.type === "string" ? saved.type : defaults.type;
      controls[key].toggles = normalizeResourceToggles(saved.toggles);
    }
  }
  return controls;
}

function normalizeResourceToggles(value) {
  const defaults = DEFAULT_VIEW_CONTROLS.resources.toggles;
  const toggles = { ...defaults };
  if (!isPlainObject(value)) return toggles;
  for (const key in defaults) {
    if (Object.prototype.hasOwnProperty.call(defaults, key)) toggles[key] = value[key] === true;
  }
  return toggles;
}

function arraysEqual(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
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
