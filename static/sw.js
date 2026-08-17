/* The board, openable before it has answered.
 *
 *  Panoptes deliberately had no service worker: the page is served with `cache-control:
 *  no-cache` precisely so a browser cannot keep yesterday's version, and a cache in front of
 *  that is the fastest way back to debugging a fix that is already deployed. That happened
 *  once here and it cost an hour.
 *
 *  So this one is **network first, always**. The cache is a fallback and nothing else: if the
 *  network answers, the answer is used and the cache is refreshed behind it. What it buys is
 *  two things worth having and nothing more — the board opens instantly on a phone instead of
 *  waiting for a LAN round trip, and it can be installed as an app, which needs a worker with
 *  a fetch handler to exist at all.
 *
 *  It never caches `/api`. The whole content of this page is which machine wants you *now*,
 *  and a stale answer to that is worse than no answer.
 */

const SHELL = 'panoptes-shell-v1';
const KEEP = ['/', '/app.js', '/style.css', '/mark.svg', '/mark-light.svg', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(KEEP)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  // Old shells go at once. A worker that keeps three generations of a page is a worker that
  // serves one of them to somebody eventually.
  e.waitUntil(caches.keys()
    .then((names) => Promise.all(names.filter((n) => n !== SHELL).map((n) => caches.delete(n))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Never the API: this page exists to say what is true now.
  if (url.pathname.startsWith('/api')) return;

  e.respondWith(
    fetch(e.request)
      .then((answer) => {
        if (answer.ok) {
          const copy = answer.clone();
          caches.open(SHELL).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return answer;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('/'))),
  );
});
