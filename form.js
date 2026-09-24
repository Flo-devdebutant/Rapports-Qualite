/* ------------------------------------------------------------------
   Saisie d'un rapport (réception ou expédition).
   Choix de conception : une seule page avec des sections repliables
   plutôt qu'un assistant pas-à-pas. Un inspecteur ne remplit jamais
   les critères dans l'ordre — il note ce qu'il voit en ouvrant les
   colis — et il doit pouvoir revenir sur une valeur sans reparcourir
   cinq écrans.
   ------------------------------------------------------------------ */

import { state, shell, groupById, go, back, onLeave, openNew } from './app.js';
import { local, queue, sync, forgetPhotos, holdReport, releaseReport } from './store.js';
import { flatFields, computeSummary, applyComputed, fieldRole, PRESSURE_ROLES,
         judgeContext, statusIn, autoFilled,
         VERDICT_STATUS, QUALITY_STATUS, SHELF_STATUS } from './verdict.js';
import { COUNTRIES_FR, countryName } from './countries.js';
import { importJournal, recordsForLot, recentLots, lotModel, lotNumber, journalInfo } from './journal.js';
import { defectTypes, palletDefects, palletUnder, receptionStats, pressureRequired, samplingCfg,
         defectLinkedKeys, fmtPct, KPI_TONE, palletOverCounts, sampleFor } from './reception.js';
import { pressureConfig, palletStats, lotStats, hasPressures, fmtP,
         palletWeighing, calibreMin, needsBox, sizeTableOf, fmtG,
         refSpec, partnerRef, palletSeverity, refText, outOfZone,
         SEV_COLOR, SEV_LABEL, SEV_STEPS, RANGE_TOL, LIMITS, clampP } from './pressure.js';
import { pressureChartSVG } from './pressure-chart.js';
import { reportType, PACKAGING_KINDS, appliesTo, isHidden, fieldLive,
         badPallets, badPalletsText, splitPallets } from './report-types.js';
import { $, $$, esc, icon, toast, confirmSheet, compressImage, stars, pickSheet, sheet } from './ui.js';
import { wireJump } from './reports.js';
import { currentUser, storage } from './supa.js';

let draft = null;          // rapport en cours d'édition
let dirty = false;
let resumed = false;       // saisie reprise d'un brouillon
let paintedCap = null;     // quota de palettes du dernier rendu des pressions

/* Toute modification marque le rapport et programme l'écriture du
   brouillon : c'est ce qui fait qu'on ne perd jamais une saisie. */
const touch = () => { dirty = true; keepDraft(); };

export async function renderForm({ type, id, fresh = false }) {
  resumed = false;
  paintedCap = null;        // on change de rapport : rien n'est encore peint
  if (!state.groups.length) {
    return shell('Rapport', `<div class="empty"><div class="big">📦</div>
      <p>Aucun groupe de produit n'est encore défini.<br>
      Un administrateur ou un responsable doit les créer dans Réglages &gt; Produits &amp; critères.</p></div>`,
      { back: () => back('#/') });
  }
  if (id) {
    draft = await local.get('reports', id);
    if (!draft) { toast('Rapport introuvable', 'err'); return go('#/feed'); }
    draft = structuredClone(draft);
  } else if (!fresh && await draftFor(type)) {
    /* Un contrôle s'interrompt tout le temps : un camion arrive, le
       téléphone s'éteint. La saisie en cours est donc conservée et
       reprise telle quelle — c'est elle qu'on retrouve en rouvrant ce
       type de rapport, pas un formulaire vierge. Un bandeau le dit et
       propose de repartir de zéro : un message fugitif ne suffirait
       pas, on doit pouvoir y revenir deux minutes plus tard. */
    draft = structuredClone(await draftFor(type));
    resumed = true;
  } else {
    const last = await local.meta('lastForm') || {};
    draft = {
      id: crypto.randomUUID(),
      type,
      report_no: null,
      report_date: new Date().toISOString(),
      product_group_id: null,   // fixé juste après, selon le type
      partner_id: null,
      partner_name: '',
      header: { department: last.department || state.settings.departments?.[0] || '' },
      measures: {},
      summary: {},
      remarks: '',
      photos: [],
      inspector_name: state.profile?.full_name || '',
      created_by: currentUser()?.id,
      deleted: false,
      _draft: true              // tant qu'il n'est pas validé, il reste local
    };
    const T = reportType(type);
    const allowed = groupChoices(T);
    draft.product_group_id =
      allowed.find(g => g.id === (T.defaultGroup || last.product_group_id))?.id
      || allowed[0]?.id || null;
  }
  dirty = false;
  paint();
}

/* Groupes de produit ouverts à ce type de rapport. Un groupe désactivé
   dans les réglages ne s'offre plus à la saisie — mais le groupe du
   rapport en cours reste proposé, faute de quoi rouvrir un brouillon
   changerait son produit sous les doigts de l'inspecteur. */
function groupChoices(T) {
  const live = state.groups.filter(g => g.active !== false || g.id === draft?.product_group_id);
  const pool = live.length ? live : state.groups;
  if (!T.groups) return pool;
  const keep = pool.filter(g => T.groups.includes(g.id));
  return keep.length ? keep : pool;
}

function paint() {
  const group = groupById(draft.product_group_id);
  const T = reportType(draft.type);
  const isRec = draft.type === 'reception';
  const choices = groupChoices(T);
  /* Avocat et mangue, à la réception : le contrôle par palette n'est
     plus facultatif. */
  const req = pressureRequired(group, draft.type);
  draft.measures = applyComputed(group, draft.measures, draft.header.pressures, draft.type);
  draft.summary = computeSummary(group, draft.measures, draft.header.pressures, draft.type);
  const s = draft.summary;
  const secs = (group?.config?.sections || []).filter(sec => !isHidden(sec) && appliesTo(sec, draft.type))
    .map(sec => ({ sec, html: sectionHtml(sec) })).filter(x => x.html);
  const nPal = draft.header.pressures?.pallets?.length || 0;

  /* Plan de la saisie : une puce par section, avec ce qui est rempli.
     On y saute d'un appui au lieu de faire défiler vingt critères. */
  const nav = [
    ['sec-general', 'Général', ''],
    ...secs.map(({ sec }) => [gridSecId(sec), sec.label, countOf(sec)]),
    ['prSec', T.weights ? 'Palettes' : 'Pressions', nPal ? String(nPal) : ''],
    ['sec-rem', 'Remarques', ''],
    ['sec-photos', 'Photos', draft.photos.length ? String(draft.photos.length) : '']
  ];

  shell(T.title, `
   <div class="form-wrap">
    <!-- Verdict, calculé en direct : l'inspecteur voit tout de suite
         l'effet de chaque mesure. Sur téléphone, il vit dans la barre du
         bas, à côté d'Enregistrer ; sur ordinateur, en tête de la
         colonne de droite, avec le plan de la saisie. -->
    <aside class="form-side">
      <div class="card pad side-verdict" id="verdict">${verdictHtml(s)}</div>
      <nav class="jump" id="fJump" aria-label="Sections du rapport"><span class="jt">Sections</span>${nav.map(([id, label, n]) =>
        `<a href="#${id}" data-to="${id}" id="nav-${id}">${esc(label)} <span class="n${fullCount(n) ? ' full' : ''}">${esc(n)}</span></a>`).join('')}</nav>
    </aside>
    <div class="form-main">
    ${resumed ? `<div class="resume-box">${icon('clock')}
      <span>Brouillon repris — la saisie s'enregistre au fil de l'eau.</span>
      <button type="button" class="linkish" id="freshStart">Repartir d'un rapport vierge</button>
    </div>` : ''}

    <details class="sec" open id="sec-general">
      <summary>Général ${caret()}</summary>
      <div class="body grid2">
        ${T.journal ? journalBoxHtml() : ''}
        <div class="sub-h">Identification</div>
        <div class="field span2"><label for="fpartner">${T.partnerLabel}</label>
          <input type="text" id="fpartner" list="partnerList" placeholder="Nom du ${T.partnerLabel.toLowerCase()}"
                 value="${esc(draft.partner_name || '')}" autocomplete="off">
          <datalist id="partnerList">${state.partners
            .filter(p => p.kind === T.partnerKind)
            .map(p => `<option value="${esc(p.name)}">`).join('')}</datalist>
          <div class="hint">Un nouveau nom est ajouté au carnet à l'enregistrement.</div></div>

        <div class="row2">
          <div class="field"><label for="fgroup">Produit</label>
            <select id="fgroup">${choices.map(g =>
              `<option value="${esc(g.id)}"${g.id === draft.product_group_id ? ' selected' : ''}>${esc(g.config?.icon || '')} ${esc(g.name)}</option>`).join('')}
            </select></div>
          <div class="field"><label for="fvariety">Variété</label>
            <input type="text" id="fvariety" list="varList" value="${esc(draft.header.variety || '')}">
            <datalist id="varList">${(group?.config?.varieties || []).map(v => `<option value="${esc(v)}">`).join('')}</datalist></div>
        </div>

        <div class="field span2"><label for="fdate">Date du contrôle</label>
          <input type="datetime-local" id="fdate" value="${toLocalInput(draft.report_date)}"></div>

        <!-- À la réception on trace le lot fournisseur ; en expédition
             comme en production, c'est le bon de livraison. Le lot de
             réception, lui, est en tête : c'est lui qui remplit tout. -->
        <div class="row2">
          ${T.journal ? '' : `<div class="field"><label for="flot">${T.refLabel}</label>
            <input type="text" id="flot" value="${esc(draft.header[T.refKey] || '')}"
                   placeholder="${esc(T.refPlaceholder)}"></div>`}
          <div class="field"><label for="fdept">Département / dépôt</label>
            <input type="text" id="fdept" list="deptList" value="${esc(draft.header.department || '')}">
            <datalist id="deptList">${(state.settings.departments || []).map(d => `<option value="${esc(d)}">`).join('')}</datalist></div>
          ${T.journal ? catField(group) : ''}
        </div>
        ${T.journal ? '' : `<div class="row2">${catField(group)}${T.packaging ? `<div class="field"><label for="fpack">Conditionnement</label>
            <select id="fpack"><option value="">—</option>
              ${PACKAGING_KINDS.map(k =>
                `<option${k === draft.header.packaging_kind ? ' selected' : ''}>${esc(k)}</option>`).join('')}
            </select></div>` : ''}</div>`}

        <!-- Un même lot ou BL mélange couramment plusieurs calibres, et
             souvent plusieurs origines : l'origine appartient donc à la
             ligne, pas au rapport. Les totaux de la section
             Palettisation se déduisent de ces lignes, ce qui évite une
             double saisie et permet de désigner précisément l'origine
             ou le calibre en cause dans une réclamation. -->
        <div class="sub-h">Détail du lot</div>
        <div class="field span2">
          <datalist id="calList">${(group?.config?.calibres || []).map(v => `<option value="${esc(v)}">`).join('')}</datalist>
          <div id="calRows"></div>
          <button type="button" class="btn ghost sm" id="calAdd">${icon('plus')} Ajouter une ligne</button>
          <div class="hint" id="calSum"></div>
        </div>

        <div class="sub-h">Transport</div>
        <div class="field span2"><label for="fcarrier">Transporteur</label>
          <input type="text" id="fcarrier" list="carrierList" autocomplete="off"
                 value="${esc(draft.header.carrier || '')}" placeholder="Nom du transporteur">
          <datalist id="carrierList">${state.partners
            .filter(p => p.kind === 'transporteur')
            .map(p => `<option value="${esc(p.name)}">`).join('')}</datalist></div>
        ${T.voyage || isRec ? `
        <!-- Le n° de voyage identifie l'acheminement chez le
             transporteur ; il n'a de sens qu'à l'arrivée. La date du quai
             et le camion, repris du journal, figurent en tête du rapport
             envoyé au fournisseur. -->
        <div class="row2">
          ${T.voyage ? `<div class="field"><label for="fload">N° de Voyage</label>
            <input type="text" id="fload" value="${esc(draft.header.voyage || draft.header.load_id || '')}"></div>` : ''}
          ${isRec ? `<div class="field"><label for="ftruck">N° de camion</label>
            <input type="text" id="ftruck" value="${esc(draft.header.truck || '')}"></div>` : ''}
        </div>` : ''}
        ${isRec ? `<div class="field span2"><label for="farr">Date de réception</label>
            <input type="datetime-local" id="farr" value="${esc((draft.header.arrival || '').slice(0, 16))}"></div>` : ''}

        <!-- Une seule palette ne suffisait pas : un conteneur peut en
             avoir trois de travers, et on ne pouvait en signaler
             qu'une. La saisie accepte donc plusieurs numéros, et le
             NOMBRE se déduit — c'est lui qui pèse dans le résumé, le
             détail servant à nommer les palettes au fournisseur. -->
        <div class="sub-h">Palettes problématiques</div>
        <div class="field span2">
          <input type="text" id="fbad" inputmode="text" autocomplete="off" aria-label="Palettes problématiques"
            value="${esc(badPallets(draft.header).join(', '))}"
            placeholder="N° des palettes en cause, séparés par des virgules">
          <div class="chips" id="badPick" style="margin-top:8px"></div>
          <div class="hint" id="badCount">${badPalletsText(draft.header)}</div></div>
      </div>
    </details>

    ${secs.map(x => x.html).join('')}

    <!-- Le relevé au pénétromètre, palette par palette. Le lot arrive le
         plus souvent homogène à la pression de référence ; le bouton de
         remplissage traite ce cas en un geste et la saisie manuelle sert
         aux palettes qui sortent du lot. -->
    <details class="sec" id="prSec" ${hasPressures(draft.header) || req || draft.header.pressures?.pallets?.length ? 'open' : ''}>
      <summary>${T.weights ? 'Contrôle par palette' : 'Pressions'}${req ? ' <span class="pill sm brand">obligatoire</span>' : ''}
        <span class="count" id="prCount"></span> ${caret()}</summary>
      <div class="body" id="prBody"></div>
    </details>

    <details class="sec" open id="sec-rem">
      <summary>Remarques ${caret()}</summary>
      <div class="body">
        <textarea id="fremarks" aria-label="Remarques" placeholder="Observations libres — reprises telles quelles dans le PDF.">${esc(draft.remarks || '')}</textarea>
      </div>
    </details>

    <details class="sec" open id="sec-photos">
      <summary>Photos <span class="count" id="phCount">${draft.photos.length || ''}</span> ${caret()}</summary>
      <div class="body">
        <div class="photo-grid" id="photos"></div>
        <!-- Deux champs distincts plutôt qu'un seul : sans l'attribut
             « capture » le téléphone ouvre la galerie, avec lui il
             ouvre l'appareil photo, et aucun réglage ne propose les
             deux de façon fiable. Or les deux servent — on photographie
             en contrôlant, et on saisit le rapport ensuite. -->
        <input type="file" id="phCam" accept="image/*" capture="environment" multiple hidden>
        <input type="file" id="phLib" accept="image/*" multiple hidden>
      </div>
    </details>

    </div>
   </div>

    <div class="sticky-actions form-actions">
      <button type="button" class="vmini" id="vMini" aria-label="Détail du verdict">${vMiniHtml(s)}</button>
      <button class="btn ghost" id="cancel">Fermer</button>
      <button class="btn" id="save">${icon('check')} Enregistrer</button>
    </div>`,
    { back: () => leave(), sub: subLine(), onMount: wire });
}

