#!/usr/bin/env node

import { createStorage } from "../server/storage.js";

const SAFE_ERROR_CODES = new Set([
  "BACKUP_INTEGRITY_FAILED",
  "BACKUP_NOT_FOUND",
  "BACKUP_NOT_RESTORABLE",
  "CONFIRMATION_REQUIRED",
  "DATABASE_URL_REQUIRED",
  "INVALID_BACKUP_ID",
  "INVALID_BACKUP_REASON",
  "INVALID_BASE_REVISION",
  "INVALID_COMMAND",
  "INVALID_LIMIT",
  "INVALID_OPTION",
  "STATE_NOT_INITIALIZED",
  "STATE_PRECONDITION_REQUIRED",
  "STATE_REVISION_CONFLICT",
  "WORKSPACE_ID_REQUIRED",
]);

class CliError extends Error {
  constructor(code, status = 400, details = undefined) {
    super(code);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const [command = "help", ...rawArgs] = process.argv.slice(2);
const parsed = parseArguments(rawArgs);

if (["help", "--help", "-h"].includes(command)) {
  printHelp();
  process.exit(0);
}

let storage = null;
try {
  const databaseUrl = String(process.env.DATABASE_URL || "").trim();
  const appStateId = String(process.env.APP_STATE_ID || "").trim();
  if (!databaseUrl) throw new CliError("DATABASE_URL_REQUIRED");
  if (!appStateId) throw new CliError("WORKSPACE_ID_REQUIRED");

  storage = createStorage({ databaseUrl, appStateId });
  if (command === "create") {
    assertOptions(parsed, ["reason"]);
    assertNoPositionals(parsed);
    const reason = parsed.options.get("reason") || "operator";
    const backup = await storage.createMigrationBackup({ reason });
    printJson({ ok: true, command, appStateId, backup });
  } else if (command === "list") {
    assertOptions(parsed, ["limit"]);
    assertNoPositionals(parsed);
    const limit = parseLimit(parsed.options.get("limit"));
    const backups = await storage.listMigrationBackups({ limit });
    printJson({ ok: true, command, appStateId, count: backups.length, backups });
  } else if (command === "restore") {
    assertOptions(parsed, ["confirm", "expected-revision"]);
    if (parsed.positionals.length !== 1) throw new CliError("INVALID_BACKUP_ID");
    const backupId = parsed.positionals[0];
    const confirmation = parsed.options.get("confirm");
    if (confirmation !== appStateId) {
      throw new CliError("CONFIRMATION_REQUIRED", 400, { expectedWorkspace: appStateId });
    }
    if (!parsed.options.has("expected-revision")) {
      throw new CliError("STATE_PRECONDITION_REQUIRED", 428);
    }
    const expectedRevision = parsed.options.get("expected-revision");
    const result = await storage.restoreMigrationBackup(backupId, { expectedRevision });
    printJson({
      ok: true,
      command,
      appStateId,
      backupId: result.backup.id,
      safetyBackupId: result.safetyBackup.id,
      restoreId: result.restoreId,
      previousRevision: result.previousRevision,
      restoredRevision: result.restoredRevision,
      restoredAt: result.restoredAt,
    });
  } else {
    throw new CliError("INVALID_COMMAND");
  }
} catch (error) {
  const code = SAFE_ERROR_CODES.has(error?.code) ? error.code : "BACKUP_COMMAND_FAILED";
  const payload = {
    ok: false,
    code,
    status: Number.isInteger(error?.status) ? error.status : 500,
  };
  const revision = Number(error?.details?.revision);
  if (Number.isSafeInteger(revision) && revision >= 0) payload.currentRevision = revision;
  if (error instanceof CliError && typeof error.details?.expectedWorkspace === "string") {
    payload.expectedWorkspace = error.details.expectedWorkspace;
  }
  process.stderr.write(`${JSON.stringify(payload)}\n`);
  process.exitCode = 1;
} finally {
  await storage?.end().catch(() => {});
}

function parseArguments(values) {
  const positionals = [];
  const options = new Map();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) {
      positionals.push(value);
      continue;
    }
    const equalsIndex = value.indexOf("=");
    if (equalsIndex !== -1) {
      options.set(value.slice(2, equalsIndex), value.slice(equalsIndex + 1));
      continue;
    }
    const key = value.slice(2);
    const next = values[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      options.set(key, next);
      index += 1;
    } else {
      options.set(key, true);
    }
  }
  return { options, positionals };
}

function assertOptions(parsedArguments, allowed) {
  const allowedSet = new Set(allowed);
  for (const key of parsedArguments.options.keys()) {
    if (!allowedSet.has(key)) throw new CliError("INVALID_OPTION");
  }
}

function assertNoPositionals(parsedArguments) {
  if (parsedArguments.positionals.length) throw new CliError("INVALID_OPTION");
}

function parseLimit(value) {
  if (value === undefined) return 20;
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new CliError("INVALID_LIMIT");
  return limit;
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printHelp() {
  process.stdout.write(`Usage:
  node --env-file-if-exists=.env scripts/manage-state-backups.mjs create [--reason operator_label]
  node --env-file-if-exists=.env scripts/manage-state-backups.mjs list [--limit 20]
  node --env-file-if-exists=.env scripts/manage-state-backups.mjs restore <backup-id> --expected-revision <n> --confirm <APP_STATE_ID>

DATABASE_URL and an explicit APP_STATE_ID are required. Output contains metadata only; backup state is never printed.
`);
}
