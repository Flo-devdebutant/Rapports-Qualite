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
    packaging: false,
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
    groups: ['avocat', 'mangue'],
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

/* « Réception, Production » — pour afficher la restriction. */
export const typesLabel = (item) =>
  Array.isArray(item?.types) && item.types.length
    ? item.types.map(t => reportType(t).short).join(', ')
    : '';
