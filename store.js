/* ------------------------------------------------------------------
   Stockage local (IndexedDB) + synchronisation.
   Principe : l'application écrit TOUJOURS en local d'abord, puis une
   file d'attente pousse vers Supabase. Le comportement est donc
   identique avec ou sans réseau — c'est ce qui rend la saisie fiable
   dans une chambre froide ou un quai sans couverture.
   ------------------------------------------------------------------ */

import { db, storage, currentUser } from './supa.js';

const DB_NAME = 'mehadrin-qc';
/* v2 : journal des arrivages (palettes reçues, cherchées par n° de lot). */
const DB_VER = 2;
let idb = null;

export function openDB() {
  if (idb) return Promise.resolve(idb);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('reports'))  d.createObjectStore('reports',  { keyPath: 'id' });
      if (!d.objectStoreNames.contains('partners')) d.createObjectStore('partners', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('groups'))   d.createObjectStore('groups',   { keyPath: 'id' });
      if (!d.objectStoreNames.contains('outbox'))   d.createObjectStore('outbox',   { keyPath: 'id' });
      if (!d.objectStoreNames.contains('photos'))   d.createObjectStore('photos',   { keyPath: 'id' });
      if (!d.objectStoreNames.contains('meta'))     d.createObjectStore('meta',     { keyPath: 'key' });
      if (!d.objectStoreNames.contains('arrivals')) {
        const st = d.createObjectStore('arrivals', { keyPath: 'id' });
        st.createIndex('lot', 'lot');
      }
    };
    req.onsuccess = () => {
      idb = req.result;
      /* Une version plus récente de l'application s'ouvre dans un autre
         onglet : on lui cède la base plutôt que de bloquer sa mise à
         jour. */
      idb.onversionchange = () => { idb.close(); idb = null; };
      resolve(idb);
    };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode = 'readonly') {
  return openDB().then(d => d.transaction(store, mode).objectStore(store));
}
const wrap = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

