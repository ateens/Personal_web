import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer, get } from "node:http";
import { join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { brotliCompress, brotliDecompressSync, constants as zlibConstants, gzip, gunzipSync } from "node:zlib";

const source = await readFile(new URL("../server.js", import.meta.url), "utf8");
function serverFunction(name, globals = {}) {
  const match = source.match(new RegExp(`^(?:async )?function ${name}\\([^]*?^}`, "m"));
  assert(match, `Missing server function: ${name}`);
  return vm.runInNewContext(`(${match[0]})`, { URLSearchParams, ...globals });
}

const responseEncoding = serverFunction("responseEncoding", { compressibleExtensions: new Set([".js", ".json"]) });
for (const [accepted, expected] of [
  ["br, gzip", "br"],
  ["br;q=0, gzip;q=1", "gzip"],
  ["br;q=0.3, gzip;q=0.8", "gzip"],
  ["br;q=0, gzip;q=0", ""],
  ["identity;q=1, br;q=0.5", ""],
  ["*;q=0.5, br;q=0", "gzip"],
  ["notbr, notgzip", ""],
  ["br;q=invalid, gzip;q=0.5", "gzip"],
  ["", ""],
]) {
  assert.equal(responseEncoding({ headers: { "accept-encoding": accepted } }, ".js", 2048), expected, accepted);
}
assert.equal(responseEncoding({ headers: { "accept-encoding": "br" } }, ".js", 20), "");

const jsonGlobals = { Buffer, responseEncoding, brotliCompress, gzip, zlibConstants };
const sendJson = serverFunction("sendJson", jsonGlobals);
const payload = { resources: [{ id: "sample", content: "수식과 본문 데이터 \\mathbb{R} ".repeat(200) }] };
const jsonServer = createServer((request, response) => {
  sendJson(response, 200, request.url === "/small" ? { ok: true } : payload, { ETag: '"state-7"', "X-State-Revision": "7" });
});
await new Promise((resolve) => jsonServer.listen(0, "127.0.0.1", resolve));
try {
  for (const [accepted, expected, path] of [
    ["br, gzip", "br", "/"], ["gzip", "gzip", "/"],
    ["br;q=0, gzip;q=0", undefined, "/"], ["identity", undefined, "/"],
    ["br, gzip", undefined, "/small"],
  ]) {
    const result = await new Promise((resolve, reject) => {
      get({ hostname: "127.0.0.1", port: jsonServer.address().port, path, headers: { "Accept-Encoding": accepted } }, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("error", reject);
        response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
      }).on("error", reject);
    });
    assert.equal(result.status, 200);
    assert.equal(result.headers["content-encoding"], expected);
    assert.equal(result.headers["content-length"], String(result.body.length));
    assert.equal(result.headers.vary, "Accept-Encoding");
    assert.equal(result.headers["cache-control"], "no-store");
    assert.equal(result.headers.etag, '"state-7"');
    assert.equal(result.headers["x-state-revision"], "7");
    const decoded = expected === "br" ? brotliDecompressSync(result.body) : expected === "gzip" ? gunzipSync(result.body) : result.body;
    assert.deepEqual(JSON.parse(decoded.toString()), path === "/small" ? { ok: true } : payload);
    if (expected) assert(result.body.length < decoded.length, "Compression must reduce wire bytes");
  }
} finally {
  await new Promise((resolve, reject) => jsonServer.close((error) => error ? reject(error) : resolve()));
}

// Compression errors and disconnected clients must not lose a valid response or write twice.
for (const fail of [true, false]) {
  let written = 0;
  const fallbackSend = serverFunction("sendJson", {
    ...jsonGlobals,
    gzip: (body, options, callback) => callback(fail ? new Error("compression failed") : null, Buffer.alloc(body.length + 1)),
  });
  const response = {
    req: { headers: { "accept-encoding": "gzip" } },
    writeHead: (status, headers) => { written++; assert.equal(status, 409); assert.equal(headers["Content-Encoding"], undefined); },
    end: (body) => assert.deepEqual(JSON.parse(body.toString()), payload),
  };
  fallbackSend(response, 409, payload);
  assert.equal(written, 1);
  fallbackSend({ ...response, destroyed: true }, 409, payload);
  fallbackSend({ ...response, writableEnded: true }, 409, payload);
  assert.equal(written, 1);
}

