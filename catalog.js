/* ------------------------------------------------------------------
   Catalogue par défaut : groupes de produits + grilles de critères.
   Les seuils viennent des normes CEE-ONU FFV-42 (avocat) et FFV-45
   (mangue) et des repères filière cités dans le cahier des charges.
   Tout est modifiable depuis Réglages > Produits & critères : ce
   fichier ne sert qu'à initialiser une base vide.
   ------------------------------------------------------------------ */

/* Types de champ :
     num     -> valeur numérique, vert si dans [okMin, okMax]
     pct     -> pourcentage de défaut, vert < warnAt, orange < failAt, rouge au-delà
     bool    -> attendu = conforme
     choice  -> liste d'options, chacune porte son statut
     text    -> libre, jamais noté
   severity : 'mineur' | 'majeur' | 'critique'
     - mineur  : sort du vert => orange
     - majeur  : sort du vert => rouge, pèse sur la qualité
     - critique: sort du vert => rouge + non-conformité directe
   scope : sections/champs affichés selon le type de rapport.          */

const EMBALLAGE = {
  id: 'emballage', label: "Emballage",
  fields: [
    { key: 'pkg_type', label: "Type d'emballage", type: 'choice', severity: 'mineur',
      options: [ {v:'Carton', s:'ok'}, {v:'Plateau bois', s:'ok'}, {v:'Caisse plastique', s:'ok'}, {v:'Vrac', s:'warn'} ] },
    { key: 'pkg_cond', label: "Condition d'emballage", type: 'choice', severity: 'majeur',
      options: [ {v:'Bonne', s:'ok'}, {v:'Acceptable', s:'warn'}, {v:'Mauvaise', s:'fail'} ] },
    { key: 'pkg_gross', label: 'Poids brut', unit: 'kg', type: 'num', step: 0.01 },
    { key: 'pkg_tare',  label: 'Tare',       unit: 'kg', type: 'num', step: 0.01 },
    { key: 'pkg_net',   label: 'Poids net',  unit: 'kg', type: 'num', step: 0.01, computed: 'pkg_gross - pkg_tare' }
  ]
};

const PALETTISATION = {
  id: 'palettisation', label: 'Palettisation',
  fields: [
    /* Le pas de 0,01 sert à saisir une demi-palette dans le détail du
       lot, mais un COMPTAGE ne s'imprime pas avec deux décimales :
       « 12.00 palettes » dans un rapport client était une coquille.
       Le pas d'affichage reste donc au dixième. */
    { key: 'pal_count', label: 'Nombre de palettes', type: 'num', step: 0.1 },
    { key: 'col_count', label: 'Nombre de colis',   type: 'num', step: 1 },
    { key: 'pal_state', label: 'État palettisation', type: 'choice', severity: 'mineur',
      options: [ {v:'Bonne', s:'ok'}, {v:'Acceptable', s:'warn'}, {v:'Mauvaise', s:'fail'} ] }
  ]
};

const TEMPERATURE = (okMin, okMax) => ({
  id: 'temperature', label: 'Température marchandise',
  fields: [
    { key: 'temp_pulp', label: 'Température pulpe', unit: '°C', type: 'num', step: 0.1,
      okMin, okMax, severity: 'majeur' }
  ]
});

const TRACABILITE = {
  id: 'tracabilite', label: 'Traçabilité',
  fields: [
    { key: 'lbl_conf', label: 'Conformité étiquetage', type: 'bool', severity: 'majeur' },
    { key: 'cat_conf', label: 'Conformité catégorie',  type: 'bool', severity: 'majeur' }
  ]
};

const ASPECT = {
  id: 'aspect', label: 'Aspect',
  fields: [
    { key: 'asp_gen', label: 'Apparence générale', type: 'choice', severity: 'majeur',
      options: [ {v:'Bonne', s:'ok'}, {v:'Acceptable', s:'warn'}, {v:'Améliorable', s:'fail'}, {v:'Mauvaise', s:'fail'} ] },
    { key: 'asp_pulp', label: 'Apparence pulpe', type: 'choice', severity: 'majeur',
      options: [ {v:'Bonne', s:'ok'}, {v:'Acceptable', s:'warn'}, {v:'Améliorable', s:'fail'}, {v:'Mauvaise', s:'fail'} ] }
  ]
};

const QUANTITE = {
  id: 'quantite', label: 'Quantité évaluation',
  fields: [
    { key: 'qt_sample',  label: 'Caisses échantillon',   type: 'num', step: 1 },
    { key: 'qt_problem', label: 'Caisses problématiques', type: 'num', step: 1 },
    { key: 'nc_pct',     label: '%NC', unit: '%', type: 'num', step: 0.01,
      computed: 'qt_problem / qt_sample * 100', okMin: 0, okMax: 10, severity: 'critique',
      hint: 'Tolérance catégorie I : 10 % de défauts totaux' }
  ]
};

