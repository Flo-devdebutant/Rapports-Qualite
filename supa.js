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
async function freshToken() {
  if (!session) return null;
  const now = Math.floor(Date.now() / 1000);
  if (session.expires_at && session.expires_at - 60 <= now) {
    const r = await fetch(`${base()}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: CONFIG.supabaseKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refresh_token })
    });
    if (!r.ok) {
      // Jeton de rafraîchissement mort (mot de passe changé ailleurs,
      // session révoquée) : on repart proprement de l'écran de
      // connexion plutôt que de laisser des erreurs de droits sortir.
      saveSession(null);
      location.reload();
      return null;
    }
    const d = await r.json();
    saveSession({ ...d, expires_at: Math.floor(Date.now() / 1000) + (d.expires_in || 3600) });
  }
  return session.access_token;
}

async function authHeaders(extra = {}) {
  const token = await freshToken();
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
    await fetch(`${base()}/auth/v1/recover`, {
      method: 'POST',
      headers: { apikey: CONFIG.supabaseKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, gotrue_meta_security: {} })
    });
  },

  async updatePassword(password) {
    const r = await fetch(`${base()}/auth/v1/user`, {
      method: 'PUT',
      headers: await authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ password })
    });
    if (!r.ok) throw new Error((await r.json()).msg || 'Modification impossible');
  },

  signOut() { saveSession(null); }
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
    if (!r.ok) throw new Error(tidy(text));
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
    if (!r.ok) throw new Error(tidy(await r.text()));
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
  }
};
