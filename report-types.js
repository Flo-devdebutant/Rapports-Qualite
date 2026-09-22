/* ------------------------------------------------------------------
   Les trois types de rapport, décrits par leurs différences plutôt que
   par du code conditionnel éparpillé. Ajouter un quatrième type se
   résume à une entrée ici : le formulaire, la fiche, le PDF et les
   exports lisent tous cette table.
   ------------------------------------------------------------------ */

export const REPORT_TYPES = {
  reception: {
    id: 'reception',
    title: 'Rapport de réception',
    short: 'Réception',
    subtitle: "Contrôle d'un lot à l'arrivée",
    partnerLabel: 'Fournisseur',
    partnerKind: 'fournisseur',
    refLabel: 'N° de lot',
    refKey: 'lot',
    refPlaceholder: 'Lot fournisseur',
    voyage: true,           // le n° de voyage n'existe qu'à l'arrivée
    packaging: false,
    weights: false,
    groups: null,           // tous les groupes de produit
    icon: 'down',
    tone: ''
  },
  expedition: {
    id: 'expedition',
    title: "Rapport d'expédition",
    short: 'Expédition',
    subtitle: 'Contrôle avant départ client',
    partnerLabel: 'Client',
    partnerKind: 'client',
    refLabel: 'N° de BL',
    refKey: 'bl',
    refPlaceholder: 'Bon de livraison',
    voyage: false,
    /* Le conditionnement est connu au départ, et la référence de
       pression du client en dépend (Monoprix avocat vrac ≠ avocat
       premium) : sans ce champ, une règle client par conditionnement
       ne s'appliquerait jamais à l'expédition. */
    packaging: true,
    weights: false,
    groups: null,
    icon: 'share',
    tone: 'g'
  },
  production: {
    id: 'production',
    title: 'Rapport contrôle production',
    short: 'Production',
    subtitle: 'Contrôle en cours de conditionnement',
    partnerLabel: 'Client',
    partnerKind: 'client',
    refLabel: 'N° de BL',
    refKey: 'bl',
    refPlaceholder: 'Bon de livraison',
    voyage: false,
    packaging: true,        // conditionnement propre à la production
    weights: true,          // poids par fruit, pour repérer les sous-calibrés
    /* Aucune liste fermée de produits : un groupe créé plus tard
       (prune, litchi…) doit pouvoir passer en contrôle production sans
       qu'on revienne modifier le code. */
    groups: null,
    defaultGroup: 'avocat',
    icon: 'clipboard',
    tone: 'n'
  }
};

export const PACKAGING_KINDS = ['Vrac', 'Premium', 'Barquette', 'Filets'];

export const reportType = (t) => REPORT_TYPES[t] || REPORT_TYPES.reception;
export const TYPE_LIST = Object.values(REPORT_TYPES);

/* Une section ou un critère peut être réservé à certains types de
   rapport : on ne relève pas les mêmes choses à l'arrivée d'un
   conteneur et sur une chaîne de conditionnement. Sans restriction —
   le cas de loin le plus courant — l'élément vaut pour les trois. */
export const TYPE_IDS = Object.keys(REPORT_TYPES);

export function appliesTo(item, type) {
  const t = item?.types;
  if (!Array.isArray(t) || !t.length) return true;
  if (!type) return true;               // contexte sans type : on ne cache rien
  return t.includes(type);
}

/* Masquer plutôt que supprimer : une section ou un critère dont on n'a
   pas l'usage cette saison reste dans la grille, prêt à resservir. Il
   ne s'affiche simplement dans aucun rapport. */
export const isHidden = (item) => item?.hidden === true;

/* Portée EFFECTIVE d'un critère : la sienne, ramenée dans celle de sa
   section. Si les deux se contredisent — section « Réception,
   Expédition » et critère réservé à la Production — c'est la section
   qui fait foi. Sans cette règle, la combinaison ne s'affichait dans
   AUCUN des trois rapports : la section disparaissait de la saisie tout
   en restant listée dans les réglages, et rien n'indiquait pourquoi.
   Le calcul se fait à la lecture, donc une grille déjà abîmée redevient
   correcte sans qu'on ait à la réparer ni à la ré-enregistrer. */
export function fieldScope(sec, f) {
  const st = Array.isArray(sec?.types) && sec.types.length ? sec.types : null;
  const ft = Array.isArray(f?.types)   && f.types.length   ? f.types   : null;
  if (!ft) return st;
  if (!st) return ft;
  const keep = ft.filter(t => st.includes(t));
  return keep.length ? keep : st;
}

/* Visible dans un rapport de ce type ? */
export const fieldLive = (sec, f, type) =>
  !isHidden(sec) && !isHidden(f) && appliesTo({ types: fieldScope(sec, f) }, type);

/* Même règle, écrite dans la grille cette fois : la contradiction est
   effacée pour de bon. Appelée avant chaque enregistrement. Renvoie
   `true` si quelque chose a bougé, pour que l'appelant sache qu'il a
   une réparation à persister. */
export function normalizeSections(sections) {
  let changed = false;
  const same = (a, b) => JSON.stringify(a || null) === JSON.stringify(b || null);
  for (const s of sections || []) {
    if (Array.isArray(s.types) && s.types.length >= TYPE_IDS.length) { delete s.types; changed = true; }
    const scope = Array.isArray(s.types) && s.types.length ? s.types : null;
    for (const f of s.fields || []) {
      const before = f.types;
      const eff = fieldScope(s, f);
      if (!eff || same(eff, scope) || eff.length >= TYPE_IDS.length) { if ('types' in f) { delete f.types; } }
      else f.types = eff;
      if (!same(before, f.types)) changed = true;
    }
  }
  return changed;
}

/* « Réception, Production » — pour afficher la restriction. */
export const typesLabel = (item) =>
  Array.isArray(item?.types) && item.types.length
    ? item.types.map(t => reportType(t).short).join(', ')
    : '';
