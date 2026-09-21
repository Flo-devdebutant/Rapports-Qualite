/* ------------------------------------------------------------------
   Stockage local (IndexedDB) + synchronisation.
   Principe : l'application écrit TOUJOURS en local d'abord, puis une
   file d'attente pousse vers Supabase. Le comportement est donc
   identique avec ou sans réseau — c'est ce qui rend la saisie fiable
   dans une chambre froide ou un quai sans couverture.
   ------------------------------------------------------------------ */

import { db, storage, currentUser } from './supa.js';

const DB_NAME = 'mehadrin-qc';
const DB_VER = 1;
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
    };
    req.onsuccess = () => { idb = req.result; resolve(idb); };
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
    emit('done');
    return true;
  } catch (e) {
    console.warn('[sync]', e.message);
    emit('error');
    return false;
  } finally { syncing = false; }
}

async function push() {
  const items = (await local.all('outbox')).sort((a, b) => a.at - b.at);
  for (const item of items) {
    try {
      if (item.kind === 'report') {
        const report = await local.get('reports', item.payload.id);
        if (!report) { await local.del('outbox', item.id); continue; }
        await uploadPhotos(report);
        const { _dirty, _localPhotos, ...row } = report;
        await db('reports').upsert([row]);
        await local.put('reports', { ...report, _dirty: false });
      } else if (item.kind === 'partner') {
        await db('partners').upsert([item.payload]);
      } else if (item.kind === 'group') {
        await db('product_groups').upsert([item.payload]);
      } else if (item.kind === 'deleteReport') {
        await db('reports').eq('id', item.payload.id).update({ deleted: true });
      }
      await local.del('outbox', item.id);
    } catch (e) {
      // Un échec de droits ne se résoudra pas en réessayant : on
      // abandonne l'élément après 5 tentatives pour ne pas bloquer
      // toute la file derrière lui.
      item.tries = (item.tries || 0) + 1;
      if (item.tries >= 5) await local.del('outbox', item.id);
      else await local.put('outbox', item);
      throw e;
    }
  }
}

async function uploadPhotos(report) {
  const photos = report.photos || [];
  for (const p of photos) {
    if (p.uploaded || !p.localId) continue;
    const rec = await local.get('photos', p.localId);
    if (!rec) { p.uploaded = true; continue; }
    await storage.upload(p.path, rec.blob, 'image/jpeg');
    p.uploaded = true;
  }
  await local.put('reports', report);
}

async function pull() {
  const since = (await local.meta('serverCursor')) || '1970-01-01T00:00:00Z';
  const rows = await db('reports').select('*').gte('updated_at', since).order('updated_at', true).limit(500);
  let cursor = since;
  for (const row of rows) {
    const existing = await local.get('reports', row.id);
    if (existing?._dirty) continue;              // priorité à la saisie locale non encore poussée
    if (row.deleted) await local.del('reports', row.id);
    else await local.put('reports', { ...row, _dirty: false });
    if (row.updated_at > cursor) cursor = row.updated_at;
  }
  await local.meta('serverCursor', cursor);

  const [partners, groups] = await Promise.all([
    db('partners').select('*').order('name', true),
    db('product_groups').select('*').order('position', true)
  ]);
  await local.clear('partners');
  for (const p of partners) await local.put('partners', p);
  await local.clear('groups');
  for (const g of groups) await local.put('groups', g);
}

/* Relance la synchro dès le retour du réseau et toutes les 2 min. */
export function startAutoSync() {
  window.addEventListener('online', () => sync({ silent: true }));
  setInterval(() => sync({ silent: true }), 120000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync({ silent: true }); });
}
