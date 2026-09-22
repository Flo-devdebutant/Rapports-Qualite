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
  image:  '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.6"/><path d="M4 17l5-5 4 4 2.5-2.5L20 17"/>',
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

/* ------------------------------ toast ------------------------------
   Un message peut porter une action — « Supprimé · Annuler ». C'est la
   seule façon honnête de proposer un repentir sur une suppression :
   demander confirmation avant chaque geste use l'utilisateur, offrir
   le retour arrière après coup ne coûte rien. */
let toastTimer, toastExpire = null;
export function toast(msg, kind = '', { action = '', onAction = null, onExpire = null, ms } = {}) {
  const el = document.getElementById('toast');
  const delay = ms ?? (action ? 6000 : 2600);
  /* Un message chassé par un autre ne doit pas emporter son ménage :
     on exécute la suite différée du précédent avant de le remplacer. */
  const prev = toastExpire; toastExpire = null;
  try { prev?.(); } catch (e) {}
  el.innerHTML = '';
  el.append(document.createTextNode(msg));
  if (action) {
    const b = document.createElement('button');
    b.className = 'toast-act';
    b.textContent = action;
    b.onclick = () => {
      el.className = 'toast ' + kind;
      clearTimeout(toastTimer);
      toastExpire = null;                 // l'annulation a eu lieu : plus rien à nettoyer
      onAction?.();
    };
    el.append(b);
  }
  /* `onExpire` court quand le message s'éteint sans que l'action ait
     été employée : c'est là, et seulement là, que le définitif devient
     définitif. */
  toastExpire = onExpire;
  el.className = 'toast on ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.className = 'toast ' + kind;
    const f = toastExpire; toastExpire = null;
    try { f?.(); } catch (e) {}
  }, delay);
}

/* --------------------------- feuille modale ---------------------------
   Deux exigences venues de l'usage réel sur téléphone :
   — l'arrière-plan ne doit pas défiler quand on fait glisser le doigt
     au-delà du contenu de la feuille (le corps de page est figé à
     l'ouverture, et sa position restaurée à la fermeture) ;
   — la feuille doit se fermer en la tirant vers le bas par sa barre,
     le geste que tout le monde essaie en premier. */
let lockDepth = 0, lockY = 0;

function lockScroll() {
  if (lockDepth++ === 0) {
    lockY = window.scrollY;
    const b = document.body;
    b.style.position = 'fixed';
    b.style.top = `-${lockY}px`;
    b.style.left = '0'; b.style.right = '0';
    b.style.width = '100%';
  }
}
function unlockScroll() {
  if (--lockDepth > 0) return;
  lockDepth = 0;
  const b = document.body;
  b.style.position = ''; b.style.top = ''; b.style.left = ''; b.style.right = ''; b.style.width = '';
  window.scrollTo(0, lockY);
}

/* Feuilles actuellement ouvertes. Le bouton « retour » du système
   change l'adresse sans passer par l'application : sans ce registre, la
   feuille restait affichée par-dessus le nouvel écran et le corps de
   page restait figé — l'application paraissait plantée. */
const openSheets = new Set();
export function closeSheets() { for (const c of [...openSheets]) c(); }

export function sheet(title, html, { onMount, onClose } = {}) {
  const bg = document.createElement('div'); bg.className = 'sheet-bg';
  const sh = document.createElement('div'); sh.className = 'sheet';
  sh.innerHTML = `<div class="sheet-head"><div class="grip"></div>${title ? `<h3>${esc(title)}</h3>` : ''}</div>
    <div class="sheet-body">${html}</div>`;
  document.body.append(bg, sh);
  lockScroll();
  requestAnimationFrame(() => { bg.classList.add('on'); sh.classList.add('on'); });

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    openSheets.delete(close);
    bg.classList.remove('on'); sh.classList.remove('on');
    sh.style.transform = '';
    setTimeout(() => { bg.remove(); sh.remove(); }, 240);
    document.removeEventListener('keydown', onKey);
    unlockScroll();
    onClose?.();
  };
  openSheets.add(close);
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  bg.onclick = close;
  document.addEventListener('keydown', onKey);

  /* Glissement vers le bas depuis l'en-tête. On ne suit que le geste
     descendant : tirer vers le haut ne doit pas décoller la feuille. */
  const head = sh.querySelector('.sheet-head');
  let y0 = null;
  head.addEventListener('pointerdown', (e) => {
    y0 = e.clientY;
    sh.style.transition = 'none';
    head.setPointerCapture?.(e.pointerId);
  });
  head.addEventListener('pointermove', (e) => {
    if (y0 == null) return;
    const dy = Math.max(0, e.clientY - y0);
    sh.style.transform = `translateY(${dy}px)`;
    if (dy > 0) bg.style.opacity = String(Math.max(0.2, 1 - dy / 320));
  });
  const release = (e) => {
    if (y0 == null) return;
    const dy = Math.max(0, (e.clientY ?? y0) - y0);
    y0 = null;
    sh.style.transition = '';
    bg.style.opacity = '';
    if (dy > 90) close(); else sh.style.transform = '';
  };
  head.addEventListener('pointerup', release);
  head.addEventListener('pointercancel', release);

  onMount?.(sh, close);
  return close;
}

