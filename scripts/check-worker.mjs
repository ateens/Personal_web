import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import worker from "../worker/index.js";

const GOOGLE_OAUTH_COOKIE_FOR_TEST = "sygma_google_oauth_state";
const originalFetch = globalThis.fetch;
const OriginalResponse = globalThis.Response;
let proxiedUrl = "";
let proxiedMethod = "";
let proxiedHeaders = new Headers();
let responseEncodeBody = "";
let upstreamResponseHeaders = { "content-type": "application/json", location: "/api/state/status" };
let upstreamCalls = 0;

try {
  globalThis.Response = class extends OriginalResponse {
    constructor(body, init = {}) {
      super(body, init);
      responseEncodeBody = init.encodeBody || "";
    }
  };
  globalThis.fetch = async (input, init = {}) => {
    upstreamCalls += 1;
    proxiedUrl = String(input);
    proxiedMethod = init.method || "GET";
    proxiedHeaders = new Headers(init.headers);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: upstreamResponseHeaders,
    });
  };

  const apiResponse = await worker.fetch(new Request("https://sygma.example/api/state", {
    headers: {
      authorization: "Bearer browser-controlled-token",
      cookie: "sites-session=browser-controlled-cookie",
      "oai-authenticated-user-email": "spoofed@example.com",
      "x-authenticated-user-email": "spoofed@example.com",
      "x-forwarded-user": "spoofed@example.com",
      "x-sygma-authenticated-user-email": "spoofed@example.com",
    },
  }), {});
  assert.equal(apiResponse.status, 200);
  assert.equal(proxiedUrl, "https://personalweb-production-81a6.up.railway.app/api/state");
  assert.equal(proxiedMethod, "GET");
  assert.equal(proxiedHeaders.get("authorization"), null);
  assert.equal(proxiedHeaders.get("cookie"), null);
  assert.equal(proxiedHeaders.get("oai-authenticated-user-email"), null);
  assert.equal(proxiedHeaders.get("x-authenticated-user-email"), null);
  assert.equal(proxiedHeaders.get("x-forwarded-user"), null);
  assert.equal(proxiedHeaders.get("x-sygma-authenticated-user-email"), null);
  assert.equal(proxiedHeaders.get("x-forwarded-host"), "sygma.example");
  assert.equal(proxiedHeaders.get("x-forwarded-proto"), "https");
  assert.equal(apiResponse.headers.get("x-sygma-backend"), "postgresql");
  assert.equal(apiResponse.headers.get("location"), "https://sygma.example/api/state/status");

  const oauthState = "oauth_state_nonce_1234567890abcd";
  upstreamResponseHeaders = { "content-type": "text/html", location: "/?google=connected&googlePopup=1" };
  const oauthCallbackResponse = await worker.fetch(new Request("https://sygma.example/api/google/oauth/callback?state=test&code=test", {
    headers: {
      cookie: `sites-session=private; ${GOOGLE_OAUTH_COOKIE_FOR_TEST}=${oauthState}; analytics=discarded`,
      "x-forwarded-host": "attacker.example",
      "x-forwarded-proto": "http",
    },
  }), {});
  assert.equal(oauthCallbackResponse.status, 200);
  assert.equal(proxiedHeaders.get("cookie"), `${GOOGLE_OAUTH_COOKIE_FOR_TEST}=${oauthState}`);
  assert.equal(proxiedHeaders.get("x-forwarded-host"), "sygma.example");
  assert.equal(proxiedHeaders.get("x-forwarded-proto"), "https");
  assert.equal(oauthCallbackResponse.headers.get("location"), "https://sygma.example/?google=connected&googlePopup=1");

  await worker.fetch(new Request("https://sygma.example/api/google/oauth/callback?state=test&code=test", {
    headers: { cookie: `${GOOGLE_OAUTH_COOKIE_FOR_TEST}=invalid.value; sites-session=discarded` },
  }), {});
  assert.equal(proxiedHeaders.get("cookie"), null);

  const proxySecret = "server-only-secret";
  const handoffSecret = "worker-handoff-secret-0123456789abcdef0123456789abcdef";
  const googleStartUpstreamCalls = upstreamCalls;
  const anonymousGoogleStartWithoutProxy = await worker.fetch(new Request(
    "https://sygma.example/api/google/auth/start?returnTo=%2F%3Fview%3Dcalendar",
  ), {
    API_BEARER_TOKEN: proxySecret,
    GOOGLE_OAUTH_HANDOFF_SECRET: handoffSecret,
  });
  assert.equal(anonymousGoogleStartWithoutProxy.status, 401);
  assert.equal((await anonymousGoogleStartWithoutProxy.json()).code, "AUTHENTICATED_SITE_USER_REQUIRED");
  assert.equal(upstreamCalls, googleStartUpstreamCalls);

  const identifiedGoogleStartWithoutProxy = await worker.fetch(new Request(
    "https://sygma.example/api/google/auth/start?returnTo=%2F%3Fview%3Dcalendar",
    { headers: { "oai-authenticated-user-email": "person@example.com" } },
  ), {
    API_BEARER_TOKEN: proxySecret,
    GOOGLE_OAUTH_HANDOFF_SECRET: handoffSecret,
  });
  assert.equal(identifiedGoogleStartWithoutProxy.status, 503);
  assert.equal((await identifiedGoogleStartWithoutProxy.json()).code, "AUTHENTICATED_PROXY_NOT_CONFIGURED");
  assert.equal(upstreamCalls, googleStartUpstreamCalls);

  const anonymousGoogleStart = await worker.fetch(new Request(
    "https://sygma.example/api/google/auth/start?returnTo=%2F%3Fview%3Dcalendar%26googlePopup%3D1",
  ), {
    REQUIRE_AUTHENTICATED_PROXY: "1",
    API_BEARER_TOKEN: proxySecret,
    GOOGLE_OAUTH_HANDOFF_SECRET: handoffSecret,
  });
  assert.equal(anonymousGoogleStart.status, 401);
  assert.equal((await anonymousGoogleStart.json()).code, "AUTHENTICATED_SITE_USER_REQUIRED");
  assert.equal(upstreamCalls, googleStartUpstreamCalls);

  const missingHandoffSecret = await worker.fetch(new Request(
    "https://sygma.example/api/google/auth/start?returnTo=%2F%3Fview%3Dcalendar%26googlePopup%3D1",
    { headers: { "oai-authenticated-user-email": "person@example.com" } },
  ), {
    REQUIRE_AUTHENTICATED_PROXY: "1",
    API_BEARER_TOKEN: proxySecret,
  });
  assert.equal(missingHandoffSecret.status, 503);
  assert.equal((await missingHandoffSecret.json()).code, "GOOGLE_OAUTH_HANDOFF_NOT_CONFIGURED");
  assert.equal(upstreamCalls, googleStartUpstreamCalls);

  const googleRedirectResponse = await worker.fetch(new Request(
    "https://sygma.example/api/google/auth/start?returnTo=%2F%3Fview%3Dcalendar%26googlePopup%3D1",
    { headers: { "oai-authenticated-user-email": "  Person@Example.COM  " } },
  ), {
    REQUIRE_AUTHENTICATED_PROXY: "1",
    API_BEARER_TOKEN: proxySecret,
    GOOGLE_OAUTH_HANDOFF_SECRET: handoffSecret,
    API_ORIGIN: "https://railway.example/",
  });
  assert.equal(googleRedirectResponse.status, 302);
  const googleStartLocation = new URL(googleRedirectResponse.headers.get("location"));
  assert.equal(googleStartLocation.origin, "https://railway.example");
  assert.equal(googleStartLocation.pathname, "/api/google/auth/start");
  assert.deepEqual([...googleStartLocation.searchParams.keys()], ["handoff"]);
  const handoff = googleStartLocation.searchParams.get("handoff");
  const [payloadPart, signaturePart] = handoff.split(".");
  const handoffPayload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
  assert.equal(handoffPayload.v, 1);
  assert.equal(handoffPayload.aud, "google-oauth-start");
  assert(Math.abs(handoffPayload.iat - Math.floor(Date.now() / 1_000)) <= 5);
  assert.equal(handoffPayload.exp - handoffPayload.iat, 120);
  assert.match(handoffPayload.nonce, /^[A-Za-z0-9_-]{32}$/);
  assert.match(handoffPayload.sub, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(
    handoffPayload.sub,
    createHmac("sha256", handoffSecret)
      .update("sygma-google-oauth-user-v1.person@example.com", "utf8")
      .digest("base64url"),
  );
  assert.equal(handoffPayload.returnTo, "/?view=calendar&googlePopup=1");
  assert.equal(
    signaturePart,
    createHmac("sha256", handoffSecret)
      .update(`sygma-google-oauth-handoff-v1.${payloadPart}`, "utf8")
      .digest("base64url"),
  );
  assert.equal(googleRedirectResponse.headers.get("referrer-policy"), "no-referrer");
  assert.equal(googleRedirectResponse.headers.get("cache-control"), "no-store");
  assert.equal(upstreamCalls, googleStartUpstreamCalls);

  const anonymousCallCount = upstreamCalls;
  const anonymousResponse = await worker.fetch(new Request("https://sygma.example/api/state"), {
    REQUIRE_AUTHENTICATED_PROXY: "true",
    API_BEARER_TOKEN: "server-only-secret",
  });
  assert.equal(anonymousResponse.status, 401);
  assert.equal((await anonymousResponse.json()).code, "AUTHENTICATED_SITE_USER_REQUIRED");
  assert.equal(upstreamCalls, anonymousCallCount);

  const missingSecretCallCount = upstreamCalls;
  const missingSecretResponse = await worker.fetch(new Request("https://sygma.example/api/state", {
    headers: { "oai-authenticated-user-email": "person@example.com" },
  }), {
    REQUIRE_AUTHENTICATED_PROXY: "1",
  });
  assert.equal(missingSecretResponse.status, 503);
  assert.equal((await missingSecretResponse.json()).code, "AUTHENTICATED_PROXY_NOT_CONFIGURED");
  assert.equal(upstreamCalls, missingSecretCallCount);

  upstreamResponseHeaders = {
    authorization: `Bearer ${proxySecret}`,
    "content-type": "application/json",
    "x-api-key": proxySecret,
  };
  const authenticatedResponse = await worker.fetch(new Request("https://sygma.example/api/state", {
    headers: {
      authorization: "Bearer browser-controlled-token",
      "oai-authenticated-user-email": "  Person@Example.COM  ",
      "x-sygma-authenticated-user-email": "spoofed@example.com",
    },
  }), {
    REQUIRE_AUTHENTICATED_PROXY: "yes",
    API_BEARER_TOKEN: proxySecret,
  });
  assert.equal(authenticatedResponse.status, 200);
  assert.equal(proxiedHeaders.get("authorization"), `Bearer ${proxySecret}`);
  assert.equal(proxiedHeaders.get("oai-authenticated-user-email"), null);
  assert.equal(proxiedHeaders.get("x-sygma-authenticated-user-email"), "person@example.com");
  assert.equal(authenticatedResponse.headers.get("authorization"), null);
  assert.equal(authenticatedResponse.headers.get("x-api-key"), null);
  assert.equal(await authenticatedResponse.text(), JSON.stringify({ ok: true }));
  assert.equal(JSON.stringify([...authenticatedResponse.headers]).includes(proxySecret), false);
  upstreamResponseHeaders = { "content-type": "application/json", location: "/api/state/status" };

  const assetRequests = [];
  const env = {
    ASSETS: {
      async fetch(request) {
        const url = new URL(request.url);
        assetRequests.push(url.pathname);
        if (["/missing", "/resources/resource-1", "/missing.js"].includes(url.pathname)) {
          return new Response("missing", { status: 404 });
        }
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
  assert.equal(responseEncodeBody, "manual");

  const gzipResponse = await worker.fetch(new Request("https://sygma.example/_sygma/assets/styles.1234567890ab.css", {
    headers: { "accept-encoding": "gzip" },
  }), env);
  assert.equal(gzipResponse.headers.get("content-encoding"), "gzip");
  assert.equal(gzipResponse.headers.get("content-type"), "text/css; charset=utf-8");
  assert.equal(assetRequests.at(-1), "/assets/styles.1234567890ab.css.gz");

  const fallbackResponse = await worker.fetch(new Request("https://sygma.example/missing", { headers: { accept: "text/html" } }), env);
  assert.equal(fallbackResponse.status, 200);
  assert.deepEqual(assetRequests.slice(-2), ["/missing", "/index.html"]);

  const headFallbackResponse = await worker.fetch(new Request("https://sygma.example/resources/resource-1", {
    method: "HEAD",
    headers: { accept: "text/html" },
  }), env);
  assert.equal(headFallbackResponse.status, 200);
  assert.deepEqual(assetRequests.slice(-2), ["/resources/resource-1", "/index.html"]);

  const assetNotFoundResponse = await worker.fetch(new Request("https://sygma.example/missing.js", { headers: { accept: "text/html" } }), env);
  assert.equal(assetNotFoundResponse.status, 404);
  assert.equal(assetRequests.at(-1), "/missing.js");

  const rejected = await worker.fetch(new Request("https://sygma.example/file", { method: "POST" }), env);
  assert.equal(rejected.status, 405);
  console.log("Sites worker check passed.");
} finally {
  globalThis.fetch = originalFetch;
  globalThis.Response = OriginalResponse;
}
