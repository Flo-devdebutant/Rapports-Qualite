/* Réglages : produits & critères, partenaires, équipe, compte. */

import { state, shell, go, back, loadRefs, logout, canManage, isAdmin } from './app.js';
import { local, queue, sync, pendingCount } from './store.js';
import { db, auth } from './supa.js';
import { DEFAULT_GROUPS, DEFAULT_SETTINGS } from './catalog.js';
import { fieldStatus, FIELD_ROLES, fieldRole, effSeverity, flatFields, roleFits, ROLE_SHORT, UNIQUE_ROLES,
         defaultRole, roleConflicts, fixRoleConflicts, clearRole,
         verdictCfg, ripenessBands, ripenessField, bandsFromLabels, DEFAULT_VERDICT } from './verdict.js';
import { allDrafts } from './form.js';
import { defectTypes, samplingCfg, pressureRequired, resolveLink, DEFECT_KINDS, DEFECT_WHERE } from './reception.js';
import { LANGS, builtinTranslation } from './report-pdf.js';
import { pressureConfig, fmtP, RANGE_TOL, SEV_STEPS, LIMITS, clampP, sizeTableOf, boxKey } from './pressure.js';
import { PACKAGING_KINDS, TYPE_LIST, TYPE_IDS, reportType, appliesTo, typesLabel,
         isHidden, fieldLive, normalizeSections } from './report-types.js';
import { $, $$, esc, icon, toast, sheet, confirmSheet, getTheme, setTheme, initials } from './ui.js';
import { CONFIG } from './config.js';

/* Réglages : le compte en tête, puis l'administration (administrateur
   et responsable) et les préférences de l'appareil. L'apparence se
   règle sur place, sans ouvrir de fenêtre. */
