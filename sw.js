// Offline support: serve from cache, refresh in the background.
// Both the install and the refresh skip the browser's HTTP cache (GitHub Pages sets max-age=600), so a new release isn't stuck behind a stale copy.
const CACHE = "bbd-v104";
const SHELL = ["./", "index.html", "sync.js?v=2", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  // Only the site itself and its fonts: Firebase sign-in and sync must always reach the network
  const host = new URL(e.request.url).hostname;
  if (host !== location.hostname && !/^fonts\.(googleapis|gstatic)\.com$/.test(host)) return;
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const net = (e.request.url.startsWith(location.origin) ? fetch(e.request.url, { cache: "no-cache" }) : fetch(e.request)).then((r) => { if (r.ok || r.type === "opaque") c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
