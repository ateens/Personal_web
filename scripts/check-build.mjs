import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const client = resolve(root, "dist/client");
const index = await readFile(resolve(client, "index.html"), "utf8");
const serviceWorker = await readFile(resolve(client, "service-worker.js"), "utf8");
const appPath = index.match(/src="(\/assets\/app\.[a-f0-9]{12}\.js)"/)?.[1];
const stylesPath = index.match(/href="(\/assets\/styles\.[a-f0-9]{12}\.css)"/)?.[1];
assert(appPath, "built index is missing a content-hashed app asset");
assert(stylesPath, "built index is missing a content-hashed stylesheet");

const [appStat, stylesStat, workerStat, sourceAppStat, sourceStylesStat] = await Promise.all([
  stat(resolve(client, appPath.slice(1))),
  stat(resolve(client, stylesPath.slice(1))),
  stat(resolve(root, "dist/server/index.js")),
  stat(resolve(root, "app.js")),
  stat(resolve(root, "styles.css")),
]);
assert(workerStat.size > 0, "Sites worker build is empty");
assert(serviceWorker.includes(appPath) && serviceWorker.includes(stylesPath), "service worker does not precache built assets");
const builtBytes = appStat.size + stylesStat.size;
const sourceBytes = sourceAppStat.size + sourceStylesStat.size;
assert(builtBytes / sourceBytes <= 0.75, "built JS/CSS did not meet the size reduction target");
console.log(`Build check passed: ${sourceBytes} -> ${builtBytes} bytes.`);
