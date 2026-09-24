/* Flux des rapports (liste filtrable) et fiche d'un rapport. */

import { state, shell, groupById, go, back, syncBadge, onLeave, canManage } from './app.js';
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

/* ============================== FLUX ==============================
   Qui, quoi, quel verdict : le partenaire en tête, puis le produit et
   le lot, le verdict en toutes lettres à droite. Les rapports sont
   rangés par jour. Sur ordinateur, la liste devient un tableau : une
   ligne par rapport, colonnes alignées pour parcourir cinquante
   contrôles d'un coup d'œil. */
export function feedFilter(patch = {}) {
  Object.keys(filters).forEach(k => { filters[k] = ''; });
  Object.assign(filters, patch);
}

export async function renderFeed({ refresh = true } = {}) {
  /* Ouvrir le flux, c'est demander « quoi de neuf dans l'équipe ? ».
     On relance donc une synchronisation à chaque entrée : sans cela,
     un rapport saisi par un collègue pouvait n'apparaître qu'au
     réveil périodique, jusqu'à deux minutes plus tard. */
  if (refresh) sync({ silent: true });

  /* Les brouillons restent en dehors du flux : ce sont des saisies en
     cours, pas des rapports. Ils se reprennent depuis l'accueil. */
  feedAll = await feedRows();

  /* La page n'est dessinée qu'une fois ; la recherche et les puces ne
     redessinent que la liste. Redessiner tout l'écran à chaque frappe
     faisait perdre le champ de recherche — et sur téléphone, le clavier
     se refermait au milieu d'un mot. */
  shell('Rapports', `
    <div class="feed-bar">
      <label class="search">${icon('search')}
        <input type="search" id="q" placeholder="Lot, BL, fournisseur, client…" value="${esc(filters.q)}"
               aria-label="Rechercher un rapport" autocomplete="off" enterkeyhint="search"></label>
      <button class="icon-btn" id="filterBtn" aria-label="Plus de filtres">${icon('filter')}<span class="badge" id="fBadge" hidden></span></button>
    </div>
    <div class="chips" id="fChips"></div>
    <div class="feed-count" id="fCount"></div>
    <div id="list"></div>`,
    { tab: 'feed', root: true,
      actions: `<button class="icon-btn" id="xlsBtn" aria-label="Exporter la sélection en Excel" title="Exporter la sélection en Excel">${icon('excel')}</button>` + syncBadge(),
      onMount() {
        const paint = () => paintFeed();
        $('#q').oninput = debounce(e => { filters.q = e.target.value; paint(); }, 200);
        $('#filterBtn').onclick = () => openFilters(paint);
        $('#xlsBtn').onclick = () => exportXlsx(applyFilters(feedAll));
        paint();
      } });
}

/* Rapports de l'équipe, du plus récent au plus ancien. */
let feedAll = [];
const feedRows = async () => (await local.all('reports')).filter(r => !r.deleted && !r._draft)
  .sort((a, b) => new Date(b.report_date) - new Date(a.report_date));

/* Une synchronisation vient d'apporter du neuf : on redessine la liste
   seule. Redessiner l'écran entier refermait le clavier de quelqu'un
   en train de chercher un lot. */
export async function refreshFeed() {
  if (!document.getElementById('list')) return;
  feedAll = await feedRows();
  paintFeed();
}

/* Puces, décompte et liste : tout ce qui dépend des filtres. */
function paintFeed(all = feedAll) {
  const rows = applyFilters(all);
  const count = (f) => all.filter(f).length;
  const chip = (f, v, label, n, ic = '') => `<button class="chip" data-f="${f}" data-v="${esc(v)}" aria-pressed="${
    f === 'type' ? filters.type === v : filters[f] === v}">${ic}${label}${n != null ? ` <span class="n">${n}</span>` : ''}</button>`;
  $('#fChips').innerHTML =
    chip('type', '', 'Tous', all.length) +
    TYPE_LIST.map(T => chip('type', T.id, esc(T.short), count(r => r.type === T.id))).join('') +
    chip('verdict', 'Non Conforme', 'Non conformes', count(r => r.summary?.verdict === 'Non Conforme'), icon('alert')) +
    (state.groups.length > 1 ? state.groups.map(g => chip('group', g.id, `${esc(g.config?.icon || '')} ${esc(g.name)}`)).join('') : '');
  $$('#fChips .chip').forEach(c => c.onclick = () => {
    const f = c.dataset.f;
    filters[f] = f === 'type' ? c.dataset.v : (filters[f] === c.dataset.v ? '' : c.dataset.v);
    paintFeed();
  });
  const adv = ['partner', 'from', 'to'].filter(k => filters[k]).length +
    (filters.verdict && filters.verdict !== 'Non Conforme' ? 1 : 0);
  const badge = $('#fBadge');
  if (badge) { badge.hidden = !adv; badge.textContent = adv || ''; }
  const any = activeFilterCount() > 0;
  $('#fCount').innerHTML = `<span>${rows.length} rapport${rows.length > 1 ? 's' : ''}${any ? ' sur ' + all.length : ''}</span>${
    any ? '<button type="button" class="linkish" id="fClear">Effacer les filtres</button>' : ''}`;
  const clr = $('#fClear');
  if (clr) clr.onclick = () => { const q = $('#q'); if (q) q.value = ''; feedFilter(); paintFeed(); };
  paintList(rows, all.length);
}

