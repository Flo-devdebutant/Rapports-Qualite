/* ------------------------------------------------------------------
   Journal des arrivages : l'extraction de l'ERP, une ligne par palette
   reçue depuis le début du mois.

   L'ordre et le nombre des colonnes changent au fil des versions de
   l'ERP ; leurs ÉTIQUETTES, elles, sont stables. On repère donc chaque
   colonne par son étiquette, jamais par sa position.

   Ce qui est lu, et ce qu'on en fait :
     Lot          16886.01 → 16886 (le vrai n° de lot est avant le point)
     SSCC         n° réel de la palette
     Réf Ext.     n° de voyage
     Arrivée      date de réception
     Calibre      CAL.016 → 16
     Origine      PEROU → code pays PE
     Colis        colis de la palette
     Désignation  « HASS 4KG » : variété puis poids net du colis
     Groupe       groupe de produit (AVOCAT HASS / AVOCAT LISSE → Avocat)
     Cat.         CAT.1 → I
     GGN, Producteur
     Fournisseur  « WESTFALIA FRUIT FRANCE / EN ATTENTE > … » → avant le /
     Camion, Marque

   Le journal ne sert qu'à REMPLIR le rapport : il reste sur l'appareil
   qui l'a importé et ne part jamais sur le serveur (le rapport, lui,
   garde tout ce qu'il en a repris). Chaque import remplace le
   précédent ; pour un nouveau rapport, on réimporte le même fichier ou
   celui du jour. Prix et montants de l'ERP ne sont jamais lus.
   ------------------------------------------------------------------ */

import { readTable, excelDate } from './xlsx-read.js';
import { COUNTRIES } from './countries.js';
import { local } from './store.js';
import { DEFAULT_GROUPS } from './catalog.js';

export const normLabel = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();
const key = (s) => normLabel(s).replace(/[.:]/g, '').trim();

/* Étiquettes recherchées. Les trois dernières ne sont pas demandées,
   mais servent si l'ERP les remplit un jour : une variété saisie
   vaut mieux qu'une variété déduite de la désignation. */
export const COLUMNS = {
  lot: 'Lot', sscc: 'SSCC', voyage: 'Réf Ext.', arrival: 'Arrivée', calibre: 'Calibre',
  origin: 'Origine', boxes: 'Colis', designation: 'Désignation', group: 'Groupe',
  category: 'Cat.', ggn: 'GGN', producer: 'Producteur', supplier: 'Fournisseur',
  truck: 'Camion', brand: 'Marque', variety: 'Variété', supplierPallet: 'N° Pal. Fourn.'
};
const REQUIRED = ['lot', 'sscc'];

/* ------------------------- normalisation ------------------------- */
export const lotNumber = (v) => String(v ?? '').trim().split(/[.,]/)[0].replace(/\s+/g, '');
export const supplierName = (v) => String(v ?? '').split('/')[0].replace(/\s+/g, ' ').trim();

/* « CAL.016 » → calibre 16, qui est aussi un nombre de fruits par
   colis. « CAL.004 / L1 » → calibre L1 : le code qui précède n'est
   alors qu'un code article, pas un comptage. */
export function calibreOf(raw) {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return { cal: '', count: null };
  const m = /^CAL\.?\s*0*(\d+)\s*(?:\/\s*(.+))?$/i.exec(s);
  if (m) {
    const label = (m[2] || '').trim();
    return label ? { cal: label, count: null } : { cal: String(Number(m[1])), count: Number(m[1]) };
  }
  if (/^\d+$/.test(s)) return { cal: String(Number(s)), count: Number(s) };
  return { cal: s, count: null };
}

const countryKey = (s) => normLabel(s).toUpperCase().replace(/[^A-Z]/g, '');
let BY_NAME = null;
export function originCode(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (!BY_NAME) {
    BY_NAME = new Map();
    for (const c of COUNTRIES) {
      BY_NAME.set(c.code, c.code);
      for (const l of ['fr', 'en', 'it', 'es', 'nl']) if (c[l]) BY_NAME.set(countryKey(c[l]), c.code);
    }
  }
  return BY_NAME.get(countryKey(s)) || BY_NAME.get(s.toUpperCase()) || titleCase(s);
}

