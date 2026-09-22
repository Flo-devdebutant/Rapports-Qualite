/* ------------------------------------------------------------------
   Saisie d'un rapport (réception ou expédition).
   Choix de conception : une seule page avec des sections repliables
   plutôt qu'un assistant pas-à-pas. Un inspecteur ne remplit jamais
   les critères dans l'ordre — il note ce qu'il voit en ouvrant les
   colis — et il doit pouvoir revenir sur une valeur sans reparcourir
   cinq écrans.
   ------------------------------------------------------------------ */

import { state, shell, groupById, go, back } from './app.js';
import { local, queue, sync, forgetPhotos } from './store.js';
import { flatFields, fieldStatus, computeSummary, applyComputed,
         VERDICT_STATUS, QUALITY_STATUS, SHELF_STATUS } from './verdict.js';
import { COUNTRIES_FR, countryName } from './countries.js';
import { pressureConfig, palletStats, lotStats, hasPressures, fmtP,
         weightStats, weightLotStats, calibreMin, fmtG,
         refSpec, partnerRef, palletSeverity, refText, outOfZone,
         SEV_COLOR, SEV_LABEL, SEV_STEPS, RANGE_TOL, LIMITS, clampP } from './pressure.js';
import { pressureChartSVG } from './pressure-chart.js';
import { reportType, PACKAGING_KINDS, appliesTo, isHidden, fieldLive } from './report-types.js';
import { $, $$, esc, icon, toast, confirmSheet, compressImage, stars, pickSheet } from './ui.js';
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
      Un administrateur doit les créer dans Réglages &gt; Produits &amp; critères.</p></div>`,
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
  draft.measures = applyComputed(group, draft.measures);
  draft.summary = computeSummary(group, draft.measures, draft.header.pressures, draft.type);
  const s = draft.summary;

  shell(T.title, `
   <div class="form-wrap">
    <!-- Verdict, calculé en direct : l'inspecteur voit tout de suite
         l'effet de chaque mesure, il n'a pas à attendre la validation.
         Collant en haut sur téléphone, en colonne de droite sur
         ordinateur — où il reste visible sans voler de hauteur. -->
    <aside class="form-side"><div class="card pad stick" id="verdict">${verdictHtml(s)}</div></aside>
    <div class="form-main">
    ${resumed ? `<div class="resume-box">
      <span>Brouillon repris — saisie enregistrée automatiquement.</span>
      <button type="button" class="linkish" id="freshStart">Repartir d'un rapport vierge</button>
    </div>` : ''}

    <details class="sec" open>
      <summary>Général ${caret()}</summary>
      <div class="body grid2">
        <div class="field"><label for="fdate">Date et heure du contrôle</label>
          <input type="datetime-local" id="fdate" value="${toLocalInput(draft.report_date)}"></div>

        <div class="field"><label for="fgroup">Groupe de produit</label>
          <select id="fgroup">${choices.map(g =>
            `<option value="${esc(g.id)}"${g.id === draft.product_group_id ? ' selected' : ''}>${esc(g.config?.icon || '')} ${esc(g.name)}</option>`).join('')}
          </select></div>

        <div class="field span2"><label for="fpartner">${T.partnerLabel}</label>
          <input type="text" id="fpartner" list="partnerList" placeholder="Nom du ${T.partnerLabel.toLowerCase()}"
                 value="${esc(draft.partner_name || '')}" autocomplete="off">
          <datalist id="partnerList">${state.partners
            .filter(p => p.kind === T.partnerKind)
            .map(p => `<option value="${esc(p.name)}">`).join('')}</datalist>
          <div class="hint">Un nouveau nom est ajouté au carnet à l'enregistrement.</div></div>

        <div class="row2">
          <div class="field"><label for="fdept">Département / dépôt</label>
            <input type="text" id="fdept" list="deptList" value="${esc(draft.header.department || '')}">
            <datalist id="deptList">${(state.settings.departments || []).map(d => `<option value="${esc(d)}">`).join('')}</datalist></div>
          <div class="field"><label for="fvariety">Variété</label>
            <input type="text" id="fvariety" list="varList" value="${esc(draft.header.variety || '')}">
            <datalist id="varList">${(group?.config?.varieties || []).map(v => `<option value="${esc(v)}">`).join('')}</datalist></div>
        </div>

        <!-- Un même lot ou BL mélange couramment plusieurs calibres, et
             souvent plusieurs origines : l'origine appartient donc à la
             ligne, pas au rapport. Les totaux de la section
             Palettisation se déduisent de ces lignes, ce qui évite une
             double saisie et permet de désigner précisément l'origine
             ou le calibre en cause dans une réclamation. -->
        <div class="field span2">
          <label>Détail du lot</label>
          <datalist id="calList">${(group?.config?.calibres || []).map(v => `<option value="${esc(v)}">`).join('')}</datalist>
          <div id="calRows"></div>
          <button type="button" class="btn ghost sm" id="calAdd" style="margin-top:8px">${icon('plus')} Ajouter une ligne</button>
          <div class="hint" id="calSum"></div>
        </div>

        <div class="${T.voyage ? 'row2' : 'field'}">
          <div class="field"><label for="fcarrier">Transporteur</label>
            <input type="text" id="fcarrier" list="carrierList" autocomplete="off"
                   value="${esc(draft.header.carrier || '')}" placeholder="Nom du transporteur">
            <datalist id="carrierList">${state.partners
              .filter(p => p.kind === 'transporteur')
              .map(p => `<option value="${esc(p.name)}">`).join('')}</datalist></div>
          ${T.voyage ? `
          <!-- Le n° de voyage identifie l'acheminement chez le
               transporteur ; il n'a de sens qu'à l'arrivée. -->
          <div class="field"><label for="fload">N° de Voyage</label>
            <input type="text" id="fload" value="${esc(draft.header.voyage || draft.header.load_id || '')}"></div>` : ''}
        </div>

        <div class="row2">
          <!-- À la réception on trace le lot fournisseur ; en expédition
               comme en production, c'est le bon de livraison. -->
          <div class="field"><label for="flot">${T.refLabel}</label>
            <input type="text" id="flot" value="${esc(draft.header[T.refKey] || '')}"
                   placeholder="${esc(T.refPlaceholder)}"></div>
          <div class="field"><label for="fcat">Catégorie</label>
            <select id="fcat"><option value="">—</option>
              ${(group?.config?.categories || ['Extra','I','II']).map(c =>
                `<option${c === draft.header.category ? ' selected' : ''}>${esc(c)}</option>`).join('')}
            </select></div>
        </div>

        ${T.packaging ? `
        <div class="field"><label for="fpack">Conditionnement</label>
          <select id="fpack"><option value="">—</option>
            ${PACKAGING_KINDS.map(k =>
              `<option${k === draft.header.packaging_kind ? ' selected' : ''}>${esc(k)}</option>`).join('')}
          </select></div>` : ''}

        <div class="field span2"><label for="fbad">Palette problématique</label>
          <input type="text" id="fbad" value="${esc(draft.header.bad_pallet || '')}" placeholder="N° de la palette en cause"></div>
      </div>
    </details>

    ${(group?.config?.sections || [])
        .filter(sec => !isHidden(sec) && appliesTo(sec, draft.type))
        .map(sec => sectionHtml(sec)).join('')}

    <!-- Optionnel : le relevé au pénétromètre, palette par palette.
         Le lot arrive le plus souvent homogène à la pression de
         référence ; le bouton de remplissage traite ce cas en un geste
         et la saisie manuelle sert aux palettes qui sortent du lot. -->
    <details class="sec" ${hasPressures(draft.header) ? 'open' : ''}>
      <summary>${T.weights ? 'Contrôle par palette' : 'Pressions'}
        <span class="count" id="prCount"></span> ${caret()}</summary>
      <div class="body" id="prBody"></div>
    </details>

    <details class="sec" open>
      <summary>Remarques ${caret()}</summary>
      <div class="body">
        <textarea id="fremarks" placeholder="Observations libres — reprises telles quelles dans le PDF.">${esc(draft.remarks || '')}</textarea>
      </div>
    </details>

    <details class="sec" open>
      <summary>Photos <span class="count" id="phCount">${draft.photos.length}</span> ${caret()}</summary>
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

    <div class="sticky-actions">
      <button class="btn ghost" id="cancel">Annuler</button>
      <button class="btn" id="save">Enregistrer</button>
    </div>`,
    { back: () => leave(), onMount: wire });
}

const caret = () => `<span class="caret">▾</span>`;

function verdictHtml(s) {
  if (s.pending) {
    return `<div class="muted" style="display:flex;align-items:center;gap:9px">
      <span class="dot none"></span>
      Le verdict apparaîtra ici dès la première mesure saisie.</div>`;
  }
  const p = (label, value, cls) =>
    `<div style="flex:1;min-width:90px"><div class="muted" style="font-size:11px">${label}</div>
     <span class="pill ${cls}" style="margin-top:4px">${esc(value)}</span></div>`;
  return `
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-start">
      ${p('Qualité', s.quality, QUALITY_STATUS[s.quality])}
      ${p('Conservabilité', s.shelf, SHELF_STATUS[s.shelf])}
      ${p('Évaluation', s.verdict, VERDICT_STATUS[s.verdict])}
      <div style="flex:1;min-width:90px"><div class="muted" style="font-size:11px">%NC</div>
        <div style="font-weight:700;font-size:17px;margin-top:2px">${s.nc == null ? '—' : s.nc + ' %'}</div></div>
    </div>
    <div style="margin-top:10px;display:flex;align-items:center;gap:10px">
      ${stars(s.stars)}
      <span class="muted">tolérance ${s.tolerance} % · ${s.fails} hors seuil · ${s.warns} à surveiller</span>
    </div>`;
}

function sectionHtml(sec) {
  /* Une section peut ne garder qu'une partie de ses critères selon le
     type de rapport ; le décompte doit suivre, sinon « 0/12 » sur une
     section qui n'en montre que trois. */
  const fields = (sec.fields || []).filter(f => fieldLive(sec, f, draft.type));
  if (!fields.length) return '';
  const done = fields.filter(f => draft.measures[f.key] !== undefined && draft.measures[f.key] !== '').length;
  return `<details class="sec"${done ? ' open' : ''} data-sec="${esc(sec.id)}">
    <summary>${esc(sec.label)} <span class="count">${done}/${fields.length}</span> ${caret()}</summary>
    <div class="body crits">${fields.map(f => fieldHtml(f)).join('')}</div>
  </details>`;
}

function fieldHtml(f) {
  const v = draft.measures[f.key];
  const st = fieldStatus(f, v);
  const dot = `<span class="dot ${st || 'none'}" data-dot="${esc(f.key)}"></span>`;
  const hint = f.hint ? `<small>${esc(f.hint)}</small>` : '';
  const label = `<span class="lb">${esc(f.label)}${f.unit && f.type !== 'choice' && f.type !== 'bool' ? ` <span class="muted">(${esc(f.unit)})</span>` : ''}${hint}</span>`;

  if (f.type === 'bool') {
    return `<div class="crit" data-key="${esc(f.key)}">${dot}${label}
      <span class="in"><span class="seg yn">
        <button type="button" data-v="1" aria-pressed="${v === true}">Conf.</button>
        <button type="button" data-v="0" aria-pressed="${v === false}">Non</button>
      </span></span></div>`;
  }
  if (f.type === 'choice') {
    return `<div class="crit wide" data-key="${esc(f.key)}">${dot}${label}
      <span class="in"><select><option value="">—</option>
        ${f.options.map(o => `<option value="${esc(o.v)}"${o.v === v ? ' selected' : ''}>${esc(o.v)}</option>`).join('')}
      </select></span></div>`;
  }
  const computed = !!f.computed;
  return `<div class="crit" data-key="${esc(f.key)}">${dot}${label}
    <span class="in"><input type="number" inputmode="decimal" step="${f.step || 0.01}"
      value="${v ?? ''}" placeholder="—"${computed ? ' data-computed="1"' : ''}></span></div>`;
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
  $('#flot').oninput     = (e) => set(reportType(draft.type).refKey, e.target.value);
  const packEl = $('#fpack');
  if (packEl) packEl.onchange = (e) => {
    set('packaging_kind', e.target.value);
    /* Le cahier des charges d'un client dépend souvent du
       conditionnement : une barquette ne se vend pas à la même
       fermeté qu'un vrac. */
    if (draft.header.pressures && applyClientRef()) paintPressures();
  };
  $('#fbad').oninput     = (e) => set('bad_pallet', e.target.value);
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
    for (const file of files) {
      if (draft.photos.length >= 12) { toast('12 photos maximum', 'err'); break; }
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
  draft.measures = applyComputed(group, draft.measures);

  for (const f of flatFields(group, draft.type)) {
    const dot = document.querySelector(`[data-dot="${CSS.escape(f.key)}"]`);
    if (dot) dot.className = 'dot ' + (fieldStatus(f, draft.measures[f.key]) || 'none');
    if (f.computed && f.key !== changedKey) {
      const inp = document.querySelector(`.crit[data-key="${CSS.escape(f.key)}"] input`);
      if (inp && !draft.measures['_manual_' + f.key]) inp.value = draft.measures[f.key] ?? '';
    }
  }
  const sec = document.querySelector(`.crit[data-key="${CSS.escape(changedKey)}"]`)?.closest('details');
  if (sec) {
    const id = sec.dataset.sec;
    const def = group.config.sections.find(s => s.id === id);
    if (def) {
      const fs = (def.fields || []).filter(f => fieldLive(def, f, draft.type));
      sec.querySelector('.count').textContent =
        `${fs.filter(f => draft.measures[f.key] !== undefined && draft.measures[f.key] !== '').length}/${fs.length}`;
    }
  }
  refreshVerdict();
}

/* Le verdict se recalcule aussi bien sur un critère que sur une
   pression : une palette qui s'écarte de la référence change
   l'évaluation, l'inspecteur doit le voir au moment où il la saisit. */
function refreshVerdict() {
  const group = groupById(draft.product_group_id);
  draft.summary = computeSummary(group, draft.measures, draft.header.pressures, draft.type);
  const box = $('#verdict');
  if (box) box.innerHTML = verdictHtml(draft.summary);
}

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
  for (const [i, p] of draft.photos.entries()) {
    const cell = document.createElement('div');
    cell.className = 'ph';
    // À la réouverture d'un rapport déjà synchronisé, la photo n'est
    // plus sur l'appareil : on la relit via un lien signé.
    const rec = p.localId ? await local.get('photos', p.localId) : null;
    const src = rec ? URL.createObjectURL(rec.blob)
                    : (p.uploaded ? (await storage.signedUrl(p.path)) || '' : '');
    if (me !== photoPaint) { if (rec) URL.revokeObjectURL(src); return; }
    if (rec) photoUrls.push(src);
    cell.innerHTML = `<img alt="Photo ${i + 1}" src="${src}"${
      src ? '' : ' hidden'}><button type="button" aria-label="Supprimer">×</button>`;
    if (!src) cell.insertAdjacentHTML('afterbegin', '<span class="ph-miss">indisponible hors ligne</span>');
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
  for (const [id, ic, label] of [['#phCam', 'camera', 'Photo'], ['#phLib', 'image', 'Galerie']]) {
    const add = document.createElement('button');
    add.type = 'button'; add.className = 'photo-add';
    add.innerHTML = `${icon(ic)}<span>${label}</span>`;
    add.onclick = () => $(id).click();
    grid.appendChild(add);
  }
  const c = $('#phCount'); if (c) c.textContent = draft.photos.length;
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
  if (!dirty && !draft._draftAt) return true;
  return writeDraft();
}

/* ----------------------------- sauvegarde ----------------------------- */
async function save() {
  if (!draft.partner_name?.trim())
    return toast(`Indiquez le ${reportType(draft.type).partnerLabel.toLowerCase()}`, 'err');

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
    if (draft.header.pressures && !hasPressures(draft.header)) delete draft.header.pressures;

    const group = groupById(draft.product_group_id);
    draft.measures = applyComputed(group, draft.measures);
    draft.summary = computeSummary(group, draft.measures, draft.header.pressures, draft.type);
    draft.criteria_snapshot = group?.config || null;   // fige la grille utilisée : un rapport reste lisible même si les seuils changent plus tard
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

    await queue('report', { id: draft.id });
    await local.meta('lastForm', { product_group_id: draft.product_group_id, department: draft.header.department });

    dirty = false;
    sync({ silent: true });
    toast(navigator.onLine ? 'Rapport enregistré' : 'Enregistré — envoi au retour du réseau');
    go('#/report/' + draft.id);
  } catch (e) {
    toast(e.message || 'Enregistrement impossible', 'err');
    btn.disabled = false; btn.textContent = 'Enregistrer';
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
  /* Le repli sur la référence du produit ne vaut qu'à la CRÉATION du
     bloc. Le réappliquer à chaque passage remettait 13 dans un champ
     que l'inspecteur venait d'effacer, tout en l'étiquetant « ajustée
     à la main » — une valeur que personne n'avait saisie, présentée
     comme une décision humaine. */
  if (p.mode === 'target' && p.ref == null && p.refSource !== 'manuel') p.ref = cfg.ref;
  applyClientRef();
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
  if (p.refSource === 'client')
    return `D'après le carnet — ${esc(p.refClient || '')}${p.refScope ? ` · ${esc(p.refScope)}` : ''}.`;
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
      <p class="hint">Dans la plage : conforme. ${RANGE_TOL} point de débordement toléré ;
         au-delà, l'écart est critique et la palette non conforme.</p>`
    : `
      <div class="ref-in">
        <label>Cible <input type="number" inputmode="decimal" step="0.1"
          min="${LIMITS.min}" max="${LIMITS.max}" id="prRef" value="${p.ref ?? ''}"></label>
        <span class="u">${esc(p.unit || 'kg')}</span>
      </div>
      <p class="hint">Écart toléré ${SEV_STEPS.ok} point ; jusqu'à ${SEV_STEPS.mineur} l'écart est mineur,
         jusqu'à ${SEV_STEPS.majeur} majeur, au-delà critique.</p>`}
    <p class="hint">Le pénétromètre mesure de ${LIMITS.min} à ${LIMITS.max} ${esc(p.unit || 'kg')} :
       toute valeur hors de cet intervalle est ramenée à la borne.</p>
    <p class="hint" id="prSrc">${refSourceHtml(p)}</p>
    ${s ? `<p class="hint">Le barème ne s'applique qu'à la moyenne de chaque palette, jamais à un fruit isolé.</p>` : ''}
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
  body.innerHTML = `
    <p class="muted" style="margin:0 0 10px">
      ${p.fruits} fruit${p.fruits > 1 ? 's' : ''} prélevé${p.fruits > 1 ? 's' : ''} par palette,
      ${p.sides} mesure${p.sides > 1 ? 's' : ''} de pression chacun${T.weights ? ', plus leur poids' : ''}
      — soit ${n} relevé${n > 1 ? 's' : ''}${T.weights ? ` et ${p.fruits} pesée${p.fruits > 1 ? 's' : ''}` : ''} par palette.
      Section facultative.</p>
    ${refHtml(p)}
    <div class="btn-row" style="margin:12px 0">
      <button type="button" class="btn ghost sm" id="prFill">
        ${icon('check')} Tout à ${fmtP(fillAt).replace('.0', '')} ${esc(p.unit || 'kg')}</button>
      <button type="button" class="btn ghost sm" id="prAdd"${full ? ' disabled' : ''}>${icon('plus')} Palette</button>
      ${p.pallets.length ? `<button type="button" class="btn ghost sm" id="prClear">Tout effacer</button>` : ''}
    </div>
    ${cap ? `<p class="hint" style="margin:-4px 0 10px">${
      full ? `Les ${cap} palettes annoncées dans le détail du lot sont toutes contrôlées.`
           : `${p.pallets.length} palette${p.pallets.length > 1 ? 's' : ''} sur les ${cap} annoncées${
               remainingText() ? ` — reste ${remainingText()}` : ''}.`}</p>` : ''}
    ${overText() ? `<div class="err-box" style="margin:0 0 10px">${esc(overText())}</div>` : ''}
    <div id="prList"></div>
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
      return {
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
  const measures = () => [...list.querySelectorAll('input[data-v],input[data-w]')];
  list.onkeydown = (e) => {
    if (e.key !== 'Enter' || !e.target.matches('input[data-v],input[data-w]')) return;
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
      touch(); paintPressures();
    };
    card.querySelectorAll('[data-w]').forEach(inp => inp.oninput = () => {
      const k = +inp.dataset.w;
      /* Une palette héritée d'une version antérieure à la colonne des
         poids n'a pas de tableau `w` : on le crée plutôt que de lever
         au premier chiffre tapé. */
      (p.pallets[i].w ||= [])[k] = inp.value === '' ? '' : Number(inp.value);
      const min = calibreMin(groupById(draft.product_group_id), p.pallets[i].cal);
      inp.classList.toggle('off', inp.value !== '' && min != null && Number(inp.value) < min);
      touch();
      refreshPalletAvg(card, p.pallets[i]);
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
      };
    });
    card.querySelector('[data-del]').onclick = () => {
      p.pallets.splice(i, 1); touch(); paintPressures();
    };
  });

  const c = $('#prCount');
  if (c) c.textContent = p.pallets.length ? `${p.pallets.length} palette${p.pallets.length > 1 ? 's' : ''}` : '';
  paintPressurePreview();
  refreshVerdict();
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

function palletHtml(pal, i, p) {
  const T = reportType(draft.type);
  const group = groupById(draft.product_group_id);
  const st = palletStats(pal);
  const min = calibreMin(group, pal.cal);
  const wst = weightStats(pal, min);
  const sp = spec();
  const opts = calibreOptions();
  const left = calibreRemaining(i);

  return `<div class="pal" data-i="${i}">
    <div class="pal-top">
      <span class="nm"><input type="text" data-n value="${esc(String(pal.n ?? ''))}" aria-label="N° de palette"></span>
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
    <div class="pal-cap">Poids (g)${min != null ? ` <span class="mini">minimum ${fmtG(min)} g pour le calibre ${esc(pal.cal)}</span>` : ''}</div>
    <div class="pal-grid" style="grid-template-columns:repeat(${p.fruits},minmax(0,1fr))">
      ${Array.from({ length: p.fruits }, (_, f) => {
        const v = pal.w?.[f];
        const off = v !== '' && v != null && min != null && Number(v) < min;
        return `<input type="number" inputmode="numeric" step="1" data-w="${f}"
          min="0" enterkeyhint="next"
          class="${off ? 'off' : ''}" value="${v ?? ''}" aria-label="Poids du fruit ${f + 1}">`;
      }).join('')}
    </div>` : ''}
  </div>`;
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
    wst ? `poids <b>${fmtG(wst.avg)}</b> g` : '',
    wst && wst.under ? `<span style="color:var(--fail);font-weight:650">${wst.under} sous-calibré${wst.under > 1 ? 's' : ''}</span>` : ''
  ].filter(Boolean).join(' · ') || 'non mesurée';
}

function refreshPalletAvg(card, pal) {
  const p = draft.header.pressures;
  const min = calibreMin(groupById(draft.product_group_id), pal.cal);
  card.querySelector('.avg').innerHTML =
    resumeHtml(palletStats(pal), weightStats(pal, min), spec(), p);
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
