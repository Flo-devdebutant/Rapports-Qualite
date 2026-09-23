/* Flux des rapports (liste filtrable) et fiche d'un rapport. */

import { state, shell, groupById, go, back, syncBadge } from './app.js';
import { local, queue, sync, releaseReport } from './store.js';
import { flatFields, statusIn, savedContext, VERDICT_STATUS, QUALITY_STATUS, SHELF_STATUS } from './verdict.js';
import { $, $$, esc, icon, toast, sheet, confirmSheet, stars, fmtDate, debounce, shareFile, download } from './ui.js';
import { buildReportPDF, reportFilename, LANGS } from './report-pdf.js';
import { buildXlsx } from './xlsx.js';
import { storage } from './supa.js';
import { countryName, countryNames } from './countries.js';
import { lotStats, weightLotStats, pressureConfig, fmtP, fmtG,
         pressureVerdict, refSpec, refText, SEV_LABEL } from './pressure.js';
import { pressureChartSVG, pressureTable, weightTable } from './pressure-chart.js';
import { reportType, TYPE_LIST, badPallets } from './report-types.js';
import { receptionStats, fmtPct, KPI_TONE } from './reception.js';
import { palletStats } from './pressure.js';

const filters = { q: '', type: '', group: '', partner: '', verdict: '', from: '', to: '' };

/* La grille à appliquer à un rapport : celle qui a été FIGÉE à son
   enregistrement, jamais la grille vivante du produit. Un rapport de
   mars doit rester lisible — et rééditable à l'identique — même si les
   seuils, les sections ou les critères ont bougé depuis. Une seule
   définition pour l'écran, le PDF et l'Excel : les trois disaient
   autrefois trois choses légèrement différentes. */
export const gridOf = (r, g) =>
  r?.criteria_snapshot ? { config: r.criteria_snapshot, name: g?.name, id: g?.id } : g;

/* ============================== FLUX ============================== */
export async function renderFeed({ refresh = true } = {}) {
  /* Ouvrir le flux, c'est demander « quoi de neuf dans l'équipe ? ».
     On relance donc une synchronisation à chaque entrée : sans cela,
     un rapport saisi par un collègue pouvait n'apparaître qu'au
     réveil périodique, jusqu'à deux minutes plus tard. */
  if (refresh) sync({ silent: true });

  /* Les brouillons restent en dehors du flux : ce sont des saisies en
     cours, pas des rapports. Ils se reprennent depuis l'accueil. */
  const all = (await local.all('reports')).filter(r => !r.deleted && !r._draft)
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
      ${TYPE_LIST.map(T => `<button class="chip" data-f="type" data-v="${T.id}" aria-pressed="${filters.type === T.id}">${esc(T.short)}</button>`).join('')}
      <button class="chip" data-f="verdict" data-v="Non Conforme" aria-pressed="${filters.verdict === 'Non Conforme'}">Non conformes</button>
      ${state.groups.map(g => `<button class="chip" data-f="group" data-v="${esc(g.id)}" aria-pressed="${filters.group === g.id}">${esc(g.config?.icon || '')} ${esc(g.name)}</button>`).join('')}
    </div>
    <p class="muted" style="margin:0 0 10px">${rows.length} rapport${rows.length > 1 ? 's' : ''}${activeFilterCount() ? ' · filtres actifs' : ''}</p>
    <div class="list" id="list">${rows.length ? '' : emptyHtml(all.length)}</div>`,
    { back: () => back('#/'),
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
        if (nb) nb.onclick = () => sheet('Nouveau rapport', `<div class="list">${TYPE_LIST.map(T => `
          <button class="menu-item" data-t="${T.id}"><span class="ic ${T.tone}">${icon(T.icon)}</span>
            <span class="tx"><b>${esc(T.short)}</b><span>${esc(T.subtitle)}</span></span>
            <span class="chev">›</span></button>`).join('')}</div>`,
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
    return [r.partner_name, r.report_no, r.header?.lot, r.header?.bl, r.header?.order, r.header?.load_id,
            r.header?.variety, r.header?.origin, countryNames(originList(r.header), 'fr'),
            r.remarks, groupById(r.product_group_id)?.name]
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
        <span>${esc(reportType(r.type).short)}</span>
        ${r.report_no ? `<span>n° ${esc(r.report_no)}</span>` : ''}
        ${r._dirty ? '<span style="color:var(--warn)">• à envoyer</span>' : ''}
      </div>
      <div class="rep-tags">
        <span class="pill ${QUALITY_STATUS[s.quality] || ''}">${esc(s.quality || '—')}</span>
        <span class="pill ${SHELF_STATUS[s.shelf] || ''}">${esc(s.shelf || '—')}</span>
        <span class="pill ${VERDICT_STATUS[s.verdict] || ''}">${esc(s.verdict || '—')}</span>
        ${s.nc != null ? `<span class="pill">${s.nc} %NC</span>` : ''}
      </div>
      ${livePhotos(r).length ? `<div class="thumbs" data-thumbs="${esc(r.id)}"></div>` : ''}`;
    el.onclick = () => go('#/report/' + r.id);
    list.appendChild(el);
    if (livePhotos(r).length) paintThumbs(r);
  }
}

