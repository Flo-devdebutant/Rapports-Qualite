/* Briques d'interface partagées : échappement, icônes, toast,
   feuille modale, confirmation, compression photo. */

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

export const ICONS = {
  back:   '<path d="M15 18l-6-6 6-6"/>',
  menu:   '<path d="M4 7h16M4 12h16M4 17h16"/>',
  plus:   '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  camera: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.4"/>',
  share:  '<path d="M12 15V4M8.5 7.5L12 4l3.5 3.5"/><path d="M5 13v6h14v-6"/>',
  pdf:    '<path d="M14 3H7v18h11V7z"/><path d="M14 3v4h4"/><path d="M9 14h1.6a1.4 1.4 0 000-2.8H9V17"/>',
  excel:  '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11M15 9v11"/>',
  trash:  '<path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/>',
  edit:   '<path d="M4 20h4L19 9a2.1 2.1 0 10-3-3L5 17z"/>',
  copy:   '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5h10"/>',
  gear:   '<circle cx="12" cy="12" r="3.2"/><path d="M12 3v2.4M12 18.6V21M21 12h-2.4M5.4 12H3M18.4 5.6l-1.7 1.7M7.3 16.7l-1.7 1.7M18.4 18.4l-1.7-1.7M7.3 7.3L5.6 5.6"/>',
  chart:  '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  feed:   '<path d="M4 6h16M4 12h16M4 18h10"/>',
  box:    '<path d="M3 8l9-4 9 4v8l-9 4-9-4z"/><path d="M3 8l9 4 9-4M12 12v8"/>',
  users:  '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><path d="M16 5.2A3.2 3.2 0 0119 8a3.2 3.2 0 01-3 3.2M17 14.8c2.4.4 4 2.3 4 5.2"/>',
  logout: '<path d="M14 7V4H4v16h10v-3"/><path d="M10 12h10M17 9l3 3-3 3"/>',
  check:  '<path d="M4 12.5l5 5L20 6.5"/>',
  x:      '<path d="M6 6l12 12M18 6L6 18"/>',
  sync:   '<path d="M3.5 12a8.5 8.5 0 0114.6-5.9M20.5 12a8.5 8.5 0 01-14.6 5.9"/><path d="M18 3v4h-4M6 21v-4h4"/>',
  down:   '<path d="M12 4v13M7 12l5 5 5-5"/><path d="M4 20h16"/>'
};
export const icon = (n, cls = '') =>
  `<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true">${ICONS[n] || ''}</svg>`;

/* ------------------------------ toast ------------------------------ */
let toastTimer;
export function toast(msg, kind = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast on ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast ' + kind; }, 2600);
}

/* --------------------------- feuille modale --------------------------- */
export function sheet(title, html, { onMount } = {}) {
  const bg = document.createElement('div'); bg.className = 'sheet-bg';
  const sh = document.createElement('div'); sh.className = 'sheet';
  sh.innerHTML = `<div class="grip"></div>${title ? `<h3>${esc(title)}</h3>` : ''}<div class="sheet-body">${html}</div>`;
  document.body.append(bg, sh);
  requestAnimationFrame(() => { bg.classList.add('on'); sh.classList.add('on'); });

  const close = () => {
    bg.classList.remove('on'); sh.classList.remove('on');
    setTimeout(() => { bg.remove(); sh.remove(); }, 240);
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  bg.onclick = close;
  document.addEventListener('keydown', onKey);
  onMount?.(sh, close);
  return close;
}

export function confirmSheet(title, message, { danger = true, okLabel = 'Confirmer' } = {}) {
  return new Promise(resolve => {
    sheet(title, `
      <p class="muted" style="margin:0 0 16px">${esc(message)}</p>
      <div class="btn-row">
        <button class="btn ghost" style="flex:1" data-no>Annuler</button>
        <button class="btn ${danger ? 'danger' : ''}" style="flex:1" data-yes>${esc(okLabel)}</button>
      </div>`,
      { onMount(el, close) {
          el.querySelector('[data-no]').onclick = () => { close(); resolve(false); };
          el.querySelector('[data-yes]').onclick = () => { close(); resolve(true); };
        } });
  });
}

/* --------------------------- photos --------------------------- */
/* Une photo de téléphone pèse 3-5 Mo : inutilisable en 4G sur un
   quai et coûteux en stockage. On redimensionne à 1400 px et on
   ré-encode en JPEG 0,72 — ~150 à 300 ko, largement suffisant pour
   documenter une tache ou une lecture de pénétromètre. */
export async function compressImage(file, maxSide = 1400, quality = 0.72) {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return await new Promise(res => canvas.toBlob(b => res(b || file), 'image/jpeg', quality));
}

/* --------------------------- divers --------------------------- */
export const stars = (n) => {
  const k = Math.max(0, Math.min(5, Number(n) || 0));
  return `<span class="stars" title="${k} sur 5">${'★'.repeat(k)}<span class="off">${'★'.repeat(5 - k)}</span></span>`;
};

export const fmtDate = (iso, withTime = true) => {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}` +
         (withTime ? ` ${p(d.getHours())}:${p(d.getMinutes())}` : '');
};

export const debounce = (fn, ms = 250) => {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* Partage natif (WhatsApp, Mail, SMS…) avec repli sur le
   téléchargement quand l'API n'est pas disponible (ordinateur). */
export async function shareFile(blob, filename, text) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], text }); return 'shared'; }
    catch (e) { if (e.name === 'AbortError') return 'cancelled'; }
  }
  download(blob, filename);
  return 'downloaded';
}
