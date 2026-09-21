/* ------------------------------------------------------------------
   Saisie d'un rapport (réception ou expédition).
   Choix de conception : une seule page avec des sections repliables
   plutôt qu'un assistant pas-à-pas. Un inspecteur ne remplit jamais
   les critères dans l'ordre — il note ce qu'il voit en ouvrant les
   colis — et il doit pouvoir revenir sur une valeur sans reparcourir
   cinq écrans.
   ------------------------------------------------------------------ */

import { state, shell, groupById, go } from './app.js';
import { local, queue, sync } from './store.js';
import { flatFields, fieldStatus, computeSummary, applyComputed,
         VERDICT_STATUS, QUALITY_STATUS, SHELF_STATUS } from './verdict.js';
import { COUNTRIES_FR, countryName } from './countries.js';
import { pressureConfig, palletStats, lotStats, hasPressures, fmtP,
         weightStats, weightLotStats, calibreMin, fmtG,
         refSpec, partnerRef, palletSeverity, refText, outOfZone,
         SEV_COLOR, SEV_LABEL, SEV_STEPS, RANGE_TOL } from './pressure.js';
import { pressureChartSVG } from './pressure-chart.js';
import { reportType, PACKAGING_KINDS, appliesTo } from './report-types.js';
import { $, $$, esc, icon, toast, confirmSheet, compressImage, stars } from './ui.js';
import { currentUser, storage } from './supa.js';

let draft = null;          // rapport en cours d'édition
let dirty = false;

