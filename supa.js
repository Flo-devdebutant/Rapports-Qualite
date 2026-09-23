/* ------------------------------------------------------------------
   Client Supabase minimal — pourquoi ne pas charger le SDK officiel ?
   L'application doit rester autonome (aucun CDN à charger au
   démarrage, donc utilisable hors-ligne dès la 1re visite) et légère
   sur un téléphone en entrepôt. Les trois API utilisées (GoTrue,
   PostgREST, Storage) sont de simples appels REST : ~150 lignes
   suffisent, contre ~120 ko de SDK.
   ------------------------------------------------------------------ */

import { CONFIG } from './config.js';

const SESSION_KEY = 'qc.session';
let session = null;

try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { session = null; }

const base = () => CONFIG.supabaseUrl.replace(/\/$/, '');

function saveSession(s) {
  session = s;
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {}
}

export function getSession() { return session; }
export function currentUser() { return session?.user || null; }

/* Le jeton d'accès expire au bout d'une heure : on le renouvelle
   60 s avant l'échéance pour qu'une saisie longue ne casse jamais. */
/* Deux requêtes parties ensemble ne doivent pas renouveler le jeton
   chacune de leur côté : la seconde présenterait un jeton de
   rafraîchissement déjà consommé et ferait fermer la session. */
let refreshing = null;

async function freshToken() {
  if (!session) return null;
  if (refreshing) { await refreshing; return session?.access_token || null; }
  const now = Math.floor(Date.now() / 1000);
  if (session.expires_at && session.expires_at - 60 <= now) {
    refreshing = doRefresh();
    try { await refreshing; } finally { refreshing = null; }
  }
  return session?.access_token || null;
}

async function doRefresh() {
  {
    const r = await fetch(`${base()}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: CONFIG.supabaseKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refresh_token })
    });
    if (!r.ok) {
      /* Jeton de rafraîchissement mort (mot de passe changé ailleurs,
         session révoquée). On ferme la session mais on NE recharge
         pas la page : une saisie en cours serait perdue. L'appelant
         recevra une AuthError et l'application le dira. */
      saveSession(null);
      return;
    }
    const d = await r.json();
    saveSession({ ...d, expires_at: Math.floor(Date.now() / 1000) + (d.expires_in || 3600) });
  }
}

/* Erreur d'authentification : elle doit se distinguer d'une coupure
   réseau, sans quoi une session expirée passe pour un quai sans
   couverture et les rapports finissent par être abandonnés. */
export class AuthError extends Error {
  constructor(msg) { super(msg); this.name = 'AuthError'; this.auth = true; }
}

async function authHeaders(extra = {}) {
  const token = await freshToken();
  /* Sans jeton valable, on ne part PAS avec la clé publique : sous RLS
     le serveur répondrait 200 avec une liste vide, et la
     synchronisation prendrait ce vide pour la vérité — effaçant le
     catalogue produits et le carnet d'adresses de l'appareil. */
  if (session && !token) throw new AuthError('Session expirée');
  return {
    apikey: CONFIG.supabaseKey,
    Authorization: `Bearer ${token || CONFIG.supabaseKey}`,
    ...extra
  };
}

/* ----------------------------- AUTH ----------------------------- */
export const auth = {
  async signUp(email, password, full_name) {
    const r = await fetch(`${base()}/auth/v1/signup`, {
      method: 'POST',
      headers: { apikey: CONFIG.supabaseKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, data: { full_name } })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.msg || d.error_description || d.message || 'Inscription impossible');
    if (d.access_token) saveSession({ ...d, expires_at: Math.floor(Date.now() / 1000) + (d.expires_in || 3600) });
    return d;
  },

  async signIn(email, password) {
    const r = await fetch(`${base()}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: CONFIG.supabaseKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error_description || d.msg || d.message || 'Identifiants incorrects');
    saveSession({ ...d, expires_at: Math.floor(Date.now() / 1000) + (d.expires_in || 3600) });
    return d;
  },

  async resetPassword(email) {
    /* Sans cette vérification, l'écran annonçait « e-mail envoyé »
       même quand le serveur avait refusé : la personne attendait un
       message qui n'arriverait jamais. */
    const r = await fetch(`${base()}/auth/v1/recover`, {
      method: 'POST',
      headers: { apikey: CONFIG.supabaseKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, gotrue_meta_security: {} })
    });
    if (!r.ok) {
      let d = {};
      try { d = await r.json(); } catch (e) {}
      throw new Error(d.msg || d.error_description || d.message || 'Envoi impossible');
    }
  },

  async updatePassword(password) {
    const r = await fetch(`${base()}/auth/v1/user`, {
      method: 'PUT',
      headers: await authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ password })
    });
    if (!r.ok) throw new Error((await r.json()).msg || 'Modification impossible');
  },

  /* On prévient le serveur avant d'oublier le jeton : sans cet appel,
     le jeton de rafraîchissement reste valable côté Supabase jusqu'à
     son expiration. L'échec n'empêche rien — la session locale part
     dans tous les cas. */
  async signOut() {
    const tok = session?.access_token;
    if (tok) {
      try {
        await fetch(`${base()}/auth/v1/logout`, {
          method: 'POST',
          headers: { apikey: CONFIG.supabaseKey, Authorization: `Bearer ${tok}` }
        });
      } catch (e) { /* hors ligne : on oublie quand même la session */ }
    }
    saveSession(null);
  }
};

