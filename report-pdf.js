/* ------------------------------------------------------------------
   Mise en page du rapport PDF, calquée sur le modèle reçu de
   Fruttital pour qu'un client déjà habitué à FreshControl retrouve
   exactement la même lecture : Général → Résumé → Emballage →
   Caractéristiques → Remarques → Photos.

   Le PDF est traduisible : c'est la pièce qui sort de l'entreprise et
   part chez un client italien, espagnol ou néerlandais. L'interface,
   elle, reste en français.
   ------------------------------------------------------------------ */

import { PDF, PAGE, MARGIN, COLORS } from './pdf.js';
import { flatFields, fieldStatus, VERDICT_STATUS, QUALITY_STATUS, SHELF_STATUS } from './verdict.js';
import { logoJpeg } from './logo.js';
import { storage, currentUser } from './supa.js';
import { local } from './store.js';

/* ------------------------- traductions ------------------------- */
export const LANGS = { fr: 'Français', en: 'English', it: 'Italiano', es: 'Español', nl: 'Nederlands' };

const T = {
  fr: { shared:'Rapport partagé par', general:'Général', summary:'Résumé', packaging:'Emballage',
        characteristics:'Caractéristiques', remarks:'Remarques', photos:'Photos', date:'Date', dept:'Département',
        group:'Groupe de Prod.', origin:'Origine', loadId:'IdDeChargement', order:'Commande', supplier:'Fournisseur',
        customer:'Client', by:'Par', product:'Produit', quality:'Qualité', shelf:'Conservabilité', verdict:'Évaluation',
        pallets:'N° de Palettes', badPallet:'Palette Problématique', lot:'Lot', pkgType:"Type d'Emballage",
        pkgCond:"Condition d'Emballage", gross:'Poids Brut (Kg)', tare:'Tare (Kg)', net:'Poids Net (Kg)',
        variety:'Variété', calibre:'Calibre', category:'Catégorie', reception:'Réception', shipment:'Expédition',
        reportRec:'Rapport de réception', reportShip:'Rapport d\'expédition client', conform:'Conforme',
        nonConform:'Non Conforme', wk:'sem' },
  en: { shared:'Report shared by', general:'General', summary:'Summary', packaging:'Packaging',
        characteristics:'Characteristics', remarks:'Remarks', photos:'Photos', date:'Date', dept:'Department',
        group:'Product group', origin:'Origin', loadId:'Load ID', order:'Order', supplier:'Supplier',
        customer:'Customer', by:'By', product:'Product', quality:'Quality', shelf:'Shelf life', verdict:'Assessment',
        pallets:'No. of pallets', badPallet:'Problem pallet', lot:'Batch', pkgType:'Packaging type',
        pkgCond:'Packaging condition', gross:'Gross weight (Kg)', tare:'Tare (Kg)', net:'Net weight (Kg)',
        variety:'Variety', calibre:'Size', category:'Class', reception:'Arrival', shipment:'Outbound',
        reportRec:'Arrival report', reportShip:'Customer shipment report', conform:'Compliant',
        nonConform:'Non-compliant', wk:'wk' },
  it: { shared:'Rapporto condiviso da', general:'Generale', summary:'Riepilogo', packaging:'Imballaggio',
        characteristics:'Caratteristiche', remarks:'Osservazioni', photos:'Foto', date:'Data', dept:'Reparto',
        group:'Gruppo di Prod.', origin:'Origine', loadId:'ID Carico', order:'Ordine', supplier:'Fornitore',
        customer:'Cliente', by:'Da', product:'Prodotto', quality:'Qualità', shelf:'Conservabilità', verdict:'Valutazione',
        pallets:'N° di Pallet', badPallet:'Pallet Problematico', lot:'Lotto', pkgType:'Tipo di Imballaggio',
        pkgCond:'Condizione Imballaggio', gross:'Peso Lordo (Kg)', tare:'Tara (Kg)', net:'Peso Netto (Kg)',
        variety:'Varietà', calibre:'Calibro', category:'Categoria', reception:'Arrivo', shipment:'Spedizione',
        reportRec:'Rapporto di arrivo', reportShip:'Rapporto di spedizione cliente', conform:'Conforme',
        nonConform:'Non Conforme', wk:'sett' },
  es: { shared:'Informe compartido por', general:'General', summary:'Resumen', packaging:'Embalaje',
        characteristics:'Características', remarks:'Observaciones', photos:'Fotos', date:'Fecha', dept:'Departamento',
        group:'Grupo de Prod.', origin:'Origen', loadId:'ID de Carga', order:'Pedido', supplier:'Proveedor',
        customer:'Cliente', by:'Por', product:'Producto', quality:'Calidad', shelf:'Conservación', verdict:'Evaluación',
        pallets:'N.º de Palés', badPallet:'Palé Problemático', lot:'Lote', pkgType:'Tipo de Embalaje',
        pkgCond:'Condición de Embalaje', gross:'Peso Bruto (Kg)', tare:'Tara (Kg)', net:'Peso Neto (Kg)',
        variety:'Variedad', calibre:'Calibre', category:'Categoría', reception:'Recepción', shipment:'Expedición',
        reportRec:'Informe de recepción', reportShip:'Informe de expedición cliente', conform:'Conforme',
        nonConform:'No Conforme', wk:'sem' },
  nl: { shared:'Rapport gedeeld door', general:'Algemeen', summary:'Samenvatting', packaging:'Verpakking',
        characteristics:'Kenmerken', remarks:'Opmerkingen', photos:"Foto's", date:'Datum', dept:'Afdeling',
        group:'Productgroep', origin:'Herkomst', loadId:'Laad-ID', order:'Order', supplier:'Leverancier',
        customer:'Klant', by:'Door', product:'Product', quality:'Kwaliteit', shelf:'Houdbaarheid', verdict:'Beoordeling',
        pallets:'Aantal pallets', badPallet:'Probleempallet', lot:'Partij', pkgType:'Verpakkingstype',
        pkgCond:'Verpakkingsconditie', gross:'Brutogewicht (Kg)', tare:'Tarra (Kg)', net:'Nettogewicht (Kg)',
        variety:'Ras', calibre:'Maat', category:'Klasse', reception:'Aankomst', shipment:'Uitgaand',
        reportRec:'Aankomstrapport', reportShip:'Klantrapport uitgaand', conform:'Conform',
        nonConform:'Niet conform', wk:'wk' }
};

