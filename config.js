/* ------------------------------------------------------------------
   Connexion à la base partagée.
   Ces deux valeurs ne sont PAS des secrets : la clé « publishable »
   est faite pour vivre dans le navigateur. Ce qui protège les données,
   ce sont les règles RLS posées dans PostgreSQL (un compte doit être
   validé par un administrateur pour lire ou écrire quoi que ce soit).
   Pour repartir sur un autre projet Supabase, seules ces 2 lignes
   changent.
   ------------------------------------------------------------------ */
export const CONFIG = {
  supabaseUrl: 'https://tezqfezcziyarxnekxbu.supabase.co',
  supabaseKey: 'sb_publishable_yU0m0o8H70OvAKM6bNQltQ_W0TifL7k',
  appName: 'Mehadrin QC',
  version: '2.5.0'
};
