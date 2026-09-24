/* Mehadrin QC 3.3.3 */
/* ------------------------------------------------------------------
   Point d'entrée : amorçage, authentification, routeur, accueil.
   Le routeur tient dans le hash (#/feed, #/report/new/reception…) :
   pas de serveur à configurer, et le bouton « retour » du téléphone
   fonctionne naturellement.
   ------------------------------------------------------------------ */

import { CONFIG } from './config.js';
import { auth, db, currentUser } from './supa.js';
import { local, sync, startAutoSync, onSync, openDB, forgetPhotos, forgetSharedJournal,
         outboxInfo, retryBlocked, retryBlockedAfterUpdate, isSyncing } from './store.js';
import { DEFAULT_GROUPS, DEFAULT_SETTINGS } from './catalog.js';
import { $, $$, esc, icon, toast, closeSheets, sheet, brandMark, initials } from './ui.js';
import { logoDataUrl } from './logo.js';
import { renderFeed, refreshFeed, renderReportView, reportCard, paintThumbs, livePhotos, feedFilter, localDay } from './reports.js';
import { renderForm, allDrafts } from './form.js';
import { renderSettings, renderGroups, renderGroupEditor, renderPartners, renderUsers, renderAccount, roleLabel } from './settings.js';
import { renderStats } from './stats.js';
import { renderPhotoArchive } from './archive.js';
import { TYPE_LIST, reportType } from './report-types.js';
import { upgradeNcLabel } from './verdict.js';

export const state = {
  profile: null,
  groups: [],
  partners: [],
  settings: { ...DEFAULT_SETTINGS },
  syncState: 'idle',
  pending: 0
};

/* Molette de la souris sur un champ numérique qui a le focus : le
   navigateur change la valeur (13 devient 12, 11…) sans que personne
   ne s'en aperçoive — une pression ou un poids faussé en faisant
   simplement défiler la page. On retire le focus avant que la molette
   n'agisse : la saisie reste telle qu'elle a été tapée, validée comme
   par un clic ailleurs, et la page défile normalement. */