/* Chaque vignette crée une URL d'objet, et le flux se redessine à
   chaque frappe dans la recherche comme à chaque puce de filtre.
   Sans libération, deux cents rapports et dix frappes retenaient
   plusieurs milliers de JPEG en mémoire jusqu'au rechargement : le
   système finissait par tuer l'application. On libère dès que le
   navigateur a décodé l'image — elle reste affichée. */
const showBlob = (img, url) => {
  img.onload = img.onerror = () => URL.revokeObjectURL(url);
  img.src = url;
};

async function paintThumbs(r) {
  const box = document.querySelector(`[data-thumbs="${CSS.escape(r.id)}"]`);
  if (!box) return;
  for (const p of livePhotos(r).slice(0, 4)) {
    const blob = p.localId ? (await local.get('photos', p.localId))?.blob : null;
    const img = new Image(); img.alt = '';
    if (blob) showBlob(img, URL.createObjectURL(blob));
    else {
      const src = p.uploaded ? await storage.signedUrl(p.path) : null;
      if (!src) continue;
      img.src = src;
    }
    /* La boucle attend la base locale : la liste a pu être redessinée
       entre-temps, et la case n'appartient plus à la page affichée. */
    if (!box.isConnected) { if (blob) URL.revokeObjectURL(img.src); return; }
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
  releaseViewPhotos();   // les URL d'objet de la fiche précédente
  const r = await local.get('reports', id);
  if (!r) { toast('Rapport introuvable', 'err'); return go('#/feed'); }
  const g = groupById(r.product_group_id);
  const s = r.summary || {};
  const m = r.measures || {};
  const T = reportType(r.type);
  const mine = r.created_by === state.profile?.id;
  const canEdit = state.profile?.role === 'admin' || (state.profile?.role === 'inspecteur' && mine);

  const grid = gridOf(r, g);
  const fields = flatFields(grid || {}, r.type);
  /* Pastilles lues comme le verdict les a comptées : une dureté ou un
     stade validés par la référence client ne s'affichent pas en défaut. */
  const judged = savedContext(s);
  const bySection = new Map();
  for (const f of fields) {
    if (m[f.key] === '' || m[f.key] == null) continue;
    if (!bySection.has(f.sectionLabel)) bySection.set(f.sectionLabel, []);
    bySection.get(f.sectionLabel).push(f);
  }

  shell(T.title, `
    <div class="card pad">
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px">
        <span class="pill ${QUALITY_STATUS[s.quality] || ''}">Qualité : ${esc(s.quality || '—')}</span>
        <span class="pill ${SHELF_STATUS[s.shelf] || ''}">Conservabilité : ${esc(s.shelf || '—')}</span>
        <span class="pill ${VERDICT_STATUS[s.verdict] || ''}">${esc(s.verdict || '—')}</span>
      </div>
      <div style="display:flex;align-items:center;gap:12px">
        ${stars(s.stars)}
        <span class="muted">%NC ${s.nc == null ? '—' : s.nc + ' %'} · tolérance ${s.tolerance ?? 10} %</span>
      </div>
    </div>

    <div class="card pad" style="margin-top:12px">
      ${kv('Date', fmtDate(r.report_date))}
      ${r.report_no ? kv('N° de rapport', r.report_no) : ''}
      ${kv(T.partnerLabel, r.partner_name)}
      ${kv('Produit', [g?.name, r.header?.variety].filter(Boolean).join(' '))}
      ${originList(r.header).length ? kv(originList(r.header).length > 1 ? 'Origines' : 'Origine',
          countryNames(originList(r.header), 'fr')) : ''}
      ${calibreRows(r)}
      ${r.header?.department ? kv('Département', r.header.department) : ''}
      ${r.header?.carrier ? kv('Transporteur', r.header.carrier) : ''}
      ${(reportType(r.type).voyage && (r.header?.voyage || r.header?.load_id))
          ? kv('N° de Voyage', r.header.voyage || r.header.load_id) : ''}
      ${r.header?.order ? kv('Commande', r.header.order) : ''}
      ${r.header?.lot ? kv('N° de lot', r.header.lot) : ''}
      ${r.header?.arrival ? kv('Date de réception', fmtWall(r.header.arrival)) : ''}
      ${r.header?.truck ? kv('N° de camion', r.header.truck) : ''}
      ${r.header?.bl ? kv('N° de BL', r.header.bl) : ''}
      ${r.header?.packaging_kind ? kv('Conditionnement', r.header.packaging_kind) : ''}
      ${r.header?.category ? kv('Catégorie', r.header.category) : ''}
      ${badPallets(r.header).length ? kv(badPallets(r.header).length > 1 ? 'Palettes problématiques' : 'Palette problématique',
          `${badPallets(r.header).length} — n° ${badPallets(r.header).join(', ')}`) : ''}
      ${kv('Contrôlé par', r.inspector_name || '')}
    </div>

    ${receptionBlock(r, grid)}

    ${[...bySection].map(([label, list]) => `
      <details class="sec" open style="margin-top:12px"><summary>${esc(label)} <span class="caret">▾</span></summary>
        <div class="body">${list.map(f => {
          const st = statusIn(judged, f, m[f.key]);
          const val = f.type === 'bool' ? (isYes(m[f.key]) ? 'Conforme' : 'Non conforme')
                    : `${fmtVal(m[f.key])}${f.unit && f.type !== 'choice' ? ' ' + f.unit : ''}`;
          return kv(f.label, val, st);
        }).join('')}</div></details>`).join('')}

    ${pressureBlock(r, g)}

    ${r.remarks?.trim() ? `<div class="card pad" style="margin-top:12px">
      <div class="muted" style="margin-bottom:6px">Remarques</div>
      <div style="white-space:pre-wrap;font-size:14px">${esc(r.remarks)}</div></div>` : ''}

    ${r.photos?.length ? `<div class="card pad" style="margin-top:12px">
      <div class="muted" style="margin-bottom:6px">Photos (${r.photos.length})</div>
      ${livePhotos(r).length ? '<div class="photo-grid" id="viewPhotos"></div>' : ''}
      ${archivedNote(r)}</div>` : ''}

    <div class="sticky-actions">
      <button class="btn ghost" id="pdfBtn">${icon('down')} Télécharger</button>
      <button class="btn" id="shareBtn">${icon('share')} Partager</button>
      ${canEdit ? `<button class="icon-btn" id="moreBtn" aria-label="Plus">⋯</button>` : ''}
    </div>`,
    { back: () => back('#/feed'),
      onMount() {
        if (r.photos?.length) paintViewPhotos(r);
        $('#pdfBtn').onclick   = () => exportFlow(r, g, 'download');
        $('#shareBtn').onclick = () => exportFlow(r, g, 'share');
        /* Rapport tout juste enregistré : son PDF est proposé d'office. */
        if (state.pdfOffer === r.id) { state.pdfOffer = null; openPdfOffer(r, g); }
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
                /* Ses photos partent avec lui : sur l'offre gratuite,
                   chaque Mo compte, et plus rien ne les afficherait.
                   Tous les chemins, envoyés ou non : une photo encore en
                   route au moment de la suppression est ainsi rattrapée
                   (supprimer un fichier absent ne coûte rien). */
                await queue('deleteReport', { id: r.id,
                  photos: (r.photos || []).filter(p => !p.archived && p.path).map(p => p.path) });
                sync({ silent: true });
                toast('Rapport supprimé');
                go('#/feed');
              };
            } });
      } });
}

