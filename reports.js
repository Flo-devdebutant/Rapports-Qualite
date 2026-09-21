/* Flux des rapports (liste filtrable) et fiche d'un rapport. */

import { state, shell, groupById, go, syncBadge } from '../app.js';
import { local, queue, sync } from '../store.js';
import { flatFields, fieldStatus, VERDICT_STATUS, QUALITY_STATUS, SHELF_STATUS } from '../verdict.js';
import { $, $$, esc, icon, toast, sheet, confirmSheet, stars, fmtDate, debounce, shareFile, download } from '../ui.js';
import { buildReportPDF, pdfFilename, LANGS } from '../report-pdf.js';
import { buildXlsx } from '../xlsx.js';
import { storage } from '../supa.js';

const filters = { q: '', type: '', group: '', partner: '', verdict: '', from: '', to: '' };

/* ============================== FLUX ============================== */
export async function renderFeed({ refresh = true } = {}) {
  /* Ouvrir le flux, c'est demander « quoi de neuf dans l'équipe ? ».
     On relance donc une synchronisation à chaque entrée : sans cela,
     un rapport saisi par un collègue pouvait n'apparaître qu'au
     réveil périodique, jusqu'à deux minutes plus tard. */
  if (refresh) sync({ silent: true });

  const all = (await local.all('reports')).filter(r => !r.deleted)
    .sort((a, b) => new Date(b.report_date) - new Date(a.report_date));
  const rows = applyFilters(all);
  const canWrite = ['admin', 'inspecteur'].includes(state.profile?.role);

  shell('Flux des rapports', `
    <div class="bar">
      <input type="text" class="grow" id="q" placeholder="Rechercher (lot, commande, fournisseur…)" value="${esc(filters.q)}">
      <button class="icon-btn" id="filterBtn" aria-label="Filtres">${icon('search')}</button>
      <button class="icon-btn" id="xlsBtn" aria-label="Export Excel">${icon('excel')}</button>
    </div>
    <div class="chips" style="margin-bottom:12px">
      <button class="chip" data-f="type" data-v="" aria-pressed="${!filters.type}">Tous</button>
      <button class="chip" data-f="type" data-v="reception" aria-pressed="${filters.type === 'reception'}">Réception</button>
      <button class="chip" data-f="type" data-v="expedition" aria-pressed="${filters.type === 'expedition'}">Expédition</button>
      <button class="chip" data-f="verdict" data-v="Non Conforme" aria-pressed="${filters.verdict === 'Non Conforme'}">Non conformes</button>
      ${state.groups.map(g => `<button class="chip" data-f="group" data-v="${esc(g.id)}" aria-pressed="${filters.group === g.id}">${esc(g.config?.icon || '')} ${esc(g.name)}</button>`).join('')}
    </div>
    <p class="muted" style="margin:0 0 10px">${rows.length} rapport${rows.length > 1 ? 's' : ''}${activeFilterCount() ? ' · filtres actifs' : ''}</p>
    <div class="list" id="list">${rows.length ? '' : emptyHtml(all.length)}</div>`,
    { back: () => go('#/'),
      actions: (canWrite ? `<button class="icon-btn" id="newBtn" aria-label="Nouveau">${icon('plus')}</button>` : '') + syncBadge(),
      onMount() {
        $('#q').oninput = debounce(e => { filters.q = e.target.value; renderFeed({ refresh: false }); }, 260);
        $$('.chip').forEach(c => c.onclick = () => {
          filters[c.dataset.f] = filters[c.dataset.f] === c.dataset.v ? '' : c.dataset.v;
          renderFeed({ refresh: false });
        });
        $('#filterBtn').onclick = openFilters;
        $('#xlsBtn').onclick = () => exportXlsx(rows);
        const nb = $('#newBtn');
        if (nb) nb.onclick = () => sheet('Nouveau rapport', `
          <button class="menu-item" data-t="reception"><span class="ic">${icon('down')}</span>
            <span class="tx"><b>Réception</b><span>Contrôle à l'arrivée</span></span><span class="chev">›</span></button>
          <button class="menu-item" data-t="expedition" style="margin-top:10px"><span class="ic g">${icon('share')}</span>
            <span class="tx"><b>Expédition client</b><span>Contrôle avant départ</span></span><span class="chev">›</span></button>`,
          { onMount(el, close) {
              el.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { close(); go('#/report/new/' + b.dataset.t); });
            } });
        paintList(rows);
      } });
}

