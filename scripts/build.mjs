import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, transform } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const clientDir = resolve(dist, "client");
const assetDir = resolve(clientDir, "assets");

function contentHash(content) {
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
}

function builtServiceWorker(cacheName, assets) {
  return `const CACHE_NAME=${JSON.stringify(cacheName)};const ASSETS=${JSON.stringify(assets)};
self.addEventListener("install",event=>{event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(ASSETS)));self.skipWaiting()});
self.addEventListener("activate",event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE_NAME).map(key=>caches.delete(key)))).then(()=>self.clients.claim()))});
const canCache=response=>response&&response.status===200&&response.type!=="opaque";
const cacheFirst=request=>caches.match(request).then(cached=>cached||fetch(request).then(response=>{if(canCache(response)){const copy=response.clone();caches.open(CACHE_NAME).then(cache=>cache.put(request,copy))}return response}));
const networkFirst=request=>fetch(request,{cache:"no-store"}).then(response=>{if(canCache(response)){const copy=response.clone();caches.open(CACHE_NAME).then(cache=>cache.put(request,copy))}return response}).catch(()=>caches.match(request).then(cached=>cached||Response.error()));
self.addEventListener("fetch",event=>{if(event.request.method!=="GET")return;const url=new URL(event.request.url);if(url.origin!==self.location.origin||url.pathname.startsWith("/api/"))return;const immutable=url.pathname.startsWith("/_sygma/assets/")||url.pathname.startsWith("/assets/")||url.pathname.startsWith("/icons/");event.respondWith(immutable?cacheFirst(event.request):networkFirst(event.request))});
`;
}

function staticHeaders() {
  return `/_sygma/assets/*
  Cache-Control: public, max-age=31536000, immutable

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/
  Cache-Control: no-store

/index.html
  Cache-Control: no-store

/service-worker.js
  Cache-Control: no-store

/manifest.json
  Cache-Control: no-store

/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: same-origin
  X-Frame-Options: SAMEORIGIN
`;
}

await rm(dist, { recursive: true, force: true });
await mkdir(assetDir, { recursive: true });

const [appSource, stylesSource, indexSource, manifestSource] = await Promise.all([
  readFile(resolve(root, "app.js"), "utf8"),
  readFile(resolve(root, "styles.css"), "utf8"),
  readFile(resolve(root, "index.html"), "utf8"),
  readFile(resolve(root, "manifest.json"), "utf8"),
]);

const [appBuild, stylesBuild] = await Promise.all([
  transform(appSource, { loader: "js", minify: true, target: "es2022", charset: "utf8" }),
  transform(stylesSource, { loader: "css", minify: true, target: "es2022", charset: "utf8" }),
]);

const appFile = `app.${contentHash(appBuild.code)}.js`;
const stylesFile = `styles.${contentHash(stylesBuild.code)}.css`;
const appPath = `/_sygma/assets/${appFile}`;
const stylesPath = `/_sygma/assets/${stylesFile}`;
await Promise.all([
  writeFile(resolve(assetDir, appFile), appBuild.code),
  writeFile(resolve(assetDir, stylesFile), stylesBuild.code),
]);

const builtIndex = indexSource
  .replace(/\.\/styles\.css\?v=[^"']+/, stylesPath)
  .replace(/\.\/app\.js\?v=[^"']+/, appPath)
  .replace("</head>", `    <link rel="preload" href="${appPath}" as="script">\n  </head>`);
const manifest = JSON.parse(manifestSource);
manifest.start_url = "/";
manifest.scope = "/";
const cacheId = contentHash(`${appBuild.code}\n${stylesBuild.code}`);
const precacheAssets = ["/index.html", stylesPath, appPath, "/manifest.json", "/icons/app-icon.svg"];

await Promise.all([
  writeFile(resolve(clientDir, "index.html"), builtIndex),
  writeFile(resolve(clientDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`),
  writeFile(resolve(clientDir, "service-worker.js"), builtServiceWorker(`sygma-${cacheId}`, precacheAssets)),
  writeFile(resolve(clientDir, "_headers"), staticHeaders()),
  cp(resolve(root, "icons"), resolve(clientDir, "icons"), { recursive: true }),
]);

await build({
  entryPoints: [resolve(root, "worker/index.js")],
  outfile: resolve(dist, "server/index.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  logLevel: "warning",
});

await mkdir(resolve(dist, ".openai"), { recursive: true });
await cp(resolve(root, ".openai/hosting.json"), resolve(dist, ".openai/hosting.json"));

const originalBytes = Buffer.byteLength(appSource) + Buffer.byteLength(stylesSource);
const builtBytes = Buffer.byteLength(appBuild.code) + Buffer.byteLength(stylesBuild.code);
console.log(`Built SYGMA assets: ${originalBytes} -> ${builtBytes} bytes (${Math.round((builtBytes / originalBytes) * 100)}%).`);
