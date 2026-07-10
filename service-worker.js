const CACHE_NAME = "sygma-personal-web-v634-full-opt";
const ASSETS = [
  "./styles.css?v=20260711-full-opt-328",
  "./app.js?v=20260711-full-opt-328",
  "./manifest.json",
  "./icons/app-icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function shouldCache(response) {
  return response && response.status === 200 && response.type !== "opaque";
}

function cacheFirst(request) {
  return caches.match(request).then((cached) => {
    if (cached) return cached;
    return fetch(request).then((response) => {
      if (shouldCache(response)) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    });
  });
}

function networkFirst(request) {
  return fetch(request, { cache: "no-store" })
    .then((response) => {
      if (shouldCache(response)) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    })
    .catch(() => caches.match(request).then((cached) => cached || Response.error()));
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  const immutableAsset = url.searchParams.has("v") || url.pathname.startsWith("/icons/");
  event.respondWith(immutableAsset ? cacheFirst(event.request) : networkFirst(event.request));
});