function emptyHtml(total) {
  return `<div class="empty"><div class="big">📋</div>
    <p>${total ? 'Aucun rapport ne correspond à ces filtres.' : "Aucun rapport pour l'instant.<br>Le premier contrôle démarre depuis l'accueil."}</p></div>`;
}

function applyFilters(all) {
  const q = filters.q.trim().toLowerCase();
  return all.filter(r => {
    if (filters.type && r.type !== filters.type) return false;
    if (filters.group && r.product_group_id !== filters.group) return false;
    if (filters.partner && r.partner_id !== filters.partner) return false;
    if (filters.verdict && r.summary?.verdict !== filters.verdict) return false;
    if (filters.from && r.report_date < filters.from) return false;
    if (filters.to && r.report_date > filters.to + 'T23:59:59') return false;
    if (!q) return true;
    return [r.partner_name, r.report_no, r.header?.lot, r.header?.order, r.header?.load_id,
            r.header?.variety, r.header?.origin, r.remarks, groupById(r.product_group_id)?.name]
      .filter(Boolean).join(' ').toLowerCase().includes(q);
  });
}
const activeFilterCount = () => Object.values(filters).filter(Boolean).length;

async function paintList(rows) {
  const list = $('#list');
  if (!rows.length) return;
  list.innerHTML = '';
  for (const r of rows.slice(0, 200)) {
    const g = groupById(r.product_group_id);
    const s = r.summary || {};
    const el = document.createElement('button');
    el.className = 'rep';
    el.innerHTML = `
      <div class="rep-top">
        <span class="dot ${VERDICT_STATUS[s.verdict] || 'none'}"></span>
        <b>${esc([g?.name, r.header?.variety, r.header?.calibre].filter(Boolean).join(' ') || g?.name || 'Rapport')}</b>
        ${stars(s.stars)}
      </div>
      <div class="rep-meta">
        <span>${esc(r.partner_name || '')}</span>
        <span>${fmtDate(r.report_date)}</span>
        <span>${r.type === 'reception' ? 'Réception' : 'Expédition'}</span>
        ${r.report_no ? `<span>n° ${esc(r.report_no)}</span>` : ''}
        ${r._dirty ? '<span style="color:var(--warn)">• à envoyer</span>' : ''}
      </div>
      <div class="rep-tags">
        <span class="pill ${QUALITY_STATUS[s.quality]}">${esc(s.quality || '—')}</span>
        <span class="pill ${SHELF_STATUS[s.shelf]}">${esc(s.shelf || '—')}</span>
        <span class="pill ${VERDICT_STATUS[s.verdict]}">${esc(s.verdict || '—')}</span>
        ${s.nc != null ? `<span class="pill">${s.nc} %NC</span>` : ''}
      </div>
      ${r.photos?.length ? `<div class="thumbs" data-thumbs="${esc(r.id)}"></div>` : ''}`;
    el.onclick = () => go('#/report/' + r.id);
    list.appendChild(el);
    if (r.photos?.length) paintThumbs(r);
  }
}

async function paintThumbs(r) {
  const box = document.querySelector(`[data-thumbs="${CSS.escape(r.id)}"]`);
  if (!box) return;
  for (const p of r.photos.slice(0, 4)) {
    const blob = p.localId ? (await local.get('photos', p.localId))?.blob : null;
    const src = blob ? URL.createObjectURL(blob) : (p.uploaded ? await storage.signedUrl(p.path) : null);
    if (!src) continue;
    const img = new Image(); img.src = src; img.alt = '';
    box.appendChild(img);
  }
}

