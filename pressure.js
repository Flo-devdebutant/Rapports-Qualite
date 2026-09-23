/* ------------------------------------------------------------------
   Pressions au pénétromètre, palette par palette.

   Protocole : on mesure les deux joues de chaque fruit (2 mesures), sur
   un nombre de fruits fixé par produit — 5 pour l'avocat, 3 pour la
   mangue. Le nombre de fruits et de mesures se règle par groupe de
   produit, car un contrôle de prune ne suit pas le même protocole.

   La géométrie du graphique est calculée ici, une seule fois, et servie
   telle quelle au rendu SVG (écran) et au rendu PDF. Les deux courbes
   sont donc rigoureusement identiques — un client qui compare le PDF à
   ce que voit l'inspecteur ne doit pas trouver deux dessins différents.
   ------------------------------------------------------------------ */

import { DEFAULT_GROUPS } from './catalog.js';

export const DEFAULT_PRESSURE = { fruits: 5, sides: 2, ref: 13, unit: 'kg' };

/* Le pénétromètre ne lit rien en dehors de 0 à 13 : une pression
   saisie, une valeur de référence ou une borne de plage hors de cet
   intervalle serait une faute de frappe, jamais une mesure. Tout est
   donc borné à la saisie comme au calcul. */
export const LIMITS = { min: 0, max: 13 };

/* Un champ vide n'est pas zéro. `Number('')` vaut 0, et laisser passer
   ce 0 transformerait « l'admin a effacé la référence » en « la
   référence est 0 kg » : toutes les palettes d'un produit basculeraient
   critiques d'un coup. Le vide remonte donc en `null`, et l'appelant
   décide du repli. */
export const clampP = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  if (!isFinite(n)) return null;
  return Math.min(LIMITS.max, Math.max(LIMITS.min, n));
};

/* L'axe vertical couvre toujours 0 à 14, graduation par graduation :
   une graduation de battement au-dessus du maximum mesurable, pour
   qu'une palette à 13 ne soit pas collée au cadre. Une échelle qui
   s'ajuste au lot ferait paraître identiques un lot à 12,8–13,2 et un
   lot à 6–13 : c'est la maturité réelle qu'on veut lire, pas la
   dispersion relative. */
export const SCALE = { min: 0, max: 14 };

export function pressureConfig(group) {
  const c = group?.config?.pressure || {};
  return {
    fruits: Number(c.fruits) > 0 ? Number(c.fruits) : DEFAULT_PRESSURE.fruits,
    sides:  Number(c.sides)  > 0 ? Number(c.sides)  : DEFAULT_PRESSURE.sides,
    ref:    clampP(c.ref) ?? DEFAULT_PRESSURE.ref,
    unit:   c.unit || DEFAULT_PRESSURE.unit
  };
}

/* Moyenne, min et max d'une palette. Une valeur laissée vide est
   ignorée : une palette partiellement mesurée reste exploitable. */
export function palletStats(pallet) {
  const v = (pallet?.v || []).filter(x => x !== '' && x != null)
    .map(clampP).filter(x => x != null);
  if (!v.length) return null;
  const sum = v.reduce((a, b) => a + b, 0);
  return { n: v.length, avg: sum / v.length, min: Math.min(...v), max: Math.max(...v) };
}

export function lotStats(pressures) {
  const pallets = (pressures?.pallets || []).map(p => ({ p, s: palletStats(p) })).filter(x => x.s);
  if (!pallets.length) return null;
  const all = pallets.flatMap(x => (x.p.v || []).filter(v => v !== '' && v != null)
    .map(clampP).filter(v => v != null));
  const avg = all.reduce((a, b) => a + b, 0) / all.length;
  return {
    pallets: pallets.map(x => ({ name: String(x.p.n ?? ''), ...x.s })),
    count: pallets.length,
    measures: all.length,
    avg, min: Math.min(...all), max: Math.max(...all)
  };
}

export const hasPressures = (h) => !!lotStats(h?.pressures) || !!weightLotStats(h?.pressures);

/* ------------------- référence et gravité -------------------
   La pression attendue n'est pas une constante : à l'arrivage nous
   voulons les fruits à 13 parce que nous les mûrissons nous-mêmes,
   mais à l'expédition c'est le cahier des charges du client qui
   commande. La référence est donc soit une valeur cible, soit une
   plage acceptée, et elle peut venir du carnet client comme de la
   saisie du contrôleur.

   Le barème ne s'applique qu'aux MOYENNES par palette. Un fruit isolé
   à 8 dans une palette à 13 est une anomalie de fruit, pas un défaut
   de palette : le compter comme non-conformité ferait sortir tous les
   lots. */
