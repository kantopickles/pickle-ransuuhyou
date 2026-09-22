const CACHE_VERSION = "pickleball-pwa-v2";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const PAGE_CACHE = `${CACHE_VERSION}-pages`;
const APP_SHELL = [
  "/",
  "/offline",
  "/pickleball-random-table-hero.png",
  "/icon-192x192.png",
  "/icon-512x512.png",
  "/maskable-icon-512x512.png",
  "/apple-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith("pickleball-pwa-") && ![STATIC_CACHE, PAGE_CACHE].includes(key))
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API responses must always come from Cloudflare. Shared schedule pages are
  // handled below with network-first navigation and are never written to cache.
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && url.pathname === "/") {
            const copy = response.clone();
            event.waitUntil(caches.open(PAGE_CACHE).then((cache) => cache.put("/", copy)));
          }
          return response;
        })
        .catch(async () => {
          if (url.pathname === "/") {
            const home = await caches.match("/");
            if (home) return home;
          }
          return (await caches.match("/offline")) || Response.error();
        })
    );
    return;
  }

  const isVersionedAsset = url.pathname.startsWith("/_next/static/");
  if (isVersionedAsset) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy)));
          }
          return response;
        });
      })
    );
    return;
  }

  if (APP_SHELL.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const refreshed = fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy)));
          }
          return response;
        });
        return cached || refreshed;
      })
    );
  }
});