export function categoryOf(raw) {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const m = /^(?:CAT(?:EGORIE)?\.?\s*)?(EXTRA|EX|III|II|I|[1-3])$/i.exec(s);
  const map = { '1': 'I', '2': 'II', '3': 'III', I: 'I', II: 'II', III: 'III', EXTRA: 'Extra', EX: 'Extra' };
  return (m && map[m[1].toUpperCase()]) || s;
}

export const titleCase = (s) => String(s ?? '').toLowerCase()
  .replace(/(^|[\s\-'’(])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
const singular = (w) => (w.length > 3 ? w.replace(/[sx]$/, '') : w);
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* « HASS VALISE 10KG » → variété Hass, colis de 10 kg. La variété est
   d'abord cherchée parmi celles déclarées pour le produit ; à défaut,
   c'est le texte qui précède le poids, sans les mots du groupe
   (« MANGUE KASTURI 6KG » → Kasturi). */
export function designationOf(raw, { varieties = [], erpGroup = '' } = {}) {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim();
  const km = /(\d+(?:[.,]\d+)?)\s*KGS?\b/i.exec(s);
  const boxKg = km ? Number(km[1].replace(',', '.')) : null;
  const known = knownVariety(s, varieties);
  if (known) return { variety: known, boxKg, known: true };
  const head = km ? s.slice(0, km.index) : s;
  const drop = new Set(normLabel(erpGroup).split(/[^a-z0-9]+/).filter(Boolean).map(singular));
  const words = head.split(' ').filter(w => w && !drop.has(singular(normLabel(w))));
  return { variety: titleCase(words.join(' ')), boxKg, known: false };
}

/* Une variété de la liste de l'application, cherchée MOT À MOT dans un
   texte de l'ERP : « AVOCAT ETTINGER 4KG » → Ettinger, quels que soient
   les mots qui l'entourent. La plus longue d'abord : « Lamb Hass » avant
   « Hass ». */
export function knownVariety(text, varieties = []) {
  const up = normLabel(text);
  if (!up) return '';
  return [...varieties].filter(Boolean).sort((a, b) => b.length - a.length)
    .find(v => new RegExp(`(^|[^a-z0-9])${escRe(normLabel(v))}($|[^a-z0-9])`).test(up)) || '';
}

/* Liste de reconnaissance : les variétés du produit, complétées par
   celles que l'application propose de base pour ce produit. */
function varietyList(group) {
  const base = DEFAULT_GROUPS.find(g => g.id === group?.id)?.config?.varieties || [];
  const seen = new Set();
  return [...(group?.config?.varieties || []), ...base].filter(v => {
    const k = normLabel(v);
    if (!k || seen.has(k)) return false;
    seen.add(k); return true;
  });
}

/* Groupe de l'ERP → groupe de produit de l'application.
   « AVOCAT HASS » et « AVOCAT LISSE » contiennent « Avocat » : c'est
   le groupe Avocat. Un groupe peut aussi déclarer ses propres noms ERP
   (config.erpNames) pour les cas qui ne se devinent pas. */
export function groupFor(erpGroup, groups = []) {
  const toks = new Set(normLabel(erpGroup).split(/[^a-z0-9]+/).filter(Boolean).map(singular));
  if (!toks.size) return null;
  let best = null, bestLen = 0;
  for (const g of groups) {
    if (g.active === false) continue;
    for (const alias of [g.name, ...(g.config?.erpNames || [])]) {
      const gt = normLabel(alias).split(/[^a-z0-9]+/).filter(Boolean).map(singular);
      const len = gt.join(' ').length;
      if (gt.length && gt.every(t => toks.has(t)) && len > bestLen) { best = g; bestLen = len; }
    }
  }
  return best;
}

/* Date du quai : un nombre Excel, ou un texte « 22/09/2026 08:38 » dans
   un CSV. Toujours rendue en heure murale « AAAA-MM-JJTHH:MM:SS ». */
function arrivalOf(cell, date1904) {
  if (!cell) return '';
  if (cell.t === 'n') return excelDate(cell.v, date1904);
  const s = String(cell.v).trim();
  const p = (x) => String(x).padStart(2, '0');
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${y}-${p(m[2])}-${p(m[1])}T${p(m[4] || 0)}:${p(m[5] || 0)}:${p(m[6] || 0)}`;
  }
  m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4] || '00'}:${m[5] || '00'}:${m[6] || '00'}`;
  if (/^\d+(\.\d+)?$/.test(s)) return excelDate(s, date1904);
  return '';
}

/* ---------------------------- lecture ---------------------------- */
export async function parseJournal(buffer) {
  const { sheets, date1904 } = await readTable(buffer);
  const want = Object.fromEntries(Object.entries(COLUMNS).map(([k, l]) => [k, key(l)]));

  for (const sh of sheets) {
    /* La ligne d'étiquettes est la première qui porte « Lot » et
       « SSCC » : un titre ou une ligne vide au-dessus ne gêne pas. */
    const hi = sh.rows.slice(0, 15).findIndex(r =>
      REQUIRED.every(k => r.cells.some(c => c && key(c.v) === want[k])));
    if (hi < 0) continue;
    const col = {};
    sh.rows[hi].cells.forEach((c, i) => {
      if (!c) return;
      const k = key(c.v);
      for (const [f, lab] of Object.entries(want)) if (lab === k && col[f] == null) col[f] = i;
    });

    const records = [], seen = new Set();
    let skipped = 0;
    for (const row of sh.rows.slice(hi + 1)) {
      const cell = (f) => (col[f] == null ? null : row.cells[col[f]]);
      const txt = (f) => { const c = cell(f); return c ? String(c.v).replace(/\s+/g, ' ').trim() : ''; };
      const lot = lotNumber(txt('lot')), sscc = txt('sscc').replace(/\s+/g, '');
      if (!lot || !sscc) { if (row.cells.some(Boolean)) skipped++; continue; }
      const id = `${lot}:${sscc}`;
      if (seen.has(id)) continue;                 // doublon dans le même fichier
      seen.add(id);
      const cal = calibreOf(txt('calibre'));
      const boxes = Number(String(txt('boxes')).replace(',', '.'));
      const arrival = arrivalOf(cell('arrival'), date1904);
      records.push({
        id, lot, sscc, day: arrival ? arrival.slice(0, 10) : null,
        data: {
          sub: txt('lot'), sscc, voyage: txt('voyage'), arrival,
          calRaw: txt('calibre'), cal: cal.cal, count: cal.count,
          originRaw: txt('origin'), origin: originCode(txt('origin')),
          boxes: isFinite(boxes) && txt('boxes') !== '' ? boxes : null,
          designation: txt('designation'), variety: txt('variety'), group: txt('group'),
          category: txt('category'), ggn: txt('ggn').replace(/\s+/g, ''), producer: txt('producer'),
          supplier: supplierName(txt('supplier')), truck: txt('truck'), brand: txt('brand'),
          supplierPallet: txt('supplierPallet')
        }
      });
    }
    const days = records.map(r => r.day).filter(Boolean).sort();
    return {
      records,
      stats: {
        rows: records.length, skipped,
        lots: new Set(records.map(r => r.lot)).size,
        from: days[0] || null, to: days[days.length - 1] || null,
        missing: Object.keys(COLUMNS).filter(f => col[f] == null && !['variety', 'supplierPallet'].includes(f))
          .map(f => COLUMNS[f])
      }
    };
  }
  throw new Error("Aucune feuille de ce fichier ne porte les colonnes « Lot » et « SSCC ». " +
                  "Est-ce bien le journal des arrivages ?");
}

/* -------------------------- lot → rapport --------------------------
   Toutes les palettes d'un lot, mises en forme pour le rapport : en-tête
   (fournisseur, voyage, arrivée, camion…) et une ligne par palette. */
const uniq = (a) => [...new Set(a.filter(v => v !== '' && v != null))];
const mostCommon = (a) => {
  const m = new Map();
  for (const v of a) if (v) m.set(v, (m.get(v) || 0) + 1);
  return [...m].sort((x, y) => y[1] - x[1])[0]?.[0] || '';
};

export function lotModel(records, groups = [], fallbackGroupId = null) {
  if (!records?.length) return null;
  const rows = [...records].sort((a, b) =>
    String(a.data.sub).localeCompare(String(b.data.sub), 'fr', { numeric: true }) ||
    String(a.sscc).localeCompare(String(b.sscc), 'fr', { numeric: true }));
  const erpGroup = mostCommon(rows.map(r => r.data.group));
  const group = groupFor(erpGroup, groups)
    || groups.find(g => g.id === 'generique' && g.active !== false)
    || groups.find(g => g.id === fallbackGroupId) || null;
  const varieties = varietyList(group);

  const pallets = rows.map(r => {
    const d = r.data;
    const des = designationOf(d.designation, { varieties, erpGroup: d.group });
    /* Une variété connue d'abord (colonne Variété, puis désignation) ;
       le texte brut de l'ERP seulement si aucune ne correspond. */
    const variety = knownVariety(d.variety, varieties) || (des.known ? des.variety : '')
      || (d.variety ? titleCase(d.variety) : des.variety);
    return {
      n: d.sscc, sub: d.sub, cal: d.cal, count: d.count ?? null,
      variety, boxKg: des.boxKg,
      cat: categoryOf(d.category), brand: d.brand || '', ggn: d.ggn || '', producer: d.producer || '',
      boxes: d.boxes, origin: d.origin || '', supplierPallet: d.supplierPallet || ''
    };
  });

  /* Détail du lot : une ligne par origine et calibre, avec ses palettes
     et ses colis — le même tableau que celui qu'on remplissait à la
     main. */
  const lines = new Map();
  for (const p of pallets) {
    const k = `${p.origin}|${p.cal}`;
    const l = lines.get(k) || { o: p.origin, c: p.cal, pal: 0, col: 0 };
    l.pal += 1; l.col += Number(p.boxes) || 0;
    lines.set(k, l);
  }
  const arrivals = uniq(rows.map(r => r.data.arrival)).sort();
  const cats = uniq(pallets.map(p => p.cat));

  return {
    lot: rows[0].lot,
    groupId: group?.id || null,
    erpGroup,
    supplier: mostCommon(rows.map(r => r.data.supplier)),
    voyage: uniq(rows.map(r => r.data.voyage)).join(', '),
    arrival: arrivals[0] || '',
    truck: uniq(rows.map(r => r.data.truck)).join(', '),
    variety: uniq(pallets.map(p => p.variety)).join(', '),
    category: cats.length === 1 ? cats[0] : '',
    subs: uniq(rows.map(r => r.data.sub)),
    calibres: [...lines.values()].sort((a, b) =>
      String(a.o).localeCompare(String(b.o)) || String(a.c).localeCompare(String(b.c), 'fr', { numeric: true })),
    pallets
  };
}

/* ----------------------- stockage sur l'appareil -----------------------
   Rien ne part sur le serveur : le journal n'est qu'un outil de saisie.
   Un nouvel import REMPLACE le précédent — pas d'accumulation, et un lot
   corrigé dans l'ERP est relu tel qu'il est dans le fichier du jour. */
export async function importJournal(file) {
  const buf = await file.arrayBuffer();
  const parsed = await parseJournal(buf);
  if (!parsed.records.length) throw new Error('Le journal ne contient aucune palette.');
  await local.clear('arrivals');
  await local.putMany('arrivals', parsed.records);
  const info = { ...parsed.stats, at: new Date().toISOString(), file: file.name || '' };
  await local.meta('journalInfo', info);
  return info;
}

export const journalInfo = () => local.meta('journalInfo');

/* Palettes d'un lot, dans le journal importé sur cet appareil. */
export async function recordsForLot(lot) {
  const n = lotNumber(lot);
  if (!n) return [];
  return local.byIndex('arrivals', 'lot', n);
}

/* Lots récents, pour la liste de suggestions du champ « N° de lot ». */
export async function recentLots(limit = 60) {
  const all = await local.all('arrivals');
  const by = new Map();
  for (const r of all) {
    const e = by.get(r.lot) || { lot: r.lot, n: 0, day: r.day || '', supplier: r.data?.supplier || '' };
    e.n++; if ((r.day || '') > e.day) e.day = r.day || '';
    by.set(r.lot, e);
  }
  return [...by.values()].sort((a, b) => (b.day || '').localeCompare(a.day || '') ||
    b.lot.localeCompare(a.lot, 'fr', { numeric: true })).slice(0, limit);
}
