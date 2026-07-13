const DEFAULT_API_ORIGIN = "https://personalweb-production-81a6.up.railway.app";
const ASSET_PROXY_PREFIX = "/_sygma/assets/";
const HASHED_ASSET_PATTERN = /\/(?:_sygma\/)?assets\/[^/]+\.[a-f0-9]{10,}\.(?:css|js)$/;
const PLATFORM_IDENTITY_HEADER = "oai-authenticated-user-email";
const UPSTREAM_IDENTITY_HEADER = "x-sygma-authenticated-user-email";
const PROXY_SECRET_BINDING = "API_BEARER_TOKEN";
const GOOGLE_OAUTH_CALLBACK_PATH = "/api/google/oauth/callback";
const GOOGLE_OAUTH_STATE_COOKIE = "sygma_google_oauth_state";
const STRIPPED_PROXY_HEADERS = new Set([
  "authorization",
  "cookie",
  "forwarded",
  "oai-authenticated-user-email",
  "proxy-authorization",
  "x-api-key",
  "x-authenticated-user-email",
  "x-auth-user",
  "x-original-authorization",
  "x-sygma-authenticated-user-email",
  "x-user-email",
]);

function apiOrigin(env) {
  return String(env?.API_ORIGIN || DEFAULT_API_ORIGIN).replace(/\/$/, "");
}

function isApiRequest(pathname) {
  return pathname === "/health" || pathname.startsWith("/api/");
}

function envFlag(value) {
  return /^(1|true|yes|on)$/i.test(String(value || ""));
}

function normalizedPlatformEmail(request) {
  const value = String(request.headers.get(PLATFORM_IDENTITY_HEADER) || "").trim().toLowerCase();
  if (!value || value.length > 320 || /[\u0000-\u001f\u007f]/.test(value)) return "";
  return value;
}

function isSpoofableProxyHeader(name) {
  const normalized = name.toLowerCase();
  return STRIPPED_PROXY_HEADERS.has(normalized)
    || normalized.startsWith("cf-access-")
    || normalized.startsWith("oai-authenticated-")
    || normalized.startsWith("x-auth-")
    || normalized.startsWith("x-authenticated-")
    || normalized.startsWith("x-forwarded-")
    || normalized.startsWith("x-sygma-authenticated-")
    || normalized.startsWith("x-user-");
}

function googleOAuthCallbackCookie(request, pathname) {
  if (request.method !== "GET" || pathname !== GOOGLE_OAUTH_CALLBACK_PATH) return "";
  const matches = [];
  for (const rawPart of String(request.headers.get("cookie") || "").split(";")) {
    const part = rawPart.trim();
    const separator = part.indexOf("=");
    if (separator <= 0 || part.slice(0, separator) !== GOOGLE_OAUTH_STATE_COOKIE) continue;
    const value = part.slice(separator + 1);
    if (!/^[A-Za-z0-9_-]{24,128}$/.test(value)) return "";
    matches.push(value);
  }
  return matches.length === 1 ? `${GOOGLE_OAUTH_STATE_COOKIE}=${matches[0]}` : "";
}

function proxyHeaders(request, { bearerToken = "", identityEmail = "", oauthStateCookie = "", publicUrl } = {}) {
  const headers = new Headers(request.headers);
  for (const name of [...headers.keys()]) {
    if (isSpoofableProxyHeader(name)) headers.delete(name);
  }
  headers.delete("host");
  headers.delete("content-length");
  if (publicUrl) {
    headers.set("x-forwarded-host", publicUrl.host);
    headers.set("x-forwarded-proto", publicUrl.protocol.replace(":", ""));
  }
  if (oauthStateCookie) headers.set("cookie", oauthStateCookie);
  if (bearerToken) headers.set("authorization", `Bearer ${bearerToken}`);
  if (identityEmail) headers.set(UPSTREAM_IDENTITY_HEADER, identityEmail);
  return headers;
}

function proxyAuthError(status, code, message) {
  return new Response(JSON.stringify({ error: message, code }), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function proxyAuthContext(request, env) {
  if (!envFlag(env?.REQUIRE_AUTHENTICATED_PROXY)) {
    return { bearerToken: "", identityEmail: "" };
  }
  const identityEmail = normalizedPlatformEmail(request);
  if (!identityEmail) {
    return { error: proxyAuthError(401, "AUTHENTICATED_SITE_USER_REQUIRED", "Authenticated Sites access is required.") };
  }
  const bearerToken = String(env?.[PROXY_SECRET_BINDING] || "").trim();
  if (!bearerToken) {
    return { error: proxyAuthError(503, "AUTHENTICATED_PROXY_NOT_CONFIGURED", "Authenticated API proxy is not configured.") };
  }
  return { bearerToken, identityEmail };
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

async function proxyApiRequest(request, env, authContext) {
  const requestUrl = new URL(request.url);
  const upstreamOrigin = apiOrigin(env);
  const target = new URL(`${requestUrl.pathname}${requestUrl.search}`, upstreamOrigin);
  const oauthStateCookie = googleOAuthCallbackCookie(request, requestUrl.pathname);
  const upstream = await fetch(target, {
    method: request.method,
    headers: proxyHeaders(request, { ...authContext, oauthStateCookie, publicUrl: requestUrl }),
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    redirect: "manual",
  });
  const headers = new Headers(upstream.headers);
  for (const [name, value] of [...headers]) {
    if (isSpoofableProxyHeader(name) || (authContext.bearerToken && value.includes(authContext.bearerToken))) {
      headers.delete(name);
    }
  }
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
  headers.set("content-security-policy", "default-src 'self'; connect-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()");
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
  const acceptsHtml = request.headers.get("accept")?.includes("text/html");
  const pathName = requestUrl.pathname.split("/").pop() || "";
  const extensionlessNavigation = !pathName.includes(".");
  if (response.status === 404 && (request.method === "GET" || request.method === "HEAD") && acceptsHtml && extensionlessNavigation) {
    response = await env.ASSETS.fetch(new Request(new URL("/index.html", request.url), request));
  }
  return withStaticHeaders(response, requestUrl.pathname, servedEncoding ? "manual" : "automatic");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (isApiRequest(url.pathname)) {
      const authContext = proxyAuthContext(request, env);
      if (authContext.error) return withStaticHeaders(authContext.error, url.pathname);
      const response = await proxyApiRequest(request, env, authContext);
      return withStaticHeaders(response, url.pathname);
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", {
        status: 405,
        headers: { allow: "GET, HEAD", "cache-control": "no-store" },
      });
    }
    return serveStatic(request, env);
  },
};
