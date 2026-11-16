// NexusCode service worker: caches the app shell only, so the app installs and
// shows a friendly page when offline.
//
// What it never does:
// - cache API responses, auth data or anything from another origin (the API,
//   LiveKit, Cloudinary): those requests aren't even intercepted;
// - serve a cached page: navigations always go to the network, and only fall back
//   to /offline.html when the network fails. So a deploy is visible on the next
//   load, and old code can't be served.
// /assets/* files have a content hash in their names, so caching them can't serve
// stale code either. Caches are named per build and old ones are deleted.
//
// A new version waits until the page asks it to take over (SKIP_WAITING, sent when
// the user clicks "Reload" in the update prompt), so a running session is never
// swapped under the user's feet.
const VERSION = "__BUILD_ID__";
const SHELL_CACHE = `nexus-shell-${VERSION}`;
const ASSET_CACHE = `nexus-assets-${VERSION}`;
const SHELL_FILES = ["/offline.html", "/favicon.svg", "/icons/icon-192.png", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_FILES)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name.startsWith("nexus-") && name !== SHELL_CACHE && name !== ASSET_CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.headers.has("Authorization")) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/offline.html")));
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.open(ASSET_CACHE).then((cache) =>
        cache.match(request).then((hit) =>
          hit ||
          fetch(request).then((response) => {
            if (response.ok && response.type === "basic") cache.put(request, response.clone());
            return response;
          }),
        ),
      ),
    );
  }
  // Anything else (Pyodide, the manifest, icons...) goes to the network as usual
});
