const CACHE_NAME = "liturgica-v7-1-1-shell";
const SHELL = [
  "./",
  "./index.html",
  "./css/style.css?v=7.1.1",
  "./js/app.js?v=7.1.1",
  "./js/firebase.js",
  "./js/calendar.js",
  "./manifest.webmanifest?v=7.1.1",
  "./assets/icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)).catch(() => {})
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((key) => key !== CACHE_NAME ? caches.delete(key) : null))
    )
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).catch(() => {
        if (request.mode === "navigate") {
          return caches.match("./index.html");
        }
      });
    })
  );
});
