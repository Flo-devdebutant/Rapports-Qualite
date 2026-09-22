/* ------------------------------------------------------------------
   Calcul du verdict.
   Trois axes indépendants, comme dans le rapport Fruttital :
     Qualité        — état de la marchandise à l'instant du contrôle
     Conservabilité — combien de temps elle va tenir (fermeté,
                      température, maladies évolutives)
     Évaluation     — conforme ou non à la tolérance de catégorie
   On sépare ces axes parce qu'un lot peut être sain aujourd'hui et
   invendable dans trois jours : un score unique masquerait ce risque.
   ------------------------------------------------------------------ */

import { pressureVerdict, lotStats } from './pressure.js';
import { appliesTo, isHidden, fieldLive } from './report-types.js';

/* Gravité réellement appliquée. Sur un pourcentage ou une liste de
   choix, le barème possède déjà son propre échelon « à surveiller » :
   « mineur » n'y a aucun effet distinct de « majeur », et le laisser
   tel quel faisait dire trois choses différentes au même critère (le
   résumé annonçait « défaut mineur », la pastille virait au rouge et
   le verdict comptait une non-conformité). On le ramène donc à
   « majeur », partout, à l'affichage comme au calcul. */
export const effSeverity = (f) => {
  const s = f?.severity || 'mineur';
  return (f?.type === 'pct' || f?.type === 'choice') && s === 'mineur' ? 'majeur' : s;
};

/* Statut d'un champ isolé : 'ok' | 'warn' | 'fail' | null (non renseigné) */
export function fieldStatus(field, raw) {
  if (raw === '' || raw === null || raw === undefined) return null;
  const sev = effSeverity(field);
  const out = sev === 'mineur' ? 'warn' : 'fail';

  if (field.type === 'bool') return raw === true || raw === 'true' ? 'ok' : out;

  if (field.type === 'choice') {
    const opt = (field.options || []).find(o => o.v === raw);
    return opt ? (opt.s || 'ok') : 'ok';
  }

  const n = Number(raw);
  if (!isFinite(n)) return null;

  if (field.type === 'pct') {
    /* Sans aucun seuil, le critère est informatif : on ne peut pas
       déclarer conforme ce qu'on n'a pas de quoi juger. Renvoyer 'ok'
       ferait compter 80 % de fruits éclatés comme une bonne note et
       remonterait les étoiles. */
    if (field.failAt == null && field.warnAt == null) return null;
    if (field.failAt != null && n >= field.failAt) return 'fail';
    if (field.warnAt != null && n >= field.warnAt) return 'warn';
    return 'ok';
  }

  if (field.type === 'num') {
    if (field.okMin == null && field.okMax == null) return null;   // mesure informative
    const below = field.okMin != null && n < field.okMin;
    const above = field.okMax != null && n > field.okMax;
    return (below || above) ? out : 'ok';
  }
  return null;
}

/* ------------------------------------------------------------------
   Rôles : ce qu'un critère APPORTE au verdict, en plus de son statut.
   Le calcul s'appuyait sur des listes de clés écrites en dur — une
   grille créée par l'utilisateur n'avait alors aucun moyen de nourrir
   la conservabilité ni le taux de non-conformité, quelles que soient
   les valeurs saisies. Le rôle est désormais une propriété du critère,
   réglable dans l'éditeur ; les clés historiques gardent leur rôle par
   défaut pour qu'aucun rapport déjà enregistré ne change de verdict.
     shelf   — pèse sur la conservabilité
     nc      — EST le taux de non-conformité, en %
     sample  — nombre de colis contrôlés
     problem — nombre de colis en défaut  (sample + problem ⇒ %NC)
   ------------------------------------------------------------------ */
