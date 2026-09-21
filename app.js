/* ------------------------------------------------------------------
   Point d'entrée : amorçage, authentification, routeur, accueil.
   Le routeur tient dans le hash (#/feed, #/report/new/reception…) :
   pas de serveur à configurer, et le bouton « retour » du téléphone
   fonctionne naturellement.
   ------------------------------------------------------------------ */

import { CONFIG } from './config.js';
import { auth, db, currentUser } from './supa.js';
import { local, sync, startAutoSync, onSync, pendingCount, openDB } from './store.js';
import { DEFAULT_GROUPS, DEFAULT_SETTINGS } from './catalog.js';
import { $, esc, icon, toast } from './ui.js';
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
  await openDB();
  if (!currentUser()) return renderAuth();
  try {
    await loadProfile();
  } catch {
    // Hors-ligne au démarrage : on repart du cache local.
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
     défaut pour que l'inspecteur puisse saisir immédiatement. */
  if (!state.groups.length && navigator.onLine && state.profile?.role === 'admin') {
    try {
      await db('product_groups').upsert(DEFAULT_GROUPS.map(g => ({
        id: g.id, name: g.name, position: g.position, active: true,
        config: { ...g.config, icon: g.icon }
      })));
      await db('settings').upsert([{ key: 'app', value: DEFAULT_SETTINGS }]);
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
    btn.onclick = async () => { toast('Synchronisation…'); await sync(); toast('À jour'); };
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
  [/^#\/settings\/groups\/([\w-]+)$/, (m) => renderGroupEditor(m[1])],
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
  const h = location.hash || '#/';
  if (!goingBack) {
    /* Une même adresse répétée ne s'empile pas (redessin, filtre). */
    if (trail[trail.length - 1] !== h) trail.push(h);
    if (trail.length > 40) trail.shift();
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
   sur une adresse, ou rechargement de la page. */
export function back(fallback = '#/') {
  trail.pop();
  const prev = trail.pop() || fallback;
  goingBack = true;
  if ((location.hash || '#/') === prev) { goingBack = false; trail.push(prev); route(); }
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
          b.onclick = () => go('#/report/new/' + d.type);
          /* Appui long : abandonner le brouillon. Le geste reste
             discret — on ne met pas une croix rouge sur un écran
             d'accueil — mais il existe. */
          let t;
          const start = () => { t = setTimeout(() => dropDraft(d), 600); };
          const stop  = () => clearTimeout(t);
          b.addEventListener('pointerdown', start);
          ['pointerup', 'pointerleave', 'pointercancel'].forEach(e => b.addEventListener(e, stop));
          b.oncontextmenu = (e) => { e.preventDefault(); stop(); dropDraft(d); };
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
  toast('Brouillon supprimé', '', { action: 'Annuler', onAction: async () => {
    await local.put('reports', copy); renderHome();
  } });
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
    await auth.resetPassword(email);
    toast('E-mail de réinitialisation envoyé');
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
  $('#out').onclick = () => { auth.signOut(); location.hash = ''; renderAuth(); };
}

export function logout() {
  auth.signOut();
  local.meta('profile', null);
  location.hash = '';
  location.reload();
}

/* ------------------------- service worker ------------------------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

boot();
