// Service worker: guarda la app en caché para que funcione sin internet.
// Cada versión publicada es un paquete completo: la app usa siempre los archivos de su versión
// (nunca mezcla archivos viejos y nuevos). Cuando sale una versión nueva, se descarga entera
// en segundo plano y queda esperando; la app muestra "Actualizar" y con un toque pasa a la nueva.
// al publicar cambios, subir este número y APP_VERSION en js/app.js (se muestra en Ajustes):
// si no se sube, los teléfonos no reciben los cambios.
const CACHE = 'smash-kpi-v24';
const VERSION = CACHE.replace('smash-kpi-v', '');
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
  './js/startgg.js',
  './js/drive.js',
  './manifest.json',
  './manifest-smash.json',
  './manifest-planilla.json',
  './icons/smash-192.png',
  './icons/smash-512.png',
  './icons/smash-maskable-512.png',
  './icons/planilla-192.png',
  './icons/planilla-512.png',
  './icons/planilla-maskable-512.png',
  './data/mre.json',
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

// cache: 'reload' evita copiar archivos viejos del caché HTTP del navegador al instalar una versión nueva
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' })));
    // la v22 y anteriores no saben mostrar "Actualizar": desde esas, pasa sola (una única vez)
    const legacy = (await caches.keys()).some(k => { const m = /^smash-kpi-v(\d+)$/.exec(k); return m && +m[1] < 23; });
    if (legacy) self.skipWaiting();
  })());
});

// la app pregunta qué versión trae este paquete, y avisa cuando el usuario toca "Actualizar"
self.addEventListener('message', e => {
  if (e.data?.type === 'version') e.ports[0]?.postMessage(VERSION);
  if (e.data?.type === 'activate') self.skipWaiting();
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
  // primero el paquete de esta versión; lo que no esté (raro) se baja y se guarda
  e.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(key, { ignoreSearch: true });
      if (cached) return cached;
      const res = await fetch(req);
      if (res.ok && req.mode !== 'navigate') cache.put(req, res.clone());
      return res;
    })
  );
});
