import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, open, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createStorage } from "../server/storage.js";

const PRIVATE_DATA_KEY = "api_proxy_auth";
const CONFIG_VERSION = 1;
const TOKEN_BYTES = 32;
const SAFE_FAILURE = "Proxy auth configuration command failed.";
const USAGE = [
  "Usage:",
  "  node --env-file-if-exists=.env scripts/configure-api-proxy-auth.mjs status",
  "  node --env-file-if-exists=.env scripts/configure-api-proxy-auth.mjs stage --token-file <path>",
  "  node --env-file-if-exists=.env scripts/configure-api-proxy-auth.mjs enable --confirm",
  "  node --env-file-if-exists=.env scripts/configure-api-proxy-auth.mjs disable --confirm",
  "  node --env-file-if-exists=.env scripts/configure-api-proxy-auth.mjs remove --confirm",
  "  node --env-file-if-exists=.env scripts/configure-api-proxy-auth.mjs self-test --confirm",
].join("\n");

class CliError extends Error {}

let storage;

try {
  const options = parseArguments(process.argv.slice(2));
  const databaseUrl = String(process.env.DATABASE_URL || "").trim();
  if (!databaseUrl) throw new CliError("DATABASE_URL is required.");

  const appStateId = options.command === "self-test"
    ? `check-api-proxy-auth-${randomBytes(12).toString("hex")}`
    : String(process.env.APP_STATE_ID || "default");

  storage = createStorage({ databaseUrl, appStateId });

  if (options.command === "self-test") {
    await runSelfTest(storage);
    console.log("Proxy auth configuration self-test passed.");
  } else {
    const status = await runCommand(storage, options);
    console.log(JSON.stringify(status, null, 2));
  }
} catch (error) {
  console.error(error instanceof CliError ? error.message : SAFE_FAILURE);
  process.exitCode = 1;
} finally {
  await storage?.end().catch(() => {});
}

async function runCommand(targetStorage, options) {
  switch (options.command) {
    case "status":
      return readPublicStatus(targetStorage);
    case "stage":
      return stageConfiguration(targetStorage, options.tokenFile);
    case "enable":
      return setEnforced(targetStorage, true);
    case "disable":
      return setEnforced(targetStorage, false);
    case "remove":
      await targetStorage.deletePrivateData(PRIVATE_DATA_KEY);
      return readPublicStatus(targetStorage);
    default:
      throw new CliError(USAGE);
  }
}

async function readPublicStatus(targetStorage) {
  const stored = await targetStorage.readPrivateData(PRIVATE_DATA_KEY);
  const config = validConfiguration(stored.data);
  if (!config) {
    return {
      configured: false,
      enforced: false,
      fingerprint: null,
      createdAt: null,
      updatedAt: stored.updatedAt || null,
    };
  }
  return publicStatus(config);
}

