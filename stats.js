/* Statistiques : ce que le flux ne montre pas — quels fournisseurs
   posent problème, sur quels produits, et comment ça évolue. */

import { state, shell, groupById, go, back } from './app.js';
import { local } from './store.js';
import { $, $$, esc, icon, toast } from './ui.js';
import { exportXlsx, originList } from './reports.js';
import { countryName } from './countries.js';

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
      groupMulti(rows, r => originList(r.header).map(c => countryName(c, 'fr'))),
      'Un lot de plusieurs origines compte pour chacune d\'elles.')}

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

function barBlock(title, data, note) {
  if (!data.length) return '';
  const max = Math.max(...data.map(d => d.rate), 1);
  return `<div class="card pad" style="margin-top:14px">
    <h3 style="font-size:14.5px;margin-bottom:${note ? '4px' : '10px'}">${esc(title)}</h3>
    ${note ? `<p class="muted" style="margin:0 0 10px">${esc(note)}</p>` : ''}
    <div class="bars">${data.map(d => {
      const [, kind, word] = levelOf(d.rate);
      return `
      <div class="b"><span class="nm">${esc(d.name)}</span>
        <span class="tr"><i class="lv-${kind}" style="width:${Math.max(2, d.rate / max * 100)}%"></i></span>
        <span class="vl">${d.rate.toFixed(0)} % · ${word} · ${d.total} rapport${d.total > 1 ? 's' : ''}</span></div>`;
    }).join('')}</div>
    <p class="muted" style="margin:10px 0 0;font-size:11.5px">
      Part de rapports non conformes : moins de 15 % correct, 15 à 40 % à surveiller, 40 % et plus critique.</p>
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
