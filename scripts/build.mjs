import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const clientDir = resolve(dist, "client");
const assetDir = resolve(clientDir, "assets");

function contentHash(content) {
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
}

function builtServiceWorker(cacheName, assets) {
  return `const CACHE_NAME=${JSON.stringify(cacheName)};const ASSETS=${JSON.stringify(assets)};const APP_SHELL_URL="/index.html";
self.addEventListener("install",event=>{event.waitUntil(caches.open(CACHE_NAME).then(async cache=>{await cache.addAll(ASSETS.slice(0,4));await Promise.allSettled(ASSETS.slice(4).map(asset=>cache.add(asset)))}))});
self.addEventListener("activate",event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE_NAME).map(key=>caches.delete(key)))).then(()=>self.clients.claim()))});
self.addEventListener("message",event=>{if(event.data?.type==="SKIP_WAITING")self.skipWaiting()});
const canCache=response=>response&&response.status===200&&response.type!=="opaque";
const cacheFirst=async request=>{const cached=await caches.match(request);if(cached)return cached;const response=await fetch(request);if(canCache(response)){const cache=await caches.open(CACHE_NAME);await cache.put(request,response.clone())}return response};
const networkFirst=async request=>{try{const response=await fetch(request,{cache:"no-store"});if(canCache(response)){const cache=await caches.open(CACHE_NAME);await cache.put(request,response.clone())}return response}catch{return await caches.match(request)||Response.error()}};
const navigationFirst=async request=>{try{const response=await fetch(request,{cache:"no-store"});if(canCache(response)&&(response.headers.get("content-type")||"").includes("text/html")){const cache=await caches.open(CACHE_NAME);await cache.put(APP_SHELL_URL,response.clone())}return response}catch{return await caches.match(APP_SHELL_URL)||Response.error()}};
self.addEventListener("fetch",event=>{if(event.request.method!=="GET")return;const url=new URL(event.request.url);if(url.origin!==self.location.origin||url.pathname.startsWith("/api/"))return;if(event.request.mode==="navigate"){event.respondWith(navigationFirst(event.request));return}const immutable=/^\\/assets\\/[^/]+\\.[a-f0-9]{10,}\\./.test(url.pathname);event.respondWith(immutable?cacheFirst(event.request):networkFirst(event.request))});
`;
}

await rm(dist, { recursive: true, force: true });
await mkdir(assetDir, { recursive: true });

const [appSource, financeModelSource, stylesSource, indexSource, manifestSource] = await Promise.all([
  readFile(resolve(root, "app.js"), "utf8"),
  readFile(resolve(root, "finance-model.js"), "utf8"),
  readFile(resolve(root, "styles.css"), "utf8"),
  readFile(resolve(root, "index.html"), "utf8"),
  readFile(resolve(root, "manifest.json"), "utf8"),
]);

const [appBuild, financeModelBuild, stylesBuild] = await Promise.all([
  transform(appSource, { loader: "js", minify: true, target: "es2022", charset: "utf8" }),
  transform(financeModelSource, { loader: "js", minify: true, target: "es2022", charset: "utf8" }),
  transform(stylesSource, { loader: "css", minify: true, target: "es2022", charset: "utf8" }),
]);

const appFile = `app.${contentHash(appBuild.code)}.js`;
const financeModelFile = `finance-model.${contentHash(financeModelBuild.code)}.js`;
const stylesFile = `styles.${contentHash(stylesBuild.code)}.css`;
const appPath = `/assets/${appFile}`;
const financeModelPath = `/assets/${financeModelFile}`;
const stylesPath = `/assets/${stylesFile}`;
await Promise.all([
  writeFile(resolve(assetDir, appFile), appBuild.code),
  writeFile(resolve(assetDir, financeModelFile), financeModelBuild.code),
  writeFile(resolve(assetDir, stylesFile), stylesBuild.code),
]);

const builtIndex = indexSource
  .replace('href="/styles.css"', `href="${stylesPath}"`)
  .replace('src="/finance-model.js"', `src="${financeModelPath}"`)
  .replace('src="/app.js"', `src="${appPath}"`)
  .replace("</head>", `    <link rel="preload" href="${financeModelPath}" as="script">\n    <link rel="preload" href="${appPath}" as="script">\n  </head>`);
const manifest = JSON.parse(manifestSource);
const cacheId = contentHash(`${appPath}\n${financeModelPath}\n${stylesPath}`);
const precacheAssets = [
  "/index.html",
  stylesPath,
  financeModelPath,
  appPath,
  "/manifest.json",
  "/icons/app-icon.svg",
  "/assets/sygma-social-preview.png",
];

await Promise.all([
  writeFile(resolve(clientDir, "index.html"), builtIndex),
  writeFile(resolve(clientDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`),
  writeFile(resolve(clientDir, "service-worker.js"), builtServiceWorker(`sygma-${cacheId}`, precacheAssets)),
  cp(resolve(root, "icons"), resolve(clientDir, "icons"), { recursive: true }),
  cp(resolve(root, "assets/sygma-social-preview.png"), resolve(clientDir, "assets/sygma-social-preview.png")),
]);

const originalBytes = Buffer.byteLength(appSource) + Buffer.byteLength(financeModelSource) + Buffer.byteLength(stylesSource);
const builtBytes = Buffer.byteLength(appBuild.code) + Buffer.byteLength(financeModelBuild.code) + Buffer.byteLength(stylesBuild.code);
console.log(`Built SYGMA assets: ${originalBytes} -> ${builtBytes} bytes (${Math.round((builtBytes / originalBytes) * 100)}%).`);
