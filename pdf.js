/* ------------------------------------------------------------------
   Générateur PDF autonome (aucune bibliothèque externe).
   Pourquoi l'écrire à la main plutôt que d'embarquer jsPDF (~350 ko) :
   le besoin tient en 4 primitives — texte Helvetica, traits, aplats,
   images JPEG — et un PDF conforme se génère en quelques centaines de
   lignes. L'application reste installable et utilisable hors-ligne.

   Encodage : WinAnsi (cp1252) couvre le français, l'italien,
   l'espagnol et le néerlandais, soit toutes les langues d'échange
   avec les clients et fournisseurs.
   ------------------------------------------------------------------ */

const A4 = { w: 595.28, h: 841.89 };
const M = 40;                      // marge
const ACCENT = [0.30, 0.65, 0.87]; // filet bleu des titres de section
const GREEN = [0.09, 0.64, 0.29];
const RED   = [0.86, 0.15, 0.15];
const AMBER = [0.96, 0.62, 0.04];
const GREY  = [0.42, 0.42, 0.42];
const BLACK = [0.05, 0.05, 0.05];

/* ------------------- encodage texte WinAnsi ------------------- */
const WIN_HIGH = { 0x20AC:0x80,0x201A:0x82,0x0192:0x83,0x201E:0x84,0x2026:0x85,0x2020:0x86,0x2021:0x87,
  0x02C6:0x88,0x2030:0x89,0x0160:0x8A,0x2039:0x8B,0x0152:0x8C,0x017D:0x8E,0x2018:0x91,0x2019:0x92,
  0x201C:0x93,0x201D:0x94,0x2022:0x95,0x2013:0x96,0x2014:0x97,0x02DC:0x98,0x2122:0x99,0x0161:0x9A,
  0x203A:0x9B,0x0153:0x9C,0x017E:0x9E,0x0178:0x9F };

function winAnsi(str) {
  const out = [];
  for (const ch of String(str ?? '')) {
    const c = ch.codePointAt(0);
    if (c < 0x100) out.push(c);
    else if (WIN_HIGH[c]) out.push(WIN_HIGH[c]);
    else out.push(0x3F); // ?
  }
  return out;
}
const esc = (bytes) => bytes.map(b =>
  b === 0x28 ? '\\(' : b === 0x29 ? '\\)' : b === 0x5C ? '\\\\' :
  (b < 32 || b > 126) ? '\\' + b.toString(8).padStart(3, '0') : String.fromCharCode(b)
).join('');

/* Largeurs Helvetica (unités/1000) — suffisant pour couper les
   textes trop longs sans déborder des colonnes. */
const HELV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
/* Ponctuation et symboles de la plage haute de cp1252, mesurés dans
   Helvetica. Sans eux, « · » (0xB7, 278 réellement) et « ° » (0xB0,
   400) étaient facturés 556 : une ligne comme « Moyenne du lot 12.4 kg
   · min 9.8 · max 13.0 » se mesurait cinq points trop large, d'où une
   cellule coupée ou un titre centré de travers sans raison visible. */