function emptyHtml(total) {
  return `<div class="card empty"><div class="ico">${icon(total ? 'search' : 'doc')}</div>
    <p>${total ? 'Aucun rapport ne correspond à ces filtres.' : "Aucun rapport pour l'instant.<br>Le premier contrôle démarre avec le bouton « Nouveau »."}</p></div>`;
}

function applyFilters(all) {
  const q = filters.q.trim().toLowerCase();
  return all.filter(r => {
    if (filters.type && r.type !== filters.type) return false;
    if (filters.group && r.product_group_id !== filters.group) return false;
    if (filters.partner && r.partner_id !== filters.partner) return false;
    if (filters.verdict && r.summary?.verdict !== filters.verdict) return false;
    /* Les dates se comparent en jours de l'heure locale : comparer la
       chaîne UTC écartait un contrôle de 0 h 30 à Châteaurenard, noté la
       veille en temps universel. */
    if ((filters.from || filters.to) && ((filters.from && localDay(r.report_date) < filters.from) ||
        (filters.to && localDay(r.report_date) > filters.to))) return false;
    if (!q) return true;
    return [r.partner_name, r.report_no, r.header?.lot, r.header?.bl, r.header?.order, r.header?.load_id,
            r.header?.variety, r.header?.origin, countryNames(originList(r.header), 'fr'),
            r.remarks, groupById(r.product_group_id)?.name]
      .filter(Boolean).join(' ').toLowerCase().includes(q);
  });
}
const activeFilterCount = () => Object.values(filters).filter(Boolean).length;

/* « 2026-09-24 » : le jour d'une date, à l'heure de l'appareil. */
export const localDay = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

/* Le verdict, son signe et sa couleur — « Non évalué » tant qu'aucun
   critère noté ne permet de trancher (les trois tirets d'avant ne
   disaient rien). */
export const verdictBadge = (s = {}) => s.verdict && !s.pending
  ? `<span class="vb ${VERDICT_STATUS[s.verdict] || ''}"><span class="dot ${VERDICT_STATUS[s.verdict] || 'none'}"></span>${esc(s.verdict)}</span>`
  : '<span class="vb"><span class="dot none"></span>Non évalué</span>';

const hhmm = (iso) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

/* Une carte de rapport : qui, quoi, verdict. Mêmes colonnes que l'en-tête
   du tableau sur ordinateur (voir .feed-head). */
export function reportCard(r, { day = false } = {}) {
  const g = groupById(r.product_group_id), s = r.summary || {}, h = r.header || {};
  const T = reportType(r.type);
  const what = [g?.name, h.variety].filter(Boolean).join(' ');
  const ref = h.lot ? `Lot ${h.lot}` : h.bl ? `BL ${h.bl}` : '';
  const where = countryNames(originList(h), 'fr') || h.calibre || '';
  const nPh = livePhotos(r).length;
  return `<button class="rep rp" data-id="${esc(r.id)}">
    <span class="rp-ic t-${T.id}" title="${esc(T.short)}">${icon(T.icon)}</span>
    <span class="rp-main">
      <span class="rp-who">${esc(r.partner_name || '—')}</span>
      <span class="rp-what">${esc([what, ref].filter(Boolean).join(' · ') || T.short)}</span>
      <span class="rp-meta"><span>${esc(T.short)}</span>${r.report_no ? `<span>n° ${esc(r.report_no)}</span>` : ''}<span>${
        day ? hhmm(r.report_date) : fmtDate(r.report_date)}</span>${nPh ? `<span>${nPh} photo${nPh > 1 ? 's' : ''}</span>` : ''}${
        r._dirty ? '<span class="pend">• à envoyer</span>' : ''}</span>
    </span>
    <span class="rp-ref">${esc(ref || '—')}<small>${esc(where)}</small></span>
    <span class="rp-no">${esc(r.report_no || '—')}<small>${esc(T.short)}${nPh ? ` · ${nPh} photo${nPh > 1 ? 's' : ''}` : ''}</small></span>
    <span class="rp-date">${fmtDate(r.report_date, false)}<small>${hhmm(r.report_date)}${r._dirty ? ' · à envoyer' : ''}</small></span>
    <span class="rp-side">${verdictBadge(s)}${s.stars && !s.pending ? stars(s.stars) : ''}</span>
    ${nPh ? `<span class="thumbs" data-thumbs="${esc(r.id)}"></span>` : ''}
  </button>`;
}