document.addEventListener('wheel', () => {
  const el = document.activeElement;
  if (el && el.tagName === 'INPUT' && el.type === 'number') el.blur();
}, { passive: true, capture: true });

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
  try { await forgetSharedJournal(); } catch (e) { /* ménage facultatif */ }
  if (!currentUser()) return renderAuth();

  /* Première ouverture d'une nouvelle version : les envois que le
     serveur avait refusés sont retentés — la mise à jour en a peut-être
     corrigé la cause (3.3.1 : un rapport refusé pour un champ inconnu). */
  try { await retryBlockedAfterUpdate(CONFIG.version); } catch (e) {}

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
    const info = await outboxInfo();
    state.pending = info.pending; state.blocked = info.blocked;
    updateSyncBadge();
    /* Ré-affichage sans relancer de synchronisation : passer par
       route() rappellerait renderFeed en mode « rafraîchir », donc
       une nouvelle synchro, donc un nouveau « done »… en boucle. */
    if (s === 'done') {
      await loadRefs();
      if (location.hash.startsWith('#/feed')) refreshFeed();
      else if ((location.hash || '#/') === '#/' || location.hash === '#') refreshHome();
    }
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
  state.groups = upgradeNcLabel((await local.all('groups')).sort((a, b) => (a.position || 0) - (b.position || 0)));
  state.partners = (await local.all('partners')).sort((a, b) => a.name.localeCompare(b.name));
  const s = await local.meta('settings');
  if (s) state.settings = { ...DEFAULT_SETTINGS, ...s };

  /* Première ouverture sur une base vide : on sème le catalogue par
     défaut pour que l'inspecteur puisse saisir immédiatement. On
     vérifie d'abord auprès du serveur que la table est réellement
     vide — le cache local l'est aussi avant la première synchro, et
     semer sur cette seule foi écraserait des grilles existantes. */
  if (!state.groups.length && navigator.onLine && canManage()) {
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
      state.groups = upgradeNcLabel((await local.all('groups')).sort((a, b) => (a.position || 0) - (b.position || 0)));
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

/* ============================== CHROME ==============================
   Un seul cadre pour tous les écrans :
     — sur téléphone, une barre du haut et, sur les quatre écrans
       principaux, une barre d'onglets en bas (Accueil, Rapports,
       Nouveau, Stats, Réglages). Un écran « poussé » — fiche, saisie,
       sous-réglage — masque les onglets et montre la flèche retour :
       c'est le schéma que tout le monde connaît sur son téléphone ;
     — sur ordinateur, un rail de navigation à gauche, toujours là, et
       une barre du haut alignée sur la colonne de contenu. L'ancienne
       mise en page était un écran de téléphone étiré : titre collé au
       bord gauche, contenu perdu au milieu, et pour passer du flux aux
       statistiques il fallait repasser par l'accueil. */
const NAV = [
  { id: 'home',     hash: '#/',         icon: 'home',  label: 'Accueil' },
  { id: 'feed',     hash: '#/feed',     icon: 'doc',   label: 'Rapports' },
  { id: 'stats',    hash: '#/stats',    icon: 'chart', label: 'Statistiques', short: 'Stats' },
  { id: 'settings', hash: '#/settings', icon: 'gear',  label: 'Réglages' }
];
/* Les rôles, en un seul endroit :
     — admin : tout ;
     — responsable (Responsable Murisserie) : tout, sauf les comptes
       administrateur et responsable, qu'il ne peut ni modifier ni
       attribuer ;
     — inspecteur (Contrôleur Qualité) : crée et modifie ses rapports ;
     — lecture : consulte et partage.
   La base applique les mêmes règles (voir le README, section 7) :
   l'écran ne fait que ne pas proposer ce qui serait refusé. */
const myRole = () => state.profile?.role;
export const canWrite = () => ['admin', 'responsable', 'inspecteur'].includes(myRole());
export const canManage = () => ['admin', 'responsable'].includes(myRole());
export const isAdmin = () => myRole() === 'admin';

/* Ce qu'un écran veut faire en le quittant : retirer un écouteur de
   défilement, par exemple. Sans ce ménage, chaque visite du formulaire
   en ajoutait un de plus, qui continuait de tourner sur l'écran suivant. */
const leaving = [];
export const onLeave = (fn) => leaving.push(fn);
function runLeave() { while (leaving.length) { try { leaving.pop()(); } catch (e) { /* écran déjà parti */ } } }

let logoUrl = null;
function paintLogos() {
  const put = (u) => $$('img[data-logo]').forEach(l => { if (u) l.src = u; });
  if (logoUrl) return put(logoUrl);
  logoDataUrl().then(u => { logoUrl = u; put(u); });
}

function railHtml(tab) {
  const p = state.profile || {};
  return `<aside class="rail" aria-label="Navigation principale">
    <a class="rail-brand" href="#/" aria-label="Accueil">${brandMark()}<img class="logo" alt="Mehadrin" data-logo></a>
    ${canWrite() ? `<button type="button" class="btn rail-new" data-new aria-label="Nouveau rapport">${icon('plus')}<span>Nouveau rapport</span></button>` : ''}
    <nav class="rail-nav">${NAV.map(n => `<a class="nav-item" href="${n.hash}"${n.id === tab ? ' aria-current="page"' : ''}>${
      icon(n.icon)}<span class="l-full">${esc(n.label)}</span><span class="l-short">${esc(n.short || n.label)}</span></a>`).join('')}</nav>
    <div class="rail-foot">
      <button type="button" class="rail-sync" id="railSync" title="Synchroniser"><span class="dt"></span><span class="tx">À jour</span></button>
      <a class="rail-user" href="#/settings/account" title="Mon compte"><span class="avatar">${esc(initials(p.full_name || p.email))}</span>
        <span class="tx"><b>${esc(p.full_name || '')}</b><span>${esc(roleLabel(p.role) || '')}</span></span></a>
    </div>
  </aside>`;
}

function tabbarHtml(tab) {
  const item = (n) => `<a class="tab" href="${n.hash}"${n.id === tab ? ' aria-current="page"' : ''}>${icon(n.icon)}<span>${esc(n.short || n.label)}</span></a>`;
  const [a, b, c, d] = NAV;
  return `<nav class="tabbar" aria-label="Navigation principale">${item(a)}${item(b)}${
    canWrite() ? `<button type="button" class="tab new" data-new aria-label="Nouveau rapport"><span class="plus">${icon('plus')}</span><span>Nouveau</span></button>` : ''
  }${item(c)}${item(d)}</nav>`;
}

/* `tab` : l'onglet allumé dans la navigation. `root` : écran principal
   — onglets visibles sur téléphone, pas de flèche retour. `sub` : une
   ligne sous le titre (n° de rapport, état du brouillon). */
export function shell(title, body, { back = null, actions = '', onMount, tab = null, root = false, sub = '', brand = false } = {}) {
  runLeave();
  const app = $('#app');
  app.innerHTML = `
    <div class="frame">
      ${railHtml(tab)}
      <div class="stage">
        <header class="topbar${root ? ' root' : ''}${brand ? ' brand' : ''}"><div class="topbar-in">
          ${back !== null ? `<button class="icon-btn" id="back" aria-label="Retour">${icon('back')}</button>` : ''}
          ${brand ? `<img class="logo home-logo" alt="Mehadrin" data-logo>` : ''}
          <div class="tt"><h1${brand ? ' class="sr"' : ''}>${esc(title)}</h1>${sub ? `<p id="subTitle">${sub}</p>` : ''}</div>
          <div class="acts">${actions}</div>
        </div></header>
        <main id="main">${body}</main>
      </div>
    </div>
    ${root ? tabbarHtml(tab) : ''}`;
  document.body.classList.toggle('tabbed', !!root);
  document.body.classList.toggle('has-actions', !!app.querySelector('.sticky-actions'));
  if (back !== null) $('#back').onclick = () => (typeof back === 'function' ? back() : history.back());
  $$('[data-new]').forEach(b => b.onclick = openNew);
  const rs = $('#railSync'); if (rs) rs.onclick = syncNow;
  paintLogos();
  updateSyncBadge();
  onMount?.();
  window.scrollTo(0, 0);
}

/* Nouveau rapport : les trois types, et pour chacun le brouillon en
   cours s'il y en a un — ouvrir le type le reprend. */
export async function openNew() {
  const drafts = canWrite() ? await allDrafts() : [];
  sheet('Nouveau rapport', `<div class="menu">${TYPE_LIST.map(T => {
      const d = drafts.find(x => x.type === T.id);
      return `<button class="menu-item" data-t="${T.id}"><span class="ic t-${T.id}">${icon(T.icon)}</span>
        <span class="tx"><b>${esc(T.title)}</b><span>${d
          ? `Brouillon en cours${d.partner_name ? ' · ' + esc(d.partner_name) : ''}` : esc(T.subtitle)}</span></span>
        ${d ? '<span class="pill warn sm">à reprendre</span>' : ''}<span class="chev">${icon('chevR')}</span></button>`;
    }).join('')}</div>`,
    { onMount(el, close) {
        el.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { close(); go('#/report/new/' + b.dataset.t); });
      } });
}