const HELV_HIGH = {
  0x80: 556, 0x82: 222, 0x83: 556, 0x84: 333, 0x85: 1000, 0x86: 556, 0x87: 556,
  0x88: 333, 0x89: 1000, 0x8A: 667, 0x8B: 333, 0x8C: 1000, 0x8E: 611,
  0x91: 222, 0x92: 222, 0x93: 333, 0x94: 333, 0x95: 350, 0x96: 556, 0x97: 1000,
  0x98: 333, 0x99: 1000, 0x9A: 500, 0x9B: 333, 0x9C: 944, 0x9E: 500, 0x9F: 667,
  0xA0: 278, 0xA1: 333, 0xA2: 556, 0xA3: 556, 0xA4: 556, 0xA5: 556, 0xA6: 260,
  0xA7: 556, 0xA8: 333, 0xA9: 737, 0xAA: 370, 0xAB: 556, 0xAC: 584, 0xAD: 333,
  0xAE: 737, 0xAF: 333, 0xB0: 400, 0xB1: 584, 0xB2: 333, 0xB3: 333, 0xB4: 333,
  0xB5: 556, 0xB6: 537, 0xB7: 278, 0xB8: 333, 0xB9: 333, 0xBA: 365, 0xBB: 556,
  0xBC: 834, 0xBD: 834, 0xBE: 834, 0xBF: 611
};
function charW(code, bold) {
  let w;
  if (code >= 32 && code <= 126) w = HELV[code - 32];
  else if (code >= 0xC0) w = 600;
  else w = HELV_HIGH[code] ?? 556;
  return bold ? w * 1.06 : w;
}
export function textWidth(str, size, bold) {
  return winAnsi(str).reduce((s, c) => s + charW(c, bold), 0) / 1000 * size;
}
function ellipsize(str, size, bold, maxW) {
  if (textWidth(str, size, bold) <= maxW) return str;
  let s = String(str);
  while (s.length > 1 && textWidth(s + '…', size, bold) > maxW) s = s.slice(0, -1);
  return s + '…';
}
function wrapText(str, size, bold, maxW) {
  const words = String(str ?? '').split(/\s+/).filter(Boolean);
  const lines = []; let line = '';
  for (const w of words) {
    const probe = line ? line + ' ' + w : w;
    if (textWidth(probe, size, bold) > maxW && line) { lines.push(line); line = w; }
    else line = probe;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

/* ----------------------- en-tête JPEG ----------------------- */
function jpegInfo(bytes) {
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xFF) { i++; continue; }
    const marker = bytes[i + 1];
    if (marker >= 0xC0 && marker <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(marker)) {
      return { h: (bytes[i + 5] << 8) | bytes[i + 6], w: (bytes[i + 7] << 8) | bytes[i + 8], comps: bytes[i + 9] };
    }
    i += 2 + ((bytes[i + 2] << 8) | bytes[i + 3]);
  }
  return { w: 1, h: 1, comps: 3 };
}

/* =================== constructeur de document =================== */
export class PDF {
  constructor() {
    this.pages = [];
    this.images = [];       // { bytes, w, h, comps }
    /* Le pied de page part chez le destinataire au même titre que le
       reste : il doit suivre la langue choisie. */
    this.footer = (i, n) => `Page ${i} sur ${n}`;
    this.newPage();
  }

  newPage() {
    this.ops = [];
    this.y = M;
    this.pages.push({ ops: this.ops });
    return this;
  }

  /* Réserve la place voulue, passe à la page suivante si besoin. */
  need(h) {
    if (this.y + h > A4.h - M - 18) this.newPage();
    return this;
  }

  /* ---------------------- primitives ---------------------- */
  text(str, x, y, { size = 9, bold = false, color = BLACK, align = 'left', maxW } = {}) {
    let s = String(str ?? '');
    if (maxW) s = ellipsize(s, size, bold, maxW);
    let tx = x;
    if (align === 'center') tx = x - textWidth(s, size, bold) / 2;
    if (align === 'right')  tx = x - textWidth(s, size, bold);
    this.ops.push(
      `BT /${bold ? 'F2' : 'F1'} ${size} Tf ${color.join(' ')} rg 1 0 0 1 ${f(tx)} ${f(A4.h - y)} Tm (${esc(winAnsi(s))}) Tj ET`
    );
    return this;
  }

  line(x1, y1, x2, y2, { color = ACCENT, w = 1, dash = null } = {}) {
    const d = dash ? `[${dash.join(' ')}] 0 d ` : '';
    this.ops.push(`q ${d}${color.join(' ')} RG ${w} w ${f(x1)} ${f(A4.h - y1)} m ${f(x2)} ${f(A4.h - y2)} l S Q`);
    return this;
  }

  /* Polyligne ou polygone : la courbe de pression et les marques de
     gravité ont besoin d'un tracé continu, que `line` ne sait pas
     faire. */
  poly(pts, { fill = null, stroke = null, w = 1.6, close = false } = {}) {
    if (pts.length < 2) return this;
    let op = 'q ';
    if (fill)   op += `${fill.join(' ')} rg `;
    if (stroke) op += `${stroke.join(' ')} RG ${w} w 1 J 1 j `;
    op += pts.map((p, i) => `${f(p.x)} ${f(A4.h - p.y)} ${i ? 'l' : 'm'}`).join(' ');
    if (close) op += ' h';
    op += ` ${fill && stroke ? 'B' : fill ? 'f' : 'S'} Q`;
    this.ops.push(op);
    return this;
  }