const caret = () => `<span class="caret">${icon('chevD')}</span>`;

const catField = (group) => `<div class="field"><label for="fcat">Catégorie</label>
  <select id="fcat"><option value="">—</option>
    ${(group?.config?.categories || ['Extra','I','II']).map(c =>
      `<option${c === draft.header.category ? ' selected' : ''}>${esc(c)}</option>`).join('')}
  </select></div>`;

/* Sous le titre : de quoi parle ce rapport, et que la saisie est
   gardée. On sait ainsi, en revenant sur l'écran, où l'on en est. */
function subLine() {
  const bits = [draft.partner_name, draft.header.lot ? 'lot ' + draft.header.lot : draft.header.bl ? 'BL ' + draft.header.bl : ''].filter(Boolean);
  if (!draft._draft) return esc(['Modification', draft.report_no ? 'n° ' + draft.report_no : '', ...bits].filter(Boolean).join(' · '));
  return esc([...bits, 'brouillon gardé sur l\'appareil'].filter(Boolean).join(' · '));
}

/* « 3/8 » d'une section, et s'il est complet. */
function countOf(sec) {
  const fs = (sec.fields || []).filter(f => fieldLive(sec, f, draft.type));
  const done = fs.filter(f => draft.measures[f.key] !== undefined && draft.measures[f.key] !== '').length;
  return `${done}/${fs.length}`;
}
const fullCount = (n) => { const m = /^(\d+)\/(\d+)$/.exec(n || ''); return !!m && +m[2] > 0 && m[1] === m[2]; };

/* Met à jour le décompte d'une section : son en-tête et sa puce du plan. */
function setCount(secEl, text) {
  const c = secEl?.querySelector(':scope > summary .count');
  if (c) { c.textContent = text; c.classList.toggle('full', fullCount(text)); }
  const n = secEl?.id ? document.querySelector(`#nav-${CSS.escape(secEl.id)} .n`) : null;
  if (n) { n.textContent = text; n.classList.toggle('full', fullCount(text)); }
}

/* Le verdict complet : colonne de droite sur ordinateur, feuille sur
   téléphone (appui sur la vignette de la barre du bas). */
function verdictHtml(s) {
  if (s.pending) {
    return `<div class="card-h" style="margin-bottom:6px"><h3>Verdict</h3></div>
      <div class="muted" style="display:flex;align-items:center;gap:10px"><span class="dot none"></span>
      Il apparaîtra ici dès la première mesure saisie.</div>`;
  }
  const d = (cls) => `<span class="dot ${cls || 'none'}"></span>`;
  const st = VERDICT_STATUS[s.verdict] || '';
  return `<div class="vfull">
    <div class="card-h" style="margin-bottom:10px"><h3>Verdict</h3>${stars(s.stars)}</div>
    <div class="verdict ${st}" style="margin-top:0">${d(st)}<span class="vt"><b>${esc(s.verdict)}</b>
      <span>%NC ${s.nc == null ? '—' : s.nc + ' %'} · tolérance ${s.tolerance} %</span></span></div>
    <div class="vgrid" style="margin-top:10px">
      <div><span>Qualité</span><b>${d(QUALITY_STATUS[s.quality])}${esc(s.quality || '—')}</b></div>
      <div><span>Conservabilité</span><b>${d(SHELF_STATUS[s.shelf])}${esc(s.shelf || '—')}</b></div>
    </div>
    <div class="vline"><span>${s.fails} hors seuil</span><span>· ${s.warns} à surveiller</span></div>
  </div>`;
}

/* La vignette de la barre du bas : le mot du verdict et le %NC. */
function vMiniHtml(s) {
  if (s.pending) return `<span class="dot none"></span><span class="tx"><b>Verdict</b><small>à la première mesure</small></span>`;
  const st = VERDICT_STATUS[s.verdict] || '';
  return `<span class="dot ${st || 'none'}"></span><span class="tx"><b>${esc(s.verdict)}</b><small>${
    esc([`%NC ${s.nc == null ? '—' : s.nc + ' %'}`, s.quality, s.shelf].filter(Boolean).join(' · '))}</small></span>`;
}

function sectionHtml(sec) {
  /* Une section peut ne garder qu'une partie de ses critères selon le
     type de rapport ; le décompte doit suivre, sinon « 0/12 » sur une
     section qui n'en montre que trois. */
  const fields = (sec.fields || []).filter(f => fieldLive(sec, f, draft.type));
  if (!fields.length) return '';
  const n = countOf(sec);
  const ctx = formCtx();
  return `<details class="sec"${/^0\//.test(n) ? '' : ' open'} id="${esc(gridSecId(sec))}" data-sec="${esc(sec.id)}">
    <summary>${esc(sec.label)} <span class="count${fullCount(n) ? ' full' : ''}">${n}</span> ${caret()}</summary>
    <div class="body crits">${fields.map(f => fieldHtml(f, ctx)).join('')}</div>
  </details>`;
}

/* Identifiant d'une section de la grille dans la page. Préfixe distinct
   de celui des blocs fixes (sec-general, sec-rem, sec-photos) : une
   section nommée « Photos » ou « Général » par un administrateur aurait
   sinon pris l'identifiant du bloc du même nom. */
const gridSecId = (sec) => 'grid-' + String(sec.id || '').replace(/[^\w-]/g, '_');

/* Contexte de jugement du rapport en cours : le même que celui du
   verdict. Une pastille calculée à part pouvait afficher un défaut que
   le verdict, lui, ne comptait pas. */
const formCtx = (group = groupById(draft.product_group_id)) =>
  judgeContext(group, draft.header.pressures, draft.type);

/* Une liste courte se choisit d'une touche, en puces ; une liste longue
   garde son menu déroulant. Un menu, c'est deux gestes et un défilement
   pour « Bonne / Acceptable / Mauvaise » — dix fois par rapport. */
const asChips = (f) => (f.options || []).length <= 6 &&
  (f.options || []).reduce((n, o) => n + String(o.v).length, 0) <= 90;

function fieldHtml(f, ctx = formCtx()) {
  const v = draft.measures[f.key];
  const st = statusIn(ctx, f, v);
  const dot = `<span class="dot ${st || 'none'}" data-dot="${esc(f.key)}"></span>`;
  /* Dureté et stade de mûrissement se déduisent du contrôle par
     palette : on le dit, et on verrouille la saisie tant que des
     pressions sont relevées. Un champ qu'on peut taper mais qui se
     réécrit à la mesure suivante est pire qu'un champ fermé. Le stade
     n'est verrouillé que si une échelle permet de le déduire : sinon
     il reste à saisir. */
  const auto = autoFilled(groupById(draft.product_group_id), f, draft.header.pressures, draft.type);
  const hint = auto ? '<small>Repris du contrôle par palette</small>'
                    : (f.hint ? `<small>${esc(f.hint)}</small>` : '');
  const label = `<span class="lb">${esc(f.label)}${hint}</span>`;

  if (f.type === 'bool') {
    return `<div class="crit" data-key="${esc(f.key)}">${dot}${label}
      <span class="in yn-in"><span class="seg yn">
        <button type="button" data-v="1" aria-pressed="${v === true}">Conforme</button>
        <button type="button" data-v="0" aria-pressed="${v === false}">Non</button>
      </span></span></div>`;
  }
  if (f.type === 'choice') {
    if (asChips(f)) {
      return `<div class="crit wide" data-key="${esc(f.key)}">${dot}${label}
        <span class="in"><span class="choice" role="group" aria-label="${esc(f.label)}">${f.options.map(o =>
          `<button type="button" class="chip" data-c="${esc(o.v)}" aria-pressed="${o.v === v}"${auto ? ' disabled' : ''}>${esc(o.v)}</button>`).join('')}
        </span></span></div>`;
    }
    return `<div class="crit wide" data-key="${esc(f.key)}">${dot}${label}
      <span class="in"><select${auto ? ' disabled' : ''} aria-label="${esc(f.label)}"><option value="">—</option>
        ${f.options.map(o => `<option value="${esc(o.v)}"${o.v === v ? ' selected' : ''}>${esc(o.v)}</option>`).join('')}
      </select></span></div>`;
  }
  const computed = !!f.computed;
  /* L'unité vit dans la case, à droite du chiffre : « 12 % », « 4,2 °C ». */
  return `<div class="crit" data-key="${esc(f.key)}">${dot}${label}
    <span class="in${f.unit ? ' u' : ''}"><input type="number" inputmode="decimal" step="${f.step || 0.01}" enterkeyhint="next"
      value="${v ?? ''}" placeholder="—" aria-label="${esc(f.label)}"${computed ? ' data-computed="1"' : ''}${
      auto ? ' readonly data-auto="1"' : ''}>${f.unit ? `<i>${esc(f.unit)}</i>` : ''}</span></div>`;
}

/* --------------------------- interactions --------------------------- */
function wire() {
  const set = (k, v) => { draft.header[k] = v; touch(); };

  /* Un champ date vidé pour être retapé donnait `new Date('')` —
     `toISOString` levait, et `touch()` n'était jamais atteint : la
     saisie n'était plus marquée modifiée et le brouillon ne se
     réécrivait pas. On garde la date précédente le temps que la
     nouvelle soit complète. */
  $('#fdate').onchange   = (e) => {
    const d = new Date(e.target.value);
    if (!isNaN(d)) draft.report_date = d.toISOString();
    touch();
  };
  /* Choisir le client applique sa référence de pression sans autre
     geste — c'est tout l'intérêt du carnet. La saisie manuelle garde
     toujours la priorité, et un client sans référence enregistrée
     laisse simplement le réglage du produit. */
  $('#fpartner').oninput = (e) => {
    draft.partner_name = e.target.value; touch();
    if (draft.header.pressures && applyClientRef()) paintPressures();
  };
  $('#fdept').oninput    = (e) => set('department', e.target.value);
  $('#fvariety').oninput = (e) => set('variety', e.target.value);
  paintCalibres();
  $('#calAdd').onclick = () => {
    /* La nouvelle ligne hérite de l'origine de la précédente : sur un
       lot à deux origines et six calibres, cela évite de la resaisir. */
    const rows = lotLines();
    rows.push({ o: rows[rows.length - 1]?.o || '', c: '', pal: '', col: '' });
    touch(); paintCalibres();
  };
  $('#fcarrier').oninput = (e) => set('carrier', e.target.value);
  const loadEl = $('#fload');
  if (loadEl) loadEl.oninput = (e) => set('voyage', e.target.value);
  $('#flot').oninput     = (e) => {
    set(reportType(draft.type).refKey, e.target.value);
    /* Le n° de lot suffit : les palettes du journal arrivent seules.
       On attend la fin de la frappe — « 1688 » n'est pas « 16886 ». */
    if (reportType(draft.type).journal) {
      clearTimeout(lotTimer);
      lotTimer = setTimeout(() => tryLot(e.target.value), 450);
    }
  };
  if (reportType(draft.type).journal) wireJournal();
  const arrEl = $('#farr');
  if (arrEl) arrEl.onchange = (e) => set('arrival', e.target.value);
  const truckEl = $('#ftruck');
  if (truckEl) truckEl.oninput = (e) => set('truck', e.target.value);

  /* Palettes problématiques : saisie libre, normalisée à la sortie du
     champ, et rappel des palettes déjà contrôlées pour les désigner
     d'une touche — celles hors référence en tête, ce sont les
     candidates naturelles. */
  const bad = $('#fbad');
  if (bad) {
    bad.oninput = () => { setBad(splitPallets(bad.value)); paintBadPick(); paintFlags(); };
    bad.onblur  = () => { bad.value = badPallets(draft.header).join(', '); };
    paintBadPick();
  }
  const packEl = $('#fpack');
  if (packEl) packEl.onchange = (e) => {
    set('packaging_kind', e.target.value);
    /* Le cahier des charges d'un client dépend souvent du
       conditionnement : une barquette ne se vend pas à la même
       fermeté qu'un vrac. */
    if (draft.header.pressures && applyClientRef()) paintPressures();
  };
  $('#fcat').onchange    = (e) => set('category', e.target.value);
  $('#fremarks').oninput = (e) => { draft.remarks = e.target.value; touch(); };

  $('#fgroup').onchange = async (e) => {
    const dirtyData = Object.keys(draft.measures).length || draft.header.pressures?.pallets?.length;
    if (dirtyData && !(await confirmSheet(
        'Changer de produit',
        'Les mesures déjà saisies ne correspondent plus à cette grille de critères. Les effacer ?',
        { okLabel: 'Changer' }))) { e.target.value = draft.product_group_id; return; }
    draft.product_group_id = e.target.value;
    draft.measures = {};
    /* Le protocole de pression change avec le produit — 5 fruits pour
       l'avocat, 3 pour la mangue : garder les anciennes palettes
       laisserait une grille au mauvais format. */
    delete draft.header.pressures;
    touch();
    paint();
  };

  /* Champs notés */
  $$('.crit').forEach(row => {
    const key = row.dataset.key;
    const field = flatFields(groupById(draft.product_group_id), draft.type).find(f => f.key === key);
    if (!field) return;

    const input = row.querySelector('input[type=number]');
    if (input) input.oninput = () => {
      const raw = input.value;
      draft.measures[key] = raw === '' ? '' : Number(raw);
      if (input.dataset.computed) draft.measures['_manual_' + key] = raw !== '';
      touch();
      refresh(key);
    };

    const sel = row.querySelector('select');
    if (sel) sel.onchange = () => { draft.measures[key] = sel.value; touch(); refresh(key); };

    /* Choix en puces : un appui choisit, un second appui efface. */
    row.querySelectorAll('.choice [data-c]').forEach(b => b.onclick = () => {
      const val = b.dataset.c;
      draft.measures[key] = draft.measures[key] === val ? '' : val;
      row.querySelectorAll('.choice [data-c]').forEach(x =>
        x.setAttribute('aria-pressed', String(x.dataset.c === draft.measures[key])));
      touch(); refresh(key);
    });

    row.querySelectorAll('.seg.yn button').forEach(b => b.onclick = () => {
      const val = b.dataset.v === '1';
      draft.measures[key] = draft.measures[key] === val ? '' : val;
      row.querySelectorAll('.seg.yn button').forEach(x =>
        x.setAttribute('aria-pressed', String(draft.measures[key] === (x.dataset.v === '1'))));
      touch(); refresh(key);
    });
  });

  paintPressures();
  paintPhotos();
  const onPick = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    /* Au-delà de MAX_PHOTOS, le PDF (toutes les photos, en pleine
       définition) deviendrait trop lourd pour un e-mail. On le dit, avec
       le nombre de photos laissées de côté. */
    const room = MAX_PHOTOS - draft.photos.length;
    if (files.length > room) {
      toast(room > 0 ? `${MAX_PHOTOS} photos maximum par rapport : ${files.length - room} photo${files.length - room > 1 ? 's' : ''} non ajoutée${files.length - room > 1 ? 's' : ''}`
                     : `${MAX_PHOTOS} photos maximum par rapport`, 'err', { ms: 5000 });
      files.length = Math.max(0, room);
    }
    for (const file of files) {
      /* Une photo illisible ne doit pas partir en silence : elle
         finirait dans un PDF client sous forme de page blanche. */
      let blob;
      try { blob = await compressImage(file); }
      catch (e) { toast(e.message, 'err'); continue; }
      const localId = crypto.randomUUID();
      await local.put('photos', { id: localId, blob });
      draft.photos.push({ localId, path: `${draft.id}/${localId}.jpg`, uploaded: false, at: Date.now() });
      touch();
    }
    paintPhotos();
  };
  $('#phCam').onchange = onPick;
  $('#phLib').onchange = onPick;

  const fs = $('#freshStart');
  if (fs) fs.onclick = async () => {
    if (!(await confirmSheet('Repartir de zéro',
          'Le brouillon en cours sera supprimé et le formulaire repart vide.', { okLabel: 'Repartir' }))) return;
    const id = draft.id, type = draft.type;
    /* Les photos partent avec le brouillon : sans cela, leurs binaires
       restaient en base locale jusqu'à une synchronisation réussie qui
       n'arrive jamais sur un appareil durablement hors réseau. */
    await forgetPhotos((draft.photos || []).map(p => p.localId));
    await local.del('reports', id);
    dirty = false; draft = null;
    renderForm({ type, fresh: true });
  };

  $('#cancel').onclick = () => leave();
  $('#save').onclick = save;
  $('#vMini').onclick = () => sheet('', verdictHtml(draft.summary));
  wireJump('fJump', '.form-main > details.sec');

  /* Quitter l'écran par le rail, le bouton retour du téléphone ou la
     feuille « Nouveau » : la dernière frappe (moins de 600 ms) part
     quand même dans le brouillon. */
  onLeave(() => { keepDraftNow(); });

  /* Un rapport déjà enregistré n'a pas de brouillon où se replier : le
     rail de l'ordinateur pose la même question que la flèche retour. */
  document.querySelector('.rail')?.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"], [data-new]');
    if (!a || !dirty || draft?._draft) return;
    e.preventDefault(); e.stopPropagation();
    confirmSheet('Quitter sans enregistrer', 'Ce rapport est déjà enregistré : les modifications en cours seront perdues.',
      { okLabel: 'Quitter' }).then(yes => {
        if (!yes) return;
        dirty = false;
        if (a.hasAttribute('data-new')) openNew(); else location.hash = a.getAttribute('href');
      });
  }, true);

  let raf = 0;
  const onScroll = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; spyPallets(); }); };
  window.addEventListener('scroll', onScroll, { passive: true });
  onLeave(() => window.removeEventListener('scroll', onScroll));

  /* Au clavier, Entrée passe au critère suivant, comme « Suivant » sur
     un téléphone : on remplit une grille sans lâcher le clavier. */
  $('.form-main').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target.matches('.crit input[type=number]')) return;
    e.preventDefault();
    const all = $$('.form-main .crit input[type=number]:not([readonly])').filter(x => x.offsetParent);
    const next = all[all.indexOf(e.target) + 1];
    if (next) { next.focus(); next.select?.(); } else e.target.blur();
  });
}

