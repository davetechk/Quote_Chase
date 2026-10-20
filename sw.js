// QuoteChase service worker — bump CACHE to ship new static files
const CACHE = 'qc-v1';
const PRECACHE = [
  '/css/main.css', '/css/dashboard.css',
  '/js/auth.js', '/js/dashboard.js', '/js/supabase.js', '/js/tracker.js',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png', '/icons/favicon-32.png',
  '/offline.html',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// A redirected response can't be used for a navigation, so re-wrap cached copies
const fresh = r => r && new Response(r.body, { status: r.status, headers: r.headers });

self.addEventListener('fetch', e => {
  const req = e.request;
  // Only same-origin GETs — Supabase, Dodo, Google etc. go straight to the network
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(res => {
      if (res.ok && !res.redirected) caches.open(CACHE).then(c => c.put(req, res.clone()));
      return res;
    }).catch(async () => fresh(await caches.match(req)) || fresh(await caches.match('/offline.html'))));
    return;
  }

  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok) caches.open(CACHE).then(c => c.put(req, res.clone()));
    return res;
  })));
});
