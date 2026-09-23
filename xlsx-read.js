/* ------------------------------------------------------------------
   Lecture d'un classeur Excel (.xlsx) ou d'un fichier CSV, sans
   bibliothèque externe — comme le reste de l'application, qui doit
   s'installer et fonctionner hors ligne.

   Un .xlsx est une archive zip de fichiers XML. On lit le répertoire
   central de l'archive, on décompresse les trois ou quatre fichiers
   utiles, et on parcourt la feuille ligne à ligne.

   Chaque cellule sort sous sa forme BRUTE : { t, v } où `v` est le
   texte exact stocké par Excel. Un n° de palette ou un GGN à treize
   chiffres ne passe jamais par un nombre à virgule flottante, qui en
   arrondirait les derniers chiffres ; c'est l'appelant qui décide
   quelle colonne est un nombre, une date ou un identifiant.
   ------------------------------------------------------------------ */

const utf8 = new TextDecoder('utf-8');

/* ============================ ZIP ============================ */
function zipEntries(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Ce fichier n'est pas un classeur Excel (.xlsx).");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = new Map();
  for (let k = 0; k < count && p + 46 <= u8.length; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize  = dv.getUint32(p + 20, true);
    const usize  = dv.getUint32(p + 24, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const off  = dv.getUint32(p + 42, true);
    const name = utf8.decode(u8.subarray(p + 46, p + 46 + nlen));
    out.set(name.replace(/^\/+/, ''), { method, csize, usize, off });
    p += 46 + nlen + xlen + clen;
  }
  return { u8, dv, entries: out };
}

async function zipRead(zip, name) {
  const e = zip.entries.get(name);
  if (!e) return null;
  const { dv, u8 } = zip;
  const nlen = dv.getUint16(e.off + 26, true), xlen = dv.getUint16(e.off + 28, true);
  const start = e.off + 30 + nlen + xlen;
  const data = u8.subarray(start, start + e.csize);
  if (e.method === 0) return utf8.decode(data);
  if (e.method !== 8) throw new Error('Compression du classeur non prise en charge.');
  return utf8.decode(await inflateRaw(data, e.usize));
}

/* Le navigateur sait décompresser tout seul (DecompressionStream) ;
   un appareil trop ancien pour cela passe par la version écrite ici. */
export async function inflateRaw(data, sizeHint) {
  if (typeof DecompressionStream === 'function') {
    try {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (e) { /* on retombe sur la version JavaScript */ }
  }
  return inflate(data, sizeHint);
}

/* ---- Décompression DEFLATE (RFC 1951), d'après « puff » de zlib ---- */
const LBASE = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
const LEXT  = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
const DBASE = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
const DEXT  = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
const CLORDER = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];

function huff(lengths) {
  const counts = new Uint16Array(16), offs = new Uint16Array(16), syms = new Uint16Array(lengths.length);
  for (const l of lengths) counts[l]++;
  counts[0] = 0;
  for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + counts[i - 1];
  lengths.forEach((l, s) => { if (l) syms[offs[l]++] = s; });
  return { counts, syms };
}

let FIXED = null;
function fixedTables() {
  if (FIXED) return FIXED;
  const l = new Array(288);
  for (let i = 0; i < 144; i++) l[i] = 8;
  for (let i = 144; i < 256; i++) l[i] = 9;
  for (let i = 256; i < 280; i++) l[i] = 7;
  for (let i = 280; i < 288; i++) l[i] = 8;
  FIXED = { lit: huff(l), dist: huff(new Array(30).fill(5)) };
  return FIXED;
}

export function inflate(src, sizeHint = 0) {
  let out = new Uint8Array(Math.max(1024, sizeHint || src.length * 4)), op = 0;
  let pos = 0, buf = 0, cnt = 0;
  const grow = (n) => {
    if (op + n <= out.length) return;
    const o = new Uint8Array(Math.max(out.length * 2, op + n)); o.set(out); out = o;
  };
  const bits = (n) => {
    while (cnt < n) {
      if (pos >= src.length) throw new Error('Classeur endommagé (données tronquées).');
      buf |= src[pos++] << cnt; cnt += 8;
    }
    const v = buf & ((1 << n) - 1);
    buf >>>= n; cnt -= n;
    return v;
  };
  const decode = (h) => {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len < 16; len++) {
      code |= bits(1);
      const c = h.counts[len];
      if (code - c < first) return h.syms[index + (code - first)];
      index += c; first += c; first <<= 1; code <<= 1;
    }
    throw new Error('Classeur endommagé (code invalide).');
  };
  const codes = (lit, dist) => {
    for (;;) {
      let sym = decode(lit);
      if (sym < 256) { grow(1); out[op++] = sym; continue; }
      if (sym === 256) return;
      sym -= 257;
      if (sym >= 29) throw new Error('Classeur endommagé (longueur).');
      const len = LBASE[sym] + bits(LEXT[sym]);
      const ds = decode(dist);
      const d = DBASE[ds] + bits(DEXT[ds]);
      if (d > op) throw new Error('Classeur endommagé (distance).');
      grow(len);
      for (let k = 0; k < len; k++) { out[op] = out[op - d]; op++; }
    }
  };

  let last;
  do {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      buf = 0; cnt = 0;
      if (pos + 4 > src.length) throw new Error('Classeur endommagé.');
      const len = src[pos] | (src[pos + 1] << 8); pos += 4;
      grow(len);
      out.set(src.subarray(pos, pos + len), op); op += len; pos += len;
    } else if (type === 1) {
      const f = fixedTables(); codes(f.lit, f.dist);
    } else if (type === 2) {
      const nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4;
      const cl = new Array(19).fill(0);
      for (let i = 0; i < ncode; i++) cl[CLORDER[i]] = bits(3);
      const ch = huff(cl);
      const lens = [];
      while (lens.length < nlen + ndist) {
        const sym = decode(ch);
        if (sym < 16) lens.push(sym);
        else if (sym === 16) {
          if (!lens.length) throw new Error('Classeur endommagé.');
          const prev = lens[lens.length - 1];
          for (let r = 3 + bits(2); r > 0; r--) lens.push(prev);
        } else if (sym === 17) { for (let r = 3 + bits(3); r > 0; r--) lens.push(0); }
        else { for (let r = 11 + bits(7); r > 0; r--) lens.push(0); }
      }
      codes(huff(lens.slice(0, nlen)), huff(lens.slice(nlen, nlen + ndist)));
    } else throw new Error('Classeur endommagé (bloc).');
  } while (!last);
  return out.subarray(0, op);
}