export const REF_MODES = { target: 'target', range: 'range' };

/* Écart toléré autour d'une plage. Au-delà : critique, sans échelon
   intermédiaire — une plage est déjà une tolérance négociée. */
export const RANGE_TOL = 1;

/* Barème en mode valeur cible, en points d'écart à la référence. */
export const SEV_STEPS = { ok: 1, mineur: 3, majeur: 6 };

export const SEV_ORDER = ['ok', 'mineur', 'majeur', 'critique'];
export const sevRank = (l) => Math.max(0, SEV_ORDER.indexOf(l || 'ok'));
export const worstSev = (a, b) => (sevRank(a) >= sevRank(b) ? a : b);

/* Palette d'état de la charte data-viz — fixe, jamais thématisée.
   Sur fond clair, « mineur » et « majeur » passent sous 3:1 : c'est
   assumé par la charte à condition que la couleur ne porte jamais
   l'information seule. D'où, partout : une colonne État en toutes
   lettres dans le tableau, une légende nommée, et une étiquette de
   valeur posée d'office sur chaque point hors tolérance. */
export const SEV_COLOR = {
  ok:       '#0ca30c',
  mineur:   '#fab219',
  majeur:   '#ec835a',
  critique: '#d03b3b'
};

/* Ces mêmes teintes ne conviennent pas à du TEXTE : sur blanc, le
   jaune d'état tombe à 1,8:1 et serait illisible en corps 8. Pour un
   mot ou un nombre coloré, on descend donc d'un cran dans la même
   teinte — mesuré, pas estimé : 4,5:1 au moins sur chaque fond.
   La marque garde la couleur d'état, le texte prend celle-ci. */
export const SEV_INK = {
  ok: '#0a8a0a', mineur: '#9a6300', majeur: '#a84a22', critique: '#d03b3b'
};
export const SEV_INK_DARK = {
  ok: '#0ca30c', mineur: '#fab219', majeur: '#ec835a', critique: '#e05656'
};

export const SEV_LABEL = {
  ok: 'Conforme', tol: 'Toléré',
  mineur: 'Écart mineur', majeur: 'Écart majeur', critique: 'Écart critique'
};

/* Une forme par niveau, en plus de la couleur. L'outil de contrôle de
   la charte le confirme : vert et rouge d'état se distinguent mal en
   deutéranopie (ΔE 4,1), jaune et orange se ressemblent même en vision
   normale (ΔE 13,6). Un daltonien lit donc le niveau à la forme, tout
   le monde le lit à la position du point vis-à-vis de la zone
   acceptée, et la couleur ne fait que confirmer. Les mêmes formes
   servent à l'écran, dans le PDF et dans les légendes. */
export function sevMark(level, x, y, scale = 1) {
  const s = (r) => r * scale;
  if (!level || level === 'ok') return { kind: 'circle', x, y, r: s(4.4) };
  if (level === 'mineur')
    return { kind: 'poly', pts: [[0, -s(5.4)], [s(5.4), 0], [0, s(5.4)], [-s(5.4), 0]].map(m) };
  if (level === 'majeur')
    return { kind: 'poly', pts: [[0, -s(5.8)], [s(5.3), s(4.1)], [-s(5.3), s(4.1)]].map(m) };
  return { kind: 'poly', pts: [[-s(4.2), -s(4.2)], [s(4.2), -s(4.2)], [s(4.2), s(4.2)], [-s(4.2), s(4.2)]].map(m) };

  function m([dx, dy]) { return { x: x + dx, y: y + dy }; }
}

/* Normalise la référence d'un rapport. Renvoie toujours un objet
   exploitable, ou null si aucune référence n'est définie — auquel cas
   aucune gravité n'est calculée et le graphique reste neutre. */
export function refSpec(pressures, group) {
  const p = pressures || {};
  const cfg = pressureConfig(group);
  const unit = p.unit || cfg.unit;
  const mode = p.mode === 'range' ? 'range' : 'target';

  if (mode === 'range') {
    const lo = clampP(num(p.rmin)), hi = clampP(num(p.rmax));
    if (lo == null || hi == null) return null;
    return { mode: 'range', min: Math.min(lo, hi), max: Math.max(lo, hi), tol: RANGE_TOL,
             unit, source: p.refSource || 'manuel', client: p.refClient || '' };
  }
  const ref = clampP(p.ref) ?? clampP(cfg.ref);
  if (ref == null) return null;
  return { mode: 'target', ref, unit, source: p.refSource || 'produit', client: p.refClient || '' };
}