async function stageConfiguration(targetStorage, tokenFile) {
  const stored = await targetStorage.readPrivateData(PRIVATE_DATA_KEY);
  const existing = validConfiguration(stored.data);
  if (stored.data !== null && !existing) {
    throw new CliError("The stored proxy auth configuration is malformed; remove it with --confirm before staging a replacement.");
  }
  const now = new Date().toISOString();
  const config = {
    version: CONFIG_VERSION,
    token: existing?.token || randomBytes(TOKEN_BYTES).toString("base64url"),
    // Re-staging is a token-file recovery operation, not an implicit disable.
    enforced: existing?.enforced === true,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  const createdTokenFile = await writeTokenFile(tokenFile, config.token);
  try {
    await targetStorage.writePrivateData(PRIVATE_DATA_KEY, config);
  } catch {
    await rm(createdTokenFile, { force: true }).catch(() => {});
    throw new CliError(SAFE_FAILURE);
  }
  return readPublicStatus(targetStorage);
}

async function setEnforced(targetStorage, enforced) {
  const stored = await targetStorage.readPrivateData(PRIVATE_DATA_KEY);
  const existing = validConfiguration(stored.data);
  if (!existing) throw new CliError("A valid staged proxy auth configuration is required.");
  const config = {
    ...existing,
    enforced,
    updatedAt: new Date().toISOString(),
  };
  await targetStorage.writePrivateData(PRIVATE_DATA_KEY, config);
  return readPublicStatus(targetStorage);
}

async function writeTokenFile(tokenFile, token) {
  if (!tokenFile) throw new CliError("stage requires an explicit --token-file path.");
  const target = resolve(tokenFile);
  let handle;
  let created = false;
  try {
    handle = await open(target, "wx", 0o600);
    created = true;
    await handle.writeFile(`${token}\n`, "utf8");
    await handle.chmod(0o600);
    await handle.sync();
    await handle.close();
    handle = undefined;
  } catch {
    await handle?.close().catch(() => {});
    if (created) await rm(target, { force: true }).catch(() => {});
    throw new CliError("The token file could not be created safely; no configuration was changed.");
  }
  return target;
}

function publicStatus(config) {
  return {
    configured: true,
    enforced: config.enforced,
    fingerprint: tokenFingerprint(config.token),
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  };
}

function tokenFingerprint(token) {
  return `sha256:${createHash("sha256").update(token).digest("hex")}`;
}

function validConfiguration(value) {
  if (!isPlainObject(value)) return null;
  if (value.version !== CONFIG_VERSION) return null;
  if (typeof value.token !== "string" || value.token.length < 32 || value.token.length > 512) return null;
  if (typeof value.enforced !== "boolean") return null;
  if (!validTimestamp(value.createdAt) || !validTimestamp(value.updatedAt)) return null;
  return {
    version: CONFIG_VERSION,
    token: value.token,
    enforced: value.enforced,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function validTimestamp(value) {
  return typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value));
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parseArguments(args) {
  const command = args[0];
  if (!command || !["status", "stage", "enable", "disable", "remove", "self-test"].includes(command)) {
    throw new CliError(USAGE);
  }

  let confirm = false;
  let tokenFile = "";
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--confirm") {
      if (confirm) throw new CliError(USAGE);
      confirm = true;
      continue;
    }
    if (argument === "--token-file") {
      if (tokenFile || !args[index + 1] || args[index + 1].startsWith("--")) throw new CliError(USAGE);
      tokenFile = args[index + 1];
      index += 1;
      continue;
    }
    if (argument.startsWith("--token-file=")) {
      if (tokenFile || argument === "--token-file=") throw new CliError(USAGE);
      tokenFile = argument.slice("--token-file=".length);
      continue;
    }
    throw new CliError(USAGE);
  }

  if (command === "stage" && (!tokenFile || confirm)) throw new CliError(USAGE);
  if (["enable", "disable", "remove", "self-test"].includes(command) && (!confirm || tokenFile)) {
    throw new CliError(`${command} requires --confirm.\n${USAGE}`);
  }
  if (command === "status" && (confirm || tokenFile)) throw new CliError(USAGE);
  return { command, confirm, tokenFile };
}

async function runSelfTest(targetStorage) {
  const directory = await mkdtemp(join(tmpdir(), "personal-web-proxy-auth-"));
  const tokenFile = join(directory, "token");
  const restagedTokenFile = join(directory, "token-restaged");
  try {
    await targetStorage.deletePrivateData(PRIVATE_DATA_KEY);
    assertStatus(await readPublicStatus(targetStorage), { configured: false, enforced: false }, "initial status");

    const staged = await stageConfiguration(targetStorage, tokenFile);
    assertStatus(staged, { configured: true, enforced: false }, "staged status");
    const token = (await readFile(tokenFile, "utf8")).trim();
    if (!token || staged.fingerprint !== tokenFingerprint(token)) throw new CliError("Self-test failed.");
    const tokenFileMode = (await stat(tokenFile)).mode & 0o777;
    if (tokenFileMode !== 0o600) throw new CliError("Self-test failed.");

    const enabled = await setEnforced(targetStorage, true);
    assertStatus(enabled, { configured: true, enforced: true }, "enabled status");
    if (enabled.fingerprint !== staged.fingerprint) throw new CliError("Self-test failed.");

    const restaged = await stageConfiguration(targetStorage, restagedTokenFile);
    assertStatus(restaged, { configured: true, enforced: true }, "restaged enabled status");
    if (restaged.fingerprint !== staged.fingerprint) throw new CliError("Self-test failed.");

    const disabled = await setEnforced(targetStorage, false);
    assertStatus(disabled, { configured: true, enforced: false }, "disabled status");
    if (disabled.fingerprint !== staged.fingerprint) throw new CliError("Self-test failed.");

    await targetStorage.deletePrivateData(PRIVATE_DATA_KEY);
    assertStatus(await readPublicStatus(targetStorage), { configured: false, enforced: false }, "removed status");

    await targetStorage.writePrivateData(PRIVATE_DATA_KEY, { version: CONFIG_VERSION, enforced: true, token: "" });
    let malformedRestageRejected = false;
    try {
      await stageConfiguration(targetStorage, join(directory, "token-malformed"));
    } catch (error) {
      malformedRestageRejected = error instanceof CliError;
    }
    if (!malformedRestageRejected) throw new CliError("Self-test failed.");
  } finally {
    await targetStorage.deletePrivateData(PRIVATE_DATA_KEY).catch(() => {});
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

function assertStatus(status, expected, label) {
  if (status.configured !== expected.configured || status.enforced !== expected.enforced) {
    throw new CliError(`Self-test failed at ${label}.`);
  }
}
