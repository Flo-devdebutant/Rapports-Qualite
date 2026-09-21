/* ------------------------------------------------------------------
   Service worker : l'application doit s'ouvrir sans réseau.
   Stratégie volontairement simple —
     · coquille de l'app (HTML/CSS/JS/icônes) : cache d'abord, mise à
       jour en arrière-plan ;
     · appels Supabase : jamais mis en cache, c'est IndexedDB qui joue
       ce rôle côté application.
   Changer CACHE ci-dessous suffit à déployer une nouvelle version.
   ------------------------------------------------------------------ */

const CACHE = 'mehadrin-qc-v2';

const SHELL = [
  './', './index.html', './manifest.webmanifest', './logo.svg', './app.css',
  './app.js', './config.js', './supa.js', './store.js', './verdict.js',
  './catalog.js', './ui.js', './pdf.js', './report-pdf.js', './logo.js',
  './xlsx.js', './form.js', './reports.js', './settings.js', './stats.js',
  './icon-192.png', './icon-512.png', './icon-maskable.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;   // Supabase & co : réseau direct

  e.respondWith(
    caches.match(request).then(hit => {
      const net = fetch(request)
        .then(res => {
          if (res.ok) caches.open(CACHE).then(c => c.put(request, res.clone()));
          return res;
        })
        .catch(() => hit || caches.match('./index.html'));
      return hit || net;
    })
  );
});