function openFilters() {
  sheet('Filtres', `
    <div class="field"><label for="fp">Partenaire</label>
      <select id="fp"><option value="">Tous</option>
        ${state.partners.map(p => `<option value="${esc(p.id)}"${filters.partner === p.id ? ' selected' : ''}>${esc(p.name)} (${p.kind})</option>`).join('')}
      </select></div>
    <div class="field"><label for="fv">Évaluation</label>
      <select id="fv"><option value="">Toutes</option>
        ${['Conforme','Acceptable','Non Conforme'].map(v => `<option${filters.verdict === v ? ' selected' : ''}>${v}</option>`).join('')}
      </select></div>
    <div class="row2">
      <div class="field"><label for="f1">Du</label><input type="date" id="f1" value="${filters.from.slice(0,10)}"></div>
      <div class="field"><label for="f2">Au</label><input type="date" id="f2" value="${filters.to.slice(0,10)}"></div>
    </div>
    <div class="btn-row"><button class="btn ghost" style="flex:1" id="clr">Tout effacer</button>
      <button class="btn" style="flex:1" id="ok">Appliquer</button></div>`,
    { onMount(el, close) {
        el.querySelector('#ok').onclick = () => {
          filters.partner = el.querySelector('#fp').value;
          filters.verdict = el.querySelector('#fv').value;
          filters.from = el.querySelector('#f1').value;
          filters.to = el.querySelector('#f2').value;
          close(); renderFeed({ refresh: false });
        };
        el.querySelector('#clr').onclick = () => {
          Object.keys(filters).forEach(k => filters[k] = '');
          close(); renderFeed({ refresh: false });
        };
      } });
}