/* « Aujourd'hui », « Hier », « mardi 22 septembre ». */
function dayLabel(iso) {
  const d = new Date(iso), t = new Date();
  const k = (x) => x.toDateString();
  const y = new Date(t); y.setDate(t.getDate() - 1);
  if (k(d) === k(t)) return "Aujourd'hui";
  if (k(d) === k(y)) return 'Hier';
  const s = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long',
    ...(d.getFullYear() !== t.getFullYear() ? { year: 'numeric' } : {}) });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function paintList(rows, total) {
  const list = $('#list');
  if (!list) return;
  if (!rows.length) { list.innerHTML = emptyHtml(total); return; }
  const shown = rows.slice(0, 200);
  const days = [];
  for (const r of shown) {
    const lb = dayLabel(r.report_date);
    if (!days.length || days[days.length - 1].lb !== lb) days.push({ lb, rows: [] });
    days[days.length - 1].rows.push(r);
  }
  list.innerHTML = `<div class="feed-wrap">
    <div class="feed-head" aria-hidden="true"><span></span><span>Partenaire · produit</span><span>Référence</span><span>N° · type</span><span>Date</span><span>Évaluation</span></div>
    ${days.map(d => `<div class="day">${esc(d.lb)}</div><div class="feed">${d.rows.map(r => reportCard(r, { day: true })).join('')}</div>`).join('')}
  </div>${rows.length > shown.length ? `<p class="muted" style="text-align:center;margin-top:12px">200 premiers rapports affichés — affinez la recherche pour les autres.</p>` : ''}`;
  $$('#list [data-id]').forEach(b => b.onclick = () => go('#/report/' + b.dataset.id));
  for (const r of shown) if (livePhotos(r).length) paintThumbs(r);
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

export async function paintThumbs(r) {
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

function openFilters(after) {
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
          close(); after();
        };
        el.querySelector('#clr').onclick = () => {
          const q = $('#q'); if (q) q.value = '';
          feedFilter();
          close(); after();
        };
      } });
}

/* ============================= FICHE =============================
   En tête, ce qu'on vient chercher : qui, quoi, et le verdict en grand.
   Puis les informations, le détail par palette, les critères, les
   pressions, les photos. Sur téléphone, une rangée de puces sous la
   barre du haut saute d'un bloc à l'autre ; sur ordinateur, la synthèse
   et ce sommaire restent collés à droite pendant qu'on parcourt les
   tableaux. */
