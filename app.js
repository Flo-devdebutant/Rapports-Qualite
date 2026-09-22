/* ------------------------------------------------------------------
   Point d'entrée : amorçage, authentification, routeur, accueil.
   Le routeur tient dans le hash (#/feed, #/report/new/reception…) :
   pas de serveur à configurer, et le bouton « retour » du téléphone
   fonctionne naturellement.
   ------------------------------------------------------------------ */

import { CONFIG } from './config.js';
import { auth, db, currentUser } from './supa.js';
import { local, sync, startAutoSync, onSync, pendingCount, openDB, forgetPhotos } from './store.js';
import { DEFAULT_GROUPS, DEFAULT_SETTINGS } from './catalog.js';
import { $, esc, icon, toast, closeSheets } from './ui.js';
import { logoDataUrl } from './logo.js';
import { renderFeed, renderReportView } from './reports.js';
import { renderForm, allDrafts } from './form.js';
import { renderSettings, renderGroups, renderGroupEditor, renderPartners, renderUsers, renderAccount } from './settings.js';
import { renderStats } from './stats.js';
import { TYPE_LIST } from './report-types.js';

export const state = {
  profile: null,
  groups: [],
  partners: [],
  settings: { ...DEFAULT_SETTINGS },
  syncState: 'idle',
  pending: 0
};

/* ============================= AMORÇAGE ============================= */
async function boot() {
  try { await bootInner(); }
  catch (e) {
    /* Sans ce filet, la moindre erreur d'amorçage laissait un écran de
       chargement tournant indéfiniment, sans un mot ni un moyen de
       repartir. */
    console.error('boot', e);
    $('#app').innerHTML = `<main><div class="auth-wrap"><div class="card pad" style="text-align:center">
      <div style="font-size:34px">⚠️</div>
      <h2 style="font-size:17px;margin:10px 0 6px">Démarrage impossible</h2>
      <p class="muted">${esc(e?.message || 'Erreur inconnue')}</p>
      <div class="btn-row" style="justify-content:center;margin-top:16px">
        <button class="btn ghost sm" id="retry">Réessayer</button>
        <button class="btn ghost sm" id="bout">Se déconnecter</button>
      </div></div></div></main>`;
    $('#retry').onclick = () => boot();
    $('#bout').onclick = () => logout();
  }
}

async function bootInner() {
  await openDB();
  if (!currentUser()) return renderAuth();

  /* On tire d'abord ce que le serveur a, puis on lit le cache : sans
     cet ordre, le tout premier démarrage trouvait la base locale vide
     et un administrateur réécrivait par-dessus les grilles du serveur,
     pendant qu'un inspecteur voyait « aucun groupe de produit ». */
  if (navigator.onLine) { try { await sync({ silent: true }); } catch (e) { /* on continue hors ligne */ } }

  try {
    await loadProfile();
  } catch (e) {
    /* Un refus d'authentification n'est pas une coupure réseau : on
       renvoie à la connexion plutôt que de servir un cache périmé. */
    if (e?.auth) { await auth.signOut(); return renderAuth(); }
    state.profile = await local.meta('profile');
    if (!state.profile) return renderAuth();
  }
  if (!state.profile?.approved) return renderPending();
  await loadRefs();
  startAutoSync();
  onSync(async (s) => {
    state.syncState = s;
    state.pending = await pendingCount();
    updateSyncBadge();
    /* Ré-affichage sans relancer de synchronisation : passer par
       route() rappellerait renderFeed en mode « rafraîchir », donc
       une nouvelle synchro, donc un nouveau « done »… en boucle. */
    if (s === 'done') { await loadRefs(); if (location.hash.startsWith('#/feed')) renderFeed({ refresh: false }); }
  });
  sync({ silent: true });
  window.addEventListener('hashchange', route);
  route();
}

async function loadProfile() {
  const u = currentUser();
  const rows = await db('profiles').select('*').eq('id', u.id);
  state.profile = rows[0] || null;
  if (state.profile) await local.meta('profile', state.profile);
}