  circle(cx, cy, r, { fill = null, stroke = null, w = 1 } = {}) {
    const k = r * 0.5523, y = A4.h - cy;
    let op = 'q ';
    if (fill)   op += `${fill.join(' ')} rg `;
    if (stroke) op += `${stroke.join(' ')} RG ${w} w `;
    op += `${f(cx - r)} ${f(y)} m ` +
          `${f(cx - r)} ${f(y + k)} ${f(cx - k)} ${f(y + r)} ${f(cx)} ${f(y + r)} c ` +
          `${f(cx + k)} ${f(y + r)} ${f(cx + r)} ${f(y + k)} ${f(cx + r)} ${f(y)} c ` +
          `${f(cx + r)} ${f(y - k)} ${f(cx + k)} ${f(y - r)} ${f(cx)} ${f(y - r)} c ` +
          `${f(cx - k)} ${f(y - r)} ${f(cx - r)} ${f(y - k)} ${f(cx - r)} ${f(y)} c `;
    op += `${fill && stroke ? 'B' : fill ? 'f' : 'S'} Q`;
    this.ops.push(op);
    return this;
  }

  rect(x, y, w, h, { fill = null, stroke = null, lw = 0.6 } = {}) {
    let op = '';
    if (fill)   op += `${fill.join(' ')} rg `;
    if (stroke) op += `${stroke.join(' ')} RG ${lw} w `;
    op += `${f(x)} ${f(A4.h - y - h)} ${f(w)} ${f(h)} re ${fill && stroke ? 'B' : fill ? 'f' : 'S'}`;
    this.ops.push(op);
    return this;
  }

  /* Pastille de statut : carré plein + coche ou croix tracée au trait
     (plus sûr qu'un glyphe : aucune dépendance à l'encodage police). */
  badge(x, y, status, size = 8) {
    const c = status === 'ok' ? GREEN : status === 'warn' ? AMBER : RED;
    this.rect(x, y, size, size, { fill: c });
    this.ops.push('1 1 1 RG 1.1 w 1 J 1 j');
    const t = A4.h - y;
    if (status === 'ok') {
      this.ops.push(`${f(x + size * 0.22)} ${f(t - size * 0.52)} m ${f(x + size * 0.42)} ${f(t - size * 0.74)} l ${f(x + size * 0.78)} ${f(t - size * 0.28)} l S`);
    } else if (status === 'fail') {
      this.ops.push(`${f(x + size * 0.26)} ${f(t - size * 0.26)} m ${f(x + size * 0.74)} ${f(t - size * 0.74)} l S`);
      this.ops.push(`${f(x + size * 0.74)} ${f(t - size * 0.26)} m ${f(x + size * 0.26)} ${f(t - size * 0.74)} l S`);
    } else {
      this.ops.push(`${f(x + size * 0.5)} ${f(t - size * 0.22)} m ${f(x + size * 0.5)} ${f(t - size * 0.58)} l S`);
      this.ops.push(`${f(x + size * 0.5)} ${f(t - size * 0.72)} m ${f(x + size * 0.5)} ${f(t - size * 0.8)} l S`);
    }
    return this;
  }

  /* `fit` conserve les proportions et centre l'image dans le cadre :
     une photo prise en portrait ne doit pas sortir écrasée. */
  image(bytes, x, y, w, h, { fit = false } = {}) {
    const info = jpegInfo(bytes);
    this.images.push({ bytes, ...info });
    const id = this.images.length;
    let dw = w, dh = h, dx = x, dy = y;
    if (fit && info.w && info.h) {
      const r = Math.min(w / info.w, h / info.h);
      dw = info.w * r; dh = info.h * r;
      dx = x + (w - dw) / 2; dy = y + (h - dh) / 2;
    }
    this.ops.push(`q ${f(dw)} 0 0 ${f(dh)} ${f(dx)} ${f(A4.h - dy - dh)} cm /Im${id} Do Q`);
    return this;
  }