export const FIELD_ROLES = {
  '':        'Aucun rôle particulier',
  shelf:     'Compte pour la conservabilité',
  nc:        'Taux de non-conformité (%)',
  sample:    'Nombre de colis contrôlés',
  problem:   'Nombre de colis en défaut',
  /* Renseignés tout seuls depuis le contrôle par palette : ces quatre
     valeurs SONT le relevé au pénétromètre, résumé. Les ressaisir à la
     main, c'était risquer deux chiffres différents pour une même
     mesure dans le même rapport. */
  firmMin:   'Dureté minimale (relevé de pressions)',
  firmMax:   'Dureté maximale (relevé de pressions)',
  firmAvg:   'Dureté moyenne (relevé de pressions)',
  ripeness:  'Stade de mûrissement (relevé de pressions)'
};

/* Rôles remplis depuis la section « contrôle par palette ». */
export const PRESSURE_ROLES = ['firmMin', 'firmMax', 'firmAvg', 'ripeness'];

const DEFAULT_ROLES = {
  nc_pct: 'nc', qt_sample: 'sample', qt_problem: 'problem',
  firm_min: 'firmMin', firm_max: 'firmMax', firm_avg: 'firmAvg', ripe_stage: 'ripeness',
  soft_pct: 'shelf', temp_pulp: 'shelf', decay_pct: 'shelf',
  anthrac_pct: 'shelf', stemrot_pct: 'shelf', chill_pct: 'shelf',
  jelly_pct: 'shelf'
};

/* Dureté et stade de mûrissement pèsent sur la conservabilité au même
   titre qu'un critère explicitement marqué « shelf » : c'est leur
   raison d'être. */
const SHELF_ROLES = ['shelf', 'firmAvg', 'ripeness'];

export const fieldRole = (f) =>
  (f && f.role != null ? f.role : DEFAULT_ROLES[f?.key]) || '';

/* ------------------------------------------------------------------
   Barème des trois indices — réglable par produit.
   Ces seuils étaient écrits en dur : « mauvaise à partir de 3 défauts »
   n'est pourtant pas une vérité universelle, c'est une décision de
   l'entreprise, qui change d'un produit à l'autre. Tout est donc exposé
   dans les réglages, en comptages — la façon dont un responsable
   qualité y pense — et non en points abstraits.
   ------------------------------------------------------------------ */
export const DEFAULT_VERDICT = {
  quality: { badFails: 3, midFails: 1, midWarns: 3 },
  shelf:   { lowFails: 2, midFails: 1, midWarns: 2 },
  /* Ce que vaut un écart de pression, exprimé en « défauts » et en
     « points à surveiller » de conservabilité. */
  press:   { critique: { fail: 2, warn: 0 },
             majeur:   { fail: 1, warn: 0 },
             mineur:   { fail: 0, warn: 1 } },
  /* Un lot déjà mûr ne tiendra pas, même impeccable par ailleurs. Les
     bandes se règlent sur la moyenne du lot au pénétromètre ; vides,
     elles se déduisent des choix du critère de mûrissement. */
  ripeness: { bands: [] },
  eval:     { acceptable: 0.7 }   // part de la tolérance à partir de laquelle c'est « Acceptable »
};

const merge = (d, o) => (o && typeof o === 'object') ? { ...d, ...o } : { ...d };
export function verdictCfg(group) {
  const c = group?.config?.verdict || {};
  return {
    quality:  merge(DEFAULT_VERDICT.quality, c.quality),
    shelf:    merge(DEFAULT_VERDICT.shelf, c.shelf),
    press:    { critique: merge(DEFAULT_VERDICT.press.critique, c.press?.critique),
                majeur:   merge(DEFAULT_VERDICT.press.majeur,   c.press?.majeur),
                mineur:   merge(DEFAULT_VERDICT.press.mineur,   c.press?.mineur) },
    ripeness: { bands: Array.isArray(c.ripeness?.bands) ? c.ripeness.bands : [] },
    eval:     merge(DEFAULT_VERDICT.eval, c.eval)
  };
}

/* Bandes de maturité par défaut : on répartit l'échelle du pénétromètre
   sur les choix du critère de mûrissement, du plus ferme au plus mûr,
   et les deux derniers pèsent sur la conservabilité. C'est un point de
   départ raisonnable, que l'administrateur ajuste ensuite. */