export async function loadRefs() {
  state.groups = (await local.all('groups')).sort((a, b) => (a.position || 0) - (b.position || 0));
  state.partners = (await local.all('partners')).sort((a, b) => a.name.localeCompare(b.name));
  const s = await local.meta('settings');
  if (s) state.settings = { ...DEFAULT_SETTINGS, ...s };

  /* Première ouverture sur une base vide : on sème le catalogue par
     défaut pour que l'inspecteur puisse saisir immédiatement. On
     vérifie d'abord auprès du serveur que la table est réellement
     vide — le cache local l'est aussi avant la première synchro, et
     semer sur cette seule foi écraserait des grilles existantes. */
  if (!state.groups.length && navigator.onLine && state.profile?.role === 'admin') {
    try {
      const existing = await db('product_groups').select('id').limit(1);
      if (!existing.length) {
        await db('product_groups').upsert(DEFAULT_GROUPS.map(g => ({
          id: g.id, name: g.name, position: g.position, active: true,
          config: { ...g.config, icon: g.icon }
        })));
        await db('settings').upsert([{ key: 'app', value: DEFAULT_SETTINGS }]);
      }
      await sync();
      state.groups = (await local.all('groups')).sort((a, b) => (a.position || 0) - (b.position || 0));
    } catch (e) { console.warn('seed', e.message); }
  }
  if (navigator.onLine) {
    try {
      const rows = await db('settings').select('*').eq('key', 'app');
      if (rows[0]) { state.settings = { ...DEFAULT_SETTINGS, ...rows[0].value }; await local.meta('settings', state.settings); }
    } catch {}
  }
}

export const groupById = (id) => state.groups.find(g => g.id === id) || null;

/* ============================== CHROME ============================== */
export function shell(title, body, { back = null, actions = '', onMount } = {}) {
  const app = $('#app');
  app.innerHTML = `
    <header class="topbar">
      ${back !== null
        ? `<button class="icon-btn" id="back" aria-label="Retour">${icon('back')}</button>`
        : `<img class="logo" id="homeLogo" alt="Mehadrin" src="">`}
      <h1>${esc(title)}</h1>
      ${actions}
    </header>
    <main id="main">${body}</main>`;
  if (back !== null) $('#back').onclick = () => (typeof back === 'function' ? back() : history.back());
  else logoDataUrl().then(u => { const l = $('#homeLogo'); if (l && u) l.src = u; });
  updateSyncBadge();
  onMount?.();
  window.scrollTo(0, 0);
}

export function syncBadge() {
  return `<button class="icon-btn" id="syncBtn" aria-label="Synchroniser">${icon('sync')}</button>
          <span class="sync" id="syncTag" hidden><span class="dt"></span><span class="tx"></span></span>`;
}

function updateSyncBadge() {
  const btn = $('#syncBtn');
  if (btn && !btn.dataset.wired) {
    btn.dataset.wired = '1';
    /* Le bouton annonçait « À jour » quoi qu'il arrive, y compris
       quand rien n'était parti. Il dit maintenant ce qui s'est
       réellement passé. */
    btn.onclick = async () => {
      if (!navigator.onLine) return toast('Hors-ligne : envoi dès le retour du réseau', 'err');
      toast('Synchronisation…');
      const ok = await sync();
      const left = await pendingCount();
      if (!ok) toast('Envoi incomplet, nouvelle tentative automatique', 'err');
      else toast(left ? `${left} élément${left > 1 ? 's' : ''} encore en attente` : 'À jour');
    };
  }
  const tag = $('#syncTag');
  if (!tag) return;
  const offline = !navigator.onLine;
  if (offline || state.pending > 0) {
    tag.hidden = false;
    tag.className = 'sync ' + (offline ? 'off' : 'pending');
    tag.querySelector('.tx').textContent = offline
      ? (state.pending ? `${state.pending} en attente` : 'Hors-ligne')
      : `${state.pending} à envoyer`;
  } else tag.hidden = true;
}
window.addEventListener('online',  updateSyncBadge);
window.addEventListener('offline', updateSyncBadge);
export { updateSyncBadge };