export function renderSettings() {
  const p = state.profile || {};
  const nGroups = state.groups.filter(g => g.active !== false).length;
  const item = (go, ic, title, sub) => `<button class="menu-item" data-go="${go}"><span class="ic n">${icon(ic)}</span>
    <span class="tx"><b>${title}</b><span>${sub}</span></span><span class="chev">${icon('chevR')}</span></button>`;
  shell('Réglages', `
   <div class="narrow">
    <button class="card me-card" data-go="#/settings/account">
      <span class="avatar lg">${esc(initials(p.full_name || p.email))}</span>
      <span class="tx"><b>${esc(p.full_name || '')}</b><span>${esc(p.email || '')}</span></span>
      <span class="pill brand">${esc(roleLabel(p.role))}</span>
    </button>

    ${canManage() ? `<div class="label-up">Administration</div>
    <div class="menu">
      ${item('#/settings/groups', 'clipboard', 'Produits &amp; critères', `${nGroups} produit${nGroups > 1 ? 's' : ''} · grilles de contrôle et seuils`)}
      ${item('#/settings/partners', 'truck', "Carnet d'adresses", `${state.partners.length} partenaire${state.partners.length > 1 ? 's' : ''} · références de pression`)}
      ${item('#/settings/users', 'users', 'Équipe', 'Valider et gérer les accès')}
      ${item('#/settings/photos', 'image', 'Photos et espace', "Place occupée, archivage d'une période")}
    </div>` : ''}

    <div class="label-up">Cet appareil</div>
    <div class="menu">
      <div class="menu-item theme-row"><span class="ic n">${icon('theme')}</span>
        <span class="tx"><b>Apparence</b><span>Sombre : moins éblouissant en chambre froide</span></span>
        <span class="seg sm" id="themeSeg">${THEMES.map(([v, name]) =>
          `<button type="button" data-t="${v}" aria-pressed="${getTheme() === v}">${name}</button>`).join('')}</span>
      </div>
      ${item('#/settings/account', 'badge', 'Mon compte', 'Mot de passe, déconnexion')}
    </div>

    <p class="about" style="margin-top:22px">${esc(state.settings.company)} · Mehadrin QC ${esc(CONFIG.version)}</p>
   </div>`,
    { tab: 'settings', root: true,
      onMount() {
        $$('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));
        $$('#themeSeg [data-t]').forEach(b => b.onclick = () => {
          setTheme(b.dataset.t);
          $$('#themeSeg [data-t]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
          toast('Apparence : ' + themeLabel().toLowerCase());
        });
      } });
}

/* ========================== APPARENCE ========================== */
const THEMES = [
  ['auto',  'Auto',   "Suit le réglage du téléphone"],
  ['light', 'Clair',  "Fond blanc, plus lisible en plein jour"],
  ['dark',  'Sombre', "Moins éblouissant en chambre froide"]
];
const themeLabel = () => ({ auto: 'Automatique', light: 'Clair', dark: 'Sombre' }[getTheme()] || 'Automatique');


/* ------------------------ traductions ------------------------
   Les PDF partent chez des clients étrangers. Les grilles livrées
   sont traduites d'office ; dès que l'entreprise renomme un critère
   ou en crée un, c'est ici qu'elle fournit ses propres traductions.
   Sans elles, le critère reste en français dans le PDF — visible et
   corrigeable, plutôt qu'une traduction approximative. */
const OTHER_LANGS = Object.keys(LANGS).filter(l => l !== 'fr');

function i18nBlock(label, i18n) {
  const auto = builtinTranslation(label);
  return `<details class="sec" style="margin:2px 0 13px">
    <summary>Traductions du PDF
      <span class="count">${auto ? 'automatiques' : (i18n && Object.keys(i18n).length ? 'personnalisées' : 'à compléter')}</span>
      <span class="caret">▾</span></summary>
    <div class="body">
      <p class="muted" style="margin:0 0 10px">${auto
        ? "Ce libellé fait partie des grilles livrées : il est déjà traduit. Remplissez un champ pour imposer votre propre formulation."
        : "Laissez vide et le libellé français sera repris tel quel dans le PDF."}</p>
      ${OTHER_LANGS.map(l => `<div class="field"><label for="tr_${l}">${esc(LANGS[l])}</label>
        <input type="text" id="tr_${l}" value="${esc(i18n?.[l] || '')}"
               placeholder="${esc(auto?.[l] || label || '')}"></div>`).join('')}
    </div></details>`;
}

/* Portée : à quels types de rapport s'applique cette section ou ce
   critère. Aucun coché = tous, ce qui est le cas courant et évite
   d'avoir à cocher trois cases pour chaque nouveau critère. */
/* `parent` borne le choix : un critère ne peut pas s'appliquer à un
   type de rapport que sa section exclut. Sans cette borne, on pouvait
   enregistrer un critère « Production seulement » dans une section
   « Réception, Expédition » — une combinaison qui n'apparaît dans aucun
   rapport, et qu'aucun écran ne signalait. */
function typesBlock(item, parent) {
  const sel = Array.isArray(item?.types) ? item.types : [];
  const scope = Array.isArray(parent?.types) && parent.types.length ? parent.types : null;
  const list = scope ? TYPE_LIST.filter(T => scope.includes(T.id)) : TYPE_LIST;
  return `<div class="field"><label>Types de rapport concernés</label>
    <div class="tgrid" id="typesBox" data-scope="${esc((scope || []).join(','))}">
      ${list.map(T => `<button type="button" class="tbtn" data-t="${T.id}"
        aria-pressed="${sel.includes(T.id)}">${esc(T.short)}</button>`).join('')}
    </div>
    <div class="hint">Aucun coché : ${scope
      ? `le critère suit sa section (${esc(scope.map(t => reportType(t).short).join(', '))}).`
      : "le critère s'applique aux trois types de rapport."}</div></div>`;
}

const readTypes = (el) => {
  const box = el.querySelector('#typesBox');
  const all = [...(box?.querySelectorAll('.tbtn') || [])];
  const on = all.filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.dataset.t);
  /* Tous cochés, c'est « tous » : on n'enregistre rien, la grille reste
     ainsi valable si un quatrième type apparaît un jour — et le critère
     continue de suivre sa section si celle-ci se déplace. */
  return on.length && on.length < all.length ? on : undefined;
};

const wireTypes = (el) => el.querySelectorAll('#typesBox .tbtn').forEach(b =>
  b.onclick = () => b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true')));

const readI18n = (el) => {
  const out = {};
  for (const l of OTHER_LANGS) {
    const v = el.querySelector('#tr_' + l)?.value.trim();
    if (v) out[l] = v;
  }
  return Object.keys(out).length ? out : undefined;
};

/* ====================== PRODUITS & CRITÈRES ====================== */
export function renderGroups() {
  const groups = [...state.groups].sort((a, b) => (a.active === false) - (b.active === false));
  shell('Produits & critères', `
   <div class="narrow">
    <div class="info-box">${icon('info')}<p><b>Une grille par produit</b> : ce qu'on regarde pendant un
      contrôle — taches, température, matière sèche — et, pour chacun, à partir de quand ça pose problème.
      Tout est modifiable, et chaque modification peut être annulée juste après.</p></div>
    ${groups.length ? `<div class="menu">${groups.map(g => {
      const nf = (g.config?.sections || []).reduce((n, s) => n + (s.fields || []).length, 0);
      return `<button class="menu-item" data-id="${esc(g.id)}">
        <span class="ic n" style="font-size:21px">${esc(g.config?.icon || '🧺')}</span>
        <span class="tx"><b>${esc(g.name)}</b><span>${(g.config?.sections || []).length} sections · ${nf} critères · tolérance ${g.config?.tolerance ?? 10} %</span></span>
        ${g.active === false ? '<span class="pill sm">supprimé</span>' : ''}<span class="chev">${icon('chevR')}</span></button>`;
    }).join('')}</div>` : `<div class="card empty"><div class="big">📦</div><p>Aucun groupe de produit.</p></div>`}
    <div class="btn-row" style="margin-top:14px">
      <button class="btn ghost" id="add">${icon('plus')} Nouveau produit</button>
      <button class="btn ghost" id="restore">Restaurer les grilles par défaut</button>
    </div>
   </div>`,
    { back: () => back('#/settings'), tab: 'settings',
      onMount() {
        $$('[data-id]').forEach(b => b.onclick = () => go('#/settings/groups/' + b.dataset.id));
        $('#add').onclick = addGroup;
        $('#restore').onclick = async () => {
          if (!(await confirmSheet('Restaurer', 'Les grilles Avocat, Mangue et Fruits & légumes seront remises à leur état d\'origine. Les autres groupes ne sont pas touchés.', { okLabel: 'Restaurer', danger: false }))) return;
          /* Même chemin que n'importe quelle autre écriture : local
             d'abord, file d'attente ensuite. L'appel direct au serveur
             échouait en silence hors ligne. */
          for (const d of DEFAULT_GROUPS) {
            const row = { id: d.id, name: d.name, position: d.position, active: true,
                          config: { ...structuredClone(d.config), icon: d.icon } };
            await local.put('groups', row);
            await queue('group', row);
          }
          const ok = await sync({ silent: true });
          toast(ok ? 'Grilles restaurées' : 'Grilles restaurées · envoi à la reconnexion');
          await loadRefs(); renderGroups();
        };
      } });
}

function addGroup() {
  sheet('Nouveau produit', `
    <div class="field"><label for="gn">Nom</label><input type="text" id="gn" placeholder="Ex. Tomate, Raisin…"></div>
    <div class="field"><label for="gi">Emoji (facultatif)</label><input type="text" id="gi" maxlength="4" placeholder="🍅"></div>
    <div class="field"><label for="gb">Partir de</label>
      <select id="gb">${state.groups.map(g => `<option value="${esc(g.id)}">Copier « ${esc(g.name)} »</option>`).join('')}
        <option value="">Grille vide</option></select></div>
    <button class="btn block" id="ok">Créer</button>`,
    { onMount(el, close) {
        el.querySelector('#ok').onclick = async () => {
          const name = el.querySelector('#gn').value.trim();
          if (!name) return toast('Donnez un nom', 'err');
          const baseId = el.querySelector('#gb').value;
          const base = state.groups.find(g => g.id === baseId);
          const id = slug(name) + '-' + Math.random().toString(36).slice(2, 6);
          const row = {
            id, name, position: state.groups.length + 1, active: true,
            config: base ? structuredClone(base.config)
                         : { varieties: [], calibres: [], categories: ['Extra','I','II'], tolerance: 10, sections: [] }
          };
          row.config.icon = el.querySelector('#gi').value.trim() || '🧺';
          await local.put('groups', row);
          await queue('group', row);
          await sync({ silent: true }); await loadRefs();
          close(); go('#/settings/groups/' + id);
        };
      } });
}

/* Type de rapport sélectionné dans l'éditeur de grille. Gardé hors de
   la fonction pour survivre au redessin après chaque modification —
   mais remis à zéro dès qu'on change de produit, sinon on ouvre la
   grille de la mangue filtrée sur un type choisi pour l'avocat, et les
   critères créés là héritent d'une restriction que personne n'a
   demandée. */
let gridType = '';
let gridTypeOwner = '';
let edTab = 'grid';     // onglet ouvert de l'éditeur, gardé d'un redessin à l'autre

/* Visible dans la vue courante de l'éditeur. En vue « Tous les
   rapports », seul le masquage compte ; dans une vue filtrée, la portée
   s'y ajoute. */
const secLive = (sec) => !isHidden(sec) && appliesTo(sec, gridType);

/* L'étiquette qui dit POURQUOI un élément est grisé. Sans elle, on voit
   qu'il ne s'affichera pas sans savoir où agir — sur le critère ou sur
   sa section. */
function scopePill(item, live, sec) {
  if (isHidden(item)) return '<span class="pill sm">masqué</span>';
  const own = typesLabel(item);
  if (own) return `<span class="pill sm">${esc(own)}</span>`;
  if (!live) return `<span class="pill sm">${sec ? 'section masquée' : 'masquée ici'}</span>`;
  return '';
}

/* Après un redessin, on rouvre la section sur laquelle on travaillait.
   La page garde déjà sa position (renderGroupEditor) : on ne la fait
   défiler que pour SUIVRE une section qu'on vient de déplacer d'un
   cran — sans quoi elle quitterait l'écran sous le doigt. */
function openSection(si, follow = false) {
  const d = document.querySelector(`details.sec[data-si="${si}"]`);
  if (!d) return;
  d.open = true;
  if (follow) d.querySelector('summary')?.scrollIntoView({ block: 'nearest' });
}

const weightsHtml = (cfg) => (cfg.calibres || []).map(c => `
  <div class="wrow">
    <label for="w_${slug(c)}">${esc(c)}</label>
    <span><input type="number" id="w_${slug(c)}" data-cal="${esc(c)}" min="0" step="1"
      value="${(cfg.calibreWeights || {})[c] ?? ''}" placeholder="—"><i>g</i></span>
  </div>`).join('') || '<p class="muted" style="margin:0">Définissez d\'abord les calibres ci-dessus.</p>';

/* `fresh` : on arrive sur l'écran par la navigation, pas par un simple
   redessin. Le filtre de type repart alors de « Tous les rapports ».
   Le garder d'une visite à l'autre était piégeux : on revenait sur la
   grille une heure plus tard, toujours filtrée sur Production sans le
   remarquer, et chaque masquage ne valait discrètement que pour ce
   type-là. */
export function renderGroupEditor(id, fresh = false) {
  const g = state.groups.find(x => x.id === id);
  if (!g) { toast('Groupe introuvable', 'err'); return go('#/settings/groups'); }
  /* Redessin de la même grille après un enregistrement : on garde les
     sections ouvertes (par leur identifiant, pas leur rang — une
     section déplacée ne rouvre pas sa voisine) et la position dans la
     page. Sans cela, chaque modification renvoyait tout en haut, toutes
     sections fermées. Une feuille encore ouverte tient déjà la position
     (lockScroll) : elle la rendra en se fermant. */
  const again = !fresh && gridTypeOwner === id && !!document.querySelector('details.sec[data-sid]');
  const keepOpen = again ? [...document.querySelectorAll('details.sec[open]')]
    .map(d => d.dataset.sid || `#${d.dataset.si}`) : [];
  const keepY = again && document.body.style.position !== 'fixed' ? window.scrollY : null;
  if (fresh || gridTypeOwner !== id) { gridType = ''; gridTypeOwner = id; edTab = 'grid'; }
  /* Remise d'aplomb : une grille où la portée d'un critère sortait de
     celle de sa section produisait une section présente dans aucun
     rapport. La lecture s'en accommode déjà, mais on l'écrit une bonne
     fois pour que le réglage affiché soit celui qui s'applique. */
  if (normalizeSections(g.config?.sections)) saveGroup(g).catch(() => {});
  const cfg = g.config || {};
  const pr = pressureConfig(g);
  /* Table des poids par colis, éditée en mémoire et écrite par
     readHeader() avec le reste de l'en-tête. */
  const tbl = structuredClone(sizeTableOf(g) || { boxes: [], rows: [] });

  const TABS = [['grid', 'Grille'], ['product', 'Produit'], ['measures', 'Mesures'], ['reception', 'Réception']];
  const pane = (id) => `data-pane="${id}"${edTab === id ? '' : ' hidden'}`;
  const nCrit = (cfg.sections || []).reduce((n, x) => n + (x.fields || []).length, 0);

  /* Quatre onglets plutôt qu'une page de sept écrans : la grille (ce
     qu'on touche le plus souvent), le produit, les mesures (pressions et
     poids), la réception. Tout reste dans la page — un onglet caché
     garde sa saisie, et « Enregistrer » les écrit tous. */
  shell(g.name, `
    <div class="seg ed-tabs" id="edTabs" role="tablist">${TABS.map(([id, label]) =>
      `<button type="button" role="tab" data-tab="${id}" aria-pressed="${edTab === id}">${label}</button>`).join('')}</div>

    <section ${pane('product')}>
    <div class="card pad">
      <div class="card-h"><h3>Produit</h3></div>
      <div class="row2">
        <div class="field"><label for="nm">Nom</label><input type="text" id="nm" value="${esc(g.name)}"></div>
        <div class="field"><label for="ic">Emoji</label><input type="text" id="ic" maxlength="4" value="${esc(cfg.icon || '')}"></div>
      </div>
      <div class="field"><label for="tol">Tolérance de non-conformité (%)</label>
        <input type="number" id="tol" step="0.5" value="${cfg.tolerance ?? 10}">
        <div class="hint">Au-delà, en caisses problématiques, l'évaluation bascule en « Non Conforme » ; le %NC d'un lot
          conforme ou acceptable ne la dépasse jamais. 10 % correspond à la catégorie I des normes CEE-ONU.</div></div>
      <div class="field"><label for="vars">Variétés proposées</label>
        <textarea id="vars" style="min-height:64px">${esc((cfg.varieties || []).join(', '))}</textarea>
        <div class="hint">Séparées par des virgules.</div></div>
      <div class="field" style="margin-bottom:0"><label for="cals">Calibres proposés</label>
        <textarea id="cals" style="min-height:64px">${esc((cfg.calibres || []).join(', '))}</textarea></div>
    </div>

    <!-- Les trois indices du rapport reposaient sur des seuils écrits
         dans le code. « Mauvaise à partir de 3 défauts » n'est pas une
         vérité universelle : c'est une décision de l'entreprise, qui
         change d'un produit à l'autre. -->
    <div class="card pad">
      <div class="card-h"><h3>Les trois indices du verdict</h3></div>
      <p class="muted" style="margin:-4px 0 12px">Qualité, Conservabilité et Évaluation se calculent
        à partir des critères notés. Voici à partir de quand chacun bascule, et ce que pèse chaque
        imperfection dans le %NC.</p>
      <button class="btn ghost block" id="verdictBtn">${icon('gear')} Régler le barème des indices</button>
      <div class="hint" id="verdictSum" style="margin-top:8px">${verdictSummary(g)}</div>
    </div>

    <div class="btn-row" style="margin-top:14px">
      ${g.active === false
        ? '<button class="btn ghost" id="undelg">Remettre en service</button>'
        : `<button class="btn ghost danger" id="delg">${icon('trash')} Supprimer le produit</button>`}
    </div>
    </section>

    <section ${pane('measures')}>
    <div class="card pad">
      <div class="card-h"><h3>Protocole de pression</h3></div>
      <p class="muted" style="margin:-4px 0 12px">Relevé au pénétromètre. Pour l'avocat : les deux joues de 5 fruits par palette.</p>
      <div class="row3">
        <div class="field"><label for="pf">Fruits / palette</label>
          <input type="number" id="pf" min="1" step="1" value="${pr.fruits}"></div>
        <div class="field"><label for="ps">Mesures / fruit</label>
          <input type="number" id="ps" min="1" step="1" value="${pr.sides}"></div>
        <div class="field"><label for="prf">Référence</label>
          <input type="number" id="prf" step="0.1" min="${LIMITS.min}" max="${LIMITS.max}" value="${pr.ref}"></div>
      </div>
      <p class="hint">La référence sert au remplissage rapide et à la ligne repère du graphique.
        Le pénétromètre mesure de ${LIMITS.min} à ${LIMITS.max} ${esc(pr.unit)} : les valeurs sont bornées à cet intervalle.</p>
    </div>

    <div class="card pad">
      <div class="card-h"><h3>Poids minimum par calibre</h3></div>
      <p class="muted" style="margin:-4px 0 12px">Un fruit pesé sous ce seuil est signalé comme sous-calibré
      (réception et contrôle production). Laissez vide pour ne rien contrôler sur ce calibre. Le poids
      maximum n'est pas vérifié : un fruit plus gros profite au client.</p>
      <div class="wgrid">${weightsHtml(cfg)}</div>
    </div>

    <!-- Mangue : le calibre dépend du colis. La table reprend la feuille
         du quai « Cal selon pack / ± poids ». -->
    <div class="card pad">
      <div class="card-h"><h3>Poids par calibre selon le colis</h3></div>
      <p class="muted" style="margin:-4px 0 12px">Quand le calibre dépend du poids du colis (mangue :
        un calibre 10 pèse 250–315 g en colis de 3 kg, 600–725 g en 6 kg), chaque ligne donne une
        tranche de poids et le calibre correspondant pour chaque colis. Elle prime sur le poids
        minimum. Sans table, le calibre ne dépend pas du colis (avocat).</p>
      <div id="stBox"></div>
      <div class="st-add">
        <button type="button" class="btn ghost sm" id="stAddRow">${icon('plus')} Ligne</button>
        <span class="st-kg"><input type="number" id="stKg" min="0.5" step="0.5" inputmode="decimal"
          placeholder="kg" aria-label="Poids du colis à ajouter (kg)">
        <button type="button" class="btn ghost sm" id="stAddBox">${icon('plus')} Colis</button></span>
      </div>
    </div>
    </section>

    <!-- Réception : pressions obligatoires, échantillon et défauts
         comptés palette par palette. -->
    <section ${pane('reception')}>
    <div class="card pad">
      <div class="card-h"><h3>Contrôle par palette</h3></div>
      <p class="muted" style="margin:-4px 0 12px">À la réception, chaque palette du lot se contrôle : pressions, pesée
        des fruits de pression, défauts externes comptés sur les colis ouverts et défauts internes sur les
        fruits coupés.</p>
      <label class="opt-row" style="margin:0 0 14px">
        <input type="checkbox" id="prReq" ${pressureRequired(g, 'reception') ? 'checked' : ''}>
        <span>Pressions obligatoires en réception<small>Le rapport ne s'enregistre pas tant que
          chaque palette du lot n'a pas tous ses relevés. « Tout à ${pr.ref} » reste disponible.</small></span></label>
      <div class="row2">
        <div class="field"><label for="smpB">Colis ouverts par palette</label>
          <input type="number" id="smpB" min="1" step="1" value="${samplingCfg(g).boxes}"></div>
        <div class="field"><label for="smpK">Le calibre compte les fruits d'un colis de (kg)</label>
          <input type="number" id="smpK" min="0" step="0.5" value="${samplingCfg(g).perKg ?? ''}"
            placeholder="son poids réel"></div>
      </div>
      <div class="field"><label for="smpC">Fruits coupés par palette (défauts internes)</label>
        <input type="number" id="smpC" min="1" step="1" inputmode="numeric" value="${samplingCfg(g).cut}"
          style="max-width:140px"></div>
      <p class="hint" id="smpHint" style="margin-top:-4px">${samplingHint(g)}</p>
    </div>
    <div class="card pad">
      <div class="card-h"><h3>Défauts comptés par palette</h3></div>
      <p class="muted" style="margin:-4px 0 8px">Léger ou perte, externe ou interne. Un défaut relié à un
        critère de la grille le remplit tout seul (% du lot).</p>
      <div id="defRows"></div>
      <button type="button" class="btn ghost sm" id="defAdd" style="margin-top:8px">${icon('plus')} Défaut</button>
    </div>
    </section>

    <section ${pane('grid')}>
    <p class="muted" style="margin:0 2px 10px">${(cfg.sections || []).length} sections · ${nCrit} critères.
      Touchez un critère pour changer son barème ; « Critère » en ajoute un.</p>
    ${roleBanner(g)}
    <!-- On ne contrôle pas les mêmes choses à l'arrivée d'un conteneur
         et sur une chaîne de conditionnement. Ce filtre montre la
         grille telle qu'elle se présentera pour un type de rapport
         donné ; la restriction se règle critère par critère. -->
    <div class="chips" style="margin-bottom:10px">
      <button class="chip" data-tf="" aria-pressed="${!gridType}">Tous les rapports</button>
      ${TYPE_LIST.map(T => `<button class="chip" data-tf="${T.id}" aria-pressed="${gridType === T.id}">${esc(T.short)}</button>`).join('')}
    </div>
    ${gridType ? `<div class="info-box">${icon('eye')}<p>Grille telle qu'elle apparaîtra
      dans un ${esc(reportType(gridType).title.toLowerCase())}. Ce qui n'y figure pas
      reste affiché en grisé : rien ne disparaît, tout se réaffiche d'une touche.</p></div>` : ''}
    <!-- Toutes les sections sont TOUJOURS listées, filtre ou pas. Les
         masquer dans la vue filtrée revenait à les rendre
         irrécupérables : une section vide ne pouvait plus recevoir de
         critère, et une section dont la portée contredisait celle de
         ses critères n'apparaissait plus nulle part — ni ici, ni dans
         les rapports. -->
    ${(cfg.sections || []).map((sec, si) => {
      const live = secLive(sec);                       // visible dans la vue courante
      const all  = (sec.fields || []);
      const count = gridType ? all.filter(f => fieldLive(sec, f, gridType)).length : all.length;
      const last  = (cfg.sections || []).length - 1;
      return `
      <details class="sec${live ? '' : ' off'}" data-si="${si}" data-sid="${esc(sec.id || '')}">
        <summary>${esc(sec.label)} <span class="count">${count}</span>
        ${scopePill(sec, live)} <span class="caret">${icon('chevD')}</span></summary>
        <div class="body">
          ${all.map((f, fi) => {
            const fl = fieldLive(sec, f, gridType);
            return `
            <div class="crit${fl ? '' : ' off'}" data-fi="${fi}">
              <span class="ord">
                <button type="button" class="ordb" data-mf="${si}.${fi}.-1"${fi === 0 ? ' disabled' : ''} aria-label="Monter">${icon('up')}</button>
                <button type="button" class="ordb" data-mf="${si}.${fi}.1"${fi === all.length - 1 ? ' disabled' : ''} aria-label="Descendre">${icon('dn')}</button>
              </span>
              <span class="dot ${sevDot(f)}"></span>
              <span class="lb" data-edit="${si}.${fi}">${esc(f.label)}<small>${describe(f)}</small></span>
              ${scopePill(f, fl, sec)}
              <button type="button" class="ordb wide" data-mask="${si}.${fi}"
                aria-label="${fl ? 'Masquer' : 'Afficher'}" title="${fl ? 'Masquer' : 'Afficher'}">${icon(fl ? 'eye' : 'eyeOff')}</button>
            </div>`; }).join('')}
          ${all.length ? '' : `<p class="muted" style="margin:0">Section vide. Touchez « Critère » pour la remplir.</p>`}
          ${count === 0 && all.length && gridType
            ? `<p class="hint" style="margin:8px 0 0">Aucun critère de cette section n'apparaît
               dans un ${esc(reportType(gridType).title.toLowerCase())}.</p>` : ''}
          <div class="btn-row" style="margin-top:12px">
            <span class="ord">
              <button type="button" class="ordb" data-ms="${si}.-1"${si === 0 ? ' disabled' : ''} aria-label="Monter la section">${icon('up')}</button>
              <button type="button" class="ordb" data-ms="${si}.1"${si === last ? ' disabled' : ''} aria-label="Descendre la section">${icon('dn')}</button>
            </span>
            <button class="btn ghost sm" data-addf="${si}">${icon('plus')} Critère</button>
            <button class="btn ghost sm" data-editsec="${si}">${icon('edit')} Titre &amp; portée</button>
            <button class="btn ghost sm" data-masksec="${si}">${icon(live ? 'eyeOff' : 'eye')} ${live ? 'Masquer' : 'Afficher'}${
              gridType ? ` ici` : ''}</button>
            <button class="btn ghost sm danger" data-delsec="${si}">${icon('trash')} Supprimer</button>
          </div>
        </div></details>`; }).join('')}

    <div class="btn-row" style="margin-top:12px">
      <button class="btn ghost" id="addsec">${icon('plus')} Section</button>
    </div>
    </section>
    <div class="sticky-actions"><button class="btn" id="save">${icon('check')} Enregistrer</button></div>`,
    { back: () => back('#/settings/groups'), tab: 'settings', sub: 'Grille de contrôle et réglages du produit',
      onMount() {
        $$('#edTabs [data-tab]').forEach(b => b.onclick = () => {
          edTab = b.dataset.tab;
          $$('#edTabs [data-tab]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
          $$('[data-pane]').forEach(p => { p.hidden = p.dataset.pane !== edTab; });
          window.scrollTo(0, 0);
        });
        /* L'en-tête (nom, tolérance, variétés, calibres, protocole)
           n'était lu qu'au moment d'enregistrer. Or la page se redessine
           à chaque geste — filtre de type, ajout de critère, suppression
           de section — et emportait avec elle tout ce qui venait d'être
           tapé. On recopie donc la saisie dans le groupe au fil de la
           frappe : le redessin repart de valeurs à jour, et « Enregistrer »
           n'a plus qu'à persister. */
        readHeader();
        const rf = $('#roleFix');
        if (rf) rf.onclick = async () => {
          const n = fixRoleConflicts(g);
          await saveGroup(g); renderGroupEditor(g.id);
          toast(`${n} rôle${n > 1 ? 's' : ''} corrigé${n > 1 ? 's' : ''}`);
        };
        ['#nm', '#ic', '#tol', '#vars', '#pf', '#ps', '#prf', '#smpB', '#smpK', '#smpC'].forEach(s => {
          const i = $(s); if (i) i.oninput = () => { readHeader(); const h = $('#smpHint'); if (h) h.textContent = samplingHint(g); };
        });
        const reqEl = $('#prReq');
        if (reqEl) reqEl.onchange = readHeader;
        paintDefects(g);
        paintSizeTable(tbl);
        $('#stAddRow').onclick = () => {
          if (!tbl.boxes.length) return toast('Ajoutez d\'abord un colis (son poids en kg).', 'err');
          tbl.rows.push({ min: '', max: '', cal: {} }); paintSizeTable(tbl);
        };
        $('#stAddBox').onclick = () => {
          const k = boxKey($('#stKg').value);
          if (!k) return toast('Indiquez le poids du colis en kg.', 'err');
          if (tbl.boxes.map(boxKey).includes(k)) return toast(`Le colis de ${k} kg est déjà dans la table.`, 'err');
          tbl.boxes.push(k); $('#stKg').value = ''; paintSizeTable(tbl);
        };
        $$('[data-cal]').forEach(i => i.oninput = readHeader);
        /* Les calibres commandent la liste des poids minimums : on
           redessine cette liste quand ils changent, en conservant les
           poids déjà saisis — y compris lors d'un simple renommage. */
        const cals = $('#cals');
        if (cals) cals.onchange = () => { readHeader(); repaintWeights(); };

        function readHeader() {
          const v = (s) => $(s)?.value ?? '';
          g.name = v('#nm').trim() || g.name;
          g.config.icon = v('#ic').trim();
          /* `Number(x) || 10` réécrivait une tolérance de 0 en 10 —
             or 0 % est un réglage légitime : aucune non-conformité
             admise. */
          const tol = num(v('#tol'));
          g.config.tolerance = tol == null ? (g.config.tolerance ?? 10) : Math.max(0, tol);
          g.config.varieties = splitList(v('#vars'));
          const oldCals = g.config.calibres || [];
          const newCals = splitList(v('#cals'));
          g.config.calibres = newCals;
          g.config.calibreWeights = remapWeights(g.config.calibreWeights || {}, oldCals, newCals);
          /* On repart du réglage existant : une clé posée ailleurs
             (pressions obligatoires…) ne doit pas disparaître parce
             qu'on a retouché le nombre de fruits. */
          const req = $('#prReq');
          g.config.pressure = {
            ...(g.config.pressure || {}),
            fruits: Math.max(1, num(v('#pf')) ?? pr.fruits),
            sides:  Math.max(1, num(v('#ps')) ?? pr.sides),
            ref:    clampP(v('#prf')) ?? pr.ref,
            unit:   pr.unit,
            ...(req ? { requiredFor: req.checked ? ['reception'] : [] } : {})
          };
          g.config.sizeTable = cleanSizeTable(tbl);
          if ($('#smpB')) {
            const kg = num(v('#smpK')), cut = num(v('#smpC'));
            g.config.sampling = { boxes: Math.max(1, num(v('#smpB')) ?? samplingCfg(g).boxes),
                                  perKg: kg > 0 ? kg : null,
                                  cut: cut > 0 ? Math.round(cut) : samplingCfg(g).cut };
          }
        }

        /* Les poids sont indexés par libellé de calibre. Renommer « 18 »
           en « Cal 18 » aurait donc effacé son poids minimum en
           silence. Quand la liste garde sa longueur, on suit les
           positions ; sinon on garde ce qui porte encore le même nom. */
        function remapWeights(cur, oldList, newList) {
          const read = {};
          $$('[data-cal]').forEach(inp => {
            const t = inp.value.trim();
            if (t !== '') read[inp.dataset.cal] = Number(t);
          });
          const src = { ...cur, ...read };
          const out = {};
          const sameLength = oldList.length === newList.length;
          newList.forEach((c, i) => {
            const hit = src[c] != null ? src[c] : (sameLength ? src[oldList[i]] : undefined);
            if (hit != null && isFinite(hit)) out[c] = hit;
          });
          return out;
        }

        function repaintWeights() {
          const box = $('.wgrid');
          if (box) { box.innerHTML = weightsHtml(g.config); $$('[data-cal]').forEach(i => i.oninput = readHeader); }
        }

        $$('[data-tf]').forEach(c => c.onclick = () => {
          readHeader();
          gridType = c.dataset.tf === gridType ? '' : c.dataset.tf;
          renderGroupEditor(id);
        });
        $$('[data-edit]').forEach(el => el.onclick = () => {
          const [si, fi] = el.dataset.edit.split('.').map(Number);
          editField(g, si, fi);
        });
        $$('[data-addf]').forEach(el => el.onclick = () => editField(g, +el.dataset.addf, -1));

        /* ---------------- ordre ----------------
           Deux flèches plutôt qu'un glisser-déposer : sur un téléphone,
           à une main, avec des gants de chambre froide, c'est le seul
           geste qui marche à tous les coups. L'ordre du tableau EST
           l'ordre de saisie — le formulaire lit la même liste. */
        const swap = (arr, i, j) => { const t = arr[i]; arr[i] = arr[j]; arr[j] = t; };

        $$('[data-ms]').forEach(el => el.onclick = async () => {
          const [si, d] = el.dataset.ms.split('.').map(Number);
          const list = g.config.sections, j = si + d;
          if (j < 0 || j >= list.length) return;
          readHeader(); swap(list, si, j);
          await saveGroup(g); renderGroupEditor(id);
          openSection(j, true);
        });

        $$('[data-mf]').forEach(el => el.onclick = async () => {
          const [si, fi, d] = el.dataset.mf.split('.').map(Number);
          const list = g.config.sections[si].fields, j = fi + d;
          if (j < 0 || j >= list.length) return;
          readHeader(); swap(list, fi, j);
          await saveGroup(g); renderGroupEditor(id);
          openSection(si);
        });

        /* ---------------- masquer / afficher ----------------
           On ne supprime plus pour « ne plus le voir » : un critère
           masqué reste dans la grille, avec son barème et ses
           traductions, et se réaffiche d'une touche. Dans une vue
           filtrée, le geste ne concerne QUE ce type de rapport ; dans
           la vue « Tous les rapports », il vaut partout. */
        const setLive = (item, on) => {
          if (!gridType) { if (on) delete item.hidden; else item.hidden = true; return; }
          const cur = Array.isArray(item.types) && item.types.length ? item.types.slice() : TYPE_IDS.slice();
          if (on) {
            delete item.hidden;
            if (!cur.includes(gridType)) cur.push(gridType);
            if (cur.length >= TYPE_IDS.length) delete item.types; else item.types = cur;
          } else {
            const keep = cur.filter(t => t !== gridType);
            /* Plus aucun type : ce n'est plus une restriction de portée,
               c'est un masquage pur et simple. On le dit ainsi plutôt
               que d'enregistrer une portée vide, que personne ne sait
               relire. */
            if (!keep.length) { item.hidden = true; delete item.types; }
            else item.types = keep;
          }
        };
        const scopeWord = () => gridType ? ` dans ${reportType(gridType).short}` : ' partout';

        $$('[data-masksec]').forEach(el => el.onclick = async () => {
          const si = +el.dataset.masksec;
          const sec = g.config.sections[si];
          const was = { hidden: sec.hidden, types: structuredClone(sec.types) };
          const on = !secLive(sec);
          readHeader(); setLive(sec, on);
          await saveGroup(g); renderGroupEditor(id); openSection(si);
          toast(`« ${sec.label} » ${on ? 'affichée' : 'masquée'}${scopeWord()}`, '',
            { action: 'Annuler', onAction: async () => {
                delete sec.hidden; delete sec.types;
                if (was.hidden) sec.hidden = was.hidden;
                if (was.types) sec.types = was.types;
                await saveGroup(g); renderGroupEditor(id); openSection(si);
              } });
        });

        $$('[data-mask]').forEach(el => el.onclick = async () => {
          const [si, fi] = el.dataset.mask.split('.').map(Number);
          const sec = g.config.sections[si], f = sec.fields[fi];
          /* Un critère ne peut pas être affiché là où sa section ne
             l'est pas : on remet la section d'abord, sinon la touche
             ne produirait aucun effet visible et paraîtrait cassée. */
          if (!secLive(sec) && !fieldLive(sec, f, gridType)) {
            return toast(`« ${sec.label} » est masquée${scopeWord()} : affichez d'abord la section.`, 'err');
          }
          const was = { hidden: f.hidden, types: structuredClone(f.types) };
          const on = !fieldLive(sec, f, gridType);
          readHeader(); setLive(f, on);
          await saveGroup(g); renderGroupEditor(id); openSection(si);
          toast(`« ${f.label} » ${on ? 'affiché' : 'masqué'}${scopeWord()}`, '',
            { action: 'Annuler', onAction: async () => {
                delete f.hidden; delete f.types;
                if (was.hidden) f.hidden = was.hidden;
                if (was.types) f.types = was.types;
                await saveGroup(g); renderGroupEditor(id); openSection(si);
              } });
        });

        $$('[data-delsec]').forEach(el => el.onclick = async () => {
          const si = +el.dataset.delsec;
          const sec = g.config.sections[si];
          if (!(await confirmSheet('Supprimer la section',
                `« ${sec.label} » et ses ${sec.fields.length} critères disparaissent de tous les types de rapport.`,
                { okLabel: 'Supprimer partout' }))) return;
          const copy = structuredClone(sec);
          g.config.sections.splice(si, 1);
          await saveGroup(g); renderGroupEditor(id);
          toast('Section supprimée', '', { action: 'Annuler', onAction: async () => {
            g.config.sections.splice(si, 0, copy);
            await saveGroup(g); renderGroupEditor(id);
          } });
        });
        $('#verdictBtn').onclick = () => editVerdict(g, () => renderGroupEditor(id));
        $('#addsec').onclick = () => editSection(g, -1);
        $$('[data-editsec]').forEach(el => el.onclick = () => editSection(g, +el.dataset.editsec));
        /* Une suppression passe par la file d'attente comme tout le
           reste : hors ligne, l'écriture directe échouait sans un mot
           et le groupe réapparaissait à la synchronisation suivante. */
        const delg = $('#delg');
        if (delg) delg.onclick = async () => {
          if (!(await confirmSheet('Supprimer le groupe',
                'Le produit ne sera plus proposé à la saisie. Les rapports déjà enregistrés restent lisibles, et le groupe peut être remis en service.'))) return;
          readHeader();
          g.active = false;
          await saveGroup(g);
          toast('Groupe supprimé', '', { action: 'Annuler', onAction: async () => {
            g.active = true;
            await saveGroup(g);
            renderGroups();
          } });
          go('#/settings/groups');
        };
        const undelg = $('#undelg');
        if (undelg) undelg.onclick = async () => {
          readHeader();
          g.active = true;
          await saveGroup(g);
          toast('Groupe remis en service'); renderGroupEditor(id);
        };
        $('#save').onclick = async () => {
          readHeader();
          toast(await saveGroup(g) ? 'Enregistré' : 'Enregistré · envoi à la reconnexion');
          go('#/settings/groups');
        };
      } });
  if (keepOpen.length) {
    for (const d of document.querySelectorAll('details.sec')) {
      if (keepOpen.includes(d.dataset.sid || `#${d.dataset.si}`)) d.open = true;
    }
  }
  if (keepY != null) window.scrollTo(0, keepY);
}

