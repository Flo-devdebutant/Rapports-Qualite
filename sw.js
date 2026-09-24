/* ------------------------------------------------------------------
   Service worker : l'application doit s'ouvrir sans réseau.
   Stratégie volontairement simple —
     · coquille de l'app (HTML/CSS/JS/icônes) : cache d'abord, mise à
       jour en arrière-plan ;
     · appels Supabase : jamais mis en cache, c'est IndexedDB qui joue
       ce rôle côté application.
   Changer CACHE ci-dessous suffit à déployer une nouvelle version.
   ------------------------------------------------------------------ */

const CACHE = 'mehadrin-qc-v24';

const SHELL = [
  './', './index.html', './manifest.webmanifest', './logo.svg', './app.css',
  './app.js', './config.js', './supa.js', './store.js', './verdict.js',
  './catalog.js', './countries.js', './pressure.js', './pressure-chart.js', './report-types.js', './ui.js', './pdf.js', './report-pdf.js', './logo.js',
  './xlsx.js', './xlsx-read.js', './journal.js', './reception.js',
  './form.js', './reports.js', './settings.js', './stats.js', './archive.js',
  './icon-192.png', './icon-512.png', './icon-maskable.png'
];

/* `addAll` est tout ou rien : une seule icône manquante et l'ensemble
   de la coquille reste hors cache — l'application ne s'ouvrait alors
   pas du tout hors réseau, sans le moindre indice. On met donc chaque
   entrée en cache séparément et on journalise celles qui échouent. */
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    const missing = [];
    await Promise.all(SHELL.map(async (u) => {
      try {
        const r = await fetch(u, { cache: 'reload' });
        if (!r.ok) throw new Error(r.status);
        await c.put(u, r);
      } catch (err) { missing.push(u); }
    }));
    if (missing.length) console.warn('[sw] non mis en cache :', missing);
    await self.skipWaiting();
  })());
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

  /* Le repli « index.html » ne vaut QUE pour une navigation. Servi à
     la place d'un script, d'une feuille de style ou du logo, il
     produisait des dégâts silencieux : logo.js mettait la page HTML en
     cache mémoire comme si c'était le SVG du logo, et tous les PDF
     partaient chez le client avec un en-tête cassé. Une sous-ressource
     absente doit échouer franchement. */
  const isNav = request.mode === 'navigate' ||
    (request.destination === '' && request.headers.get('accept')?.includes('text/html'));

  e.respondWith(
    caches.match(request).then(hit => {
      const net = fetch(request)
        .then(res => {
          if (res.ok) caches.open(CACHE).then(c => c.put(request, res.clone()));
          return res;
        })
        .catch(async () => {
          if (hit) return hit;
          if (isNav) {
            const shell = await caches.match('./index.html');
            if (shell) return shell;
          }
          return new Response('', { status: 504, statusText: 'Hors ligne' });
        });
      return hit || net;
    })
  );
});