/* ============================= FICHE ============================= */
export async function renderReportView(id) {
  const r = await local.get('reports', id);
  if (!r) { toast('Rapport introuvable', 'err'); return go('#/feed'); }
  const g = groupById(r.product_group_id);
  const s = r.summary || {};
  const m = r.measures || {};
  const isRec = r.type === 'reception';
  const mine = r.created_by === state.profile?.id;
  const canEdit = state.profile?.role === 'admin' || (state.profile?.role === 'inspecteur' && mine);

  /* La grille figée à l'enregistrement prime : un rapport de mars doit
     rester lisible même si les seuils ont bougé depuis. */
  const grid = r.criteria_snapshot ? { config: r.criteria_snapshot, name: g?.name } : g;
  const fields = flatFields(grid || {});
  const bySection = new Map();
  for (const f of fields) {
    if (m[f.key] === '' || m[f.key] == null) continue;
    if (!bySection.has(f.sectionLabel)) bySection.set(f.sectionLabel, []);
    bySection.get(f.sectionLabel).push(f);
  }

  shell(isRec ? 'Rapport de réception' : "Rapport d'expédition", `
    <div class="card pad">
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px">
        <span class="pill ${QUALITY_STATUS[s.quality]}">Qualité : ${esc(s.quality || '—')}</span>
        <span class="pill ${SHELF_STATUS[s.shelf]}">Conservabilité : ${esc(s.shelf || '—')}</span>
        <span class="pill ${VERDICT_STATUS[s.verdict]}">${esc(s.verdict || '—')}</span>
      </div>
      <div style="display:flex;align-items:center;gap:12px">
        ${stars(s.stars)}
        <span class="muted">%NC ${s.nc == null ? '—' : s.nc + ' %'} · tolérance ${s.tolerance ?? 10} %</span>
      </div>
    </div>

    <div class="card pad" style="margin-top:12px">
      ${kv('Date', fmtDate(r.report_date))}
      ${r.report_no ? kv('N° de rapport', r.report_no) : ''}
      ${kv(isRec ? 'Fournisseur' : 'Client', r.partner_name)}
      ${kv('Produit', [g?.name, r.header?.variety, r.header?.calibre].filter(Boolean).join(' '))}
      ${r.header?.origin ? kv('Origine', r.header.origin) : ''}
      ${r.header?.department ? kv('Département', r.header.department) : ''}
      ${r.header?.order ? kv('Commande', r.header.order) : ''}
      ${r.header?.load_id ? kv('Id de chargement', r.header.load_id) : ''}
      ${r.header?.lot ? kv('Lot', r.header.lot) : ''}
      ${r.header?.category ? kv('Catégorie', r.header.category) : ''}
      ${r.header?.bad_pallet ? kv('Palette problématique', r.header.bad_pallet) : ''}
      ${kv('Contrôlé par', r.inspector_name || '')}
    </div>

    ${[...bySection].map(([label, list]) => `
      <details class="sec" open style="margin-top:12px"><summary>${esc(label)} <span class="caret">▾</span></summary>
        <div class="body">${list.map(f => {
          const st = fieldStatus(f, m[f.key]);
          const val = f.type === 'bool' ? (m[f.key] === true ? 'Conforme' : 'Non conforme')
                    : `${fmtVal(m[f.key])}${f.unit && f.type !== 'choice' ? ' ' + f.unit : ''}`;
          return kv(f.label, val, st);
        }).join('')}</div></details>`).join('')}

    ${r.remarks?.trim() ? `<div class="card pad" style="margin-top:12px">
      <div class="muted" style="margin-bottom:6px">Remarques</div>
      <div style="white-space:pre-wrap;font-size:14px">${esc(r.remarks)}</div></div>` : ''}

    ${r.photos?.length ? `<div class="card pad" style="margin-top:12px">
      <div class="muted" style="margin-bottom:6px">Photos (${r.photos.length})</div>
      <div class="photo-grid" id="viewPhotos"></div></div>` : ''}

    <div class="sticky-actions">
      <button class="btn ghost" id="pdfBtn">${icon('pdf')} PDF</button>
      <button class="btn" id="shareBtn">${icon('share')} Partager</button>
      ${canEdit ? `<button class="icon-btn" id="moreBtn" aria-label="Plus">⋯</button>` : ''}
    </div>`,
    { back: () => go('#/feed'),
      onMount() {
        if (r.photos?.length) paintViewPhotos(r);
        $('#pdfBtn').onclick   = () => pdfFlow(r, g, 'download');
        $('#shareBtn').onclick = () => pdfFlow(r, g, 'share');
        const mb = $('#moreBtn');
        if (mb) mb.onclick = () => sheet('', `
          <button class="menu-item" id="ed"><span class="ic n">${icon('edit')}</span>
            <span class="tx"><b>Modifier</b></span><span class="chev">›</span></button>
          <button class="menu-item" id="dup" style="margin-top:10px"><span class="ic n">${icon('copy')}</span>
            <span class="tx"><b>Dupliquer</b><span>Même en-tête, mesures vierges</span></span><span class="chev">›</span></button>
          <button class="menu-item" id="del" style="margin-top:10px"><span class="ic n">${icon('trash')}</span>
            <span class="tx"><b>Supprimer</b></span><span class="chev">›</span></button>`,
          { onMount(el, close) {
              el.querySelector('#ed').onclick  = () => { close(); go(`#/report/${r.id}/edit`); };
              el.querySelector('#dup').onclick = () => { close(); duplicate(r); };
              el.querySelector('#del').onclick = async () => {
                close();
                if (!(await confirmSheet('Supprimer le rapport', 'Il disparaîtra pour toute l\'équipe.'))) return;
                await local.del('reports', r.id);
                await queue('deleteReport', { id: r.id });
                sync({ silent: true });
                toast('Rapport supprimé');
                go('#/feed');
              };
            } });
      } });
}

const kv = (k, v, status) => `<div class="kv"><span class="k">${esc(k)}</span>
  <span class="v">${status ? `<span class="dot ${status}"></span>` : ''}${esc(v ?? '')}</span></div>`;
const fmtVal = (v) => typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(2)) : (v ?? '');

async function paintViewPhotos(r) {
  const grid = $('#viewPhotos');
  for (const [i, p] of r.photos.entries()) {
    const blob = p.localId ? (await local.get('photos', p.localId))?.blob : null;
    const src = blob ? URL.createObjectURL(blob) : (p.uploaded ? await storage.signedUrl(p.path) : null);
    if (!src) continue;
    const cell = document.createElement('div');
    cell.className = 'ph';
    cell.innerHTML = `<img alt="Photo ${i + 1}" src="${src}">`;
    cell.onclick = () => sheet('', `<img src="${src}" alt="" style="width:100%;border-radius:12px">`);
    grid.appendChild(cell);
  }
}