/* --------------------------- sélecteur avec recherche ---------------------------
   Une liste déroulante de cinquante-sept pays se parcourt au pouce
   pendant dix secondes. Un champ de recherche en tête règle le
   problème : on tape « per », on obtient Pérou.
   `items` : [{ v, label, hint }]. `allowFree` autorise une valeur
   absente de la liste — un calibre maison, par exemple. */
export function pickSheet(title, items, { value = '', allowFree = false, placeholder = 'Rechercher…', onPick } = {}) {
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  let close;

  /* Classement : le code exact d'abord (« MA » doit donner le Maroc,
     pas l'Allemagne), puis les libellés qui commencent par la
     recherche, puis ceux qui la contiennent. Sans cela, une
     correspondance au milieu d'un mot passe devant l'évidence. */
  const rank = (it, n) => {
    const v = norm(it.v), l = norm(it.label);
    if (v === n) return 0;
    if (l === n) return 1;
    if (l.startsWith(n)) return 2;
    if (v.startsWith(n)) return 3;
    return 4;
  };

  const rows = (q) => {
    const n = norm(q);
    const hits = items
      .filter(it => !n || norm(it.label).includes(n) || norm(it.v).includes(n))
      .map((it, i) => ({ it, i, r: n ? rank(it, n) : 4 }))
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .map(x => x.it);
    if (!hits.length) {
      return allowFree && q.trim()
        ? `<button class="menu-item" data-free><span class="ic n">${icon('plus')}</span>
             <span class="tx"><b>Utiliser « ${esc(q.trim())} »</b><span>Valeur libre</span></span></button>`
        : `<p class="muted" style="margin:0">Aucun résultat.</p>`;
    }
    return hits.map(it => `
      <button class="menu-item pick" data-v="${esc(it.v)}">
        <span class="tx"><b>${esc(it.label)}</b>${it.hint ? `<span>${esc(it.hint)}</span>` : ''}</span>
        <span class="chev">${it.v === value ? '✓' : '›'}</span></button>`).join('') +
      (allowFree && q.trim() && !hits.some(it => norm(it.label) === n)
        ? `<button class="menu-item" data-free style="margin-top:8px"><span class="ic n">${icon('plus')}</span>
             <span class="tx"><b>Utiliser « ${esc(q.trim())} »</b><span>Valeur libre</span></span></button>` : '');
  };

  close = sheet(title, `
    <input type="text" id="pickQ" placeholder="${esc(placeholder)}" autocomplete="off"
           inputmode="search" style="margin-bottom:12px">
    <div class="list pick-list" id="pickList" style="max-height:52dvh;overflow:auto">${rows('')}</div>`,
    { onMount(el, c) {
        close = c;
        const q = el.querySelector('#pickQ'), list = el.querySelector('#pickList');
        const wire = () => {
          list.querySelectorAll('.pick').forEach(b => b.onclick = () => { c(); onPick?.(b.dataset.v); });
          const free = list.querySelector('[data-free]');
          if (free) free.onclick = () => { c(); onPick?.(q.value.trim()); };
        };
        wire();
        q.oninput = () => { list.innerHTML = rows(q.value); wire(); };
        q.onkeydown = (e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          const first = list.querySelector('.pick') || list.querySelector('[data-free]');
          first?.click();
        };
        /* Pas de focus automatique : le clavier qui surgit masquerait la
           moitié de la liste sur un téléphone, alors que l'on choisit
           souvent dans les premiers résultats sans rien taper. */
      } });
  return close;
}