/* Gravité d'une moyenne de palette face à la référence.
   Valeur cible : 1 point d'écart passe, jusqu'à 3 c'est mineur,
   jusqu'à 6 majeur, au-delà critique.
   Plage : dans la plage c'est conforme, 1 point de débordement est
   toléré, au-delà c'est critique et non conforme. */
export function palletSeverity(avg, spec) {
  if (avg == null || !isFinite(avg) || !spec) return null;
  if (spec.mode === 'range') {
    if (avg >= spec.min && avg <= spec.max) return { level: 'ok', d: 0, side: '' };
    const under = avg < spec.min;
    const d = under ? spec.min - avg : avg - spec.max;
    const side = under ? 'under' : 'over';
    if (d <= spec.tol + 1e-9) return { level: 'ok', tol: true, d, side };
    return { level: 'critique', d, side };
  }
  const d = Math.abs(avg - spec.ref);
  const side = avg === spec.ref ? '' : (avg < spec.ref ? 'under' : 'over');
  if (d <= SEV_STEPS.ok + 1e-9)     return { level: 'ok', d, side };
  if (d <= SEV_STEPS.mineur + 1e-9) return { level: 'mineur', d, side };
  if (d <= SEV_STEPS.majeur + 1e-9) return { level: 'majeur', d, side };
  return { level: 'critique', d, side };
}

/* Écart d'une mesure isolée à la zone acceptée, en points. Sert à
   signaler un fruit qui sort du lot pendant la saisie — c'est une
   alerte de saisie, pas une gravité : le barème, lui, ne juge que les
   moyennes de palette. */
export function outOfZone(v, spec) {
  const n = num(v);
  if (n == null || !spec) return 0;
  const lo = spec.mode === 'range' ? spec.min : spec.ref - SEV_STEPS.ok;
  const hi = spec.mode === 'range' ? spec.max : spec.ref + SEV_STEPS.ok;
  return n < lo ? lo - n : (n > hi ? n - hi : 0);
}

/* Synthèse des gravités sur tout le lot : ce que le verdict consomme. */
export function pressureVerdict(pressures, group) {
  const spec = refSpec(pressures, group);
  const stats = lotStats(pressures);
  if (!spec || !stats) return null;
  const rows = stats.pallets.map(p => ({ name: p.name, avg: p.avg, sev: palletSeverity(p.avg, spec) }));
  const count = { ok: 0, mineur: 0, majeur: 0, critique: 0 };
  let worst = 'ok';
  for (const r of rows) { count[r.sev.level]++; worst = worstSev(worst, r.sev.level); }
  return { spec, rows, count, worst, lot: palletSeverity(stats.avg, spec), stats };
}

/* Référence enregistrée pour un client, déclinée par produit ET par
   conditionnement : un avocat vrac ne se livre pas à la fermeté d'une
   mangue vrac. Une entrée laissée vide vaut « tous ».

   On retient la ligne la plus précise : produit + conditionnement
   d'abord, puis produit seul, puis conditionnement seul, puis la ligne
   générale. Un client qui n'a qu'une règle générale la garde ; celui
   qui détaille par produit voit le détail l'emporter. */
export function partnerRef(partner, group, packaging) {
  const g = typeof group === 'string' ? group : (group?.id || '');
  const pk = packaging || '';
  const clean = (partner?.config?.pressureRefs || [])
    .filter(r => r && (num(r.ref) != null || (num(r.min) != null && num(r.max) != null)));
  if (!clean.length) return null;

  let hit = null, best = -1;
  for (const r of clean) {
    const rg = r.group || '', rp = r.packaging || '';
    if (rg && rg !== g) continue;          // règle d'un autre produit
    if (rp && rp !== pk) continue;         // règle d'un autre conditionnement
    const score = (rg ? 2 : 0) + (rp ? 1 : 0);
    if (score > best) { best = score; hit = r; }
  }
  if (!hit) return null;

  const scope = { group: hit.group || '', packaging: hit.packaging || '' };
  if (hit.mode === 'range' && num(hit.min) != null && num(hit.max) != null)
    return { mode: 'range', min: clampP(hit.min), max: clampP(hit.max), ...scope };
  if (num(hit.ref) != null) return { mode: 'target', ref: clampP(hit.ref), ...scope };
  return null;
}