/* Valeurs de verdict traduites (le stockage reste en français). */
const V = {
  fr: {}, // identité
  en: { 'Bonne':'Good','Moyenne':'Moderate','Mauvaise':'Poor','Élevée':'High','Minimale':'Minimal',
        'Conforme':'Compliant','Acceptable':'Acceptable','Non Conforme':'Non-compliant' },
  it: { 'Bonne':'Buona','Moyenne':'Media','Mauvaise':'Scarsa','Élevée':'Alta','Minimale':'Minima',
        'Conforme':'Conforme','Acceptable':'Accettabile','Non Conforme':'Non Conforme' },
  es: { 'Bonne':'Buena','Moyenne':'Media','Mauvaise':'Mala','Élevée':'Alta','Minimale':'Mínima',
        'Conforme':'Conforme','Acceptable':'Aceptable','Non Conforme':'No Conforme' },
  nl: { 'Bonne':'Goed','Moyenne':'Matig','Mauvaise':'Slecht','Élevée':'Hoog','Minimale':'Minimaal',
        'Conforme':'Conform','Acceptable':'Acceptabel','Non Conforme':'Niet conform' }
};
const tv = (lang, val) => (V[lang] && V[lang][val]) || val;

export function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
}
const fmtDate = (iso) => {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/* ------------------- récupération des photos ------------------- */
async function photoBytes(report, max = 8) {
  const out = [];
  for (const p of (report.photos || []).slice(0, max)) {
    let blob = null;
    if (p.localId) blob = (await local.get('photos', p.localId))?.blob || null;
    if (!blob && p.uploaded) blob = await storage.download(p.path).catch(() => null);
    if (blob) out.push(new Uint8Array(await blob.arrayBuffer()));
  }
  return out;
}

/* ========================= document ========================= */
export async function buildReportPDF(report, group, { lang = 'fr', company = 'SARL Mehadrin International' } = {}) {
  const t = T[lang] || T.fr;
  const s = report.summary || {};
  const m = report.measures || {};
  const h = report.header || {};
  const doc = new PDF();

  /* -- Bandeau -- */
  const cx = PAGE.w / 2;
  doc.text(t.shared, cx, MARGIN + 8, { size: 8.5, color: COLORS.GREY, align: 'center' });
  doc.text(company, cx, MARGIN + 22, { size: 11, bold: true, align: 'center' });
  const logo = await logoJpeg(560, 206);
  if (logo) doc.image(logo, cx - 82, MARGIN + 30, 164, 60);
  doc.y = MARGIN + 104;

  doc.text(report.type === 'reception' ? t.reportRec : t.reportShip, cx, doc.y, { size: 9.5, bold: true, color: COLORS.ACCENT, align: 'center' });
  doc.y += 16;

  /* -- Général -- */
  doc.sectionTitle(t.general);
  const d = new Date(report.report_date);
  doc.row(t.date, `${fmtDate(report.report_date)} (${t.wk}${isoWeek(d)})`);
  if (h.department) doc.row(t.dept, h.department);
  doc.row(t.group, group?.name || report.product_group_id || '');
  if (h.origin) doc.row(t.origin, h.origin);
  if (h.load_id) doc.row(t.loadId, h.load_id);
  if (h.order) doc.row(t.order, h.order);
  doc.row(report.type === 'reception' ? t.supplier : t.customer, report.partner_name || '');
  doc.row(t.by, report.inspector_name || '');
  doc.y += 8;

  /* -- Résumé -- */
  const label = [group?.name, h.variety, h.origin, h.calibre].filter(Boolean).join(' ');
  doc.sectionTitle(t.summary);
  doc.table(
    [ { k:'p', h:t.product, w:150 }, { k:'q', h:t.quality, w:95 }, { k:'s', h:t.shelf, w:100 },
      { k:'v', h:t.verdict, w:95 }, { k:'nc', h:'%NC', w:50 }, { k:'pal', h:t.pallets, w:70 },
      { k:'bad', h:t.badPallet, w:85 }, { k:'lot', h:t.lot, w:115 } ],
    [ { p: label,
        q:  { v: tv(lang, s.quality), s: QUALITY_STATUS[s.quality] },
        s:  { v: tv(lang, s.shelf),   s: SHELF_STATUS[s.shelf] },
        v:  { v: tv(lang, s.verdict), s: VERDICT_STATUS[s.verdict] },
        nc: s.nc == null ? '' : String(s.nc),
        pal: fmt(m.pal_count, DP2), bad: h.bad_pallet || '', lot: h.lot || '' } ]
  );

  /* -- Emballage -- */
  if (m.pkg_type || m.pkg_cond || m.pkg_gross != null) {
    doc.sectionTitle(t.packaging);
    doc.table(
      [ { k:'p', h:t.product, w:170 }, { k:'ty', h:t.pkgType, w:130 }, { k:'co', h:t.pkgCond, w:140 },
        { k:'g', h:t.gross, w:110 }, { k:'ta', h:t.tare, w:95 }, { k:'n', h:t.net, w:110 } ],
      [ { p: label, ty: m.pkg_type || '', co: m.pkg_cond || '',
          g: fmt(m.pkg_gross, DP2), ta: fmt(m.pkg_tare, DP2), n: fmt(m.pkg_net, DP2) } ]
    );
  }

  /* -- Caractéristiques -- */
  doc.sectionTitle(t.characteristics);
  if (h.variety)  doc.row(t.variety, h.variety);
  if (h.calibre)  doc.row(t.calibre, h.calibre);
  if (h.category) doc.row(t.category, h.category);
  doc.row(t.quality, tv(lang, s.quality), { status: QUALITY_STATUS[s.quality], bold: true });
  doc.row(t.shelf,   tv(lang, s.shelf),   { status: SHELF_STATUS[s.shelf], bold: true });
  doc.row(t.verdict, tv(lang, s.verdict), { status: VERDICT_STATUS[s.verdict], bold: true });
  doc.y += 6;

  const fields = flatFields(group || {});
  const bySection = new Map();
  for (const fl of fields) {
    if (m[fl.key] === '' || m[fl.key] == null) continue;
    if (!bySection.has(fl.sectionLabel)) bySection.set(fl.sectionLabel, []);
    bySection.get(fl.sectionLabel).push(fl);
  }
  for (const [secLabel, list] of bySection) {
    doc.subhead(secLabel);
    for (const fl of list) {
      const st = fieldStatus(fl, m[fl.key]);
      const val = fl.type === 'bool'
        ? (m[fl.key] === true || m[fl.key] === 'true' ? t.conform : t.nonConform)
        : `${fmt(m[fl.key], fl)}${fl.unit && fl.type !== 'choice' ? ' ' + fl.unit : ''}`;
      doc.row(fl.label, val, { status: st && st !== 'ok' ? st : (fl.type === 'bool' || fl.type === 'choice' ? st : null), indent: 8 });
    }
    doc.y += 4;
  }

  /* -- Remarques -- */
  if (report.remarks?.trim()) {
    doc.sectionTitle(t.remarks);
    doc.need(20);
    doc.text('"', MARGIN + 4, doc.y + 10, { size: 15, bold: true, color: COLORS.GREY });
    for (const line of report.remarks.split('\n')) {
      const chunks = splitToWidth(line, 8.6, PAGE.w - 2 * MARGIN - 26);
      for (const c of chunks) { doc.need(12); doc.text(c, MARGIN + 22, doc.y + 8, { size: 8.6 }); doc.y += 12; }
    }
    doc.y += 8;
  }

  /* -- Photos -- */
  const imgs = await photoBytes(report);
  if (imgs.length) {
    doc.sectionTitle(t.photos);
    const cols = 3, gap = 10;
    const w = (PAGE.w - 2 * MARGIN - gap * (cols - 1)) / cols;
    const hgt = w * 0.75;
    for (let i = 0; i < imgs.length; i++) {
      const col = i % cols;
      if (col === 0) doc.need(hgt + gap);
      const x = MARGIN + col * (w + gap);
      doc.rect(x, doc.y, w, hgt, { fill: [0.96, 0.96, 0.97] });
      doc.image(imgs[i], x, doc.y, w, hgt, { fit: true });
      if (col === cols - 1 || i === imgs.length - 1) doc.y += hgt + gap;
    }
  }

  return doc.build();
}

/* Les mesures au centième (poids, duretés, températures) gardent leurs
   deux décimales même sur un nombre rond : « 4.00 kg » se lit comme une
   pesée, « 4 kg » comme une estimation. Les comptages restent entiers. */
const DP2 = { step: 0.01 };
const fmt = (v, field) => {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v !== 'number') return String(v);
  const twoDp = field ? (field.step === 0.01 || field.type === 'pct') : false;
  if (twoDp) return v.toFixed(2);
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
};

function splitToWidth(str, size, maxW) {
  const words = String(str).split(/\s+/).filter(Boolean);
  const out = []; let line = '';
  const wOf = (s) => s.length * size * 0.5;
  for (const w of words) {
    const probe = line ? line + ' ' + w : w;
    if (wOf(probe) > maxW && line) { out.push(line); line = w; } else line = probe;
  }
  if (line) out.push(line);
  return out.length ? out : [''];
}

/* Nom de fichier lisible par le destinataire, sans accent ni espace. */
export function pdfFilename(report, group) {
  const d = new Date(report.report_date);
  const p = (n) => String(n).padStart(2, '0');
  const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').toLowerCase();
  return [
    slug(report.partner_name) || 'rapport',
    slug(group?.name || report.product_group_id),
    slug(report.header?.load_id || report.report_no),
    `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`
  ].filter(Boolean).join('_') + '.pdf';
}
