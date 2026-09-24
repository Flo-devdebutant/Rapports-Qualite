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
  },
  /* Lecture, modification et écriture dans UNE transaction : personne
     ne peut écrire entre les deux. `fn` reçoit la valeur actuelle
     (ou undefined) et renvoie la nouvelle — ou null pour ne rien
     écrire. Elle doit être synchrone. */
  async update(store, key, fn) {
    const d = await openDB();
    return new Promise((res, rej) => {
      const t = d.transaction(store, 'readwrite');
      const os = t.objectStore(store);
      let out = null;
      const g = os.get(key);
      g.onsuccess = () => {
        const next = fn(g.result);
        if (next) { os.put(next); out = next; }
      };
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  }
};

/* Colonnes de la table `reports`. Le reste de l'objet local — marques
   internes (_dirty, _rev…) comme tout champ que la base ne connaît
   pas — reste sur l'appareil. Envoyer un seul champ inconnu faisait
   refuser le rapport ENTIER par le serveur (erreur 400), et il restait
   « à envoyer » pour toujours : c'est arrivé avec `photos_lost`. */
export const REPORT_COLUMNS = ['id', 'report_no', 'type', 'report_date', 'product_group_id', 'partner_id',
  'partner_name', 'header', 'measures', 'summary', 'criteria_snapshot', 'remarks', 'photos',
  'created_by', 'inspector_name', 'deleted'];
export const serverRow = (r) =>
  Object.fromEntries(REPORT_COLUMNS.filter(k => r[k] !== undefined).map(k => [k, r[k]]));

/* ----------------------- FILE D'ATTENTE ----------------------- */
/* Un rapport n'a qu'UN envoi en attente : le dernier enregistrement
   remplace les précédents (c'est la même fiche, dans sa dernière
   version). Avant, chaque enregistrement ajoutait une ligne — deux
   enregistrements d'un rapport bloqué s'affichaient « 2 à envoyer ».
   Un nouvel enregistrement remet aussi en route un envoi refusé : le
   contenu a changé, le refus ne vaut plus. */
const reportIdOf = (i) => (i.kind === 'report' || i.kind === 'deleteReport') ? i.payload?.id : null;
export async function queue(kind, payload) {
  if (kind === 'report' || kind === 'deleteReport') {
    for (const i of await local.all('outbox'))
      if (reportIdOf(i) === payload.id && i.kind === 'report') await local.del('outbox', i.id);
  }
  if (kind === 'report') {
    /* Révision locale : l'envoi en cours ne marquera « envoyé » que la
       version qu'il a lue. Une modification enregistrée pendant l'envoi
       reste à envoyer — elle n'est plus écrasée par l'ancienne. */
    await local.update('reports', payload.id, (cur) => cur ? { ...cur, _rev: (cur._rev || 0) + 1, _dirty: true } : null);
  }
  await local.put('outbox', { id: crypto.randomUUID(), kind, payload, at: Date.now(), tries: 0 });
}

let syncing = false;
const listeners = new Set();
export const onSync = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = (state) => listeners.forEach(fn => fn(state));

export async function pendingCount() {
  return (await local.all('outbox')).length;
}

/* Ce que la file contient, pour l'écran : combien d'éléments partiront,
   combien le serveur a refusés, et pourquoi. */
export async function outboxInfo() {
  const items = await local.all('outbox');
  const blocked = items.filter(i => i.blocked);
  return { pending: items.length, blocked: blocked.length, items,
           reasons: blocked.map(i => ({ kind: i.kind, id: reportIdOf(i), error: i.lastError || '' })) };
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

  await compactOutbox();
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
        await db('reports').upsert([serverRow(report)]);
        /* « Envoyé » seulement si personne ne l'a modifié entre-temps.
           Avant, l'objet lu au départ était réécrit tel quel : une
           modification enregistrée pendant l'envoi des photos était
           écrasée, et marquée envoyée sans l'avoir été. */
        await local.update('reports', report.id, (cur) =>
          cur && (cur._rev || 0) === (report._rev || 0) ? { ...cur, _dirty: false } : null);
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
      /* Refus définitif : on le marque et on passe au suivant, la file
         ne doit pas se figer derrière lui. Mise à jour sur place : si un
         nouvel enregistrement a remplacé cette ligne entre-temps, on ne
         la fait pas revenir. */
      await local.update('outbox', item.id, (cur) => cur ? {
        ...cur, tries: (cur.tries || 0) + 1, lastError: e.message, lastStatus: e.status || null,
        ...(e.permanent || e.auth ? { blocked: true } : {})
      } : null);
      if (!firstError) firstError = e;
      if (e.auth) break;                 // plus rien ne passera tant que la session est morte
    }
  }
  if (firstError) throw firstError;
}

/* Une ligne par rapport : les files écrites avant la 3.3.1 pouvaient en
   compter plusieurs pour la même fiche (une par enregistrement). On
   garde la plus récente ; si l'une d'elles n'était pas refusée, la
   ligne gardée ne l'est pas non plus. */
async function compactOutbox() {
  const byReport = new Map();
  for (const i of await local.all('outbox')) {
    if (i.kind !== 'report') continue;
    const id = i.payload?.id;
    if (!byReport.has(id)) byReport.set(id, []);
    byReport.get(id).push(i);
  }
  for (const list of byReport.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => b.at - a.at);
    const [keep, ...drop] = list;
    if (drop.some(i => !i.blocked) && keep.blocked) { delete keep.blocked; await local.put('outbox', keep); }
    for (const i of drop) await local.del('outbox', i.id);
  }
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

