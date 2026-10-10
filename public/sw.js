// Service worker: makes the editor installable and usable offline.
// The build (vite.config.js, "pwa-precache") replaces the two placeholders below with the build
// time and the list of every file in dist/, so all of it is cached on the first visit.
//
// Strategy:
//   - page loads (navigation): network first, so an online visit always gets the newest version;
//     offline, the cached page is used
//   - everything else (hashed JS/CSS, the audio worklet, icons): cache first
// The two newest caches are kept, so a page that is still open on the previous version can keep
// loading its own files after an update.

const VERSION = '__BUILD_VERSION__'
const PRECACHE = '__PRECACHE_LIST__'
const PREFIX = 'td3-tool-'
const CACHE = PREFIX + VERSION
// Vite loads scripts with crossorigin, so they carry an Origin header; servers that answer with
// "Vary: Origin" would otherwise never match the precached copies (fetched without one)
const MATCH = { ignoreVary: true }

self.addEventListener('install', (event) => {
  const urls = Array.isArray(PRECACHE) ? PRECACHE : []
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(urls.map((u) => new URL(u, self.registration.scope).href)))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => {
        const ours = keys.filter((k) => k.startsWith(PREFIX)).sort()
        return Promise.all(ours.slice(0, -2).map((k) => caches.delete(k)))
      })
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put(request, copy))
          return response
        })
        .catch(async () => (await caches.match(request, MATCH)) || caches.match(new URL('./', self.registration.scope).href, MATCH))
    )
    return
  }

  event.respondWith(
    caches.match(request, MATCH).then(
      (hit) =>
        hit ||
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone()
            caches.open(CACHE).then((cache) => cache.put(request, copy))
          }
          return response
        })
    )
  )
})