  /* ---------------------- blocs de mise en page ---------------------- */
  sectionTitle(label) {
    this.need(34);
    this.text(label, M, this.y + 10, { size: 10.5, bold: true });
    this.y += 18;
    this.line(M, this.y, A4.w - M, this.y, { color: ACCENT, w: 1.1 });
    this.y += 12;
    return this;
  }

  /* Ligne « libellé …… valeur », avec pastille éventuelle. */
  row(label, value, { status = null, bold = false, indent = 0, labelW = 190 } = {}) {
    this.need(14);
    this.text(label, M + indent, this.y + 8, { size: 8.6, bold, color: bold ? BLACK : [0.16, 0.16, 0.16], maxW: labelW - indent - 6 });
    const vx = M + labelW;
    if (status) {
      this.badge(vx, this.y + 1.5, status, 8);
      this.text(value, vx + 12, this.y + 8, { size: 8.6, maxW: A4.w - M - vx - 14 });
    } else {
      this.text(value ?? '', vx, this.y + 8, { size: 8.6, maxW: A4.w - M - vx });
    }
    this.y += 13.5;
    return this;
  }

  subhead(label) {
    this.need(16);
    this.text(label, M, this.y + 8, { size: 8.8, bold: true });
    this.y += 13.5;
    return this;
  }

  table(cols, rows) {
    const total = cols.reduce((s, c) => s + c.w, 0);
    const scale = (A4.w - 2 * M) / total;
    const W = cols.map(c => c.w * scale);

    const head = () => {
      this.need(30);
      let x = M;
      const hLines = cols.map((c, i) => wrapText(c.h, 8.2, true, W[i] - 6));
      const hh = Math.max(...hLines.map(l => l.length)) * 10;
      hLines.forEach((lines, i) => {
        lines.forEach((ln, k) => this.text(ln, x + 1, this.y + 8 + k * 10, { size: 8.2, bold: true }));
        x += W[i];
      });
      this.y += hh + 4;
      this.line(M, this.y, A4.w - M, this.y, { color: ACCENT, w: 1.1 });
      this.y += 10;
    };
    head();

    for (const r of rows) {
      const cells = cols.map((c, i) => {
        const v = r[c.k];
        const val = (v && typeof v === 'object') ? v.v : v;
        return wrapText(val ?? '', 8.4, false, W[i] - ((v && v.s) ? 18 : 6));
      });
      const rh = Math.max(...cells.map(l => l.length)) * 10 + 3;
      if (this.y + rh > A4.h - M - 18) { this.newPage(); head(); }
      let x = M;
      cols.forEach((c, i) => {
        const v = r[c.k];
        const st = (v && typeof v === 'object') ? v.s : null;
        let tx = x + 1;
        if (st) { this.badge(x + 1, this.y + 1, st, 8); tx = x + 13; }
        const col = (v && typeof v === 'object' && v.color) ? v.color : BLACK;
        const bold = !!(v && typeof v === 'object' && v.bold);
        cells[i].forEach((ln, k) => this.text(ln, tx, this.y + 8 + k * 10, { size: 8.4, color: col, bold }));
        x += W[i];
      });
      this.y += rh;
    }
    this.y += 6;
    return this;
  }