/* Table des poids par colis : une colonne par colis, une ligne par
   tranche de poids. Les saisies modifient la table en mémoire ; seules
   l'ajout et la suppression redessinent. */
function paintSizeTable(tbl) {
  const box = $('#stBox');
  if (!box) return;
  const boxes = tbl.boxes || [];
  if (!boxes.length && !tbl.rows.length) {
    box.innerHTML = '<p class="hint" style="margin:0">Aucune table : le calibre ne dépend pas du colis. ' +
      'Indiquez un poids de colis et touchez « Colis » pour en créer une.</p>';
    return;
  }
  box.innerHTML = `<div class="st-wrap"><table class="st-table">
    <thead><tr>${boxes.map((b, j) => `<th>Colis ${esc(b)} kg<button type="button" class="st-x" data-stdelbox="${j}"
        aria-label="Retirer le colis de ${esc(b)} kg">×</button></th>`).join('')}
      <th>Poids min (g)</th><th>Poids max (g)</th><th></th></tr></thead>
    <tbody>${tbl.rows.map((r, i) => `<tr>${boxes.map(b => `<td><input type="text" inputmode="numeric"
        data-stc="${i}" data-box="${esc(b)}" value="${esc(r.cal?.[b] ?? '')}" placeholder="—"
        aria-label="Calibre en colis de ${esc(b)} kg, ligne ${i + 1}"></td>`).join('')}
      <td><input type="number" min="0" step="1" inputmode="numeric" data-stmin="${i}" value="${r.min ?? ''}"
        aria-label="Poids minimum, ligne ${i + 1}"></td>
      <td><input type="number" min="0" step="1" inputmode="numeric" data-stmax="${i}" value="${r.max ?? ''}"
        aria-label="Poids maximum, ligne ${i + 1}"></td>
      <td><button type="button" class="st-x" data-stdel="${i}" aria-label="Retirer la ligne ${i + 1}">×</button></td></tr>`).join('')}
    </tbody></table></div>`;
  box.querySelectorAll('[data-stc]').forEach(inp => inp.oninput = () => {
    const r = tbl.rows[+inp.dataset.stc];
    (r.cal ||= {})[inp.dataset.box] = inp.value.trim();
  });
  box.querySelectorAll('[data-stmin]').forEach(inp => inp.oninput = () => { tbl.rows[+inp.dataset.stmin].min = inp.value; });
  box.querySelectorAll('[data-stmax]').forEach(inp => inp.oninput = () => { tbl.rows[+inp.dataset.stmax].max = inp.value; });
  box.querySelectorAll('[data-stdel]').forEach(b => b.onclick = () => { tbl.rows.splice(+b.dataset.stdel, 1); paintSizeTable(tbl); });
  box.querySelectorAll('[data-stdelbox]').forEach(b => b.onclick = () => {
    const k = tbl.boxes[+b.dataset.stdelbox];
    tbl.boxes.splice(+b.dataset.stdelbox, 1);
    for (const r of tbl.rows) if (r.cal) delete r.cal[k];
    paintSizeTable(tbl);
  });
}

