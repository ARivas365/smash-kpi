// Service worker: guarda la app en caché para que funcione sin internet.
// Estrategia: responde desde la caché al instante y actualiza en segundo plano.
const CACHE = 'smash-kpi-v4';
const ASSETS = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/db.js',
  './js/data.js',
  './js/stats.js',
  './js/charts.js',
  './js/sample.js',
  './js/stages.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './img/stages/battlefield.jpg',
  './img/stages/hollow-bastion.jpg',
  './img/stages/small-battlefield.jpg',
  './img/stages/town-and-city.jpg',
  './img/stages/pokemon-stadium-2.jpg',
  './img/stages/smashville.jpg',
  './img/stages/final-destination.jpg',
  './img/stages/kalos.jpg',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const key = req.mode === 'navigate' ? './index.html' : req;
  e.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(key, { ignoreSearch: true });
      const network = fetch(req)
        .then(res => { if (res.ok) cache.put(key, res.clone()); return res; })
        .catch(() => cached);
      return cached || network;
    })
  );
});