export function syncBadge() {
  return `<span class="sync" id="syncTag" hidden><span class="dt"></span><span class="tx"></span></span>
          <button class="icon-btn" id="syncBtn" aria-label="Synchroniser">${icon('sync')}</button>`;
}

/* Le bouton annonçait « À jour » quoi qu'il arrive, y compris quand
   rien n'était parti. Il dit maintenant ce qui s'est réellement passé. */
async function syncNow() {
  if (!navigator.onLine) return toast('Hors-ligne : envoi dès le retour du réseau', 'err');
  toast('Synchronisation…');
  /* « Synchroniser » retente aussi ce que le serveur avait refusé :
     c'est le geste naturel, et il n'existait aucun autre moyen de
     relancer un envoi bloqué. */
  await retryBlocked();
  const ok = await sync();
  const info = await outboxInfo();
  if (info.blocked) toast(await refusedText(info), 'err', { ms: 9000 });
  else if (!ok) toast('Envoi incomplet, nouvelle tentative automatique', 'err');
  else toast(info.pending ? `${info.pending} élément${info.pending > 1 ? 's' : ''} encore en attente` : 'À jour');
}

/* « Envoi refusé par le serveur (rapport n° 26-000003) : raison » —
   le numéro plutôt qu'un identifiant, la raison telle que le serveur
   l'a donnée. */
async function refusedText(info) {
  const r0 = info.reasons[0] || {};
  const rep = r0.id ? await local.get('reports', r0.id) : null;
  const what = rep ? `rapport n° ${rep.report_no || '—'}` : r0.kind === 'partner' ? 'carnet d\'adresses'
    : r0.kind === 'group' ? 'réglages d\'un produit' : 'un élément';
  const more = info.blocked > 1 ? ` — et ${info.blocked - 1} autre${info.blocked > 2 ? 's' : ''}` : '';
  return `Envoi refusé par le serveur (${what}) : ${r0.error || 'raison inconnue'}${more}`;
}

