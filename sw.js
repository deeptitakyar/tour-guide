/* e-Tourist Guide – offline support. Keep this file next to the app (index.html). */
const SHELL = "etg-shell-v2";
const IMG = "etg-img-v1";
const TILES = "etg-tiles-v1";
const LIB = "etg-lib-v1";

async function cleanCopy(r) {
  // drop the "redirected" flag so the saved page can be served to Safari later
  return new Response(await r.blob(), { status: r.status, statusText: r.statusText, headers: r.headers });
}
async function savePage(url) {
  try {
    const r = await fetch(url, { cache: "no-cache" });
    if (r.ok) await (await caches.open(SHELL)).put(url, await cleanCopy(r));
  } catch (e) {}
}

self.addEventListener("install", event => {
  const scope = self.registration.scope;
  event.waitUntil(Promise.all([savePage(scope), savePage(scope + "index.html")]));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("etg-shell-") && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("message", event => {
  const d = event.data || {};
  if (d.type === "cache-page" && d.url) event.waitUntil(savePage(d.url));
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (req.mode === "navigate") { event.respondWith(pageStrategy(req)); return; }
  if (req.url.startsWith("https://tile.openstreetmap.org/")) { event.respondWith(tileStrategy(req)); return; }
  if (req.url.startsWith("https://cdn.jsdelivr.net/npm/leaflet@")) { event.respondWith(libStrategy(req)); return; }
  if (req.destination === "image" && req.url.startsWith("http")) { event.respondWith(imageStrategy(req)); return; }
});

function timeout(ms) { return new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms)); }

// The app page: use the internet when it answers quickly (so updates show up), else the saved copy.
async function pageStrategy(req) {
  const c = await caches.open(SHELL);
  const net = fetch(req).then(async r => {
    if (r.ok && r.type === "basic") await c.put(req.url.split("#")[0], await cleanCopy(r.clone()));
    return r;
  });
  net.catch(() => {});
  try {
    return await Promise.race([net, timeout(4000)]);
  } catch (e) {
    const scope = self.registration.scope;
    const hit = (await c.match(req, { ignoreSearch: true })) || (await c.match(scope + "index.html")) || (await c.match(scope));
    if (hit) return hit;
    try { return await net; } catch (e2) {
      return new Response("<!doctype html><meta name=viewport content='width=device-width'><body style='font-family:-apple-system,sans-serif;padding:24px'><h2>You're offline</h2><p>Open the app once with internet so it can save itself for offline use.</p>",
        { headers: { "content-type": "text/html; charset=utf-8" } });
    }
  }
}

// Photos: use a saved copy first (saves data on weak signal), otherwise download and keep it.
async function imageStrategy(req) {
  const hit = await caches.match(req.url);
  if (hit) return hit;
  try {
    const r = await fetch(req.url, { mode: "cors" });
    if (r.ok) {
      const c = await caches.open(IMG);
      c.put(req.url, r.clone()).then(() => trim(c, 200)).catch(() => {});
    }
    return r;
  } catch (e) {
    try { return await fetch(req); } catch (e2) { return Response.error(); }
  }
}
async function trim(c, max) {
  const keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

// Map library: keep a copy so the map can open without signal.
async function libStrategy(req) {
  const hit = await caches.match(req.url);
  if (hit) return hit;
  const r = await fetch(req);
  if (r.ok && r.type !== "opaque") (await caches.open(LIB)).put(req.url, r.clone()).catch(() => {});
  return r;
}

// Map tiles: remember tiles you've already looked at (up to about 600), so recently viewed areas show offline.
async function tileStrategy(req) {
  const c = await caches.open(TILES);
  const hit = await c.match(req.url);
  if (hit) return hit;
  try {
    let r;
    try { r = await fetch(req.url, { mode: "cors" }); } catch (e) { r = null; }
    if (r && r.ok) { c.put(req.url, r.clone()).then(() => trim(c, 600)).catch(() => {}); return r; }
    return await fetch(req);
  } catch (e) { return Response.error(); }
}