/* Décrit la référence en une ligne, pour l'écran comme pour l'export.
   Pas de paramètre de langue : le PDF, lui, compose sa propre ligne
   avec son dictionnaire (voir `drawPressures`). La signature en
   promettait un qui n'a jamais rien traduit. */
export function refText(spec) {
  if (!spec) return '';
  const u = spec.unit || 'kg';
  return spec.mode === 'range'
    ? `${fmtP(spec.min)} – ${fmtP(spec.max)} ${u}`
    : `${fmtP(spec.ref)} ${u}`;
}

const num = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
};

/* ---------------------------- poids ----------------------------
   Chaque fruit de la pression est aussi pesé. Le poids attendu dépend
   du calibre :
   - avocat : un minimum par calibre (`calibreWeights`) — le calibre
     compte les fruits d'un colis de 4 kg, quel que soit le colis réel ;
   - mangue : le calibre dépend AUSSI du colis. Un calibre 10 pèse
     250–315 g en colis de 3 kg, 360–425 g en 4 kg, 600–725 g en 6 kg.
     `sizeTable` reprend la feuille affichée au quai : une ligne par
     tranche de poids, et le calibre de chaque colis dans cette tranche.
   Seul le minimum juge : un fruit plus lourd que prévu profite au
   client. Le maximum est rappelé à l'inspecteur. */

/* La table du groupe ; à défaut (clé absente, jamais enregistrée),
   celle que l'application propose de base pour ce produit. Une table
   vidée dans les réglages reste vide. */
export function sizeTableOf(group) {
  const own = group?.config?.sizeTable;
  if (own !== undefined) return own && Array.isArray(own.rows) && own.rows.length ? own : null;
  const d = DEFAULT_GROUPS.find(g => g.id === group?.id)?.config?.sizeTable;
  return d && Array.isArray(d.rows) && d.rows.length ? d : null;
}

/* « 4 », « 4.0 », « 4,0 » → « 4 » : la même clé partout. */
export const boxKey = (kg) => {
  const n = Number(String(kg ?? '').replace(',', '.'));
  return isFinite(n) && n > 0 ? String(Math.round(n * 100) / 100) : '';
};

/* Poids attendu d'un fruit : { min, max, box } ou null si inconnu.
   Colis inconnu et table par colis : on ne tranche que si un seul
   colis de la table porte ce calibre (le 14 n'existe qu'en 4 kg) ; un
   calibre 10, présent dans les trois colis, reste sans minimum. */
export function calibreRange(group, calibre, boxKg) {
  const cal = String(calibre ?? '').trim();
  if (!cal) return null;
  const t = sizeTableOf(group);
  if (t) {
    const boxes = (t.boxes || []).map(boxKey).filter(Boolean);
    const inCol = (b) => t.rows.find(r => String(r?.cal?.[b] ?? '').trim() === cal);
    const key = boxKey(boxKg);
    let row = null, box = '';
    if (key && boxes.includes(key)) { row = inCol(key); box = key; }
    else if (!key) {
      const hits = boxes.map(b => [b, inCol(b)]).filter(([, r]) => r);
      if (hits.length === 1) [box, row] = hits[0];
    }
    if (row) {
      const min = num(row.min), max = num(row.max);
      if (min != null || max != null) return { min, max, box };
    }
  }
  const table = group?.config?.calibreWeights || {};
  const v = num(table[cal] ?? table[calibre]);
  return v == null ? null : { min: v, max: null, box: '' };
}

export const calibreMin = (group, calibre, boxKg) => calibreRange(group, calibre, boxKg)?.min ?? null;

/* Le calibre dépend-il du colis, sans que ce colis soit connu ? */
export const needsBox = (group, pal) =>
  !!sizeTableOf(group) && !!String(pal?.cal ?? '').trim() && !boxKey(pal?.boxKg) && !calibreRange(group, pal.cal, '');

