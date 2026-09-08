import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const clientDir = resolve(dist, "client");
const assetDir = resolve(clientDir, "assets");
const katexDir = resolve(root, "node_modules/katex/dist");

function contentHash(content) {
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
}

await rm(dist, { recursive: true, force: true });
await mkdir(assetDir, { recursive: true });

const [appSource, financeModelSource, stylesSource, indexSource, manifestSource, serviceWorkerSource] = await Promise.all([
  readFile(resolve(root, "app.js"), "utf8"),
  readFile(resolve(root, "finance-model.js"), "utf8"),
  readFile(resolve(root, "styles.css"), "utf8"),
  readFile(resolve(root, "index.html"), "utf8"),
  readFile(resolve(root, "manifest.json"), "utf8"),
  readFile(resolve(root, "service-worker.js"), "utf8"),
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

const katexFiles = [
  "katex.min.js",
  "katex.min.css",
  "contrib/mhchem.min.js",
  ...(await readdir(resolve(katexDir, "fonts"))).filter((name) => /\.(woff2|woff|ttf)$/.test(name)).sort().map((name) => `fonts/${name}`),
];
const katexContents = await Promise.all(katexFiles.map((name) => readFile(resolve(katexDir, name))));
await mkdir(resolve(assetDir, "katex/contrib"), { recursive: true });
await mkdir(resolve(assetDir, "katex/fonts"), { recursive: true });
await Promise.all(katexFiles.map((name, index) => writeFile(resolve(assetDir, "katex", name), katexContents[index])));
await cp(resolve(root, "node_modules/katex/LICENSE"), resolve(assetDir, "katex/LICENSE.txt"));
const katexAssets = katexFiles.filter((name) => !name.startsWith("fonts/") || name.endsWith(".woff2")).map((name) => `/assets/katex/${name}`);

const codeRendererFiles = [
  ["highlight/highlight.min.js", "node_modules/@highlightjs/cdn-assets/highlight.min.js", "node_modules/@highlightjs/cdn-assets/LICENSE"],
  ["mermaid/mermaid.min.js", "node_modules/mermaid/dist/mermaid.min.js", "node_modules/mermaid/LICENSE"],
];
const codeRendererContents = await Promise.all(codeRendererFiles.map(([, source]) => readFile(resolve(root, source))));
await Promise.all(codeRendererFiles.map(async ([file, , license], index) => {
  const target = resolve(assetDir, file);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, codeRendererContents[index]);
  await cp(resolve(root, license), resolve(dirname(target), "LICENSE.txt"));
}));

const builtIndex = indexSource
  .replace('href="/styles.css"', `href="${stylesPath}"`)
  .replace('src="/finance-model.js"', `src="${financeModelPath}"`)
  .replace('src="/app.js"', `src="${appPath}"`)
  .replace("</head>", `    <link rel="preload" href="${financeModelPath}" as="script">\n    <link rel="preload" href="${appPath}" as="script">\n  </head>`);
const manifest = JSON.parse(manifestSource);
const cacheId = contentHash(`${builtIndex}\n${manifestSource}\n${serviceWorkerSource}\n${contentHash(Buffer.concat([...katexContents, ...codeRendererContents]))}`);
const requiredAssets = [
  "/index.html",
  stylesPath,
  financeModelPath,
  appPath,
  "/assets/highlight/highlight.min.js",
  ...katexAssets,
];
const optionalAssets = [
  "/manifest.json",
  "/icons/app-icon.svg",
  "/assets/sygma-social-preview.png",
];

const workerSource = serviceWorkerSource
  .replace(/^const CACHE_NAME = .*;$/m, `const CACHE_NAME = ${JSON.stringify(`sygma-${cacheId}`)};`)
  .replace(/^const REQUIRED_ASSETS = \[[\s\S]*?\];/m, `const REQUIRED_ASSETS = ${JSON.stringify(requiredAssets)};`)
  .replace(/^const OPTIONAL_ASSETS = \[[\s\S]*?\];/m, `const OPTIONAL_ASSETS = ${JSON.stringify(optionalAssets)};`);
const workerBuild = await transform(workerSource, { loader: "js", minify: true, target: "es2022", charset: "utf8" });

await Promise.all([
  writeFile(resolve(clientDir, "index.html"), builtIndex),
  writeFile(resolve(clientDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`),
  writeFile(resolve(clientDir, "service-worker.js"), workerBuild.code),
  cp(resolve(root, "icons"), resolve(clientDir, "icons"), { recursive: true }),
  cp(resolve(root, "assets/sygma-social-preview.png"), resolve(clientDir, "assets/sygma-social-preview.png")),
]);

const originalBytes = Buffer.byteLength(appSource) + Buffer.byteLength(financeModelSource) + Buffer.byteLength(stylesSource);
const builtBytes = Buffer.byteLength(appBuild.code) + Buffer.byteLength(financeModelBuild.code) + Buffer.byteLength(stylesBuild.code);
console.log(`Built SYGMA assets: ${originalBytes} -> ${builtBytes} bytes (${Math.round((builtBytes / originalBytes) * 100)}%).`);
console.log(`Bundled local KaTeX assets: ${katexContents.reduce((total, content) => total + content.byteLength, 0)} bytes; ${katexAssets.length} engine, style, and WOFF2 assets precached.`);
console.log(`Bundled local code renderers: highlight.js ${codeRendererContents[0].byteLength} bytes; Mermaid ${codeRendererContents[1].byteLength} bytes (loaded and cached on first use).`);