/* --------------------- journal des arrivages ---------------------
   Le journal de l'ERP se dépose ici — bouton sur téléphone, glisser-
   déposer sur ordinateur. Il reste sur cet appareil (rien ne part sur
   le serveur) et chaque import remplace le précédent. Ensuite, le n° de
   lot suffit : fournisseur, voyage, camion, date d'arrivée, détail du
   lot et une ligne par palette (n° réel, variété, colis, calibre,
   GGN…) se remplissent. */
let lotTimer = null;

function journalBoxHtml() {
  return `<div class="field span2 jr-box">
    <label for="flot">N° de lot</label>
    <div class="jr-row">
      <input type="text" id="flot" list="lotList" autocomplete="off" inputmode="text"
        value="${esc(draft.header.lot || '')}" placeholder="ex. 16886">
      <button type="button" class="btn ghost sm" id="jPick">${icon('excel')} Journal</button>
    </div>
    <datalist id="lotList"></datalist>
    <input type="file" id="jFile" hidden
      accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">
    <div class="hint" id="jInfo"></div>
  </div>`;
}

function wireJournal() {
  const pick = $('#jPick'), file = $('#jFile');
  if (pick && file) {
    pick.onclick = () => file.click();
    file.onchange = () => { const f = file.files?.[0]; file.value = ''; if (f) importFile(f); };
  }
  const wrap = document.querySelector('.form-wrap');
  if (wrap) {
    wrap.addEventListener('dragover', (e) => {
      if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
      e.preventDefault(); wrap.classList.add('dropping');
    });
    wrap.addEventListener('dragleave', (e) => { if (!wrap.contains(e.relatedTarget)) wrap.classList.remove('dropping'); });
    wrap.addEventListener('drop', (e) => {
      const f = e.dataTransfer?.files?.[0];
      wrap.classList.remove('dropping');
      if (!f) return;
      e.preventDefault();
      if (/\.(xlsx|csv)$/i.test(f.name) || /sheet|csv|excel/i.test(f.type)) importFile(f);
      else toast('Déposez ici le journal des arrivages (.xlsx ou .csv).', 'err');
    });
  }
  paintJournalInfo();
}

