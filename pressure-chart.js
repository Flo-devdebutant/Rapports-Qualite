/* ------------------------------------------------------------------
   Rendu SVG du graphique de pression (écran).
   Le PDF dessine la même géométrie avec ses propres primitives :
   la source de vérité est chartModel(), dans pressure.js.

   Trois canaux portent la même information, dans cet ordre :
     1. la position du point par rapport à la zone acceptée, peinte
        derrière la courbe — c'est le canal principal, lisible par
        tout le monde ;
     2. la forme du point (rond, losange, triangle, carré), qui passe
        le daltonisme et l'impression en noir et blanc ;
     3. la couleur d'état de la charte, qui confirme.
   Aucun des trois n'est seul porteur : la charte l'interdit, et le
   contrôle de palette le confirme (vert et rouge d'état se croisent à
   ΔE 4,1 en deutéranopie).
   ------------------------------------------------------------------ */

import { chartModel, labelledPoints, labelAnchor, fmtP, fmtG, calibreMin, weightStats,
         palletStats, palletSeverity, sevMark, SEV_COLOR, SEV_LABEL, refText } from './pressure.js';
import { esc } from './ui.js';

/* La couleur passe par le style en ligne : une règle CSS l'emporterait
   sur un attribut de présentation, et le point garderait l'orange de
   la série au lieu de sa couleur d'état. */
const markSVG = (level, x, y, fill) => {
  const m = sevMark(level, x, y);
  const st = ` class="pc-dot" style="fill:${fill}"`;
  return m.kind === 'circle'
    ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${m.r}"${st}/>`
    : `<polygon points="${m.pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}"${st}/>`;
};

/* Le dessin est vectoriel : le viewBox est mis à l'échelle de la
   largeur disponible. Sur un téléphone, un viewBox de 640 se réduit
   de moitié et les quinze graduations deviennent illisibles — on cale
   donc le repère sur la largeur réelle de l'écran pour que le texte
   garde sa taille. */
function viewWidth() {
  const w = typeof window !== 'undefined' ? window.innerWidth : 0;
  return w ? Math.min(640, Math.max(340, w - 56)) : 640;
}

export function pressureChartSVG(pressures, { spec, unit = 'kg', width = viewWidth(), height = 300 } = {}) {
  const m = chartModel(pressures, { width, height, spec });
  if (!m) return '';
  const keep = labelledPoints(m);
  const p = m.points;
  const col = (lvl) => lvl ? SEV_COLOR[lvl] : 'var(--pc-series)';

  const zones = m.zones.map(z =>
    `<rect x="${m.axis.x0}" y="${z.y.toFixed(1)}" width="${m.w.toFixed(1)}"
       height="${z.h.toFixed(1)}" class="pc-zone ${z.kind === 'tol' ? 'tol' : ''}"/>`).join('');

  /* Le trait ne sert qu'à relier les palettes dans l'ordre : il garde
     une couleur unique. C'est le point qui porte la gravité — forme et
     couleur — et la zone acceptée derrière lui qui donne l'écart. */
  const line = p.length > 1
    ? `<polyline points="${p.map(q => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' ')}" class="pc-line"/>`
    : '';

  const dots = p.map(q => markSVG(q.level, q.x, q.y, col(q.level))).join('');

  const levels = [...new Set(p.map(q => q.level).filter(Boolean))]
    .sort((a, b) => ['ok', 'mineur', 'majeur', 'critique'].indexOf(a) - ['ok', 'mineur', 'majeur', 'critique'].indexOf(b));

  return `
<figure class="pc" style="margin:0">
  <svg viewBox="0 0 ${width} ${height}" role="img" preserveAspectRatio="xMidYMid meet"
       aria-label="Pression moyenne par palette, de ${fmtP(m.stats.min)} à ${fmtP(m.stats.max)} ${esc(unit)}${
         spec ? `, référence ${esc(refText(spec))}` : ''}">
    ${zones}
    ${m.ticks.map(t => `<line x1="${m.axis.x0}" y1="${t.y.toFixed(1)}" x2="${m.axis.x1}" y2="${t.y.toFixed(1)}" class="pc-grid"/>${
      t.label ? `<text x="${m.axis.x0 - 6}" y="${(t.y + 3.5).toFixed(1)}" class="pc-tick" text-anchor="end">${t.v}</text>` : ''}`).join('')}
    <line x1="${m.axis.x0}" y1="${m.axis.yBottom}" x2="${m.axis.x1}" y2="${m.axis.yBottom}" class="pc-axis"/>

    ${m.refLines.map(r => `<line x1="${m.axis.x0}" y1="${r.y.toFixed(1)}" x2="${m.axis.x1}" y2="${r.y.toFixed(1)}" class="pc-ref"/>`).join('')}

    ${line}
    ${dots}
    ${p.filter(q => keep.has(q.i)).map(q =>
      `<text x="${q.x.toFixed(1)}" y="${q.labelY.toFixed(1)}" class="pc-val" text-anchor="${labelAnchor(q.i, p.length)}">${fmtP(q.avg)}</text>`).join('')}

    ${p.map(q => q.label
      ? `<text x="${q.x.toFixed(1)}" y="${(m.axis.yBottom + 14).toFixed(1)}" class="pc-tick" text-anchor="middle">${esc(q.label)}</text>`
      : '').join('')}
  </svg>
  <figcaption class="pc-cap">
    ${levels.length
      ? levels.map(l => `<span><i class="pc-k-mark">${keyMark(l)}</i>${esc(SEV_LABEL[l])}</span>`).join('')
      : `<span><i class="pc-k-line"></i>Moyenne par palette</span>`}
    ${spec ? `<span><i class="pc-k-ref"></i>${spec.mode === 'range' ? 'Plage acceptée' : 'Référence'} ${esc(refText(spec))}</span>` : ''}
  </figcaption>
</figure>`;
}

