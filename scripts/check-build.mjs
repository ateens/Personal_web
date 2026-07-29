import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const client = resolve(root, "dist/client");
const index = await readFile(resolve(client, "index.html"), "utf8");
const serviceWorker = await readFile(resolve(client, "service-worker.js"), "utf8");
assert.doesNotThrow(() => new Function(serviceWorker), "built service worker is not valid JavaScript");
const appPath = index.match(/src="(\/_sygma\/assets\/app\.[a-f0-9]{12}\.js)"/)?.[1];
const financeModelPath = index.match(/src="(\/_sygma\/assets\/finance-model\.[a-f0-9]{12}\.js)"/)?.[1];
const stylesPath = index.match(/href="(\/_sygma\/assets\/styles\.[a-f0-9]{12}\.css)"/)?.[1];
assert(appPath, "built index is missing a content-hashed app asset");
assert(financeModelPath, "built index is missing a content-hashed finance calculation asset");
assert(stylesPath, "built index is missing a content-hashed stylesheet");

const appFile = resolve(client, "assets", basename(appPath));
const financeModelFile = resolve(client, "assets", basename(financeModelPath));
const stylesFile = resolve(client, "assets", basename(stylesPath));
const [appStat, financeModelStat, stylesStat, socialPreviewStat, sourceAppStat, sourceFinanceModelStat, sourceStylesStat] = await Promise.all([
  stat(appFile),
  stat(financeModelFile),
  stat(stylesFile),
  stat(resolve(client, "assets/sygma-social-preview.png")),
  stat(resolve(root, "app.js")),
  stat(resolve(root, "finance-model.js")),
  stat(resolve(root, "styles.css")),
]);

assert(socialPreviewStat.size > 0, "social preview asset is missing from the client build");
assert(index.includes('property="og:image" content="/assets/sygma-social-preview.png"'), "built index is missing its Open Graph preview");
assert(serviceWorker.includes("/assets/sygma-social-preview.png"), "service worker does not precache the social preview");
assert(
  serviceWorker.includes(appPath) && serviceWorker.includes(financeModelPath) && serviceWorker.includes(stylesPath),
  "service worker does not precache built assets",
);
assert(serviceWorker.includes('url.pathname.startsWith("/_sygma/assets/")'), "service worker is missing hashed-asset cache-first delivery");
assert(!serviceWorker.includes('url.pathname.startsWith("/icons/")'), "service worker cache-first must not include unhashed icons");

const builtBytes = appStat.size + financeModelStat.size + stylesStat.size;
const sourceBytes = sourceAppStat.size + sourceFinanceModelStat.size + sourceStylesStat.size;
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
assert(!(await pathExists(`${financeModelFile}.br`)) && !(await pathExists(`${financeModelFile}.gz`)), "unused precompressed finance model artifacts remain in the Railway build");
assert(!(await pathExists(`${stylesFile}.br`)) && !(await pathExists(`${stylesFile}.gz`)), "unused precompressed style artifacts remain in the Railway build");

console.log(`Railway build check passed: ${sourceBytes} -> ${builtBytes} bytes.`);
