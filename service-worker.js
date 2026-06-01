const CACHE_NAME = "sygma-personal-web-v163";
const ASSETS = [
  "./styles.css?v=20260529-68",
  "./app.js?v=20260529-68",
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

  event.respondWith(networkFirst(event.request));
});
