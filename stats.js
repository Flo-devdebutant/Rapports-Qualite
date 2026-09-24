/* Mehadrin QC 3.3.3 */
/* Statistiques : ce que le flux ne montre pas — quels fournisseurs
   posent problème, sur quels produits, et comment ça évolue. */

import { state, shell, groupById, go, back } from './app.js';
import { local } from './store.js';
import { $, $$, esc, icon, toast } from './ui.js';
import { exportXlsx, originList } from './reports.js';
import { countryName } from './countries.js';
import { TYPE_LIST } from './report-types.js';

/* Un tableau, pas un objet : les clés numériques d'un objet sont
   réordonnées par le moteur et « Tout » remonterait en tête. */
const PERIODS = [[30, '30 jours'], [90, '3 mois'], [365, '12 mois'], [0, 'Tout']];
let period = 90;
/* Types de rapports retenus : un ou plusieurs ; vide = tous. */
const types = new Set();

export async function renderStats() {
  const all = (await local.all('reports')).filter(r => !r.deleted && !r._draft);
  const since = period ? Date.now() - period * 86400000 : 0;
  const rows = all.filter(r => new Date(r.report_date).getTime() >= since && (!types.size || types.has(r.type)));

  const nc = rows.filter(r => r.summary?.verdict === 'Non Conforme').length;
  const acc = rows.filter(r => r.summary?.verdict === 'Acceptable').length;
  const avgNC = avg(rows.map(r => r.summary?.nc).filter(v => v != null));
  const avgStars = avg(rows.map(r => r.summary?.stars).filter(Boolean));

  shell('Statistiques', `
    <div class="stats-bar">
      <div class="seg" id="stPeriod" aria-label="Période">${PERIODS.map(([d, l]) =>
        `<button type="button" data-p="${d}" aria-pressed="${d === period}">${l}</button>`).join('')}</div>
      <div class="chips" id="stTypes" aria-label="Types de rapports, un ou plusieurs">
        <button class="chip" data-ty="" aria-pressed="${!types.size}">Tous les rapports</button>
        ${TYPE_LIST.map(T => `<button class="chip" data-ty="${T.id}" aria-pressed="${types.has(T.id)}">${
          icon(T.icon)} ${esc(T.short)}</button>`).join('')}
      </div>
    </div>

    <!-- Les chiffres restent à l'encre tant qu'ils sont nuls : un « 0 »
         rouge criait une alerte qui n'existait pas. -->
    <div class="card stat-grid">
      <div class="stat big"><div class="n">${rows.length}</div><div class="l">rapport${rows.length > 1 ? 's' : ''}</div></div>
      <div class="stat${nc ? ' fail' : ''}"><div class="n">${nc}</div>
        <div class="l">non conforme${nc > 1 ? 's' : ''}${rows.length ? ` · ${pct(nc, rows.length)} %` : ''}</div></div>
      <div class="stat${acc ? ' warn' : ''}"><div class="n">${acc}</div><div class="l">acceptable${acc > 1 ? 's' : ''}</div></div>
      <div class="stat"><div class="n">${avgNC == null ? '—' : avgNC.toFixed(1) + ' %'}</div><div class="l">%NC moyen</div></div>
      <div class="stat"><div class="n">${avgStars == null ? '—' : avgStars.toFixed(1) + ' ★'}</div><div class="l">note moyenne</div></div>
    </div>

    ${rows.length ? '' : `<div class="card empty" style="margin-top:12px"><div class="ico">${icon('chart')}</div>
      <p>${all.length ? 'Aucun rapport sur cette période pour ces types de rapport.' : "Aucun rapport pour l'instant : les statistiques se construisent au fil des contrôles."}</p></div>`}
    <div class="stats-grid">
      ${trendCard(rows)}
      ${barBlock('Par fournisseur',
        group(rows.filter(r => r.type === 'reception'), r => r.partner_name),
        'Réceptions : les fournisseurs les plus problématiques d\'abord — la base d\'une discussion commerciale chiffrée.')}
      ${barBlock('Par produit', group(rows, r => groupById(r.product_group_id)?.name || '—'))}
      ${barBlock('Par origine',
        groupMulti(rows, r => originList(r.header).map(c => countryName(c, 'fr'))),
        'Un lot de plusieurs origines compte pour chacune d\'elles.')}
      ${topDefects(rows)}
    </div>
    ${rows.length ? `<div class="legend" style="margin:12px 2px 0">
      <span><i class="lv-ok"></i>moins de 15 % de non conformes : correct</span>
      <span><i class="lv-warn"></i>15 à 40 % : à surveiller</span>
      <span><i class="lv-fail"></i>40 % et plus : critique</span></div>` : ''}

    <button class="btn ghost block" id="xls" style="margin-top:16px">${icon('excel')} Exporter la sélection en Excel</button>`,
    { tab: 'stats', root: true,
      onMount() {
        $$('[data-p]').forEach(b => b.onclick = () => { period = +b.dataset.p; renderStats(); });
        /* Un type se coche et se décoche ; « Tous » efface la sélection,
           et cocher tous les types revient à « Tous ». */
        $$('[data-ty]').forEach(b => b.onclick = () => {
          const t = b.dataset.ty;
          if (!t) types.clear();
          else if (types.has(t)) types.delete(t);
          else types.add(t);
          if (types.size === TYPE_LIST.length) types.clear();
          renderStats();
        });
        $('#xls').onclick = () => exportXlsx(rows);
      } });
}