const sourceRoot = fileURLToPath(new URL("..", import.meta.url));
const sourcePaths = {
  URL, host: "127.0.0.1", port: 43128, normalize, resolve, join, sep,
  root: sourceRoot, sourceStaticRoot: resolve(sourceRoot), staticRoot: resolve(sourceRoot),
  sourceStaticFiles: new Set(["/index.html", "/app.js"]),
};
const resolveRequestPath = serverFunction("resolveRequestPath", sourcePaths);
const katexCss = await readFile(new URL("../node_modules/katex/dist/katex.min.css", import.meta.url), "utf8");
const katexFiles = ["katex.min.js", "katex.min.css", "contrib/mhchem.min.js", ...[...katexCss.matchAll(/url\(([^)]+)\)/g)].map((match) => match[1])];
for (const file of katexFiles) {
  assert.equal(resolveRequestPath(`/assets/katex/${file}`), resolve(sourceRoot, "node_modules/katex/dist", file));
}
for (const [path, file] of [
  ["/assets/highlight/highlight.min.js", "node_modules/@highlightjs/cdn-assets/highlight.min.js"],
  ["/assets/mermaid/mermaid.min.js", "node_modules/mermaid/dist/mermaid.min.js"],
]) assert.equal(resolveRequestPath(path), resolve(sourceRoot, file));
for (const path of ["/node_modules/katex/package.json", "/assets/katex/package.json", "/assets/katex/katex.js", "/assets/katex/contrib/auto-render.min.js", "/assets/katex/katex.min.js.map", "/assets/katex/fonts/unknown.woff2"]) {
  assert.equal(resolveRequestPath(path), "", `source route must not expose other dependency files: ${path}`);
}
for (const path of ["/assets/mermaid/package.json", "/assets/mermaid/mermaid.esm.min.mjs", "/assets/mermaid/mermaid.min.js.map", "/assets/highlight/package.json", "/assets/highlight/languages/javascript.min.js"]) {
  assert.equal(resolveRequestPath(path), "", `Source route must not expose other renderer files: ${path}`);
}
const hasForbiddenRequestPath = serverFunction("hasForbiddenRequestPath", {
  decodedRawRequestPath: serverFunction("decodedRawRequestPath", sourcePaths),
});
for (const path of ["/assets/katex/../katex/katex.min.js", "/assets/katex/%2e%2e/package.json", "/assets/katex/fonts%5cKaTeX_Main-Regular.woff2"]) {
  assert.equal(hasForbiddenRequestPath(path), true, `unsafe dependency path must be rejected: ${path}`);
}

const calls = [];
const listGoogleCalendarEvents = serverFunction("listGoogleCalendarEvents", {
  googleFetch: async (path) => {
    calls.push(new URL(path, "https://www.googleapis.com"));
    return calls.length === 1
      ? { items: [{ id: "first" }], nextPageToken: "second/page" }
      : { items: [{ id: "second" }] };
  },
});
const query = new URLSearchParams({ timeMin: "2026-01-01T00:00:00Z", maxResults: "2500" });
assert.deepEqual(Array.from(await listGoogleCalendarEvents("a/b", query)), [{ id: "first" }, { id: "second" }]);
assert.equal(calls[1].pathname, "/calendars/a%2Fb/events");
assert.equal(calls[1].searchParams.get("pageToken"), "second/page");
assert.equal(calls[1].searchParams.get("timeMin"), query.get("timeMin"));
assert.equal(query.has("pageToken"), false, "Concurrent calendars must not mutate their shared query");

let sent = false;
const handleGoogleCalendarData = serverFunction("handleGoogleCalendarData", {
  listGoogleCalendars: async () => [{ id: "ok" }, { id: "failed" }],
  listGoogleCalendarEvents: async (id) => {
    if (id === "failed") throw new Error("temporary Google failure");
    return [{ id: "event" }];
  },
  sendJson: () => { sent = true; },
});
await assert.rejects(
  handleGoogleCalendarData(new URL("https://example.test/api/google/calendar-data?timeMin=start&timeMax=end"), {}),
  /temporary Google failure/,
);
assert.equal(sent, false, "Partial Google results must not overwrite the client's complete event snapshot");
console.log("Server encoding, constrained equation assets, Google pagination, and failed-refresh preservation checks passed.");
