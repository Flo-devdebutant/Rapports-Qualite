/* Mehadrin QC 3.3.3 */
/* ------------------------------------------------------------------
   Contrôle par palette, à la réception.

   Pour chaque palette, l'inspecteur compte les fruits touchés par
   chaque défaut. L'application en tire, palette par palette puis pour
   tout le lot :
     · les défauts externes et internes ;
     · le % de défauts légers (lenticelle, griffures, coups de soleil)
       et le % de pertes (anthracnose, froid, pourriture, brunissement
       vasculaire, pulpe grise) ;
     · le % de sous-calibre, d'après la pesée des fruits de pression.

   Échantillon — la règle de l'entreprise :
     fruits par colis   = calibre, pour un colis de 4 kg (avocat) ;
                          2,5 × calibre pour un colis de 10 kg
     fruits contrôlés   = 10 colis ouverts × fruits par colis
     fruits coupés      = 10 par palette, pour les défauts INTERNES
                          (davantage à l'occasion : saisi sur la palette)
     fruits de la palette = colis de la palette × fruits par colis
   Un défaut se rapporte à l'échantillon qui l'a révélé : un défaut
   externe aux fruits CONTRÔLÉS de sa palette (15 lenticelles sur 160
   fruits, c'est 9,4 % de la palette), un défaut interne aux fruits
   COUPÉS (1 pulpe grise sur 10 fruits coupés, c'est 10 %). Les pertes
   d'une palette additionnent les % de chacun de ses défauts de perte.
   Pour le lot, chaque palette pèse son nombre total de fruits — une
   palette de 276 colis compte plus qu'une de 180.

   Rapports d'avant la 3.2 : ils ne portent pas de nombre de fruits
   coupés, et leurs défauts internes restent rapportés aux fruits
   contrôlés, comme à leur enregistrement — leurs chiffres, et le PDF
   déjà envoyé, ne changent pas.

   Les % de défauts remplissent tout seuls les critères de la grille
   qui leur sont liés (Troubles / Maladies) : le verdict se calcule sur
   ce que l'inspecteur a compté, sans seconde saisie.
   ------------------------------------------------------------------ */

import { appliesTo, isHidden, fieldLive } from './report-types.js';
import { palletWeighing } from './pressure.js';

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();

export const DEFECT_KINDS = { light: 'Défaut léger', loss: 'Perte' };
export const DEFECT_WHERE = { ext: 'Externe', int: 'Interne' };

/* Défauts livrés. `link` : critères de la grille que le défaut
   alimente, par clé ; `match` : à défaut, un mot de leur libellé —
   une grille retouchée garde ainsi son lien. Quand l'administrateur
   règle la liste, le lien s'enregistre en clair (une seule clé). */
export const DEFAULT_DEFECTS = {
  avocat: [
    { key: 'lenticel', label: 'Lenticelle',              kind: 'light', where: 'ext', link: ['lenticel_pct'], match: ['lenticel'] },
    { key: 'scratch',  label: 'Griffures',               kind: 'light', where: 'ext', link: ['scratch_pct'],  match: ['griffure', 'rayure'] },
    { key: 'sunburn',  label: 'Coups de soleil',         kind: 'light', where: 'ext', link: ['sunburn_pct'],  match: ['soleil'] },
    { key: 'anthrac',  label: 'Anthracnose',             kind: 'loss',  where: 'ext', link: ['anthrac_pct', 'decay_pct'], match: ['anthracnose'] },
    { key: 'chill',    label: 'Taches de froid',         kind: 'loss',  where: 'ext', link: ['chill_pct'],    match: ['froid'] },
    { key: 'rot',      label: 'Pourriture',              kind: 'loss',  where: 'int', link: ['rot_pct', 'decay_pct'], match: ['pourriture'] },
    { key: 'vasc',     label: 'Brunissement vasculaire', kind: 'loss',  where: 'int', link: ['vasc_pct'],     match: ['vasculaire'] },
    { key: 'grey',     label: 'Pulpe grise',             kind: 'loss',  where: 'int', link: ['greypulp_pct'], match: ['pulpe grise'] }
  ],
  mangue: [
    { key: 'lenticel', label: 'Lenticelles',             kind: 'light', where: 'ext', link: ['lenticel_pct'], match: ['lenticel'] },
    { key: 'scratch',  label: 'Griffures',               kind: 'light', where: 'ext', link: ['scratch_pct'],  match: ['griffure', 'rayure'] },
    { key: 'sapburn',  label: 'Brûlure de sève',         kind: 'light', where: 'ext', link: ['sapburn_pct'],  match: ['seve'] },
    { key: 'anthrac',  label: 'Anthracnose',             kind: 'loss',  where: 'ext', link: ['anthrac_pct'],  match: ['anthracnose'] },
    { key: 'chill',    label: 'Dégâts de froid',         kind: 'loss',  where: 'ext', link: ['chill_pct'],    match: ['froid'] },
    { key: 'stemrot',  label: 'Pourriture pédonculaire', kind: 'loss',  where: 'int', link: ['stemrot_pct'],  match: ['pourriture'] },
    { key: 'jelly',    label: 'Effondrement interne',    kind: 'loss',  where: 'int', link: ['jelly_pct'],    match: ['effondrement', 'jelly'] }
  ]
};