/* Vignette de légende : la même forme qu'au graphique, à l'échelle. */
function keyMark(level) {
  const m = sevMark(level, 7, 7, 0.95);
  const body = m.kind === 'circle'
    ? `<circle cx="7" cy="7" r="${m.r}"/>`
    : `<polygon points="${m.pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}"/>`;
  return `<svg viewBox="0 0 14 14" width="13" height="13" aria-hidden="true"
    style="fill:${SEV_COLOR[level]};stroke:none">${body}</svg>`;
}

/* Tableau de repli : la charte impose qu'une lecture non graphique
   existe toujours — elle sert aussi au daltonisme et à l'impression.
   La colonne État nomme la gravité en toutes lettres : c'est elle qui
   empêche la couleur d'être seule porteuse de sens. */
export function pressureTable(pressures, cfg, spec, bad = new Set()) {
  const rows = pressures?.pallets || [];
  if (!rows.length) return '';
  const head = [];
  for (let f = 1; f <= cfg.fruits; f++)
    for (let s = 1; s <= cfg.sides; s++) head.push(cfg.sides > 1 ? `F${f}·${s}` : `F${f}`);
  return `<div class="pc-tablewrap"><table class="pc-table">
    <thead><tr><th>Palette</th>${head.map(h => `<th>${h}</th>`).join('')}<th>Moy.</th>${
      spec ? '<th>État</th>' : ''}</tr></thead>
    <tbody>${rows.map(r => {
      const v = (r.v || []);
      const st = palletStats(r);
      const sev = st ? palletSeverity(st.avg, spec) : null;
      return `<tr${bad.has(String(r.n ?? '').trim()) ? ' class="bad"' : ''}><th>${esc(String(r.n ?? ''))}</th>${
        head.map((_, i) => `<td>${v[i] === '' || v[i] == null ? '' : fmtP(Number(v[i])).replace('.0', '')}</td>`).join('')
      }<td class="pc-avg"${sev ? ` style="color:var(--sev-${sev.level})"` : ''}>${st ? fmtP(st.avg) : ''}</td>${
        spec ? `<td class="pc-state">${sev
          ? `<i class="pc-k-mark">${keyMark(sev.level)}</i>${esc(sev.tol ? SEV_LABEL.tol : SEV_LABEL[sev.level])}`
          : ''}</td>` : ''}</tr>`;
    }).join('')}</tbody></table></div>`;
}

/* Tableau des poids : le fruit sous le minimum de son calibre ressort
   en rouge — c'est la seule chose que ce tableau doit faire voir. */
export function weightTable(pressures, cfg, group, bad = new Set()) {
  const rows = (pressures?.pallets || []).filter(r => (r.w || []).some(v => v !== '' && v != null));
  if (!rows.length) return '';
  const head = Array.from({ length: cfg.fruits }, (_, f) => `F${f + 1}`);
  return `<div class="pc-tablewrap"><table class="pc-table">
    <thead><tr><th>Palette</th><th>Calibre</th>${head.map(h => `<th>${h}</th>`).join('')}<th>Moy.</th><th>Min. requis</th></tr></thead>
    <tbody>${rows.map(r => {
      const min = calibreMin(group, r.cal);
      const st = weightStats(r, min);
      return `<tr${bad.has(String(r.n ?? '').trim()) ? ' class="bad"' : ''}><th>${esc(String(r.n ?? ''))}</th><td>${esc(r.cal || '—')}</td>${
        head.map((_, i) => {
          const v = r.w?.[i];
          if (v === '' || v == null) return '<td></td>';
          const under = min != null && Number(v) < min;
          return `<td class="${under ? 'pc-under' : ''}">${fmtG(v)}${under ? ' ▼' : ''}</td>`;
        }).join('')
      }<td class="pc-avg">${st ? fmtG(st.avg) : ''}</td><td>${min != null ? fmtG(min) : '—'}</td></tr>`;
    }).join('')}</tbody></table></div>`;
}