const fmtDay = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '');
const fmtWall = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}${s.length > 10 ? ' à ' + s.slice(11, 16) : ''}` : '');

async function paintJournalInfo() {
  const box = $('#jInfo');
  if (!box) return;
  let lots = [];
  try { lots = await recentLots(80); } catch (e) { lots = []; }
  const dl = $('#lotList');
  if (dl) dl.innerHTML = lots.map(l => `<option value="${esc(l.lot)}">${
    esc([l.supplier, `${l.n} pal.`, fmtDay(l.day)].filter(Boolean).join(' · '))}</option>`).join('');
  const imp = draft.header.import;
  if (imp?.lot && imp.lot === lotNumber(draft.header.lot)) {
    box.innerHTML = `<span class="ok-note">${icon('check')} Lot ${esc(imp.lot)} : ${imp.n} palette${imp.n > 1 ? 's' : ''}
      reprise${imp.n > 1 ? 's' : ''} du journal des arrivages.</span>
      <button type="button" class="linkish" id="jRefill">Relire le journal</button>`;
    $('#jRefill').onclick = () => tryLot(draft.header.lot, { force: true });
    return;
  }
  const info = await journalInfo().catch(() => null);
  box.textContent = lots.length
    ? `Journal${info?.at ? ` importé le ${new Date(info.at).toLocaleDateString('fr-FR')}` : ''} sur cet appareil : ${
        lots.length} lot${lots.length > 1 ? 's' : ''}. ` +
      'Tapez le n° de lot : les palettes se remplissent seules.'
    : "Importez le journal des arrivages (fichier .xlsx de l'ERP), puis tapez le n° de lot : " +
      'les palettes se remplissent seules. Sur ordinateur, vous pouvez aussi glisser le fichier sur le formulaire.';
}

async function importFile(file) {
  const btn = $('#jPick');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span>'; }
  try {
    const info = await importJournal(file);
    toast(`Journal importé : ${info.rows} palettes, ${info.lots} lots${
      info.missing?.length ? ` — colonnes absentes : ${info.missing.join(', ')}` : ''}`, '', { ms: 5000 });
    if (lotNumber(draft.header.lot)) await tryLot(draft.header.lot, { force: true });
    else { await paintJournalInfo(); $('#flot')?.focus(); }
  } catch (e) {
    toast(e.message || 'Journal illisible', 'err', { ms: 7000 });
  } finally {
    const b = $('#jPick');
    if (b) { b.disabled = false; b.innerHTML = `${icon('excel')} Journal`; }
  }
}

async function tryLot(raw, { force = false } = {}) {
  const lot = lotNumber(raw);
  if (!lot || lot.length < 3) return paintJournalInfo();
  if (!force && draft.header.import?.lot === lot) return paintJournalInfo();
  const rows = await recordsForLot(lot);
  /* La frappe a continué pendant la recherche : ce résultat est
     périmé, le suivant arrive. */
  if (lotNumber($('#flot')?.value ?? draft.header.lot) !== lot) return;
  if (!rows.length) {
    const box = $('#jInfo');
    if (box) box.textContent = (await journalInfo().catch(() => null))
      ? `Lot ${lot} absent du journal importé. Importez un journal plus récent, ou remplissez le rapport à la main.`
      : "Aucun journal sur cet appareil : importez le journal des arrivages (bouton « Journal »), puis retapez le n° de lot.";
    return;
  }
  await applyLot(lotModel(rows, state.groups, draft.product_group_id));
}

const measuredPallet = (pl) =>
  (pl.v || []).some(v => v !== '' && v != null) || (pl.w || []).some(v => v !== '' && v != null) ||
  Object.values(pl.d || {}).some(v => v !== '' && v != null);

async function applyLot(model) {
  if (!model) return;
  const T = reportType(draft.type);
  const allowed = groupChoices(T).map(g => g.id);
  const target = model.groupId && allowed.includes(model.groupId) ? model.groupId : draft.product_group_id;
  const names = new Set(model.pallets.map(x => String(x.n)));
  const cur = draft.header.pressures?.pallets || [];
  /* Des mesures déjà prises sur des palettes absentes du lot : on ne
     les écrase pas sans le demander. Celles qui portent le même n°
     gardent leurs relevés. */
  const orphans = cur.filter(pl => measuredPallet(pl) && !names.has(String(pl.n)));
  const lossy = orphans.length || (target !== draft.product_group_id && cur.some(measuredPallet));
  if (lossy && !(await confirmSheet('Remplacer les palettes',
      `Des palettes déjà mesurées ne font pas partie du lot ${model.lot}. ` +
      `Les remplacer par les ${model.pallets.length} palettes du journal ?`, { okLabel: 'Remplacer' }))) return;

  const before = structuredClone(draft);
  if (target !== draft.product_group_id) {
    /* Le protocole de pression suit le produit (5 fruits pour
       l'avocat, 3 pour la mangue) : l'ancien bloc est refait. */
    draft.product_group_id = target;
    delete draft.header.pressures;
  }
  const h = draft.header;
  if (model.supplier) draft.partner_name = model.supplier;
  h.lot = model.lot;
  if (model.voyage) h.voyage = model.voyage;
  if (model.arrival) h.arrival = model.arrival.slice(0, 16);
  if (model.truck) h.truck = model.truck;
  if (model.variety) h.variety = model.variety;
  if (model.category) h.category = model.category;
  h.calibres = model.calibres.map(l => ({ o: l.o, c: l.c, pal: l.pal, col: l.col }));
  h.import = { lot: model.lot, n: model.pallets.length, at: new Date().toISOString(), subs: model.subs };

  const p = pressures();
  const n = slots(p);
  const old = new Map((p.pallets || []).map(x => [String(x.n), x]));
  p.pallets = model.pallets.map(mp => {
    const o = old.get(String(mp.n));
    return {
      ...mp,
      v: o?.v || Array.from({ length: n }, () => ''),
      w: o?.w || Array.from({ length: p.fruits }, () => ''),
      d: o?.d || {},
      ...(o?.chk != null && o.chk !== '' ? { chk: o.chk } : {}),
      ...(o?.cut != null && o.cut !== '' ? { cut: o.cut } : {})
    };
  });
  const keep = badPallets(h).filter(x => names.has(x));
  h.bad_pallets = keep; h.bad_pallet = keep.join(', ');

  touch();
  paint();
  toast(`Lot ${model.lot} : ${model.pallets.length} palette${model.pallets.length > 1 ? 's' : ''} reprise${
    model.pallets.length > 1 ? 's' : ''} du journal`, '', {
    action: 'Annuler', onAction: () => { draft = before; touch(); paint(); } });
}

/* -------------------------- détail du lot --------------------------
   Chaque ligne = une origine, un calibre, et ce qu'ils représentent en
   palettes et colis. Les rapports antérieurs n'avaient qu'un couple
   origine/calibre au niveau de l'en-tête : on le reprend tel quel pour
   qu'ils restent ouvrables et modifiables. */
function lotLines() {
  if (!Array.isArray(draft.header.calibres)) {
    draft.header.calibres = (draft.header.calibre || draft.header.origin)
      ? [{ o: (draft.header.origin || '').toUpperCase(), c: draft.header.calibre || '', pal: '', col: '' }]
      : [{ o: '', c: '', pal: '', col: '' }];
  }
  return draft.header.calibres;
}

/* Origine et calibre passent par un sélecteur avec recherche : la
   liste des pays en compte cinquante-sept, et celle des calibres
   autant que le produit en déclare. Le bouton montre la valeur
   retenue, la recherche fait le reste. */
const originLabel = (code) => COUNTRIES_FR.find(c => c.code === (code || '').toUpperCase())?.fr || '';

function pickOrigin(i) {
  const rows = lotLines();
  pickSheet('Origine', COUNTRIES_FR.map(c => ({ v: c.code, label: c.fr, hint: c.code })), {
    value: (rows[i].o || '').toUpperCase(),
    placeholder: 'Pays (Pérou, Maroc…)',
    onPick: (v) => { rows[i].o = v; touch(); paintCalibres(); }
  });
}

function pickLotCalibre(i) {
  const rows = lotLines();
  const all = groupById(draft.product_group_id)?.config?.calibres || [];
  pickSheet('Calibre', all.map(c => ({ v: c, label: c })), {
    value: rows[i].c || '', allowFree: true, placeholder: 'Calibre (16, 18, A…)',
    onPick: (v) => { rows[i].c = v; touch(); paintCalibres(); }
  });
}

function paintCalibres() {
  const box = $('#calRows');
  if (!box) return;
  const rows = lotLines();
  /* Les libellés sont répétés sur chaque ligne : une fois les champs
     remplis, les textes indicatifs disparaissent et quatre valeurs
     côte à côte ne se distinguent plus. */
  box.innerHTML = rows.map((r, i) => `
    <div class="cal-row" data-i="${i}">
      <span class="lot-f"><label>Origine</label>
        <button type="button" class="picker" data-pick="o">${
          r.o ? esc(originLabel(r.o) || r.o) : '<i>Choisir…</i>'}</button></span>
      <span class="lot-f"><label>Calibre</label>
        <button type="button" class="picker" data-pick="c">${
          r.c ? esc(r.c) : '<i>Choisir…</i>'}</button></span>
      <button type="button" class="icon-btn" aria-label="Retirer cette ligne" data-del>${icon('x')}</button>
      <span class="lot-f"><label>Palettes</label>
        <input type="number" inputmode="decimal" step="0.01" value="${r.pal ?? ''}" data-f="pal"></span>
      <span class="lot-f"><label>Colis</label>
        <input type="number" inputmode="numeric" step="1" value="${r.col ?? ''}" data-f="col"></span>
    </div>`).join('');

  box.querySelectorAll('.cal-row').forEach(row => {
    const i = +row.dataset.i;
    row.querySelector('[data-pick="o"]').onclick = () => pickOrigin(i);
    row.querySelector('[data-pick="c"]').onclick = () => pickLotCalibre(i);
    row.querySelectorAll('[data-f]').forEach(inp => {
      const f = inp.dataset.f;
      /* Origine et calibre passent par le sélecteur cherchable : les
         seuls champs câblés ici sont numériques. */
      const handler = () => {
        rows[i][f] = inp.value === '' ? '' : Number(inp.value);
        touch();
        syncCalibreTotals();
      };
      if (inp.tagName === 'SELECT') inp.onchange = handler; else inp.oninput = handler;
    });
    row.querySelector('[data-del]').onclick = () => {
      rows.splice(i, 1);
      if (!rows.length) rows.push({ o: '', c: '', pal: '', col: '' });
      touch();
      paintCalibres();
      syncCalibreTotals();
    };
  });
  syncCalibreTotals();
}

/* Reporte la somme des lignes dans Palettisation, sauf si l'inspecteur
   n'a rempli aucun détail — auquel cas il saisit les totaux lui-même. */
function syncCalibreTotals() {
  const rows = lotLines();
  /* Champs dérivés, conservés pour la recherche, les exports et la
     compatibilité des rapports existants. */
  draft.header.calibre = [...new Set(rows.map(r => r.c).filter(Boolean))].join(', ');
  draft.header.origins = [...new Set(rows.map(r => (r.o || '').toUpperCase()).filter(Boolean))];
  draft.header.origin  = draft.header.origins.join(', ');

  const sum = (f) => rows.reduce((t, r) => {
    const n = Number(r[f]);
    return isFinite(n) && r[f] !== '' ? t + n : t;
  }, 0);
  const hasPal = rows.some(r => r.pal !== '' && r.pal != null);
  const hasCol = rows.some(r => r.col !== '' && r.col != null);

  /* Le total suit les lignes dans les deux sens : effacer la dernière
     ligne qui annonçait des palettes doit effacer le total, sinon la
     Palettisation continuait d'afficher 4 palettes pour un détail de
     lot devenu vide. */
  if (hasPal) draft.measures.pal_count = Math.round(sum('pal') * 100) / 100;
  else delete draft.measures.pal_count;
  if (hasCol) draft.measures.col_count = sum('col');
  else delete draft.measures.col_count;

  const hint = $('#calSum');
  if (hint) {
    const parts = [];
    if (hasPal) parts.push(`${sum('pal')} palette${sum('pal') > 1 ? 's' : ''}`);
    if (hasCol) parts.push(`${sum('col')} colis`);
    hint.textContent = parts.length
      ? `Total reporté dans Palettisation : ${parts.join(' · ')}.`
      : "Palettes et colis sont facultatifs par ligne ; laissez vide pour ne saisir que les totaux plus bas.";
  }
  /* Répercuter dans les champs visibles de la section Palettisation,
     qui ne sont pas des champs « calculés » du catalogue. */
  for (const key of ['pal_count', 'col_count']) {
    const inp = document.querySelector(`.crit[data-key="${key}"] input`);
    if (inp) inp.value = draft.measures[key] ?? '';
  }
  refresh('pal_count');

  /* Le quota de palettes vient d'ici : quand il bouge, c'est toute la
     section « contrôle par palette » qui doit se remettre à jour —
     plafond du bouton « Palette », calibres proposés, décompte des
     restantes et avertissement de dépassement. Ne rafraîchir que le
     nombre attendu laissait passer un rapport contrôlant 4 palettes
     pour 2 annoncées, sans le moindre signal. */
  /* On compare au quota qui a servi au DERNIER rendu, pas à une valeur
     relue à l'instant : le gestionnaire de saisie a déjà écrit dans le
     détail du lot avant d'arriver ici, si bien qu'une comparaison
     recalculée trouvait toujours les deux valeurs identiques et ne
     rafraîchissait jamais rien. */
  if (palletCap() !== paintedCap && draft.header.pressures?.pallets?.length) paintPressures();
  const exp = document.getElementById('prExp');
  if (exp) exp.textContent = String(Math.max(1, Math.round(Number(draft.measures.pal_count) || 0)));
}

/* Recalcule la pastille du champ modifié + les valeurs dérivées. */
function refresh(changedKey) {
  const group = groupById(draft.product_group_id);
  draft.measures = applyComputed(group, draft.measures, draft.header.pressures, draft.type);
  const ctx = formCtx(group);

  for (const f of flatFields(group, draft.type)) {
    const dot = document.querySelector(`[data-dot="${CSS.escape(f.key)}"]`);
    if (dot) dot.className = 'dot ' + (statusIn(ctx, f, draft.measures[f.key]) || 'none');
    if (f.computed && f.key !== changedKey) {
      const inp = document.querySelector(`.crit[data-key="${CSS.escape(f.key)}"] input`);
      if (inp && !draft.measures['_manual_' + f.key]) inp.value = draft.measures[f.key] ?? '';
    }
  }
  const sec = document.querySelector(`.crit[data-key="${CSS.escape(changedKey)}"]`)?.closest('details');
  if (sec) {
    const def = group.config.sections.find(s => s.id === sec.dataset.sec);
    if (def) setCount(sec, countOf(def));
  }
  refreshVerdict();
}

/* Le verdict se recalcule aussi bien sur un critère que sur une
   pression : une palette qui s'écarte de la référence change
   l'évaluation, l'inspecteur doit le voir au moment où il la saisit. */
/* Une pression saisie change la dureté et le stade de mûrissement.
   On met ces champs à jour SUR PLACE plutôt que de redessiner la
   section : redessiner ferait perdre le focus au beau milieu d'un
   relevé, et l'inspecteur saisit dix mesures d'affilée. */
function syncPressureFields() {
  const group = groupById(draft.product_group_id);
  const ctx = formCtx(group);
  const linked = defectLinkedKeys(group, draft.header.pressures, draft.type);
  for (const f of flatFields(group, draft.type)) {
    if (!PRESSURE_ROLES.includes(fieldRole(f)) && !linked.has(f.key) && !lockedKeys.has(f.key)) continue;
    const row = document.querySelector(`.crit[data-key="${CSS.escape(f.key)}"]`);
    if (!row) continue;
    const auto = autoFilled(group, f, draft.header.pressures, draft.type);
    const el = row.querySelector('input,select');
    const v = draft.measures[f.key];
    row.querySelectorAll('.choice [data-c]').forEach(b => {
      b.setAttribute('aria-pressed', String(b.dataset.c === v));
      b.disabled = auto;
    });
    if (el) {
      if (document.activeElement !== el) el.value = v ?? '';
      if (el.tagName === 'SELECT') el.disabled = auto;
      else { el.readOnly = auto; el.toggleAttribute('data-auto', auto); }
    }
    /* L'aide d'origine du critère revient quand le relevé est vidé :
       « Repris du contrôle par palette » sous un champ redevenu libre
       mentirait. */
    const small = row.querySelector('.lb small');
    const text = auto ? 'Repris du contrôle par palette' : (f.hint || '');
    if (small) { if (text) small.textContent = text; else small.remove(); }
    else if (text) row.querySelector('.lb')?.insertAdjacentHTML('beforeend', `<small>${esc(text)}</small>`);
    const dot = row.querySelector('[data-dot]');
    if (dot) dot.className = 'dot ' + (statusIn(ctx, f, v) || 'none');
    if (auto) lockedKeys.add(f.key); else lockedKeys.delete(f.key);
  }
  refreshCounts(group);
  paintBadPick();          // les palettes contrôlées viennent d'évoluer
}

/* Décomptes « 3/8 » de chaque section, après une mise à jour qui n'est
   passée par aucun champ en particulier. */
function refreshCounts(group) {
  for (const sec of document.querySelectorAll('details.sec[data-sec]')) {
    const def = (group?.config?.sections || []).find(s => s.id === sec.dataset.sec);
    if (def) setCount(sec, countOf(def));
  }
}

/* Champs verrouillés au dernier passage : quand le comptage des
   défauts s'efface, ils doivent se déverrouiller, même s'ils ne sont
   plus « liés ». */
const lockedKeys = new Set();

function refreshVerdict() {
  const group = groupById(draft.product_group_id);
  draft.measures = applyComputed(group, draft.measures, draft.header.pressures, draft.type);
  syncPressureFields();
  draft.summary = computeSummary(group, draft.measures, draft.header.pressures, draft.type);
  const box = $('#verdict');
  if (box) box.innerHTML = verdictHtml(draft.summary);
  const vm = $('#vMini');
  if (vm) {
    vm.innerHTML = vMiniHtml(draft.summary);
    vm.className = 'vmini ' + (draft.summary.pending ? '' : (VERDICT_STATUS[draft.summary.verdict] || ''));
  }
  paintRecSummary();
}

/* Photos par rapport. Toutes vont dans le PDF, en pleine définition
   (~200 ko chacune) : 50 photos font un PDF d'une dizaine de Mo, ce
   qu'accepte encore un e-mail. */
export const MAX_PHOTOS = 50;

/* `paintPhotos` attend la base locale et les liens signés : deux appels
   rapprochés (ajout pendant que les vignettes arrivent) s'entrelaçaient
   et doublaient les cases. Un jeton de génération fait abandonner le
   rendu périmé. Et les URL d'objet créées au rendu précédent sont
   libérées : sans cela, chaque repeinte épinglait une douzaine de
   fichiers de 200 ko en mémoire jusqu'au rechargement de la page. */
let photoPaint = 0;
let photoUrls = [];
async function paintPhotos() {
  const grid = $('#photos');
  if (!grid) return;
  const me = ++photoPaint;
  for (const u of photoUrls) URL.revokeObjectURL(u);
  photoUrls = [];
  grid.innerHTML = '';
  /* À la réouverture d'un rapport déjà synchronisé, les photos ne sont
     plus sur l'appareil : on les relit par des liens signés, demandés
     tous ensemble — une par une, quarante photos faisaient quarante
     allers-retours avant d'apparaître. */
  const recs = await Promise.all(draft.photos.map(p => (p.localId ? local.get('photos', p.localId) : null)));
  const signed = await storage.signedUrls(draft.photos.filter((p, i) => !recs[i] && p.uploaded).map(p => p.path))
    .catch(() => new Map());
  if (me !== photoPaint) return;
  for (const [i, p] of draft.photos.entries()) {
    const cell = document.createElement('div');
    cell.className = 'ph';
    const rec = recs[i];
    const src = rec ? URL.createObjectURL(rec.blob) : (p.uploaded ? signed.get(p.path) || '' : '');
    if (rec) photoUrls.push(src);
    cell.innerHTML = `<img alt="Photo ${i + 1}" src="${src}"${
      src ? '' : ' hidden'}><button type="button" aria-label="Supprimer">×</button>`;
    if (!src) cell.insertAdjacentHTML('afterbegin', `<span class="ph-miss">${
      p.archived ? 'archivée (dans le PDF d\'archive)' : 'indisponible hors ligne'}</span>`);
    cell.querySelector('button').onclick = async () => {
      if (!(await confirmSheet('Supprimer la photo', 'Cette photo sera retirée du rapport.'))) return;
      /* Suppression par identité, pas par l'indice capturé au rendu :
         entre-temps une autre photo a pu être ajoutée ou retirée, et
         l'indice désignait alors la mauvaise. */
      const at = draft.photos.indexOf(p);
      if (at < 0) return;
      if (p.localId) await local.del('photos', p.localId);
      draft.photos.splice(at, 1); touch(); paintPhotos();
    };
    grid.appendChild(cell);
  }
  /* Deux vignettes d'ajout : prendre une photo, ou en choisir dans la
     galerie. Le contrôle se fait souvent appareil en main, mais le
     rapport se saisit après coup, au bureau — les deux chemins
     servent, et aucun ne doit demander de chercher où il est passé. */
  for (const [id, ic, label] of [['#phCam', 'camera', 'Prendre une photo'], ['#phLib', 'image', 'Galerie']]) {
    const add = document.createElement('button');
    add.type = 'button'; add.className = 'photo-add';
    add.innerHTML = `${icon(ic)}<span>${label}</span>`;
    add.onclick = () => $(id).click();
    grid.appendChild(add);
  }
  const c = $('#phCount'); if (c) c.textContent = draft.photos.length || '';
  const nv = document.querySelector('#nav-sec-photos .n'); if (nv) nv.textContent = draft.photos.length || '';
}

/* ------------------- palettes problématiques ------------------- */
function setBad(list) {
  draft.header.bad_pallets = list;
  draft.header.bad_pallet = list.join(', ');   // compatibilité
  const c = $('#badCount'); if (c) c.textContent = badPalletsText(draft.header);
  touch();
}

/* Les palettes déjà contrôlées, proposées en puces. Celles dont la
   moyenne sort de la référence viennent en premier. */
function paintBadPick() {
  const box = $('#badPick');
  if (!box) return;
  const p = draft.header.pressures;
  const sp = spec();
  const rows = (p?.pallets || []).map(pal => {
    const st = palletStats(pal);
    const sev = st ? palletSeverity(st.avg, sp) : null;
    return { n: String(pal.n ?? '').trim(), lvl: sev?.level || 'ok' };
  }).filter(x => x.n);
  if (!rows.length) { box.innerHTML = ''; return; }
  const rank = { critique: 0, majeur: 1, mineur: 2, ok: 3 };
  rows.sort((a, b) => (rank[a.lvl] ?? 3) - (rank[b.lvl] ?? 3));
  const on = badPallets(draft.header);
  box.innerHTML = rows.map(r => `<button type="button" class="chip" data-bad="${esc(r.n)}"
    aria-pressed="${on.includes(r.n)}">Palette ${esc(r.n)}${
    r.lvl !== 'ok' ? ` · ${esc(SEV_LABEL[r.lvl].toLowerCase())}` : ''}</button>`).join('');
  box.querySelectorAll('[data-bad]').forEach(b => b.onclick = () => {
    const n = b.dataset.bad;
    const cur = badPallets(draft.header);
    setBad(cur.includes(n) ? cur.filter(x => x !== n) : [...cur, n]);
    const inp = $('#fbad'); if (inp) inp.value = badPallets(draft.header).join(', ');
    paintBadPick();
    paintFlags();
  });
}

/* Le drapeau de chaque palette suit la liste des palettes
   problématiques, d'où qu'elle ait été modifiée. */
function paintFlags() {
  const on = badPallets(draft.header);
  $$('.pal').forEach(card => {
    const pal = draft.header.pressures?.pallets?.[+card.dataset.i];
    const bad = !!pal && on.includes(String(pal.n ?? '').trim());
    card.classList.toggle('bad', bad);
    card.querySelector('[data-flag]')?.setAttribute('aria-pressed', String(bad));
  });
  paintPalNav();
}

/* ------------------------------ brouillon ------------------------------
   Un rapport non validé vit dans la base locale avec `_draft`. Il n'est
   jamais poussé au serveur — l'équipe n'a pas à voir une saisie en
   cours — et le flux ne l'affiche pas comme un rapport. */
export async function draftFor(type) {
  const all = await local.all('reports');
  return all.filter(r => r._draft && r.type === type && !r.deleted)
            .sort((a, b) => new Date(b.report_date) - new Date(a.report_date))[0] || null;
}

export async function allDrafts() {
  const all = await local.all('reports');
  return all.filter(r => r._draft && !r.deleted)
            .sort((a, b) => (b._draftAt || 0) - (a._draftAt || 0));
}

/* Écriture silencieuse, sans bloquer la frappe : on rassemble les
   sauvegardes rapprochées. */
let saveTimer = null;
/* L'écriture du brouillon est LE mécanisme qui garantit qu'on ne perd
   jamais une saisie. L'avaler en silence, c'était afficher « saisie
   enregistrée automatiquement » à un inspecteur dont rien n'était
   enregistré — quarante minutes de relevés perdues sans un mot. Le
   premier échec est donc annoncé ; les suivants ne harcèlent pas. */
let draftFailed = false;
async function writeDraft() {
  try {
    await local.put('reports', { ...draft, _draftAt: Date.now() });
    if (draftFailed) { draftFailed = false; toast('Brouillon de nouveau enregistré'); }
    return true;
  } catch (e) {
    if (!draftFailed) {
      draftFailed = true;
      toast('Brouillon non enregistré — mémoire de l\'appareil saturée', 'err', { ms: 6000 });
    }
    return false;
  }
}

function keepDraft() {
  if (!draft || !draft._draft) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { if (draft?._draft) writeDraft(); }, 600);
}

async function keepDraftNow() {
  clearTimeout(saveTimer);
  if (!draft || !draft._draft) return true;
  /* Rien touché depuis l'ouverture : le brouillon enregistré est déjà
     à jour. Le réécrire le datait « modifié à l'instant » et le faisait
     remonter dans « En cours » alors qu'on n'avait fait que le relire. */
  if (!dirty) return true;
  return writeDraft();
}

/* ----------------------------- sauvegarde ----------------------------- */
/* Pressions obligatoires : toutes les palettes du lot, et tous leurs
   relevés. Le message dit lesquelles manquent — l'inspecteur n'a pas à
   les chercher parmi vingt. */
function pressureGaps() {
  const group = groupById(draft.product_group_id);
  if (!pressureRequired(group, draft.type)) return '';
  const p = draft.header.pressures;
  const pals = p?.pallets || [];
  if (!pals.length)
    return 'Contrôle par palette obligatoire pour ce produit : ajoutez les palettes, ou « Tout à 13 ».';
  const need = (p.fruits || 5) * (p.sides || 2);
  const miss = pals.filter(pl => (pl.v || []).filter(v => v !== '' && v != null).length < need);
  if (miss.length) {
    const names = miss.slice(0, 4).map(pl => String(pl.n ?? '?')).join(', ');
    return `Pressions incomplètes sur ${miss.length} palette${miss.length > 1 ? 's' : ''} : ${names}${miss.length > 4 ? '…' : '.'}`;
  }
  const cap = palletCap();
  if (cap && pals.length < cap)
    return `Le lot compte ${cap} palettes, ${pals.length} seulement sont contrôlées.`;
  return '';
}

/* Un défaut ne peut pas toucher plus de fruits qu'on n'en a examinés
   pour lui : 12 pourritures sur 10 fruits coupés, c'est une faute de
   frappe, ou des fruits coupés en plus qu'il faut indiquer. */
function defectGaps() {
  if (draft.type !== 'reception') return '';
  const group = groupById(draft.product_group_id);
  for (const pl of draft.header.pressures?.pallets || []) {
    const [o] = palletOverCounts(pl, group, defectTypes(group), lotCut());
    if (!o) continue;
    const what = o.def.where === 'int' && Number(lotCut()) > 0 ? 'fruits coupés' : 'fruits contrôlés';
    return `Palette ${pl.n || '?'} : ${o.n} « ${o.def.label} » pour ${o.base} ${what}. ` +
           `Corrigez le comptage${what === 'fruits coupés' ? ', ou le nombre de fruits coupés' : ''}.`;
  }
  return '';
}

async function save() {
  if (!draft.partner_name?.trim())
    return toast(`Indiquez le ${reportType(draft.type).partnerLabel.toLowerCase()}`, 'err');
  const gap = pressureGaps() || defectGaps();
  if (gap) {
    const sec = $('#prSec');
    if (sec) { sec.open = true; sec.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
    return toast(gap, 'err', { ms: 6000 });
  }

  const btn = $('#save'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span>';
  try {
    // Une ligne entièrement vide ne part pas en base.
    const cals = (draft.header.calibres || []).filter(r => (r.c || '').trim() || (r.o || '').trim());
    if (cals.length) draft.header.calibres = cals; else delete draft.header.calibres;
    draft.header.calibre = [...new Set(cals.map(r => (r.c || '').trim()).filter(Boolean))].join(', ');
    draft.header.origins = [...new Set(cals.map(r => (r.o || '').toUpperCase().trim()).filter(Boolean))];
    draft.header.origin  = draft.header.origins.join(', ');

    /* Un bloc de pressions vide ne part pas en base — mais « vide »
       veut dire sans PRESSION ET sans POIDS. `lotStats` seul ignore la
       colonne des pesées : un contrôle production où l'on a pesé cinq
       fruits sur trois palettes sans sortir le pénétromètre perdait
       palettes, calibres et poids à l'enregistrement. */
    /* À la réception, une palette reprise du journal ou dont on a
       compté les défauts garde sa ligne, même sans pression ni pesée :
       c'est le détail que le fournisseur recevra. */
    const kept = (draft.header.pressures?.pallets || []).some(pl =>
      pl.sub || pl.ggn || Object.values(pl.d || {}).some(v => v !== '' && v != null));
    if (draft.header.pressures && !hasPressures(draft.header) && !kept) delete draft.header.pressures;

    const group = groupById(draft.product_group_id);
    draft.measures = applyComputed(group, draft.measures, draft.header.pressures, draft.type);
    draft.summary = computeSummary(group, draft.measures, draft.header.pressures, draft.type);
    draft.criteria_snapshot = group?.config || null;   // fige la grille utilisée : un rapport reste lisible même si les seuils changent plus tard
    /* La table des poids par colis de l'application (mangue) est figée
       avec la grille quand le produit n'a pas la sienne : le sous-calibre
       d'un rapport ne doit pas bouger si cette table change un jour. */
    if (draft.criteria_snapshot && draft.criteria_snapshot.sizeTable === undefined) {
      const st = sizeTableOf(group);
      if (st) draft.criteria_snapshot = { ...draft.criteria_snapshot, sizeTable: structuredClone(st) };
    }
    draft.inspector_name = state.profile?.full_name || '';
    draft.created_by = currentUser()?.id;
    if (!draft.report_no) draft.report_no = await nextNumber();

    /* Carnet d'adresses : on crée le partenaire s'il est nouveau.
       Le transporteur suit la même logique, dans son propre carnet. */
    const partner = await ensurePartner(reportType(draft.type).partnerKind, draft.partner_name);
    draft.partner_id = partner.id;
    draft.partner_name = partner.name;
    if (draft.header.carrier?.trim()) {
      const c = await ensurePartner('transporteur', draft.header.carrier);
      draft.header.carrier = c.name;
    }

    /* Le drapeau de brouillon ne tombe qu'une fois l'écriture réussie.
       L'enlever avant, c'était se retrouver — si la base locale
       refusait l'écriture, disque plein par exemple — avec un rapport
       ni enregistré NI en brouillon : plus rien ne le réécrivait, et
       quitter l'écran proposait de « perdre les modifications » d'une
       saisie qui n'existait nulle part. */
    const wasDraft = draft._draft, wasDraftAt = draft._draftAt;
    const row = { ...draft, _dirty: true };
    delete row._draft; delete row._draftAt;
    try {
      await local.put('reports', row);
    } catch (e) {
      if (wasDraft) { draft._draft = wasDraft; draft._draftAt = wasDraftAt; }
      throw e;
    }
    draft = row;                    // validé : il rejoint le flux de l'équipe

    /* Le PDF est proposé sur la fiche, juste après : c'est le seul
       moment où les photos existent en pleine définition. D'ici là, le
       rapport attend dans la file (voir holdReport) ; filet de sécurité
       si la fiche ne s'ouvrait pas. */
    const savedId = draft.id;
    holdReport(savedId);
    state.pdfOffer = savedId;
    setTimeout(() => {
      if (state.pdfOffer === savedId) { state.pdfOffer = null; releaseReport(savedId); sync({ silent: true }); }
    }, 8000);

    await queue('report', { id: draft.id });
    await local.meta('lastForm', { product_group_id: draft.product_group_id, department: draft.header.department });

    dirty = false;
    sync({ silent: true });
    /* Pas de message : la fiche s'ouvre sur « Rapport enregistré », avec
       le PDF à portée de main (et l'état du réseau dit dans la feuille). */
    go('#/report/' + draft.id);
  } catch (e) {
    toast(e.message || 'Enregistrement impossible', 'err');
    btn.disabled = false; btn.innerHTML = `${icon('check')} Enregistrer`;
  }
}

/* --------------------------- pressions --------------------------- */
function pressures() {
  const cfg = pressureConfig(groupById(draft.product_group_id));
  if (!draft.header.pressures) draft.header.pressures = { ...cfg, mode: 'target', refSource: 'produit', pallets: [] };
  /* La grille est figée à la première saisie : changer de produit en
     cours de route ne doit pas réécrire des mesures déjà prises. */
  const p = draft.header.pressures;
  if (!p.pallets.length) { p.fruits = cfg.fruits; p.sides = cfg.sides; p.unit = cfg.unit; }
  if (!p.mode) p.mode = 'target';
  /* Fruits coupés par palette (défauts internes) : figés dans le
     rapport à sa création, comme la grille. Un rapport déjà enregistré
     sans ce nombre (d'avant la 3.2) garde son calcul d'origine. */
  if (draft._draft && draft.type === 'reception' && (!(Number(p.cut) > 0) || !p.pallets.length))
    p.cut = samplingCfg(groupById(draft.product_group_id)).cut;
  /* Le repli sur la référence du produit ne vaut qu'à la CRÉATION du
     bloc. Le réappliquer à chaque passage remettait 13 dans un champ
     que l'inspecteur venait d'effacer, tout en l'étiquetant « ajustée
     à la main » — une valeur que personne n'avait saisie, présentée
     comme une décision humaine. */
  if (p.mode === 'target' && p.ref == null && p.refSource !== 'manuel') p.ref = cfg.ref;
  /* Un rapport déjà enregistré garde la référence avec laquelle il a
     été jugé. La lui réappliquer à chaque ouverture, c'était, pour une
     simple correction, lui imposer en silence le carnet d'aujourd'hui —
     et, si le client avait été renommé depuis, le ramener à la
     référence produit : un rapport conforme devenait non conforme sans
     que personne ait touché aux pressions. Changer de client ou de
     conditionnement la réapplique ; un carnet qui a changé depuis est
     signalé, avec un bouton pour l'adopter. */
  if (draft._draft) applyClientRef();
  return p;
}
const slots = (p) => (p.fruits || 5) * (p.sides || 2);
const spec = () => refSpec(draft.header.pressures, groupById(draft.product_group_id));

/* Référence enregistrée pour le partenaire du rapport. Le carnet ne
   porte des pressions que pour les clients : à la réception, c'est
   notre propre cahier des charges qui s'applique, pas celui du
   fournisseur. */
function clientSpec() {
  const T = reportType(draft.type);
  if (T.partnerKind !== 'client') return null;
  const name = (draft.partner_name || '').trim().toLowerCase();
  if (!name) return null;
  const partner = state.partners.find(p => p.kind === 'client' && p.name.toLowerCase() === name);
  if (!partner) return null;
  const hit = partnerRef(partner, draft.product_group_id, draft.header.packaging_kind || '');
  return hit ? { ...hit, name: partner.name } : null;
}

/* Applique la référence du client au rapport — sauf si le contrôleur
   l'a déjà ajustée à la main : sa saisie prime toujours sur le carnet.
   Renvoie true si quelque chose a changé. */
function applyClientRef({ force = false } = {}) {
  const p = draft.header.pressures;
  if (!p) return false;
  if (p.refSource === 'manuel' && !force) return false;
  const hit = clientSpec();
  if (!hit) {
    if (p.refSource !== 'client') return false;
    /* Le client renseigné n'a plus de référence : on revient au
       réglage du produit plutôt que de garder une valeur orpheline. */
    const cfg = pressureConfig(groupById(draft.product_group_id));
    Object.assign(p, { mode: 'target', ref: cfg.ref, rmin: undefined, rmax: undefined,
                       refSource: 'produit', refClient: '' });
    return true;
  }
  const before = JSON.stringify([p.mode, p.ref, p.rmin, p.rmax, p.refSource, p.refClient]);
  if (hit.mode === 'range') Object.assign(p, { mode: 'range', rmin: hit.min, rmax: hit.max });
  else Object.assign(p, { mode: 'target', ref: hit.ref });
  p.refSource = 'client';
  p.refClient = hit.name;
  /* On garde la portée exacte de la règle retenue : « Monoprix ·
     Avocat · Vrac » se lit dans le rapport comme dans le PDF, et
     permet de vérifier que c'est bien la bonne ligne qui s'applique. */
  p.refScope = refScopeText(hit);
  p.refPack = hit.packaging || '';
  /* Le `|| true` qui traînait ici rendait la comparaison décorative :
     chaque frappe dans le champ client reconstruisait toute la grille
     des pressions, champ en cours de saisie compris. */
  return before !== JSON.stringify([p.mode, p.ref, p.rmin, p.rmax, p.refSource, p.refClient]);
}

/* D'où vient la référence affichée, et comment revenir à celle du
   client. Extrait du bloc pour pouvoir se réécrire seul quand la
   valeur change sous les doigts du contrôleur. */
function refScopeText(hit) {
  return [groupById(hit.group)?.name || '', hit.packaging || ''].filter(Boolean).join(' · ');
}

function refSourceHtml(p) {
  const hit = clientSpec();
  if (p.refSource === 'client') {
    const base = `D'après le carnet — ${esc(p.refClient || '')}${p.refScope ? ` · ${esc(p.refScope)}` : ''}.`;
    const now = hit ? refText({ ...hit, unit: p.unit }) : '';
    const was = refText(spec());
    return base + (hit && now !== was
      ? ` Le carnet indique aujourd'hui ${esc(now)}. <button type="button" class="linkish" id="prRefBack">L'appliquer à ce rapport</button>`
      : '');
  }
  /* Quand une référence client existe, `applyClientRef` l'a déjà posée
     avant ce rendu, sauf si le contrôleur l'a écartée à la main : le
     seul libellé atteignable est donc « Reprendre celle du client ».
     L'autre branche promettait un bouton que personne n'a jamais vu. */
  const back = hit && p.refSource === 'manuel'
    ? ` <button type="button" class="linkish" id="prRefBack">Reprendre celle du client</button>`
    : '';
  return (p.refSource === 'manuel' ? 'Ajustée à la main pour ce rapport.' : 'Valeur par défaut du produit.') + back;
}

