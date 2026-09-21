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
import { ORIGINS } from './catalog.js';
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
      product_group_id: last.product_group_id || state.groups[0]?.id || null,
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
  }
  dirty = false;
  paint();
}

function paint() {
  const group = groupById(draft.product_group_id);
  const isRec = draft.type === 'reception';
  draft.measures = applyComputed(group, draft.measures);
  draft.summary = computeSummary(group, draft.measures);
  const s = draft.summary;

  shell(isRec ? 'Rapport de réception' : "Rapport d'expédition", `
    <!-- Verdict, calculé en direct : l'inspecteur voit tout de suite
         l'effet de chaque mesure, il n'a pas à attendre la validation. -->
    <div class="card pad stick" id="verdict">${verdictHtml(s)}</div>

    <details class="sec" open>
      <summary>Général ${caret()}</summary>
      <div class="body">
        <div class="field"><label for="fdate">Date et heure du contrôle</label>
          <input type="datetime-local" id="fdate" value="${toLocalInput(draft.report_date)}"></div>

        <div class="field"><label for="fgroup">Groupe de produit</label>
          <select id="fgroup">${state.groups.map(g =>
            `<option value="${esc(g.id)}"${g.id === draft.product_group_id ? ' selected' : ''}>${esc(g.config?.icon || '')} ${esc(g.name)}</option>`).join('')}
          </select></div>

        <div class="field"><label for="fpartner">${isRec ? 'Fournisseur' : 'Client'}</label>
          <input type="text" id="fpartner" list="partnerList" placeholder="Nom ${isRec ? 'du fournisseur' : 'du client'}"
                 value="${esc(draft.partner_name || '')}" autocomplete="off">
          <datalist id="partnerList">${state.partners
            .filter(p => p.kind === (isRec ? 'fournisseur' : 'client'))
            .map(p => `<option value="${esc(p.name)}">`).join('')}</datalist>
          <div class="hint">Un nouveau nom est ajouté au carnet à l'enregistrement.</div></div>

        <div class="row2">
          <div class="field"><label for="fdept">Département / dépôt</label>
            <input type="text" id="fdept" list="deptList" value="${esc(draft.header.department || '')}">
            <datalist id="deptList">${(state.settings.departments || []).map(d => `<option value="${esc(d)}">`).join('')}</datalist></div>
          <div class="field"><label for="forigin">Origine</label>
            <input type="text" id="forigin" list="originList" value="${esc(draft.header.origin || '')}" placeholder="IL, MA, PE…">
            <datalist id="originList">${ORIGINS.map(o => `<option value="${o}">`).join('')}</datalist></div>
        </div>

        <div class="row2">
          <div class="field"><label for="fvariety">Variété</label>
            <input type="text" id="fvariety" list="varList" value="${esc(draft.header.variety || '')}">
            <datalist id="varList">${(group?.config?.varieties || []).map(v => `<option value="${esc(v)}">`).join('')}</datalist></div>
          <div class="field"><label for="fcalibre">Calibre</label>
            <input type="text" id="fcalibre" list="calList" value="${esc(draft.header.calibre || '')}">
            <datalist id="calList">${(group?.config?.calibres || []).map(v => `<option value="${esc(v)}">`).join('')}</datalist></div>
        </div>

        <div class="row2">
          <div class="field"><label for="forder">Commande</label>
            <input type="text" id="forder" value="${esc(draft.header.order || '')}"></div>
          <div class="field"><label for="fload">Id de chargement</label>
            <input type="text" id="fload" value="${esc(draft.header.load_id || '')}"></div>
        </div>

        <div class="row2">
          <div class="field"><label for="flot">Lot</label>
            <input type="text" id="flot" value="${esc(draft.header.lot || '')}"></div>
          <div class="field"><label for="fcat">Catégorie</label>
            <select id="fcat"><option value="">—</option>
              ${(group?.config?.categories || ['Extra','I','II']).map(c =>
                `<option${c === draft.header.category ? ' selected' : ''}>${esc(c)}</option>`).join('')}
            </select></div>
        </div>

        <div class="field"><label for="fbad">Palette problématique</label>
          <input type="text" id="fbad" value="${esc(draft.header.bad_pallet || '')}" placeholder="N° de la palette en cause"></div>
      </div>
    </details>

    ${(group?.config?.sections || []).map(sec => sectionHtml(sec)).join('')}

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
        <input type="file" id="phInput" accept="image/*" capture="environment" multiple hidden>
      </div>
    </details>

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
  const done = sec.fields.filter(f => draft.measures[f.key] !== undefined && draft.measures[f.key] !== '').length;
  return `<details class="sec"${done ? ' open' : ''} data-sec="${esc(sec.id)}">
    <summary>${esc(sec.label)} <span class="count">${done}/${sec.fields.length}</span> ${caret()}</summary>
    <div class="body">${sec.fields.map(f => fieldHtml(f)).join('')}</div>
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
  $('#fpartner').oninput = (e) => { draft.partner_name = e.target.value; dirty = true; };
  $('#fdept').oninput    = (e) => set('department', e.target.value);
  $('#forigin').oninput  = (e) => set('origin', e.target.value.toUpperCase());
  $('#fvariety').oninput = (e) => set('variety', e.target.value);
  $('#fcalibre').oninput = (e) => set('calibre', e.target.value);
  $('#forder').oninput   = (e) => set('order', e.target.value);
  $('#fload').oninput    = (e) => set('load_id', e.target.value);
  $('#flot').oninput     = (e) => set('lot', e.target.value);
  $('#fbad').oninput     = (e) => set('bad_pallet', e.target.value);
  $('#fcat').onchange    = (e) => set('category', e.target.value);
  $('#fremarks').oninput = (e) => { draft.remarks = e.target.value; dirty = true; };

  $('#fgroup').onchange = async (e) => {
    if (Object.keys(draft.measures).length && !(await confirmSheet(
        'Changer de produit', 'Les mesures déjà saisies ne correspondent plus à cette grille de critères. Les effacer ?',
        { okLabel: 'Changer' }))) { e.target.value = draft.product_group_id; return; }
    draft.product_group_id = e.target.value;
    draft.measures = {};
    dirty = true;
    paint();
  };

  /* Champs notés */
  $$('.crit').forEach(row => {
    const key = row.dataset.key;
    const field = flatFields(groupById(draft.product_group_id)).find(f => f.key === key);
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
    paintPhotos();
  };

  $('#cancel').onclick = () => leave();
  $('#save').onclick = save;
}

/* Recalcule la pastille du champ modifié + les valeurs dérivées. */
function refresh(changedKey) {
  const group = groupById(draft.product_group_id);
  draft.measures = applyComputed(group, draft.measures);

  for (const f of flatFields(group)) {
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
    if (def) sec.querySelector('.count').textContent =
      `${def.fields.filter(f => draft.measures[f.key] !== undefined && draft.measures[f.key] !== '').length}/${def.fields.length}`;
  }
  draft.summary = computeSummary(group, draft.measures);
  $('#verdict').innerHTML = verdictHtml(draft.summary);
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
    return toast(draft.type === 'reception' ? 'Indiquez le fournisseur' : 'Indiquez le client', 'err');

  const btn = $('#save'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span>';
  try {
    const group = groupById(draft.product_group_id);
    draft.measures = applyComputed(group, draft.measures);
    draft.summary = computeSummary(group, draft.measures);
    draft.criteria_snapshot = group?.config || null;   // fige la grille utilisée : un rapport reste lisible même si les seuils changent plus tard
    draft.inspector_name = state.profile?.full_name || '';
    draft.created_by = currentUser()?.id;
    if (!draft.report_no) draft.report_no = await nextNumber();

    /* Carnet d'adresses : on crée le partenaire s'il est nouveau. */
    const kind = draft.type === 'reception' ? 'fournisseur' : 'client';
    let partner = state.partners.find(p => p.kind === kind && p.name.toLowerCase() === draft.partner_name.trim().toLowerCase());
    if (!partner) {
      partner = { id: crypto.randomUUID(), kind, name: draft.partner_name.trim(), active: true };
      await local.put('partners', partner);
      state.partners.push(partner);
      await queue('partner', partner);
    }
    draft.partner_id = partner.id;
    draft.partner_name = partner.name;

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
