// Service worker : l'interface et les visuels de cartes restent disponibles même si le serveur répond lentement.
// Les données (api/) passent toujours par le réseau. Il affiche aussi les notifications envoyées par le serveur.
// BASE = chemin de l'appli ("/" ou un sous-dossier comme "/tcgc/"), déduit de l'emplacement du service worker.
const BASE = new URL(self.registration.scope).pathname;
// Version du build, écrite par vite.config.ts à chaque build (« dev » en développement) : un nouveau build change ce
// fichier, le navigateur installe alors le nouveau service worker, qui range l'appli dans un nouveau cache et efface
// les anciens (leurs morceaux n'existent plus sur le serveur)
const BUILD = '__TCGC_BUILD__';
const SHELL = `tcgc-shell-${BUILD}`;
const IMAGES = 'tcgc-images-v2';
// Visuels gardés au plus (environ 50 à 150 ko chacun) : au-delà, les plus anciens sont effacés
const MAX_IMAGES = 2000;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll([BASE, `${BASE}manifest.webmanifest`, `${BASE}logo.png`])));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((k) => k !== SHELL && k !== IMAGES).map((k) => caches.delete(k)),
  )).then(() => trimImages()));
  self.clients.claim();
});

// Une réponse à garder : réussie (pas une page d'erreur pendant un redémarrage) et sans no-store (face de carte
// dessinée de l'interrupteur de retrait, à ne pas garder à la place du vrai visuel)
const keepable = (res) => res.ok && res.type === 'basic' && !/no-store/.test(res.headers.get('Cache-Control') ?? '');

// Éviction des visuels : le cache rend ses entrées dans l'ordre où elles ont été rangées, on efface les plus anciennes
let trimming = null;
let added = 0;
function trimImages() {
  trimming ??= caches.open(IMAGES).then(async (cache) => {
    const keys = await cache.keys();
    const extra = keys.length - MAX_IMAGES;
    for (let i = 0; i < extra; i++) await cache.delete(keys[i]);
  }).catch(() => {}).finally(() => { trimming = null; });
  return trimming;
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith(`${BASE}api/`)) return;

  // Visuels (img/, img-fr/, img-fr-hd/) et fichiers versionnés : cache d'abord
  const isImage = url.pathname.startsWith(`${BASE}img`);
  if (isImage || url.pathname.startsWith(`${BASE}assets/`)) {
    event.respondWith(caches.open(isImage ? IMAGES : SHELL).then(async (cache) => {
      const hit = await cache.match(event.request);
      if (hit) return hit;
      const res = await fetch(event.request);
      // un morceau effacé par une mise en ligne revient en page HTML (repli du serveur vers index.html) : à ne pas
      // garder à la place du script
      const page = !isImage && (res.headers.get('Content-Type') ?? '').startsWith('text/html');
      if (keepable(res) && !page) {
        const stored = cache.put(event.request, res.clone());
        // on vérifie la taille du cache des visuels toutes les 50 images rangées
        if (isImage && ++added % 50 === 0) event.waitUntil(stored.then(trimImages));
        else event.waitUntil(stored.catch(() => {}));
      }
      return res;
    }));
    return;
  }

  // Pages : réseau d'abord, cache en secours (seulement une vraie page : pas une erreur 502 pendant un redémarrage)
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then((res) => {
      if (keepable(res)) {
        const copy = res.clone();
        event.waitUntil(caches.open(SHELL).then((c) => c.put(BASE, copy)).catch(() => {}));
      }
      return res;
    }).catch(async () => (await caches.match(BASE)) ?? Response.error()));
  }
});

// Notification reçue : { title, body, url (ex. "#collection/wishlist"), tag }
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || 'TCGC', {
    body: data.body || '',
    icon: `${BASE}icon-192.png`,
    tag: data.tag,
    data: { hash: data.url || '' },
  }));
});

// Appui sur la notification : l'appli s'ouvre (ou revient au premier plan) sur la bonne page
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const hash = event.notification.data?.hash || '';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    const client = clients.find((c) => c.url.startsWith(self.registration.scope));
    if (client) {
      client.postMessage({ type: 'tcgc:navigate', hash });
      return client.focus();
    }
    return self.clients.openWindow(`${BASE}${hash}`);
  }));
});