/* Ce qui s'enregistre : colis normalisés (« 4.0 » → « 4 »), lignes
   vides écartées. Une table vidée reste enregistrée vide : la table de
   l'application ne revient pas d'elle-même. */
function cleanSizeTable(tbl) {
  const boxes = [...new Set((tbl.boxes || []).map(boxKey).filter(Boolean))];
  const n = (v) => (v === '' || v == null || !isFinite(Number(v)) ? null : Number(v));
  const rows = (tbl.rows || []).map(r => ({
    min: n(r.min), max: n(r.max),
    cal: Object.fromEntries(boxes.map(b => [b, String(r.cal?.[b] ?? '').trim()]).filter(([, c]) => c))
  })).filter(r => r.min != null || r.max != null || Object.keys(r.cal).length);
  return { boxes, rows };
}

/* « calibre 16 : 16 fruits par colis de 4 kg, 160 contrôlés » — la
   règle, dite avec un exemple, pour qu'on la vérifie d'un coup d'œil. */
function samplingHint(g) {
  const { boxes, perKg, cut } = samplingCfg(g);
  const f = (n) => String(Math.round(n * 10) / 10).replace('.', ',');
  const int = ` Défauts internes : ${cut} fruits coupés par palette — un défaut interne se rapporte à ces ` +
              `${cut} fruits (1 fruit touché = ${f(100 / cut)} %). Plus de fruits coupés sur une palette : ` +
              `le nombre se corrige sur la palette.`;
  if (!perKg) return `Exemple : calibre 12 → 12 fruits par colis, ${boxes * 12} fruits contrôlés par palette.` + int;
  return `Exemple : calibre 16 en colis de ${f(perKg)} kg → 16 fruits par colis, ${boxes * 16} contrôlés ; ` +
         `en colis de 10 kg → ${f(16 * 10 / perKg)} par colis, ${f(boxes * 16 * 10 / perKg)} contrôlés.` + int;
}

/* Rôles mal placés (voir roleConflicts) : dits en clair, corrigés
   d'une touche. Un rôle « %NC » posé sur un critère Conforme / Non
   faisait afficher 1 % de non-conformité à un rapport sans défaut. */
function roleBanner(g) {
  const cs = roleConflicts(g);
  if (!cs.length) return '';
  const names = (fs) => fs.map(f => `« ${esc(f.label)} »`).join(', ');
  const lines = cs.map(c => c.kind === 'misfit'
    ? `Rôle sans effet sur ${names(c.fields)} : un critère Conforme / Non ou à choix ne peut pas porter un
       rôle chiffré. La correction le retire.`
    : `Le rôle « ${esc(ROLE_SHORT[c.role])} » est porté par ${c.fields.length} critères : ${names(c.fields)}.
       Un seul doit le porter : la correction le laisse à « ${esc(c.keep.label)} ».`);
  return `<div class="warn-box" id="roleWarn">
    <b>Rôles à corriger</b>
    ${lines.map(l => `<p>${l}</p>`).join('')}
    <p>Pour qu'un critère fasse basculer le rapport en Non Conforme, c'est sa gravité qui compte : « Non conforme
      directement ». Le rôle n'y est pour rien.</p>
    <button type="button" class="btn sm" id="roleFix">Corriger les rôles</button></div>`;
}

/* Liste des défauts comptés. Dès qu'on la touche, elle s'enregistre
   en clair dans le produit, liens compris — la liste livrée devient
   la sienne. */
