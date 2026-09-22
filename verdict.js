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

import { pressureVerdict } from './pressure.js';
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
  problem:   'Nombre de colis en défaut'
};

const DEFAULT_ROLES = {
  nc_pct: 'nc', qt_sample: 'sample', qt_problem: 'problem',
  firm_avg: 'shelf', soft_pct: 'shelf', temp_pulp: 'shelf', decay_pct: 'shelf',
  anthrac_pct: 'shelf', stemrot_pct: 'shelf', chill_pct: 'shelf',
  ripe_stage: 'shelf', jelly_pct: 'shelf'
};

export const fieldRole = (f) =>
  (f && f.role != null ? f.role : DEFAULT_ROLES[f?.key]) || '';

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
  const ncWarn = nc != null && !ncFail && nc > tolerance * 0.7;

  /* --- Qualité ---
     Un lot dont le taux de non-conformité dépasse la tolérance ne peut
     pas être de « bonne » qualité, même si tous les autres critères
     passent : c'est le chiffre que le client regardera en premier. */
  let quality;
  if (critical > 0 || fails >= 3 || (ncFail && fails >= 1)) quality = 'Mauvaise';
  else if (fails >= 1 || warns >= 3 || ncFail) quality = 'Moyenne';
  else if (ncWarn && warns >= 1) quality = 'Moyenne';
  else quality = 'Bonne';

  /* --- Conservabilité ---
     Pilotée par les critères qui gouvernent la tenue dans le temps :
     fermeté, température, maladies évolutives, taux de mûr/mou. */
  let sFail = 0, sWarn = 0;
  for (const f of byRole('shelf')) {
    const st = fieldStatus(f, measures[f.key]);
    if (st === 'fail') sFail++; else if (st === 'warn') sWarn++;
  }
  /* La pression EST la fermeté : un lot trop mûr à l'arrivée ne tiendra
     pas, quelle que soit sa propreté. Elle compte donc aussi ici. */
  if (pv) {
    if (pv.count.critique) sFail += 2;
    else if (pv.count.majeur) sFail += 1;
    else if (pv.count.mineur) sWarn += 1;
  }
  /* Sans aucun critère de tenue renseigné et sans pression relevée, on
     ne sait RIEN de la conservabilité : annoncer « Élevée » sur cette
     base, c'est signer une promesse au client à partir d'une page
     blanche. On laisse la case vide. */
  const shelfKnown = byRole('shelf').some(f => fieldStatus(f, measures[f.key]) != null) || !!pv;
  const shelf = !shelfKnown ? null
    : sFail >= 2 ? 'Minimale' : (sFail === 1 || sWarn >= 2) ? 'Moyenne' : 'Élevée';

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
export function applyComputed(group, measures) {
  const out = { ...measures };
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