/* --------------------------- AVOCAT --------------------------- */
const AVOCAT = {
  id: 'avocat', name: 'Avocat', icon: '🥑', position: 1, active: true,
  config: {
    varieties: ['Hass', 'Ettinger', 'Fuerte', 'Pinkerton', 'Reed', 'Edranol', 'Lamb Hass', 'Bacon', 'Zutano'],
    calibres: ['4','6','8','10','12','14','16','18','20','22','24','26','28','30','32','S'],
    categories: ['Extra', 'I', 'II'],
    tolerance: 10,
    /* Protocole pénétromètre : les deux joues de 5 fruits par palette. */
    pressure: { fruits: 5, sides: 2, ref: 13, unit: 'kg' },
    /* Échelle de maturité de l'avocat, en kg au pénétromètre : c'est
       l'échelle de la filière, pas un découpage arbitraire de la plage
       de l'appareil. Elle remplit le stade de mûrissement à partir de
       la moyenne du lot, et pèse sur la conservabilité pour les deux
       derniers paliers seulement — un fruit « bon pour rayon » est ce
       que le client attend, pas un défaut.
       Réglable dans Réglages > Produits & critères > barème. */
    verdict: {
      ripeness: {
        onlyOutsideRef: true,
        bands: [
          { min: 10,  stage: 'Dur',            fail: 0, warn: 0 },
          { min: 2.2, stage: 'En mûrissement', fail: 0, warn: 0 },
          { min: 1.1, stage: 'Bon pour rayon', fail: 0, warn: 0 },
          { min: 0.7, stage: 'Prêt à manger',  fail: 0, warn: 1 },
          { min: 0.4, stage: 'À consommer',    fail: 1, warn: 0 },
          { min: 0,   stage: 'Surmûr',         fail: 2, warn: 0 }
        ]
      }
    },
    /* Poids minimum par calibre, en grammes : sert à signaler les
       fruits sous-calibrés au contrôle production. Valeurs de départ
       tirées de la norme CEE-ONU FFV-42 — à remplacer par le barème
       de l'entreprise dans Réglages > Produits & critères. */
    calibreWeights: { '4': 781, '6': 576, '8': 456, '10': 364, '12': 300, '14': 258,
                      '16': 227, '18': 203, '20': 184, '22': 165, '24': 151,
                      '26': 144, '28': 134, '30': 123, '32': 80 },
    sections: [
      PALETTISATION,
      EMBALLAGE,
      TEMPERATURE(4, 8),
      TRACABILITE,
      ASPECT,
      { id: 'maturite', label: 'Maturité', fields: [
        { key: 'dry_matter', label: 'Matière sèche', unit: '%', type: 'num', step: 0.1,
          okMin: 21, okMax: 40, severity: 'critique',
          hint: 'FFV-42 : 21 % Hass · 20 % Fuerte/Pinkerton/Reed/Edranol · 19 % autres' },
        { key: 'ripe_stage', label: 'Stade de mûrissement', type: 'choice', severity: 'mineur',
          /* Pas de plage chiffrée dans le libellé : les seuils vivent
             dans les paliers de maturité du barème, réglables et
             visibles. Deux sources de chiffres finissent toujours par
             se contredire. */
          options: [ {v:'Dur', s:'ok'}, {v:'En mûrissement', s:'ok'},
                     {v:'Bon pour rayon', s:'ok'}, {v:'Prêt à manger', s:'warn'},
                     {v:'À consommer', s:'warn'}, {v:'Surmûr', s:'fail'} ] }
      ]},
      { id: 'qualitatifs', label: 'Qualitatifs', fields: [
        { key: 'firm_min', label: 'Dureté min', unit: 'kg', type: 'num', step: 0.01 },
        { key: 'firm_max', label: 'Dureté max', unit: 'kg', type: 'num', step: 0.01 },
        { key: 'firm_avg', label: 'Dureté moyenne', unit: 'kg', type: 'num', step: 0.01,
          okMin: 1, okMax: 14, severity: 'majeur' },
        { key: 'soft_pct', label: 'Mûr/Mou', unit: '%', type: 'pct', warnAt: 5, failAt: 10, severity: 'majeur' }
      ]},
      /* À la réception, ces pourcentages se remplissent seuls à partir
         des défauts comptés palette par palette (Réglages > produit >
         Réception) : chaque défaut compté alimente le critère du même
         nom. Défauts légers : lenticelles, griffures, coups de soleil ;
         pertes : anthracnose, froid, pourriture, brunissement
         vasculaire, pulpe grise. */
      { id: 'troubles', label: 'Troubles / Maladies', fields: [
        { key: 'spots_pct',    label: 'Taches / Maculatures', unit: '%', type: 'pct', warnAt: 5,  failAt: 10, severity: 'majeur' },
        { key: 'lenticel_pct', label: 'Dommages lenticelles', unit: '%', type: 'pct', warnAt: 5,  failAt: 10, severity: 'mineur' },
        { key: 'scratch_pct',  label: 'Griffures',            unit: '%', type: 'pct', warnAt: 5,  failAt: 10, severity: 'mineur' },
        { key: 'bruise_pct',   label: 'Blessures / Chocs',    unit: '%', type: 'pct', warnAt: 3,  failAt: 8,  severity: 'majeur' },
        { key: 'chill_pct',    label: 'Dégâts de froid',      unit: '%', type: 'pct', warnAt: 2,  failAt: 5,  severity: 'majeur' },
        { key: 'vasc_pct',     label: 'Brunissement vasculaire', unit: '%', type: 'pct', warnAt: 5, failAt: 10, severity: 'majeur' },
        { key: 'greypulp_pct', label: 'Pulpe grise',          unit: '%', type: 'pct', warnAt: 2,  failAt: 5,  severity: 'majeur' },
        { key: 'sunburn_pct',  label: 'Coups de soleil',      unit: '%', type: 'pct', warnAt: 3,  failAt: 8,  severity: 'mineur' },
        { key: 'anthrac_pct',  label: 'Anthracnose',          unit: '%', type: 'pct', warnAt: 0.5, failAt: 1, severity: 'critique' },
        { key: 'decay_pct',    label: 'Pourriture',           unit: '%', type: 'pct', warnAt: 0.5, failAt: 1, severity: 'critique',
          hint: 'FFV-42 : tolérance 1 % de pourriture' }
      ]},
      QUANTITE
    ]
  }
};

