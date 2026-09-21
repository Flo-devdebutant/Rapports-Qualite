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
  /* Réglages : chaque entrée doit se reconnaître d'un coup d'œil,
     d'où des objets concrets (presse-papier, camion, badge) plutôt
     que des symboles abstraits. */
  clipboard: '<path d="M9 4h6v3H9z"/><path d="M9 5.5H6.5v15h11v-15H15"/><path d="M9 12.5l1.7 1.7L14.5 10"/>',
  truck:  '<path d="M3 7h10v9H3z"/><path d="M13 10.5h4l3 3V16h-7"/><circle cx="7" cy="18" r="1.9"/><circle cx="17" cy="18" r="1.9"/>',
  badge:  '<circle cx="12" cy="9.2" r="3.1"/><path d="M5.5 19.5c.6-3.4 3.3-5.3 6.5-5.3s5.9 1.9 6.5 5.3"/>',
  theme:  '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 010 16z" fill="currentColor" stroke="none"/>',
  sun:    '<circle cx="12" cy="12" r="4"/><path d="M12 2.8v2M12 19.2v2M21.2 12h-2M4.8 12h-2M18.5 5.5l-1.4 1.4M6.9 17.1l-1.4 1.4M18.5 18.5l-1.4-1.4M6.9 6.9L5.5 5.5"/>',
  moon:   '<path d="M20 14.4A8.4 8.4 0 019.6 4 8.4 8.4 0 1020 14.4z"/>',
  edit:   '<path d="M4 20h4L19 9a2.1 2.1 0 10-3-3L5 17z"/>',
  copy:   '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5h10"/>',
  /* Des curseurs de réglage plutôt qu'un engrenage : à 21 px, une roue
     dentée se réduit à un disque flou, les curseurs restent lisibles. */
  gear:   '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2.1"/><circle cx="10" cy="17" r="2.1"/>',
  chart:  '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  feed:   '<path d="M9 6h11M9 12h11M9 18h7"/><path d="M4.4 6h.01M4.4 12h.01M4.4 18h.01" stroke-width="2.6"/>',
  box:    '<path d="M3 8l9-4 9 4v8l-9 4-9-4z"/><path d="M3 8l9 4 9-4M12 12v8"/>',
  users:  '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><path d="M16 5.2A3.2 3.2 0 0119 8a3.2 3.2 0 01-3 3.2M17 14.8c2.4.4 4 2.3 4 5.2"/>',
  logout: '<path d="M13 4H5.5v16H13"/><path d="M11 12h9M17.2 8.8L20.4 12l-3.2 3.2"/>',
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

/* ---------------------------- thème ---------------------------- */
/* 'auto' | 'light' | 'dark'. Stocké par appareil : un inspecteur peut
   préférer le mode sombre en chambre froide sans l'imposer au bureau. */
export function getTheme() {
  try { return localStorage.getItem('qc.theme') || 'auto'; } catch { return 'auto'; }
}
export function setTheme(mode) {
  try {
    if (mode === 'auto') { localStorage.removeItem('qc.theme'); delete document.documentElement.dataset.theme; }
    else { localStorage.setItem('qc.theme', mode); document.documentElement.dataset.theme = mode; }
  } catch {}
  /* La barre d'adresse du téléphone suit la couleur déclarée : sans
     cette mise à jour elle resterait claire au-dessus d'un fond sombre. */
  const dark = mode === 'dark' ||
    (mode === 'auto' && matchMedia('(prefers-color-scheme:dark)').matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.remove());
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = dark ? '#191b1f' : '#ff8725';
  document.head.appendChild(meta);
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