/* Le lien « Reprendre celle du client » vit dans un paragraphe réécrit
   à chaque frappe. Un gestionnaire posé dessus disparaîtrait avec lui :
   quitter le champ de saisie détruisait le bouton juste avant qu'il
   reçoive le clic, et rien ne se passait. On écoute donc depuis le
   bloc de référence, qui, lui, survit à la réécriture. */
function wireRefBack() {
  const box = $('.ref-box');
  if (!box || box.dataset.wired) return;
  box.dataset.wired = '1';
  box.addEventListener('click', (e) => {
    if (!e.target.closest('#prRefBack')) return;
    applyClientRef({ force: true });
    touch();
    paintPressures();
  });
}

/* Bloc de réglage de la référence, en tête de la section Pressions. */
function refHtml(p) {
  const s = spec();
  return `<div class="ref-box">
    <div class="ref-head">
      <span class="lb">Référence de pression</span>
      <span class="seg sm" id="prMode">
        <button type="button" data-m="target" aria-pressed="${p.mode !== 'range'}">Valeur</button>
        <button type="button" data-m="range" aria-pressed="${p.mode === 'range'}">Plage</button>
      </span>
    </div>
    ${p.mode === 'range' ? `
      <div class="ref-in">
        <label>Mini <input type="number" inputmode="decimal" step="0.1"
          min="${LIMITS.min}" max="${LIMITS.max}" id="prMin" value="${p.rmin ?? ''}"></label>
        <label>Maxi <input type="number" inputmode="decimal" step="0.1"
          min="${LIMITS.min}" max="${LIMITS.max}" id="prMax" value="${p.rmax ?? ''}"></label>
        <span class="u">${esc(p.unit || 'kg')}</span>
      </div>
      <p class="hint">Dans la plage : conforme · ${RANGE_TOL} point de débordement toléré · au-delà, écart critique.</p>`
    : `
      <div class="ref-in">
        <label>Cible <input type="number" inputmode="decimal" step="0.1"
          min="${LIMITS.min}" max="${LIMITS.max}" id="prRef" value="${p.ref ?? ''}"></label>
        <span class="u">${esc(p.unit || 'kg')}</span>
      </div>
      <p class="hint">Écart toléré ${SEV_STEPS.ok} point · mineur jusqu'à ${SEV_STEPS.mineur} · majeur jusqu'à ${SEV_STEPS.majeur} · au-delà critique.</p>`}
    <p class="hint" id="prSrc">${refSourceHtml(p)}</p>
    <details><summary>Comment c'est jugé ?</summary>
      <p>Le pénétromètre mesure de ${LIMITS.min} à ${LIMITS.max} ${esc(p.unit || 'kg')} : une valeur hors de cet intervalle est ramenée à la borne.</p>
      ${s ? '<p>Le barème ne s\'applique qu\'à la moyenne de chaque palette, jamais à un fruit isolé.</p>' : ''}
    </details>
  </div>`;
}

