import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const client = resolve(root, "dist/client");
const index = await readFile(resolve(client, "index.html"), "utf8");
const serviceWorker = await readFile(resolve(client, "service-worker.js"), "utf8");
const appPath = index.match(/src="(\/_sygma\/assets\/app\.[a-f0-9]{12}\.js)"/)?.[1];
const stylesPath = index.match(/href="(\/_sygma\/assets\/styles\.[a-f0-9]{12}\.css)"/)?.[1];
assert(appPath, "built index is missing a content-hashed app asset");
assert(stylesPath, "built index is missing a content-hashed stylesheet");

const appFile = resolve(client, "assets", basename(appPath));
const stylesFile = resolve(client, "assets", basename(stylesPath));
const [appStat, stylesStat, socialPreviewStat, sourceAppStat, sourceStylesStat] = await Promise.all([
  stat(appFile),
  stat(stylesFile),
  stat(resolve(client, "assets/sygma-social-preview.png")),
  stat(resolve(root, "app.js")),
  stat(resolve(root, "styles.css")),
]);

assert(socialPreviewStat.size > 0, "social preview asset is missing from the client build");
assert(index.includes('property="og:image" content="/assets/sygma-social-preview.png"'), "built index is missing its Open Graph preview");
assert(serviceWorker.includes("/assets/sygma-social-preview.png"), "service worker does not precache the social preview");
assert(serviceWorker.includes(appPath) && serviceWorker.includes(stylesPath), "service worker does not precache built assets");

const builtBytes = appStat.size + stylesStat.size;
const sourceBytes = sourceAppStat.size + sourceStylesStat.size;
assert(builtBytes / sourceBytes <= 0.75, "built JS/CSS did not meet the size reduction target");

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

assert(!(await pathExists(resolve(root, "dist/server"))), "Sites Worker output remains in the Railway build");
assert(!(await pathExists(resolve(root, "dist/.openai"))), "Sites hosting metadata remains in the Railway build");
assert(!(await pathExists(resolve(client, "_headers"))), "unused static-host _headers remains in the Railway build");
assert(!(await pathExists(`${appFile}.br`)) && !(await pathExists(`${appFile}.gz`)), "unused precompressed app artifacts remain in the Railway build");
assert(!(await pathExists(`${stylesFile}.br`)) && !(await pathExists(`${stylesFile}.gz`)), "unused precompressed style artifacts remain in the Railway build");

console.log(`Railway build check passed: ${sourceBytes} -> ${builtBytes} bytes.`);