/* Colis ouverts par palette, et poids du colis auquel le calibre
   correspond. Avocat : le calibre compte les fruits d'un colis de
   4 kg — un colis de 10 kg en contient 2,5 fois plus. Mangue : le
   calibre compte les fruits du colis tel qu'il est. */
export const DEFAULT_SAMPLING = {
  avocat: { boxes: 10, perKg: 4, cut: 10 },
  mangue: { boxes: 10, perKg: null, cut: 10 }
};

const num = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
};

export function defectTypes(group) {
  const c = group?.config?.defects;
  if (Array.isArray(c)) return c.filter(d => d && d.key && d.label);
  return DEFAULT_DEFECTS[group?.id] || [];
}

export function samplingCfg(group) {
  const s = group?.config?.sampling || {};
  const d = DEFAULT_SAMPLING[group?.id] || { boxes: 10, perKg: null, cut: 10 };
  return {
    boxes: num(s.boxes) > 0 ? num(s.boxes) : d.boxes,
    perKg: 'perKg' in s ? (num(s.perKg) > 0 ? num(s.perKg) : null) : d.perKg,
    cut: num(s.cut) > 0 ? Math.round(num(s.cut)) : d.cut
  };
}

/* Pressions obligatoires : avocat et mangue en réception, sauf réglage
   contraire du produit. */
export function pressureRequired(group, type) {
  const req = group?.config?.pressure?.requiredFor;
  if (Array.isArray(req)) return req.includes(type);
  return type === 'reception' && ['avocat', 'mangue'].includes(group?.id);
}

/* Champs visibles de la grille pour ce type — même règle que la
   saisie, écrite ici pour ne pas dépendre du module de verdict. */
function liveFields(group, type) {
  const out = [];
  for (const s of group?.config?.sections || []) {
    if (isHidden(s) || !appliesTo(s, type)) continue;
    for (const f of s.fields || []) if (fieldLive(s, f, type)) out.push(f);
  }
  return out;
}

/* Critère de la grille qu'un défaut alimente, ou null. */
export function resolveLink(def, group, type) {
  const pct = liveFields(group, type).filter(f => f.type === 'pct');
  if (typeof def.link === 'string') return pct.some(f => f.key === def.link) ? def.link : null;
  for (const k of def.link || []) if (pct.some(f => f.key === k)) return k;
  for (const m of def.match || []) {
    const f = pct.find(x => norm(x.label).includes(norm(m)));
    if (f) return f.key;
  }
  return null;
}

/* ----------------------------- palette ----------------------------- */
export function calCount(pal) {
  const n = num(pal?.count) ?? (/^\s*\d+\s*$/.test(String(pal?.cal ?? '')) ? Number(pal.cal) : null);
  return n > 0 ? n : null;
}

export function fruitsPerBox(pal, group) {
  const c = calCount(pal);
  if (!c) return null;
  const { perKg } = samplingCfg(group);
  const kg = num(pal?.boxKg);
  return perKg && kg > 0 ? c * kg / perKg : c;
}

