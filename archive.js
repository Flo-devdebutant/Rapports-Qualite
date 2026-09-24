/* ------------------------------------------------------------------
   Photos : place occupée sur Supabase, et archivage d'une période.

   L'offre gratuite de Supabase plafonne les fichiers à 1 Go. Les
   photos partent déjà allégées (store.js, LIGHT_PHOTO) ; pour libérer
   davantage, on archive une période, en deux temps et dans cet ordre :
     1. un ZIP des PDF de ses rapports, photos comprises, téléchargé ;
     2. ces photos retirées de Supabase.
   Rien n'est supprimé qui n'ait d'abord été téléchargé : le bouton 2
   ne s'ouvre qu'une fois le ZIP de CETTE sélection produit. Les
   rapports restent consultables ; leurs photos vivent dans les PDF de
   l'archive, et le rapport dit quand elles ont été archivées.
   ------------------------------------------------------------------ */

import { state, shell, groupById, back, canManage } from './app.js';
import { local, queue, sync } from './store.js';
import { storage } from './supa.js';
import { buildReportPDF, reportFilename, LANGS } from './report-pdf.js';
import { zipBlob } from './xlsx.js';
import { gridOf } from './reports.js';
import { $, $$, esc, icon, toast, confirmSheet, download } from './ui.js';