async function duplicate(r) {
  const copy = {
    ...structuredClone(r),
    id: crypto.randomUUID(), report_no: null,
    report_date: new Date().toISOString(),
    measures: {}, summary: {}, photos: [], remarks: '',
    _dirty: false
  };
  await local.put('reports', copy);
  go(`#/report/${copy.id}/edit`);
}

/* --------------------------- PDF & partage --------------------------- */
async function pdfFlow(r, g, action) {
  sheet('Langue du rapport', `
    <p class="muted" style="margin:0 0 12px">Le PDF part chez un tiers : choisissez la langue du destinataire.</p>
    <div class="list">${Object.entries(LANGS).map(([k, v]) =>
      `<button class="menu-item" data-l="${k}"><span class="ic n">${k.toUpperCase()}</span>
       <span class="tx"><b>${esc(v)}</b></span><span class="chev">›</span></button>`).join('')}</div>`,
    { onMount(el, close) {
        el.querySelectorAll('[data-l]').forEach(b => b.onclick = async () => {
          close();
          toast('Génération du PDF…');
          try {
            const blob = await buildReportPDF(r, g, { lang: b.dataset.l, company: state.settings.company });
            const name = pdfFilename(r, g);
            if (action === 'share') {
              const res = await shareFile(blob, name,
                `${state.settings.company} — ${r.type === 'reception' ? 'rapport de réception' : "rapport d'expédition"} ${r.header?.lot || r.report_no || ''}`);
              if (res === 'downloaded') toast('PDF téléchargé');
            } else { download(blob, name); toast('PDF téléchargé'); }
          } catch (e) { toast('PDF : ' + e.message, 'err'); }
        });
      } });
}

/* ----------------------------- export Excel ----------------------------- */
export function exportXlsx(rows) {
  if (!rows.length) return toast('Rien à exporter', 'err');

  const head = ['N°','Date','Type','Groupe','Variété','Calibre','Origine','Partenaire','Département',
                'Commande','Id chargement','Lot','Catégorie','Qualité','Conservabilité','Évaluation',
                '%NC','Étoiles','Palettes','Colis','Poids net','Température','Contrôleur','Remarques','Photos'];
  const main = rows.map(r => {
    const g = groupById(r.product_group_id), s = r.summary || {}, m = r.measures || {}, h = r.header || {};
    return [r.report_no || '', fmtDate(r.report_date), r.type === 'reception' ? 'Réception' : 'Expédition',
      g?.name || '', h.variety || '', h.calibre || '', h.origin || '', r.partner_name || '', h.department || '',
      h.order || '', h.load_id || '', h.lot || '', h.category || '', s.quality || '', s.shelf || '', s.verdict || '',
      s.nc ?? '', s.stars ?? '', num(m.pal_count), num(m.col_count), num(m.pkg_net), num(m.temp_pulp),
      r.inspector_name || '', (r.remarks || '').replace(/\n/g, ' '), r.photos?.length || 0];
  });

  /* Deuxième feuille : une ligne par mesure, pour croiser les données
     dans un tableau croisé dynamique sans avoir à aplatir soi-même. */
  const detail = [['N° rapport','Date','Partenaire','Groupe','Section','Critère','Valeur','Unité','Statut']];
  for (const r of rows) {
    const g = groupById(r.product_group_id);
    const grid = r.criteria_snapshot ? { config: r.criteria_snapshot } : g;
    for (const f of flatFields(grid || {})) {
      const v = r.measures?.[f.key];
      if (v === '' || v == null) continue;
      detail.push([r.report_no || '', fmtDate(r.report_date), r.partner_name || '', g?.name || '',
        f.sectionLabel, f.label, typeof v === 'boolean' ? (v ? 'Conforme' : 'Non conforme') : v,
        f.unit || '', fieldStatus(f, v) || '']);
    }
  }

  const blob = buildXlsx([
    { name: 'Rapports', rows: [head, ...main] },
    { name: 'Mesures', rows: detail }
  ]);
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  download(blob, `rapports_qc_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.xlsx`);
  toast(`${rows.length} rapport${rows.length > 1 ? 's exportés' : ' exporté'}`);
}
const num = (v) => (v === '' || v == null) ? '' : Number(v);