/* Pressions : la courbe d'abord — elle se lit d'un coup d'œil — puis
   le détail chiffré, qui sert de preuve. */
function pressureBlock(r, group) {
  const p = r.header?.pressures;
  const st = lotStats(p);
  const wst = weightLotStats(p, group);
  if (!st && !wst) return '';
  const cfg = { fruits: p.fruits || 5, sides: p.sides || 2 };
  const pv = pressureVerdict(p, group);
  const sp = pv?.spec || refSpec(p, group);
  return `
  ${st ? `<div class="card pad" style="margin-top:12px">
    <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:4px">
      <b style="font-size:14.5px">Pression moyenne par palette</b>
      <span class="muted">${fmtP(st.avg)} ${esc(p.unit || 'kg')} sur le lot ·
        min ${fmtP(st.min)} · max ${fmtP(st.max)} ·
        ${st.count} palette${st.count > 1 ? 's' : ''} · ${st.measures} relevés</span>
    </div>
    ${sp ? `<div class="muted" style="font-size:12.5px;margin-bottom:6px">
      ${sp.mode === 'range' ? 'Plage acceptée' : 'Référence'} <b>${esc(refText(sp))}</b>${
        p.refClient ? ` — ${esc(p.refClient)}${refScope(p) ? ` · ${esc(refScope(p))}` : ''}` :
        p.refSource === 'manuel' ? ' — ajustée pour ce rapport' : ''}</div>` : ''}
    ${pv && pv.worst !== 'ok' ? `<div class="err-box" style="margin:6px 0 8px">
      <b>${nonOk(pv)} palette${nonOk(pv) > 1 ? 's' : ''} hors référence</b> — ${
        ['critique', 'majeur', 'mineur'].filter(l => pv.count[l])
          .map(l => `${pv.count[l]} ${SEV_LABEL[l].toLowerCase()}`).join(', ')}.</div>` : ''}
    ${pressureChartSVG(p, { spec: sp, unit: p.unit })}
    ${pressureTable(p, cfg, sp, new Set(badPallets(r.header)))}
  </div>` : ''}
  ${wst ? `<div class="card pad" style="margin-top:12px">
    <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:4px">
      <b style="font-size:14.5px">Poids par fruit</b>
      <span class="muted">${wst.weighed
        ? `${wst.weighed} fruits pesés (${wst.fruits} par palette)` : `${wst.measures} poids notés`}${
        wst.complete ? ` · moyenne ${fmtG(wst.avg)} g · min ${fmtG(wst.min)} · max ${fmtG(wst.max)}` : ''}</span>
    </div>
    ${!wst.judged
      ? `<div class="muted" style="margin:6px 0 4px">Poids minimum inconnu pour ces calibres : rien n'est jugé.</div>`
      : wst.under
      ? `<div class="err-box" style="margin:6px 0 4px"><b>${wst.under} fruit${wst.under > 1 ? 's' : ''} sous-calibré${wst.under > 1 ? 's' : ''}</b>
           sur ${wst.weighed} pesés — en rouge ci-dessous. Une case vide est un fruit conforme.</div>`
      : `<div class="ok-box" style="margin:6px 0 4px">Aucun fruit sous le poids minimum de son calibre.</div>`}
    ${weightTable(p, cfg, group, new Set(badPallets(r.header)))}
  </div>` : ''}`;
}