function paintPressures() {
  const body = $('#prBody');
  if (!body) return;
  const p = pressures();
  const cfg = pressureConfig(groupById(draft.product_group_id));
  const n = slots(p);
  /* Le nombre de palettes est lu au moment du clic, pas au rendu : la
     section Palettisation est souvent remplie après cette section. */
  /* Numérotation : on repart du plus grand numéro existant, pas de la
     longueur du tableau. Supprimer la palette 2 puis en ajouter une
     donnait deux palettes « 3 » — indiscernables dans le tableau du
     PDF, et dont les non-conformités se télescopaient dans le
     verdict. */
  const nextPalletName = (p) => {
    const max = (p.pallets || []).reduce((m, x) => {
      const v = parseInt(String(x.n ?? ''), 10);
      return isFinite(v) ? Math.max(m, v) : m;
    }, 0);
    return String(Math.max(max, p.pallets.length) + 1);
  };

  const expected = () => Math.max(1, palletCap() || Math.round(Number(draft.measures.pal_count) || 0));
  const cap = palletCap();
  /* Mémorisé pour que le détail du lot sache si la section affichée
     est encore à jour : le quota saisi plus haut commande le plafond,
     les calibres proposés et l'avertissement de dépassement. */
  paintedCap = cap;
  const full = cap > 0 && p.pallets.length >= cap;

  const T = reportType(draft.type);
  const fillAt = fillValue(p, cfg);
  const grp = groupById(draft.product_group_id);
  const req = pressureRequired(grp, draft.type);
  const defs = draft.type === 'reception' ? defectTypes(grp) : [];
  const smp = samplingCfg(grp);
  body.innerHTML = `
    <div class="pr-intro">
      <div>${icon('pallet')}<span><b>${p.fruits} fruit${p.fruits > 1 ? 's' : ''} par palette</b>, ${p.sides} mesure${
        p.sides > 1 ? 's' : ''} de pression chacun${T.weights ? ' et son poids' : ''} — ${n} relevé${n > 1 ? 's' : ''}${
        T.weights ? ` et ${p.fruits} pesée${p.fruits > 1 ? 's' : ''}` : ''} par palette.</span></div>
      ${defs.length ? `<div>${icon('box')}<span><b>Défauts${Number(p.cut) > 0 ? ' externes' : ''} sur ${smp.boxes} colis ouverts</b> par palette${
        smp.perKg ? ` (le calibre donne les fruits d'un colis de ${String(smp.perKg).replace('.', ',')} kg)`
                  : ' (le calibre donne les fruits du colis)'}${Number(p.cut) > 0 && defs.some(t => t.where === 'int')
          ? `, <b>défauts internes sur ${p.cut} fruits coupés</b>` : ''} — case vide = aucun fruit touché.</span></div>` : ''}
      <div>${icon(req ? 'alert' : 'info')}<span>${req ? '<b>Obligatoire</b> pour ce produit en réception.' : 'Section facultative.'}</span></div>
    </div>
    ${refHtml(p)}
    <div class="pr-tools">
      <button type="button" class="btn tonal sm" id="prFill">
        ${icon('check')} Tout à ${fmtP(fillAt).replace('.0', '')} ${esc(p.unit || 'kg')}</button>
      <button type="button" class="btn ghost sm" id="prAdd"${full ? ' disabled' : ''}>${icon('plus')} Palette</button>
      ${p.pallets.length ? `<button type="button" class="btn ghost sm" id="prClear">${icon('trash')} Tout effacer</button>` : ''}
    </div>
    ${cap ? `<p class="pr-quota">${
      full ? `Les ${cap} palettes annoncées dans le détail du lot sont toutes contrôlées.`
           : `${p.pallets.length} palette${p.pallets.length > 1 ? 's' : ''} sur les ${cap} annoncées${
               remainingText() ? ` — reste ${remainingText()}` : ''}.`}</p>` : ''}
    ${overText() ? `<div class="err-box" style="margin:0 0 10px">${esc(overText())}</div>` : ''}
    ${p.pallets.length > 1 ? `<div class="pal-nav" id="palNav" aria-label="Aller à une palette"></div>` : ''}
    <div id="prList"></div>
    ${defs.length && p.pallets.length ? `<div class="rec-sum" id="recSum"></div>` : ''}
    ${p.pallets.length ? `<div class="card pad" style="margin-top:12px" id="prPreview"></div>` : ''}`;

  wireRef(p);

  const list = $('#prList');
  list.innerHTML = p.pallets.map((pal, i) => palletHtml(pal, i, p)).join('') ||
    `<p class="muted" style="margin:0">Aucune pression saisie. « Tout à ${fmtP(fillAt).replace('.0','')} »
     crée <span id="prExp">${expected()}</span> palette(s) d'après le nombre saisi en Palettisation.</p>`;

  /* Remplissage rapide : il COMPLÈTE, il n'écrase pas. Une main qui
     cherche « Palette » trouve parfois « Tout à 13 » juste à côté, et
     dix relevés déjà saisis ne doivent pas disparaître sur une fausse
     manœuvre. Ce qui est mesuré reste ; seules les cases vides se
     remplissent. */
  $('#prFill').onclick = () => {
    const ref = fillValue(p, cfg);
    const count = p.pallets.length || expected();
    /* On respecte la répartition annoncée : deux palettes en 18, une
       en 20, une en 22 donnent exactement ces quatre palettes-là. */
    const spread = calibreSpread(count);
    let filled = 0;
    p.pallets = Array.from({ length: count }, (_, i) => {
      const old = p.pallets[i];
      const v = Array.from({ length: n }, (_, k) => {
        const cur = old?.v?.[k];
        if (cur !== '' && cur != null) return cur;
        filled++; return ref;
      });
      /* Tout ce que la palette porte déjà — n° réel, variété, colis,
         défauts comptés — est conservé : seules les pressions vides se
         remplissent. */
      return {
        ...(old || {}),
        n: old?.n ?? String(i + 1),
        cal: old?.cal ?? spread[i] ?? '',
        v,
        w: old?.w ?? Array.from({ length: p.fruits }, () => '')
      };
    });
    touch(); paintPressures();
    toast(filled
      ? `${filled} relevé${filled > 1 ? 's' : ''} complété${filled > 1 ? 's' : ''} à ${fmtP(ref).replace('.0', '')} ${p.unit || 'kg'}`
      : 'Tous les relevés étaient déjà saisis — rien n\'a été modifié');
  };
  $('#prAdd').onclick = () => {
    if (palletCap() && p.pallets.length >= palletCap())
      return toast(`Le lot n'annonce que ${palletCap()} palettes.`, 'err');
    p.pallets.push({
      n: nextPalletName(p), cal: defaultCalibre(),
      v: Array.from({ length: n }, () => ''),
      w: Array.from({ length: p.fruits }, () => '')
    });
    touch(); paintPressures();
  };
  const clr = $('#prClear');
  if (clr) clr.onclick = async () => {
    if (!(await confirmSheet('Effacer les pressions', 'Tous les relevés saisis seront supprimés.'))) return;
    p.pallets = []; touch(); paintPressures();
  };

  /* Sur un clavier d'ordinateur, Entrée ne fait rien dans un champ
     isolé : on lui donne le même effet que « Suivant » sur un
     téléphone, pour que la saisie se fasse d'une seule main. */
  const measures = () => [...list.querySelectorAll('input[data-v],input[data-w],input[data-d]')];
  list.onkeydown = (e) => {
    if (e.key !== 'Enter' || !e.target.matches('input[data-v],input[data-w],input[data-d]')) return;
    e.preventDefault();
    const all = measures();
    const next = all[all.indexOf(e.target) + 1];
    if (next) { next.focus(); next.select?.(); }
    else e.target.blur();
  };

  list.querySelectorAll('.pal').forEach(card => {
    const i = +card.dataset.i;
    card.querySelector('[data-n]').oninput = (e) => { p.pallets[i].n = e.target.value; touch(); };
    const calSel = card.querySelector('[data-cal]');
    if (calSel) calSel.onchange = () => {
      p.pallets[i].cal = calSel.value;
      /* Le nombre de fruits par colis suivait le calibre du journal :
         changé à la main, c'est le nouveau calibre qui compte. */
      delete p.pallets[i].count;
      touch(); paintPressures();
    };
    card.querySelectorAll('[data-w]').forEach(inp => inp.oninput = () => {
      const k = +inp.dataset.w;
      /* Une palette héritée d'une version antérieure à la colonne des
         poids n'a pas de tableau `w` : on le crée plutôt que de lever
         au premier chiffre tapé. */
      (p.pallets[i].w ||= [])[k] = inp.value === '' ? '' : Number(inp.value);
      const min = calibreMin(groupById(draft.product_group_id), p.pallets[i].cal, p.pallets[i].boxKg);
      inp.classList.toggle('off', inp.value !== '' && min != null && Number(inp.value) < min);
      touch();
      refreshPalletAvg(card, p.pallets[i]);
      refreshPalletSum(card, p.pallets[i]);
      paintRecSummary();
    });
    card.querySelectorAll('[data-v]').forEach(inp => {
      inp.onblur = () => {
        if (inp.value === '') return;
        const c = clampP(inp.value);
        if (c != null && c !== Number(inp.value)) {
          inp.value = String(c);
          inp.dispatchEvent(new Event('input'));
          toast(`Pression ramenée à ${c} : la mesure va de ${LIMITS.min} à ${LIMITS.max}.`);
        }
      };
      inp.oninput = () => {
      const k = +inp.dataset.v;
      /* Le modèle est borné dès la frappe, pas seulement au `blur` :
         sur un téléphone, on peut enregistrer sans jamais quitter le
         dernier champ, et une valeur hors mesure donnait alors une
         moyenne à l'écran (bornée) différente de celle du PDF (brute)
         pour la même palette. L'affichage, lui, reste libre le temps
         de finir de taper. */
      p.pallets[i].v[k] = inp.value === '' ? '' : (clampP(inp.value) ?? '');
      /* Un fruit qui s'écarte nettement de la zone acceptée se signale
         de lui-même pendant la saisie. Ce n'est qu'un repère visuel :
         la gravité, elle, ne se calcule que sur la moyenne. */
      inp.classList.toggle('off', inp.value !== '' && outOfZone(inp.value, spec()) > OUTLIER);
      touch();
      refreshPalletAvg(card, p.pallets[i]);
      paintPressurePreview();
      refreshVerdict();
      paintPalNav();
      };
    });
    card.querySelector('[data-del]').onclick = () => {
      p.pallets.splice(i, 1); touch(); paintPressures();
    };

    /* Défauts comptés : une case vide vaut zéro. */
    card.querySelectorAll('[data-d]').forEach(inp => inp.oninput = () => {
      const pal = p.pallets[i];
      pal.d ||= {};
      pal.d[inp.dataset.d] = inp.value === '' ? '' : Math.max(0, Math.round(Number(inp.value) || 0));
      touch();
      refreshPalletSum(card, pal);
      refreshVerdict();
    });

    /* Informations de la palette (reprises du journal, corrigeables). */
    card.querySelectorAll('[data-pi]').forEach(inp => inp.oninput = () => {
      const pal = p.pallets[i], k = inp.dataset.pi;
      pal[k] = inp.value === '' ? '' : (['boxKg', 'boxes', 'chk', 'cut'].includes(k) ? Number(inp.value) : inp.value);
      touch();
      const main = card.querySelector('.pi-main');
      if (main) main.textContent = palletInfoLine(pal);
      const sub = card.querySelector('.pi-sub');
      if (sub) sub.textContent = palletInfoSub(pal);
      if (k === 'boxKg') refreshWeights(card, pal);
      refreshPalletSum(card, pal);
      refreshVerdict();
    });

    const flag = card.querySelector('[data-flag]');
    if (flag) flag.onclick = () => {
      const nm = String(p.pallets[i].n ?? '').trim();
      if (!nm) return toast("Donnez d'abord un numéro à la palette", 'err');
      const cur = badPallets(draft.header);
      setBad(cur.includes(nm) ? cur.filter(x => x !== nm) : [...cur, nm]);
      const inp = $('#fbad'); if (inp) inp.value = badPallets(draft.header).join(', ');
      paintFlags();
      paintBadPick();
    };
  });

  const c = $('#prCount');
  if (c) c.textContent = p.pallets.length ? `${p.pallets.length} palette${p.pallets.length > 1 ? 's' : ''}` : '';
  const nv = document.querySelector('#nav-prSec .n'); if (nv) nv.textContent = p.pallets.length || '';
  paintPressurePreview();
  refreshVerdict();
  paintBadPick();
  paintPalNav();
}

/* ------------------- plan des palettes -------------------
   Vingt palettes, c'est vingt écrans de saisie. Une rangée de numéros
   collée en haut de la section y mène d'un appui, et dit où l'on en
   est : relevés complets (vert), commencés (orange), palette signalée
   (cadre rouge), moyenne hors référence (point rouge). */
