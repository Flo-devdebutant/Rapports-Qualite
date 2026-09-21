/* Statistiques : ce que le flux ne montre pas — quels fournisseurs
   posent problème, sur quels produits, et comment ça évolue. */

import { state, shell, groupById, go, back } from './app.js';
import { local } from './store.js';
import { $, $$, esc, icon, toast } from './ui.js';
import { exportXlsx } from './reports.js';

/* Un tableau, pas un objet : les clés numériques d'un objet sont
   réordonnées par le moteur et « Tout » remonterait en tête. */
const PERIODS = [[30, '30 jours'], [90, '3 mois'], [365, '12 mois'], [0, 'Tout']];
let period = 90;

export async function renderStats() {
  const all = (await local.all('reports')).filter(r => !r.deleted && !r._draft);
  const since = period ? Date.now() - period * 86400000 : 0;
  const rows = all.filter(r => new Date(r.report_date).getTime() >= since);

  const nc = rows.filter(r => r.summary?.verdict === 'Non Conforme').length;
  const acc = rows.filter(r => r.summary?.verdict === 'Acceptable').length;
  const avgNC = avg(rows.map(r => r.summary?.nc).filter(v => v != null));
  const avgStars = avg(rows.map(r => r.summary?.stars).filter(Boolean));

  shell('Statistiques', `
    <div class="chips" style="margin-bottom:12px">
      ${PERIODS.map(([d, l]) =>
        `<button class="chip" data-p="${d}" aria-pressed="${d === period}">${l}</button>`).join('')}
    </div>

    <div class="stat-grid">
      <div class="stat"><div class="n">${rows.length}</div><div class="l">rapports</div></div>
      <div class="stat"><div class="n" style="color:var(--fail)">${nc}</div>
        <div class="l">non conformes${rows.length ? ` · ${pct(nc, rows.length)} %` : ''}</div></div>
      <div class="stat"><div class="n" style="color:var(--warn)">${acc}</div><div class="l">acceptables</div></div>
      <div class="stat"><div class="n">${avgNC == null ? '—' : avgNC.toFixed(1) + ' %'}</div><div class="l">%NC moyen</div></div>
      <div class="stat"><div class="n">${avgStars == null ? '—' : avgStars.toFixed(1)} ★</div><div class="l">note moyenne</div></div>
    </div>

    ${barBlock('Non-conformité par fournisseur',
      group(rows.filter(r => r.type === 'reception'), r => r.partner_name),
      'Les fournisseurs les plus problématiques d\'abord — la base d\'une discussion commerciale chiffrée.')}

    ${barBlock('Non-conformité par produit',
      group(rows, r => groupById(r.product_group_id)?.name || '—'))}

    ${barBlock('Non-conformité par origine',
      group(rows.filter(r => r.header?.origin), r => r.header.origin))}

    ${topDefects(rows)}

    <div class="btn-row" style="margin-top:16px">
      <button class="btn ghost block" id="xls">${icon('excel')} Exporter la période en Excel</button>
    </div>`,
    { back: () => back('#/'),
      onMount() {
        $$('[data-p]').forEach(b => b.onclick = () => { period = +b.dataset.p; renderStats(); });
        $('#xls').onclick = () => exportXlsx(rows);
      } });
}

function group(rows, keyFn) {
  const map = new Map();
  for (const r of rows) {
    const k = keyFn(r) || '—';
    const e = map.get(k) || { total: 0, bad: 0, nc: [] };
    e.total++;
    if (r.summary?.verdict === 'Non Conforme') e.bad++;
    if (r.summary?.nc != null) e.nc.push(r.summary.nc);
    map.set(k, e);
  }
  return [...map.entries()]
    .map(([name, e]) => ({ name, total: e.total, bad: e.bad, rate: e.total ? e.bad / e.total * 100 : 0, avgNC: avg(e.nc) }))
    .filter(x => x.total >= 1)
    .sort((a, b) => b.rate - a.rate || b.total - a.total)
    .slice(0, 8);
}

function barBlock(title, data, note) {
  if (!data.length) return '';
  const max = Math.max(...data.map(d => d.rate), 1);
  return `<div class="card pad" style="margin-top:14px">
    <h3 style="font-size:14.5px;margin-bottom:${note ? '4px' : '10px'}">${esc(title)}</h3>
    ${note ? `<p class="muted" style="margin:0 0 10px">${esc(note)}</p>` : ''}
    <div class="bars">${data.map(d => `
      <div class="b"><span class="nm">${esc(d.name)}</span>
        <span class="tr"><i style="width:${Math.max(2, d.rate / max * 100)}%;
          background:${d.rate >= 40 ? 'var(--fail)' : d.rate >= 15 ? 'var(--warn)' : 'var(--green)'}"></i></span>
        <span class="vl">${d.rate.toFixed(0)}% · ${d.total}</span></div>`).join('')}</div>
  </div>`;
}

/* Quels défauts reviennent le plus souvent hors seuil — utile pour
   cibler un problème de conditionnement ou de chaîne du froid. */
function topDefects(rows) {
  const count = new Map();
  for (const r of rows)
    for (const f of (r.summary?.flagged || []))
      if (f.status === 'fail') count.set(f.label, (count.get(f.label) || 0) + 1);
  const top = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (!top.length) return '';
  const max = top[0][1];
  return `<div class="card pad" style="margin-top:14px">
    <h3 style="font-size:14.5px;margin-bottom:10px">Défauts les plus fréquents</h3>
    <div class="bars">${top.map(([label, n]) => `
      <div class="b"><span class="nm">${esc(label)}</span>
        <span class="tr"><i style="width:${n / max * 100}%"></i></span>
        <span class="vl">${n}</span></div>`).join('')}</div>
  </div>`;
}

const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
