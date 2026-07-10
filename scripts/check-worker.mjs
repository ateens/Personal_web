import assert from "node:assert/strict";
import worker from "../worker/index.js";

const originalFetch = globalThis.fetch;
let proxiedUrl = "";
let proxiedMethod = "";

try {
  globalThis.fetch = async (input, init = {}) => {
    proxiedUrl = String(input);
    proxiedMethod = init.method || "GET";
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json", location: "/api/state/status" },
    });
  };

  const apiResponse = await worker.fetch(new Request("https://sygma.example/api/state"), {});
  assert.equal(apiResponse.status, 200);
  assert.equal(proxiedUrl, "https://personalweb-production-81a6.up.railway.app/api/state");
  assert.equal(proxiedMethod, "GET");
  assert.equal(apiResponse.headers.get("x-sygma-backend"), "postgresql");
  assert.equal(apiResponse.headers.get("location"), "https://sygma.example/api/state/status");

  const assetRequests = [];
  const env = {
    ASSETS: {
      async fetch(request) {
        const url = new URL(request.url);
        assetRequests.push(url.pathname);
        if (url.pathname === "/missing") return new Response("missing", { status: 404 });
        return new Response("asset", { status: 200, headers: { "content-type": "text/html" } });
      },
    },
  };
  const assetResponse = await worker.fetch(new Request("https://sygma.example/_sygma/assets/app.1234567890ab.js", {
    headers: { "accept-encoding": "br, gzip" },
  }), env);
  assert.equal(assetResponse.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(assetResponse.headers.get("x-content-type-options"), "nosniff");
  assert.equal(assetResponse.headers.get("content-encoding"), "br");
  assert.equal(assetResponse.headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.match(assetResponse.headers.get("vary"), /Accept-Encoding/i);
  assert.equal(assetRequests.at(-1), "/assets/app.1234567890ab.js.br");

  const gzipResponse = await worker.fetch(new Request("https://sygma.example/_sygma/assets/styles.1234567890ab.css", {
    headers: { "accept-encoding": "gzip" },
  }), env);
  assert.equal(gzipResponse.headers.get("content-encoding"), "gzip");
  assert.equal(gzipResponse.headers.get("content-type"), "text/css; charset=utf-8");
  assert.equal(assetRequests.at(-1), "/assets/styles.1234567890ab.css.gz");

  const fallbackResponse = await worker.fetch(new Request("https://sygma.example/missing", { headers: { accept: "text/html" } }), env);
  assert.equal(fallbackResponse.status, 200);
  assert.deepEqual(assetRequests.slice(-2), ["/missing", "/index.html"]);

  const rejected = await worker.fetch(new Request("https://sygma.example/file", { method: "POST" }), env);
  assert.equal(rejected.status, 405);
  console.log("Sites worker check passed.");
} finally {
  globalThis.fetch = originalFetch;
}