/* Fruits contrôlés, fruits coupés et fruits de la palette. Un nombre
   saisi à la main (calibre non chiffré, colis ouverts ou fruits coupés
   en plus) prime sur le calcul. `lotCut` : les fruits coupés par
   palette figés dans le rapport ; absent (rapport d'avant la 3.2), les
   défauts internes se rapportent aux fruits contrôlés. */
export function palletSample(pal, group, lotCut) {
  const fpb = fruitsPerBox(pal, group);
  const { boxes } = samplingCfg(group);
  const manual = num(pal?.chk);
  const checked = manual > 0 ? manual : (fpb ? Math.round(boxes * fpb) : null);
  const total = fpb && num(pal?.boxes) > 0 ? Math.round(num(pal.boxes) * fpb) : null;
  const ownCut = num(pal?.cut), lc = num(lotCut);
  const legacy = !(ownCut > 0) && !(lc > 0);
  const cut = ownCut > 0 ? Math.round(ownCut) : lc > 0 ? Math.round(lc) : checked;
  return { fpb, checked, total, cut, legacy };
}

/* L'échantillon auquel se rapporte un défaut : les fruits coupés pour
   un défaut interne, les fruits contrôlés pour un défaut externe. */
export const sampleFor = (t, s) => (t.where === 'int' ? s.cut : s.checked);

export function palletDefects(pal, group, defs = defectTypes(group), lotCut) {
  const { checked, total, fpb, cut, legacy } = palletSample(pal, group, lotCut);
  const d = pal?.d || {};
  const counts = {}, rates = {};
  let ext = 0, int = 0, light = 0, loss = 0, lightPct = 0, lossPct = 0, entered = false;
  for (const t of defs) {
    const n = num(d[t.key]);
    const c = n > 0 ? n : 0;
    if (d[t.key] !== '' && d[t.key] != null) entered = true;
    counts[t.key] = c;
    const base = sampleFor(t, { checked, cut });
    rates[t.key] = base ? (c / base) * 100 : null;
    if (t.where === 'int') int += c; else ext += c;
    if (t.kind === 'loss') { loss += c; lossPct += rates[t.key] || 0; }
    else { light += c; lightPct += rates[t.key] || 0; }
  }
  return { checked, cut, legacy, total, fpb, counts, rates, ext, int, light, loss,
           lightPct: checked ? lightPct : null, lossPct: checked ? lossPct : null, entered };
}

/* Comptages impossibles : plus de fruits touchés que de fruits
   examinés pour ce défaut (12 pourritures sur 10 fruits coupés). */
export function palletOverCounts(pal, group, defs = defectTypes(group), lotCut) {
  const s = palletSample(pal, group, lotCut);
  const out = [];
  for (const t of defs) {
    const n = num(pal?.d?.[t.key]);
    const base = sampleFor(t, s);
    if (n > 0 && base && n > base) out.push({ def: t, n, base });
  }
  return out;
}

/* Sous-calibre : fruits pesés sous le poids minimum de leur calibre.
   Les `fruits` fruits de la pression sont tous pesés, seuls les trop
   légers sont notés (voir palletWeighing) : `weighed` vaut 5 dès que
   la palette est mesurée, et 0 si son calibre n'a pas de minimum. */
export function palletUnder(pal, group, fruits) {
  const s = palletWeighing(pal, group, fruits);
  const judged = s.min != null && s.weighed > 0;
  return { min: s.min, max: s.max, weighed: judged ? s.weighed : 0, under: judged ? s.under : 0,
           weights: judged ? s.lows : [], pct: judged ? s.pct : null };
}

/* ------------------------------- lot -------------------------------
   Tout ce que la fiche, le PDF et l'Excel affichent, calculé en un
   seul endroit. `links` : valeur de chaque critère lié de la grille. */