export function confirmSheet(title, message, { danger = true, okLabel = 'Confirmer' } = {}) {
  return new Promise(resolve => {
    /* Toute fermeture vaut refus : par le fond, par la touche Échap,
       ou en tirant la feuille vers le bas. Sans cela, l'appelant
       restait bloqué sur une promesse jamais tenue et l'écran semblait
       figé. */
    let done = false;
    const answer = (v) => { if (!done) { done = true; resolve(v); } };
    sheet(title, `
      <p class="muted" style="margin:0 0 16px">${esc(message)}</p>
      <div class="btn-row">
        <button class="btn ghost" style="flex:1" data-no>Annuler</button>
        <button class="btn ${danger ? 'danger' : ''}" style="flex:1" data-yes>${esc(okLabel)}</button>
      </div>`,
      { onClose: () => answer(false),
        onMount(el, close) {
          el.querySelector('[data-no]').onclick = () => { answer(false); close(); };
          el.querySelector('[data-yes]').onclick = () => { answer(true); close(); };
        } });
  });
}

/* --------------------------- photos --------------------------- */
/* Une photo de téléphone pèse 3-5 Mo : inutilisable en 4G sur un
   quai et coûteux en stockage. On redimensionne à 1400 px et on
   ré-encode en JPEG 0,72 — ~150 à 300 ko, largement suffisant pour
   documenter une tache ou une lecture de pénétromètre. */
export async function compressImage(file, maxSide = 1400, quality = 0.72) {
  let bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) {
    /* `createImageBitmap` refuse le HEIC des iPhone récents. Le
       renvoyer tel quel était le pire des deux mondes : le fichier
       partait au stockage étiqueté image/jpeg, et le PDF — qui n'embarque
       que du JPEG — produisait une page illisible. Second essai par
       <img>, que Safari sait décoder ; à défaut on renonce franchement
       plutôt que de livrer un faux JPEG. */
    bitmap = await viaImage(file);
    if (!bitmap) {
      const e = new Error('Format d\'image non pris en charge — enregistrez la photo en JPEG.');
      e.unsupported = true;
      throw e;
    }
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const out = await new Promise(res => canvas.toBlob(b => res(b), 'image/jpeg', quality));
  if (!out) throw new Error('Conversion de la photo impossible');
  return out;
}

/* Décodage de secours : un <img> accepte les formats que le navigateur
   sait afficher même quand createImageBitmap les refuse. Un
   HTMLImageElement est une source valide pour drawImage et expose
   width/height comme un ImageBitmap — il se substitue tel quel. */
function viaImage(file) {
  return new Promise(res => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      img.width = img.naturalWidth; img.height = img.naturalHeight;
      URL.revokeObjectURL(url);
      res(img.naturalWidth ? img : null);
    };
    img.onerror = () => { URL.revokeObjectURL(url); res(null); };
    img.src = url;
  });
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
     cette mise à jour elle resterait claire au-dessus d'un fond sombre.
     On n'ajoute QU'UNE balise sans media, et on laisse en place les
     deux balises `prefers-color-scheme` de la page : les effacer
     privait le mode « automatique » de tout repli, et la barre restait
     figée sur la dernière couleur choisie même après retour à
     l'automatique. */
  let meta = document.querySelector('meta[name="theme-color"]:not([media])');
  if (mode === 'auto') { meta?.remove(); return; }
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = mode === 'dark' ? '#191b1f' : '#ff8725';
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

/* Enregistrement du fichier sur l'appareil.
   Le clic programmatique sur un lien de téléchargement échoue
   silencieusement sur certains navigateurs mobiles — notamment dans
   une application installée. On vérifie donc que l'attribut est
   réellement pris en charge et, sinon, on ouvre le fichier dans un
   onglet : l'utilisateur l'enregistre depuis la visionneuse. */
export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const supported = 'download' in a;
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  if (!supported) a.target = '_blank';
  document.body.appendChild(a);
  a.click();
  /* Le lien est retiré au tour de boucle suivant, pas tout de suite :
     certains navigateurs mobiles lisent le nom de fichier après le
     clic, et un lien déjà détaché leur fait enregistrer « download ». */
  setTimeout(() => a.remove(), 0);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return supported;
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

/* Nom de fichier propre : on retire ce qu'aucun système de fichiers
   n'accepte, on garde les accents et les espaces — c'est le nom que le
   client verra dans sa pièce jointe, il doit se lire. */
export function safeName(s, max = 120) {
  return String(s || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .replace(/[. ]+$/, '');
}