function paintDefects(g) {
  const box = $('#defRows');
  if (!box) return;
  const own = () => {
    if (!Array.isArray(g.config.defects))
      g.config.defects = defectTypes(g).map(d => ({ key: d.key, label: d.label, kind: d.kind, where: d.where,
                                                   link: resolveLink(d, g, 'reception') || '' }));
    return g.config.defects;
  };
  /* La liste brute, lignes encore sans nom comprises : un défaut
     qu'on vient d'ajouter doit apparaître pour qu'on puisse le nommer. */
  const defs = Array.isArray(g.config.defects) ? g.config.defects : defectTypes(g);
  const pct = flatFields(g, 'reception').filter(f => f.type === 'pct');
  box.innerHTML = defs.map((d, i) => {
    const link = resolveLink(d, g, 'reception') || '';
    return `<div class="def-row" data-di="${i}">
      <input type="text" data-df="label" value="${esc(d.label)}" aria-label="Nom du défaut">
      <select data-df="kind">${Object.entries(DEFECT_KINDS).map(([k, w]) =>
        `<option value="${k}"${k === d.kind ? ' selected' : ''}>${w}</option>`).join('')}</select>
      <select data-df="where">${Object.entries(DEFECT_WHERE).map(([k, w]) =>
        `<option value="${k}"${k === d.where ? ' selected' : ''}>${w}</option>`).join('')}</select>
      <select data-df="link" aria-label="Critère rempli"><option value="">Ne remplit aucun critère</option>${pct.map(f =>
        `<option value="${esc(f.key)}"${f.key === link ? ' selected' : ''}>Remplit : ${esc(f.label)}</option>`).join('')}</select>
      <span class="ord">
        <button type="button" class="ordb" data-dm="-1" aria-label="Monter"${i === 0 ? ' disabled' : ''}>${icon('up')}</button>
        <button type="button" class="ordb" data-dm="1" aria-label="Descendre"${i === defs.length - 1 ? ' disabled' : ''}>${icon('dn')}</button>
      </span>
      <button type="button" class="icon-btn" data-dx aria-label="Retirer">${icon('x')}</button>
    </div>`;
  }).join('') || '<p class="muted" style="margin:0">Aucun défaut compté par palette pour ce produit.</p>';

  box.querySelectorAll('.def-row').forEach(row => {
    const i = +row.dataset.di;
    row.querySelectorAll('[data-df]').forEach(el => {
      const k = el.dataset.df;
      const on = () => { own()[i][k] = el.value; };
      if (el.tagName === 'SELECT') el.onchange = on; else el.oninput = on;
    });
    row.querySelectorAll('[data-dm]').forEach(b => b.onclick = () => {
      const list = own(), j = i + Number(b.dataset.dm);
      if (j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      paintDefects(g);
    });
    row.querySelector('[data-dx]').onclick = () => { own().splice(i, 1); paintDefects(g); };
  });
  const add = $('#defAdd');
  if (add) add.onclick = () => {
    own().push({ key: 'def_' + Math.random().toString(36).slice(2, 7), label: '', kind: 'light', where: 'ext', link: '' });
    paintDefects(g);
    box.querySelector('.def-row:last-child input')?.focus();
  };
}

/* ==================== BARÈME DES TROIS INDICES ====================
   Écrit en comptages — « à partir de 3 défauts » — et non en points :
   c'est la façon dont un responsable qualité formule sa règle, et il
   doit pouvoir la relire sans traduction. */
function verdictSummary(g) {
  const c = verdictCfg(g);
  const bands = ripenessBands(g).length;
  const fr = (v) => String(v).replace('.', ',');
  return `Mauvaise à partir de ${c.quality.badFails} défauts · Minimale à partir de ${c.shelf.lowFails} · ` +
         `${bands ? `${bands} paliers de maturité` : 'aucun palier de maturité'} · ` +
         `%NC : ${fr(c.nc.warn)} / ${fr(c.nc.fail)} / ${fr(c.nc.critical)} points par critère à surveiller / hors seuil / critique.`;
}

/* Barème livré pour ce produit, s'il existe : « revenir au barème par
   défaut » doit rendre l'échelle de maturité de l'avocat, pas l'effacer
   — sans elle, le stade ne se remplit plus. */
function shippedVerdict(g) {
  const d = DEFAULT_GROUPS.find(x => x.id === g.id)?.config?.verdict;
  return d ? structuredClone(d) : null;
}

function editVerdict(g, after) {
  const c = verdictCfg(g);
  const ripeField = ripenessField(g);
  const unit = pressureConfig(g).unit;
  /* Deux façons de poser l'échelle :
       · les libellés du critère portent leur plage (« Prêt à manger
         (0,6–2,5 kg) ») : les seuils y sont lus, et c'est là qu'on les
         change — deux sources de chiffres finiraient par se contredire
         sur le même rapport ;
       · les libellés sont nus (« Prêt à manger ») : on saisit ici la
         pression à partir de laquelle chaque stade s'applique.
     Dans les deux cas, une ligne par choix de la liste : un palier ne
     peut plus désigner un stade qui n'existe pas. */
  const fromLabels = !!(ripeField && bandsFromLabels(ripeField));
  const live = ripenessBands(g);
  const rows = !ripeField ? []
    : fromLabels
      ? live.map(b => ({ ...b }))
      : (ripeField.options || []).filter(o => o.v).map(o => {
          const b = live.find(x => x.stage === o.v);
          return { stage: o.v, min: b ? b.min : '', fail: b ? b.fail : 0, warn: b ? b.warn : 0 };
        });

  const num = (id, v, step = 1) =>
    `<input type="number" id="${id}" min="0" step="${step}" value="${v}">`;

  sheet('Barème des indices', `
    <div class="scale-box">
      <h4>Qualité</h4>
      <div class="srow"><span class="sdot fail"></span><b>Mauvaise</b>
        <span>à partir de ${num('qBad', c.quality.badFails)} défauts — ou 1 défaut critique</span></div>
      <div class="srow"><span class="sdot warn"></span><b>Moyenne</b>
        <span>à partir de ${num('qMidF', c.quality.midFails)} défauts,
        ou ${num('qMidW', c.quality.midWarns)} points à surveiller</span></div>
      <div class="srow"><span class="sdot ok"></span><b>Bonne</b><span>en dessous</span></div>
    </div>

    <div class="scale-box" style="margin-top:14px">
      <h4>Conservabilité</h4>
      <p class="hint" style="margin:0 0 8px">Comptent ici : les critères dont le rôle est
        « compte pour la conservabilité », la dureté moyenne, le stade de mûrissement,
        les écarts de pression et le niveau de maturité du lot.</p>
      <div class="srow"><span class="sdot fail"></span><b>Minimale</b>
        <span>à partir de ${num('sLow', c.shelf.lowFails)} défauts</span></div>
      <div class="srow"><span class="sdot warn"></span><b>Moyenne</b>
        <span>à partir de ${num('sMidF', c.shelf.midFails)} défauts,
        ou ${num('sMidW', c.shelf.midWarns)} points à surveiller</span></div>
      <div class="srow"><span class="sdot ok"></span><b>Élevée</b><span>en dessous</span></div>
    </div>

    <div class="scale-box" style="margin-top:14px">
      <h4>Ce que vaut un écart de pression</h4>
      <p class="hint" style="margin:0 0 8px">Pour la conservabilité. Seul l'écart le plus grave du lot compte.</p>
      ${['critique', 'majeur', 'mineur'].map(l => `
        <div class="srow"><span class="sdot ${l === 'mineur' ? 'warn' : 'fail'}"></span>
          <b>Écart ${l}</b>
          <span>${num('p_' + l + '_f', c.press[l].fail)} défauts
                et ${num('p_' + l + '_w', c.press[l].warn)} à surveiller</span></div>`).join('')}
    </div>

    <div class="scale-box" style="margin-top:14px">
      <h4>Évaluation</h4>
      <div class="srow"><span class="sdot fail"></span><b>Non Conforme</b>
        <span>caisses problématiques au-delà de la tolérance (${g.config?.tolerance ?? 10} %), ou 1 défaut critique</span></div>
      <div class="srow"><span class="sdot warn"></span><b>Acceptable</b>
        <span>caisses problématiques à partir de ${num('eAcc', Math.round((c.eval.acceptable || 0.7) * 100))} % de la
        tolérance, ou 1 défaut</span></div>
      <div class="srow"><span class="sdot ok"></span><b>Conforme</b><span>en dessous</span></div>
    </div>

    <!-- Le %NC dit TOUTES les imperfections du lot, pondérées : un lot
         aux palettes fatiguées et un peu sous-calibré n'est pas à 0 %. -->
    <div class="scale-box" style="margin-top:14px" id="ncBox">
      <h4>Taux de non-conformité (%NC)</h4>
      <p class="hint" style="margin:0 0 8px">Chaque imperfection du lot l'augmente, d'autant plus qu'elle
        est grave. Pertes, sous-calibre et défauts en % comptent pour leur part de fruits touchés ; les
        caisses problématiques, si elles sont comptées, la remplacent quand elles pèsent plus. Le %NC ne vaut 0 que
        pour un lot parfait, et reste sous ${String(Math.round((g.config?.tolerance ?? 10) * (c.eval.acceptable || 0.7) * 100) / 100).replace('.', ',')} %
        pour un lot conforme, sous la tolérance pour un lot acceptable.</p>
      <div class="srow"><span class="sdot ok"></span><b>Défaut léger</b>
        <span>${num('ncLight', Math.round(c.nc.light * 100), 5)} % d'un fruit perdu</span></div>
      <p class="hint" style="margin:10px 0 2px">Critères qui ne sont pas des % de fruits (état des palettes,
        emballage, étiquetage…) :</p>
      <div class="srow"><span class="sdot warn"></span><b>À surveiller</b>
        <span>${num('ncWarn', c.nc.warn, 0.1)} point</span></div>
      <div class="srow"><span class="sdot fail"></span><b>Hors seuil</b>
        <span>${num('ncFail', c.nc.fail, 0.1)} points</span></div>
      <div class="srow"><span class="sdot fail"></span><b>Critique</b>
        <span>${num('ncCrit', c.nc.critical, 0.1)} points</span></div>
      <p class="hint" style="margin:10px 0 2px">Palettes hors de la référence de pression : points si tout
        le lot l'est, au prorata des palettes sinon.</p>
      ${['mineur', 'majeur', 'critique'].map(l => `
        <div class="srow"><span class="sdot ${l === 'mineur' ? 'warn' : 'fail'}"></span><b>Écart ${l}</b>
          <span>${num('ncP_' + l, c.nc.press[l], 0.5)} points</span></div>`).join('')}
    </div>

    <!-- La maturité du lot : c'est elle qui manquait. Un lot relevé à
         4 kg est mûr et ne tiendra pas, que le client l'ait demandé
         ainsi ou non — l'écart à la référence ne le dit pas. -->
    <div class="scale-box" style="margin-top:14px">
      <h4>Maturité du lot, d'après la moyenne des pressions</h4>
      ${ripeField
        ? `<p class="hint" style="margin:0 0 8px">Remplit « ${esc(ripeField.label)} » tout seul
             et pèse sur la conservabilité. ${fromLabels
               ? `Les seuils sont lus dans les choix du critère : pour les changer, modifiez
                  ces choix (critère « ${esc(ripeField.label)} »). Réglez ici le poids de chaque stade.`
               : `Indiquez la pression moyenne à partir de laquelle chaque stade s'applique.
                  Un stade laissé vide n'est jamais déduit ; tout vide, le stade se saisit à la main.`}</p>
           <label class="opt-row" style="margin:0 0 10px">
             <input type="checkbox" id="ripeOnly" ${c.ripeness.onlyOutsideRef ? 'checked' : ''}>
             <span>Ne pas compter la maturité comme un défaut quand le lot
               respecte la référence de pression<small>Celle du client, ou à défaut celle
               du produit. Un lot livré à la fermeté demandée est conforme, même s'il est
               mûr : c'est ce que le client a commandé.</small></span></label>
           <div id="bandRows"></div>`
        : `<p class="hint" style="margin:0">Aucun critère « choix dans une liste » ne porte le
             rôle « Stade de mûrissement » dans cette grille : donnez-lui ce rôle pour que le
             stade se déduise des pressions.</p>`}
    </div>

    <div class="btn-row" style="margin-top:16px">
      <button class="btn ghost" style="flex:1" id="cancel">Annuler</button>
      <button class="btn" style="flex:2" id="ok">Enregistrer</button>
    </div>
    <button class="btn ghost block" id="reset" style="margin-top:10px">Revenir au barème par défaut</button>`,
    { onMount(el, close) {
        const $$$ = (s) => el.querySelector(s);

        const paintBands = () => {
          const box = $$$('#bandRows');
          if (!box) return;
          box.innerHTML = rows.map((b, i) => `
            <div class="band-row" data-b="${i}">
              <span class="bst">${esc(b.stage)}</span>
              <span class="bl">${fromLabels
                ? `dès ${esc(String(Math.round(Number(b.min) * 100) / 100).replace('.', ','))} ${esc(unit)}`
                : `dès <input type="number" step="0.1" min="${LIMITS.min}" max="${LIMITS.max}"
                     data-bm value="${b.min === '' || b.min == null ? '' : b.min}" placeholder="—"> ${esc(unit)}`}</span>
              <span class="bw">
                <label>défauts <input type="number" min="0" step="1" data-bf value="${b.fail ?? 0}"></label>
                <label>à surveiller <input type="number" min="0" step="1" data-bw value="${b.warn ?? 0}"></label></span>
            </div>`).join('') || '<p class="muted" style="margin:0">Aucun choix dans ce critère.</p>';
          box.querySelectorAll('.band-row').forEach(row => {
            const i = +row.dataset.b;
            const bm = row.querySelector('[data-bm]');
            if (bm) bm.oninput = (e) => { rows[i].min = e.target.value === '' ? '' : (clampP(e.target.value) ?? ''); };
            row.querySelector('[data-bf]').oninput = (e) => { rows[i].fail = Math.max(0, Number(e.target.value) || 0); };
            row.querySelector('[data-bw]').oninput = (e) => { rows[i].warn = Math.max(0, Number(e.target.value) || 0); };
          });
        };
        paintBands();

        $$$('#cancel').onclick = () => close();
        $$$('#reset').onclick = async () => {
          if (!(await confirmSheet('Barème par défaut',
                'Les seuils reviennent à ceux livrés avec l\'application.', { okLabel: 'Revenir', danger: false }))) return;
          const shipped = shippedVerdict(g);
          if (shipped) g.config.verdict = shipped; else delete g.config.verdict;
          await saveGroup(g); close(); after?.();
          toast('Barème remis par défaut');
        };
        $$$('#ok').onclick = async () => {
          const n = (id, d) => { const v = Number($$$('#' + id)?.value); return isFinite(v) && v >= 0 ? v : d; };
          /* Un seuil « moyenne » plus haut que le seuil « mauvaise »
             rendrait le palier du milieu inatteignable : on le refuse
             plutôt que de livrer un barème qui ne peut rien produire. */
          if (n('qMidF', 1) > n('qBad', 3))
            return toast('Qualité : le seuil « moyenne » doit rester sous celui de « mauvaise »', 'err');
          if (n('sMidF', 1) > n('sLow', 2))
            return toast('Conservabilité : le seuil « moyenne » doit rester sous celui de « minimale »', 'err');
          /* Un écart « à surveiller » ne peut pas peser plus qu'un écart
             hors seuil, ni celui-ci plus qu'un défaut critique. */
          if (!(n('ncWarn', 0.5) <= n('ncFail', 2) && n('ncFail', 2) <= n('ncCrit', 5)))
            return toast('%NC : « à surveiller » ≤ « hors seuil » ≤ « critique »', 'err');
          if (!(n('ncP_mineur', 2) <= n('ncP_majeur', 5) && n('ncP_majeur', 5) <= n('ncP_critique', 15)))
            return toast('%NC : écart mineur ≤ majeur ≤ critique', 'err');
          if (n('ncLight', 25) > 100)
            return toast('%NC : un défaut léger ne peut pas compter plus qu\'un fruit perdu', 'err');
          /* Deux stades au même seuil : le second ne serait jamais
             atteint, et personne ne comprendrait pourquoi. */
          const set = rows.filter(b => b.min !== '' && b.min != null && isFinite(Number(b.min)));
          if (!fromLabels && new Set(set.map(b => Number(b.min))).size < set.length)
            return toast('Maturité : deux stades ne peuvent pas partir de la même pression', 'err');
          g.config.verdict = {
            quality: { badFails: n('qBad', 3), midFails: n('qMidF', 1), midWarns: n('qMidW', 3) },
            shelf:   { lowFails: n('sLow', 2), midFails: n('sMidF', 1), midWarns: n('sMidW', 2) },
            press: Object.fromEntries(['critique', 'majeur', 'mineur'].map(l =>
              [l, { fail: n('p_' + l + '_f', 0), warn: n('p_' + l + '_w', 0) }])),
            ripeness: { bands: set.map(b => ({ min: Number(b.min), stage: b.stage,
                                               fail: Number(b.fail) || 0, warn: Number(b.warn) || 0 })),
                        onlyOutsideRef: $$$('#ripeOnly') ? $$$('#ripeOnly').checked : true },
            eval: { acceptable: Math.min(1, Math.max(0, n('eAcc', 70) / 100)) },
            nc: { light: n('ncLight', 25) / 100, warn: n('ncWarn', 0.5), fail: n('ncFail', 2),
                  critical: n('ncCrit', 5),
                  press: Object.fromEntries(['mineur', 'majeur', 'critique'].map(l =>
                    [l, n('ncP_' + l, DEFAULT_VERDICT.nc.press[l])])) }
          };
          await saveGroup(g); close(); after?.();
          toast('Barème enregistré');
        };
      } });
}

/* Une section se crée, se renomme et se traduit au même endroit. */
function editSection(g, si) {
  const isNew = si < 0;
  /* Créée depuis une vue filtrée, la section arrive restreinte à ce
     type de rapport : c'est ce qu'on venait y faire. Le bloc « Portée »
     reste modifiable juste en dessous. */
  const sec = isNew ? { id: '', label: '', fields: [], types: gridType ? [gridType] : undefined }
                    : g.config.sections[si];
  sheet(isNew ? 'Nouvelle section' : 'Titre & portée', `
    <div class="field"><label for="sl">Titre</label>
      <input type="text" id="sl" value="${esc(sec.label)}" placeholder="Ex. Troubles / Maladies"></div>
    ${typesBlock(sec)}
    ${i18nBlock(sec.label, sec.i18n)}
    <div class="btn-row">
      <button class="btn ghost" style="flex:1" id="cancel">Annuler</button>
      <button class="btn" style="flex:2" id="ok">${isNew ? 'Ajouter' : 'Enregistrer'}</button>
    </div>`,
    { onMount(el, close) {
        wireTypes(el);
        el.querySelector('#cancel').onclick = () => close();
        el.querySelector('#ok').onclick = async () => {
          const label = el.querySelector('#sl').value.trim();
          if (!label) return toast('Donnez un titre', 'err');
          const i18n = readI18n(el), types = readTypes(el);
          if (isNew) (g.config.sections ||= []).push({ id: slug(label), label, i18n, types, fields: [] });
          else { sec.label = label; sec.i18n = i18n; sec.types = types; }
          await saveGroup(g); close(); renderGroupEditor(g.id);
        };
      } });
}

/* ======================= ÉDITEUR DE CRITÈRE =======================
   Ce formulaire est rempli par un responsable qualité, pas par un
   développeur. Trois principes :
     — on nomme ce que la personne veut obtenir, jamais le mécanisme
       interne ; « Gravité : majeur » devient « au-delà, c'est un
       défaut majeur » ;
     — le barème se lit comme une phrase, du conforme au non conforme,
       et le dernier échelon est écrit noir sur blanc — c'est celui
       qu'on ne voyait pas ;
     — un champ d'essai donne le verdict en direct sur une valeur que
       l'on tape : plus sûr que n'importe quelle explication.
   ------------------------------------------------------------------ */

/* Les quatre façons de noter un critère, décrites par leur usage. */
const FIELD_KINDS = [
  ['pct',    'Un pourcentage de défaut', 'Part des fruits touchés : taches, chocs, pourriture…'],
  ['num',    'Une mesure chiffrée',      'Température, matière sèche, Brix, dureté…'],
  ['choice', 'Un choix dans une liste',  'Bonne / Acceptable / Mauvaise'],
  ['bool',   'Conforme ou non conforme', 'Une simple réponse oui / non']
];

/* Ce que devient un dépassement. Le troisième échelon — la
   non-conformité directe — est le seul qui fasse basculer le rapport,
   et il doit se voir. */
const OUTCOMES = {
  mineur:   ['Défaut mineur',            'Passe en orange, le rapport reste acceptable'],
  majeur:   ['Défaut majeur',            'Passe en rouge et pèse sur la qualité'],
  critique: ['Non conforme directement', 'Le rapport entier bascule en Non Conforme']
};
/* Sur un pourcentage et sur une liste de choix, « mineur » et
   « majeur » produisent exactement le même effet : on n'affiche donc
   pas deux portes identiques. */
const outcomesFor = (type) => (type === 'pct' || type === 'choice')
  ? ['majeur', 'critique'] : ['mineur', 'majeur', 'critique'];

function outcomeBlock(type, sev, kindLabel) {
  const list = outcomesFor(type);
  const cur = list.includes(sev) ? sev : list[0];
  return `<div class="field"><label>${esc(kindLabel)}</label>
    <div class="olist" id="outBox">
      ${list.map(k => `<button type="button" class="obtn" data-o="${k}" aria-pressed="${k === cur}">
        <b>${OUTCOMES[k][0]}</b><span>${OUTCOMES[k][1]}</span></button>`).join('')}
    </div></div>`;
}

const STATUS_WORDS = [['ok', 'Conforme'], ['warn', 'À surveiller'], ['fail', 'Non conforme']];

function editField(g, si, fi) {
  const sec = g.config.sections[si];
  const f = fi >= 0 ? structuredClone(sec.fields[fi])
    : { key: '', label: '', type: 'pct', severity: 'majeur',
        types: gridType ? [gridType] : undefined };
  const isNew = fi < 0;
  let type = f.type || 'pct';
  let sev  = f.severity || 'majeur';
  let opts = structuredClone(f.options || [{ v: 'Bonne', s: 'ok' }, { v: 'Acceptable', s: 'warn' }, { v: 'Mauvaise', s: 'fail' }]);
  /* Chaque choix retient son libellé d'origine : renommer « Surmûr » en
     « Trop mûr » doit emporter son palier de maturité avec lui, pas le
     laisser pointer vers un stade qui n'existe plus. */
  if (f.options) opts.forEach(o => { o._was = o.v; });

  sheet(isNew ? 'Nouveau critère' : 'Modifier le critère', `
    <div class="field"><label for="cl">Nom du critère</label>
      <input type="text" id="cl" value="${esc(f.label)}" placeholder="Ex. Taches / Maculatures"></div>

    <div class="field"><label>Ce que l'on note</label>
      <div class="olist" id="kindBox">
        ${FIELD_KINDS.map(([k, name, ex]) => `<button type="button" class="obtn" data-k="${k}"
          aria-pressed="${k === type}"><b>${name}</b><span>${esc(ex)}</span></button>`).join('')}
      </div></div>

    <div id="scale"></div>

    <div class="field"><label for="cu">Unité affichée</label>
      <input type="text" id="cu" value="${esc(f.unit || '')}" placeholder="%, kg, °C, °Bx…"></div>

    <!-- Certains critères ne se contentent pas d'être notés : ils
         alimentent un des trois axes du verdict. C'était jusqu'ici
         réservé aux critères d'origine, reconnus à leur nom ; c'est
         désormais un réglage, donc disponible sur une grille créée de
         toutes pièces. -->
    <div class="field"><label for="crole">Rôle dans le verdict</label>
      <select id="crole"></select>
      <div class="hint">Un rôle dit ce que le critère APPORTE au calcul, en plus de sa note. Pour qu'un critère
        rende le rapport non conforme, choisissez plutôt la gravité « Non conforme directement ». Le % de caisses
        problématiques est porté par un seul critère ; « colis contrôlés » et « colis en défaut » le calculent tout
        seuls. Le %NC du lot en tient compte, avec toutes les autres imperfections.</div></div>

    ${typesBlock(f, sec)}
    ${!isNew ? `
      <button type="button" class="btn ghost block" id="maskHere" style="margin-bottom:13px">
        ${isHidden(f) ? 'Afficher ce critère dans les rapports'
                      : 'Masquer ce critère — il reste dans la grille'}</button>` : ''}
    <div id="i18nBox">${i18nBlock(f.label, f.i18n)}</div>
    <div class="field"><label for="ch">Petite aide affichée sous le critère</label>
      <input type="text" id="ch" value="${esc(f.hint || '')}" placeholder="Facultatif"></div>

    <div class="btn-row">
      <button class="btn ghost" style="flex:1" id="cancel">Annuler</button>
      <button class="btn" style="flex:2" id="ok">${isNew ? 'Ajouter' : 'Enregistrer'}</button>
    </div>
    ${isNew ? '' : '<button class="btn ghost danger block" id="del" style="margin-top:10px">Supprimer le critère</button>'}`,
    { onMount(el, close) {
        wireTypes(el);
        const $$$ = (s) => el.querySelector(s);

        /* ---------- le barème, réécrit à chaque changement de type ---------- */
        const paintScale = () => {
          const u = $$$('#cu')?.value.trim() || (type === 'pct' ? '%' : '');
          const unit = u ? ` ${esc(u)}` : '';
          let html = '';

          if (type === 'pct') {
            html = `<div class="scale-box">
              <h4>Barème</h4>
              <div class="srow"><span class="sdot ok"></span><b>Conforme</b>
                <span>jusqu'à <input type="number" step="0.1" id="wa" value="${f.warnAt ?? ''}">${unit}</span></div>
              <div class="srow"><span class="sdot warn"></span><b>À surveiller</b>
                <span>jusqu'à <input type="number" step="0.1" id="fa" value="${f.failAt ?? ''}">${unit}</span></div>
              <div class="srow"><span class="sdot fail"></span><b>Au-delà</b>
                <span id="beyond">${OUTCOMES[outcomesFor(type).includes(sev) ? sev : 'majeur'][0].toLowerCase()}</span></div>
              <p class="hint">Laissez les deux cases vides pour un pourcentage purement
                informatif, relevé mais jamais noté.</p>
            </div>
            ${outcomeBlock(type, sev, 'Au-delà du second seuil, c\'est…')}`;
          } else if (type === 'num') {
            html = `<div class="scale-box">
              <h4>Barème</h4>
              <div class="srow"><span class="sdot ok"></span><b>Conforme</b>
                <span>de <input type="number" step="0.01" id="mn" value="${f.okMin ?? ''}">
                      à <input type="number" step="0.01" id="mx" value="${f.okMax ?? ''}">${unit}</span></div>
              <div class="srow"><span class="sdot fail"></span><b>En dehors</b>
                <span id="beyond">${OUTCOMES[outcomesFor(type).includes(sev) ? sev : 'majeur'][0].toLowerCase()}</span></div>
              <p class="hint">Laissez les deux cases vides pour une mesure purement informative,
                notée nulle part — un poids brut, par exemple.</p>
            </div>
            ${outcomeBlock(type, sev, 'Hors de la plage, c\'est…')}`;
          } else if (type === 'choice') {
            html = `<div class="scale-box">
              <h4>Choix proposés</h4>
              <div id="optRows"></div>
              <button type="button" class="btn ghost sm" id="optAdd" style="margin-top:8px">
                ${icon('plus')} Ajouter un choix</button>
            </div>
            ${outcomeBlock(type, sev, 'Un choix « Non conforme », c\'est…')}`;
          } else {
            html = `<div class="scale-box">
              <h4>Barème</h4>
              <div class="srow"><span class="sdot ok"></span><b>Conforme</b><span>rien à signaler</span></div>
              <div class="srow"><span class="sdot fail"></span><b>Non conforme</b>
                <span id="beyond">${OUTCOMES[outcomesFor(type).includes(sev) ? sev : 'majeur'][0].toLowerCase()}</span></div>
            </div>
            ${outcomeBlock(type, sev, 'Répondre « Non », c\'est…')}`;
          }

          $$$('#scale').innerHTML = html + tryBlock();
          wireScale();
        };

        /* ---------- essai en direct ---------- */
        const tryBlock = () => type === 'choice' || type === 'bool' ? '' : `
          <div class="try-box">
            <label for="tryV">Essayer une valeur</label>
            <input type="number" step="0.01" id="tryV" placeholder="ex. 12">
            <span id="tryOut" class="muted">—</span>
          </div>`;

        const runTry = () => {
          const out = $$$('#tryOut'), inp = $$$('#tryV');
          if (!out || !inp) return;
          if (inp.value === '') { out.className = 'muted'; out.textContent = '—'; return; }
          const probe = draftField();
          const st = fieldStatus(probe, Number(inp.value));
          const words = st === 'ok' ? ['Conforme', 'ok']
            : st === 'warn' ? ['À surveiller', 'warn']
            : st === 'fail' ? [sev === 'critique' ? 'Non conforme' : 'Défaut ' + sev, 'fail']
            : ['Non noté', ''];
          out.className = 'try-out ' + words[1];
          out.textContent = words[0];
        };

        /* ---------- lecture de l'état courant du formulaire ---------- */
        const numOr = (sel) => { const v = $$$(sel)?.value; return v === '' || v == null ? undefined : Number(v); };
        const draftField = () => {
          const o = { type, severity: sev };
          if (type === 'pct') { o.warnAt = numOr('#wa'); o.failAt = numOr('#fa'); }
          if (type === 'num') { o.okMin = numOr('#mn'); o.okMax = numOr('#mx'); o.step = 0.01; }
          if (type === 'choice') o.options = opts.filter(x => (x.v || '').trim());
          return o;
        };

        /* ---------- lignes de choix ---------- */
        const paintOpts = () => {
          const box = $$$('#optRows');
          if (!box) return;
          box.innerHTML = opts.map((o, i) => `
            <div class="opt-row" data-o="${i}">
              <input type="text" value="${esc(o.v || '')}" placeholder="Intitulé" data-ov>
              <select data-os>${STATUS_WORDS.map(([v, w]) =>
                `<option value="${v}"${v === (o.s || 'ok') ? ' selected' : ''}>${w}</option>`).join('')}</select>
              <button type="button" class="icon-btn" data-ox aria-label="Retirer">${icon('x')}</button>
            </div>`).join('');
          box.querySelectorAll('.opt-row').forEach(row => {
            const i = +row.dataset.o;
            row.querySelector('[data-ov]').oninput = (e) => { opts[i].v = e.target.value; };
            row.querySelector('[data-os]').onchange = (e) => { opts[i].s = e.target.value; };
            row.querySelector('[data-ox]').onclick = () => { opts.splice(i, 1); paintOpts(); };
          });
        };

        const wireScale = () => {
          el.querySelectorAll('#outBox .obtn').forEach(b => b.onclick = () => {
            sev = b.dataset.o;
            el.querySelectorAll('#outBox .obtn').forEach(x =>
              x.setAttribute('aria-pressed', String(x.dataset.o === sev)));
            const beyond = $$$('#beyond');
            if (beyond) beyond.textContent = OUTCOMES[sev][0].toLowerCase();
            runTry();
          });
          ['#wa', '#fa', '#mn', '#mx'].forEach(s => { const i = $$$(s); if (i) i.oninput = runTry; });
          const tv = $$$('#tryV'); if (tv) tv.oninput = runTry;
          const oa = $$$('#optAdd');
          if (oa) oa.onclick = () => { opts.push({ v: '', s: 'ok' }); paintOpts(); };
          paintOpts();
          runTry();
        };

        /* Seuls les rôles qui ont un sens pour ce type de critère sont
           proposés : un critère Conforme / Non ne peut pas « être » un
           pourcentage de non-conformité. */
        let role = fieldRole(f);
        const paintRoles = () => {
          const sel = $$$('#crole');
          if (!sel) return;
          if (!roleFits(role, type)) role = '';
          sel.innerHTML = Object.entries(FIELD_ROLES).filter(([v]) => roleFits(v, type)).map(([v, w]) =>
            `<option value="${v}"${v === role ? ' selected' : ''}>${esc(w)}</option>`).join('');
          sel.onchange = () => { role = sel.value; };
        };
        paintRoles();

        el.querySelectorAll('#kindBox .obtn').forEach(b => b.onclick = () => {
          type = b.dataset.k;
          el.querySelectorAll('#kindBox .obtn').forEach(x =>
            x.setAttribute('aria-pressed', String(x.dataset.k === type)));
          if (!outcomesFor(type).includes(sev)) sev = outcomesFor(type)[0];
          paintScale();
          paintRoles();
        });
        $$$('#cu').oninput = paintScale;
        paintScale();

        $$$('#cancel').onclick = () => close();

        /* Masquer depuis la fiche : même geste que la touche 👁 de la
           liste, à portée de main quand on vient de relire le barème et
           qu'on décide que ce critère ne sert plus cette saison. */
        const mask = $$$('#maskHere');
        if (mask) mask.onclick = async () => {
          const cur = sec.fields[fi];
          const before = cur.hidden;
          if (before) delete cur.hidden; else cur.hidden = true;
          await saveGroup(g); close(); renderGroupEditor(g.id);
          toast(`« ${f.label} » ${before ? 'affiché' : 'masqué'} — il reste dans la grille`, '',
            { action: 'Annuler', onAction: async () => {
                if (before) cur.hidden = true; else delete cur.hidden;
                await saveGroup(g); renderGroupEditor(g.id);
              } });
        };

        const delBtn = $$$('#del');
        if (delBtn) delBtn.onclick = async () => {
          close();
          if (!(await confirmSheet('Supprimer le critère',
                `« ${f.label} » disparaît de tous les types de rapport.`, { okLabel: 'Supprimer partout' }))) return;
          const copy = structuredClone(sec.fields[fi]);
          sec.fields.splice(fi, 1);
          await saveGroup(g); renderGroupEditor(g.id);
          toast('Critère supprimé', '', { action: 'Annuler', onAction: async () => {
            sec.fields.splice(fi, 0, copy);
            await saveGroup(g); renderGroupEditor(g.id);
          } });
        };

        $$$('#ok').onclick = async () => {
          const label = $$$('#cl').value.trim();
          if (!label) return toast('Donnez un nom au critère', 'err');

          const d = draftField();

          /* Un barème à l'envers ne dit rien : « conforme jusqu'à 10,
             à surveiller jusqu'à 4 » laisse un trou entre 4 et 10 que
             personne ne saurait lire. On le refuse à la saisie plutôt
             que de produire des verdicts incohérents. */
          if (type === 'pct' && d.warnAt != null && d.failAt != null && d.warnAt > d.failAt)
            return toast('Le second seuil doit être supérieur au premier', 'err');
          if (type === 'num' && d.okMin != null && d.okMax != null && d.okMin > d.okMax)
            return toast('Le minimum doit être inférieur au maximum', 'err');
          if (type === 'choice' && !(d.options || []).length)
            return toast('Ajoutez au moins un choix', 'err');

          /* On repart du critère existant : `computed`, `role` et tout
             réglage posé ailleurs doivent survivre à une simple
             correction de libellé. Seules les clés de barème du type
             précédent sont effacées — sinon un critère passé de
             pourcentage à mesure garderait ses seuils fantômes. */
          const base = fi >= 0 ? structuredClone(sec.fields[fi]) : {};
          for (const k of ['warnAt', 'failAt', 'okMin', 'okMax', 'options']) delete base[k];

          const out = {
            ...base,
            key: f.key || slug(label).replace(/-/g, '_') + '_' + Math.random().toString(36).slice(2, 5),
            label, type, severity: sev,
            unit: $$$('#cu').value.trim() || undefined,
            hint: $$$('#ch').value.trim() || undefined,
            types: readTypes(el),
            role: role || (defaultRole(f.key) ? '' : undefined),
            i18n: readI18n(el),
            ...d
          };
          /* `step` n'a de sens que sur une mesure chiffrée, et le pas
             d'origine du critère prime sur le pas par défaut. */
          if (type === 'num') out.step = base.step ?? 0.01;
          else delete out.step;
          for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];

          /* Choix renommés : le barème de maturité suit. */
          const renamed = new Map();
          for (const o of out.options || []) {
            if (o._was != null && o._was !== o.v) renamed.set(o._was, o.v);
            delete o._was;
          }
          const saved = g.config.verdict?.ripeness?.bands;
          if (renamed.size && Array.isArray(saved) && fieldRole(out) === 'ripeness')
            for (const b of saved) if (renamed.has(b.stage)) b.stage = renamed.get(b.stage);

          if (fi >= 0) sec.fields[fi] = out; else sec.fields.push(out);

          /* Un seul %NC, un seul nombre de colis contrôlés… : donner le
             rôle à ce critère le retire à celui qui le portait. */
          const moved = [];
          if (UNIQUE_ROLES.includes(role)) {
            for (const s2 of g.config.sections || [])
              for (const x of s2.fields || [])
                if (x !== out && fieldRole(x) === role) { clearRole(x, role); moved.push(x.label); }
          }
          await saveGroup(g); close(); renderGroupEditor(g.id);
          if (moved.length) toast(`Rôle « ${ROLE_SHORT[role]} » retiré de : ${moved.join(', ')}`, '', { ms: 6000 });
        };
      } });
}