/* Pesée d'une palette. On pèse `fruits` fruits par palette — ceux de
   la pression : 5 pour l'avocat, 3 pour la mangue — mais seuls ceux
   SOUS le minimum doivent être notés : une case vide est un fruit
   conforme. Le sous-calibre d'une palette se rapporte donc aux fruits
   PESÉS, pas aux cases remplies : un seul fruit noté sous le minimum,
   c'est 1 sur 5 = 20 %, pas 1 sur 1 = 100 %.
   Une palette compte comme pesée dès qu'elle a été mesurée (pression
   ou poids). La moyenne n'a de sens que si tous ses fruits sont notés :
   la moyenne des seuls fruits trop légers ne dit rien du lot. */
export function palletWeighing(pal, group, fruits = DEFAULT_PRESSURE.fruits) {
  const range = calibreRange(group, pal?.cal, pal?.boxKg);
  const min = range?.min ?? null;
  const entered = (pal?.w || []).filter(v => v !== '' && v != null).map(Number).filter(isFinite);
  const sampled = entered.length > 0 || (pal?.v || []).some(v => v !== '' && v != null);
  const weighed = sampled ? Math.max(entered.length, Number(fruits) || 0) : 0;
  const lows = min == null ? [] : entered.filter(v => v < min);
  const complete = entered.length > 0 && entered.length >= weighed;
  return {
    range, min, max: range?.max ?? null,
    entered, n: entered.length, weighed, sampled, complete,
    under: lows.length, lows,
    pct: min != null && weighed ? (lows.length / weighed) * 100 : null,
    avg: complete ? entered.reduce((a, b) => a + b, 0) / entered.length : null
  };
}

/* Le lot : toutes les palettes mesurées dont le calibre a un minimum,
   qu'on y ait noté un poids ou non. `null` si aucun poids n'est noté —
   le rapport n'affiche alors pas de bloc « Poids ». */
export function weightLotStats(pressures, group) {
  const fruits = pressures?.fruits || DEFAULT_PRESSURE.fruits;
  const rows = (pressures?.pallets || []).map(p => ({ p, s: palletWeighing(p, group, fruits) }));
  const noted = rows.filter(x => x.s.n);
  if (!noted.length) return null;
  const judged = rows.filter(x => x.s.min != null && x.s.weighed);
  const values = noted.flatMap(x => x.s.entered);
  const complete = noted.every(x => x.s.complete);
  return {
    pallets: noted.map(x => ({ name: String(x.p.n ?? ''), cal: x.p.cal || '', ...x.s })),
    count: noted.length, fruits,
    measures: values.length,
    judged: judged.length,
    weighed: judged.reduce((t, x) => t + x.s.weighed, 0),
    under: judged.reduce((t, x) => t + x.s.under, 0),
    complete,
    avg: complete ? values.reduce((a, b) => a + b, 0) / values.length : null,
    min: complete ? Math.min(...values) : null,
    max: complete ? Math.max(...values) : null
  };
}

export const fmtG = (v) => String(Math.round(Number(v)));

/* ------------------------ géométrie du graphique ------------------------
   Une courbe : la moyenne par palette. La dispersion interne à chaque
   palette est rendue par une bande min–max discrète — c'est elle qui
   révèle un lot hétérogène que la seule moyenne masquerait.

   L'échelle est fixe (0 à 14, graduée à l'unité) : deux rapports se
   comparent donc à l'œil, et une palette à 7 se voit tomber au milieu
   du cadre au lieu d'être recadrée en haut. La zone acceptée est
   peinte derrière la courbe : l'écart se lit d'abord à la position,
   la couleur ne fait que le confirmer. */