const group = (rows, keyFn) => groupMulti(rows, r => [keyFn(r)]);

/* Un rapport peut relever de PLUSIEURS clés : un conteneur Pérou +
   Chili compte dans les deux origines. Regrouper sur la chaîne jointe
   « PE, CL » créait une troisième barre fantôme, étiquetée en codes
   ISO là où tout le reste de l'application dit « Pérou, Chili ». */
function groupMulti(rows, keysFn) {
  const map = new Map();
  for (const r of rows) {
    const keys = (keysFn(r) || []).filter(Boolean);
    for (const k of (keys.length ? keys : ['—'])) {
      const e = map.get(k) || { total: 0, bad: 0, nc: [] };
      e.total++;
      if (r.summary?.verdict === 'Non Conforme') e.bad++;
      if (r.summary?.nc != null) e.nc.push(r.summary.nc);
      map.set(k, e);
    }
  }
  return [...map.entries()]
    .map(([name, e]) => ({ name, total: e.total, bad: e.bad, rate: e.total ? e.bad / e.total * 100 : 0, avgNC: avg(e.nc) }))
    .filter(x => x.total >= 1)
    .sort((a, b) => b.rate - a.rate || b.total - a.total)
    .slice(0, 8);
}

/* Trois paliers de non-conformité. La couleur ne les porte jamais
   seule : le niveau est nommé en toutes lettres à côté du chiffre, et
   la barre change de motif. Un lecteur daltonien ne distinguait pas un
   fournisseur à 14 % d'un à 16 %, et imprimées en noir et blanc, les
   barres se valaient toutes. */
const LEVELS = [
  [40, 'fail', 'critique'],
  [15, 'warn', 'à surveiller'],
  [0,  'ok',   'correct']
];
const levelOf = (rate) => LEVELS.find(([min]) => rate >= min) || LEVELS[2];

/* La barre se lit sur une échelle fixe de 0 à 100 % : un fournisseur à
   8 % ne doit pas paraître aussi mauvais qu'un autre à 60 % parce qu'il
   est seul dans son graphique. Une barre à 0 % reste une piste vide. */
function barBlock(title, data, note) {
  if (!data.length) return '';
  return `<div class="card pad">
    <div class="card-h"><h3>Non-conformité ${esc(title.toLowerCase())}</h3></div>
    ${note ? `<p class="muted" style="margin:-6px 0 12px">${esc(note)}</p>` : ''}
    <div class="bars">${data.map(d => {
      const [, kind, word] = levelOf(d.rate);
      return `
      <div class="b"><span class="nm">${esc(d.name)}</span>
        <span class="vl"><b>${d.rate.toFixed(0)} %</b> · ${word} · ${d.total} rapport${d.total > 1 ? 's' : ''}</span>
        <span class="tr" role="img" aria-label="${esc(d.name)} : ${d.rate.toFixed(0)} % non conformes">${
          d.rate > 0 ? `<i class="lv-${kind}" style="width:${Math.max(1.5, d.rate)}%"></i>` : ''}</span></div>`;
    }).join('')}</div>
  </div>`;
}

/* Quels défauts reviennent le plus souvent hors seuil — utile pour
   cibler un problème de conditionnement ou de chaîne du froid. */