  /* ------------------------ sérialisation ------------------------ */
  build() {
    const chunks = [];
    const offsets = [];
    let len = 0;
    const push = (data) => {
      const bytes = typeof data === 'string' ? strBytes(data) : data;
      chunks.push(bytes); len += bytes.length;
    };
    const obj = (n, body) => { offsets[n] = len; push(`${n} 0 obj\n${body}\nendobj\n`); };

    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

    const nPages = this.pages.length;
    const FIRST = 3;                       // 1 catalogue, 2 pages
    const contentIds = this.pages.map((_, i) => FIRST + i);
    const pageIds = this.pages.map((_, i) => FIRST + nPages + i);
    const fontId = FIRST + nPages * 2;
    const fontBoldId = fontId + 1;
    const imgBase = fontBoldId + 1;

    obj(1, `<< /Type /Catalog /Pages 2 0 R >>`);
    obj(2, `<< /Type /Pages /Kids [${pageIds.map(i => `${i} 0 R`).join(' ')}] /Count ${nPages} >>`);

    this.pages.forEach((p, i) => {
      const label = this.footer(i + 1, nPages);
      const footer = `BT /F1 7.5 Tf ${GREY.join(' ')} rg 1 0 0 1 ${f(A4.w - M - textWidth(label, 7.5, false))} ${f(M * 0.6)} Tm (${esc(winAnsi(label))}) Tj ET`;
      const stream = p.ops.join('\n') + '\n' + footer;
      const body = strBytes(stream);
      offsets[contentIds[i]] = len;
      push(`${contentIds[i]} 0 obj\n<< /Length ${body.length} >>\nstream\n`);
      push(body);
      push('\nendstream\nendobj\n');
    });

    const xobjs = this.images.map((_, i) => `/Im${i + 1} ${imgBase + i} 0 R`).join(' ');
    this.pages.forEach((_, i) => {
      obj(pageIds[i], `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(A4.w)} ${f(A4.h)}] ` +
        `/Resources << /Font << /F1 ${fontId} 0 R /F2 ${fontBoldId} 0 R >>` +
        (xobjs ? ` /XObject << ${xobjs} >>` : '') + ` >> /Contents ${contentIds[i]} 0 R >>`);
    });

    obj(fontId, `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`);
    obj(fontBoldId, `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`);

    this.images.forEach((im, i) => {
      const n = imgBase + i;
      offsets[n] = len;
      push(`${n} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} ` +
           `/ColorSpace /${im.comps === 1 ? 'DeviceGray' : 'DeviceRGB'} /BitsPerComponent 8 ` +
           `/Filter /DCTDecode /Length ${im.bytes.length} >>\nstream\n`);
      push(im.bytes);
      push('\nendstream\nendobj\n');
    });

    const maxObj = imgBase + this.images.length;
    const xrefPos = len;
    let xref = `xref\n0 ${maxObj}\n0000000000 65535 f \n`;
    for (let i = 1; i < maxObj; i++) xref += `${String(offsets[i] ?? 0).padStart(10, '0')} 00000 n \n`;
    push(xref);
    push(`trailer\n<< /Size ${maxObj} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`);

    const out = new Uint8Array(len);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return new Blob([out], { type: 'application/pdf' });
  }
}

const f = (n) => (Math.round(n * 100) / 100).toString();
function strBytes(s) {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xFF;
  return out;
}

/* Palette du graphique de pression, validée pour un fond blanc :
   orange de marque assombri (contraste ≥ 3:1) et gris de dispersion. */
const SERIES = [0.922, 0.408, 0.204];   // #eb6834
const GRID   = [0.898, 0.906, 0.918];

/* Palette d'état de la charte data-viz, identique à l'écran — le
   client qui compare le PDF à ce qu'a vu l'inspecteur doit retrouver
   les mêmes couleurs. Chacune est toujours doublée d'une forme et
   d'un mot : imprimé en noir et blanc, le rapport reste lisible. */
const SEV = {
  ok:       [0.047, 0.639, 0.047],   // #0ca30c
  mineur:   [0.980, 0.698, 0.098],   // #fab219
  majeur:   [0.925, 0.514, 0.353],   // #ec835a
  critique: [0.816, 0.231, 0.231]    // #d03b3b
};
const ZONE     = [0.878, 0.949, 0.878];  // vert pâle, zone acceptée
const ZONE_TOL = [0.941, 0.976, 0.941];  // plus pâle encore, tolérance

/* Pour du TEXTE, les teintes ci-dessus sont trop claires sur blanc —
   le jaune d'état tombe à 1,8:1. Un mot ou un nombre coloré prend
   donc le cran plus foncé de la même teinte, mesuré à 4,4:1 au moins.
   Les marques du graphique gardent SEV : la forme les distingue. */
const SEV_INK = {
  ok:       [0.039, 0.541, 0.039],   // #0a8a0a
  mineur:   [0.604, 0.388, 0.000],   // #9a6300
  majeur:   [0.659, 0.290, 0.133],   // #a84a22
  critique: [0.816, 0.231, 0.231]    // #d03b3b
};

export const COLORS = { ACCENT, GREEN, RED, AMBER, GREY, BLACK, SERIES, GRID, SEV, SEV_INK, ZONE, ZONE_TOL };
export const PAGE = A4;
export const MARGIN = M;