/* Après une mise à jour de l'application, les envois refusés sont
   retentés une fois : la nouvelle version en a peut-être corrigé la
   cause. Sans cela, un rapport refusé le restait à vie — aucun écran ne
   permettait de le relancer. */
export async function retryBlockedAfterUpdate(version) {
  if ((await local.meta('blockedRetriedFor')) === version) return false;
  await retryBlocked();
  await local.meta('blockedRetriedFor', version);
  return true;
}

async function uploadPhotos(report) {
  const photos = report.photos || [];
  /* Archivée : retirée de Supabase exprès, elle vit dans le PDF
     d'archive — ce n'est pas une photo perdue à effacer. */
  const todo = photos.filter(p => !p.uploaded && !p.archived && p.localId);
  if (!todo.length) return report;
  const recs = new Map();
  for (const p of todo) recs.set(p, await local.get('photos', p.localId));

  /* Fichier absent de l'appareil. Avant de conclure à une perte, on
     regarde s'il n'est pas déjà chez Supabase : un envoi interrompu à
     mi-chemin laissait des photos parties, mais dont la marque
     « envoyée » n'avait pas été enregistrée. On les retirait du
     rapport alors qu'elles étaient sur le serveur. */
  const missing = todo.filter(p => !recs.get(p));
  const there = missing.length ? await storage.existing(missing.map(p => p.path)) : new Set();
  const gone = [];
  for (const p of missing) {
    if (there.has(p.path)) { p.uploaded = true; await markUploaded(report.id, p); }
    else gone.push(p);
  }

  for (const p of todo) {
    const rec = recs.get(p);
    if (!rec) continue;
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
    /* La marque « envoyée » est enregistrée photo par photo, AVANT
       d'effacer la copie locale : un envoi coupé en route reprend là où
       il s'était arrêté, sans rien perdre. */
    await markUploaded(report.id, p);
    await local.del('photos', p.localId).catch(() => {});
  }

  if (gone.length) {
    /* Ni sur l'appareil, ni sur le serveur : la photo est perdue. On la
       retire (le rapport ne doit pas annoncer une image qui n'existe
       nulle part) et on le note dans l'en-tête — une colonne que la
       base connaît — pour que la fiche le dise sur tous les appareils. */
    const lost = new Set(gone.map(p => p.path));
    report.photos = photos.filter(p => !lost.has(p.path));
    report.header = { ...(report.header || {}), photos_lost: (report.header?.photos_lost || 0) + gone.length };
    await local.update('reports', report.id, (cur) => cur ? {
      ...cur,
      photos: (cur.photos || []).filter(p => !lost.has(p.path)),
      header: { ...(cur.header || {}), photos_lost: (cur.header?.photos_lost || 0) + gone.length }
    } : null);
  }
  return report;
}

/* Reporte la marque « envoyée » d'une photo dans la version du rapport
   actuellement enregistrée — pas dans une copie lue plus tôt, qui
   écraserait une modification faite entre-temps. */
function markUploaded(id, p) {
  return local.update('reports', id, (cur) => {
    const q = (cur?.photos || []).find(x => x.path === p.path);
    if (!q || q.uploaded) return null;
    q.uploaded = true;
    if (p.light) q.light = true;
    if (p.size) q.size = p.size;
    return cur;
  });
}

/* Binaires locaux devenus inutiles : brouillon abandonné, rapport
   supprimé, photo retirée d'un rapport. Sans ce ménage, la base locale
   d'un téléphone grossissait indéfiniment. */
export async function forgetPhotos(ids = []) {
  for (const id of ids) { if (id) await local.del('photos', id).catch(() => {}); }
}

/* Photos tenues par l'écran de saisie. La modification d'un rapport
   déjà enregistré n'a pas de brouillon dans la base locale : tant
   qu'on n'a pas enregistré, ses nouvelles photos n'y sont référencées
   par rien. Le ménage les prenait pour des orphelines — une
   synchronisation en arrière-plan (toutes les deux minutes, ou au
   retour sur l'onglet) les effaçait pendant la saisie, et le rapport
   partait sans elles. */
let livePhotoIds = () => [];
export const watchLivePhotos = (fn) => { livePhotoIds = typeof fn === 'function' ? fn : () => []; };

/* Délai de grâce : une photo de moins de 24 h n'est jamais effacée,
   référencée ou non. Le ménage ne fait gagner que de la place ; une
   photo perdue, c'est une preuve perdue. */
export const PHOTO_GRACE_MS = 24 * 3600 * 1000;

/* Passe de rattrapage : tout blob qui n'est plus référencé par aucun
   rapport de l'appareil. Appelée après une synchronisation. */
export async function sweepPhotos() {
  const used = new Set();
  for (const r of await local.all('reports'))
    for (const p of r.photos || []) if (p.localId) used.add(p.localId);
  try { for (const id of livePhotoIds() || []) if (id) used.add(id); } catch (e) {}
  const now = Date.now();
  let freed = 0;
  for (const rec of await local.all('photos')) {
    if (used.has(rec.id)) continue;
    if (rec.at && now - rec.at < PHOTO_GRACE_MS) continue;
    await local.del('photos', rec.id).catch(() => {}); freed++;
  }
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
