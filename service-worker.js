const CACHE_NAME = "sygma-personal-web-v637-google-oauth-popup";
const APP_SHELL_URL = "/index.html";
const REQUIRED_ASSETS = [
  APP_SHELL_URL,
  "/styles.css?v=20260713-google-oauth-popup",
  "/app.js?v=20260713-google-oauth-popup",
];
const OPTIONAL_ASSETS = ["/manifest.json", "/icons/app-icon.svg", "/assets/sygma-social-preview.png"];

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
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
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
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (shouldCache(response)) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request) {
  try {
    const response = await fetch(request, { cache: "no-store" });
    if (shouldCache(response)) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return (await caches.match(request)) || Response.error();
  }
}

async function navigationFirst(request) {
  try {
    const response = await fetch(request, { cache: "no-store" });
    if (shouldCache(response)) {
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("text/html")) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(new URL(APP_SHELL_URL, self.registration.scope), response.clone());
      }
    }
    return response;
  } catch {
    return (await caches.match(new URL(APP_SHELL_URL, self.registration.scope))) || Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (event.request.mode === "navigate") {
    event.respondWith(navigationFirst(event.request));
    return;
  }

  const immutableAsset = url.searchParams.has("v") || url.pathname.startsWith("/icons/");
  event.respondWith(immutableAsset ? cacheFirst(event.request) : networkFirst(event.request));
});
