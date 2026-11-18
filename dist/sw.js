/* Fallboard's service worker: once opened online, the app opens and plays offline.

   Registered only on the deployed site (js/app.js, when the page carries a version), so a local
   preview always shows the files as they are. tools/stamp.js writes the deploy's VERSION and
   PRECACHE below; a new deploy is a new worker, which takes over at once and drops the old
   version's files.

     the page          from the network, the copy kept here when there is none (or it is slow)
     the app's scripts precached under their versioned URLs (?v=), as the page asks for them
     data              (scores, the catalogue, the engraving engine, the piano's samples, icons,
                       fonts) kept as they are first fetched, under their URL less its version:
                       the engine and the samples never change, so they come from here; the rest
                       too, fetched again behind it so the next time is up to date
     shared files      Android's share sheet posts a MusicXML file to ./share: it is kept here
                       and the app opened at ./?shared=1, which opens it (js/app.js) */
'use strict';
const VERSION = 'dev';
const PRECACHE = [];
const SHELL = 'fallboard-shell-' + VERSION, DATA = 'fallboard-data', SHARE = 'fallboard-share';
const scope = (p) => new URL(p, self.registration.scope).href;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE.map(scope))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('fallboard-shell-') && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method === 'POST' && url.href === scope('share')) { e.respondWith(shared(req)); return; }
  if (req.method !== 'GET') return;
  if (req.mode === 'navigate') { e.respondWith(page(req)); return; }
  if (url.origin === location.origin) e.respondWith(url.searchParams.has('v') && url.pathname.includes('/js/') ? script(req) : data(req, e));
  else if (/(^|\.)(fonts\.googleapis\.com|fonts\.gstatic\.com|fontshare\.com)$/.test(url.hostname)) e.respondWith(data(req, e));
});

/* the page: the network's, within three seconds, else the kept copy */
async function page(req) {
  const cache = await caches.open(SHELL), key = scope('./');
  try {
    const res = await Promise.race([fetch(req), new Promise((_, no) => setTimeout(() => no(new Error('slow')), 3000))]);
    if (res.ok) cache.put(key, res.clone());
    return res;
  } catch (err) {
    return (await cache.match(key)) || (await caches.match(req)) || Response.error();
  }
}
/* a versioned script: kept, else fetched and kept */
async function script(req) {
  const kept = await caches.match(req);
  if (kept) return kept;
  const res = await fetch(req);
  if (res.ok) (await caches.open(SHELL)).put(req, res.clone());
  return res;
}
/* data, under its URL less its version; what never changes is not fetched again */
const SETTLED = /\/(engine|samples|fonts|icons)\//;
async function data(req, e) {
  const url = new URL(req.url);
  url.searchParams.delete('v');
  const cache = await caches.open(DATA), key = url.href, kept = await caches.match(key);
  if (kept && SETTLED.test(url.pathname)) return kept;
  const fresh = fetch(req).then((res) => { if (res.ok || res.type === 'opaque') cache.put(key, res.clone()); return res; });
  if (kept) { e.waitUntil(fresh.catch(() => {})); return kept; }
  return fresh;
}
/* a file shared to the app: kept until the app takes it */
async function shared(req) {
  try {
    const form = await req.formData(), file = form.get('score');
    if (file && file.size) {
      const cache = await caches.open(SHARE);
      await cache.put(scope('shared-score'), new Response(file, { headers: { 'content-type': file.type || 'application/octet-stream', 'x-name': encodeURIComponent(file.name || 'Shared score.musicxml') } }));
    }
  } catch (err) { /* nothing usable was shared: the app opens as it would */ }
  return Response.redirect(scope('./?shared=1'), 303);
}