export function receptionStats(pressures, group, type = 'reception') {
  const defs = type === 'reception' ? defectTypes(group) : [];
  const pallets = pressures?.pallets || [];
  const fruits = pressures?.fruits;
  const lotCut = pressures?.cut;
  const rows = pallets.map(p => ({ n: String(p.n ?? ''), p, def: palletDefects(p, group, defs, lotCut), und: palletUnder(p, group, fruits) }));
  const sampled = rows.filter(r => r.def.checked > 0);

  /* Chaque palette pèse son nombre total de fruits, quand on le
     connaît pour toutes ; sinon, ses fruits contrôlés (moyenne
     poolée). */
  const byTotal = sampled.length && sampled.every(r => r.def.total > 0);
  const wDef = (r) => (byTotal ? r.def.total : r.def.checked);
  const W = sampled.reduce((s, r) => s + wDef(r), 0);
  /* Chaque défaut rapporté à son propre échantillon (fruits contrôlés
     ou fruits coupés), puis pondéré par le poids de sa palette. */
  const perType = {};
  for (const t of defs)
    perType[t.key] = W ? sampled.reduce((s, r) => s + (r.def.counts[t.key] / (sampleFor(t, r.def) || r.def.checked)) * wDef(r), 0) / W * 100 : null;
  const sumKind = (k) => (W ? defs.filter(t => (t.kind === 'loss') === (k === 'loss'))
    .reduce((s, t) => s + (perType[t.key] || 0), 0) : null);

  /* Sous-calibre du lot : TOUTES les palettes mesurées, y compris
     celles où rien n'a été noté (leurs fruits sont conformes). Même
     pondération que les défauts : 20 % sur une palette parmi vingt
     palettes semblables, c'est 1 % du lot. */
  const weighed = rows.filter(r => r.und.weighed > 0 && r.und.min != null);
  const byTotalU = weighed.length && weighed.every(r => r.def.total > 0);
  const wU = (r) => (byTotalU ? r.def.total : r.und.weighed);
  const WU = weighed.reduce((s, r) => s + wU(r), 0);
  const underPct = WU ? weighed.reduce((s, r) => s + (r.und.under / r.und.weighed) * wU(r), 0) / WU * 100 : null;

  const links = new Map();
  if (sampled.length) {
    for (const t of defs) {
      const k = resolveLink(t, group, type);
      if (!k) continue;
      links.set(k, (links.get(k) || 0) + (perType[t.key] || 0));
    }
  }

  return {
    active: type === 'reception' && defs.length > 0,
    defs, rows, sampled: sampled.length,
    perType, lightPct: sumKind('light'), lossPct: sumKind('loss'),
    underPct, underCount: weighed.reduce((s, r) => s + r.und.under, 0),
    weighedCount: weighed.reduce((s, r) => s + r.und.weighed, 0),
    checkedTotal: sampled.reduce((s, r) => s + r.def.checked, 0),
    /* Fruits coupés du lot ; null pour un rapport d'avant la 3.2. */
    legacy: rows.every(r => r.def.legacy),
    cutTotal: rows.every(r => r.def.legacy) ? null : sampled.reduce((s, r) => s + (r.def.cut || 0), 0),
    fruitsTotal: byTotal ? sampled.reduce((s, r) => s + r.def.total, 0) : null,
    extCount: rows.reduce((s, r) => s + r.def.ext, 0),
    intCount: rows.reduce((s, r) => s + r.def.int, 0),
    links
  };
}

/* Critères de la grille remplis par le comptage des défauts. */
export function defectLinkedKeys(group, pressures, type) {
  if (type !== 'reception') return new Set();
  const rs = receptionStats(pressures, group, type);
  return new Set(rs.sampled ? rs.links.keys() : []);
}

/* État écrit sous un indicateur du lot coloré (la couleur ne le dit
   jamais seule). `fail` : un critère rempli est hors de son barème. */
export const KPI_TONE = { warn: 'à surveiller', fail: 'hors tolérance' };

/* Point décimal, comme toutes les valeurs des rapports (critères
   « 1.52 % », pressions « 13.0 kg ») : un même PDF ne doit pas écrire
   « 1,7 % » en page 1 et « 1.52 % » en page 2. */
export const fmtPct = (v, dp = 1) => (v == null || !isFinite(v) ? '—'
  : (Math.round(v * 10 ** dp) / 10 ** dp).toFixed(dp));