/* Local d'abord, file d'attente ensuite, envoi si le réseau le permet.
   Renvoie `false` quand l'envoi n'a pas abouti — la modification est
   enregistrée dans tous les cas, l'appelant le dit simplement autrement. */
async function saveGroup(g) {
  normalizeSections(g.config?.sections);
  await local.put('groups', g);
  await queue('group', { id: g.id, name: g.name, position: g.position, active: g.active, config: g.config });
  const ok = await sync({ silent: true });
  await loadRefs();
  return ok;
}

const sevDot = (f) => {
  const s = effSeverity(f);
  return s === 'critique' ? 'fail' : s === 'majeur' ? 'warn' : 'none';
};
/* Résumé d'un critère dans la liste : la même phrase que dans
   l'éditeur, en plus court. On y lit le dernier échelon — celui qui
   manquait — sans avoir à ouvrir la fiche. */
const describe = (f) => {
  const u = f.unit ? ' ' + f.unit : '';
  const beyond = (OUTCOMES[effSeverity(f)] || OUTCOMES.majeur)[0].toLowerCase();
  const role = fieldRole(f) && roleFits(fieldRole(f), f.type) ? ` · ${ROLE_SHORT[fieldRole(f)] || FIELD_ROLES[fieldRole(f)].toLowerCase()}` : '';
  if (f.type === 'pct')
    return (f.warnAt == null && f.failAt == null)
      ? 'Pourcentage informatif, jamais noté' + role
      : `Conforme jusqu'à ${f.warnAt ?? '—'}${u} · à surveiller jusqu'à ${f.failAt ?? '—'}${u} · au-delà : ${beyond}${role}`;
  if (f.type === 'num')
    return ((f.okMin != null || f.okMax != null)
      ? `Accepté de ${f.okMin ?? '−∞'} à ${f.okMax ?? '+∞'}${u} · en dehors : ${beyond}`
      : 'Mesure informative, jamais notée') + role;
  if (f.type === 'choice')
    return `${(f.options || []).map(o => o.v).join(', ') || 'aucun choix'} · « non conforme » : ${beyond}${role}`;
  return `Conforme / non conforme · « non » : ${beyond}${role}`;
};
const splitList = (s) => s.split(/[,\n]/).map(x => x.trim()).filter(Boolean);
/* Vide ⇒ null, jamais 0 : un champ effacé ne vaut pas « zéro ». */
const num = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
};
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/* ======================== PARTENAIRES ========================
   Un onglet par sorte de partenaire, une recherche, et une ligne par
   contact : initiales, nom, coordonnées s'il y en a. */
