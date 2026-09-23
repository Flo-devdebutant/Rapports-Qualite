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
import { receptionStats, defectLinkedKeys, defectTypes, resolveLink } from './reception.js';

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
    /* 0 % de défaut n'est jamais un défaut. Un seuil réglé à 0 veut
       dire « le moindre fruit touché » : sans cette ligne, un lot
       sans aucune pulpe grise sortait « à surveiller » dès que le
       comptage par palette remplissait le critère à 0. */
    if (n <= 0) return 'ok';
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
     paliers se lisent sur la moyenne du lot au pénétromètre. Quand les
     libellés du stade portent leur plage (« Prêt à manger (0,6–2,5 kg) »),
     ce sont EUX qui donnent les seuils ; les paliers enregistrés ne
     fixent alors que leur poids sur la conservabilité. */
  ripeness: { bands: [],
              /* Quand le lot respecte la référence du client, sa
                 maturité est celle qu'il a commandée : on ne la compte
                 pas comme un défaut. Décochez pour juger la maturité
                 dans l'absolu, référence ou pas. */
              onlyOutsideRef: true },
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
    ripeness: { bands: Array.isArray(c.ripeness?.bands) ? c.ripeness.bands : [],
                onlyOutsideRef: c.ripeness?.onlyOutsideRef !== false },
    eval:     merge(DEFAULT_VERDICT.eval, c.eval)
  };
}

/* La partie d'un libellé qui exprime une pression : la parenthèse
   finale, ou à défaut le libellé entier s'il contient une unité ou un
   comparateur. « Stade 2 » n'est PAS une pression de 2 kg — lire ce
   chiffre-là, ce serait recommencer à inventer une échelle. */
const PRESS_HINT = /[<>\u2264\u2265]|\d\s*(?:kg|kgf|lbs?|lbf|n)\b|moins de|plus de/i;
function pressurePart(label) {
  const s = String(label || '');
  const paren = s.match(/\(([^()]*)\)\s*$/);
  if (paren && /\d/.test(paren[1])) return paren[1];
  return PRESS_HINT.test(s) ? s : null;
}

/* Les libellés du stade de mûrissement portent très souvent l'échelle
   eux-mêmes — « Bon pour rayon (1,1–2,1 kg) », « Surmûr (< 0,5 kg) ».
   C'est LA bonne source : elle vient du métier, pas d'un calcul. On en
   extrait le seuil bas de chaque palier.
     « > 10 kg »   → 10
     « 2,2–10 kg » → 2,2
     « < 0,5 kg »  → 0   (borne haute : c'est le dernier palier) */
export function bandsFromLabels(field) {
  const opts = (field?.options || []).filter(o => o.v);
  if (!opts.length) return null;
  const out = [];
  for (const o of opts) {
    const part = pressurePart(o.v);
    const nums = part && part.replace(/(\d),(\d)/g, '$1.$2').match(/\d+(?:\.\d+)?/g);
    if (!nums) return null;                      // un seul libellé muet : on renonce
    const borneHaute = /[<\u2264]|moins/i.test(part);
    out.push({ stage: o.v, min: borneHaute ? 0 : Math.min(...nums.map(Number)) });
  }
  /* Sans seuils distincts, l'échelle ne veut rien dire. */
  if (new Set(out.map(b => b.min)).size < out.length) return null;
  out.sort((a, b) => b.min - a.min);
  /* L'impact sur la conservabilité suit le rang : les deux paliers les
     plus mûrs pèsent, les autres non. Réglable ensuite. */
  return out.map((b, i) => {
    const rang = out.length - 1 - i;             // 0 = le plus mûr
    return { ...b, fail: rang === 0 ? 2 : rang === 1 ? 1 : 0, warn: rang === 2 ? 1 : 0 };
  });
}

/* Dernier recours, quand aucun libellé ne porte de chiffre : AUCUNE
   bande. Répartir l'échelle du pénétromètre à parts égales entre les
   choix n'a aucun fondement — c'est ce qui faisait écrire « Surmûr »
   sur un lot à 1,44 kg parfaitement conforme au cahier des charges du
   client. Mieux vaut ne rien conclure que conclure faux : le stade
   reste vide, et l'administrateur pose l'échelle lui-même. */
export function autoBands(field) {
  return bandsFromLabels(field) || [];
}

/* Bande correspondant à une moyenne de lot. */
export function ripenessBand(avg, bands) {
  if (avg == null || !isFinite(avg) || !Array.isArray(bands) || !bands.length) return null;
  const sorted = [...bands].sort((a, b) => Number(b.min) - Number(a.min));
  return sorted.find(b => avg >= Number(b.min)) || sorted[sorted.length - 1] || null;
}

/* Nom d'un stade sans sa plage, pour reconnaître « Prêt à manger » dans
   « Prêt à manger (0,6–2,5 kg) » : un libellé retouché dans les réglages
   ne doit pas couper le lien avec son palier. */
export const stageBase = (s) => String(s || '')
  .replace(/\([^()]*\)/g, ' ')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();
const sameStage = (a, b) => a === b || (!!stageBase(a) && stageBase(a) === stageBase(b));