export function chartModel(pressures, { width, height, spec }) {
  const stats = lotStats(pressures);
  if (!stats) return null;

  /* Marge haute généreuse : avec un axe qui monte à 14, une palette à
     13 n'a qu'une graduation au-dessus d'elle — sans cette marge, son
     étiquette de valeur sortirait du cadre. */
  const pad = { l: 30, r: 14, t: 18, b: 22 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;

  /* Domaine fixe, élargi seulement si une mesure ou une référence en
     sort — une pression à 16 doit rester visible. */
  const bounds = [stats.min, stats.max];
  if (spec?.mode === 'range') bounds.push(spec.min - spec.tol, spec.max + spec.tol);
  else if (spec) bounds.push(spec.ref);
  const y0 = Math.min(SCALE.min, Math.floor(Math.min(...bounds)));
  const y1 = Math.max(SCALE.max, Math.ceil(Math.max(...bounds)));
  const yr = y1 - y0;

  const n = stats.pallets.length;
  const x = (i) => pad.l + (n === 1 ? w / 2 : (i / (n - 1)) * w);
  const y = (v) => pad.t + h - ((clamp(v, y0, y1) - y0) / yr) * h;

  /* Toutes les valeurs entières sont étiquetées : c'est la demande, et
     c'est ce qui permet de lire la maturité réelle plutôt qu'une
     tendance relative. Les deux rendus sont dimensionnés pour que les
     quinze graduations tiennent ; le repli une-sur-deux ne sert que si
     un relevé aberrant étire le domaine bien au-delà de 14. */
  const rows = yr + 1;
  const every = (h / rows) >= 9.5 ? 1 : 2;
  const ticks = [];
  for (let v = y0; v <= y1 + 1e-9; v += 1)
    ticks.push({ v, y: y(v), label: (v - y0) % every === 0 || v === y1 });

  /* Zones : l'acceptable en vert pâle, la tolérance d'une plage en
     liseré plus clair au-dessus et au-dessous. */
  const zones = [];
  const zone = (from, to, kind) => {
    const a = clamp(Math.min(from, to), y0, y1), b = clamp(Math.max(from, to), y0, y1);
    if (b > a) zones.push({ kind, from: a, to: b, y: y(b), h: y(a) - y(b) });
  };
  const refLines = [];
  if (spec?.mode === 'range') {
    zone(spec.min, spec.max, 'ok');
    zone(spec.min - spec.tol, spec.min, 'tol');
    zone(spec.max, spec.max + spec.tol, 'tol');
    refLines.push({ v: spec.min, y: y(spec.min) }, { v: spec.max, y: y(spec.max) });
  } else if (spec) {
    zone(spec.ref - SEV_STEPS.ok, spec.ref + SEV_STEPS.ok, 'ok');
    refLines.push({ v: spec.ref, y: y(spec.ref) });
  }

  const points = stats.pallets.map((p, i) => {
    const sev = palletSeverity(p.avg, spec);
    const py = y(p.avg);
    return {
      ...p, i, x: x(i), y: py, yMin: y(p.min), yMax: y(p.max),
      sev, level: sev?.level || null,
      /* L'étiquette se pose au-dessus du point ; elle ne bascule
         dessous que si le point touche le haut du cadre. */
      labelY: py - pad.t < 2 ? py + 16 : py - 10,
      /* Abscisse : le rang de la palette (1, 2, 3…), repris dans la
         colonne « # » du tableau. Un n° réel à 18 chiffres par point
         ne tenait pas : les étiquettes se chevauchaient. */
      label: i % Math.ceil(n / 30) === 0 || i === n - 1 ? String(i + 1) : ''
    };
  });

  /* Un segment porte la gravité la plus sévère de ses deux extrémités :
     la courbe change donc de couleur à l'entrée de la zone en défaut,
     pas après. */
  const segments = [];
  for (let i = 0; i < points.length - 1; i++)
    segments.push({ a: points[i], b: points[i + 1], level: worstSev(points[i].level, points[i + 1].level) });

  return {
    stats, pad, w, h, y0, y1, step: 1, ticks, zones, refLines, segments, points,
    axis: { x0: pad.l, x1: pad.l + w, yTop: pad.t, yBottom: pad.t + h },
    refY: spec?.mode === 'target' ? y(spec.ref) : null,
    avgY: y(stats.avg),
    lotSev: palletSeverity(stats.avg, spec)
  };
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* Alignement de l'étiquette : centrée sauf aux extrémités, où elle
   déborderait sur les graduations ou hors du cadre. */
export const labelAnchor = (i, n) => i === 0 ? 'start' : (i === n - 1 ? 'end' : 'middle');

/* Points méritant une étiquette de valeur : jamais toutes — la
   première, la dernière, les extrêmes, et surtout tout point hors
   tolérance, qui est précisément ce que le lecteur doit voir. */
export function labelledPoints(model) {
  const pts = model.points;
  if (!pts.length) return new Set();
  const keep = new Set([0, pts.length - 1]);
  let lo = 0, hi = 0;
  pts.forEach((p, i) => {
    if (p.avg < pts[lo].avg) lo = i;
    if (p.avg > pts[hi].avg) hi = i;
    if (p.level && p.level !== 'ok') keep.add(i);
  });
  keep.add(lo); keep.add(hi);
  return keep;
}

export const fmtP = (v) => (Math.round(v * 10) / 10).toFixed(1);