export const local = {
  async all(store)        { return wrap((await tx(store)).getAll()); },
  async get(store, id)    { return wrap((await tx(store)).get(id)); },
  async put(store, val)   { return wrap((await tx(store, 'readwrite')).put(val)); },
  async del(store, id)    { return wrap((await tx(store, 'readwrite')).delete(id)); },
  async clear(store)      { return wrap((await tx(store, 'readwrite')).clear()); },
  /* Mille palettes d'un journal en UNE transaction : une écriture par
     ligne prenait plusieurs secondes sur un téléphone. */
  async putMany(store, vals) {
    const d = await openDB();
    return new Promise((res, rej) => {
      const t = d.transaction(store, 'readwrite');
      const os = t.objectStore(store);
      for (const v of vals) os.put(v);
      t.oncomplete = () => res(vals.length);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  },
  async byIndex(store, index, value) {
    return wrap((await tx(store)).index(index).getAll(value));
  },
  async delMany(store, ids) {
    const d = await openDB();
    return new Promise((res, rej) => {
      const t = d.transaction(store, 'readwrite');
      const os = t.objectStore(store);
      for (const id of ids) os.delete(id);
      t.oncomplete = () => res(ids.length);
      t.onerror = () => rej(t.error);
    });
  },
  async meta(key, val) {
    if (val === undefined) return (await wrap((await tx('meta')).get(key)))?.value;
    return wrap((await tx('meta', 'readwrite')).put({ key, value: val }));
  }
};

/* ----------------------- FILE D'ATTENTE ----------------------- */
export async function queue(kind, payload) {
  await local.put('outbox', { id: crypto.randomUUID(), kind, payload, at: Date.now(), tries: 0 });
}

let syncing = false;
const listeners = new Set();
export const onSync = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = (state) => listeners.forEach(fn => fn(state));

export async function pendingCount() {
  return (await local.all('outbox')).length;
}

/* Pousse la file, puis retire du serveur ce qui a changé. */
export async function sync({ silent = false } = {}) {
  if (syncing || !navigator.onLine || !currentUser()) return false;
  syncing = true;
  if (!silent) emit('syncing');
  try {
    await push();
    await pull();
    await local.meta('lastSync', Date.now());
    /* Ménage des binaires orphelins une fois la file vidée : pas avant,
       sinon on effacerait une photo qui n'est pas encore partie. */
    try { if (!(await pendingCount())) await sweepPhotos(); } catch (e) {}
    emit('done');
    return true;
  } catch (e) {
    console.warn('[sync]', e.message);
    emit('error');
    return false;
  } finally { syncing = false; }
}

/* Un élément que le serveur a refusé définitivement (droits, donnée
   invalide) est mis de côté plutôt que rejeté : il reste visible dans
   la file, il ne bloque pas les suivants, et surtout il n'est jamais
   détruit sans que personne ne le sache. Un élément qui échoue pour
   cause de réseau, lui, est simplement réessayé — indéfiniment, parce
   qu'un quai sans couverture n'est pas une raison de perdre un
   rapport. */
/* Rapports en attente de leur PDF. Juste après l'enregistrement,
   l'application propose le PDF avec les photos en PLEINE définition ;
   ce n'est qu'ensuite que les photos sont allégées et envoyées. Tant
   que la proposition est ouverte, ce rapport-là ne part pas — le reste
   de la file, si. En mémoire seulement : si l'application se ferme
   entre-temps, l'envoi reprend normalement au démarrage suivant. */
const held = new Set();
export const holdReport = (id) => { if (id) held.add(id); };
export const releaseReport = (id) => { held.delete(id); };

/* La copie qui part sur Supabase : 800 px de côté au plus, soit
   environ un tiers de la photo prise (1400 px). L'offre gratuite
   plafonne les fichiers à 1 Go ; la pleine définition a été proposée
   en PDF à l'enregistrement. */
export const LIGHT_PHOTO = { maxSide: 800, quality: 0.6 };

async function push() {
  /* Envois du journal des arrivages laissés par la 2.4.0 : le journal
     ne part plus sur le serveur. On les retire, bloqués compris, pour
     qu'ils ne restent pas affichés comme « refusés ». */
  for (const i of await local.all('outbox'))
    if (i.kind === 'arrivals') await local.del('outbox', i.id);

  const items = (await local.all('outbox'))
    .filter(i => !i.blocked)
    .sort((a, b) => a.at - b.at);
  let firstError = null;

  for (const item of items) {
    try {
      if (item.kind === 'report') {
        if (held.has(item.payload.id)) continue;      // PDF proposé en ce moment
        const report = await local.get('reports', item.payload.id);
        if (!report) { await local.del('outbox', item.id); continue; }
        await uploadPhotos(report);
        const { _dirty, _localPhotos, _draft, _draftAt, ...row } = report;
        await db('reports').upsert([row]);
        await local.put('reports', { ...report, _dirty: false });
      } else if (item.kind === 'partner') {
        await db('partners').upsert([item.payload]);
      } else if (item.kind === 'group') {
        await db('product_groups').upsert([item.payload]);
      } else if (item.kind === 'deletePartner') {
        await db('partners').eq('id', item.payload.id).remove();
      } else if (item.kind === 'deleteReport') {
        await db('reports').eq('id', item.payload.id).update({ deleted: true });
        /* Les photos du rapport supprimé libèrent leur place. Au mieux :
           un refus (droits, fichier déjà absent) ne bloque pas la file. */
        const paths = item.payload.photos || [];
        if (paths.length) await storage.removeMany(paths).catch(() => {});
      }
      await local.del('outbox', item.id);
    } catch (e) {
      item.tries = (item.tries || 0) + 1;
      item.lastError = e.message;
      /* Refus définitif : on le marque et on passe au suivant, la file
         ne doit pas se figer derrière lui. */
      if (e.permanent || e.auth) item.blocked = true;
      await local.put('outbox', item);
      if (!firstError) firstError = e;
      if (e.auth) break;                 // plus rien ne passera tant que la session est morte
    }
  }
  if (firstError) throw firstError;
}

/* Éléments que le serveur a refusés et qui attendent une décision. */
export async function blockedItems() {
  return (await local.all('outbox')).filter(i => i.blocked);
}

export async function retryBlocked() {
  for (const i of await blockedItems()) {
    delete i.blocked; i.tries = 0;
    await local.put('outbox', i);
  }
}

async function uploadPhotos(report) {
  const photos = report.photos || [];
  const gone = [];
  for (const p of photos) {
    /* Archivée : retirée de Supabase exprès, elle vit dans le PDF
       d'archive — ce n'est pas une photo perdue à effacer. */
    if (p.uploaded || p.archived || !p.localId) continue;
    const rec = await local.get('photos', p.localId);
    if (!rec) {
      /* Le fichier a disparu du cache (nettoyage du navigateur, base
         vidée). Le marquer « envoyé » écrivait un mensonge dans la
         base : le rapport annonçait une photo que le stockage n'a
         jamais reçue, et le PDF sortait avec une case vide. On retire
         la ligne — c'est la seule chose vraie. */
      gone.push(p);
      continue;
    }
    /* Seule une copie allégée part. Si l'image ne se laisse pas
       réduire (format exotique), l'original part tel quel : on ne perd
       jamais une photo pour gagner de la place. */
    let body = rec.blob, light = false;
    try {
      const { compressImage } = await import('./ui.js');
      const small = await compressImage(rec.blob, LIGHT_PHOTO.maxSide, LIGHT_PHOTO.quality);
      if (small && small.size && small.size < rec.blob.size) { body = small; light = true; }
    } catch (e) { /* on envoie l'original */ }
    await storage.upload(p.path, body, 'image/jpeg');
    p.uploaded = true;
    if (light) p.light = true;
    p.size = body.size;
    /* Une fois chez Supabase, le binaire local n'a plus de raison
       d'occuper la place : il se retélécharge à la demande. */
    await local.del('photos', p.localId).catch(() => {});
  }
  if (gone.length) {
    report.photos = photos.filter(p => !gone.includes(p));
    report.photos_lost = (report.photos_lost || 0) + gone.length;
  }
  await local.put('reports', report);
}

/* Binaires locaux devenus inutiles : brouillon abandonné, rapport
   supprimé, photo retirée d'un rapport. Sans ce ménage, la base locale
   d'un téléphone grossissait indéfiniment. */
export async function forgetPhotos(ids = []) {
  for (const id of ids) { if (id) await local.del('photos', id).catch(() => {}); }
}

/* Passe de rattrapage : tout blob qui n'est plus référencé par aucun
   rapport de l'appareil. Appelée après une synchronisation. */
export async function sweepPhotos() {
  const used = new Set();
  for (const r of await local.all('reports'))
    for (const p of r.photos || []) if (p.localId) used.add(p.localId);
  let freed = 0;
  for (const rec of await local.all('photos'))
    if (!used.has(rec.id)) { await local.del('photos', rec.id).catch(() => {}); freed++; }
  return freed;
}

async function pull() {
  const since = (await local.meta('serverCursor')) || '1970-01-01T00:00:00Z';
  const rows = await db('reports').select('*').gte('updated_at', since).order('updated_at', true).limit(500);
  let cursor = since, held = null;
  for (const row of rows) {
    const existing = await local.get('reports', row.id);
    if (existing?._dirty) {
      /* Priorité à la saisie locale non encore poussée. Mais le
         curseur ne doit pas franchir cette ligne, sinon la version
         serveur ne sera plus jamais reproposée une fois la nôtre
         partie. */
      if (!held || row.updated_at < held) held = row.updated_at;
      continue;
    }
    if (row.deleted) await local.del('reports', row.id);
    else await local.put('reports', { ...row, _dirty: false });
    if (row.updated_at > cursor) cursor = row.updated_at;
  }
  if (held && held <= cursor) cursor = since;
  await local.meta('serverCursor', cursor);

  const [partners, groups] = await Promise.all([
    db('partners').select('*').order('name', true),
    db('product_groups').select('*').order('position', true)
  ]);
  /* Une réponse vide n'efface rien. Sous RLS, une requête mal
     authentifiée répond « 200, aucune ligne » : prendre ce vide pour
     la vérité effacerait le catalogue produits et le carnet
     d'adresses de l'appareil, et l'inspecteur ne pourrait plus rien
     saisir hors ligne. */
  if (partners.length) {
    await local.clear('partners');
    for (const p of partners) await local.put('partners', p);
  }
  if (groups.length) {
    await local.clear('groups');
    for (const g of groups) await local.put('groups', g);
  }

}

/* Une seule fois, au premier lancement de la 2.4.1 : la 2.4.0
   descendait sur chaque appareil le journal importé par toute l'équipe.
   Le journal ne vit plus que sur l'appareil qui l'importe ; ces copies
   et leurs repères sont effacés (un nouvel import suffit). */
export async function forgetSharedJournal() {
  if (await local.meta('journalLocalOnly')) return;
  await local.clear('arrivals');
  for (const k of ['journalInfo', 'arrivalsSeq', 'arrivalsPurge']) await local.meta(k, null);
  await local.meta('journalLocalOnly', 1);
}

/* Relance la synchro dès le retour du réseau et toutes les 2 min. */
export function startAutoSync() {
  window.addEventListener('online', () => sync({ silent: true }));
  setInterval(() => sync({ silent: true }), 120000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync({ silent: true }); });
}
