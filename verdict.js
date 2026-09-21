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

/* Statut d'un champ isolé : 'ok' | 'warn' | 'fail' | null (non renseigné) */
export function fieldStatus(field, raw) {
  if (raw === '' || raw === null || raw === undefined) return null;
  const sev = field.severity || 'mineur';
  const out = sev === 'mineur' ? 'warn' : 'fail';

  if (field.type === 'bool') return raw === true || raw === 'true' ? 'ok' : out;

  if (field.type === 'choice') {
    const opt = (field.options || []).find(o => o.v === raw);
    return opt ? (opt.s || 'ok') : 'ok';
  }

  const n = Number(raw);
  if (!isFinite(n)) return null;

  if (field.type === 'pct') {
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

/* Champs notés d'un groupe, aplatis avec leur section. */
export function flatFields(group) {
  const out = [];
  for (const s of group?.config?.sections || [])
    for (const f of s.fields || []) out.push({ ...f, section: s.id, sectionLabel: s.label });
  return out;
}

export function computeSummary(group, measures) {
  const fields = flatFields(group);
  const tolerance = Number(group?.config?.tolerance ?? 10);

  let fails = 0, warns = 0, oks = 0, critical = 0;
  const flagged = [];

  for (const f of fields) {
    const st = fieldStatus(f, measures[f.key]);
    if (!st) continue;
    if (st === 'ok') { oks++; continue; }
    if (st === 'warn') warns++;
    if (st === 'fail') { fails++; if (f.severity === 'critique') critical++; }
    flagged.push({ key: f.key, label: f.label, status: st, value: measures[f.key], unit: f.unit });
  }

  /* %NC : saisi, sinon déduit des caisses problématiques. */
  let nc = numOr(measures.nc_pct, null);
  if (nc == null) {
    const sample = numOr(measures.qt_sample, 0), bad = numOr(measures.qt_problem, 0);
    if (sample > 0) nc = (bad / sample) * 100;
  }

  /* Rien de mesuré : aucun verdict. Afficher « Conforme » sur un
     rapport vierge serait faux, et ce rapport pourrait partir tel quel
     chez un client. */
  if (oks + warns + fails === 0) {
    return { quality: null, shelf: null, verdict: null, stars: null, nc: null,
             tolerance, fails: 0, warns: 0, oks: 0, critical: 0, flagged: [], pending: true };
  }

  /* --- Qualité --- */
  let quality;
  if (critical > 0 || fails >= 3) quality = 'Mauvaise';
  else if (fails >= 1 || warns >= 3) quality = 'Moyenne';
  else quality = 'Bonne';

  /* --- Conservabilité ---
     Pilotée par les critères qui gouvernent la tenue dans le temps :
     fermeté, température, maladies évolutives, taux de mûr/mou. */
  const shelfKeys = ['firm_avg', 'soft_pct', 'temp_pulp', 'decay_pct', 'anthrac_pct', 'stemrot_pct', 'chill_pct', 'ripe_stage', 'jelly_pct'];
  let sFail = 0, sWarn = 0;
  for (const f of fields.filter(f => shelfKeys.includes(f.key))) {
    const st = fieldStatus(f, measures[f.key]);
    if (st === 'fail') sFail++; else if (st === 'warn') sWarn++;
  }
  const shelf = sFail >= 2 ? 'Minimale' : (sFail === 1 || sWarn >= 2) ? 'Moyenne' : 'Élevée';

  /* --- Évaluation --- */
  let verdict;
  if (critical > 0) verdict = 'Non Conforme';
  else if (nc != null && nc > tolerance) verdict = 'Non Conforme';
  else if (fails > 0 || (nc != null && nc > tolerance * 0.7)) verdict = 'Acceptable';
  else verdict = 'Conforme';

  /* --- Étoiles (1 à 5), pour le tri et les statistiques --- */
  const scored = oks + warns + fails;
  let stars = 5;
  if (scored > 0) {
    const ratio = (oks + warns * 0.5) / scored;
    stars = Math.max(1, Math.min(5, Math.round(ratio * 4) + 1));
  }
  if (critical > 0) stars = Math.min(stars, 2);
  if (verdict === 'Non Conforme') stars = Math.min(stars, 3);

  return {
    quality, shelf, verdict, stars,
    nc: nc == null ? null : Math.round(nc * 100) / 100,
    tolerance, fails, warns, oks, critical, flagged
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
    if (f.key === 'nc_pct') {
      const s = numOr(out.qt_sample, null), b = numOr(out.qt_problem, null);
      if (s && b != null && out._manual_nc_pct !== true) out.nc_pct = round2((b / s) * 100);
    }
  }
  return out;
}
const round2 = (n) => Math.round(n * 100) / 100;