const QUOTA = 1024 ** 3;                 // 1 Go, offre gratuite
const LEGACY = 370 * 1024;               // photo d'avant la 2.5 (pleine taille), poids moyen mesuré
const onServer = (p) => p.uploaded && !p.archived;
const weight = (p) => Number(p.size) || LEGACY;
const day = (d) => d.toISOString().slice(0, 10);
const monthsAgo = (n) => { const d = new Date(); d.setMonth(d.getMonth() - n); return day(d); };
const fmtMo = (b) => b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} Go`
  : `${Math.max(0.1, Math.round(b / 1024 ** 2 * 10) / 10)} Mo`;
const fr = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '');

/* Sélection en cours (garde le réglage le temps de la visite). */
const sel = { from: '', to: monthsAgo(3), lang: 'fr', zipped: '' };
const key = () => `${sel.from}|${sel.to}`;

async function allReports() {
  return (await local.all('reports')).filter(r => !r.deleted && !r._draft);
}

/* Rapports de la période dont au moins une photo est sur Supabase. */
function inPeriod(reports) {
  return reports.filter(r => {
    const d = String(r.report_date || '').slice(0, 10);
    return (!sel.from || d >= sel.from) && (!sel.to || d <= sel.to) && (r.photos || []).some(onServer);
  }).sort((a, b) => String(a.report_date).localeCompare(String(b.report_date)));
}

export async function renderPhotoArchive() {
  if (!canManage()) return back('#/settings');
  const reports = await allReports();
  const photos = reports.flatMap(r => r.photos || []);
  const live = photos.filter(onServer);
  const used = live.reduce((s, p) => s + weight(p), 0);
  const archived = photos.filter(p => p.archived).length;
  const light = live.filter(p => p.light).length;
  if (!sel.lang || !LANGS[sel.lang]) sel.lang = (await local.meta('lastLang')) || 'fr';
  const pct = Math.min(100, used / QUOTA * 100);

  shell('Photos et espace', `
   <div class="narrow">
    <div class="card pad">
      <div class="card-h"><h3>Photos en ligne</h3><span class="muted">limite : 1 Go</span></div>
      <div class="gauge${pct > 80 ? ' high' : ''}" role="img" aria-label="${Math.round(pct)} % de l'espace photos utilisé">
        <span style="width:${pct.toFixed(1)}%"></span></div>
      <p style="margin:10px 0 0;font-size:14px"><b>≈ ${fmtMo(used)}</b> sur 1 Go
        · ${live.length} photo${live.length > 1 ? 's' : ''}${archived ? ` · ${archived} archivée${archived > 1 ? 's' : ''}` : ''}</p>
      <p class="hint">Estimation d'après les rapports de l'appareil. Les photos partent
        allégées depuis la version 2.5 (${light} sur ${live.length}) ; celles d'avant gardent leur pleine taille
        jusqu'à leur archivage.</p>
    </div>

    <div class="card pad">
      <div class="card-h"><h3>Archiver une période</h3></div>
      <p class="muted" style="margin:-6px 0 12px">1. Téléchargez le ZIP des PDF de la période, photos comprises.
        2. Retirez ensuite ces photos du serveur. Les rapports restent consultables ; leurs photos sont
        dans les PDF de l'archive.</p>
      <div class="chips" style="margin-bottom:12px">
        <button class="chip" data-pre="3">Plus de 3 mois</button>
        <button class="chip" data-pre="6">Plus de 6 mois</button>
        <button class="chip" data-pre="12">Plus d'un an</button>
      </div>
      <div class="row2">
        <div class="field"><label for="arFrom">Du</label><input type="date" id="arFrom" value="${esc(sel.from)}"></div>
        <div class="field"><label for="arTo">Au</label><input type="date" id="arTo" value="${esc(sel.to)}"></div>
      </div>
      <div class="field"><label>Langue des PDF</label>
        <div class="chips" id="arLang">${Object.entries(LANGS).map(([k, v]) =>
          `<button class="chip" data-l="${k}" aria-pressed="${k === sel.lang}">${esc(v)}</button>`).join('')}</div></div>
      <div class="info-box" id="arSum" style="margin:4px 0 14px"></div>
      <button class="btn block" id="arZip">${icon('down')} 1. Télécharger les PDF (ZIP)</button>
      <div class="muted" id="arProg" style="margin:8px 0 10px;min-height:1em;font-size:13px"></div>
      <button class="btn danger block" id="arDel">${icon('trash')} 2. Retirer ces photos du serveur</button>
      <p class="hint" style="margin-top:10px">Sur ordinateur de préférence pour une longue période : chaque
        rapport devient un PDF, et l'archive se prépare sur l'appareil.</p>
    </div>
   </div>`,
    { back: () => back('#/settings'), tab: 'settings',
      onMount() {
        const paint = () => {
          const list = inPeriod(reports);
          const ph = list.flatMap(r => r.photos.filter(onServer));
          $('#arSum').innerHTML = list.length
            ? `<b>${list.length}</b> rapport${list.length > 1 ? 's' : ''} avec photos · <b>${ph.length}</b> photo${
                ph.length > 1 ? 's' : ''} · ≈ ${fmtMo(ph.reduce((s, p) => s + weight(p), 0))}`
            : 'Aucune photo en ligne pour cette période.';
          $('#arZip').disabled = !list.length;
          $('#arDel').disabled = !list.length || sel.zipped !== key();
        };
        const setPeriod = () => { sel.from = $('#arFrom').value; sel.to = $('#arTo').value; paint(); };
        $('#arFrom').onchange = setPeriod;
        $('#arTo').onchange = setPeriod;
        $$('[data-pre]').forEach(b => b.onclick = () => {
          $('#arFrom').value = ''; $('#arTo').value = monthsAgo(+b.dataset.pre); setPeriod();
        });
        $$('#arLang [data-l]').forEach(b => b.onclick = () => {
          sel.lang = b.dataset.l;
          $$('#arLang [data-l]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        });
        $('#arZip').onclick = () => makeZip(inPeriod(reports), paint);
        $('#arDel').onclick = () => removePhotos(inPeriod(reports));
        paint();
      } });
}

/* Étape 1 : un PDF par rapport, tous dans un ZIP. Les photos y sont à
   la meilleure définition encore disponible. */
async function makeZip(list, paint) {
  if (!list.length) return;
  const btns = [$('#arZip'), $('#arDel')];
  btns.forEach(b => { b.disabled = true; });
  const prog = $('#arProg');
  const files = [], used = new Set();
  try {
    for (const [i, r] of list.entries()) {
      prog.textContent = `PDF ${i + 1} sur ${list.length}…`;
      const g = groupById(r.product_group_id);
      const pdf = await buildReportPDF(r, gridOf(r, g), { lang: sel.lang, company: state.settings.company });
      let name = reportFilename(r, g, 'pdf', sel.lang);
      for (let k = 2; used.has(name); k++) name = reportFilename(r, g, 'pdf', sel.lang).replace(/\.pdf$/, ` (${k}).pdf`);
      used.add(name);
      files.push({ name, data: new Uint8Array(await pdf.arrayBuffer()) });
    }
    const zip = zipBlob(files);
    const zipName = `Mehadrin QC - photos ${fr(sel.from) || 'début'} au ${fr(sel.to) || fr(day(new Date()))}.zip`
      .replace(/\//g, '-');
    download(zip, zipName);
    sel.zipped = key();
    prog.textContent = `Archive prête : ${files.length} PDF · ${fmtMo(zip.size)} — vérifiez qu'elle est bien dans vos téléchargements avant l'étape 2.`;
  } catch (e) {
    prog.textContent = '';
    toast('Archive : ' + (e.message || 'échec'), 'err', { ms: 6000 });
  }
  paint();
}

/* Étape 2 : suppression sur Supabase, par paquets. Seuls les fichiers
   que le stockage dit avoir supprimés — ou qui n'y sont déjà plus —
   sont notés archivés dans leur rapport. */
async function removePhotos(list) {
  if (sel.zipped !== key()) return toast("Téléchargez d'abord le ZIP de cette période.", 'err');
  const photos = list.flatMap(r => r.photos.filter(onServer));
  if (!photos.length) return;
  const size = photos.reduce((s, p) => s + weight(p), 0);
  if (!(await confirmSheet('Retirer les photos',
        `${photos.length} photo${photos.length > 1 ? 's' : ''} de ${list.length} rapport${list.length > 1 ? 's' : ''} ` +
        `(≈ ${fmtMo(size)}) seront supprimées du serveur. Elles restent dans les PDF de l'archive que vous venez ` +
        `de télécharger ; les rapports, eux, restent consultables.`,
        { okLabel: 'Retirer les photos' }))) return;

  const prog = $('#arProg');
  const paths = [...new Set(photos.map(p => p.path))];
  const gone = new Set();
  try {
    for (let i = 0; i < paths.length; i += 100) {
      prog.textContent = `Suppression… ${Math.min(i + 100, paths.length)} sur ${paths.length}`;
      const chunk = paths.slice(i, i + 100);
      const done = await storage.removeMany(chunk);
      done.forEach(n => gone.add(n));
      /* Absente de la réponse : déjà supprimée, ou épargnée par les
         droits. On ne la dit archivée que si elle n'existe plus. */
      for (const pth of chunk) if (!gone.has(pth) && !(await storage.signedUrl(pth, 60))) gone.add(pth);
    }
  } catch (e) {
    toast('Suppression : ' + (e.message || 'échec'), 'err', { ms: 6000 });
  }

  const today = day(new Date());
  let n = 0;
  for (const r of list) {
    /* Relu juste avant d'écrire : une synchronisation a pu apporter une
       version plus récente depuis l'ouverture de l'écran. */
    const cur = (await local.get('reports', r.id)) || r;
    let changed = false;
    for (const p of cur.photos || []) {
      if (onServer(p) && gone.has(p.path)) { p.archived = today; p.uploaded = false; delete p.localId; changed = true; n++; }
    }
    if (changed) {
      await local.put('reports', { ...cur, _dirty: true });
      await queue('report', { id: cur.id });
    }
  }
  sync({ silent: true });
  const left = photos.length - n;
  toast(`${n} photo${n > 1 ? 's' : ''} retirée${n > 1 ? 's' : ''} du serveur${
    left ? ` · ${left} n'ont pas pu l'être` : ''}`, left ? 'err' : '', { ms: 6000 });
  sel.zipped = '';
  renderPhotoArchive();
}