const headH = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--head-h')) || 56;
const jumpH = () => { const j = $('#fJump'); return j && getComputedStyle(j).position === 'sticky' ? j.offsetHeight : 0; };

function paintPalNav() {
  const nav = $('#palNav');
  const p = draft?.header?.pressures;
  if (!nav || !p) return;
  const need = slots(p);
  const bad = new Set(badPallets(draft.header));
  const sp = spec();
  nav.innerHTML = (p.pallets || []).map((pal, i) => {
    const n = (pal.v || []).filter(v => v !== '' && v != null).length;
    const st = palletStats(pal);
    const sev = st ? palletSeverity(st.avg, sp) : null;
    const name = String(pal.n ?? '').trim();
    const state = n >= need ? 'complète' : n ? 'commencée' : 'à mesurer';
    const cls = [n >= need ? 'done' : n ? 'part' : '', bad.has(name) ? 'bad' : '',
                 sev && sev.level !== 'ok' ? 'off' : ''].filter(Boolean).join(' ');
    return `<button type="button" class="${cls}" data-gp="${i}" title="Palette ${esc(name || String(i + 1))} — ${state}${
      bad.has(name) ? ', signalée' : ''}${sev && sev.level !== 'ok' ? ', hors référence' : ''}">${i + 1}</button>`;
  }).join('');
  nav.querySelectorAll('[data-gp]').forEach(b => b.onclick = () => {
    const card = document.querySelector(`.pal[data-i="${b.dataset.gp}"]`);
    if (!card) return;
    window.scrollTo({ top: card.getBoundingClientRect().top + window.scrollY - (headH() + jumpH() + nav.offsetHeight + 12), behavior: 'smooth' });
  });
  spyPallets();
}

/* La palette à l'écran s'allume dans la rangée. */
function spyPallets() {
  const nav = $('#palNav');
  if (!nav) return;
  const y = headH() + jumpH() + nav.offsetHeight + 24;
  let cur = -1;
  for (const card of document.querySelectorAll('#prList .pal')) {
    const r = card.getBoundingClientRect();
    if (r.top <= y && r.bottom > y) { cur = +card.dataset.i; break; }
  }
  nav.querySelectorAll('[data-gp]').forEach(b => b.classList.toggle('cur', +b.dataset.gp === cur));
  const on = nav.querySelector('.cur');
  if (on && (on.offsetLeft < nav.scrollLeft || on.offsetLeft + on.offsetWidth > nav.scrollLeft + nav.clientWidth))
    nav.scrollTo({ left: on.offsetLeft - 48 });
}

/* Valeur du remplissage en un clic : la cible, ou le milieu de la
   plage acceptée — c'est la pression que le lot est censé porter. */
function fillValue(p, cfg) {
  if (p.mode === 'range') {
    const lo = Number(p.rmin), hi = Number(p.rmax);
    if (isFinite(lo) && isFinite(hi)) return Math.round(((lo + hi) / 2) * 10) / 10;
  }
  return p.ref ?? cfg.ref;
}

function wireRef(p) {
  const mark = () => { p.refSource = 'manuel'; touch(); };
  $$('#prMode button').forEach(b => b.onclick = () => {
    if (b.dataset.m === p.mode) return;
    p.mode = b.dataset.m;
    /* On propose une plage cohérente avec la cible en cours plutôt
       qu'une paire de champs vides : ±1 autour d'elle, c'est
       exactement la tolérance du mode valeur. */
    if (p.mode === 'range' && (p.rmin == null || p.rmax == null)) {
      const c = Number(p.ref);
      if (isFinite(c)) { p.rmin = Math.max(0, c - 1); p.rmax = c + 1; }
    }
    mark(); paintPressures();
  });
  /* On borne à la sortie du champ plutôt qu'à chaque frappe : corriger
     « 1 » en « 13 » passerait par « 1 », et un bornage immédiat
     empêcherait de taper le second chiffre. */
  const bindRef = (el, key) => {
    if (!el) return;
    el.oninput = () => { p[key] = el.value === '' ? null : Number(el.value); mark(); afterRef(); };
    el.onblur  = () => {
      if (el.value === '') return;
      const c = clampP(el.value);
      if (c != null && c !== Number(el.value)) {
        el.value = String(c);
        toast(`Référence ramenée à ${c} ${p.unit || 'kg'} : la mesure va de ${LIMITS.min} à ${LIMITS.max}.`);
      }
      p[key] = c; mark(); afterRef();
    };
  };
  bindRef($('#prRef'), 'ref');
  bindRef($('#prMin'), 'rmin');
  bindRef($('#prMax'), 'rmax');
  wireRefBack();
}

/* Changer la référence ne touche à aucune mesure : on ne redessine que
   ce qui en dépend, pour ne pas faire perdre le focus au champ en
   cours de frappe. */
function afterRef() {
  const p = draft.header.pressures;
  const btn = $('#prFill');
  if (btn) btn.innerHTML = `${icon('check')} Tout à ${
    fmtP(fillValue(p, pressureConfig(groupById(draft.product_group_id)))).replace('.0', '')} ${esc(p.unit || 'kg')}`;
  /* La provenance de la référence change dès la première frappe : on
     la réécrit sans toucher aux champs, pour ne pas voler le focus. */
  /* On ne réécrit la ligne que si elle change vraiment. Sinon, quitter
     le champ de saisie remplaçait le bouton « Reprendre celle du
     client » entre l'appui et le relâchement du doigt : le clic
     n'atteignait plus rien et le bouton semblait mort. */
  const src = $('#prSrc');
  if (src) {
    const html = refSourceHtml(p);
    if (src.innerHTML !== html) { src.innerHTML = html; wireRefBack(); }
  }
  paintPressurePreview();
  $$('.pal').forEach(card => repaintOff(card, p.pallets[+card.dataset.i]));
  refreshVerdict();
}

/* ------------------- calibres disponibles -------------------
   Le détail du lot dit ce qu'il y a réellement sur le quai : deux
   palettes en 18, une en 20, une en 22. Le contrôle par palette ne
   peut donc pas inventer une cinquième palette, ni proposer un
   troisième 18. On tient un décompte : chaque palette déjà saisie
   consomme une unité de son calibre, et ce qui reste détermine ce
   qu'on propose ensuite. Un calibre changé à la main rend aussitôt
   sa place — c'est le cas de l'inspecteur qui commence par les 20. */
function lotQuota() {
  const q = new Map();
  let total = 0, declared = false;
  for (const r of (draft.header.calibres || [])) {
    const n = Number(r.pal);
    if (!isFinite(n) || n <= 0) continue;
    declared = true;
    const cal = (r.c || '').trim();
    total += n;
    if (cal) q.set(cal, (q.get(cal) || 0) + n);
  }
  return { q, total: Math.round(total), declared };
}

/* Ce qu'il reste par calibre une fois les palettes déjà saisies
   défalquées. `skip` exclut une palette — celle dont on est en train
   de changer le calibre, qui ne doit pas se bloquer elle-même. */
function calibreRemaining(skip = -1) {
  const { q } = lotQuota();
  const left = new Map(q);
  (draft.header.pressures?.pallets || []).forEach((pal, i) => {
    if (i === skip) return;
    const c = (pal.cal || '').trim();
    if (left.has(c)) left.set(c, left.get(c) - 1);
  });
  return left;
}

/* Calibres proposés pour une palette : ceux du lot d'abord — c'est ce
   qu'on conditionne — puis le reste de la grille produit, pour le cas
   où rien n'a été déclaré. */
function calibreOptions() {
  const group = groupById(draft.product_group_id);
  const fromLot = (draft.header.calibres || []).map(c => (c.c || '').trim()).filter(Boolean);
  const all = group?.config?.calibres || [];
  return [...new Set([...fromLot, ...all])];
}

/* Le calibre proposé à la palette suivante : le premier du lot qui a
   encore de la place. Rien de déclaré : on garde le premier calibre
   connu, comme avant. */
function defaultCalibre(skip = -1) {
  const { declared } = lotQuota();
  if (!declared) return calibreOptions()[0] || '';
  const left = calibreRemaining(skip);
  for (const [cal, n] of left) if (n > 0) return cal;
  return '';
}

/* Nombre de palettes annoncé au lot : plafond du contrôle par palette. */
const palletCap = () => { const { total, declared } = lotQuota(); return declared ? total : 0; };

/* Écart entre les palettes contrôlées et ce que le lot annonce. Le
   contrôleur reste libre de corriger un calibre à la main ; s'il en
   met plus qu'il n'en existe, on le lui dit plutôt que de l'empêcher
   de saisir ce qu'il a réellement sous les yeux. */
function overText() {
  const over = [...calibreRemaining()].filter(([, n]) => n < 0)
    .map(([c, n]) => `${-n} de trop en ${c}`);
  if (over.length)
    return `Le détail du lot n'annonce pas autant de palettes : ${over.join(', ')}. ` +
           `Corrigez le détail du lot, ou le calibre d'une palette.`;

  /* Sur un rapport de réception, les palettes n'ont pas de calibre
     propre : le décompte par calibre ne peut alors rien signaler, et
     réduire le nombre annoncé après coup passait complètement
     inaperçu. On compare donc aussi les totaux. */
  const cap = palletCap();
  const done = draft.header.pressures?.pallets?.length || 0;
  if (cap && done > cap) {
    const d = done - cap;
    return `Le détail du lot n'annonce que ${cap} palette${cap > 1 ? 's' : ''}, ` +
           `mais ${done} sont contrôlées : ${d} de trop. ` +
           `Corrigez le détail du lot, ou retirez ${d === 1 ? 'une palette' : `${d} palettes`} du contrôle.`;
  }
  return '';
}

/* « 1 × 18, 1 × 22 » — ce qu'il reste à contrôler, dit en clair. */
function remainingText() {
  const left = [...calibreRemaining()].filter(([, n]) => n > 0);
  return left.map(([c, n]) => `${n} × ${c}`).join(', ');
}

/* Répartition complète pour le remplissage en un clic : autant de
   palettes par calibre que le lot en annonce, dans l'ordre déclaré. */
function calibreSpread(count) {
  const { q, declared } = lotQuota();
  if (!declared) return Array.from({ length: count }, () => calibreOptions()[0] || '');
  const out = [];
  for (const [cal, n] of q) for (let k = 0; k < n && out.length < count; k++) out.push(cal);
  while (out.length < count) out.push('');
  return out;
}

/* Un fruit isolé est signalé au-delà de deux points hors de la zone
   acceptée : assez large pour ne pas clignoter sur un lot normal,
   assez serré pour faire ressortir le fruit qui traîne. */
const OUTLIER = 2;

/* Rappel au-dessus des cases de poids : le poids attendu (la plage
   entière quand la table la donne, pour la mangue) et la règle de
   saisie — seuls les fruits trop légers sont notés. */
function weightCap(pal, group, wst) {
  const r = wst?.range;
  if (r?.min != null) {
    const band = r.max != null ? `${fmtG(r.min)}–${fmtG(r.max)} g` : `minimum ${fmtG(r.min)} g`;
    return `${band} pour le calibre ${esc(pal.cal)}${r.box ? `, colis de ${esc(r.box)} kg` : ''} · case vide = fruit conforme`;
  }
  if (needsBox(group, pal))
    return `le poids du calibre ${esc(pal.cal)} dépend du colis${draft.type === 'reception'
      ? ' : indiquez le poids net du colis dans les informations de la palette' : ' : minimum inconnu'}`;
  return '';
}

/* Le calibre ou le colis d'une palette a changé : son poids minimum
   aussi. On repeint en place, sans redessiner la liste (la saisie en
   cours garde le focus). */
function refreshWeights(card, pal) {
  const group = groupById(draft.product_group_id);
  const p = draft.header.pressures;
  const wst = palletWeighing(pal, group, p.fruits);
  const cap = card.querySelector('[data-wcap]');
  if (cap) cap.innerHTML = weightCap(pal, group, wst);
  card.querySelectorAll('[data-w]').forEach(inp => {
    inp.classList.toggle('off', inp.value !== '' && wst.min != null && Number(inp.value) < wst.min);
  });
  refreshPalletAvg(card, pal);
}

function palletHtml(pal, i, p) {
  const T = reportType(draft.type);
  const group = groupById(draft.product_group_id);
  const st = palletStats(pal);
  const wst = palletWeighing(pal, group, p.fruits);
  const min = wst.min;
  const sp = spec();
  const opts = calibreOptions();
  const left = calibreRemaining(i);
  const isRec = draft.type === 'reception';
  const defs = isRec ? defectTypes(group) : [];
  const bad = isRec && badPallets(draft.header).includes(String(pal.n ?? '').trim());

  return `<div class="pal${isRec ? ' rec' : ''}${bad ? ' bad' : ''}" data-i="${i}">
    <div class="pal-top">
      ${isRec ? `<button type="button" class="flag-btn" data-flag aria-pressed="${bad}"
        aria-label="Palette problématique" title="Palette problématique">${icon('flag')}</button>` : ''}
      <span class="nm${String(pal.n ?? '').length > 10 ? ' long' : ''}"><input type="text" data-n value="${esc(String(pal.n ?? ''))}" aria-label="N° de palette"></span>
      ${T.weights ? `<span class="cal"><select data-cal aria-label="Calibre de la palette">
        <option value="">calibre</option>
        ${opts.map(c => {
          /* Le reste annoncé s'affiche à côté du calibre. Rien n'est
             barré : c'est le choix AUTOMATIQUE qui respecte le
             décompte, la correction manuelle reste libre — un
             inspecteur qui commence par les 20 doit pouvoir le dire,
             même si le reste est déjà réparti. L'écart éventuel avec
             le lot est signalé juste en dessous. */
          /* Le calibre voyage dans `value`, jamais dans le texte : le
             reconstruire depuis le libellé cassait dès qu'un lot
             annonçait « 1,5 palette » — le calibre enregistré devenait
             littéralement « 18 (1.5 restantes) ». */
          const n = left.has(c) ? left.get(c) : null;
          const r = n == null ? null : Math.max(0, Math.round(n * 100) / 100);
          return `<option value="${esc(c)}"${c === pal.cal ? ' selected' : ''}>${
            esc(c)}${r != null ? ` (${r} restante${r > 1 ? 's' : ''})` : ''}</option>`;
        }).join('')}
        ${pal.cal && !opts.includes(pal.cal)
          ? `<option value="${esc(pal.cal)}" selected>${esc(pal.cal)}</option>` : ''}
      </select></span>` : ''}
      <span class="avg">${resumeHtml(st, wst, sp, p)}</span>
      <button type="button" class="icon-btn" data-del aria-label="Retirer la palette">${icon('x')}</button>
    </div>
    ${isRec ? palletInfoHtml(pal, group) : ''}

    <!-- Les champs sont écrits fruit par fruit — les deux joues du
         fruit 1, puis celles du fruit 2 — et replacés dans la grille
         par leurs coordonnées. C'est l'ordre du geste réel : on
         retourne le fruit, on repique, on passe au suivant. Écrits
         ligne par ligne, « Suivant » sautait d'un fruit à l'autre
         sans finir le premier. -->
    <div class="pal-grid" style="grid-template-columns:repeat(${p.fruits},minmax(0,1fr))">
      ${Array.from({ length: p.fruits }, (_, f) =>
        `<span class="fh" style="grid-column:${f + 1};grid-row:1">F${f + 1}</span>`).join('')}
      ${Array.from({ length: p.fruits }, (_, f) =>
        Array.from({ length: p.sides }, (_, sd) => {
          const k = f * p.sides + sd;
          const v = pal.v?.[k];
          const off = v !== '' && v != null && outOfZone(v, sp) > OUTLIER;
          return `<input type="number" inputmode="decimal" step="0.1" data-v="${k}"
            min="${LIMITS.min}" max="${LIMITS.max}" enterkeyhint="next"
            style="grid-column:${f + 1};grid-row:${sd + 2}"
            class="${off ? 'off' : ''}" value="${v ?? ''}" aria-label="Fruit ${f + 1} mesure ${sd + 1}">`;
        }).join('')).join('')}
    </div>

    ${T.weights ? `
    <div class="pal-cap">Poids (g) <span class="mini" data-wcap>${weightCap(pal, group, wst)}</span></div>
    <div class="pal-grid" style="grid-template-columns:repeat(${p.fruits},minmax(0,1fr))">
      ${Array.from({ length: p.fruits }, (_, f) => {
        const v = pal.w?.[f];
        const off = v !== '' && v != null && min != null && Number(v) < min;
        return `<input type="number" inputmode="numeric" step="1" data-w="${f}"
          min="0" enterkeyhint="next"
          class="${off ? 'off' : ''}" value="${v ?? ''}" aria-label="Poids du fruit ${f + 1}">`;
      }).join('')}
    </div>` : ''}
    ${defs.length ? defectsHtml(pal, defs, group) : ''}
  </div>`;
}