function topDefects(rows) {
  const count = new Map();
  for (const r of rows)
    for (const f of (r.summary?.flagged || [])) {
      if (f.status !== 'fail') continue;
      /* Les écarts de pression sont signalés PALETTE PAR PALETTE :
         « Pression palette 1 », « … 2 », jusqu'à dix par rapport. Comptés
         séparément, ils remplissaient à eux seuls les huit premières
         places et aucun défaut réel n'apparaissait plus. On les replie
         sous une seule entrée. */
      const label = String(f.key || '').startsWith('pressure_')
        ? 'Pression de palette hors référence' : f.label;
      count.set(label, (count.get(label) || 0) + 1);
    }
  const top = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (!top.length) return '';
  const max = top[0][1];
  return `<div class="card pad">
    <div class="card-h"><h3>Défauts les plus fréquents</h3></div>
    <p class="muted" style="margin:-6px 0 12px">Critères hors seuil, en nombre de rapports.</p>
    <div class="bars">${top.map(([label, n]) => `
      <div class="b"><span class="nm">${esc(label)}</span>
        <span class="vl"><b>${n}</b> rapport${n > 1 ? 's' : ''}</span>
        <span class="tr"><i style="width:${n / max * 100}%"></i></span></div>`).join('')}</div>
  </div>`;
}

/* ------------------------- tendance -------------------------
   Une colonne par semaine (30 jours, 3 mois) ou par mois (12 mois,
   tout), empilée par verdict. Les couleurs d'état sont ici à leur
   place — ce sont bien des états — et chaque colonne porte son total ;
   la légende nomme les segments, et un tableau caché donne les mêmes
   chiffres aux lecteurs d'écran. */
const SERIES = [
  ['ok', 'Conforme', 'conforme', (r) => r.summary?.verdict === 'Conforme'],
  ['warn', 'Acceptable', 'acceptable', (r) => r.summary?.verdict === 'Acceptable'],
  ['fail', 'Non conforme', 'non conforme', (r) => r.summary?.verdict === 'Non Conforme'],
  ['none', 'Non évalué', 'non évalué', (r) => !['Conforme', 'Acceptable', 'Non Conforme'].includes(r.summary?.verdict)]
];
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

function buckets(rows) {
  const now = new Date();
  const weekly = period && period <= 90;
  const out = [];
  if (weekly) {
    const monday = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
    let cur = monday(new Date(Date.now() - period * 86400000));
    const end = monday(now);
    while (cur <= end) {
      const next = new Date(cur); next.setDate(cur.getDate() + 7);
      out.push({ from: +cur, to: +next, label: `${String(cur.getDate()).padStart(2, '0')}/${String(cur.getMonth() + 1).padStart(2, '0')}`,
                 long: `semaine du ${cur.getDate()} ${MONTHS[cur.getMonth()]}` });
      cur = next;
    }
  } else {
    let first = period ? new Date(Date.now() - period * 86400000)
      : new Date(Math.min(...rows.map(r => +new Date(r.report_date)), +now));
    let cur = new Date(first.getFullYear(), first.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 1);
    /* « Tout » sur des années : on garde les vingt-quatre derniers mois. */
    const cap = new Date(end); cap.setMonth(cap.getMonth() - 23);
    if (cur < cap) cur = cap;
    while (cur <= end) {
      const next = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      out.push({ from: +cur, to: +next, label: MONTHS[cur.getMonth()],
                 long: `${MONTHS[cur.getMonth()]} ${cur.getFullYear()}` });
      cur = next;
    }
  }
  for (const b of out) {
    const inB = rows.filter(r => { const t = +new Date(r.report_date); return t >= b.from && t < b.to; });
    b.n = inB.length;
    b.parts = SERIES.map(([k, , , f]) => [k, inB.filter(f).length]);
  }
  return { list: out, weekly };
}