/* ============================ XML ============================ */
const unxml = (s) => s
  .replace(/_x([0-9A-Fa-f]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/&(#x[0-9A-Fa-f]+|#\d+|lt|gt|amp|quot|apos);/g, (_, e) =>
    e === 'lt' ? '<' : e === 'gt' ? '>' : e === 'amp' ? '&' : e === 'quot' ? '"' : e === 'apos' ? "'"
    : String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)));

const attr = (s, name) => {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(s);
  return m ? m[1] : null;
};

function sharedStrings(xml) {
  if (!xml) return [];
  const out = [];
  const re = /<si>([\s\S]*?)<\/si>|<si\/>/g;
  let m;
  while ((m = re.exec(xml))) {
    const body = (m[1] || '').replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
    let s = '';
    const t = /<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g;
    let n;
    while ((n = t.exec(body))) s += n[1] ? unxml(n[1]) : '';
    out.push(s);
  }
  return out;
}

const colIndex = (ref) => {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
};

function sheetRows(xml, sst) {
  const rows = [];
  const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
  const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let m;
  while ((m = rowRe.exec(xml))) {
    const r = Number(attr(m[1], 'r')) || rows.length + 1;
    const cells = [];
    if (m[2]) {
      let c, auto = 0;
      cellRe.lastIndex = 0;
      while ((c = cellRe.exec(m[2]))) {
        const ref = attr(c[1], 'r');
        const ci = ref ? colIndex(ref) : auto;
        auto = ci + 1;
        const t = attr(c[1], 't') || 'n';
        const body = c[2] || '';
        let v = null;
        if (t === 'inlineStr') {
          const is = /<is>([\s\S]*?)<\/is>/.exec(body);
          if (is) v = sharedStrings(`<si>${is[1]}</si>`)[0];
        } else {
          const vm = /<v>([\s\S]*?)<\/v>/.exec(body);
          if (vm) v = unxml(vm[1]);
        }
        if (v == null) continue;
        if (t === 's') cells[ci] = { t: 's', v: sst[Number(v)] ?? '' };
        else if (t === 'str' || t === 'inlineStr') cells[ci] = { t: 's', v };
        else cells[ci] = { t: t === 'b' ? 'b' : t === 'e' ? 'e' : t === 'd' ? 'd' : 'n', v };
      }
    }
    rows.push({ r, cells });
  }
  return rows;
}