/* --------------------------- POSTGREST --------------------------- */
/* db('reports').select('*').eq('type','reception').order('report_date', false) */
class Query {
  constructor(table) { this.table = table; this.params = []; this.headers = {}; }
  select(cols = '*') { this.params.push(['select', cols]); return this; }
  eq(col, val)  { this.params.push([col, `eq.${val}`]); return this; }
  neq(col, val) { this.params.push([col, `neq.${val}`]); return this; }
  gt(col, val)  { this.params.push([col, `gt.${val}`]); return this; }
  gte(col, val) { this.params.push([col, `gte.${val}`]); return this; }
  lte(col, val) { this.params.push([col, `lte.${val}`]); return this; }
  in(col, vals) { this.params.push([col, `in.(${vals.join(',')})`]); return this; }
  order(col, asc = true) { this.params.push(['order', `${col}.${asc ? 'asc' : 'desc'}`]); return this; }
  limit(n) { this.params.push(['limit', String(n)]); return this; }

  get url() {
    const qs = this.params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    return `${base()}/rest/v1/${this.table}${qs ? '?' + qs : ''}`;
  }

  async run(method = 'GET', body, prefer) {
    const headers = await authHeaders({
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {})
    });
    const r = await fetch(this.url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    if (!r.ok) {
      const e = new Error(tidy(text));
      e.status = r.status;
      /* Un refus du serveur ne se résoudra pas en réessayant ; une
         panne réseau, si. La file d'attente a besoin de faire la
         différence pour ne jamais jeter un rapport. */
      e.permanent = r.status === 400 || r.status === 401 || r.status === 403 ||
                    r.status === 404 || r.status === 409 || r.status === 422;
      throw e;
    }
    return text ? JSON.parse(text) : null;
  }

  then(res, rej) { return this.run().then(res, rej); }          // await db('x').select()
  insert(rows)   { return this.run('POST',  rows, 'return=representation'); }
  upsert(rows)   { return this.run('POST',  rows, 'resolution=merge-duplicates,return=representation'); }
  update(patch)  { return this.run('PATCH', patch, 'return=representation'); }
  remove()       { return this.run('DELETE', undefined, 'return=representation'); }
}

function tidy(text) {
  try {
    const d = JSON.parse(text);
    if (d.message?.includes('row-level security')) return "Droits insuffisants : votre compte doit être validé par un administrateur.";
    return d.message || d.hint || text;
  } catch { return text; }
}

export const db = (table) => new Query(table);

/* ---------------------------- STORAGE ---------------------------- */
export const storage = {
  async upload(path, blob, contentType = 'image/jpeg') {
    const r = await fetch(`${base()}/storage/v1/object/photos/${path}`, {
      method: 'POST',
      headers: await authHeaders({ 'Content-Type': contentType, 'x-upsert': 'true' }),
      body: blob
    });
    if (!r.ok) {
      const e = new Error(tidy(await r.text()));
      e.status = r.status;
      e.permanent = [400, 401, 403, 404, 409, 413, 422].includes(r.status);
      throw e;
    }
    return path;
  },

  /* Les photos ne sont pas publiques : on demande une URL signée
     (1 h) au moment de l'affichage ou de la génération du PDF. */
  async signedUrl(path, expiresIn = 3600) {
    const r = await fetch(`${base()}/storage/v1/object/sign/photos/${path}`, {
      method: 'POST',
      headers: await authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ expiresIn })
    });
    if (!r.ok) return null;
    const d = await r.json();
    return `${base()}/storage/v1${d.signedURL}`;
  },

  async download(path) {
    const url = await this.signedUrl(path, 600);
    if (!url) return null;
    const r = await fetch(url);
    return r.ok ? await r.blob() : null;
  },

  async remove(path) {
    await fetch(`${base()}/storage/v1/object/photos/${path}`, {
      method: 'DELETE', headers: await authHeaders()
    }).catch(() => {});
  },

  /* Suppression groupée, pour l'archivage. Contrairement à remove(),
     l'échec remonte, et la réponse dit quels fichiers ont réellement
     disparu : les droits (RLS) peuvent en épargner certains sans
     erreur, et l'application ne doit pas les croire archivés. */
  async removeMany(paths) {
    if (!paths.length) return [];
    const r = await fetch(`${base()}/storage/v1/object/photos`, {
      method: 'DELETE',
      headers: await authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ prefixes: paths })
    });
    if (!r.ok) {
      const e = new Error(tidy(await r.text()));
      e.status = r.status;
      throw e;
    }
    const d = await r.json().catch(() => []);
    return (Array.isArray(d) ? d : []).map(o => o.name).filter(Boolean);
  }
};