/* ============================== ROUTEUR ============================== */
const routes = [
  [/^#\/?$/,                        () => renderHome()],
  [/^#\/feed$/,                     () => renderFeed()],
  [/^#\/report\/new\/(\w+)$/,       (m) => renderForm({ type: m[1] })],
  [/^#\/report\/([\w-]+)\/edit$/,   (m) => renderForm({ id: m[1] })],
  [/^#\/report\/([\w-]+)$/,         (m) => renderReportView(m[1])],
  [/^#\/stats$/,                    () => renderStats()],
  [/^#\/settings$/,                 () => renderSettings()],
  [/^#\/settings\/groups$/,         () => renderGroups()],
  [/^#\/settings\/groups\/([\w-]+)$/, (m) => renderGroupEditor(m[1], true)],
  [/^#\/settings\/partners$/,       () => renderPartners()],
  [/^#\/settings\/users$/,          () => renderUsers()],
  [/^#\/settings\/account$/,        () => renderAccount()]
];

/* Chemin réellement parcouru. La flèche retour doit ramener là d'où
   l'on vient : depuis l'accueil, un nouveau rapport revient à
   l'accueil ; depuis le flux, il revient au flux. Une destination
   écrite en dur dans chaque écran ne peut pas le savoir.
   On tient notre propre pile plutôt que d'appeler history.back(), qui
   rejouerait aussi les allers-retours d'un formulaire vers lui-même. */
const trail = [];
let goingBack = false;

export function route() {
  /* Le bouton « retour » du téléphone change l'adresse sans passer par
     l'application : une feuille modale restée ouverte laissait
     `body{position:fixed}` en place et l'écran paraissait figé. */
  closeSheets();
  const h = location.hash || '#/';
  if (!goingBack) {
    if (trail[trail.length - 2] === h) {
      /* Retour du navigateur ou du téléphone : on RECULE dans la pile.
         L'empiler comme une nouvelle destination ferait repartir la
         flèche de l'application en avant. */
      trail.pop();
    } else if (trail[trail.length - 1] !== h) {
      /* Une même adresse répétée ne s'empile pas (redessin, filtre). */
      trail.push(h);
      if (trail.length > 40) trail.shift();
    }
  }
  goingBack = false;
  for (const [re, fn] of routes) {
    const m = h.match(re);
    if (m) return fn(m);
  }
  location.hash = '#/';
}

export const go = (hash) => { location.hash = hash; };

/* Retour d'un écran : on dépile l'écran courant et on rejoue le
   précédent. `fallback` sert quand la pile est vide — arrivée directe
   sur une adresse, ou rechargement de la page.
   L'écran d'arrivée reste dans la pile : le dépiler aussi faisait
   sauter un niveau au deuxième appui. */
export function back(fallback = '#/') {
  trail.pop();
  let prev = trail[trail.length - 1];
  if (!prev) { prev = fallback; trail.push(prev); }
  goingBack = true;
  if ((location.hash || '#/') === prev) route();
  else location.hash = prev;
}

/* ============================== ACCUEIL ============================== */
async function renderHome() {
  const admin = state.profile?.role === 'admin';
  const canWrite = ['admin', 'inspecteur'].includes(state.profile?.role);
  /* Un rapport commencé et laissé en plan doit se voir dès l'accueil :
     sinon il n'existe nulle part et l'inspecteur recommence tout. */
  const drafts = canWrite ? await allDrafts() : [];
  shell(CONFIG.appName, `
    ${drafts.length ? `<div class="menu" style="margin-bottom:14px">
      ${drafts.map(d => `
      <button class="menu-item draft" data-draft="${esc(d.id)}">
        <span class="ic n">${icon('edit')}</span>
        <span class="tx"><b>Reprendre : ${esc(reportTypeTitle(d.type))}</b>
          <span>${esc([d.partner_name, groupById(d.product_group_id)?.name,
                       d._draftAt ? 'modifié ' + relTime(d._draftAt) : ''].filter(Boolean).join(' · ')) || 'saisie en cours'}</span></span>
        <span class="chev">›</span></button>`).join('')}
    </div>` : ''}
    <div class="menu">
      ${canWrite ? TYPE_LIST.map(T => `
      <button class="menu-item" data-go="#/report/new/${T.id}">
        <span class="ic ${T.tone}">${icon(T.icon)}</span>
        <span class="tx"><b>${esc(T.title)}</b><span>${esc(T.subtitle)}</span></span>
        <span class="chev">›</span></button>`).join('') : ''}
      <button class="menu-item" data-go="#/feed">
        <span class="ic n">${icon('feed')}</span>
        <span class="tx"><b>Flux des rapports</b><span>Tous les contrôles de l'équipe</span></span>
        <span class="chev">›</span></button>
      <button class="menu-item" data-go="#/stats">
        <span class="ic n">${icon('chart')}</span>
        <span class="tx"><b>Statistiques</b><span>Qualité par fournisseur et produit</span></span>
        <span class="chev">›</span></button>
      <button class="menu-item" data-go="#/settings">
        <span class="ic n">${icon('gear')}</span>
        <span class="tx"><b>Réglages</b><span>${admin ? 'Produits, critères, partenaires, équipe' : 'Mon compte'}</span></span>
        <span class="chev">›</span></button>
    </div>
    <p class="muted" style="text-align:center;margin-top:22px">
      ${esc(state.settings.company)} · ${esc(state.profile?.full_name || '')}<br>version ${CONFIG.version}
    </p>`,
    { actions: syncBadge(),
      onMount() {
        document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));
        document.querySelectorAll('[data-draft]').forEach(b => {
          const d = drafts.find(x => x.id === b.dataset.draft);
          /* Appui long : abandonner le brouillon. Le geste reste
             discret — on ne met pas une croix rouge sur un écran
             d'accueil — mais il existe.
             `fired` neutralise le clic fantôme que le navigateur envoie
             en relâchant : sans lui, l'appui long supprimait le
             brouillon PUIS ouvrait un rapport vierge. */
          let t, fired = false;
          b.onclick = (e) => {
            if (fired) { fired = false; e.preventDefault(); return; }
            go('#/report/new/' + d.type);
          };
          const start = () => { fired = false; t = setTimeout(() => { fired = true; dropDraft(d); }, 600); };
          const stop  = () => clearTimeout(t);
          b.addEventListener('pointerdown', start);
          ['pointerup', 'pointerleave', 'pointercancel'].forEach(e => b.addEventListener(e, stop));
          b.oncontextmenu = (e) => { e.preventDefault(); stop(); fired = true; dropDraft(d); };
        });
      } });
}

const reportTypeTitle = (t) => (TYPE_LIST.find(x => x.id === t) || TYPE_LIST[0]).title;

/* « il y a 3 min », « hier » — repère suffisant pour reconnaître son
   propre brouillon sans afficher une date complète. */
function relTime(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return "à l'instant";
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `il y a ${h} h`;
  const j = Math.round(h / 24);
  return j === 1 ? 'hier' : `il y a ${j} jours`;
}

async function dropDraft(d) {
  const copy = { ...d };
  await local.del('reports', d.id);
  renderHome();
  toast('Brouillon supprimé', '', {
    action: 'Annuler',
    onAction: async () => { await local.put('reports', copy); renderHome(); },
    /* Les photos ne partent qu'une fois l'annulation devenue
       impossible : les effacer tout de suite rendrait le bouton
       « Annuler » mensonger. */
    onExpire: () => forgetPhotos((copy.photos || []).map(p => p.localId))
  });
}

/* =========================== AUTHENTIFICATION =========================== */
function renderAuth(mode = 'login') {
  const app = $('#app');
  app.innerHTML = `<main><div class="auth-wrap">
    <img class="auth-logo" alt="Mehadrin" src="" id="lg">
    <div class="card pad">
      <h2 style="font-size:18px;margin-bottom:4px">${mode === 'login' ? 'Connexion' : 'Créer un compte'}</h2>
      <p class="muted" style="margin:0 0 16px">Contrôle qualité fruits &amp; légumes</p>
      <div id="msg"></div>
      <form id="f">
        ${mode === 'signup' ? `<div class="field"><label for="n">Nom et prénom</label>
          <input id="n" type="text" autocomplete="name" required></div>` : ''}
        <div class="field"><label for="e">E-mail</label>
          <input id="e" type="email" autocomplete="email" required></div>
        <div class="field"><label for="p">Mot de passe</label>
          <input id="p" type="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" minlength="8" required>
          ${mode === 'signup' ? '<div class="hint">8 caractères minimum.</div>' : ''}</div>
        <button class="btn block" type="submit" id="sub">${mode === 'login' ? 'Se connecter' : 'Créer le compte'}</button>
      </form>
      <hr class="sep">
      <div class="btn-row" style="justify-content:space-between">
        <button class="btn ghost sm" id="alt">${mode === 'login' ? 'Créer un compte' : 'J\'ai déjà un compte'}</button>
        ${mode === 'login' ? '<button class="btn ghost sm" id="forgot">Mot de passe oublié</button>' : ''}
      </div>
    </div>
    <p class="muted" style="text-align:center;margin-top:18px">Données hébergées en France (Supabase, région Paris).</p>
  </div></main>`;
  logoDataUrl().then(u => { const l = $('#lg'); if (l && u) l.src = u; });

  $('#alt').onclick = () => renderAuth(mode === 'login' ? 'signup' : 'login');
  const forgot = $('#forgot');
  if (forgot) forgot.onclick = async () => {
    const email = $('#e').value.trim();
    if (!email) return toast('Saisissez votre e-mail', 'err');
    try {
      await auth.resetPassword(email);
      toast('E-mail de réinitialisation envoyé');
    } catch (e) { toast(e.message, 'err'); }
  };

  $('#f').onsubmit = async (ev) => {
    ev.preventDefault();
    const btn = $('#sub'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span>';
    const msg = $('#msg');
    try {
      const email = $('#e').value.trim(), pass = $('#p').value;
      if (mode === 'signup') {
        await auth.signUp(email, pass, $('#n').value.trim());
        if (!currentUser()) {
          msg.innerHTML = '<div class="ok-box">Compte créé. Confirmez votre e-mail puis connectez-vous.</div>';
          btn.disabled = false; btn.textContent = 'Créer le compte';
          return;
        }
      } else {
        await auth.signIn(email, pass);
      }
      await boot();
    } catch (e) {
      msg.innerHTML = `<div class="err-box">${esc(e.message)}</div>`;
      btn.disabled = false;
      btn.textContent = mode === 'login' ? 'Se connecter' : 'Créer le compte';
    }
  };
}

let pendingTimer = null;
function renderPending() {
  $('#app').innerHTML = `<main><div class="auth-wrap">
    <img class="auth-logo" alt="Mehadrin" src="" id="lg">
    <div class="card pad" style="text-align:center">
      <div style="font-size:38px">⏳</div>
      <h2 style="font-size:17px;margin:10px 0 6px">Compte en attente</h2>
      <p class="muted">Votre accès doit être validé par un administrateur.
      Vous serez opérationnel dès qu'il aura activé votre compte.</p>
      <div class="btn-row" style="justify-content:center;margin-top:16px">
        <button class="btn ghost sm" id="again">Vérifier à nouveau</button>
        <button class="btn ghost sm" id="out">Se déconnecter</button>
      </div>
    </div></div></main>`;
  logoDataUrl().then(u => { const l = $('#lg'); if (l && u) l.src = u; });
  $('#again').onclick = () => boot();
  $('#out').onclick = () => logout();

  /* L'administrateur valide depuis son poste, à l'autre bout du
     bâtiment : sans cette vérification automatique, le collègue reste
     devant un sablier jusqu'à ce que quelqu'un pense à lui dire de
     toucher le bouton. On regarde toutes les vingt secondes, et on
     entre dès que l'accès est ouvert. */
  clearInterval(pendingTimer);
  pendingTimer = setInterval(async () => {
    if (document.hidden || !navigator.onLine) return;
    if (!document.getElementById('again')) { clearInterval(pendingTimer); return; }
    try {
      const u = currentUser();
      if (!u) return;
      const rows = await db('profiles').select('approved').eq('id', u.id);
      if (rows[0]?.approved) { clearInterval(pendingTimer); boot(); }
    } catch (e) { /* hors ligne ou serveur muet : on réessaiera */ }
  }, 20000);
}

/* Une déconnexion doit vraiment vider l'appareil : les rapports, le
   carnet, les grilles et les brouillons restaient en base locale, et
   le collègue qui se connectait ensuite sur le même téléphone ouvrait
   l'application sur les données du précédent. */
export async function logout() {
  try { await auth.signOut(); } catch (e) { /* le jeton local part quand même */ }
  try {
    await local.meta('profile', null);
    await local.meta('lastSync', null);
    for (const s of ['reports', 'partners', 'groups', 'outbox', 'photos']) {
      try { await local.clear(s); } catch (e) {}
    }
  } catch (e) { console.warn('logout', e); }
  state.profile = null; state.groups = []; state.partners = [];
  location.hash = '';
  location.reload();
}

/* ------------------------- service worker ------------------------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

boot();
