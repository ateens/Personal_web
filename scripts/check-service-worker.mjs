import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const path = process.argv[2] || "service-worker.js";
const source = await readFile(path, "utf8");
const origin = "https://sygma.example";

function worker(options = {}) {
  const handlers = new Map();
  const entries = new Map();
  const deleted = [];
  const required = [];
  const optional = [];
  const network = { offline: false, calls: 0 };
  let cacheName;
  const key = (request) => new URL(typeof request === "string" ? request : request.url, origin).href;
  vm.runInNewContext(source, {
    URL, Response,
    self: {
      location: { origin },
      registration: { scope: `${origin}/` },
      clients: { claim() {} },
      addEventListener: (name, handler) => handlers.set(name, handler),
    },
    caches: {
      async open(name) {
        cacheName = name;
        if (options.openFails) throw new Error("Cache storage unavailable");
        return {
          async match(request) { return entries.get(key(request))?.clone(); },
          async put(request, response) {
            if (options.putFails) throw new Error("Quota exceeded");
            entries.set(key(request), response.clone());
          },
          async addAll(assets) {
            required.push(...assets);
            if (options.requiredFails) throw new Error("Missing required asset");
          },
          async add(asset) { optional.push(asset); throw new Error("Optional asset unavailable"); },
        };
      },
      async keys() { return [cacheName, "sygma-old-version", "another-app-cache"]; },
      async delete(name) { deleted.push(name); },
      async match() { throw new Error("Reads must be scoped to this worker's cache"); },
    },
    async fetch(request) {
      network.calls += 1;
      if (network.offline) throw new Error("Offline");
      return new Response("fresh response", { headers: { "content-type": request.mode === "navigate" ? "text/html" : "text/javascript" } });
    },
  });
  return {
    required, optional, deleted, network, entries,
    async lifecycle(name) {
      let pending;
      handlers.get(name)({ waitUntil(value) { pending = value; } });
      await pending;
    },
    request(pathname, mode = "cors", method = "GET") {
      let response;
      handlers.get("fetch")({
        request: { url: new URL(pathname, origin).href, mode, method },
        respondWith(value) { response = value; },
      });
      return response;
    },
  };
}

const installed = worker();
await installed.lifecycle("install");
const katexCss = await readFile("node_modules/katex/dist/katex.min.css", "utf8");
const katexFonts = [...katexCss.matchAll(/url\((fonts\/[^)]+\.woff2)\)/g)].map((match) => `/assets/katex/${match[1]}`);
assert(katexFonts.length > 0, "KaTeX must declare local WOFF2 fonts");
const katexAssets = ["/assets/katex/katex.min.js", "/assets/katex/katex.min.css", "/assets/katex/contrib/mhchem.min.js", ...katexFonts];
const highlightAsset = "/assets/highlight/highlight.min.js";
const mermaidAsset = "/assets/mermaid/mermaid.min.js";
assert.equal(installed.required.length, 5 + katexAssets.length, "the shell, app, syntax highlighter, and all equation rendering assets are required");
assert(installed.required.includes(highlightAsset), "The syntax highlighter must be available offline");
assert(!installed.required.includes(mermaidAsset) && !installed.optional.includes(mermaidAsset), "The large Mermaid engine must load only when used");
for (const asset of katexAssets) assert(installed.required.includes(asset), `equation asset missing from offline cache: ${asset}`);
if (path.startsWith("dist/")) {
  const index = await readFile("dist/client/index.html", "utf8");
  for (const asset of installed.required.slice(1).filter((asset) => !asset.endsWith(".woff2"))) {
    assert(index.includes(`"${asset}"`), `precache asset absent from built HTML: ${asset}`);
  }
}
await installed.lifecycle("activate");
assert.deepEqual(installed.deleted, ["sygma-old-version"], "activation must preserve unrelated origin caches");
await assert.rejects(worker({ requiredFails: true }).lifecycle("install"), /Missing required asset/);

for (const options of [{ putFails: true }, { openFails: true }]) {
  for (const [url, mode] of [["/projects", "navigate"], ["/app.js", "cors"], ["/assets/app.abcdef123456.js", "cors"]]) {
    const response = await worker(options).request(url, mode);
    assert.equal(await response.text(), "fresh response", `${url}: cache failures must preserve the network response`);
  }
}

const offline = worker();
await offline.request("/projects", "navigate");
await offline.request("/assets/app.abcdef123456.js");
offline.network.offline = true;
assert.equal(await (await offline.request("/resources?selected=example", "navigate")).text(), "fresh response");
assert.equal(await (await offline.request("/assets/app.abcdef123456.js")).text(), "fresh response");
assert.equal((await offline.request("/missing.js")).type, "error");
assert.equal(offline.network.calls, 4, "immutable cache hits must not fetch again");
for (const url of ["/api", "/api/state", "/api/finance/state", "/health", "https://other.example/app.js"]) {
  assert.equal(offline.request(url), undefined, `${url} must bypass the worker`);
}
assert.equal(offline.request("/app.js", "cors", "POST"), undefined);
const offlineEquations = worker();
for (const asset of katexAssets) await offlineEquations.request(asset);
offlineEquations.network.offline = true;
for (const asset of katexAssets) {
  assert.equal(await (await offlineEquations.request(asset)).text(), "fresh response", `equation asset unavailable offline: ${asset}`);
}
const offlineCodeRenderers = worker();
for (const asset of [highlightAsset, mermaidAsset]) await offlineCodeRenderers.request(asset);
offlineCodeRenderers.network.offline = true;
for (const asset of [highlightAsset, mermaidAsset]) {
  assert.equal(await (await offlineCodeRenderers.request(asset)).text(), "fresh response", `Code renderer unavailable offline after its first use: ${asset}`);
}
console.log(`Service-worker install, isolation, offline, and cache-failure checks passed: ${path}.`);
