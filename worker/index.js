const DEFAULT_API_ORIGIN = "https://personalweb-production-81a6.up.railway.app";
const ASSET_PROXY_PREFIX = "/_sygma/assets/";
const HASHED_ASSET_PATTERN = /\/(?:_sygma\/)?assets\/[^/]+\.[a-f0-9]{10,}\.(?:css|js)$/;

function apiOrigin(env) {
  return String(env?.API_ORIGIN || DEFAULT_API_ORIGIN).replace(/\/$/, "");
}

function isApiRequest(pathname) {
  return pathname === "/health" || pathname.startsWith("/api/");
}

function proxyHeaders(request) {
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");
  return headers;
}

function rewriteUpstreamLocation(headers, requestUrl, upstreamOrigin) {
  const location = headers.get("location");
  if (!location) return;
  const resolved = new URL(location, upstreamOrigin);
  if (resolved.origin !== upstreamOrigin) return;
  resolved.protocol = requestUrl.protocol;
  resolved.host = requestUrl.host;
  headers.set("location", resolved.toString());
}

async function proxyApiRequest(request, env) {
  const requestUrl = new URL(request.url);
  const upstreamOrigin = apiOrigin(env);
  const target = new URL(`${requestUrl.pathname}${requestUrl.search}`, upstreamOrigin);
  const upstream = await fetch(target, {
    method: request.method,
    headers: proxyHeaders(request),
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    redirect: "manual",
  });
  const headers = new Headers(upstream.headers);
  rewriteUpstreamLocation(headers, requestUrl, upstreamOrigin);
  headers.set("x-sygma-backend", "postgresql");
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

function withStaticHeaders(response, pathname) {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "same-origin");
  headers.set("x-frame-options", "SAMEORIGIN");
  if (HASHED_ASSET_PATTERN.test(pathname)) {
    headers.set("cache-control", "public, max-age=31536000, immutable");
  } else if (pathname === "/" || pathname === "/index.html" || pathname === "/service-worker.js" || pathname === "/manifest.json") {
    headers.set("cache-control", "no-store");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function serveStatic(request, env) {
  const requestUrl = new URL(request.url);
  let assetRequest = request;
  if (requestUrl.pathname.startsWith(ASSET_PROXY_PREFIX)) {
    const assetUrl = new URL(`/assets/${requestUrl.pathname.slice(ASSET_PROXY_PREFIX.length)}`, request.url);
    assetRequest = new Request(assetUrl, request);
  }
  let response = await env.ASSETS.fetch(assetRequest);
  if (response.status === 404 && request.method === "GET" && request.headers.get("accept")?.includes("text/html")) {
    response = await env.ASSETS.fetch(new Request(new URL("/index.html", request.url), request));
  }
  return withStaticHeaders(response, requestUrl.pathname);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (isApiRequest(url.pathname)) return proxyApiRequest(request, env);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", {
        status: 405,
        headers: { allow: "GET, HEAD", "cache-control": "no-store" },
      });
    }
    return serveStatic(request, env);
  },
};