let pKind = 'fournisseur';
const KINDS = [['fournisseur', 'Fournisseurs'], ['client', 'Clients'], ['transporteur', 'Transporteurs']];

export function renderPartners() {
  const by = (k) => state.partners.filter(p => p.kind === k);
  shell("Carnet d'adresses", `
   <div class="narrow">
    <div class="seg" id="pKind" style="margin-bottom:10px">${KINDS.map(([k, label]) =>
      `<button type="button" data-k="${k}" aria-pressed="${pKind === k}">${label} <span class="n" style="opacity:.7">${by(k).length}</span></button>`).join('')}</div>
    <label class="search" style="margin-bottom:12px;display:block">${icon('search')}
      <input type="search" id="pq" placeholder="Rechercher un nom, un pays…" autocomplete="off" aria-label="Rechercher un partenaire"></label>
    <div id="pList"></div>
    <button class="btn ghost block" id="add" style="margin-top:14px">${icon('plus')} Ajouter un partenaire</button>
   </div>`,
    { back: () => back('#/settings'), tab: 'settings',
      actions: `<button class="icon-btn" id="addTop" aria-label="Ajouter un partenaire">${icon('plus')}</button>`,
      onMount() {
        const paint = () => {
          const q = ($('#pq')?.value || '').trim().toLowerCase();
          const rows = by(pKind).filter(p => !q || [p.name, p.country, p.email, p.phone].filter(Boolean).join(' ').toLowerCase().includes(q));
          $('#pList').innerHTML = rows.length ? `<div class="menu">${rows.map(p => {
            const meta = [p.country, p.email, p.phone].filter(Boolean).join(' · ');
            return `<button class="person" data-p="${esc(p.id)}">
              <span class="avatar">${esc(initials(p.name))}</span>
              <span class="tx"><b>${esc(p.name)}</b><span>${meta ? esc(meta) : 'Aucune coordonnée'}</span></span>
              ${refCount(p) ? `<span class="pill sm brand">${refCount(p)} réf. pression</span>` : ''}
              <span class="chev" style="color:var(--ink-3)">${icon('chevR')}</span></button>`;
          }).join('')}</div>`
            : `<div class="card empty"><div class="ico">${icon('truck')}</div><p>${q ? 'Aucun résultat.' :
                'Aucun pour l\'instant. Un nom saisi dans un rapport s\'ajoute tout seul au carnet.'}</p></div>`;
          $$('[data-p]').forEach(b => b.onclick = () => editPartner(state.partners.find(p => p.id === b.dataset.p)));
        };
        $$('#pKind [data-k]').forEach(b => b.onclick = () => {
          pKind = b.dataset.k;
          $$('#pKind [data-k]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
          paint();
        });
        $('#pq').oninput = paint;
        $('#add').onclick = () => editPartner(null);
        $('#addTop').onclick = () => editPartner(null);
        paint();
      } });
}

/* Nombre de références de pression enregistrées pour un client. */
const refList = (p) => (p?.config?.pressureRefs || []);
const refCount = (p) => refList(p).length;

/* Cahier des charges du client : pression attendue par
   conditionnement. C'est ce que le rapport ira chercher tout seul
   quand on saisira ce client. Une ligne sans conditionnement sert de
   valeur par défaut pour tous les autres. */
function refRowsHtml(refs) {
  if (!refs.length)
    return `<p class="muted" style="margin:0 0 8px">Aucune référence. Sans elle, le rapport
      garde la valeur par défaut du produit et le contrôleur l'ajuste à la main.</p>`;
  return refs.map((r, i) => `
    <div class="ref-row" data-r="${i}">
      <select data-f="group" aria-label="Produit">
        <option value=""${!r.group ? ' selected' : ''}>Tous produits</option>
        ${state.groups.map(g => `<option value="${esc(g.id)}"${g.id === r.group ? ' selected' : ''}>${esc(g.config?.icon || '')} ${esc(g.name)}</option>`).join('')}
        ${r.group && !state.groups.some(g => g.id === r.group)
          ? `<option value="${esc(r.group)}" selected>⚠ ${esc(r.group)} (produit introuvable)</option>` : ''}
      </select>
      <select data-f="packaging" aria-label="Conditionnement">
        <option value=""${!r.packaging ? ' selected' : ''}>Tous conditionnements</option>
        ${PACKAGING_KINDS.map(k => `<option value="${esc(k)}"${k === r.packaging ? ' selected' : ''}>${esc(k)}</option>`).join('')}
      </select>
      <span class="seg sm" data-f="mode">
        <button type="button" data-m="target" aria-pressed="${r.mode !== 'range'}">Valeur</button>
        <button type="button" data-m="range" aria-pressed="${r.mode === 'range'}">Plage</button>
      </span>
      ${r.mode === 'range'
        ? `<span class="ref-in"><label>Mini <input type="number" step="0.1" min="${LIMITS.min}" max="${LIMITS.max}" data-f="min" value="${r.min ?? ''}"></label>
             <label>Maxi <input type="number" step="0.1" min="${LIMITS.min}" max="${LIMITS.max}" data-f="max" value="${r.max ?? ''}"></label></span>`
        : `<span class="ref-in"><label>Cible <input type="number" step="0.1" min="${LIMITS.min}" max="${LIMITS.max}" data-f="ref" value="${r.ref ?? ''}"></label></span>`}
      <button type="button" class="icon-btn" data-f="del" aria-label="Retirer cette référence">${icon('x')}</button>
    </div>`).join('');
}

function editPartner(p) {
  const isNew = !p;
  p = p || { id: crypto.randomUUID(), kind: pKind, name: '', active: true, config: {} };
  const refs = structuredClone(refList(p));
  sheet(isNew ? 'Nouveau partenaire' : p.name, `
    <div class="field"><label>Type</label>
      <div class="seg" id="kind">
        <button type="button" data-k="fournisseur" aria-pressed="${p.kind === 'fournisseur'}">Fournisseur</button>
        <button type="button" data-k="client" aria-pressed="${p.kind === 'client'}">Client</button>
        <button type="button" data-k="transporteur" aria-pressed="${p.kind === 'transporteur'}">Transporteur</button>
      </div></div>
    <div class="field"><label for="pn">Nom</label><input type="text" id="pn" value="${esc(p.name)}"></div>
    <div class="row2">
      <div class="field"><label for="pc">Pays</label><input type="text" id="pc" value="${esc(p.country || '')}"></div>
      <div class="field"><label for="pp">Téléphone</label><input type="text" id="pp" value="${esc(p.phone || '')}"></div>
    </div>
    <div class="field"><label for="pe">E-mail</label><input type="email" id="pe" value="${esc(p.email || '')}"></div>

    <div class="field" id="refWrap" ${p.kind === 'client' ? '' : 'hidden'}>
      <label>Pressions attendues</label>
      <div id="refRows"></div>
      <button type="button" class="btn ghost sm" id="refAdd">${icon('plus')} Ajouter une référence</button>
      <div class="hint">Appliquée automatiquement au rapport dès que ce client est saisi.
        Une valeur cible tolère ${SEV_STEPS.ok} point d'écart ; une plage en tolère ${RANGE_TOL}.
        Valeurs comprises entre ${LIMITS.min} et ${LIMITS.max}.<br>
        La règle la plus précise l'emporte : produit + conditionnement d'abord, puis produit seul,
        puis conditionnement seul, puis la ligne « tous ».</div>
    </div>

    <div class="btn-row">
      <button class="btn ghost" style="flex:1" id="cancel">Annuler</button>
      <button class="btn" style="flex:2" id="ok">Enregistrer</button></div>
    ${isNew ? '' : '<button class="btn ghost danger block" id="del" style="margin-top:10px">Supprimer ce partenaire</button>'}`,
    { onMount(el, close) {
        let kind = p.kind;
        const paintRefs = () => {
          el.querySelector('#refRows').innerHTML = refRowsHtml(refs);
          el.querySelectorAll('.ref-row').forEach(row => {
            const i = +row.dataset.r;
            row.querySelector('[data-f=group]').onchange = (e) => { refs[i].group = e.target.value; };
            row.querySelector('[data-f=packaging]').onchange = (e) => { refs[i].packaging = e.target.value; };
            row.querySelectorAll('[data-f=mode] button').forEach(b => b.onclick = () => {
              refs[i].mode = b.dataset.m;
              /* Passer en plage sans repartir de zéro : ±1 autour de la
                 cible, soit exactement sa tolérance. */
              if (refs[i].mode === 'range' && refs[i].min == null && refs[i].ref != null) {
                refs[i].min = Math.max(0, Number(refs[i].ref) - 1);
                refs[i].max = Number(refs[i].ref) + 1;
              }
              paintRefs();
            });
            ['ref', 'min', 'max'].forEach(f => {
              const inp = row.querySelector(`[data-f=${f}]`);
              if (!inp) return;
              inp.oninput = () => { refs[i][f] = inp.value === '' ? null : Number(inp.value); };
              /* Borné à la sortie du champ : une valeur hors mesure est
                 une faute de frappe, on la ramène sans rien perdre. */
              inp.onblur = () => {
                if (inp.value === '') { refs[i][f] = null; return; }
                const c = clampP(inp.value);
                if (c != null && c !== Number(inp.value)) {
                  inp.value = String(c);
                  toast(`Ramené à ${c} : la mesure va de ${LIMITS.min} à ${LIMITS.max}.`);
                }
                refs[i][f] = c;
              };
            });
            row.querySelector('[data-f=del]').onclick = () => { refs.splice(i, 1); paintRefs(); };
          });
        };
        paintRefs();
        el.querySelector('#refAdd').onclick = () => {
          /* La nouvelle ligne reprend le produit de la précédente : on
             saisit en général les quatre conditionnements d'un même
             produit à la suite. */
          refs.push({ group: refs[refs.length - 1]?.group || '', packaging: '', mode: 'target', ref: 13 });
          paintRefs();
        };
        el.querySelectorAll('#kind button').forEach(b => b.onclick = () => {
          kind = b.dataset.k;
          el.querySelectorAll('#kind button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.k === kind)));
          el.querySelector('#refWrap').hidden = kind !== 'client';
        });
        el.querySelector('#cancel').onclick = () => close();
        const del = el.querySelector('#del');
        if (del) del.onclick = async () => {
          close();
          if (!(await confirmSheet('Supprimer', p.name))) return;
          const copy = structuredClone(p);
          /* La suppression passe par la file d'attente : appelée en
             direct, elle échouait hors ligne sans un mot et le
             partenaire réapparaissait à la synchronisation suivante. */
          await local.del('partners', p.id);
          await queue('deletePartner', { id: p.id });
          try { await sync({ silent: true }); } catch (e) { /* renvoyé plus tard */ }
          await loadRefs(); renderPartners();
          toast(`${copy.name} supprimé`, '', { action: 'Annuler', onAction: async () => {
            await local.put('partners', copy);
            await queue('partner', copy);
            await sync({ silent: true }); await loadRefs(); renderPartners();
          } });
        };
        el.querySelector('#ok').onclick = async () => {
          /* Une référence incomplète ne sert à rien et s'appliquerait
             silencieusement de travers : on ne garde que les lignes
             exploitables. */
          const usable = refs.filter(r =>
            r.mode === 'range' ? (r.min != null && r.max != null) : r.ref != null);
          /* Un client rebasculé en fournisseur par erreur perdait
             définitivement ses pressions attendues. On les conserve :
             elles ne servent simplement pas tant que le partenaire
             n'est pas un client. */
          const keep = kind === 'client' ? usable : (refList(p).length ? refList(p) : usable);
          const row = { ...p, kind, name: el.querySelector('#pn').value.trim(),
            country: el.querySelector('#pc').value.trim() || null,
            phone: el.querySelector('#pp').value.trim() || null,
            email: el.querySelector('#pe').value.trim() || null,
            config: { ...(p.config || {}), pressureRefs: keep } };
          if (!row.name) return toast('Donnez un nom', 'err');
          await local.put('partners', row);
          await queue('partner', row);
          if (!(await sync({ silent: true }))) toast('Enregistré · envoi à la reconnexion');
          await loadRefs();
          close(); renderPartners();
        };
      } });
}

/* =========================== ÉQUIPE =========================== */
export async function renderUsers() {
  let users = [];
  try { users = await db('profiles').select('*').order('created_at', true); }
  catch (e) { toast(e.message, 'err'); }
  const waiting = users.filter(u => !u.approved);
  const active = users.filter(u => u.approved);

  const row = (u) => `
    <button class="person" data-u="${esc(u.id)}">
      <span class="avatar">${esc(initials(u.full_name || u.email))}</span>
      <span class="tx"><b>${esc(u.full_name || u.email)}</b><span>${esc(u.email || '')}</span></span>
      <span class="pill sm ${u.approved ? (ADMIN_ROLES.includes(u.role) ? 'brand' : '') : 'warn'}">${u.approved ? roleLabel(u.role) : 'à valider'}</span>
      <span class="chev" style="color:var(--ink-3)">${icon('chevR')}</span></button>`;

  shell('Équipe', `
   <div class="narrow">
    ${waiting.length ? `<div class="label-up">En attente de validation (${waiting.length})</div>
      <div class="menu">${waiting.map(row).join('')}</div>` : ''}
    <div class="label-up">Membres actifs (${active.length})</div>
    <div class="menu">${active.map(row).join('') || '<p class="muted" style="padding:14px;margin:0">Aucun.</p>'}</div>
    <div class="info-box" style="margin-top:16px">${icon('info')}<p>Un nouveau collègue crée son compte depuis l'écran de connexion :
    il apparaît ici en attente, et vous lui ouvrez l'accès.</p></div>
   </div>`,
    { back: () => back('#/settings'), tab: 'settings',
      onMount() {
        $$('[data-u]').forEach(b => b.onclick = () => editUser(users.find(u => u.id === b.dataset.u)));
      } });
}

/* Les rôles tels qu'on les lit à l'écran. La valeur stockée ne change
   pas (« inspecteur » pour le Contrôleur Qualité) : les comptes et les
   règles de la base existants restent valables. */
const ROLES = {
  admin:       { label: 'Administrateur',         desc: 'tous les droits, dont les comptes responsables' },
  responsable: { label: 'Responsable Murisserie', desc: 'réglages, produits et équipe' },
  inspecteur:  { label: 'Contrôleur Qualité',     desc: 'crée et modifie ses rapports' },
  lecture:     { label: 'Lecture seule',          desc: 'consulte et partage' }
};
const ADMIN_ROLES = ['admin', 'responsable'];
export const roleLabel = (r) => ROLES[r]?.label || r;

/* Qui peut toucher à quel compte. L'administrateur règle tout le monde ;
   le responsable ne règle que les contrôleurs qualité et les lectures
   seules, et ne peut attribuer que ces deux rôles. La base applique la
   même règle : ce qui n'est pas proposé ici y serait refusé. */
const assignable = () => isAdmin() ? ['inspecteur', 'lecture', 'responsable', 'admin']
                        : canManage() ? ['inspecteur', 'lecture'] : [];
const canEditUser = (u) => u.id !== state.profile?.id && assignable().includes(u.role);

/* Écrit une modification de profil et VÉRIFIE qu'elle a porté.
   Deux refus possibles, tous deux silencieux côté serveur :
     — aucune ligne renvoyée : la règle de sécurité a écarté la ligne ;
     — ligne renvoyée mais valeurs inchangées : le garde-fou de la base
       annule toute modification du rôle ou de la validation qui dépasse
       les droits de son auteur (voir `assignable`). Il REMET les anciennes
       valeurs au lieu de lever une erreur, si bien que « pas d'erreur »
       ne voulait pas dire « c'est fait ».
   On compare donc ce qui revient à ce qu'on a demandé. */
async function patchProfile(id, patch) {
  const rows = await db('profiles').eq('id', id).update(patch);
  if (!Array.isArray(rows) || !rows.length)
    throw new Error("Modification refusée : vos droits ne permettent pas de modifier ce compte.");
  const got = rows[0];
  const raté = Object.keys(patch).filter(k => got[k] !== patch[k]);
  if (raté.length)
    throw new Error("La base a annulé la modification : vos droits ne permettent pas d'attribuer ce rôle.");
  return got;
}

function editUser(u) {
  const me = u.id === state.profile?.id;
  const pending = !u.approved;

  /* Un compte hors de portée — le sien, ou, pour un responsable, celui
     d'un administrateur ou d'un autre responsable — s'affiche sans
     commande : on dit pourquoi plutôt que de proposer un bouton que la
     base refuserait. */
  if (!canEditUser(u)) {
    sheet(u.full_name || u.email, `
      <p class="muted" style="margin:0 0 14px">${esc(u.email || '')}</p>
      <div class="facts" style="margin-bottom:14px"><div><span>Rôle</span><b>${esc(roleLabel(u.role))}</b></div>
        <div><span>Accès</span><b>${u.approved ? 'Validé' : 'En attente'}</b></div></div>
      <div class="info-box" id="urLocked">${icon('info')}<p>${me ? 'Vous ne pouvez pas modifier votre propre rôle.'
        : 'Seul un administrateur peut modifier ce compte.'}</p></div>
      <button class="btn ghost block" id="cancel" style="margin-top:14px">Fermer</button>`,
      { onMount(el, close) { el.querySelector('#cancel').onclick = () => close(); } });
    return;
  }

  /* Le bouton principal est celui qu'on cherche, et il fait ce qu'il
     annonce. Sur un compte en attente, c'est « Valider l'accès » —
     jusqu'ici c'était « Enregistrer », qui n'écrivait que le rôle :
     sur un collègue déjà contrôleur, la requête ne changeait rien, la
     fenêtre se refermait, et le compte restait bloqué sans un mot. */
  sheet(u.full_name || u.email, `
    <p class="muted" style="margin:0 0 14px">${esc(u.email || '')}</p>
    ${pending ? `<div class="ok-box" style="margin:0 0 14px">
      Ce compte attend votre validation. Choisissez son rôle, puis touchez
      <b>Valider l'accès</b> : il pourra se connecter aussitôt.</div>` : ''}
    <div class="field"><label for="ur">Rôle</label>
      <select id="ur">${assignable().map(r =>
        `<option value="${r}"${u.role === r ? ' selected' : ''}>${esc(ROLES[r].label)} — ${esc(ROLES[r].desc)}</option>`).join('')}
      </select></div>
    <div class="btn-row">
      <button class="btn ghost" style="flex:1" id="cancel">Fermer</button>
      ${pending
        ? `<button class="btn" style="flex:2" id="grant">Valider l'accès</button>`
        : `<button class="btn ghost danger" style="flex:1" id="susp">Suspendre</button>
           <button class="btn" style="flex:1" id="ok">Enregistrer</button>`}
    </div>`,
    { onMount(el, close) {
        el.querySelector('#cancel').onclick = () => close();
        const busy = (b, txt) => { b.disabled = true; b.innerHTML = '<span class="spin"></span>'; return () => { b.disabled = false; b.textContent = txt; }; };

        const grant = el.querySelector('#grant');
        if (grant) grant.onclick = async () => {
          const done = busy(grant, "Valider l'accès");
          const role = el.querySelector('#ur').value;
          try { await patchProfile(u.id, { approved: true, role }); }
          catch (e) { done(); return toast(e.message, 'err'); }
          close();
          toast(`Accès validé (${roleLabel(role)}) — ${u.full_name || u.email} peut se connecter`, '', { ms: 5000 });
          renderUsers();
        };

        const susp = el.querySelector('#susp');
        if (susp) susp.onclick = async () => {
          if (!(await confirmSheet('Suspendre l\'accès',
                `${u.full_name || u.email} ne pourra plus ouvrir l'application. Ses rapports restent en place.`,
                { okLabel: 'Suspendre' }))) return;
          try { await patchProfile(u.id, { approved: false }); }
          catch (e) { return toast(e.message, 'err'); }
          close(); toast('Accès suspendu'); renderUsers();
        };

        const ok = el.querySelector('#ok');
        if (ok) ok.onclick = async () => {
          const role = el.querySelector('#ur').value;
          if (role === u.role) { close(); return toast('Aucun changement'); }
          const done = busy(ok, 'Enregistrer');
          try { await patchProfile(u.id, { role }); }
          catch (e) { done(); return toast(e.message, 'err'); }
          close(); toast(`Rôle enregistré : ${roleLabel(role)}`); renderUsers();
        };
      } });
}