const nonOk = (pv) => pv.count.mineur + pv.count.majeur + pv.count.critique;

/* « 2026-09-22T08:38 » → « 22/09/2026 à 08:38 » : l'heure du quai,
   telle que l'ERP l'a notée. */
export const fmtWall = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}${
  s.length > 10 ? ' à ' + s.slice(11, 16) : ''}` : '');
const num2 = (v) => String(Math.round(Number(v) * 100) / 100);   // point décimal, comme le reste du rapport

/* Réception : les trois indicateurs du lot en tête, puis une ligne par
   palette — n° réel, identité, pression, défauts, sous-calibre. Les
   palettes problématiques sont surlignées. */
function receptionBlock(r, grid) {
  if (r.type !== 'reception') return '';
  const p = r.header?.pressures;
  const pals = p?.pallets || [];
  /* Un rapport d'avant le journal n'a ni identité de palette ni
     défauts comptés : rien à détailler de plus que les pressions. */
  const rich = pals.some(x => x.sub || x.ggn || x.variety || x.boxes ||
    Object.values(x.d || {}).some(v => v !== '' && v != null) || (x.w || []).some(v => v !== '' && v != null));
  if (!pals.length || !rich) return '';
  const rs = receptionStats(p, grid, 'reception');
  const k = r.summary?.reception || { under: rs.underPct, light: rs.sampled ? rs.lightPct : null,
                                      loss: rs.sampled ? rs.lossPct : null, checked: rs.checkedTotal, fruits: rs.fruitsTotal };
  const bad = new Set(badPallets(r.header));
  const defs = rs.defs;
  /* La couleur suit le verdict des critères remplis (voir
     receptionTones) ; l'état est aussi écrit, jamais porté par la
     couleur seule. */
  const tone = k.tone || {};
  const kpi = (label, v, t) => `<div class="kpi${t === 'warn' || t === 'fail' ? ' ' + t : ''}"><span>${label}</span><b>${
    v == null ? '—' : fmtPct(v) + ' %'}</b>${KPI_TONE[t] ? `<small>${KPI_TONE[t]}</small>` : ''}</div>`;
  const producers = [...new Map(pals.filter(x => x.ggn || x.producer)
    .map(x => [`${x.ggn}|${x.producer}`, x])).values()];

  return `<div class="card pad" style="margin-top:12px">
    <b style="font-size:14.5px">Indicateurs du lot</b>
    <div class="kpis" style="margin-top:8px">
      ${kpi('Sous-calibre', k.under, tone.under)}${kpi('Défauts légers', k.light, tone.light)}${kpi('Pertes', k.loss, tone.loss)}
    </div>
    ${k.checked ? `<p class="hint" style="margin:8px 0 0">Sur ${k.checked} fruits contrôlés${
      k.fruits ? ` (${Number(k.fruits).toLocaleString('fr-FR')} fruits dans le lot)` : ''}.</p>` : ''}
  </div>

  <div class="card pad" style="margin-top:12px">
    <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
      <b style="font-size:14.5px">Détail par palette</b>
      <span class="muted">${pals.length} palette${pals.length > 1 ? 's' : ''}${
        bad.size ? ` · ${bad.size} problématique${bad.size > 1 ? 's' : ''}, surlignée${bad.size > 1 ? 's' : ''}` : ''}</span>
    </div>
    <div class="ptab-wrap"><table class="ptab">
      <thead><tr><th>Palette</th><th>Variété</th><th class="num">Colis kg</th><th>Cal.</th><th>Cat.</th>
        <th>Marque</th><th>GGN</th><th class="num">Colis</th><th class="num">Pression</th><th class="num">Contrôlés</th>
        ${defs.map(t => `<th class="num">${esc(t.label)}</th>`).join('')}
        <th class="num">Ext.</th><th class="num">Int.</th><th class="num">Pertes %</th>
        <th class="num">Sous-poids</th><th>Poids (g)</th><th class="num">Sous-cal. %</th></tr></thead>
      <tbody>${rs.rows.map(x => {
        const pal = x.p, st = palletStats(pal);
        return `<tr${bad.has(x.n) ? ' class="bad"' : ''}>
          <td>${esc(x.n)}</td><td>${esc(pal.variety || '')}</td>
          <td class="num">${pal.boxKg ? num2(pal.boxKg) : ''}</td><td>${esc(pal.cal || '')}</td><td>${esc(pal.cat || '')}</td>
          <td>${esc(pal.brand || '')}</td><td>${esc(pal.ggn || '')}</td><td class="num">${pal.boxes ?? ''}</td>
          <td class="num">${st ? fmtP(st.avg) : ''}</td><td class="num">${x.def.checked ?? ''}</td>
          ${defs.map(t => `<td class="num">${x.def.counts[t.key] || ''}</td>`).join('')}
          <td class="num">${x.def.ext || ''}</td><td class="num">${x.def.int || ''}</td>
          <td class="num${x.def.loss ? ' lossv' : ''}">${x.def.checked ? fmtPct(x.def.lossPct) : ''}</td>
          <td class="num${x.und.under ? ' lossv' : ''}">${x.und.weighed ? `${x.und.under}/${x.und.weighed}` : ''}</td>
          <td>${x.und.weights.map(w => Math.round(w)).join(', ')}</td>
          <td class="num">${x.und.pct == null ? '' : fmtPct(x.und.pct, 0)}</td></tr>`;
      }).join('')}</tbody></table></div>
    ${producers.length ? `<div class="muted" style="font-size:12px;margin-top:8px">${producers.map(x =>
      `${x.ggn ? `GGN ${esc(x.ggn)}` : ''}${x.ggn && x.producer ? ' — ' : ''}${esc(x.producer || '')}`).join('<br>')}</div>` : ''}
  </div>`;
}

/* Portée de la règle client appliquée. Les rapports d'avant la
   distinction par produit ne portaient que le conditionnement. */
const refScope = (p) => p?.refScope || p?.refPack || '';

/* Origines du rapport, quelle que soit la version qui l'a écrit. */
export function originList(h) {
  if (Array.isArray(h?.origins) && h.origins.length) return h.origins;
  if (Array.isArray(h?.calibres)) {
    const set = [...new Set(h.calibres.map(c => (c.o || '').toUpperCase()).filter(Boolean))];
    if (set.length) return set;
  }
  return h?.origin ? String(h.origin).split(/[,;]\s*/).filter(Boolean) : [];
}

/* Détail ligne par ligne quand le lot en compte plusieurs ou qu'un
   décompte a été saisi ; sinon un simple « Calibre ». */
function calibreRows(r) {
  const cals = r.header?.calibres;
  if (!Array.isArray(cals) || !cals.length)
    return r.header?.calibre ? kv('Calibre', r.header.calibre) : '';
  if (cals.length === 1 && !cals[0].pal && !cals[0].col)
    return cals[0].c ? kv('Calibre', cals[0].c) : '';
  return cals.map(c => kv(
    ['Calibre ' + (c.c || '—'), c.o ? '· ' + countryName(c.o, 'fr') : ''].filter(Boolean).join(' '),
    [c.pal ? `${c.pal} palette${c.pal > 1 ? 's' : ''}` : '', c.col ? `${c.col} colis` : '']
      .filter(Boolean).join(' · ') || '—')).join('');
}

const kv = (k, v, status) => `<div class="kv"><span class="k">${esc(k)}</span>
  <span class="v">${status ? `<span class="dot ${status}"></span>` : ''}${esc(v ?? '')}</span></div>`;
const fmtVal = (v) => typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(2)) : (v ?? '');
/* Un booléen peut revenir du serveur en chaîne selon les allers-retours
   JSON. Sans cette normalisation, l'écran affichait « Non conforme »
   à côté d'une pastille verte, le PDF disait « Conforme » et l'Excel
   sortait la chaîne brute — trois lectures pour une même mesure. */
export const isYes = (v) => v === true || v === 'true' || v === 1 || v === '1';

async function paintViewPhotos(r) {
  const grid = $('#viewPhotos');
  if (!grid) return;
  for (const [i, p] of r.photos.entries()) {
    if (p.archived) continue;
    const blob = p.localId ? (await local.get('photos', p.localId))?.blob : null;
    const src = blob ? URL.createObjectURL(blob) : (p.uploaded ? await storage.signedUrl(p.path) : null);
    if (!src) continue;
    if (!grid.isConnected) { if (blob) URL.revokeObjectURL(src); return; }
    const cell = document.createElement('div');
    cell.className = 'ph';
    cell.innerHTML = `<img alt="Photo ${i + 1}" src="${src}">`;
    /* L'URL sert encore à l'agrandissement : on ne la libère qu'en
       quittant la fiche. */
    viewUrls.push(src);
    cell.onclick = () => sheet('', `<img src="${src}" alt="" style="width:100%;border-radius:12px">`);
    grid.appendChild(cell);
  }
}
/* Photos archivées : retirées de Supabase, elles ne vivent plus que
   dans les PDF de l'archive. Le rapport le dit, avec la date. */
const livePhotos = (r) => (r.photos || []).filter(p => !p.archived);
function archivedNote(r) {
  const a = (r.photos || []).filter(p => p.archived);
  if (!a.length) return '';
  const d = [...new Set(a.map(p => p.archived))].sort().pop();
  return `<p class="hint" style="margin:${livePhotos(r).length ? '8px' : '0'} 0 0">${a.length} photo${
    a.length > 1 ? 's archivées' : ' archivée'} le ${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)} :
    ${a.length > 1 ? 'elles figurent' : 'elle figure'} dans le PDF du rapport, dans l'archive de cette période.</p>`;
}