/* --------------------------- MANGUE --------------------------- */
const MANGUE = {
  id: 'mangue', name: 'Mangue', icon: '🥭', position: 2, active: true,
  config: {
    varieties: ['Kent', 'Keitt', 'Tommy Atkins', 'Palmer', 'Haden', 'Osteen', 'Ataulfo', 'Kasturi', 'Aya', 'Shelly', 'Noa', 'David', 'Maya'],
    calibres: ['A (200–350 g)', 'B (351–550 g)', 'C (551–800 g)', 'D (> 800 g)',
               '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '18', '20'],
    categories: ['Extra', 'I', 'II'],
    tolerance: 10,
    /* Mangue : même protocole, sur 3 fruits. */
    pressure: { fruits: 3, sides: 2, ref: 13, unit: 'kg' },
    /* Repères CEE-ONU FFV-45, en grammes (calibres en lettres). */
    calibreWeights: { 'A (200–350 g)': 200, 'B (351–550 g)': 351,
                      'C (551–800 g)': 551, 'D (> 800 g)': 800 },
    /* « Cal selon pack / ± poids » — la feuille du quai Mehadrin. Le
       calibre de la mangue dépend du colis : chaque ligne est une
       tranche de poids par fruit, et donne le calibre correspondant
       pour chaque colis (3, 6 et 4 kg, dans l'ordre de la feuille). */
    sizeTable: {
      boxes: ['3', '6', '4'],
      rows: [
        { min: 250, max: 315, cal: { '3': '10', '6': '20', '4': '14' } },
        { min: 300, max: 370, cal: { '3': '9',  '6': '18', '4': '12' } },
        { min: 360, max: 425, cal: { '6': '15', '4': '10' } },
        { min: 400, max: 475, cal: { '6': '13', '4': '9' } },
        { min: 450, max: 525, cal: { '6': '12', '4': '8' } },
        { min: 500, max: 625, cal: { '6': '11', '4': '7' } },
        { min: 600, max: 725, cal: { '6': '10', '4': '6' } },
        { min: 700, max: 875, cal: { '6': '9',  '4': '5' } }
      ]
    },
    sections: [
      PALETTISATION,
      EMBALLAGE,
      TEMPERATURE(8, 12),
      TRACABILITE,
      ASPECT,
      /* Le mode de fret décrit la façon dont la marchandise est
         arrivée : il n'a pas de sens sur un départ client ni sur une
         chaîne de conditionnement. C'est le seul exemple de portée
         livré d'office — le reste de la grille vaut pour les trois
         types tant que vous n'en décidez pas autrement. */
      { id: 'transport', label: 'Transport', types: ['reception'], fields: [
        { key: 'freight', label: 'Mode de fret', type: 'choice', severity: 'mineur',
          options: [ {v:'Aérien', s:'ok'}, {v:'Maritime', s:'ok'} ] }
      ]},
      { id: 'maturite', label: 'Maturité', fields: [
        { key: 'brix', label: 'Brix', unit: '°Bx', type: 'num', step: 0.1, okMin: 12, okMax: 25, severity: 'majeur',
          hint: 'Repère filière : moyenne ≈ 14 °Bx' },
        { key: 'dry_matter', label: 'Matière sèche', unit: '%', type: 'num', step: 0.1, okMin: 14, okMax: 30, severity: 'majeur' },
        { key: 'skin_color', label: 'Couleur peau', type: 'choice', severity: 'mineur',
          options: [ {v:'Verte', s:'ok'}, {v:'Tournante', s:'ok'}, {v:'Colorée', s:'ok'}, {v:'Hétérogène', s:'warn'} ] },
        { key: 'pulp_color', label: 'Couleur pulpe', type: 'choice', severity: 'mineur',
          options: [ {v:'Jaune clair', s:'ok'}, {v:'Jaune orangé', s:'ok'}, {v:'Orange', s:'ok'}, {v:'Blanchâtre', s:'warn'} ] }
      ]},
      { id: 'qualitatifs', label: 'Qualitatifs', fields: [
        { key: 'firm_min', label: 'Dureté min', unit: 'kg', type: 'num', step: 0.01 },
        { key: 'firm_max', label: 'Dureté max', unit: 'kg', type: 'num', step: 0.01 },
        { key: 'firm_avg', label: 'Dureté moyenne', unit: 'kg', type: 'num', step: 0.01, okMin: 1, okMax: 12, severity: 'majeur' },
        { key: 'soft_pct', label: 'Mûr/Mou', unit: '%', type: 'pct', warnAt: 5, failAt: 10, severity: 'majeur' }
      ]},
      { id: 'troubles', label: 'Troubles / Maladies', fields: [
        { key: 'sapburn_pct',  label: 'Brûlure de sève (sap burn)', unit: '%', type: 'pct', warnAt: 3, failAt: 8, severity: 'majeur' },
        { key: 'anthrac_pct',  label: 'Anthracnose / Taches noires', unit: '%', type: 'pct', warnAt: 0.5, failAt: 1, severity: 'critique' },
        { key: 'stemrot_pct',  label: 'Pourriture pédonculaire',     unit: '%', type: 'pct', warnAt: 0.5, failAt: 1, severity: 'critique' },
        { key: 'jelly_pct',    label: 'Effondrement interne / Jelly seed', unit: '%', type: 'pct', warnAt: 3, failAt: 8, severity: 'majeur' },
        { key: 'chill_pct',    label: 'Dégâts de froid',  unit: '%', type: 'pct', warnAt: 2, failAt: 5, severity: 'majeur' },
        { key: 'lenticel_pct', label: 'Taches de lenticelles', unit: '%', type: 'pct', warnAt: 5, failAt: 10, severity: 'mineur' },
        { key: 'spots_pct',    label: 'Taches / Maculatures', unit: '%', type: 'pct', warnAt: 5, failAt: 10, severity: 'majeur' }
      ]},
      QUANTITE
    ]
  }
};

/* ------------------- GABARIT GÉNÉRIQUE F&L ------------------- */
const GENERIQUE = {
  id: 'generique', name: 'Fruits & légumes', icon: '🧺', position: 3, active: true,
  config: {
    varieties: [],
    calibres: [],
    categories: ['Extra', 'I', 'II'],
    tolerance: 10,
    pressure: { fruits: 5, sides: 2, ref: 13, unit: 'kg' },
    sections: [
      PALETTISATION,
      EMBALLAGE,
      TEMPERATURE(0, 12),
      TRACABILITE,
      ASPECT,
      { id: 'maturite', label: 'Maturité', fields: [
        { key: 'brix', label: 'Brix', unit: '°Bx', type: 'num', step: 0.1 },
        { key: 'firm_avg', label: 'Fermeté moyenne', unit: 'kg', type: 'num', step: 0.01 },
        { key: 'color', label: 'Couleur', type: 'choice', severity: 'mineur',
          options: [ {v:'Conforme', s:'ok'}, {v:'Hétérogène', s:'warn'}, {v:'Non conforme', s:'fail'} ] }
      ]},
      { id: 'troubles', label: 'Défauts', fields: [
        { key: 'minor_pct',  label: 'Défauts mineurs',  unit: '%', type: 'pct', warnAt: 8, failAt: 15, severity: 'mineur' },
        { key: 'major_pct',  label: 'Défauts majeurs',  unit: '%', type: 'pct', warnAt: 5, failAt: 10, severity: 'majeur' },
        { key: 'decay_pct',  label: 'Pourriture',       unit: '%', type: 'pct', warnAt: 0.5, failAt: 1, severity: 'critique' }
      ]},
      QUANTITE
    ]
  }
};

export const DEFAULT_GROUPS = [AVOCAT, MANGUE, GENERIQUE];


/* Départements / dépôts. */
export const DEFAULT_SETTINGS = {
  company: 'SARL Mehadrin International',
  departments: ['Châteaurenard', 'Rungis', 'Perpignan'],
  tolerance: 10
};
