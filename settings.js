/* Réglages : produits & critères, partenaires, équipe, compte. */

import { state, shell, go, back, loadRefs, logout } from './app.js';
import { local, queue, sync, pendingCount } from './store.js';
import { db, auth } from './supa.js';
import { DEFAULT_GROUPS, DEFAULT_SETTINGS } from './catalog.js';
import { fieldStatus, FIELD_ROLES, fieldRole, effSeverity, flatFields,
         verdictCfg, ripenessBands } from './verdict.js';
import { allDrafts } from './form.js';
import { LANGS, builtinTranslation } from './report-pdf.js';
import { pressureConfig, fmtP, RANGE_TOL, SEV_STEPS, LIMITS, clampP } from './pressure.js';
import { PACKAGING_KINDS, TYPE_LIST, TYPE_IDS, reportType, appliesTo, typesLabel,
         isHidden, fieldLive, normalizeSections } from './report-types.js';
import { $, $$, esc, icon, toast, sheet, confirmSheet, getTheme, setTheme } from './ui.js';

const isAdmin = () => state.profile?.role === 'admin';

export function renderSettings() {
  shell('Réglages', `
    <div class="menu">
      ${isAdmin() ? `
      <button class="menu-item" data-go="#/settings/groups"><span class="ic n">${icon('clipboard')}</span>
        <span class="tx"><b>Produits &amp; critères</b><span>Grilles de contrôle et seuils</span></span><span class="chev">›</span></button>
      <button class="menu-item" data-go="#/settings/partners"><span class="ic n">${icon('truck')}</span>
        <span class="tx"><b>Carnet d'adresses</b><span>${state.partners.length} enregistré${state.partners.length > 1 ? 's' : ''}</span></span><span class="chev">›</span></button>
      <button class="menu-item" data-go="#/settings/users"><span class="ic n">${icon('users')}</span>
        <span class="tx"><b>Équipe</b><span>Valider et gérer les accès</span></span><span class="chev">›</span></button>` : ''}
      <button class="menu-item" id="themeBtn"><span class="ic n">${icon('theme')}</span>
        <span class="tx"><b>Apparence</b><span>${themeLabel()}</span></span><span class="chev">›</span></button>
      <button class="menu-item" data-go="#/settings/account"><span class="ic n">${icon('badge')}</span>
        <span class="tx"><b>Mon compte</b><span>${esc(state.profile?.email || '')}</span></span><span class="chev">›</span></button>
    </div>`,
    { back: () => back('#/'),
      onMount() {
        $$('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));
        $('#themeBtn').onclick = openTheme;
      } });
}

/* ========================== APPARENCE ========================== */
const THEMES = [
  ['auto',  'Automatique', "Suit le réglage du téléphone"],
  ['light', 'Clair',       "Fond blanc, plus lisible en plein jour"],
  ['dark',  'Sombre',      "Moins éblouissant en chambre froide"]
];
const themeLabel = () => THEMES.find(t => t[0] === getTheme())?.[1] || 'Automatique';

function openTheme() {
  sheet('Apparence', `<div class="list">${THEMES.map(([v, name, desc]) => `
    <button class="menu-item" data-t="${v}">
      <span class="ic n">${icon(v === 'auto' ? 'theme' : v === 'dark' ? 'moon' : 'sun')}</span>
      <span class="tx"><b>${name}</b><span>${esc(desc)}</span></span>
      <span class="chev">${getTheme() === v ? '✓' : '›'}</span></button>`).join('')}</div>`,
    { onMount(el, close) {
        el.querySelectorAll('[data-t]').forEach(b => b.onclick = () => {
          setTheme(b.dataset.t);
          close();
          renderSettings();
          toast('Apparence : ' + themeLabel().toLowerCase());
        });
      } });
}


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
  shell('Produits & critères', `
    <div class="card pad" style="margin-bottom:12px">
      <p style="margin:0 0 8px;font-size:13.5px"><b>Une grille par produit.</b> La grille, c'est la liste
      de ce qu'on regarde pendant un contrôle — taches, température, matière sèche — avec, pour chacun,
      à partir de quand ça pose problème.</p>
      <p class="muted" style="margin:0;font-size:12.5px">Ouvrez un produit pour voir sa grille.
      Tout y est modifiable, et chaque modification peut être annulée juste après.</p>
    </div>
    <div class="list">
      ${[...state.groups].sort((a, b) => (a.active === false) - (b.active === false)).map(g => `
        <button class="rep" data-id="${esc(g.id)}">
          <div class="rep-top"><b>${esc(g.config?.icon || '')} ${esc(g.name)}</b>${g.active === false ? '<span class="pill">supprimé</span>' : ''}</div>
          <div class="rep-meta"><span>${(g.config?.sections || []).length} sections</span>
            <span>${(g.config?.sections || []).reduce((n, s) => n + (s.fields || []).length, 0)} critères</span>
            <span>tolérance ${g.config?.tolerance ?? 10} %</span></div>
        </button>`).join('') || '<div class="empty"><div class="big">📦</div><p>Aucun groupe de produit.</p></div>'}
    </div>
    <div class="btn-row" style="margin-top:14px">
      <button class="btn ghost" id="add">${icon('plus')} Nouveau groupe</button>
      <button class="btn ghost" id="restore">Restaurer les grilles par défaut</button>
    </div>`,
    { back: () => back('#/settings'),
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
  sheet('Nouveau groupe de produit', `
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

/* Après un redessin, on rouvre la section sur laquelle on travaillait :
   déplacer un critère d'un cran ne doit pas refermer la grille et
   renvoyer en haut de page. */
function openSection(si) {
  const d = document.querySelector(`details.sec[data-si="${si}"]`);
  if (!d) return;
  d.open = true;
  d.scrollIntoView({ block: 'nearest' });
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
  if (fresh || gridTypeOwner !== id) { gridType = ''; gridTypeOwner = id; }
  /* Remise d'aplomb : une grille où la portée d'un critère sortait de
     celle de sa section produisait une section présente dans aucun
     rapport. La lecture s'en accommode déjà, mais on l'écrit une bonne
     fois pour que le réglage affiché soit celui qui s'applique. */
  if (normalizeSections(g.config?.sections)) saveGroup(g).catch(() => {});
  const cfg = g.config || {};
  const pr = pressureConfig(g);

  shell(g.name, `
    <div class="card pad">
      <div class="row2">
        <div class="field"><label for="nm">Nom</label><input type="text" id="nm" value="${esc(g.name)}"></div>
        <div class="field"><label for="ic">Emoji</label><input type="text" id="ic" maxlength="4" value="${esc(cfg.icon || '')}"></div>
      </div>
      <div class="field"><label for="tol">Tolérance de non-conformité (%)</label>
        <input type="number" id="tol" step="0.5" value="${cfg.tolerance ?? 10}">
        <div class="hint">Au-delà, l'évaluation bascule en « Non Conforme ». 10 % correspond à la catégorie I des normes CEE-ONU.</div></div>
      <div class="field"><label for="vars">Variétés proposées</label>
        <textarea id="vars" style="min-height:64px">${esc((cfg.varieties || []).join(', '))}</textarea>
        <div class="hint">Séparées par des virgules.</div></div>
      <div class="field"><label for="cals">Calibres proposés</label>
        <textarea id="cals" style="min-height:64px">${esc((cfg.calibres || []).join(', '))}</textarea></div>
    </div>

    <div class="card pad" style="margin-top:12px">
      <h3 style="font-size:14.5px;margin-bottom:4px">Protocole de pression</h3>
      <p class="muted" style="margin:0 0 12px">Relevé au pénétromètre, facultatif à la saisie.
      Pour l'avocat : les deux joues de 5 fruits par palette.</p>
      <div class="row3">
        <div class="field"><label for="pf">Fruits / palette</label>
          <input type="number" id="pf" min="1" step="1" value="${pr.fruits}"></div>
        <div class="field"><label for="ps">Mesures / fruit</label>
          <input type="number" id="ps" min="1" step="1" value="${pr.sides}"></div>
        <div class="field"><label for="prf">Référence</label>
          <input type="number" id="prf" step="0.1" min="${LIMITS.min}" max="${LIMITS.max}" value="${pr.ref}"></div>
      </div>
      <div class="hint">La référence sert au bouton de remplissage rapide et à la ligne repère du graphique.
        Le pénétromètre mesure de ${LIMITS.min} à ${LIMITS.max} ${esc(pr.unit)} : les valeurs sont bornées à cet intervalle.</div>
    </div>

    <div class="card pad" style="margin-top:12px">
      <h3 style="font-size:14.5px;margin-bottom:4px">Poids minimum par calibre</h3>
      <p class="muted" style="margin:0 0 12px">Au contrôle production, un fruit pesé sous ce seuil
      est signalé comme sous-calibré. Laissez vide pour ne rien contrôler sur ce calibre.
      Le poids maximum n'est pas vérifié : un fruit plus gros profite au client.</p>
      <div class="wgrid">${weightsHtml(cfg)}</div>
    </div>

    <!-- Les trois indices du rapport reposaient sur des seuils écrits
         dans le code. « Mauvaise à partir de 3 défauts » n'est pas une
         vérité universelle : c'est une décision de l'entreprise, qui
         change d'un produit à l'autre. -->
    <div class="card pad" style="margin-top:12px">
      <h3 style="font-size:14.5px;margin-bottom:4px">Les trois indices du verdict</h3>
      <p class="muted" style="margin:0 0 12px">Qualité, Conservabilité et Évaluation se calculent
        à partir des critères notés. Voici à partir de quand chacun bascule.</p>
      <button class="btn ghost block" id="verdictBtn">${icon('gear')} Régler le barème des indices</button>
      <div class="hint" id="verdictSum" style="margin-top:8px">${verdictSummary(g)}</div>
    </div>

    <h3 style="margin:18px 0 6px;font-size:15px">La grille de contrôle</h3>
    <p class="muted" style="margin:0 0 10px;font-size:12.5px">Les critères sont rangés par section.
      Touchez un critère pour changer son barème ; touchez « Critère » pour en ajouter un.</p>
    <!-- On ne contrôle pas les mêmes choses à l'arrivée d'un conteneur
         et sur une chaîne de conditionnement. Ce filtre montre la
         grille telle qu'elle se présentera pour un type de rapport
         donné ; la restriction se règle critère par critère. -->
    <div class="chips" style="margin-bottom:10px">
      <button class="chip" data-tf="" aria-pressed="${!gridType}">Tous les rapports</button>
      ${TYPE_LIST.map(T => `<button class="chip" data-tf="${T.id}" aria-pressed="${gridType === T.id}">${esc(T.short)}</button>`).join('')}
    </div>
    ${gridType ? `<p class="muted" style="margin:0 0 10px">Grille telle qu'elle apparaîtra
      dans un ${esc(reportType(gridType).title.toLowerCase())}. Ce qui n'y figure pas
      reste affiché en grisé : rien ne disparaît, tout se réaffiche d'une touche.</p>` : ''}
    <!-- Toutes les sections sont TOUJOURS listées, filtre ou pas. Les
         masquer dans la vue filtrée revenait à les rendre
         irrécupérables : une section vide ne pouvait plus recevoir de
         critère, et une section dont la portée contredisait celle de
         ses critères n'apparaissait plus nulle part — ni ici, ni dans
         les rapports. -->
    ${(cfg.sections || []).map((sec, si) => {
      const live = secLive(sec);                       // visible dans la vue courante
      const all  = (sec.fields || []);
      const shown = all.filter(f => fieldLive(sec, f, gridType) || !gridType);
      const count = gridType ? all.filter(f => fieldLive(sec, f, gridType)).length : all.length;
      const last  = (cfg.sections || []).length - 1;
      return `
      <details class="sec${live ? '' : ' off'}" data-si="${si}">
        <summary>${esc(sec.label)} <span class="count">${count}</span>
        ${scopePill(sec, live)} <span class="caret">▾</span></summary>
        <div class="body">
          ${all.map((f, fi) => {
            const fl = fieldLive(sec, f, gridType);
            return `
            <div class="crit${fl ? '' : ' off'}" data-fi="${fi}">
              <span class="ord">
                <button type="button" class="ordb" data-mf="${si}.${fi}.-1"${fi === 0 ? ' disabled' : ''} aria-label="Monter">▲</button>
                <button type="button" class="ordb" data-mf="${si}.${fi}.1"${fi === all.length - 1 ? ' disabled' : ''} aria-label="Descendre">▼</button>
              </span>
              <span class="dot ${sevDot(f)}"></span>
              <span class="lb" data-edit="${si}.${fi}">${esc(f.label)}<small>${describe(f)}</small></span>
              ${scopePill(f, fl, sec)}
              <button type="button" class="ordb wide" data-mask="${si}.${fi}"
                aria-label="${fl ? 'Masquer' : 'Afficher'}">${fl ? '🚫' : '👁'}</button>
            </div>`; }).join('')}
          ${all.length ? '' : `<p class="muted" style="margin:0">Section vide. Touchez « Critère » pour la remplir.</p>`}
          ${count === 0 && all.length && gridType
            ? `<p class="hint" style="margin:8px 0 0">Aucun critère de cette section n'apparaît
               dans un ${esc(reportType(gridType).title.toLowerCase())}.</p>` : ''}
          <div class="btn-row" style="margin-top:10px">
            <span class="ord">
              <button type="button" class="ordb" data-ms="${si}.-1"${si === 0 ? ' disabled' : ''} aria-label="Monter la section">▲</button>
              <button type="button" class="ordb" data-ms="${si}.1"${si === last ? ' disabled' : ''} aria-label="Descendre la section">▼</button>
            </span>
            <button class="btn ghost sm" data-addf="${si}">${icon('plus')} Critère</button>
            <button class="btn ghost sm" data-editsec="${si}">${icon('edit')} Titre &amp; portée</button>
            <button class="btn ghost sm" data-masksec="${si}">${live ? 'Masquer' : 'Afficher'}${
              gridType ? ` ici` : ''}</button>
            <button class="btn ghost sm danger" data-delsec="${si}">Supprimer</button>
          </div>
        </div></details>`; }).join('')}

    <div class="btn-row" style="margin-top:12px">
      <button class="btn ghost" id="addsec">${icon('plus')} Section</button>
      ${g.active === false
        ? '<button class="btn ghost" id="undelg">Remettre en service</button>'
        : '<button class="btn ghost danger" id="delg">Supprimer le groupe</button>'}
    </div>
    <div class="sticky-actions"><button class="btn block" id="save">Enregistrer</button></div>`,
    { back: () => back('#/settings/groups'),
      onMount() {
        /* L'en-tête (nom, tolérance, variétés, calibres, protocole)
           n'était lu qu'au moment d'enregistrer. Or la page se redessine
           à chaque geste — filtre de type, ajout de critère, suppression
           de section — et emportait avec elle tout ce qui venait d'être
           tapé. On recopie donc la saisie dans le groupe au fil de la
           frappe : le redessin repart de valeurs à jour, et « Enregistrer »
           n'a plus qu'à persister. */
        readHeader();
        ['#nm', '#ic', '#tol', '#vars', '#pf', '#ps', '#prf'].forEach(s => {
          const i = $(s); if (i) i.oninput = readHeader;
        });
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
          g.config.pressure = {
            fruits: Math.max(1, num(v('#pf')) ?? pr.fruits),
            sides:  Math.max(1, num(v('#ps')) ?? pr.sides),
            ref:    clampP(v('#prf')) ?? pr.ref,
            unit:   pr.unit
          };
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
          openSection(j);
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
}

/* ==================== BARÈME DES TROIS INDICES ====================
   Écrit en comptages — « à partir de 3 défauts » — et non en points :
   c'est la façon dont un responsable qualité formule sa règle, et il
   doit pouvoir la relire sans traduction. */
function verdictSummary(g) {
  const c = verdictCfg(g);
  const bands = ripenessBands(g).length;
  return `Mauvaise à partir de ${c.quality.badFails} défauts · Minimale à partir de ${c.shelf.lowFails} · ` +
         `${bands ? `${bands} paliers de maturité` : 'aucun palier de maturité'}.`;
}

function editVerdict(g, after) {
  const c = verdictCfg(g);
  const ripeField = flatFields(g).find(f => fieldRole(f) === 'ripeness');
  let bands = structuredClone(ripenessBands(g));

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
        <span>%NC au-delà de la tolérance (${g.config?.tolerance ?? 10} %), ou 1 défaut critique</span></div>
      <div class="srow"><span class="sdot warn"></span><b>Acceptable</b>
        <span>à partir de ${num('eAcc', Math.round((c.eval.acceptable || 0.7) * 100))} % de la tolérance,
        ou 1 défaut</span></div>
      <div class="srow"><span class="sdot ok"></span><b>Conforme</b><span>en dessous</span></div>
    </div>

    <!-- La maturité du lot : c'est elle qui manquait. Un lot relevé à
         4 kg est mûr et ne tiendra pas, que le client l'ait demandé
         ainsi ou non — l'écart à la référence ne le dit pas. -->
    <div class="scale-box" style="margin-top:14px">
      <h4>Maturité du lot, d'après la moyenne des pressions</h4>
      ${ripeField
        ? `<p class="hint" style="margin:0 0 8px">Remplit « ${esc(ripeField.label)} » tout seul,
             et pèse sur la conservabilité. De la plus ferme à la plus mûre.</p>
           <div id="bandRows"></div>`
        : `<p class="hint" style="margin:0">Aucun critère ne porte le rôle
             « Stade de mûrissement » dans cette grille : réglez-le sur un critère de type
             « choix dans une liste » pour activer ce palier.</p>`}
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
          const opts = (ripeField?.options || []).map(o => o.v);
          box.innerHTML = bands.map((b, i) => `
            <div class="band-row" data-b="${i}">
              <span class="bl">à partir de <input type="number" step="0.1" min="${LIMITS.min}"
                max="${LIMITS.max}" data-bm value="${b.min ?? 0}"> ${esc(pressureConfig(g).unit)}</span>
              <select data-bs>${opts.map(o =>
                `<option${o === b.stage ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>
              <span class="bw">${'' /* impact conservabilité */}
                <label>déf. <input type="number" min="0" step="1" data-bf value="${b.fail ?? 0}"></label>
                <label>surv. <input type="number" min="0" step="1" data-bw value="${b.warn ?? 0}"></label></span>
            </div>`).join('') || '<p class="muted" style="margin:0">Aucun palier.</p>';
          box.querySelectorAll('.band-row').forEach(row => {
            const i = +row.dataset.b;
            row.querySelector('[data-bm]').oninput = (e) => { bands[i].min = clampP(e.target.value) ?? 0; };
            row.querySelector('[data-bs]').onchange = (e) => { bands[i].stage = e.target.value; };
            row.querySelector('[data-bf]').oninput = (e) => { bands[i].fail = Math.max(0, Number(e.target.value) || 0); };
            row.querySelector('[data-bw]').oninput = (e) => { bands[i].warn = Math.max(0, Number(e.target.value) || 0); };
          });
        };
        paintBands();

        $$$('#cancel').onclick = () => close();
        $$$('#reset').onclick = async () => {
          if (!(await confirmSheet('Barème par défaut',
                'Les seuils reviennent à ceux livrés avec l\'application.', { okLabel: 'Revenir', danger: false }))) return;
          delete g.config.verdict;
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
          g.config.verdict = {
            quality: { badFails: n('qBad', 3), midFails: n('qMidF', 1), midWarns: n('qMidW', 3) },
            shelf:   { lowFails: n('sLow', 2), midFails: n('sMidF', 1), midWarns: n('sMidW', 2) },
            press: Object.fromEntries(['critique', 'majeur', 'mineur'].map(l =>
              [l, { fail: n('p_' + l + '_f', 0), warn: n('p_' + l + '_w', 0) }])),
            ripeness: { bands: bands.map(b => ({ min: Number(b.min) || 0, stage: b.stage,
                                                 fail: Number(b.fail) || 0, warn: Number(b.warn) || 0 })) },
            eval: { acceptable: Math.min(1, Math.max(0, n('eAcc', 70) / 100)) }
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
      <select id="crole">${Object.entries(FIELD_ROLES).map(([v, w]) =>
        `<option value="${v}"${v === fieldRole(f) ? ' selected' : ''}>${esc(w)}</option>`).join('')}</select>
      <div class="hint">« Contrôlés » et « en défaut » se combinent pour calculer
        automatiquement le taux de non-conformité du rapport.</div></div>

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

        el.querySelectorAll('#kindBox .obtn').forEach(b => b.onclick = () => {
          type = b.dataset.k;
          el.querySelectorAll('#kindBox .obtn').forEach(x =>
            x.setAttribute('aria-pressed', String(x.dataset.k === type)));
          if (!outcomesFor(type).includes(sev)) sev = outcomesFor(type)[0];
          paintScale();
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
            role: $$$('#crole')?.value || undefined,
            i18n: readI18n(el),
            ...d
          };
          /* `step` n'a de sens que sur une mesure chiffrée, et le pas
             d'origine du critère prime sur le pas par défaut. */
          if (type === 'num') out.step = base.step ?? 0.01;
          else delete out.step;
          for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];

          if (fi >= 0) sec.fields[fi] = out; else sec.fields.push(out);
          await saveGroup(g); close(); renderGroupEditor(g.id);
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
  const role = fieldRole(f) ? ` · ${FIELD_ROLES[fieldRole(f)].toLowerCase()}` : '';
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

/* ======================== PARTENAIRES ======================== */
export function renderPartners() {
  const by = (k) => state.partners.filter(p => p.kind === k);
  const block = (title, kind) => `
    <h3 style="margin:16px 0 8px;font-size:15px">${title} <span class="muted">(${by(kind).length})</span></h3>
    <div class="list">${by(kind).map(p => `
      <button class="rep" data-p="${esc(p.id)}">
        <div class="rep-top"><b>${esc(p.name)}</b>${
          refCount(p) ? `<span class="pill n">${refCount(p)} référence${refCount(p) > 1 ? 's' : ''}</span>` : ''}</div>
        <div class="rep-meta">${[p.country, p.email, p.phone].filter(Boolean).map(esc).join(' · ') || '<span>—</span>'}</div>
      </button>`).join('') || '<p class="muted">Aucun pour l\'instant.</p>'}</div>`;

  shell("Carnet d'adresses", `
    ${block('Fournisseurs', 'fournisseur')}
    ${block('Clients', 'client')}
    ${block('Transporteurs', 'transporteur')}
    <div class="btn-row" style="margin-top:16px"><button class="btn ghost block" id="add">${icon('plus')} Ajouter</button></div>`,
    { back: () => back('#/settings'),
      onMount() {
        $$('[data-p]').forEach(b => b.onclick = () => editPartner(state.partners.find(p => p.id === b.dataset.p)));
        $('#add').onclick = () => editPartner(null);
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
  p = p || { id: crypto.randomUUID(), kind: 'fournisseur', name: '', active: true, config: {} };
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

  const card = (u) => `
    <button class="rep" data-u="${esc(u.id)}">
      <div class="rep-top"><b>${esc(u.full_name || u.email)}</b>
        <span class="pill ${u.approved ? 'ok' : 'warn'}">${u.approved ? roleLabel(u.role) : 'à valider'}</span></div>
      <div class="rep-meta"><span>${esc(u.email || '')}</span></div>
    </button>`;

  shell('Équipe', `
    ${waiting.length ? `<h3 style="margin:0 0 8px;font-size:15px">En attente de validation</h3>
      <div class="list">${waiting.map(card).join('')}</div>` : ''}
    <h3 style="margin:${waiting.length ? '18px' : '0'} 0 8px;font-size:15px">Membres actifs</h3>
    <div class="list">${active.map(card).join('') || '<p class="muted">Aucun.</p>'}</div>
    <p class="muted" style="margin-top:16px">Un nouveau collègue crée son compte depuis l'écran de connexion :
    il apparaît ici en attente, et vous lui ouvrez l'accès.</p>`,
    { back: () => back('#/settings'),
      onMount() {
        $$('[data-u]').forEach(b => b.onclick = () => editUser(users.find(u => u.id === b.dataset.u)));
      } });
}

const roleLabel = (r) => ({ admin: 'Administrateur', inspecteur: 'Inspecteur', lecture: 'Lecture seule' }[r] || r);

/* Écrit une modification de profil et VÉRIFIE qu'elle a porté.
   Deux refus possibles, tous deux silencieux côté serveur :
     — aucune ligne renvoyée : la règle de sécurité a écarté la ligne ;
     — ligne renvoyée mais valeurs inchangées : le garde-fou de la base
       annule toute modification du rôle ou de la validation faite par
       quelqu'un qui n'est pas administrateur. Il REMET les anciennes
       valeurs au lieu de lever une erreur, si bien que « pas d'erreur »
       ne voulait pas dire « c'est fait ».
   On compare donc ce qui revient à ce qu'on a demandé. */
async function patchProfile(id, patch) {
  const rows = await db('profiles').eq('id', id).update(patch);
  if (!Array.isArray(rows) || !rows.length)
    throw new Error("Modification refusée : votre compte doit être administrateur.");
  const got = rows[0];
  const raté = Object.keys(patch).filter(k => got[k] !== patch[k]);
  if (raté.length)
    throw new Error("La base a annulé la modification : seul un administrateur peut changer le rôle ou valider un accès.");
  return got;
}

function editUser(u) {
  const me = u.id === state.profile?.id;
  const pending = !u.approved;

  /* Le bouton principal est celui qu'on cherche, et il fait ce qu'il
     annonce. Sur un compte en attente, c'est « Valider l'accès » —
     jusqu'ici c'était « Enregistrer », qui n'écrivait que le rôle :
     sur un collègue déjà inspecteur, la requête ne changeait rien, la
     fenêtre se refermait, et le compte restait bloqué sans un mot. */
  sheet(u.full_name || u.email, `
    <p class="muted" style="margin:0 0 14px">${esc(u.email || '')}</p>
    ${pending && !me ? `<div class="ok-box" style="margin:0 0 14px">
      Ce compte attend votre validation. Choisissez son rôle, puis touchez
      <b>Valider l'accès</b> : il pourra se connecter aussitôt.</div>` : ''}
    <div class="field"><label for="ur">Rôle</label>
      <select id="ur"${me ? ' disabled' : ''}>
        <option value="inspecteur"${u.role === 'inspecteur' ? ' selected' : ''}>Inspecteur — crée et modifie ses rapports</option>
        <option value="lecture"${u.role === 'lecture' ? ' selected' : ''}>Lecture seule — consulte et partage</option>
        <option value="admin"${u.role === 'admin' ? ' selected' : ''}>Administrateur — gère produits, critères et accès</option>
      </select>${me ? '<div class="hint">Vous ne pouvez pas modifier votre propre rôle.</div>' : ''}</div>
    <div class="btn-row">
      <button class="btn ghost" style="flex:1" id="cancel">Fermer</button>
      ${me ? ''
        : pending
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
          toast(`Accès validé · ${roleLabel(role).toLowerCase()} — ${esc(u.full_name || u.email)} peut se connecter`, '', { ms: 5000 });
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
          close(); toast(`Rôle enregistré · ${roleLabel(role).toLowerCase()}`); renderUsers();
        };
      } });
}

/* ========================== MON COMPTE ========================== */
export function renderAccount() {
  shell('Mon compte', `
    <div class="card pad">
      <div class="kv"><span class="k">Nom</span><span class="v">${esc(state.profile?.full_name || '')}</span></div>
      <div class="kv"><span class="k">E-mail</span><span class="v">${esc(state.profile?.email || '')}</span></div>
      <div class="kv"><span class="k">Rôle</span><span class="v">${roleLabel(state.profile?.role)}</span></div>
      <div class="kv"><span class="k">Société</span><span class="v">${esc(state.settings.company)}</span></div>
    </div>
    ${isAdmin() ? `<div class="card pad" style="margin-top:12px">
      <div class="field"><label for="cn">Nom de la société (en-tête des PDF)</label>
        <input type="text" id="cn" value="${esc(state.settings.company)}"></div>
      <div class="field"><label for="dp">Départements / dépôts</label>
        <textarea id="dp" style="min-height:64px">${esc((state.settings.departments || []).join(', '))}</textarea>
        <div class="hint">Séparés par des virgules.</div></div>
      <button class="btn block" id="saveS">Enregistrer</button>
    </div>` : ''}
    <div class="card pad" style="margin-top:12px">
      <div class="field"><label for="np">Nouveau mot de passe</label>
        <input type="password" id="np" minlength="8" placeholder="8 caractères minimum"></div>
      <button class="btn ghost block" id="pw">Changer le mot de passe</button>
    </div>
    <div class="btn-row" style="margin-top:14px">
      <button class="btn ghost block" id="out">${icon('logout')} Se déconnecter</button>
    </div>
    <p class="muted" style="margin-top:18px">Données hébergées chez Supabase, région Paris (eu-west-3).
    Les photos sont privées : leur accès passe par un lien signé, valable une heure.</p>`,
    { back: () => back('#/settings'),
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