export function autoBands(field, max = 13) {
  const opts = (field?.options || []).map(o => o.v).filter(Boolean);
  if (!opts.length) return [];
  const step = max / opts.length;
  return opts.map((v, i) => {
    const min = Math.round((max - step * (i + 1)) * 10) / 10;
    const rang = opts.length - 1 - i;           // 0 = le plus mûr
    return { min: i === opts.length - 1 ? 0 : min, stage: v,
             fail: rang === 0 ? 2 : rang === 1 ? 1 : 0,
             warn: rang === 2 ? 1 : 0 };
  });
}

/* Bande correspondant à une moyenne de lot. */
export function ripenessBand(avg, bands) {
  if (avg == null || !isFinite(avg) || !Array.isArray(bands) || !bands.length) return null;
  const sorted = [...bands].sort((a, b) => Number(b.min) - Number(a.min));
  return sorted.find(b => avg >= Number(b.min)) || sorted[sorted.length - 1] || null;
}

/* Bandes utilisables : celles réglées, sinon celles déduites. */
export function ripenessBands(group, type) {
  const cfg = verdictCfg(group);
  if (cfg.ripeness.bands.length) return cfg.ripeness.bands;
  const f = flatFields(group, type).find(x => fieldRole(x) === 'ripeness');
  return autoBands(f);
}

/* Champs notés d'un groupe, aplatis avec leur section.
   Le type de rapport filtre ce qui s'applique : la matière sèche se
   contrôle à l'arrivée, pas sur une chaîne de conditionnement. Sans
   type, rien n'est filtré — c'est ce qu'il faut pour relire un
   ancien rapport ou exporter la grille entière. */
export function flatFields(group, type) {
  const out = [];
  for (const s of group?.config?.sections || []) {
    if (isHidden(s)) continue;
    if (!appliesTo(s, type)) continue;
    for (const f of s.fields || []) {
      if (!fieldLive(s, f, type)) continue;
      out.push({ ...f, section: s.id, sectionLabel: s.label, sectionI18n: s.i18n });
    }
  }
  return out;
}