let viewUrls = [];
export function releaseViewPhotos() {
  for (const u of viewUrls) { if (u.startsWith('blob:')) URL.revokeObjectURL(u); }
  viewUrls = [];
}

async function duplicate(r) {
  const copy = {
    ...structuredClone(r),
    id: crypto.randomUUID(), report_no: null,
    report_date: new Date().toISOString(),
    measures: {}, summary: {}, photos: [], remarks: '',
    _dirty: false,
    /* La copie est une SAISIE EN COURS, pas un rapport. Sans ce
       drapeau, toucher « Dupliquer » puis revenir en arrière publiait
       aussitôt dans le flux de l'équipe un rapport vide, sans verdict
       et impossible à distinguer d'un vrai. */
    _draft: true, _draftAt: Date.now()
  };
  /* « Mesures vierges » vaut aussi pour les palettes : leurs n°,
     calibres et colis restent, pas leurs pressions, pesées ni
     défauts — sans quoi la copie héritait des relevés de l'original. */
  const pal = copy.header?.pressures?.pallets;
  if (Array.isArray(pal)) {
    for (const x of pal) {
      x.v = (x.v || []).map(() => '');
      x.w = (x.w || []).map(() => '');
      x.d = {};
      delete x.chk;
    }
  }
  if (copy.header) { delete copy.header.bad_pallets; delete copy.header.bad_pallet; }
  await local.put('reports', copy);
  go(`#/report/${copy.id}/edit`);
}

