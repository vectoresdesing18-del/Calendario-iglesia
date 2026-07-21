const CACHE_NAME = "liturgica-v10-1-series-estudio-shell";
const SHELL = [
  "./",
  "./index.html",
  "./css/style.css",
  "./css/ethereal.css",
  "./js/app.js",
  "./js/firebase.js",
  "./js/calendar.js",
  "./js/pericopes.js",
  "./manifest.webmanifest",
  "./assets/icon.svg"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)).catch(() => {})
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((key) => key !== CACHE_NAME ? caches.delete(key) : null)))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  // Red primero para el shell de la app: así los cambios se ven de inmediato
  // sin quedar atrapados detrás de una versión vieja en caché.
  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) => {
          if (cached) return cached;
          if (request.mode === "navigate") return caches.match("./index.html");
        })
      )
  );
});