/* ========================== MON COMPTE ========================== */
export function renderAccount() {
  const p = state.profile || {};
  shell('Mon compte', `
   <div class="narrow">
    <div class="card me-card" style="cursor:default">
      <span class="avatar lg">${esc(initials(p.full_name || p.email))}</span>
      <span class="tx"><b>${esc(p.full_name || '')}</b><span>${esc(p.email || '')}</span></span>
      <span class="pill brand">${esc(roleLabel(p.role))}</span>
    </div>
    ${canManage() ? `<div class="label-up">Société</div>
    <div class="card pad">
      <div class="field"><label for="cn">Nom de la société (en-tête des PDF)</label>
        <input type="text" id="cn" value="${esc(state.settings.company)}"></div>
      <div class="field"><label for="dp">Départements / dépôts</label>
        <textarea id="dp" style="min-height:64px">${esc((state.settings.departments || []).join(', '))}</textarea>
        <div class="hint">Séparés par des virgules.</div></div>
      <button class="btn block" id="saveS">Enregistrer</button>
    </div>` : `<div class="label-up">Société</div>
    <div class="card pad"><div class="facts"><div><span>Société</span><b>${esc(state.settings.company)}</b></div></div></div>`}
    <div class="label-up">Sécurité</div>
    <div class="card pad">
      <div class="field"><label for="np">Nouveau mot de passe</label>
        <input type="password" id="np" minlength="8" placeholder="8 caractères minimum" autocomplete="new-password"></div>
      <button class="btn ghost block" id="pw">${icon('lock')} Changer le mot de passe</button>
    </div>
    <button class="btn ghost danger block" id="out" style="margin-top:18px">${icon('logout')} Se déconnecter</button>
    <p class="about" style="margin-top:16px">Les photos sont privées : leur accès passe par un lien signé, valable une heure.</p>
   </div>`,
    { back: () => back('#/settings'), tab: 'settings',
      onMount() {
        const s = $('#saveS');
        if (s) s.onclick = async () => {
          const value = { ...state.settings,
            company: $('#cn').value.trim() || state.settings.company,
            departments: splitList($('#dp').value) };
          try {
            await db('settings').upsert([{ key: 'app', value }]);
            state.settings = value; await local.meta('settings', value);
            toast('Enregistré');
          } catch (e) { toast(e.message, 'err'); }
        };
        $('#pw').onclick = async () => {
          const p = $('#np').value;
          if (p.length < 8) return toast('8 caractères minimum', 'err');
          try { await auth.updatePassword(p); $('#np').value = ''; toast('Mot de passe modifié'); }
          catch (e) { toast(e.message, 'err'); }
        };
        /* La déconnexion efface maintenant vraiment l'appareil — sinon
           le collègue qui se connecte ensuite sur le même téléphone
           ouvre l'application sur les rapports du précédent. Il faut
           donc le dire, et surtout dire ce qui n'est PAS récupérable :
           un brouillon ne part jamais au serveur. */
        $('#out').onclick = async () => {
          const pend = await pendingCount().catch(() => 0);
          const drafts = (await allDrafts().catch(() => [])).length;
          const risque = [
            pend ? `${pend} élément${pend > 1 ? 's' : ''} pas encore envoyé${pend > 1 ? 's' : ''} au serveur` : '',
            drafts ? `${drafts} brouillon${drafts > 1 ? 's' : ''} de saisie` : ''
          ].filter(Boolean).join(' et ');
          const msg = risque
            ? `Cet appareil sera vidé de vos données. ${risque[0].toUpperCase() + risque.slice(1)} ` +
              `${risque.includes(' et ') ? 'seront perdus' : 'sera perdu'} définitivement.`
            : 'Cet appareil sera vidé de vos données. Tout est déjà envoyé au serveur : vous les retrouverez à la reconnexion.';
          if (await confirmSheet('Se déconnecter', msg,
                { okLabel: 'Se déconnecter', danger: !!risque })) logout();
        };
      } });
}