/* ------------------------ export d'un rapport ------------------------
   Une seule feuille, une seule touche : le format et la langue sont
   dans la même liste. La version précédente demandait la langue avant
   de savoir ce qu'on voulait en faire, et n'offrait que le PDF —
   l'Excel modifiable n'était accessible que depuis le flux. */
async function exportFlow(r, g, action) {
  const partage = action === 'share';
  const last = (await local.meta('lastLang')) || 'fr';
  const langs = Object.entries(LANGS).sort((a, b) => (b[0] === last) - (a[0] === last));

  sheet(partage ? 'Partager le rapport' : 'Télécharger le rapport', `
    <p class="muted" style="margin:0 0 12px">Le PDF part chez un tiers : choisissez la langue du
      destinataire. L'Excel reste en français, il sert à retravailler les chiffres.</p>
    <div class="list">
      ${langs.map(([k, v]) => `
        <button class="menu-item" data-f="pdf" data-l="${k}">
          <span class="ic n">${icon('pdf')}</span>
          <span class="tx"><b>PDF — ${esc(v)}</b>${k === last ? '<span>Dernière langue utilisée</span>' : ''}</span>
          <span class="chev">›</span></button>`).join('')}
      <button class="menu-item" data-f="xlsx" style="margin-top:6px">
        <span class="ic g">${icon('excel')}</span>
        <span class="tx"><b>Excel — modifiable</b><span>Chiffres et mesures, feuille par feuille</span></span>
        <span class="chev">›</span></button>
    </div>`,
    { onMount(el, close) {
        el.querySelectorAll('[data-f]').forEach(b => b.onclick = async () => {
          close();
          const xlsx = b.dataset.f === 'xlsx';
          toast(xlsx ? 'Préparation du fichier Excel…' : 'Génération du PDF…');
          try {
            let blob, name;
            if (xlsx) {
              blob = buildReportsXlsx([r]);
              name = reportFilename(r, g, 'xlsx');
            } else {
              await local.meta('lastLang', b.dataset.l);
              /* Le PDF se construit sur la grille FIGÉE du rapport, comme
                 l'écran et l'Excel. Lui passer la grille vivante, c'était
                 rééditer en avril un rapport de mars avec les seuils
                 d'avril : une ligne rouge à l'écran disparaissait du
                 document envoyé au client, ou en ressortait verte. */
              /* Relu à l'instant : depuis l'affichage de la fiche, ses
                 photos ont pu partir sur Supabase. */
              const cur = (await local.get('reports', r.id)) || r;
              blob = await buildReportPDF(cur, gridOf(cur, g), { lang: b.dataset.l, company: state.settings.company });
              name = reportFilename(r, g, 'pdf');
            }
            await deliver(blob, name, partage,
              `${state.settings.company} — ${reportType(r.type).title.toLowerCase()} ${r.header?.lot || r.header?.bl || r.report_no || ''}`);
          } catch (e) { toast('Export : ' + e.message, 'err'); }
        });
      } });
}

/* Proposé juste après l'enregistrement : c'est le seul moment où les
   photos existent en PLEINE définition. Ensuite, l'application n'en
   garde qu'une copie allégée (voir LIGHT_PHOTO, store.js) — un PDF
   retéléchargé plus tard sortira avec ces copies. « Non merci », un
   glissement ou un clic à côté referment la proposition ; l'envoi du
   rapport reprend alors. */
