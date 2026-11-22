// Offline support. The page and its scripts are network-first with a short timeout, so a returning visitor gets the new
// release on their first load after it ships; the cached copy is the fallback when offline or the network is slow.
// Icons, the manifest and fonts are cache-first and refresh in the background.
// Network fetches skip the browser's HTTP cache (GitHub Pages sets max-age=600), so a new release isn't stuck behind a stale copy.
const CACHE = "bbd-v110";
const SHELL = ["./", "index.html", "data.js?v=1", "sync.js?v=2", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png"];
const WAIT = 3000;
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  // Only the site itself and its fonts: Firebase sign-in and sync must always reach the network
  if (url.hostname !== location.hostname && !/^fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) return;
  const own = url.origin === location.origin;
  const fresh = own && (e.request.mode === "navigate" || /(^|\/)(index\.html)?$|\.js$/.test(url.pathname));
  e.respondWith(caches.open(CACHE).then(async (c) => {
    // A page load is cached as "./" so the offline fallback is always the latest shell, whatever the query or hash
    const key = e.request.mode === "navigate" ? new Request(new URL("./", location.href)) : e.request;
    const hit = await c.match(key, { ignoreSearch: true });
    const net = (own ? fetch(url.href, { cache: "no-cache" }) : fetch(e.request)).then((r) => { if (r.ok || r.type === "opaque") c.put(key, r.clone()); return r; });
    if (!fresh) return hit || net.catch(() => hit);
    if (!hit) return net;
    // Network first; fall back to the cached copy if it fails or takes longer than WAIT
    return Promise.race([net.catch(() => hit), new Promise((ok) => setTimeout(() => ok(hit), WAIT))]);
  }));
});
