/* ------------------------------------------------------------------
   Service worker : l'application doit s'ouvrir sans réseau, et se
   mettre à jour toute seule.
     · fichiers de l'application (HTML/CSS/JS/icônes) : servis depuis le
       cache de CETTE version, d'un bloc — jamais un mélange de deux
       versions ;
     · appels Supabase : jamais mis en cache, c'est IndexedDB qui joue
       ce rôle côté application.
   Une nouvelle version = VERSION et CACHE changés ci-dessous (chaque
   livraison le fait). Les appareils ouverts la détectent, la
   téléchargent, et la page se recharge à un moment sans risque (voir
   « Mise à jour automatique » dans app.js).
   ------------------------------------------------------------------ */

const VERSION = '3.3.3';                 // celle de config.js, et du tampon de chaque fichier
const CACHE = 'mehadrin-qc-v27';

const SHELL = [
  './', './index.html', './manifest.webmanifest', './logo.svg', './app.css',
  './app.js', './config.js', './supa.js', './store.js', './verdict.js',
  './catalog.js', './countries.js', './pressure.js', './pressure-chart.js', './report-types.js', './ui.js', './pdf.js', './report-pdf.js', './logo.js',
  './xlsx.js', './xlsx-read.js', './journal.js', './reception.js',
  './form.js', './reports.js', './settings.js', './stats.js', './archive.js',
  './icon-192.png', './icon-512.png', './icon-maskable.png'
];

/* Installation.
   · Première installation : chaque fichier est mis en cache séparément
     et un échec est seulement journalisé — `addAll`, tout ou rien,
     laissait l'application sans rien hors réseau pour une icône
     manquante.
   · Mise à jour : tout ou rien, au contraire. Un fichier manquant, ou un
     config.js d'une autre version (dépôt GitHub en cours, fichiers de
     deux versions mêlés), et l'installation est abandonnée : l'ancienne
     version continue de tourner, la prochaine vérification réessaiera.
     Installer une version bancale, c'était la servir telle quelle. */
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const updating = !!self.registration.active;
    const c = await caches.open(CACHE);
    const missing = [];
    await Promise.all(SHELL.map(async (u) => {
      try {
        const r = await fetch(u, { cache: 'reload' });
        if (!r.ok) throw new Error(r.status);
        await c.put(u, r);
      } catch (err) { missing.push(u); }
    }));
    if (updating) {
      /* Chaque fichier de code porte le numéro de sa version (ajouté à la
         livraison : « Mehadrin QC 3.3.3 »). Un seul fichier d'une autre
         version, et l'on n'installe rien. */
      const stamp = `Mehadrin QC ${VERSION}`;
      const stale = [];
      for (const u of SHELL.filter(x => /\.(js|css|html)$/.test(x))) {
        const r = await c.match(u);
        if (r && !(await r.text()).includes(stamp)) stale.push(u);
      }
      if (missing.length || stale.length) {
        await caches.delete(CACHE);
        throw new Error(`[sw] ${VERSION} incomplète (${[...missing, ...stale].join(', ')}) — nouvel essai plus tard`);
      }
    } else if (missing.length) console.warn('[sw] non mis en cache :', missing);
    /* La page choisit le moment de passer à la nouvelle version (message
       « skipWaiting »). Deux exceptions : la toute première installation,
       et le passage depuis une version d'avant la mise à jour automatique
       (cache v26 ou plus ancien) — ses pages ne savent pas le demander. */
    const legacy = (await caches.keys()).some(k => {
      const m = /^mehadrin-qc-v(\d+)$/.exec(k);
      return m && +m[1] < 27;
    });
    if (!updating || legacy) await self.skipWaiting();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    const legacy = keys.some(k => {
      const m = /^mehadrin-qc-v(\d+)$/.exec(k);
      return m && +m[1] < 27;
    });
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
    /* Passage depuis une version sans mise à jour automatique : ses pages
       ne savent pas se recharger d'elles-mêmes. On les recharge ici, une
       seule fois — c'est ce qui évite d'avoir à recharger deux fois. */
    if (legacy) {
      for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url).catch(() => {});
    }
  })());
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

  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    /* Cache de cette version d'abord, sans retéléchargement en
       arrière-plan : avant, chaque fichier servi était aussi
       redemandé au réseau et rangé dans le cache, si bien qu'une page
       pouvait charger des fichiers de deux versions différentes. */
    const hit = (await c.match(request, { ignoreSearch: isNav })) || (isNav ? await c.match('./index.html') : null);
    if (hit) return hit;
    try {
      const res = await fetch(request);
      if (res.ok && !isNav) c.put(request, res.clone());
      return res;
    } catch (err) {
      if (isNav) {
        const shell = await c.match('./index.html');
        if (shell) return shell;
      }
      return new Response('', { status: 504, statusText: 'Hors ligne' });
    }
  })());
});
