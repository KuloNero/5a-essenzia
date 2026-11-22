// App shell offline (script compatibile sia come classic sia come module). Le chiamate a api.github.com non vengono mai messe in cache.
// tenere allineato con APP_VERSION in js/version.js (il workflow aggiunge il commit)
const VERSION = 'esz-v1.2.1';
const SHELL = [
    './',
    'index.html',
    'manifest.webmanifest',
    'css/app.css',
    'icons/icon.svg',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'js/actions.js',
    'js/allergens.js',
    'js/app.js',
    'js/backends.js',
    'js/bgsync.js',
    'js/demo.js',
    'js/domain.js',
    'js/idb.js',
    'js/io.js',
    'js/pdf.js',
    'js/qr.js',
    'js/scanner.js',
    'js/store.js',
    'js/ui.js',
    'js/util.js',
    'js/version.js',
    'js/views/common.js',
    'js/views/dashboard.js',
    'js/views/data.js',
    'js/views/index.js',
    'js/views/labels.js',
    'js/views/materials.js',
    'js/views/production.js',
    'js/views/recipes.js',
    'js/views/sales.js',
    'js/views/settings.js',
    'js/views/trace.js',
    'js/views/warehouse.js',
    'vendor/jsQR.js',
    'vendor/jspdf.plugin.autotable.min.js',
    'vendor/jspdf.umd.min.js',
    'vendor/jszip.min.js',
    'vendor/qrcode.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// network-first per i file dell'app (aggiornamenti immediati quando online), cache come fallback offline
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(e.request);
      if (res.ok) { const c = await caches.open(VERSION); c.put(e.request, res.clone()); }
      return res;
    } catch {
      const cached = await caches.match(e.request, { ignoreSearch: true });
      if (cached) return cached;
      if (e.request.mode === 'navigate') return caches.match('index.html');
      throw new Error('offline');
    }
  })());
});