async function openPdfOffer(r, g) {
  const full = (r.photos || []).some(p => p.localId && !p.uploaded);
  const last = (await local.meta('lastLang')) || 'fr';
  let lang = LANGS[last] ? last : 'fr';
  let busy = false, closed = false;
  const resume = () => { releaseReport(r.id); sync({ silent: true }); };
  sheet('Rapport enregistré', `
    <p class="muted" style="margin:0 0 12px">${full
      ? `Téléchargez ou partagez le PDF maintenant : c'est la seule version avec les photos en
         pleine définition. L'application n'en garde ensuite qu'une copie allégée.`
      : 'Le PDF du rapport est prêt à partir.'}</p>
    <div class="chips" id="offLang" style="margin-bottom:12px">${Object.entries(LANGS).map(([k, v]) =>
      `<button class="chip" data-l="${k}" aria-pressed="${k === lang}">${esc(v)}</button>`).join('')}</div>
    <div class="btn-row">
      <button class="btn" id="offDl">${icon('down')} Télécharger</button>
      <button class="btn" id="offSh">${icon('share')} Partager</button>
    </div>
    <button class="btn ghost block" id="offNo" style="margin-top:10px">Non merci</button>`,
    { onMount(el, close) {
        el.querySelectorAll('#offLang [data-l]').forEach(b => b.onclick = () => {
          lang = b.dataset.l;
          el.querySelectorAll('#offLang [data-l]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        });
        const send = async (partage) => {
          if (busy) return;
          busy = true;
          el.querySelectorAll('button').forEach(b => { b.disabled = true; });
          toast('Génération du PDF…');
          try {
            await local.meta('lastLang', lang);
            const blob = await buildReportPDF(r, gridOf(r, g), { lang, company: state.settings.company });
            await deliver(blob, reportFilename(r, g, 'pdf'), partage,
              `${state.settings.company} — ${reportType(r.type).title.toLowerCase()} ${r.header?.lot || r.header?.bl || r.report_no || ''}`);
          } catch (e) { toast('Export : ' + e.message, 'err'); }
          busy = false;
          if (closed) resume(); else close();
        };
        el.querySelector('#offDl').onclick = () => send(false);
        el.querySelector('#offSh').onclick = () => send(true);
        el.querySelector('#offNo').onclick = close;
      },
      /* Fermée pendant la génération : les photos locales servent
         encore au PDF, l'envoi attend la fin. */
      onClose() { closed = true; if (!busy) resume(); } });
}

/* Envoi du fichier : partage natif, ou enregistrement sur l'appareil.
   Le message qui suit nomme le fichier — sans quoi un téléchargement
   réussi passe complètement inaperçu sur téléphone. */
async function deliver(blob, name, partage, text) {
  if (partage) {
    const res = await shareFile(blob, name, text);
    if (res === 'downloaded') toast(`Enregistré : ${name}`, '', { ms: 5000 });
    else if (res === 'shared') toast('Rapport partagé');
    return;
  }
  const ok = download(blob, name);
  toast(ok ? `Enregistré dans vos téléchargements : ${name}`
           : `Ouvert dans un nouvel onglet : ${name}`, '', { ms: 5000 });
}

/* ----------------------------- export Excel ----------------------------- */
export function exportXlsx(rows) {
  if (!rows.length) return toast('Rien à exporter', 'err');
  const blob = buildReportsXlsx(rows);
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  download(blob, `Rapports qualité ${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}.xlsx`);
  toast(`${rows.length} rapport${rows.length > 1 ? 's exportés' : ' exporté'}`);
}

/* Le classeur lui-même, sans téléchargement : la fiche d'un rapport
   s'en sert pour livrer un fichier au nom correct. */
export function buildReportsXlsx(rows) {

  const head = ['N°','Date','Type','Groupe','Variété','Calibre','Origine(s)','Partenaire','Département',
                'Commande','Id chargement','N° de lot','N° de BL','Catégorie','Conditionnement','Détail calibres','Qualité','Conservabilité','Évaluation',
                '%NC','Étoiles','Palettes','Colis','Poids net','Température','Contrôleur','Remarques','Photos','Transporteur','N° de Voyage','Palettes problématiques','N° palettes problématiques','Pression moy.','Pression min','Pression max','Palettes mesurées',
                'Référence pression','Palettes hors référence','Écart le plus grave',
                'Date de réception','N° de camion','% sous-calibre','% défauts légers','% pertes','Fruits contrôlés'];
  const main = rows.map(r => {
    const g = groupById(r.product_group_id), s = r.summary || {}, m = r.measures || {}, h = r.header || {};
    return [r.report_no || '', fmtDate(r.report_date), reportType(r.type).short,
      g?.name || '', h.variety || '', h.calibre || '', countryNames(originList(h), 'fr'), r.partner_name || '', h.department || '',
      h.order || '', h.load_id || '', h.lot || '', h.bl || '', h.category || '', h.packaging_kind || '', calibreDetail(h), s.quality || '', s.shelf || '', s.verdict || '',
      s.nc ?? '', s.stars ?? '', num(m.pal_count), num(m.col_count), num(m.pkg_net), num(m.temp_pulp),
      r.inspector_name || '', (r.remarks || '').replace(/\n/g, ' '), r.photos?.length || 0,
      h.carrier || '', h.voyage || h.load_id || '',
      badPallets(h).length || '', badPallets(h).join(' '),
      ...pressureCells(h, g),
      h.arrival ? fmtWall(h.arrival) : '', h.truck || '',
      num(s.reception?.under), num(s.reception?.light), num(s.reception?.loss), num(s.reception?.checked)];
  });

  /* Troisième feuille : une ligne par palette reçue — ce que le
     fournisseur voudra voir, et ce qu'on filtrera par GGN. */
  const pallets = [];
  for (const r of rows) {
    if (r.type !== 'reception' || !r.header?.pressures?.pallets?.length) continue;
    const g = groupById(r.product_group_id);
    const rs = receptionStats(r.header.pressures, gridOf(r, g) || {}, 'reception');
    const bad = new Set(badPallets(r.header));
    if (!pallets.length) pallets.push(['N° rapport', 'Date', 'N° de lot', 'Fournisseur', 'N° palette', 'Sous-lot', 'Variété',
      'Poids net colis (kg)', 'Calibre', 'Catégorie', 'Marque', 'GGN', 'Producteur', 'Origine', 'Colis', 'Pression moy.',
      'Fruits contrôlés', 'Défauts (détail)', 'Défauts externes', 'Défauts internes', '% défauts légers', '% pertes',
      'Fruits pesés', 'Sous-poids', 'Poids sous-calibrés (g)', '% sous-calibre', 'Problématique']);
    for (const x of rs.rows) {
      const pl = x.p, st = palletStats(pl);
      pallets.push([r.report_no || '', fmtDate(r.report_date), r.header.lot || '', r.partner_name || '', x.n, pl.sub || '',
        pl.variety || '', num(pl.boxKg), pl.cal || '', pl.cat || '', pl.brand || '', pl.ggn || '', pl.producer || '',
        pl.origin ? countryName(pl.origin, 'fr') : '', num(pl.boxes), st ? Math.round(st.avg * 100) / 100 : '',
        num(x.def.checked),
        rs.defs.filter(t => x.def.counts[t.key]).map(t => `${t.label} ${x.def.counts[t.key]}`).join(', '),
        x.def.ext, x.def.int,
        x.def.checked ? Math.round(x.def.lightPct * 100) / 100 : '', x.def.checked ? Math.round(x.def.lossPct * 100) / 100 : '',
        x.und.weighed || '', x.und.weighed ? x.und.under : '', x.und.weights.map(w => Math.round(w)).join(' '),
        x.und.pct == null ? '' : Math.round(x.und.pct * 100) / 100, bad.has(x.n) ? 'oui' : '']);
    }
  }

  /* Deuxième feuille : une ligne par mesure, pour croiser les données
     dans un tableau croisé dynamique sans avoir à aplatir soi-même. */
  const detail = [['N° rapport','Date','Partenaire','Groupe','Section','Critère','Valeur','Unité','Statut']];
  for (const r of rows) {
    const g = groupById(r.product_group_id);
    const judged = savedContext(r.summary);
    for (const f of flatFields(gridOf(r, g) || {})) {
      const v = r.measures?.[f.key];
      if (v === '' || v == null) continue;
      detail.push([r.report_no || '', fmtDate(r.report_date), r.partner_name || '', g?.name || '',
        f.sectionLabel, f.label, f.type === 'bool' ? (isYes(v) ? 'Conforme' : 'Non conforme') : v,
        f.unit || '', statusIn(judged, f, v) || '']);
    }
  }

  return buildXlsx([
    { name: 'Rapports', rows: [head, ...main] },
    { name: 'Mesures', rows: detail },
    ...(pallets.length ? [{ name: 'Palettes', rows: pallets }] : [])
  ]);
}
/* Une valeur non convertible sort en cellule VIDE, pas en « NaN » :
   `Number('12,5')` donne NaN, `typeof NaN === 'number'` mais `isFinite`
   échoue, et le tableur affichait alors la chaîne « NaN » dans la
   colonne Poids net. */
const num = (v) => {
  if (v === '' || v == null) return '';
  const n = Number(v);
  return isFinite(n) ? n : '';
};

/* On exporte aussi le verdict de pression : c'est sur cette colonne
   qu'on filtrera les lots à réclamer, pas sur la moyenne brute. */
const pressureCells = (h, group) => {
  const st = lotStats(h?.pressures);
  if (!st) return ['', '', '', '', '', '', ''];
  const pv = pressureVerdict(h?.pressures, group);
  return [round1(st.avg), round1(st.min), round1(st.max), st.count,
    pv ? refText(pv.spec) : '',
    pv ? pv.count.mineur + pv.count.majeur + pv.count.critique : '',
    pv ? (pv.worst === 'ok' ? 'Conforme' : SEV_LABEL[pv.worst]) : ''];
};
const round1 = (v) => Math.round(v * 10) / 10;

/* « 16: 8 pal/2080 col; 18: 12 pal/3120 col » — lisible tel quel dans
   une cellule, et exploitable dans un tableau croisé via la feuille
   Mesures si besoin de plus de finesse. */
const calibreDetail = (h) => Array.isArray(h?.calibres)
  ? h.calibres.map(c => [
      [c.c, c.o ? countryName(c.o, 'fr') : ''].filter(Boolean).join(' / '),
      [c.pal ? c.pal + ' pal' : '', c.col ? c.col + ' col' : ''].filter(Boolean).join('/')
    ].filter(Boolean).join(': ')).join(' ; ')
  : (h?.calibre || '');