export function computeSummary(group, measures, pressures, type) {
  const fields = flatFields(group, type);
  const tolerance = Number(group?.config?.tolerance ?? 10);
  const cfg = verdictCfg(group);
  const bands = ripenessBands(group, type);
  const lot = lotStats(pressures);

  let fails = 0, warns = 0, oks = 0, critical = 0;
  const flagged = [];

  for (const f of fields) {
    const st = fieldStatus(f, measures[f.key]);
    if (!st) continue;
    if (st === 'ok') { oks++; continue; }
    if (st === 'warn') warns++;
    if (st === 'fail') { fails++; if (effSeverity(f) === 'critique') critical++; }
    flagged.push({ key: f.key, label: f.label, status: st, value: measures[f.key], unit: f.unit });
  }

  /* Les pressions pèsent sur le verdict au même titre qu'un critère
     noté : une palette dont la moyenne s'écarte de la référence est un
     défaut mesuré, pas une annexe. Seules les moyennes par palette
     sont jugées — un fruit isolé ne fait pas une non-conformité. */
  const pv = pressureVerdict(pressures, group);
  if (pv) {
    for (const row of pv.rows) {
      const lvl = row.sev.level;
      if (lvl === 'ok') { oks++; continue; }
      if (lvl === 'mineur') { warns++; }
      else { fails++; if (lvl === 'critique') critical++; }
      flagged.push({
        key: 'pressure_' + row.name, label: `Pression palette ${row.name}`,
        status: lvl === 'mineur' ? 'warn' : 'fail',
        value: Math.round(row.avg * 10) / 10, unit: pv.spec.unit, severity: lvl
      });
    }
  }

  /* %NC : saisi, sinon déduit des colis problématiques. Les champs
     concernés sont désignés par leur rôle, pas par leur nom : une
     grille sur mesure calcule son %NC comme les grilles d'origine. */
  const byRole = (r) => fields.filter(f => fieldRole(f) === r);
  const firstVal = (r) => {
    for (const f of byRole(r)) {
      const v = numOr(measures[f.key], null);
      if (v != null) return v;
    }
    return null;
  };
  let nc = firstVal('nc');
  if (nc == null) {
    const sample = firstVal('sample'), bad = firstVal('problem');
    if (sample != null && sample > 0 && bad != null) nc = (bad / sample) * 100;
  }

  /* Rien de mesuré : aucun verdict. Afficher « Conforme » sur un
     rapport vierge serait faux, et ce rapport pourrait partir tel quel
     chez un client. Un comptage de colis suffit en revanche à rendre un
     verdict : c'est la mesure de non-conformité elle-même. */
  if (oks + warns + fails === 0 && nc == null) {
    return { quality: null, shelf: null, verdict: null, stars: null, nc: null,
             tolerance, fails: 0, warns: 0, oks: 0, critical: 0, flagged: [], pending: true };
  }

  const ncFail = nc != null && nc > tolerance;
  const ncWarn = nc != null && !ncFail && nc > tolerance * (Number(cfg.eval.acceptable) || 0.7);

  /* --- Qualité ---
     Un lot dont le taux de non-conformité dépasse la tolérance ne peut
     pas être de « bonne » qualité, même si tous les autres critères
     passent : c'est le chiffre que le client regardera en premier. */
  const Q = cfg.quality;
  let quality;
  if (critical > 0 || fails >= Q.badFails || (ncFail && fails >= Q.midFails)) quality = 'Mauvaise';
  else if (fails >= Q.midFails || warns >= Q.midWarns || ncFail) quality = 'Moyenne';
  else if (ncWarn && warns >= 1) quality = 'Moyenne';
  else quality = 'Bonne';

  /* --- Conservabilité ---
     Trois sources, et non plus les seuls critères de la grille :
       1. les critères marqués « compte pour la conservabilité » ;
       2. les ÉCARTS de pression à la référence du client ;
       3. le NIVEAU de pression lui-même — un lot à 4 kg est mûr, il ne
          tiendra pas, que le client l'ait demandé ainsi ou non.
     La troisième manquait, et c'est elle qui rendait l'indice
     « Élevée » sur un rapport où seules les pressions étaient
     relevées : rien ne pesait, donc tout allait bien. */
  const S = cfg.shelf;
  let sFail = 0, sWarn = 0;
  const shelfFields = fields.filter(f => SHELF_ROLES.includes(fieldRole(f)));
  for (const f of shelfFields) {
    const st = fieldStatus(f, measures[f.key]);
    if (st === 'fail') sFail++; else if (st === 'warn') sWarn++;
  }
  if (pv) {
    for (const lvl of ['critique', 'majeur', 'mineur']) {
      if (!pv.count[lvl]) continue;
      sFail += Number(cfg.press[lvl]?.fail) || 0;
      sWarn += Number(cfg.press[lvl]?.warn) || 0;
      break;                                   // seul l'écart le plus grave compte
    }
  }
  const band = ripenessBand(lot?.avg, bands);
  if (band) { sFail += Number(band.fail) || 0; sWarn += Number(band.warn) || 0; }

  /* Sans aucun critère de tenue renseigné, sans pression relevée et
     sans maturité connue, on ne sait RIEN de la conservabilité :
     annoncer « Élevée » sur cette base, c'est signer une promesse au
     client à partir d'une page blanche. On laisse la case vide. */
  const shelfKnown = shelfFields.some(f => fieldStatus(f, measures[f.key]) != null)
    || !!pv || !!band;
  const shelf = !shelfKnown ? null
    : sFail >= S.lowFails ? 'Minimale'
    : (sFail >= S.midFails || sWarn >= S.midWarns) ? 'Moyenne' : 'Élevée';

  /* --- Évaluation --- */
  let verdict;
  if (critical > 0 || ncFail) verdict = 'Non Conforme';
  else if (fails > 0 || ncWarn) verdict = 'Acceptable';
  else verdict = 'Conforme';

  /* --- Étoiles (1 à 5), pour le tri et les statistiques ---
     Les étoiles suivent les trois axes : elles ne peuvent pas être
     hautes sur un rapport que la même page déclare mauvais. */
  const scored = oks + warns + fails;
  let stars;
  if (scored > 0) {
    const ratio = (oks + warns * 0.5) / scored;
    stars = Math.max(1, Math.min(5, Math.round(ratio * 4) + 1));
  } else {
    /* Rien de noté, seul le taux de non-conformité est connu : cinq
       étoiles diraient « contrôle irréprochable » sur un rapport où
       personne n'a regardé un fruit. Trois au plus. */
    stars = 3;
  }
  if (quality === 'Moyenne') stars = Math.min(stars, 4);
  if (quality === 'Mauvaise') stars = Math.min(stars, 2);
  if (critical > 0) stars = Math.min(stars, 2);
  if (verdict === 'Non Conforme') stars = Math.min(stars, 3);
  if (verdict === 'Acceptable') stars = Math.min(stars, 4);

  return {
    quality, shelf, verdict, stars,
    nc: nc == null ? null : Math.round(nc * 100) / 100,
    tolerance, fails, warns, oks, critical, flagged,
    ripeness: band ? { stage: band.stage, avg: lot.avg } : null,
    pressure: pv ? { worst: pv.worst, count: pv.count, ref: pv.spec } : null
  };
}

