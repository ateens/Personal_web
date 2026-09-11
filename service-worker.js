const CACHE_NAME = "sygma-personal-web-v650-resource-properties";
const APP_SHELL_URL = "/index.html";
const REQUIRED_ASSETS = [
  APP_SHELL_URL,
  "/styles.css",
  "/finance-model.js",
  "/resource-model.js",
  "/app.js",
  "/assets/highlight/highlight.min.js",
  "/assets/katex/katex.min.js",
  "/assets/katex/katex.min.css",
  "/assets/katex/contrib/mhchem.min.js",
  "/assets/katex/fonts/KaTeX_AMS-Regular.woff2",
  "/assets/katex/fonts/KaTeX_Caligraphic-Bold.woff2",
  "/assets/katex/fonts/KaTeX_Caligraphic-Regular.woff2",
  "/assets/katex/fonts/KaTeX_Fraktur-Bold.woff2",
  "/assets/katex/fonts/KaTeX_Fraktur-Regular.woff2",
  "/assets/katex/fonts/KaTeX_Main-Bold.woff2",
  "/assets/katex/fonts/KaTeX_Main-BoldItalic.woff2",
  "/assets/katex/fonts/KaTeX_Main-Italic.woff2",
  "/assets/katex/fonts/KaTeX_Main-Regular.woff2",
  "/assets/katex/fonts/KaTeX_Math-BoldItalic.woff2",
  "/assets/katex/fonts/KaTeX_Math-Italic.woff2",
  "/assets/katex/fonts/KaTeX_SansSerif-Bold.woff2",
  "/assets/katex/fonts/KaTeX_SansSerif-Italic.woff2",
  "/assets/katex/fonts/KaTeX_SansSerif-Regular.woff2",
  "/assets/katex/fonts/KaTeX_Script-Regular.woff2",
  "/assets/katex/fonts/KaTeX_Size1-Regular.woff2",
  "/assets/katex/fonts/KaTeX_Size2-Regular.woff2",
  "/assets/katex/fonts/KaTeX_Size3-Regular.woff2",
  "/assets/katex/fonts/KaTeX_Size4-Regular.woff2",
  "/assets/katex/fonts/KaTeX_Typewriter-Regular.woff2",
];
const OPTIONAL_ASSETS = ["/manifest.json", "/icons/app-icon.svg", "/assets/sygma-social-preview.png"];
// The large Mermaid engine is cached by the fetch handler after its first use.

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(REQUIRED_ASSETS);
      await Promise.allSettled(OPTIONAL_ASSETS.map((asset) => cache.add(asset)));
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("sygma-") && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

function shouldCache(response) {
  return response && response.status === 200 && response.type !== "opaque";
}

async function cacheFirst(request) {
  const cached = await cachedResponse(request);
  if (cached) return cached;
  const response = await fetch(request);
  await cacheResponse(request, response);
  return response;
}

async function cachedResponse(request) {
  try {
    const cache = await caches.open(CACHE_NAME);
    return await cache.match(request);
  } catch {
    return undefined;
  }
}

async function cacheResponse(request, response) {
  if (!shouldCache(response)) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  } catch {
    // Cache quota or storage failures must not discard a successful network response.
  }
}

async function networkFirst(request) {
  const navigation = request.mode === "navigate";
  const cacheKey = navigation ? APP_SHELL_URL : request;
  try {
    const response = await fetch(request, { cache: "no-store" });
    if (!navigation || (response.headers.get("content-type") || "").includes("text/html")) {
      await cacheResponse(cacheKey, response);
    }
    return response;
  } catch {
    return (await cachedResponse(cacheKey)) || Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === "/api" || url.pathname.startsWith("/api/") || url.pathname === "/health") return;

  if (event.request.mode === "navigate") {
    event.respondWith(networkFirst(event.request));
    return;
  }

  const immutableAsset = /^\/assets\/[^/]+\.[a-f0-9]{10,}\./.test(url.pathname);
  event.respondWith(immutableAsset ? cacheFirst(event.request) : networkFirst(event.request));
});