function trendCard(rows) {
  if (!rows.length) return '';
  const { list, weekly } = buckets(rows);
  if (!list.length) return '';
  /* Le repère suit la largeur réelle de la carte : un viewBox fixe
     réduisait les graduations à 5 px sur téléphone et les gonflait à
     18 px sur un grand écran. */
  const W = chartWidth(), H = 210, x0 = 34, x1 = W - 8, yTop = 18, yBot = H - 26;
  const max = Math.max(1, ...list.map(b => b.n));
  const step = max <= 4 ? 1 : max <= 10 ? 2 : max <= 20 ? 5 : max <= 50 ? 10 : Math.ceil(max / 5 / 10) * 10;
  const top = Math.ceil(max / step) * step;
  const y = (v) => yBot - (v / top) * (yBot - yTop);
  const band = (x1 - x0) / list.length;
  const bw = Math.min(30, band * 0.62);
  const every = Math.ceil(list.length / 8);          // une étiquette sur deux ou trois quand elles se serrent
  const used = new Set(list.flatMap(b => b.parts.filter(([, n]) => n).map(([k]) => k)));
  /* Extrémité arrondie de 4 px, posée sur la ligne de base ; 2 px de
     fond entre deux segments empilés. */
  const bar = (x, yy, w, h, rTop) => {
    const r = Math.min(rTop, w / 2, h);
    return `M${x},${yy + h}V${yy + r}Q${x},${yy} ${x + r},${yy}H${x + w - r}Q${x + w},${yy} ${x + w},${yy + r}V${yy + h}Z`;
  };
  const ticks = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);

  const cols = list.map((b, i) => {
    const cx = x0 + band * i + band / 2, x = cx - bw / 2;
    let acc = 0;
    const segs = b.parts.filter(([, n]) => n);
    const shapes = segs.map(([k, n], j) => {
      const yy = y(acc + n), h = y(acc) - y(acc + n);
      acc += n;
      const last = j === segs.length - 1;
      const hh = Math.max(1, h - (last ? 0 : 2));
      return `<path class="s-${k}" d="${bar(x, yy + (last ? 0 : 2), bw, hh - (last ? 0 : 0), last ? 4 : 0)}"/>`;
    }).join('');
    const tip = `${b.long} : ${b.n} rapport${b.n > 1 ? 's' : ''}${b.n ? ' — ' + segs.map(([k, n]) =>
      `${n} ${SERIES.find(s => s[0] === k)[2]}${n > 1 && k !== 'none' ? 's' : ''}`).join(', ') : ''}`;
    return `<g class="col"><title>${esc(tip)}</title>
      <rect class="hit" x="${(cx - band / 2).toFixed(1)}" y="${yTop}" width="${band.toFixed(1)}" height="${yBot - yTop}"/>
      ${shapes}
      ${b.n && list.length <= 16 ? `<text class="tv" x="${cx.toFixed(1)}" y="${(y(b.n) - 5).toFixed(1)}" text-anchor="middle">${b.n}</text>` : ''}
      ${i % every === 0 ? `<text class="tt" x="${cx.toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(b.label)}</text>` : ''}</g>`;
  }).join('');

  return `<div class="card pad trend full">
    <div class="card-h"><h3>Rapports ${weekly ? 'par semaine' : 'par mois'}</h3></div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Nombre de rapports ${weekly ? 'par semaine' : 'par mois'}, par verdict">
      <!-- Le motif double la couleur, comme sur les barres : hachuré
           serré pour le non conforme, large pour l'acceptable. -->
      <defs>
        <pattern id="tp-warn" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="7" height="7" fill="#fab219"/><rect width="3.5" height="7" fill="#e09a05"/></pattern>
        <pattern id="tp-fail" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="4" height="4" fill="#d03b3b"/><rect width="2" height="4" fill="#a32222"/></pattern>
      </defs>
      ${ticks.map(v => `<line class="tg" x1="${x0}" x2="${x1}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>
        <text class="tt" x="${x0 - 8}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end">${v}</text>`).join('')}
      <line class="ta" x1="${x0}" x2="${x1}" y1="${yBot}" y2="${yBot}"/>
      ${cols}
    </svg>
    <div class="legend">${SERIES.filter(([k]) => used.has(k)).map(([k, label]) =>
      `<span><i class="sw-${k}"></i>${label}</span>`).join('')}</div>
    <div class="sr"><table><caption>Rapports ${weekly ? 'par semaine' : 'par mois'}</caption>
      <tr><th>Période</th>${SERIES.map(s => `<th>${s[1]}</th>`).join('')}<th>Total</th></tr>
      ${list.map(b => `<tr><td>${esc(b.long)}</td>${b.parts.map(([, n]) => `<td>${n}</td>`).join('')}<td>${b.n}</td></tr>`).join('')}
    </table></div>
  </div>`;
}

function chartWidth() {
  const w = window.innerWidth || 640;
  const rail = w >= 1280 ? 236 : w >= 1024 ? 88 : 0;
  const gutter = w >= 1024 ? 28 : w >= 640 ? 20 : 16;
  const main = Math.min(w >= 1600 ? 1320 : w >= 1024 ? 1200 : 760, w - rail) - 2 * gutter;
  return Math.max(300, Math.round(main - 34));
}

const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