export async function renderForm({ type, id }) {
  if (!state.groups.length) {
    return shell('Rapport', `<div class="empty"><div class="big">📦</div>
      <p>Aucun groupe de produit n'est encore défini.<br>
      Un administrateur doit les créer dans Réglages &gt; Produits &amp; critères.</p></div>`,
      { back: () => go('#/') });
  }
  if (id) {
    draft = await local.get('reports', id);
    if (!draft) { toast('Rapport introuvable', 'err'); return go('#/feed'); }
    draft = structuredClone(draft);
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
      deleted: false
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

/* Groupes de produit ouverts à ce type de rapport. Le contrôle
   production ne concerne que l'avocat et la mangue ; un groupe absent
   de la base est simplement ignoré. */
function groupChoices(T) {
  if (!T.groups) return state.groups;
  const keep = state.groups.filter(g => T.groups.includes(g.id));
  return keep.length ? keep : state.groups;
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
        .filter(sec => appliesTo(sec, draft.type))
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
        <!-- Pas d'attribut « capture » : il force l'appareil photo et
             interdit la galerie. Or le contrôle se fait d'abord, photos
             comprises, et le rapport se saisit ensuite. Sans lui, le
             téléphone propose les deux (galerie ou prise de vue). -->
        <input type="file" id="phInput" accept="image/*" multiple hidden>
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
  const fields = (sec.fields || []).filter(f => appliesTo(f, draft.type));
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
  const set = (k, v) => { draft.header[k] = v; dirty = true; };

  $('#fdate').onchange   = (e) => { draft.report_date = new Date(e.target.value).toISOString(); dirty = true; };
  /* Choisir le client applique sa référence de pression sans autre
     geste — c'est tout l'intérêt du carnet. La saisie manuelle garde
     toujours la priorité, et un client sans référence enregistrée
     laisse simplement le réglage du produit. */
  $('#fpartner').oninput = (e) => {
    draft.partner_name = e.target.value; dirty = true;
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
    dirty = true; paintCalibres();
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
  $('#fremarks').oninput = (e) => { draft.remarks = e.target.value; dirty = true; };

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
    dirty = true;
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
      dirty = true;
      refresh(key);
    };

    const sel = row.querySelector('select');
    if (sel) sel.onchange = () => { draft.measures[key] = sel.value; dirty = true; refresh(key); };

    row.querySelectorAll('.seg.yn button').forEach(b => b.onclick = () => {
      const val = b.dataset.v === '1';
      draft.measures[key] = draft.measures[key] === val ? '' : val;
      row.querySelectorAll('.seg.yn button').forEach(x =>
        x.setAttribute('aria-pressed', String(draft.measures[key] === (x.dataset.v === '1'))));
      dirty = true; refresh(key);
    });
  });

  paintPressures();
  paintPhotos();
  $('#phInput').onchange = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    for (const file of files) {
      if (draft.photos.length >= 12) { toast('12 photos maximum', 'err'); break; }
      const blob = await compressImage(file);
      const localId = crypto.randomUUID();
      await local.put('photos', { id: localId, blob });
      draft.photos.push({ localId, path: `${draft.id}/${localId}.jpg`, uploaded: false, at: Date.now() });
      dirty = true;
    }
    paintPressures();
  paintPhotos();
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

const originOptions = (sel) => `<option value="">—</option>` +
  COUNTRIES_FR.map(c => `<option value="${c.code}"${c.code === sel ? ' selected' : ''}>${esc(c.fr)}</option>`).join('');

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
        <select data-f="o">${originOptions((r.o || '').toUpperCase())}</select></span>
      <span class="lot-f"><label>Calibre</label>
        <input type="text" list="calList" value="${esc(r.c || '')}" data-f="c"></span>
      <button type="button" class="icon-btn" aria-label="Retirer cette ligne" data-del>${icon('x')}</button>
      <span class="lot-f"><label>Palettes</label>
        <input type="number" inputmode="decimal" step="0.01" value="${r.pal ?? ''}" data-f="pal"></span>
      <span class="lot-f"><label>Colis</label>
        <input type="number" inputmode="numeric" step="1" value="${r.col ?? ''}" data-f="col"></span>
    </div>`).join('');

  box.querySelectorAll('.cal-row').forEach(row => {
    const i = +row.dataset.i;
    row.querySelectorAll('[data-f]').forEach(inp => {
      const f = inp.dataset.f;
      const handler = () => {
        rows[i][f] = (f === 'c' || f === 'o') ? inp.value : (inp.value === '' ? '' : Number(inp.value));
        dirty = true;
        syncCalibreTotals();
      };
      if (inp.tagName === 'SELECT') inp.onchange = handler; else inp.oninput = handler;
    });
    row.querySelector('[data-del]').onclick = () => {
      rows.splice(i, 1);
      if (!rows.length) rows.push({ o: '', c: '', pal: '', col: '' });
      dirty = true;
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

  if (hasPal) draft.measures.pal_count = Math.round(sum('pal') * 100) / 100;
  if (hasCol) draft.measures.col_count = sum('col');

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
    if (inp && draft.measures[key] !== undefined) inp.value = draft.measures[key] ?? '';
  }
  if (hasPal || hasCol) refresh('pal_count');
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
      const fs = (def.fields || []).filter(f => appliesTo(f, draft.type));
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

async function paintPhotos() {
  const grid = $('#photos');
  if (!grid) return;
  grid.innerHTML = '';
  for (const [i, p] of draft.photos.entries()) {
    const cell = document.createElement('div');
    cell.className = 'ph';
    // À la réouverture d'un rapport déjà synchronisé, la photo n'est
    // plus sur l'appareil : on la relit via un lien signé.
    const rec = p.localId ? await local.get('photos', p.localId) : null;
    const src = rec ? URL.createObjectURL(rec.blob)
                    : (p.uploaded ? (await storage.signedUrl(p.path)) || '' : '');
    cell.innerHTML = `<img alt="Photo ${i + 1}" src="${src}"><button type="button" aria-label="Supprimer">×</button>`;
    cell.querySelector('button').onclick = async () => {
      if (!(await confirmSheet('Supprimer la photo', 'Cette photo sera retirée du rapport.'))) return;
      if (p.localId) await local.del('photos', p.localId);
      draft.photos.splice(i, 1); dirty = true; paintPhotos();
    };
    grid.appendChild(cell);
  }
  const add = document.createElement('button');
  add.type = 'button'; add.className = 'photo-add';
  add.innerHTML = `${icon('camera')}<span>Ajouter</span>`;
  add.onclick = () => $('#phInput').click();
  grid.appendChild(add);
  const c = $('#phCount'); if (c) c.textContent = draft.photos.length;
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

    // Un bloc de pressions vide ne part pas en base.
    if (draft.header.pressures && !lotStats(draft.header.pressures)) delete draft.header.pressures;

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

    draft._dirty = true;
    await local.put('reports', draft);
    await queue('report', { id: draft.id });
    await local.meta('lastForm', { product_group_id: draft.product_group_id, department: draft.header.department });

    dirty = false;
    sync({ silent: true });
    toast(navigator.onLine ? 'Rapport enregistré' : 'Enregistré — envoi au retour du réseau');
    go('#/report/' + draft.id);
  } catch (e) {
    toast(e.message, 'err');
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
  if (p.mode === 'target' && p.ref == null) p.ref = cfg.ref;
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
  const before = JSON.stringify([p.mode, p.ref, p.rmin, p.rmax]);
  if (hit.mode === 'range') Object.assign(p, { mode: 'range', rmin: hit.min, rmax: hit.max });
  else Object.assign(p, { mode: 'target', ref: hit.ref });
  p.refSource = 'client';
  p.refClient = hit.name;
  /* On garde la portée exacte de la règle retenue : « Monoprix ·
     Avocat · Vrac » se lit dans le rapport comme dans le PDF, et
     permet de vérifier que c'est bien la bonne ligne qui s'applique. */
  p.refScope = refScopeText(hit);
  p.refPack = hit.packaging || '';
  return before !== JSON.stringify([p.mode, p.ref, p.rmin, p.rmax]) || true;
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
  const back = hit
    ? ` <button type="button" class="linkish" id="prRefBack">${
        p.refSource === 'manuel' ? 'Reprendre celle du client' : 'Appliquer celle du client'}</button>`
    : '';
  return (p.refSource === 'manuel' ? 'Ajustée à la main pour ce rapport.' : 'Valeur par défaut du produit.') + back;
}

function wireRefBack(p) {
  const back = $('#prRefBack');
  if (back) back.onclick = () => { applyClientRef({ force: true }); dirty = true; paintPressures(); };
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
        <label>Mini <input type="number" inputmode="decimal" step="0.1" id="prMin" value="${p.rmin ?? ''}"></label>
        <label>Maxi <input type="number" inputmode="decimal" step="0.1" id="prMax" value="${p.rmax ?? ''}"></label>
        <span class="u">${esc(p.unit || 'kg')}</span>
      </div>
      <p class="hint">Dans la plage : conforme. ${RANGE_TOL} point de débordement toléré ;
         au-delà, l'écart est critique et la palette non conforme.</p>`
    : `
      <div class="ref-in">
        <label>Cible <input type="number" inputmode="decimal" step="0.1" id="prRef" value="${p.ref ?? ''}"></label>
        <span class="u">${esc(p.unit || 'kg')}</span>
      </div>
      <p class="hint">Écart toléré ${SEV_STEPS.ok} point ; jusqu'à ${SEV_STEPS.mineur} l'écart est mineur,
         jusqu'à ${SEV_STEPS.majeur} majeur, au-delà critique.</p>`}
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
  const expected = () => Math.max(1, Math.round(Number(draft.measures.pal_count) || 0));

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
      <button type="button" class="btn ghost sm" id="prAdd">${icon('plus')} Palette</button>
      ${p.pallets.length ? `<button type="button" class="btn ghost sm" id="prClear">Tout effacer</button>` : ''}
    </div>
    <div id="prList"></div>
    ${p.pallets.length ? `<div class="card pad" style="margin-top:12px" id="prPreview"></div>` : ''}`;

  wireRef(p);

  const list = $('#prList');
  list.innerHTML = p.pallets.map((pal, i) => palletHtml(pal, i, p)).join('') ||
    `<p class="muted" style="margin:0">Aucune pression saisie. « Tout à ${fmtP(fillAt).replace('.0','')} »
     crée <span id="prExp">${expected()}</span> palette(s) d'après le nombre saisi en Palettisation.</p>`;

  $('#prFill').onclick = () => {
    const ref = fillValue(p, cfg);
    const count = p.pallets.length || expected();
    p.pallets = Array.from({ length: count }, (_, i) => ({
      n: p.pallets[i]?.n ?? String(i + 1),
      cal: p.pallets[i]?.cal ?? defaultCalibre(),
      v: Array.from({ length: n }, () => ref),
      w: p.pallets[i]?.w ?? Array.from({ length: p.fruits }, () => '')
    }));
    dirty = true; paintPressures();
    toast(`${count} palette${count > 1 ? 's' : ''} à ${fmtP(ref).replace('.0', '')} ${p.unit || 'kg'}`);
  };
  $('#prAdd').onclick = () => {
    p.pallets.push({
      n: String(p.pallets.length + 1), cal: defaultCalibre(),
      v: Array.from({ length: n }, () => ''),
      w: Array.from({ length: p.fruits }, () => '')
    });
    dirty = true; paintPressures();
  };
  const clr = $('#prClear');
  if (clr) clr.onclick = async () => {
    if (!(await confirmSheet('Effacer les pressions', 'Tous les relevés saisis seront supprimés.'))) return;
    p.pallets = []; dirty = true; paintPressures();
  };

  list.querySelectorAll('.pal').forEach(card => {
    const i = +card.dataset.i;
    card.querySelector('[data-n]').oninput = (e) => { p.pallets[i].n = e.target.value; dirty = true; };
    const calSel = card.querySelector('[data-cal]');
    if (calSel) calSel.onchange = () => {
      p.pallets[i].cal = calSel.value; dirty = true; paintPressures();
    };
    card.querySelectorAll('[data-w]').forEach(inp => inp.oninput = () => {
      const k = +inp.dataset.w;
      p.pallets[i].w[k] = inp.value === '' ? '' : Number(inp.value);
      const min = calibreMin(groupById(draft.product_group_id), p.pallets[i].cal);
      inp.classList.toggle('off', inp.value !== '' && min != null && Number(inp.value) < min);
      dirty = true;
      refreshPalletAvg(card, p.pallets[i]);
    });
    card.querySelectorAll('[data-v]').forEach(inp => inp.oninput = () => {
      const k = +inp.dataset.v;
      p.pallets[i].v[k] = inp.value === '' ? '' : Number(inp.value);
      /* Un fruit qui s'écarte nettement de la zone acceptée se signale
         de lui-même pendant la saisie. Ce n'est qu'un repère visuel :
         la gravité, elle, ne se calcule que sur la moyenne. */
      inp.classList.toggle('off', inp.value !== '' && outOfZone(inp.value, spec()) > OUTLIER);
      dirty = true;
      refreshPalletAvg(card, p.pallets[i]);
      paintPressurePreview();
      refreshVerdict();
    });
    card.querySelector('[data-del]').onclick = () => {
      p.pallets.splice(i, 1); dirty = true; paintPressures();
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
  const mark = () => { p.refSource = 'manuel'; dirty = true; };
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
  const ref = $('#prRef');
  if (ref) ref.oninput = () => { p.ref = ref.value === '' ? null : Number(ref.value); mark(); afterRef(); };
  const lo = $('#prMin'), hi = $('#prMax');
  if (lo) lo.oninput = () => { p.rmin = lo.value === '' ? null : Number(lo.value); mark(); afterRef(); };
  if (hi) hi.oninput = () => { p.rmax = hi.value === '' ? null : Number(hi.value); mark(); afterRef(); };
  wireRefBack(p);
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
  const src = $('#prSrc');
  if (src) { src.innerHTML = refSourceHtml(p); wireRefBack(p); }
  paintPressurePreview();
  $$('.pal').forEach(card => repaintOff(card, p.pallets[+card.dataset.i]));
  refreshVerdict();
}

/* Calibres proposés pour une palette : ceux du lot d'abord — c'est ce
   qu'on conditionne — puis le reste de la grille produit. */
function calibreOptions() {
  const group = groupById(draft.product_group_id);
  const fromLot = (draft.header.calibres || []).map(c => c.c).filter(Boolean);
  const all = group?.config?.calibres || [];
  return [...new Set([...fromLot, ...all])];
}
const defaultCalibre = () => calibreOptions()[0] || '';

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

  return `<div class="pal" data-i="${i}">
    <div class="pal-top">
      <span class="nm"><input type="text" data-n value="${esc(String(pal.n ?? ''))}" aria-label="N° de palette"></span>
      ${T.weights ? `<span class="cal"><select data-cal aria-label="Calibre de la palette">
        <option value="">calibre</option>
        ${opts.map(c => `<option${c === pal.cal ? ' selected' : ''}>${esc(c)}</option>`).join('')}
      </select></span>` : ''}
      <span class="avg">${resumeHtml(st, wst, sp, p)}</span>
      <button type="button" class="icon-btn" data-del aria-label="Retirer la palette">${icon('x')}</button>
    </div>

    <div class="pal-cap">Pression (${esc(p.unit || 'kg')})</div>
    <div class="pal-grid" style="grid-template-columns:repeat(${p.fruits},minmax(0,1fr))">
      ${Array.from({ length: p.fruits }, (_, f) => `<span class="fh">F${f + 1}</span>`).join('')}
      ${Array.from({ length: p.sides }, (_, sd) =>
        Array.from({ length: p.fruits }, (_, f) => {
          const k = f * p.sides + sd;
          const v = pal.v?.[k];
          const off = v !== '' && v != null && outOfZone(v, sp) > OUTLIER;
          return `<input type="number" inputmode="decimal" step="0.1" data-v="${k}"
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
  if (dirty && !(await confirmSheet('Quitter sans enregistrer', 'Les saisies non enregistrées seront perdues.', { okLabel: 'Quitter' })))
    return;
  dirty = false;
  go('#/feed');
}

const toLocalInput = (iso) => {
  const d = new Date(iso), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