function updateSyncBadge() {
  const btn = $('#syncBtn');
  if (btn && !btn.dataset.wired) { btn.dataset.wired = '1'; btn.onclick = syncNow; }
  const offline = !navigator.onLine;
  /* Un envoi refusé ne part pas tout seul : il se signale à part, en
     rouge, plutôt que noyé dans « à envoyer ». */
  const refused = state.blocked || 0;
  const text = offline ? (state.pending ? `${state.pending} en attente` : 'Hors-ligne')
    : refused ? `${refused} refusé${refused > 1 ? 's' : ''}`
    : state.pending > 0 ? `${state.pending} à envoyer` : 'À jour';
  const kind = offline ? 'off' : refused ? 'err' : state.pending > 0 ? 'pending' : '';
  const tag = $('#syncTag');
  if (tag) {
    if (kind) {
      tag.hidden = false;
      tag.className = 'sync ' + kind;
      tag.querySelector('.tx').textContent = text;
    } else tag.hidden = true;
  }
  const rs = $('#railSync');
  if (rs) { rs.className = 'rail-sync ' + kind; rs.querySelector('.tx').textContent = text; rs.title = text + ' — synchroniser'; }
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
  [/^#\/settings\/account$/,        () => renderAccount()],
  [/^#\/settings\/photos$/,         () => renderPhotoArchive()]
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
  /* L'écran qu'on quitte range ses affaires AVANT que le suivant ne se
     dessine : la saisie en cours part dans son brouillon tant qu'elle
     est encore la saisie en cours. */
  runLeave();
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

/* ============================== ACCUEIL ==============================
   L'accueil n'était qu'une liste de liens. Il dit maintenant, d'un coup
   d'œil, ce qui attend : les saisies en cours, les derniers rapports de
   l'équipe et la semaine écoulée — et lance un contrôle d'une touche. */
async function homeData() {
  /* Un rapport commencé et laissé en plan doit se voir dès l'accueil :
     sinon il n'existe nulle part et l'inspecteur recommence tout. */
  const drafts = canWrite() ? await allDrafts() : [];
  const all = (await local.all('reports')).filter(r => !r.deleted && !r._draft)
    .sort((a, b) => new Date(b.report_date) - new Date(a.report_date));
  const sig = JSON.stringify([drafts.map(d => [d.id, d._draftAt, d.partner_name]),
    all.slice(0, 6).map(r => [r.id, r.partner_name, r.summary?.verdict, r._dirty, (r.photos || []).length]), all.length,
    all.filter(r => localDay(r.report_date) >= localDay(Date.now() - 6 * 86400000)).map(r => r.summary?.verdict)]);
  return { drafts, all, sig };
}

/* Une synchronisation vient de finir pendant qu'on regarde l'accueil :
   on ne le redessine que si ce qu'il montre a changé (un rapport d'un
   collègue, un envoi terminé), et à la même hauteur de page. */
let homeSig = '';
async function refreshHome() {
  if (document.body.classList.contains('sheet-open')) return;
  const { sig } = await homeData();
  if (sig === homeSig) return;
  const y = window.scrollY;
  await renderHome();
  window.scrollTo(0, y);
}

async function renderHome() {
  const { drafts, all, sig } = await homeData();
  homeSig = sig;
  const recent = all.slice(0, 6);
  /* Les 7 derniers jours, aujourd'hui compris, comptés en jours
     calendaires : exactement ce que montrera la liste filtrée. */
  const sinceDay = localDay(Date.now() - 6 * 86400000);
  const week = all.filter(r => localDay(r.report_date) >= sinceDay);
  const wNC = week.filter(r => r.summary?.verdict === 'Non Conforme').length;
  const wAcc = week.filter(r => r.summary?.verdict === 'Acceptable').length;
  const first = String(state.profile?.full_name || '').trim().split(/\s+/)[0];
  const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const hour = new Date().getHours();

  shell('Accueil', `
   <div class="home">
    <div class="home-main">
      <div class="hello"><h2>${hour >= 18 ? 'Bonsoir' : 'Bonjour'}${first ? ' ' + esc(first) : ''}</h2>
        <p>${esc(today.charAt(0).toUpperCase() + today.slice(1))} · ${esc(state.settings.company)}</p></div>

      ${canWrite() ? `<section class="quick-card" aria-label="Nouveau contrôle">
        <div class="quick">${TYPE_LIST.map(T => {
          const d = drafts.find(x => x.type === T.id);
          return `<button class="qbtn" data-go="#/report/new/${T.id}">
            <span class="ic t-${T.id}">${icon(T.icon)}</span>
            <span><b>${esc(T.short)}</b><span class="s">${esc(T.subtitle)}</span>${
              d ? '<span class="pill warn sm dr">brouillon</span>' : ''}</span></button>`;
        }).join('')}</div></section>` : ''}

      <section class="recent">
        <div class="card-h" style="margin:4px 2px 10px"><h2>Derniers rapports</h2>
          ${all.length ? `<a class="more" href="#/feed">Tout voir (${all.length})</a>` : ''}</div>
        ${recent.length ? `<div class="feed">${recent.map(r => reportCard(r)).join('')}</div>`
          : `<div class="card empty"><div class="ico">${icon('doc')}</div>
              <p>Aucun rapport pour l'instant. ${canWrite() ? 'Le premier contrôle démarre juste au-dessus.' : ''}</p></div>`}
      </section>
    </div>

    <div class="home-side">
      ${drafts.length ? `<section class="drafts card">
        <div class="card-h pad" style="padding-bottom:0;margin-bottom:6px"><h2>En cours</h2>
          <span class="muted">appui long : abandonner</span></div>
        ${drafts.map(d => `
        <button class="draft-row" data-draft="${esc(d.id)}">
          <span class="ic t-${esc(d.type)}">${icon(reportType(d.type).icon)}</span>
          <span class="tx"><b>${esc(d.partner_name || reportTypeTitle(d.type))}</b>
            <span>${esc([reportType(d.type).short, groupById(d.product_group_id)?.name,
                         d._draftAt ? 'modifié ' + relTime(d._draftAt) : ''].filter(Boolean).join(' · '))}</span></span>
          <span class="go">Reprendre</span></button>`).join('')}
      </section>` : ''}

      <section class="week card">
        <div class="card-h pad" style="padding-bottom:0;margin-bottom:0"><h2>7 derniers jours</h2></div>
        <div class="metrics">
          <button class="metric" data-feed="">
            <span class="n">${week.length}</span><span class="l">rapport${week.length > 1 ? 's' : ''}</span></button>
          <button class="metric${wNC ? ' fail' : ''}" data-feed="Non Conforme">
            <span class="n">${wNC}</span><span class="l">non conforme${wNC > 1 ? 's' : ''}</span></button>
          <button class="metric${wAcc ? ' warn' : ''}" data-feed="Acceptable">
            <span class="n">${wAcc}</span><span class="l">acceptable${wAcc > 1 ? 's' : ''}</span></button>
        </div>
      </section>

      <p class="about">${esc(state.settings.company)} · Mehadrin QC ${CONFIG.version}</p>
    </div>
   </div>`,
    { tab: 'home', root: true, brand: true, actions: syncBadge(),
      onMount() {
        document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));
        document.querySelectorAll('[data-id]').forEach(b => b.onclick = () => go('#/report/' + b.dataset.id));
        recent.forEach(r => { if (livePhotos(r).length) paintThumbs(r); });
        document.querySelectorAll('[data-feed]').forEach(b => b.onclick = () => {
          /* La carte parle des 7 derniers jours : la liste ouverte aussi. */
          feedFilter({ verdict: b.dataset.feed, from: sinceDay });
          go('#/feed');
        });
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

/* =========================== AUTHENTIFICATION ===========================
   Sur ordinateur, l'écran se partage : la marque et ce que fait
   l'application à gauche, le formulaire à droite. Sur téléphone, le
   logo et le formulaire suffisent. */
const authSide = () => `<aside class="auth-side"><div class="auth-side-in">
    <span class="auth-mark">${brandMark()}</span>
    <h1>Le contrôle qualité,<br>du quai au client.</h1>
    <ul>
      <li>${icon('clipboard')}<span>Réception, expédition et contrôle production, palette par palette</span></li>
      <li>${icon('pdf')}<span>Rapports PDF en cinq langues, partagés en un geste</span></li>
      <li>${icon('sync')}<span>Toute l'équipe synchronisée — la saisie continue hors réseau</span></li>
    </ul></div></aside>`;

function renderAuth(mode = 'login') {
  document.body.classList.remove('tabbed', 'has-actions');
  const app = $('#app');
  app.innerHTML = `<div class="auth">${authSide()}
   <main class="auth-wrap">
    <img class="auth-logo" alt="Mehadrin" id="lg" data-logo>
    <div class="card auth-card">
      <h2>${mode === 'login' ? 'Connexion' : 'Créer un compte'}</h2>
      <p class="muted" style="margin:0 0 18px">${mode === 'login'
        ? 'Contrôle qualité fruits &amp; légumes' : 'Un administrateur ou un responsable validera votre accès.'}</p>
      <div id="msg"></div>
      <form id="f">
        ${mode === 'signup' ? `<div class="field"><label for="n">Nom et prénom</label>
          <input id="n" type="text" autocomplete="name" required></div>` : ''}
        <div class="field"><label for="e">E-mail</label>
          <input id="e" type="email" autocomplete="email" inputmode="email" required></div>
        <div class="field"><label for="p">Mot de passe</label>
          <input id="p" type="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" minlength="8" required>
          ${mode === 'signup' ? '<div class="hint">8 caractères minimum.</div>' : ''}</div>
        <button class="btn block" type="submit" id="sub">${mode === 'login' ? 'Se connecter' : 'Créer le compte'}</button>
      </form>
      <div class="auth-alt">
        <button type="button" class="btn ghost sm" id="alt">${mode === 'login' ? 'Créer un compte' : 'J\'ai déjà un compte'}</button>
        ${mode === 'login' ? '<button type="button" class="btn ghost sm" id="forgot">Mot de passe oublié</button>' : ''}
      </div>
    </div>
   </main></div>`;
  paintLogos();

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
  document.body.classList.remove('tabbed', 'has-actions');
  $('#app').innerHTML = `<div class="auth">${authSide()}<main class="auth-wrap">
    <img class="auth-logo" alt="Mehadrin" id="lg" data-logo>
    <div class="card auth-card" style="text-align:center">
      <div class="empty" style="padding:6px 0 0"><div class="ico">${icon('clock')}</div></div>
      <h2 style="font-size:19px">Compte en attente</h2>
      <p class="muted" style="margin:6px 0 0">Votre accès doit être validé par un administrateur ou un responsable.
      Vous serez opérationnel dès que votre compte sera activé — cet écran se met à jour tout seul.</p>
      <div class="btn-row" style="justify-content:center;margin-top:18px">
        <button class="btn ghost sm" id="again">Vérifier à nouveau</button>
        <button class="btn ghost sm" id="out">Se déconnecter</button>
      </div>
    </div></main></div>`;
  paintLogos();
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
    /* Les curseurs de synchronisation partent avec les données : le
       collègue suivant ne recevait sinon que les rapports modifiés
       après la dernière synchronisation du précédent. */
    for (const k of ['serverCursor', 'arrivalsSeq', 'arrivalsPurge', 'journalInfo']) await local.meta(k, null);
    for (const s of ['reports', 'partners', 'groups', 'outbox', 'photos', 'arrivals']) {
      try { await local.clear(s); } catch (e) {}
    }
  } catch (e) { console.warn('logout', e); }
  state.profile = null; state.groups = []; state.partners = [];
  location.hash = '';
  location.reload();
}

/* ==================== MISE À JOUR AUTOMATIQUE ====================
   Remplacer les fichiers sur GitHub suffit : chaque appareil où
   l'application est ouverte s'en aperçoit, télécharge la nouvelle
   version en arrière-plan, puis recharge la page tout seul — à un
   moment où cela ne coûte rien :
     · sur un écran où tout est déjà enregistré (accueil, liste des
       rapports, fiche d'un rapport, statistiques) — jamais pendant une
       saisie, dans un éditeur ou les réglages ;
     · sans feuille ouverte (PDF en préparation, confirmation…), sans
       envoi en cours, sans champ en cours de frappe ;
     · quand l'application est en arrière-plan, ou qu'on n'a pas touché
       l'écran depuis une minute.
   Jusque-là, la page continue de tourner sur l'ancienne version, servie
   d'un bloc par l'ancien service worker : jamais un mélange des deux. */
const UPDATE_EVERY = 3 * 60 * 1000;      // vérification toutes les 3 minutes
const IDLE_BEFORE_RELOAD = 60 * 1000;    // une minute sans toucher l'écran
const QUIET_ROUTES = [/^#?\/?$/, /^#\/feed$/, /^#\/report\/[\w-]+$/, /^#\/stats$/];
let lastInput = Date.now();
let waitingWorker = null;                // nouvelle version prête, en attente
let pendingReload = false;               // nouvelle version active, page encore ancienne
let askedActivation = false, reloading = false;
let registration = null;
let checkForUpdate = () => {};

for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'input'])
  window.addEventListener(ev, () => { lastInput = Date.now(); }, { passive: true, capture: true });

function safeToReload() {
  if (reloading) return false;
  if (!QUIET_ROUTES.some(re => re.test(location.hash || '#/'))) return false;
  if (document.querySelector('.sheet.on')) return false;
  if (isSyncing()) return false;
  return document.hidden || Date.now() - lastInput > IDLE_BEFORE_RELOAD;
}

function reloadForUpdate() {
  if (reloading) return;
  reloading = true;
  /* Même écran, même position dans la page après le rechargement. */
  try {
    sessionStorage.setItem('qc.updatedFrom', CONFIG.version);
    sessionStorage.setItem('qc.updateScroll', JSON.stringify({ hash: location.hash, y: window.scrollY }));
  } catch (e) {}
  location.reload();
}

function applyUpdateIfSafe() {
  if (!(waitingWorker || pendingReload) || !safeToReload()) return;
  if (waitingWorker) {
    /* La nouvelle version prend la main ; la page se recharge dès que
       c'est fait (controllerchange ci-dessous). */
    askedActivation = true;
    waitingWorker.postMessage('skipWaiting');
    waitingWorker = null;
    /* Filet : si la nouvelle version n'a pas pris la main (service
       worker occupé), on redemandera. */
    setTimeout(() => {
      if (!reloading && registration?.waiting) { askedActivation = false; waitingWorker = registration.waiting; }
    }, 15000);
  } else reloadForUpdate();
}

async function watchUpdates() {
  /* Le service worker qui servait la page juste avant le changement : à
     la toute première visite il n'y en a pas, et sa prise de contrôle
     n'est pas une mise à jour. Tenu à jour à chaque changement — une
     page ouverte à la première visite doit, elle aussi, se mettre à
     jour ensuite. */
  let lastController = navigator.serviceWorker.controller;
  let reg;
  try { reg = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }); }
  catch (e) { return; }
  registration = reg;
  const track = (w) => {
    if (!w) return;
    const check = () => { if (w.state === 'installed' && navigator.serviceWorker.controller) waitingWorker = w; };
    check();
    w.addEventListener('statechange', check);
  };
  if (reg.waiting && navigator.serviceWorker.controller) waitingWorker = reg.waiting;
  track(reg.installing);
  reg.addEventListener('updatefound', () => track(reg.installing));
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    const before = lastController;
    lastController = navigator.serviceWorker.controller;
    if (!before) return;                 // toute première installation : rien à recharger
    pendingReload = true;
    /* Activée par cette page : on recharge tout de suite. Activée par un
       autre onglet : on attend un moment sans risque. */
    if (askedActivation) reloadForUpdate(); else applyUpdateIfSafe();
  });
  let lastCheck = 0;
  checkForUpdate = () => {
    if (!navigator.onLine || Date.now() - lastCheck < 60000) return;
    lastCheck = Date.now();
    reg.update().catch(() => {});
  };
  setInterval(checkForUpdate, UPDATE_EVERY);
  window.addEventListener('online', checkForUpdate);
  setInterval(applyUpdateIfSafe, 5000);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) applyUpdateIfSafe();
  else checkForUpdate();
});

/* Après une mise à jour : on le dit, une fois, et on revient là où
   l'on en était dans la page (la liste met un instant à se remplir). */
try {
  const from = sessionStorage.getItem('qc.updatedFrom');
  const pos = JSON.parse(sessionStorage.getItem('qc.updateScroll') || 'null');
  sessionStorage.removeItem('qc.updatedFrom'); sessionStorage.removeItem('qc.updateScroll');
  if (from && from !== CONFIG.version) setTimeout(() => toast(`Application mise à jour — version ${CONFIG.version}`, '', { ms: 5000 }), 1800);
  if (pos && pos.y > 0) {
    const t0 = lastInput;
    for (const ms of [700, 1600]) setTimeout(() => {
      if (lastInput === t0 && location.hash === pos.hash) window.scrollTo(0, pos.y);
    }, ms);
  }
} catch (e) {}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', watchUpdates);
}

boot();
