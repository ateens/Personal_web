import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { brotliDecompress, gunzip } from "node:zlib";

const brotliDecompressAsync = promisify(brotliDecompress);
const gunzipAsync = promisify(gunzip);

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const client = resolve(root, "dist/client");
const index = await readFile(resolve(client, "index.html"), "utf8");
const serviceWorker = await readFile(resolve(client, "service-worker.js"), "utf8");
const staticHeaders = await readFile(resolve(client, "_headers"), "utf8");
const appPath = index.match(/src="(\/_sygma\/assets\/app\.[a-f0-9]{12}\.js)"/)?.[1];
const stylesPath = index.match(/href="(\/_sygma\/assets\/styles\.[a-f0-9]{12}\.css)"/)?.[1];
assert(appPath, "built index is missing a content-hashed app asset");
assert(stylesPath, "built index is missing a content-hashed stylesheet");

const appFile = resolve(client, "assets", basename(appPath));
const stylesFile = resolve(client, "assets", basename(stylesPath));
const [appStat, stylesStat, appBrotliStat, stylesBrotliStat, appGzipStat, stylesGzipStat, workerStat, sourceAppStat, sourceStylesStat] = await Promise.all([
  stat(appFile),
  stat(stylesFile),
  stat(resolve(client, "assets", `${basename(appPath)}.br`)),
  stat(resolve(client, "assets", `${basename(stylesPath)}.br`)),
  stat(resolve(client, "assets", `${basename(appPath)}.gz`)),
  stat(resolve(client, "assets", `${basename(stylesPath)}.gz`)),
  stat(resolve(root, "dist/server/index.js")),
  stat(resolve(root, "app.js")),
  stat(resolve(root, "styles.css")),
]);
assert(workerStat.size > 0, "Sites worker build is empty");
assert(serviceWorker.includes(appPath) && serviceWorker.includes(stylesPath), "service worker does not precache built assets");
assert(staticHeaders.includes("/_sygma/assets/*") && staticHeaders.includes("max-age=31536000, immutable"), "built static assets are missing immutable browser cache headers");
const builtBytes = appStat.size + stylesStat.size;
const brotliBytes = appBrotliStat.size + stylesBrotliStat.size;
const gzipBytes = appGzipStat.size + stylesGzipStat.size;
const sourceBytes = sourceAppStat.size + sourceStylesStat.size;
assert(builtBytes / sourceBytes <= 0.75, "built JS/CSS did not meet the size reduction target");
assert(brotliBytes / builtBytes <= 0.3, "Brotli assets did not meet the transfer-size target");
assert(gzipBytes / builtBytes <= 0.4, "gzip assets did not meet the transfer-size target");
const [app, styles, appBrotli, stylesBrotli, appGzip, stylesGzip] = await Promise.all([
  readFile(appFile),
  readFile(stylesFile),
  readFile(`${appFile}.br`),
  readFile(`${stylesFile}.br`),
  readFile(`${appFile}.gz`),
  readFile(`${stylesFile}.gz`),
]);
const [decodedAppBrotli, decodedStylesBrotli, decodedAppGzip, decodedStylesGzip] = await Promise.all([
  brotliDecompressAsync(appBrotli),
  brotliDecompressAsync(stylesBrotli),
  gunzipAsync(appGzip),
  gunzipAsync(stylesGzip),
]);
assert.deepEqual(decodedAppBrotli, app, "Brotli app asset is not reversible");
assert.deepEqual(decodedStylesBrotli, styles, "Brotli stylesheet asset is not reversible");
assert.deepEqual(decodedAppGzip, app, "gzip app asset is not reversible");
assert.deepEqual(decodedStylesGzip, styles, "gzip stylesheet asset is not reversible");
console.log(`Build check passed: ${sourceBytes} -> ${builtBytes} bytes (${brotliBytes} Brotli, ${gzipBytes} gzip).`);