/* Toutes les feuilles, dans l'ordre du classeur. */
export async function readWorkbook(buffer) {
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const zip = zipEntries(u8);
  const wb = await zipRead(zip, 'xl/workbook.xml');
  if (!wb) throw new Error("Ce classeur ne contient aucune feuille lisible.");
  const rels = (await zipRead(zip, 'xl/_rels/workbook.xml.rels')) || '';
  const sst = sharedStrings(await zipRead(zip, 'xl/sharedStrings.xml'));
  const date1904 = /date1904="(1|true)"/.test(wb);

  const target = {};
  const relRe = /<Relationship\b([^>]*)\/?>/g;
  let m;
  while ((m = relRe.exec(rels))) target[attr(m[1], 'Id')] = attr(m[1], 'Target');

  const sheets = [];
  const shRe = /<sheet\b([^>]*)\/?>/g;
  while ((m = shRe.exec(wb))) {
    const rid = attr(m[1], 'r:id');
    let path = target[rid] || '';
    if (!path) continue;
    path = path.startsWith('/') ? path.slice(1) : 'xl/' + path.replace(/^\.\//, '');
    const xml = await zipRead(zip, path);
    if (xml) sheets.push({ name: unxml(attr(m[1], 'name') || ''), rows: sheetRows(xml, sst) });
  }
  return { sheets, date1904 };
}

/* ============================ CSV ============================
   Exporté depuis un ERP français, un CSV est souvent en Windows-1252
   et séparé par des points-virgules : on détecte les deux. */
export function readCsv(buffer) {
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(u8); }
  catch { text = new TextDecoder('windows-1252').decode(u8); }
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] || '';
  const sep = [';', '\t', ','].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows = [];
  let row = [], cell = '', q = false, r = 1;
  const push = () => { row.push(cell); cell = ''; };
  const end = () => {
    push();
    if (row.some(x => x !== '')) rows.push({ r, cells: row.map(v => v === '' ? undefined : { t: 's', v }) });
    row = []; r++;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) push();
    else if (ch === '\n') end();
    else if (ch !== '\r') cell += ch;
  }
  if (cell !== '' || row.length) end();
  return { sheets: [{ name: 'csv', rows }], date1904: false };
}

/* Un classeur ou un CSV, selon le contenu — pas selon l'extension, que
   les téléphones perdent parfois en route. */
export async function readTable(buffer) {
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (u8[0] === 0x50 && u8[1] === 0x4b) return readWorkbook(u8);
  if (u8[0] === 0xD0 && u8[1] === 0xCF)
    throw new Error("Format .xls (Excel 97-2003) non pris en charge : exportez le journal en .xlsx ou en .csv.");
  return readCsv(u8);
}

/* Date Excel (nombre de jours) → « 2026-09-22T08:38:54 », heure
   murale telle qu'affichée dans l'ERP, sans fuseau : c'est l'heure du
   quai, elle ne doit pas glisser selon le téléphone qui la relit. */
export function excelDate(serial, date1904 = false) {
  const n = Number(serial);
  if (!isFinite(n)) return '';
  const ms = Math.round((n + (date1904 ? 1462 : 0) - 25569) * 86400000);
  const d = new Date(ms);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T` +
         `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}