/* Le critère que le relevé de pressions renseigne : le premier choix
   dans une liste qui porte le rôle « stade de mûrissement ». */
export function ripenessField(group, type) {
  return flatFields(group, type).find(x => fieldRole(x) === 'ripeness' && x.type === 'choice') || null;
}

/* Paliers utilisables, TOUJOURS exprimés dans les choix actuels du
   critère — jamais un stade qui n'existe plus dans la liste.
     · Libellés chiffrés : les seuils viennent des libellés, qui sont
       imprimés sur le rapport. Un seuil pris ailleurs finirait par
       écrire « Bon pour rayon (2,5–5 kg) » sous une moyenne de 1,4 kg.
       Le barème n'apporte que le poids de chaque palier.
     · Libellés sans chiffres : les seuils sont ceux du barème. */
export function ripenessBands(group, type) {
  const f = ripenessField(group, type);
  if (!f) return [];
  const saved = verdictCfg(group).ripeness.bands;
  const pick = (stage) => saved.find(x => x.stage === stage) || saved.find(x => sameStage(x.stage, stage));

  const fromLabels = bandsFromLabels(f);
  if (fromLabels) {
    return fromLabels.map(b => {
      const s = pick(b.stage);
      return s ? { ...b, fail: Number(s.fail) || 0, warn: Number(s.warn) || 0 } : b;
    });
  }

  const labels = (f.options || []).map(o => o.v).filter(Boolean);
  const out = [];
  for (const b of saved) {
    const stage = labels.find(l => l === b.stage) || labels.find(l => sameStage(l, b.stage));
    const min = Number(b.min);
    if (!stage || b.min === '' || b.min == null || !isFinite(min)) continue;
    if (out.some(x => x.stage === stage)) continue;
    out.push({ min, stage, fail: Number(b.fail) || 0, warn: Number(b.warn) || 0 });
  }
  return out.sort((a, b) => b.min - a.min);
}

/* Ce champ est-il le résumé du relevé de pressions ? Les trois duretés
   toujours (si ce sont des mesures chiffrées) ; le stade seulement
   quand une échelle permet de le déduire — sinon il reste à saisir, et
   le verrouiller laisserait une case vide que personne ne peut remplir. */
function derivedField(group, f, type) {
  const role = fieldRole(f);
  if (role === 'firmMin' || role === 'firmMax' || role === 'firmAvg') return f.type === 'num';
  if (role !== 'ripeness') return false;
  const rf = ripenessField(group, type);
  return !!rf && rf.key === f.key && ripenessBands(group, type).length > 0;
}

/* Rempli tout seul depuis le contrôle par palette : les duretés et le
   stade (relevé de pressions), et à la réception les % de défauts liés
   au comptage palette par palette. */
export function autoFilled(group, f, pressures, type) {
  return (!!lotStats(pressures) && derivedField(group, f, type))
    || defectLinkedKeys(group, pressures, type).has(f.key);
}

/* ------------------------------------------------------------------
   Contexte de jugement d'un rapport.
   Dureté et maturité déduites des pressions sont DÉCRITES, pas jugées,
   quand le lot respecte la référence (celle du client, ou à défaut
   celle du produit) : c'est le cahier des charges qui dit ce que la
   marchandise doit être, et il la déclare conforme. Un lot à 1,4 kg
   livré à un client qui demande 1 à 2 kg est exactement ce qu'il a
   commandé — le compter comme un défaut parce qu'il est mûr, c'est
   reprocher au lot d'être conforme.
   Ce contexte sert au calcul ET à l'affichage : sans lui, la saisie,
   la fiche, le PDF et l'Excel recalculaient chaque pastille dans
   l'absolu, et la ligne « Stade de mûrissement » s'affichait en défaut
   sous un verdict qui ne la comptait pas.
   ------------------------------------------------------------------ */
export function judgeContext(group, pressures, type) {
  const cfg = verdictCfg(group);
  const lot = lotStats(pressures);
  const pv = pressureVerdict(pressures, group);
  /* « Respecter » la référence, c'est être DANS la plage (ou dans la
     zone conforme autour de la cible) — pas dans le point de
     débordement toléré : un lot à 0,4 kg pour une plage de 1 à 2 kg
     passe la tolérance, mais son « Surmûr » doit rester visible. */
  const inRef = !!(pv && pv.lot && pv.lot.level === 'ok' && !pv.lot.tol);
  const judged = !lot || !inRef || !cfg.ripeness.onlyOutsideRef;
  const descriptive = new Set(judged ? [] :
    flatFields(group, type).filter(f => derivedField(group, f, type)).map(f => f.key));
  return { cfg, lot, pv, inRef, judged, descriptive };
}

/* Même contexte, relu dans un rapport enregistré : la liste des champs
   décrits est figée dans son résumé, comme le reste du verdict. Un
   rapport calculé avant cette règle n'en porte pas — il s'affiche tel
   qu'il a été jugé. */
export const savedContext = (summary) => ({ descriptive: new Set(summary?.descriptive || []) });