export async function renderReportView(id) {
  releaseViewPhotos();   // les URL d'objet de la fiche précédente
  const r = await local.get('reports', id);
  if (!r) { toast('Rapport introuvable', 'err'); return go('#/feed'); }
  const g = groupById(r.product_group_id);
  const s = r.summary || {};
  const m = r.measures || {};
  const h = r.header || {};
  const T = reportType(r.type);
  const mine = r.created_by === state.profile?.id;
  const canEdit = canManage() || (state.profile?.role === 'inspecteur' && mine);

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

  const st = s.pending ? '' : (VERDICT_STATUS[s.verdict] || '');
  const product = [g?.name, h.variety].filter(Boolean).join(' ');
  const ref = h.lot ? `Lot ${h.lot}` : h.bl ? `BL ${h.bl}` : '';
  const origins = countryNames(originList(h), 'fr');
  const recKpis = receptionKpis(r, grid);
  const palDetail = palletDetail(r, grid);
  const press = pressureBlock(r, g);
  const nPhotos = (r.photos || []).length;

  /* Sommaire : seulement les blocs qui existent sur CE rapport. */
  const toc = [
    ['v-info', 'Informations'],
    palDetail ? ['v-pal', 'Palettes'] : null,
    bySection.size ? ['v-crit', 'Critères', bySection.size] : null,
    press.pressure ? ['v-press', 'Pressions'] : null,
    press.weights ? ['v-weights', 'Poids'] : null,
    r.remarks?.trim() ? ['v-rem', 'Remarques'] : null,
    nPhotos ? ['v-photos', 'Photos', nPhotos] : null
  ].filter(Boolean);

  const fact = (k, v, wide = false) => v == null || v === '' ? ''
    : `<div${wide ? ' class="wide"' : ''}><span>${esc(k)}</span><b>${esc(v)}</b></div>`;
  const bad = badPallets(h);

  shell(T.title, `
   <div class="view">
    <aside class="v-side">
      <div class="card hero">
        <div class="kind"><span class="tp ${T.id}"><i class="t-${T.id}">${icon(T.icon)}</i>${esc(T.short)}</span>
          ${r.report_no ? `<span>n° ${esc(r.report_no)}</span>` : ''}<span>${fmtDate(r.report_date)}</span>
          ${r._dirty ? '<span class="pill warn sm">à envoyer</span>' : ''}</div>
        <h2>${esc(r.partner_name || '—')}</h2>
        <div class="sub">${esc([product, ref, origins].filter(Boolean).join(' · '))}</div>
        <div class="verdict ${st}"><span class="dot ${st || 'none'}"></span>
          <span class="vt"><b>${esc(st ? s.verdict : 'Non évalué')}</b>
            <span>${st ? `Tolérance ${s.tolerance ?? 10} %` : 'Aucun critère noté ne permet de trancher'}</span></span>
          ${st ? stars(s.stars) : ''}</div>
        <div class="idx">
          <div><span>Qualité</span><b><span class="dot ${QUALITY_STATUS[s.quality] || 'none'}"></span>${esc(s.quality || '—')}</b></div>
          <div><span>Conservabilité</span><b><span class="dot ${SHELF_STATUS[s.shelf] || 'none'}"></span>${esc(s.shelf || '—')}</b></div>
          <div><span>%NC</span><b>${s.nc == null ? '—' : esc(s.nc) + ' %'}</b></div>
        </div>
      </div>
      ${recKpis}
      ${toc.length > 1 ? `<nav class="jump" id="vJump" aria-label="Sommaire du rapport"><span class="jt">Sommaire</span>${
        toc.map(([id, label, n]) => `<a href="#${id}" data-to="${id}">${esc(label)}${n ? ` <span class="n">${n}</span>` : ''}</a>`).join('')}</nav>` : ''}
    </aside>

    <div class="v-main">
      <section class="card pad" id="v-info">
        <div class="card-h"><h3>Informations</h3></div>
        <div class="facts">
          ${fact('Date du contrôle', fmtDate(r.report_date))}
          ${fact('N° de rapport', r.report_no)}
          ${fact(T.partnerLabel, r.partner_name)}
          ${fact('Produit', product)}
          ${fact(originList(h).length > 1 ? 'Origines' : 'Origine', origins)}
          ${fact('Catégorie', h.category)}
          ${fact('N° de lot', h.lot)}
          ${fact('N° de BL', h.bl)}
          ${fact('Commande', h.order)}
          ${fact('Date de réception', h.arrival ? fmtWall(h.arrival) : '')}
          ${fact('N° de camion', h.truck)}
          ${fact('Transporteur', h.carrier)}
          ${T.voyage ? fact('N° de Voyage', h.voyage || h.load_id) : ''}
          ${fact('Conditionnement', h.packaging_kind)}
          ${fact('Département', h.department)}
          ${fact('Contrôlé par', r.inspector_name)}
          ${bad.length ? fact(bad.length > 1 ? 'Palettes problématiques' : 'Palette problématique',
              `${bad.length} — n° ${bad.join(', ')}`, true) : ''}
        </div>
        ${lotTable(r)}
      </section>

      ${palDetail}

      ${[...bySection].map(([label, list], i) => `
      <section class="card pad crit-card"${i === 0 ? ' id="v-crit"' : ''}>
        <div class="card-h"><h3>${esc(label)}</h3><span class="muted">${list.length}</span></div>
        <div class="kvs">${list.map(f => {
          const fst = statusIn(judged, f, m[f.key]);
          const val = f.type === 'bool' ? (isYes(m[f.key]) ? 'Conforme' : 'Non conforme')
                    : `${fmtVal(m[f.key])}${f.unit && f.type !== 'choice' ? ' ' + f.unit : ''}`;
          return kv(f.label, val, fst);
        }).join('')}</div></section>`).join('')}

      ${press.html}

      ${r.remarks?.trim() ? `<section class="card pad" id="v-rem">
        <div class="card-h"><h3>Remarques</h3></div>
        <div class="remarks">${esc(r.remarks)}</div></section>` : ''}

      ${nPhotos ? `<section class="card pad" id="v-photos">
        <div class="card-h"><h3>Photos (${nPhotos})</h3></div>
        ${livePhotos(r).length ? '<div class="photo-grid" id="viewPhotos"></div>' : ''}
        ${archivedNote(r)}</section>` : ''}
    </div>
   </div>

    <div class="sticky-actions">
      ${canEdit ? `<button class="icon-btn" id="moreBtn" aria-label="Plus d'actions">${icon('dots')}</button>` : ''}
      <button class="btn ghost" id="pdfBtn">${icon('down')} Télécharger</button>
      <button class="btn" id="shareBtn">${icon('share')} Partager</button>
    </div>`,
    { back: () => back('#/feed'), tab: 'feed',
      actions: canEdit ? `<button class="icon-btn" id="editBtn" aria-label="Modifier le rapport" title="Modifier">${icon('edit')}</button>` : '',
      onMount() {
        if (r.photos?.length) paintViewPhotos(r);
        wireJump('vJump', '.v-main > section[id]');
        $('#pdfBtn').onclick   = () => exportFlow(r, g, 'download');
        $('#shareBtn').onclick = () => exportFlow(r, g, 'share');
        const eb = $('#editBtn');
        if (eb) eb.onclick = () => go(`#/report/${r.id}/edit`);
        /* Rapport tout juste enregistré : son PDF est proposé d'office. */
        if (state.pdfOffer === r.id) { state.pdfOffer = null; openPdfOffer(r, g); }
        const mb = $('#moreBtn');
        if (mb) mb.onclick = () => sheet('', `<div class="menu">
          <button class="menu-item" id="ed"><span class="ic n">${icon('edit')}</span>
            <span class="tx"><b>Modifier</b><span>Corriger une mesure, ajouter une photo</span></span><span class="chev">${icon('chevR')}</span></button>
          <button class="menu-item" id="dup"><span class="ic n">${icon('copy')}</span>
            <span class="tx"><b>Dupliquer</b><span>Même en-tête, mesures vierges</span></span><span class="chev">${icon('chevR')}</span></button>
          <button class="menu-item" id="del"><span class="ic n" style="color:var(--fail-ink)">${icon('trash')}</span>
            <span class="tx"><b style="color:var(--fail-ink)">Supprimer</b><span>Pour toute l'équipe</span></span><span class="chev">${icon('chevR')}</span></button></div>`,
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

/* Sommaire d'une page longue : la puce du bloc à l'écran s'allume, et
   un appui y mène (en ouvrant la section repliée, s'il y a lieu).
   `sel` : les blocs suivis, dans l'ordre de la page. */
export function wireJump(navId, sel) {
  const nav = document.getElementById(navId);
  if (!nav) return;
  const links = [...nav.querySelectorAll('[data-to]')];
  const offset = () => (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--head-h')) || 56) +
    (getComputedStyle(nav).position === 'sticky' ? nav.offsetHeight : 0) + 8;
  links.forEach(a => a.onclick = (e) => {
    e.preventDefault();
    const el = document.getElementById(a.dataset.to);
    if (!el) return;
    if (el.tagName === 'DETAILS') el.open = true;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - offset(), behavior: 'smooth' });
  });
  let raf = 0;
  const spy = () => {
    raf = 0;
    const y = offset() + 24;
    let cur = links[0]?.dataset.to;
    for (const a of links) {
      const el = document.getElementById(a.dataset.to);
      if (el && el.getBoundingClientRect().top <= y) cur = a.dataset.to;
    }
    /* Bas de page atteint : le dernier bloc est celui qu'on lit, même
       s'il est trop court pour monter jusqu'en haut. */
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) cur = links[links.length - 1]?.dataset.to;
    for (const a of links) {
      const on = a.dataset.to === cur;
      if (on !== a.classList.contains('on')) {
        a.classList.toggle('on', on);
        /* La puce allumée reste visible dans la rangée défilante. */
        if (on && nav.scrollWidth > nav.clientWidth) nav.scrollTo({ left: a.offsetLeft - 16, behavior: 'smooth' });
      }
    }
  };
  const onScroll = () => { if (!raf) raf = requestAnimationFrame(spy); };
  window.addEventListener('scroll', onScroll, { passive: true });
  onLeave(() => window.removeEventListener('scroll', onScroll));
  spy();
}

/* Pressions : la courbe d'abord — elle se lit d'un coup d'œil — puis
   le détail chiffré, qui sert de preuve. Renvoie aussi quels blocs
   existent, pour le sommaire. */
function pressureBlock(r, group) {
  const p = r.header?.pressures;
  const st = lotStats(p);
  const wst = weightLotStats(p, group);
  if (!st && !wst) return { html: '', pressure: false, weights: false };
  const cfg = { fruits: p.fruits || 5, sides: p.sides || 2 };
  const pv = pressureVerdict(p, group);
  const sp = pv?.spec || refSpec(p, group);
  /* Les lignes de résumé restent des <div> : le texte de la carte se lit
     ligne par ligne (titre, résumé, alerte), comme dans le PDF. */
  const html = `
  ${st ? `<section class="card pad" id="v-press">
    <div class="card-h"><h3>Pression moyenne par palette</h3></div>
    <div class="muted" style="margin:-8px 0 8px">${fmtP(st.avg)} ${esc(p.unit || 'kg')} sur le lot ·
        min ${fmtP(st.min)} · max ${fmtP(st.max)} ·
        ${st.count} palette${st.count > 1 ? 's' : ''} · ${st.measures} relevés</div>
    ${sp ? `<div class="muted" style="margin:0 0 8px">
      ${sp.mode === 'range' ? 'Plage acceptée' : 'Référence'} <b>${esc(refText(sp))}</b>${
        p.refClient ? ` — ${esc(p.refClient)}${refScope(p) ? ` · ${esc(refScope(p))}` : ''}` :
        p.refSource === 'manuel' ? ' — ajustée pour ce rapport' : ''}</div>` : ''}
    ${pv && pv.worst !== 'ok' ? `<div class="err-box" style="margin:6px 0 10px">
      <b>${nonOk(pv)} palette${nonOk(pv) > 1 ? 's' : ''} hors référence</b> — ${
        ['critique', 'majeur', 'mineur'].filter(l => pv.count[l])
          .map(l => `${pv.count[l]} ${SEV_LABEL[l].toLowerCase()}`).join(', ')}.</div>` : ''}
    ${pressureChartSVG(p, { spec: sp, unit: p.unit })}
    ${pressureTable(p, cfg, sp, new Set(badPallets(r.header)))}
  </section>` : ''}
  ${wst ? `<section class="card pad" id="v-weights">
    <div class="card-h"><h3>Poids par fruit</h3></div>
    <div class="muted" style="margin:-8px 0 8px">${wst.weighed
        ? `${wst.weighed} fruits pesés (${wst.fruits} par palette)` : `${wst.measures} poids notés`}${
        wst.complete ? ` · moyenne ${fmtG(wst.avg)} g · min ${fmtG(wst.min)} · max ${fmtG(wst.max)}` : ''}</div>
    ${!wst.judged
      ? `<div class="info-box">${icon('info')}<span>Poids minimum inconnu pour ces calibres : rien n'est jugé.</span></div>`
      : wst.under
      ? `<div class="err-box" style="margin:6px 0 4px"><b>${wst.under} fruit${wst.under > 1 ? 's' : ''} sous-calibré${wst.under > 1 ? 's' : ''}</b>
           sur ${wst.weighed} pesés — en rouge ci-dessous. Une case vide est un fruit conforme.</div>`
      : `<div class="ok-box" style="margin:6px 0 4px">Aucun fruit sous le poids minimum de son calibre.</div>`}
    ${weightTable(p, cfg, group, new Set(badPallets(r.header)))}
  </section>` : ''}`;
  return { html, pressure: !!st, weights: !!wst };
}

const nonOk = (pv) => pv.count.mineur + pv.count.majeur + pv.count.critique;

/* « 2026-09-22T08:38 » → « 22/09/2026 à 08:38 » : l'heure du quai,
   telle que l'ERP l'a notée. */
export const fmtWall = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}${
  s.length > 10 ? ' à ' + s.slice(11, 16) : ''}` : '');
const num2 = (v) => String(Math.round(Number(v) * 100) / 100);   // point décimal, comme le reste du rapport

/* Réception : un rapport d'avant le journal n'a ni identité de palette
   ni défauts comptés — rien à détailler de plus que les pressions. */
function receptionData(r, grid) {
  if (r.type !== 'reception') return null;
  const p = r.header?.pressures;
  const pals = p?.pallets || [];
  const rich = pals.some(x => x.sub || x.ggn || x.variety || x.boxes ||
    Object.values(x.d || {}).some(v => v !== '' && v != null) || (x.w || []).some(v => v !== '' && v != null));
  if (!pals.length || !rich) return null;
  const rs = receptionStats(p, grid, 'reception');
  const k = r.summary?.reception || { under: rs.underPct, light: rs.sampled ? rs.lightPct : null,
                                      loss: rs.sampled ? rs.lossPct : null, checked: rs.checkedTotal,
                                      cut: rs.cutTotal, fruits: rs.fruitsTotal };
  return { p, pals, rs, k };
}

/* Les trois indicateurs du lot. La couleur suit le verdict des critères
   remplis (voir receptionTones) ; l'état est aussi écrit, jamais porté
   par la couleur seule. */
function receptionKpis(r, grid) {
  const d = receptionData(r, grid);
  if (!d) return '';
  const { k } = d;
  const tone = k.tone || {};
  const kpi = (label, v, t) => `<div class="kpi${t === 'warn' || t === 'fail' ? ' ' + t : ''}"><span>${label}</span><b>${
    v == null ? '—' : fmtPct(v) + ' %'}</b>${KPI_TONE[t] ? `<small>${KPI_TONE[t]}</small>` : ''}</div>`;
  return `<div class="card pad">
    <div class="card-h"><h3>Indicateurs du lot</h3></div>
    <div class="kpis">
      ${kpi('Sous-calibre', k.under, tone.under)}${kpi('Défauts légers', k.light, tone.light)}${kpi('Pertes', k.loss, tone.loss)}
    </div>
    ${k.checked ? `<p class="hint" style="margin:10px 0 0">Sur ${k.checked} fruits contrôlés${
      k.cut ? ` et ${k.cut} fruits coupés (défauts internes)` : ''}${
      k.fruits ? ` — ${Number(k.fruits).toLocaleString('fr-FR')} fruits dans le lot` : ''}.</p>` : ''}
  </div>`;
}

/* Une ligne par palette — n° réel, identité, pression, défauts,
   sous-calibre. Les palettes problématiques sont surlignées. */
function palletDetail(r, grid) {
  const d = receptionData(r, grid);
  if (!d) return '';
  const { pals, rs } = d;
  const bad = new Set(badPallets(r.header));
  const defs = rs.defs;
  const producers = [...new Map(pals.filter(x => x.ggn || x.producer)
    .map(x => [`${x.ggn}|${x.producer}`, x])).values()];

  return `<section class="card pad" id="v-pal">
    <div class="card-h"><h3>Détail par palette</h3>
      <span class="muted">${pals.length} palette${pals.length > 1 ? 's' : ''}${
        bad.size ? ` · ${bad.size} problématique${bad.size > 1 ? 's' : ''}, surlignée${bad.size > 1 ? 's' : ''}` : ''}</span></div>
    <div class="ptab-wrap"><table class="ptab">
      <thead><tr><th>Palette</th><th>Variété</th><th class="num">Colis kg</th><th>Cal.</th><th>Cat.</th>
        <th>Marque</th><th>GGN</th><th class="num">Colis</th><th class="num">Pression</th><th class="num">Contrôlés</th>
        ${rs.legacy ? '' : '<th class="num">Coupés</th>'}
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
          ${rs.legacy ? '' : `<td class="num">${x.def.cut ?? ''}</td>`}
          ${defs.map(t => `<td class="num">${x.def.counts[t.key] || ''}</td>`).join('')}
          <td class="num">${x.def.ext || ''}</td><td class="num">${x.def.int || ''}</td>
          <td class="num${x.def.loss ? ' lossv' : ''}">${x.def.checked ? fmtPct(x.def.lossPct) : ''}</td>
          <td class="num${x.und.under ? ' lossv' : ''}">${x.und.weighed ? `${x.und.under}/${x.und.weighed}` : ''}</td>
          <td>${x.und.weights.map(w => Math.round(w)).join(', ')}</td>
          <td class="num">${x.und.pct == null ? '' : fmtPct(x.und.pct, 0)}</td></tr>`;
      }).join('')}</tbody></table></div>
    ${producers.length ? `<div class="muted" style="font-size:12px;margin-top:10px">${producers.map(x =>
      `${x.ggn ? `GGN ${esc(x.ggn)}` : ''}${x.ggn && x.producer ? ' — ' : ''}${esc(x.producer || '')}`).join('<br>')}</div>` : ''}
  </section>`;
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

/* Détail du lot : un petit tableau quand le lot compte plusieurs
   lignes ou qu'un décompte a été saisi ; sinon un simple « Calibre »
   parmi les informations. */
function lotTable(r) {
  const cals = r.header?.calibres;
  if (!Array.isArray(cals) || !cals.length) {
    return r.header?.calibre ? `<div class="facts" style="margin-top:14px"><div><span>Calibre</span><b>${esc(r.header.calibre)}</b></div></div>` : '';
  }
  if (cals.length === 1 && !cals[0].pal && !cals[0].col)
    return cals[0].c ? `<div class="facts" style="margin-top:14px"><div><span>Calibre</span><b>${esc(cals[0].c)}</b></div></div>` : '';
  const sum = (f) => cals.reduce((t, c) => t + (Number(c[f]) || 0), 0);
  const tp = Math.round(sum('pal') * 100) / 100, tc = sum('col');
  return `<table class="lot-tab">
    <thead><tr><th>Calibre</th><th>Origine</th><th class="r">Palettes</th><th class="r">Colis</th></tr></thead>
    <tbody>${cals.map(c => `<tr><td>${esc(c.c || '—')}</td><td>${esc(c.o ? countryName(c.o, 'fr') : '')}</td>
      <td class="r">${c.pal ? esc(c.pal) : ''}</td><td class="r">${c.col ? esc(c.col) : ''}</td></tr>`).join('')}</tbody>
    ${cals.length > 1 ? `<tfoot><tr><td>Total</td><td></td><td class="r">${tp || ''}</td><td class="r">${tc || ''}</td></tr></tfoot>` : ''}
  </table>`;
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
  /* Copies locales d'abord, puis tous les liens signés en une requête. */
  const blobs = await Promise.all(r.photos.map(async p =>
    (!p.archived && p.localId ? (await local.get('photos', p.localId))?.blob : null) || null));
  const signed = await storage.signedUrls(r.photos.filter((p, i) => !p.archived && !blobs[i] && p.uploaded).map(p => p.path))
    .catch(() => new Map());
  for (const [i, p] of r.photos.entries()) {
    if (p.archived) continue;
    const blob = blobs[i];
    const src = blob ? URL.createObjectURL(blob) : (p.uploaded ? signed.get(p.path) || null : null);
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
export const livePhotos = (r) => (r.photos || []).filter(p => !p.archived);
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
      delete x.cut;
    }
  }
  /* Nouveau contrôle, nouveau réglage : le nombre de fruits coupés
     reprend celui du produit à l'ouverture de la copie. */
  if (copy.header?.pressures) delete copy.header.pressures.cut;
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
    <div class="lang-grid">
      ${langs.map(([k, v]) => `
        <button class="lang" data-f="pdf" data-l="${k}">
          <span class="code">${esc(k.toUpperCase())}</span>
          <span class="tx"><b>${esc(v)}</b><span>PDF${k === last ? ' · dernière langue utilisée' : ''}</span></span></button>`).join('')}
    </div>
    <button class="menu-item" data-f="xlsx" style="margin-top:10px">
      <span class="ic g">${icon('excel')}</span>
      <span class="tx"><b>Excel — modifiable</b><span>Chiffres et mesures, feuille par feuille</span></span>
      <span class="chev">${icon('chevR')}</span></button>`,
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
              name = reportFilename(r, g, 'pdf', b.dataset.l);
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
      : 'Le PDF du rapport est prêt à partir.'}${navigator.onLine ? ''
      : ' Hors ligne : le rapport partira vers l\'équipe au retour du réseau.'}</p>
    <div class="chips" id="offLang" style="margin-bottom:12px">${Object.entries(LANGS).map(([k, v]) =>
      `<button class="chip" data-l="${k}" aria-pressed="${k === lang}">${esc(v)}</button>`).join('')}</div>
    <div class="btn-row">
      <button class="btn" id="offDl" style="flex:1">${icon('down')} Télécharger</button>
      <button class="btn" id="offSh" style="flex:1">${icon('share')} Partager</button>
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
            await deliver(blob, reportFilename(r, g, 'pdf', lang), partage,
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
      'Fruits contrôlés', 'Fruits coupés', 'Défauts (détail)', 'Défauts externes', 'Défauts internes', '% défauts légers', '% pertes',
      'Fruits pesés', 'Sous-poids', 'Poids sous-calibrés (g)', '% sous-calibre', 'Problématique']);
    for (const x of rs.rows) {
      const pl = x.p, st = palletStats(pl);
      pallets.push([r.report_no || '', fmtDate(r.report_date), r.header.lot || '', r.partner_name || '', x.n, pl.sub || '',
        pl.variety || '', num(pl.boxKg), pl.cal || '', pl.cat || '', pl.brand || '', pl.ggn || '', pl.producer || '',
        pl.origin ? countryName(pl.origin, 'fr') : '', num(pl.boxes), st ? Math.round(st.avg * 100) / 100 : '',
        num(x.def.checked), x.def.legacy ? '' : num(x.def.cut),
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