const numOr = (v, d) => {
  if (v === '' || v === null || v === undefined) return d;
  const n = Number(v);
  return isFinite(n) ? n : d;
};

export const STATUS_COLORS = { ok: '#16a34a', warn: '#f59e0b', fail: '#dc2626' };
export const VERDICT_STATUS = { 'Conforme': 'ok', 'Acceptable': 'warn', 'Non Conforme': 'fail' };
export const QUALITY_STATUS = { 'Bonne': 'ok', 'Moyenne': 'warn', 'Mauvaise': 'fail' };
export const SHELF_STATUS   = { 'Élevée': 'ok', 'Moyenne': 'warn', 'Minimale': 'fail' };

/* Valeurs calculées (poids net, %NC) recalculées à chaque saisie. */
export function applyComputed(group, measures, pressures, type) {
  const out = { ...measures };

  /* --- Dureté et maturité, depuis le contrôle par palette ---
     Ces quatre valeurs sont le RÉSUMÉ du relevé au pénétromètre. Les
     laisser à la saisie manuelle, c'était accepter que le même rapport
     annonce une dureté moyenne de 9 dans un tableau et de 11 dans
     l'autre. Elles écrasent donc ce qui a pu être tapé : ce n'est pas
     une valeur concurrente, c'est la même, calculée. */
  const lot = lotStats(pressures);
  if (lot) {
    const bands = ripenessBands(group, type);
    const band = ripenessBand(lot.avg, bands);
    for (const f of flatFields(group, type)) {
      const role = fieldRole(f);
      if (role === 'firmMin')  out[f.key] = round2(lot.min);
      if (role === 'firmMax')  out[f.key] = round2(lot.max);
      if (role === 'firmAvg')  out[f.key] = round2(lot.avg);
      if (role === 'ripeness' && band?.stage) out[f.key] = band.stage;
      if (PRESSURE_ROLES.includes(role)) delete out['_manual_' + f.key];
    }
  }

  for (const f of flatFields(group)) {
    if (!f.computed) continue;
    if (f.key === 'pkg_net') {
      const g = numOr(out.pkg_gross, null), t = numOr(out.pkg_tare, null);
      if (g != null && t != null && out._manual_pkg_net !== true) out.pkg_net = round2(g - t);
    }
    /* Le %NC se recalcule à partir des champs qui portent les rôles
       « contrôlés » et « en défaut », quel que soit leur nom : une
       grille sur mesure bénéficie du même automatisme. */
    if (fieldRole(f) === 'nc') {
      const all = flatFields(group);
      const pick = (r) => {
        for (const x of all) if (fieldRole(x) === r) {
          const v = numOr(out[x.key], null);
          if (v != null) return v;
        }
        return null;
      };
      const s = pick('sample'), b = pick('problem');
      if (s && b != null && out['_manual_' + f.key] !== true) out[f.key] = round2((b / s) * 100);
    }
  }
  return out;
}
const round2 = (n) => Math.round(n * 100) / 100;
