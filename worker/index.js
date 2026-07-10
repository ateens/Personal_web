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

function preferredAssetEncoding(request) {
  const accepted = String(request.headers.get("accept-encoding") || "").toLowerCase();
  const qualities = new Map(accepted.split(",").map((entry) => {
    const [name, ...parameters] = entry.trim().split(";");
    const quality = parameters.find((parameter) => parameter.trim().startsWith("q="));
    return [name, quality ? Number(quality.trim().slice(2)) : 1];
  }));
  const brotliQuality = qualities.get("br") || 0;
  const gzipQuality = qualities.get("gzip") || 0;
  if (brotliQuality <= 0 && gzipQuality <= 0) return "";
  if (brotliQuality >= gzipQuality) return "br";
  if (gzipQuality > 0) return "gzip";
  return "";
}

function withAssetEncoding(response, sourcePath, encoding) {
  const headers = new Headers(response.headers);
  const vary = new Set(String(headers.get("vary") || "").split(",").map((value) => value.trim()).filter(Boolean));
  vary.add("Accept-Encoding");
  headers.set("vary", [...vary].join(", "));
  if (sourcePath.endsWith(".css")) headers.set("content-type", "text/css; charset=utf-8");
  if (sourcePath.endsWith(".js")) headers.set("content-type", "text/javascript; charset=utf-8");
  if (encoding) headers.set("content-encoding", encoding);
  else headers.delete("content-encoding");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function staticAssetRequest(url, request) {
  const headers = new Headers(request.headers);
  headers.delete("accept-encoding");
  return new Request(url, { method: request.method, headers });
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

function withStaticHeaders(response, pathname, encodeBody = "automatic") {
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
    encodeBody,
  });
}

async function serveStatic(request, env) {
  const requestUrl = new URL(request.url);
  let assetRequest = request;
  let assetSourcePath = "";
  let assetEncoding = "";
  if (requestUrl.pathname.startsWith(ASSET_PROXY_PREFIX)) {
    assetSourcePath = `/assets/${requestUrl.pathname.slice(ASSET_PROXY_PREFIX.length)}`;
    assetEncoding = preferredAssetEncoding(request);
    const assetUrl = new URL(`${assetSourcePath}${assetEncoding ? `.${assetEncoding === "gzip" ? "gz" : assetEncoding}` : ""}`, request.url);
    assetRequest = staticAssetRequest(assetUrl, request);
  }
  let response = await env.ASSETS.fetch(assetRequest);
  if (assetSourcePath && assetEncoding && response.status === 404) {
    assetEncoding = "";
    response = await env.ASSETS.fetch(staticAssetRequest(new URL(assetSourcePath, request.url), request));
  }
  const servedEncoding = assetSourcePath && response.status === 200 ? assetEncoding : "";
  if (assetSourcePath) response = withAssetEncoding(response, assetSourcePath, servedEncoding);
  if (response.status === 404 && request.method === "GET" && request.headers.get("accept")?.includes("text/html")) {
    response = await env.ASSETS.fetch(new Request(new URL("/index.html", request.url), request));
  }
  return withStaticHeaders(response, requestUrl.pathname, servedEncoding ? "manual" : "automatic");
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