/* Statut d'un critère DANS un rapport donné. */
export function statusIn(ctx, field, raw) {
  const st = fieldStatus(field, raw);
  return st && ctx?.descriptive?.has(field.key) ? 'ok' : st;
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
  const bands = ripenessBands(group, type);

  /* Les pressions se jugent en premier : leur verdict décide si la
     dureté et la maturité déduites sont notées ou seulement décrites
     (voir judgeContext). Une valeur décrite compte comme conforme :
     le cahier des charges l'a validée. */
  const ctx = judgeContext(group, pressures, type);
  const { cfg, lot, pv } = ctx;

  let fails = 0, warns = 0, oks = 0, critical = 0;
  const flagged = [];

  for (const f of fields) {
    const st = statusIn(ctx, f, measures[f.key]);
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
    const st = statusIn(ctx, f, measures[f.key]);
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
  /* Même règle pour le palier de maturité : il ne pèse que si le lot
     s'écarte de ce que le client a demandé, ou qu'aucune référence
     n'est posée. */
  if (band && ctx.judged) { sFail += Number(band.fail) || 0; sWarn += Number(band.warn) || 0; }

  /* Sans aucun critère de tenue renseigné, sans pression relevée et
     sans maturité connue, on ne sait RIEN de la conservabilité :
     annoncer « Élevée » sur cette base, c'est signer une promesse au
     client à partir d'une page blanche. On laisse la case vide. */
  const shelfKnown = shelfFields.some(f => statusIn(ctx, f, measures[f.key]) != null)
    || !!pv || !!band;
  /* Un lot conforme à la référence a une conservabilité connue : celle
     que le client a commandée. On ne la dégrade pas, on ne la gonfle
     pas non plus. */
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
    reception: receptionSummary(group, pressures, type, receptionTones(group, type, fields, ctx, measures)),
    /* Champs décrits sans être jugés, figés avec le verdict : la fiche,
       le PDF et l'Excel les affichent comme le calcul les a comptés. */
    descriptive: [...ctx.descriptive],
    pressure: pv ? { worst: pv.worst, count: pv.count, ref: pv.spec } : null
  };
}

/* Indicateurs de la réception, figés avec le verdict : la fiche, le
   PDF, l'Excel et les statistiques lisent les mêmes chiffres. */
function receptionSummary(group, pressures, type, tones) {
  if (type !== 'reception') return null;
  const rs = receptionStats(pressures, group, type);
  if (!rs.active && !rs.weighedCount) return null;
  if (!rs.sampled && !rs.weighedCount) return null;
  const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
  return { light: r2(rs.lightPct), loss: r2(rs.lossPct), under: r2(rs.underPct),
           checked: rs.checkedTotal, fruits: rs.fruitsTotal,
           ext: rs.extCount, int: rs.intCount, underCount: rs.underCount, weighed: rs.weighedCount,
           tone: {
             light: rs.sampled ? tones?.light || null : null,
             loss: rs.sampled ? tones?.loss || null : null,
             under: rs.underPct == null ? null : rs.underPct > 0 ? 'warn' : 'ok'
           } };
}

/* Couleur des indicateurs du lot : celle du verdict des critères qu'ils
   remplissent. Un chiffre non nul n'est pas un défaut en soi — 0,2 % de
   pertes sur un lot conforme ne s'affiche pas en rouge sur le PDF que
   reçoit le fournisseur. Le sous-calibre, qu'aucun critère de la grille
   ne juge, reste un simple « à surveiller » (voir receptionSummary). */
function receptionTones(group, type, fields, ctx, measures) {
  if (type !== 'reception') return null;
  const byKey = new Map(fields.map(f => [f.key, f]));
  const worst = (loss) => {
    let tone = null;
    for (const t of defectTypes(group)) {
      if ((t.kind === 'loss') !== loss) continue;
      const k = resolveLink(t, group, type);
      const f = k && byKey.get(k);
      const st = f ? statusIn(ctx, f, measures[k]) : null;
      if (st === 'fail') return 'fail';
      if (st === 'warn') tone = 'warn';
      else if (st === 'ok' && !tone) tone = 'ok';
    }
    return tone;
  };
  return { light: worst(false), loss: worst(true) };
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
    const band = ripenessBand(lot.avg, ripenessBands(group, type));
    for (const f of flatFields(group, type)) {
      if (!derivedField(group, f, type)) continue;
      const role = fieldRole(f);
      if (role === 'firmMin')  out[f.key] = round2(lot.min);
      if (role === 'firmMax')  out[f.key] = round2(lot.max);
      if (role === 'firmAvg')  out[f.key] = round2(lot.avg);
      if (role === 'ripeness' && band) out[f.key] = band.stage;
      delete out['_manual_' + f.key];
    }
  }

  /* --- Défauts comptés palette par palette (réception) ---
     Chaque critère lié reçoit le % du lot : c'est le même chiffre que
     celui du tableau par palette, pas une seconde saisie. */
  if (type === 'reception') {
    const rs = receptionStats(pressures, group, type);
    if (rs.sampled) for (const [k, v] of rs.links) { out[k] = round2(v); delete out['_manual_' + k]; }
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