/* ---- réception : identité de la palette, défauts, résumé ---- */
const num2 = (v) => String(Math.round(Number(v) * 100) / 100);   // point décimal, comme le reste du rapport

function palletInfoLine(pal) {
  return [pal.variety, pal.boxKg ? `${num2(pal.boxKg)} kg` : '', pal.cal ? `cal. ${pal.cal}` : '',
          pal.cat ? `cat. ${pal.cat}` : '', pal.origin ? countryName(pal.origin) : '',
          pal.boxes ? `${pal.boxes} colis` : ''].filter(Boolean).join(' · ') || 'Informations de la palette';
}
function palletInfoSub(pal) {
  return [pal.ggn ? `GGN ${pal.ggn}` : '', pal.producer, pal.brand ? `marque ${pal.brand}` : ''].filter(Boolean).join(' · ');
}

/* Repliées par défaut : reprises du journal, elles se relisent d'un
   coup d'œil et ne se corrigent qu'à l'occasion. */
function palletInfoHtml(pal, group) {
  const smp = palletDefects({ ...pal, chk: '' }, group, []);
  const f = (k, label, type = 'text', ph = '') => `<label class="pi"><span>${label}</span>
    <input type="${type === 'text' ? 'text' : 'number'}"${type !== 'text' ? ` inputmode="${type}" step="any" min="0"` : ''}
      data-pi="${k}" value="${esc(pal[k] ?? '')}" placeholder="${esc(ph)}"></label>`;
  const sub = palletInfoSub(pal);
  return `<details class="pal-info">
    <summary><span class="pi-main">${esc(palletInfoLine(pal))}</span>
      <span class="pi-sub">${esc(sub)}</span></summary>
    <div class="pi-grid">
      ${f('variety', 'Variété')}
      ${f('boxKg', 'Poids net colis (kg)', 'decimal')}
      ${f('cat', 'Catégorie')}
      ${f('boxes', 'Colis', 'numeric')}
      ${f('brand', 'Marque des colis')}
      ${f('ggn', 'GGN', 'numeric')}
      ${f('producer', 'Producteur')}
      ${f('chk', 'Fruits contrôlés', 'numeric', smp.checked ? String(smp.checked) : 'à saisir')}
    </div>
  </details>`;
}

const lotCut = () => draft.header.pressures?.cut;

/* Légende des défauts externes (ou de tous, sur un rapport d'avant
   la 3.2, où chacun se rapporte aux fruits contrôlés). */
const extCaption = (dd) => dd.checked
  ? `nombre de fruits touchés, sur ${dd.checked} contrôlés`
  : 'nombre de fruits contrôlés inconnu — renseignez-le dans les informations de la palette';

function defectsHtml(pal, defs, group) {
  const dd = palletDefects(pal, group, defs, lotCut());
  const cell = (t) => {
    const base = sampleFor(t, dd), n = Number(pal.d?.[t.key]);
    return `<label class="def ${t.kind === 'loss' ? 'loss' : 'light'}">
      <span>${esc(t.label)}</span>
      <input type="number" inputmode="numeric" step="1" min="0" data-d="${esc(t.key)}" enterkeyhint="next"
        placeholder="0" value="${pal.d?.[t.key] ?? ''}" aria-label="${esc(t.label)}"${
        base && n > base ? ' class="over"' : ''}></label>`;
  };
  const ext = defs.filter(t => t.where !== 'int'), int = defs.filter(t => t.where === 'int');
  /* Rapport d'avant la 3.2, ou produit sans défaut interne : une seule
     grille, rapportée aux fruits contrôlés. */
  if (dd.legacy || !int.length) {
    return `<div class="pal-cap">Défauts <span class="mini" data-dcap>${extCaption(dd)}</span></div>
      <div class="def-grid">${defs.map(cell).join('')}</div>
      <div class="pal-sum" data-psum>${palletSumHtml(pal, group, defs)}</div>`;
  }
  /* Les défauts internes se comptent sur les fruits coupés : 10 par
     palette d'ordinaire, davantage à l'occasion — le nombre se corrige
     ici même, là où on le lit. */
  return `${ext.length ? `<div class="pal-cap">Défauts externes <span class="mini" data-dcap>${extCaption(dd)}</span></div>
      <div class="def-grid">${ext.map(cell).join('')}</div>` : ''}
    <div class="pal-cap cut-cap"><span>Défauts internes</span> <span class="mini">sur</span>
      <input type="number" inputmode="numeric" step="1" min="1" class="cut-in" data-pi="cut"
        value="${esc(pal.cut ?? '')}" placeholder="${esc(lotCut() ?? '')}" aria-label="Fruits coupés de la palette">
      <span class="mini">fruits coupés</span></div>
    <div class="def-grid">${int.map(cell).join('')}</div>
    <div class="pal-sum" data-psum>${palletSumHtml(pal, group, defs)}</div>`;
}

function palletSumHtml(pal, group, defs = defectTypes(group)) {
  const dd = palletDefects(pal, group, defs, lotCut());
  const un = palletUnder(pal, group, draft.header.pressures?.fruits);
  return [
    `ext. <b>${dd.ext}</b> · int. <b>${dd.int}</b>`,
    dd.checked ? `légers <b>${fmtPct(dd.lightPct)} %</b> · pertes <b class="${dd.loss ? 'lossv' : ''}">${fmtPct(dd.lossPct)} %</b>` : '',
    un.weighed && un.min != null
      ? `sous-calibre <b class="${un.under ? 'lossv' : ''}">${un.under}/${un.weighed}</b>${
          un.under ? ` (${un.weights.map(w => Math.round(w)).join(', ')} g)` : ''} · ${fmtPct(un.pct, 0)} %`
      : ''
  ].filter(Boolean).join(' · ');
}

function refreshPalletSum(card, pal) {
  const group = groupById(draft.product_group_id);
  const box = card.querySelector('[data-psum]');
  if (box) box.innerHTML = palletSumHtml(pal, group);
  const dd = palletDefects(pal, group, [], lotCut());
  const cap = card.querySelector('[data-dcap]');
  if (cap) cap.textContent = extCaption(dd);
  /* Plus de fruits touchés que de fruits examinés : la case le dit
     tout de suite (l'enregistrement le refusera). */
  for (const t of defectTypes(group)) {
    const inp = card.querySelector(`[data-d="${CSS.escape(t.key)}"]`);
    if (!inp) continue;
    const base = sampleFor(t, dd), over = !!base && Number(inp.value) > base;
    inp.classList.toggle('over', over);
    inp.title = over ? `Plus que les ${base} fruits ${t.where === 'int' && !dd.legacy ? 'coupés' : 'contrôlés'}` : '';
  }
  const chk = card.querySelector('[data-pi="chk"]');
  if (chk) { const dd = palletDefects({ ...pal, chk: '' }, group, []); chk.placeholder = dd.checked ? String(dd.checked) : 'à saisir'; }
}

/* Indicateurs du lot, sous la liste des palettes — les mêmes que ceux
   du rapport. */
function paintRecSummary() {
  const box = $('#recSum');
  if (!box) return;
  const rs = receptionStats(draft.header.pressures, groupById(draft.product_group_id), draft.type);
  if (!rs.active) { box.innerHTML = ''; return; }
  /* Même couleur que sur la fiche : celle du verdict des critères que
     les défauts remplissent (refreshVerdict vient de le recalculer). Le
     sous-calibre, jugé par aucun critère, se lit directement. */
  const tone = draft.summary?.reception?.tone || {};
  const k = (label, v, t) => `<div class="kpi${t === 'warn' || t === 'fail' ? ' ' + t : ''}"><span>${label}</span><b>${v}</b>${
    KPI_TONE[t] ? `<small>${KPI_TONE[t]}</small>` : ''}</div>`;
  box.innerHTML = `<div class="kpis">
      ${k('Sous-calibre', rs.underPct == null ? '—' : fmtPct(rs.underPct) + ' %', rs.underPct > 0 ? 'warn' : null)}
      ${k('Défauts légers', rs.sampled ? fmtPct(rs.lightPct) + ' %' : '—', rs.sampled ? tone.light : null)}
      ${k('Pertes', rs.sampled ? fmtPct(rs.lossPct) + ' %' : '—', rs.sampled ? tone.loss : null)}
    </div>
    <p class="hint" style="margin:6px 0 0">Sur ${rs.checkedTotal || 0} fruits contrôlés${
      rs.cutTotal ? ` et ${rs.cutTotal} fruits coupés` : ''}${
      rs.fruitsTotal ? ` (${rs.fruitsTotal.toLocaleString('fr-FR')} fruits dans le lot)` : ''} ·
      défauts externes ${rs.extCount} · internes ${rs.intCount}.</p>`;
}

/* Résumé d'une palette : sa moyenne, l'état de cette moyenne face à la
   référence, puis le poids. L'état est écrit — la pastille de couleur
   ne le dit jamais toute seule. */
function resumeHtml(st, wst, sp, p) {
  const sev = st ? palletSeverity(st.avg, sp) : null;
  return [
    st ? `pression <b${sev ? ` style="color:var(--sev-${sev.level})"` : ''}>${fmtP(st.avg)}</b> ${esc(p.unit || 'kg')}` : '',
    sev && (sev.level !== 'ok' || sev.tol)
      ? `<span style="color:var(--sev-${sev.level});font-weight:650">${esc(sev.tol ? SEV_LABEL.tol : SEV_LABEL[sev.level])}</span>` : '',
    wst?.avg != null ? `poids <b>${fmtG(wst.avg)}</b> g` : '',
    wst?.under ? `<span style="color:var(--fail);font-weight:650">${wst.under} sous-calibré${wst.under > 1 ? 's' : ''}</span>` : ''
  ].filter(Boolean).join(' · ') || 'non mesurée';
}

function refreshPalletAvg(card, pal) {
  const p = draft.header.pressures;
  card.querySelector('.avg').innerHTML =
    resumeHtml(palletStats(pal), palletWeighing(pal, groupById(draft.product_group_id), p.fruits), spec(), p);
}

/* Après un changement de référence : les mesures ne bougent pas, mais
   ce qui est « hors zone » change. */
function repaintOff(card, pal) {
  if (!pal) return;
  const sp = spec();
  card.querySelectorAll('[data-v]').forEach(inp => {
    const v = pal.v?.[+inp.dataset.v];
    inp.classList.toggle('off', v !== '' && v != null && outOfZone(v, sp) > OUTLIER);
  });
  refreshPalletAvg(card, pal);
}

function paintPressurePreview() {
  const box = $('#prPreview');
  if (!box) return;
  const p = draft.header.pressures;
  const s = lotStats(p);
  if (!s) { box.innerHTML = '<p class="muted" style="margin:0">Le graphique apparaîtra dès la première mesure.</p>'; return; }
  const sp = spec();
  box.innerHTML = `<div class="muted" style="font-size:12.5px;font-weight:600;margin-bottom:8px">
      Pression moyenne par palette — ${fmtP(s.avg)} ${esc(p.unit || 'kg')} sur l'ensemble du lot${
        sp ? ` · référence ${esc(refText(sp))}` : ''}</div>
    ${pressureChartSVG(p, { spec: sp, unit: p.unit })}`;
}

/* Retrouve ou crée un partenaire à partir du nom saisi : la
   comparaison ignore la casse pour ne pas créer « Mtex NL » à côté de
   « MTEX NL ». */
async function ensurePartner(kind, rawName) {
  const name = rawName.trim();
  const found = state.partners.find(p => p.kind === kind && p.name.toLowerCase() === name.toLowerCase());
  if (found) return found;
  const partner = { id: crypto.randomUUID(), kind, name, active: true };
  await local.put('partners', partner);
  state.partners.push(partner);
  await queue('partner', partner);
  return partner;
}

/* Numérotation lisible : AA-000123, continue sur toute l'équipe. */
async function nextNumber() {
  const all = await local.all('reports');
  const yy = new Date().getFullYear() % 100;
  const max = all.reduce((m, r) => {
    const mm = /^(\d{2})-(\d+)$/.exec(r.report_no || '');
    return (mm && +mm[1] === yy) ? Math.max(m, +mm[2]) : m;
  }, 0);
  return `${String(yy).padStart(2, '0')}-${String(max + 1).padStart(6, '0')}`;
}

async function leave() {
  /* Sur une saisie neuve, plus de « vos saisies seront perdues » :
     elles ne le sont plus, le brouillon reste. Sur la modification
     d'un rapport déjà enregistré, en revanche, il n'y a pas de
     brouillon où se replier — la question garde tout son sens. */
  const written = await keepDraftNow();
  const isDraft = !!draft?._draft;
  /* Si le brouillon n'a PAS pu être écrit, la sortie n'est plus sans
     conséquence : on pose la même question que sur un rapport déjà
     enregistré, plutôt que de promettre une reprise qui n'existe pas. */
  if (dirty && (!isDraft || !written) && !(await confirmSheet(
        'Quitter sans enregistrer',
        isDraft ? 'Le brouillon n\'a pas pu être enregistré sur cet appareil : la saisie en cours sera perdue.'
                : 'Ce rapport est déjà enregistré : les modifications en cours seront perdues.',
        { okLabel: 'Quitter' }))) return;
  const kept = dirty && isDraft && written;
  dirty = false;
  back('#/');
  if (kept) toast('Brouillon conservé — reprenez quand vous voulez', '', { ms: 4000 });
}

const toLocalInput = (iso) => {
  const d = new Date(iso), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
