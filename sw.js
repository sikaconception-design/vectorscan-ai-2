// Service Worker VectorScan AI — mise en cache hors-ligne + détection de nouvelle version
const APP_VERSION = 'v11.33';
const CACHE_NAME = 'vectorscan-ai-' + APP_VERSION;
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).catch(()=>{})
  );
  // On n'active PAS tout de suite : on attend que l'utilisateur confirme la mise à jour
  // (voir le message SKIP_WAITING envoyé par index.html après clic sur "Mettre à jour")
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Permet à la page de déclencher l'activation immédiate de la nouvelle version
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING' || event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Stratégie : réseau d'abord, secours sur le cache si hors-ligne (garde l'app à jour quand connecté)
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(()=>{});
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match('./index.html')))
  );
});
