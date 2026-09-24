/* Mehadrin QC 3.3.3 */
/* ------------------------------------------------------------------
   Pays d'origine.
   On stocke le code ISO à deux lettres — stable, court, compris par
   les transitaires — et on affiche le nom en toutes lettres, traduit
   dans la langue du destinataire du PDF.

   La liste couvre les bassins de production qui alimentent le frais en
   Europe. Elle est volontairement finie : une liste mondiale de 250
   entrées rendrait le sélecteur inutilisable sur un téléphone. Pour en
   ajouter un, une ligne suffit.
   ------------------------------------------------------------------ */

export const COUNTRIES = [
  { code:'ZA', fr:'Afrique du Sud',      en:'South Africa',        it:'Sudafrica',            es:'Sudáfrica',            nl:'Zuid-Afrika' },
  { code:'DZ', fr:'Algérie',             en:'Algeria',             it:'Algeria',              es:'Argelia',              nl:'Algerije' },
  { code:'DE', fr:'Allemagne',           en:'Germany',             it:'Germania',             es:'Alemania',             nl:'Duitsland' },
  { code:'AR', fr:'Argentine',           en:'Argentina',           it:'Argentina',            es:'Argentina',            nl:'Argentinië' },
  { code:'AU', fr:'Australie',           en:'Australia',           it:'Australia',            es:'Australia',            nl:'Australië' },
  { code:'BE', fr:'Belgique',            en:'Belgium',             it:'Belgio',               es:'Bélgica',              nl:'België' },
  { code:'BR', fr:'Brésil',              en:'Brazil',              it:'Brasile',              es:'Brasil',               nl:'Brazilië' },
  { code:'BF', fr:'Burkina Faso',        en:'Burkina Faso',        it:'Burkina Faso',         es:'Burkina Faso',         nl:'Burkina Faso' },
  { code:'CM', fr:'Cameroun',            en:'Cameroon',            it:'Camerun',              es:'Camerún',              nl:'Kameroen' },
  { code:'CL', fr:'Chili',               en:'Chile',               it:'Cile',                 es:'Chile',                nl:'Chili' },
  { code:'CN', fr:'Chine',               en:'China',               it:'Cina',                 es:'China',                nl:'China' },
  { code:'CY', fr:'Chypre',              en:'Cyprus',              it:'Cipro',                es:'Chipre',               nl:'Cyprus' },
  { code:'CO', fr:'Colombie',            en:'Colombia',            it:'Colombia',             es:'Colombia',             nl:'Colombia' },
  { code:'CR', fr:'Costa Rica',          en:'Costa Rica',          it:'Costa Rica',           es:'Costa Rica',           nl:'Costa Rica' },
  { code:'CI', fr:"Côte d'Ivoire",       en:'Ivory Coast',         it:"Costa d'Avorio",       es:'Costa de Marfil',      nl:'Ivoorkust' },
  { code:'EG', fr:'Égypte',              en:'Egypt',               it:'Egitto',               es:'Egipto',               nl:'Egypte' },
  { code:'EC', fr:'Équateur',            en:'Ecuador',             it:'Ecuador',              es:'Ecuador',              nl:'Ecuador' },
  { code:'ES', fr:'Espagne',             en:'Spain',               it:'Spagna',               es:'España',               nl:'Spanje' },
  { code:'US', fr:'États-Unis',          en:'United States',       it:'Stati Uniti',          es:'Estados Unidos',       nl:'Verenigde Staten' },
  { code:'ET', fr:'Éthiopie',            en:'Ethiopia',            it:'Etiopia',              es:'Etiopía',              nl:'Ethiopië' },
  { code:'FR', fr:'France',              en:'France',              it:'Francia',              es:'Francia',              nl:'Frankrijk' },
  { code:'GH', fr:'Ghana',               en:'Ghana',               it:'Ghana',                es:'Ghana',                nl:'Ghana' },
  { code:'GR', fr:'Grèce',               en:'Greece',              it:'Grecia',               es:'Grecia',               nl:'Griekenland' },
  { code:'GT', fr:'Guatemala',           en:'Guatemala',           it:'Guatemala',            es:'Guatemala',            nl:'Guatemala' },
  { code:'GN', fr:'Guinée',              en:'Guinea',              it:'Guinea',               es:'Guinea',               nl:'Guinee' },
  { code:'HT', fr:'Haïti',               en:'Haiti',               it:'Haiti',                es:'Haití',                nl:'Haïti' },
  { code:'HN', fr:'Honduras',            en:'Honduras',            it:'Honduras',             es:'Honduras',             nl:'Honduras' },
  { code:'IN', fr:'Inde',                en:'India',               it:'India',                es:'India',                nl:'India' },
  { code:'ID', fr:'Indonésie',           en:'Indonesia',           it:'Indonesia',            es:'Indonesia',            nl:'Indonesië' },
  { code:'IL', fr:'Israël',              en:'Israel',              it:'Israele',              es:'Israel',               nl:'Israël' },
  { code:'IT', fr:'Italie',              en:'Italy',               it:'Italia',               es:'Italia',               nl:'Italië' },
  { code:'JM', fr:'Jamaïque',            en:'Jamaica',             it:'Giamaica',             es:'Jamaica',              nl:'Jamaica' },
  { code:'KE', fr:'Kenya',               en:'Kenya',               it:'Kenya',                es:'Kenia',                nl:'Kenia' },
  { code:'MA', fr:'Maroc',               en:'Morocco',             it:'Marocco',              es:'Marruecos',            nl:'Marokko' },
  { code:'ML', fr:'Mali',                en:'Mali',                it:'Mali',                 es:'Malí',                 nl:'Mali' },
  { code:'MX', fr:'Mexique',             en:'Mexico',              it:'Messico',              es:'México',               nl:'Mexico' },
  { code:'NI', fr:'Nicaragua',           en:'Nicaragua',           it:'Nicaragua',            es:'Nicaragua',            nl:'Nicaragua' },
  { code:'NG', fr:'Nigéria',             en:'Nigeria',             it:'Nigeria',              es:'Nigeria',              nl:'Nigeria' },
  { code:'NZ', fr:'Nouvelle-Zélande',    en:'New Zealand',         it:'Nuova Zelanda',        es:'Nueva Zelanda',        nl:'Nieuw-Zeeland' },
  { code:'PK', fr:'Pakistan',            en:'Pakistan',            it:'Pakistan',             es:'Pakistán',             nl:'Pakistan' },
  { code:'PA', fr:'Panama',              en:'Panama',              it:'Panama',               es:'Panamá',               nl:'Panama' },
  { code:'NL', fr:'Pays-Bas',            en:'Netherlands',         it:'Paesi Bassi',          es:'Países Bajos',         nl:'Nederland' },
  { code:'PE', fr:'Pérou',               en:'Peru',                it:'Perù',                 es:'Perú',                 nl:'Peru' },
  { code:'PH', fr:'Philippines',         en:'Philippines',         it:'Filippine',            es:'Filipinas',            nl:'Filipijnen' },
  { code:'PL', fr:'Pologne',             en:'Poland',              it:'Polonia',              es:'Polonia',              nl:'Polen' },
  { code:'PT', fr:'Portugal',            en:'Portugal',            it:'Portogallo',           es:'Portugal',             nl:'Portugal' },
  { code:'DO', fr:'République dominicaine', en:'Dominican Republic', it:'Repubblica Dominicana', es:'República Dominicana', nl:'Dominicaanse Republiek' },
  { code:'SN', fr:'Sénégal',             en:'Senegal',             it:'Senegal',              es:'Senegal',              nl:'Senegal' },
  { code:'LK', fr:'Sri Lanka',           en:'Sri Lanka',           it:'Sri Lanka',            es:'Sri Lanka',            nl:'Sri Lanka' },
  { code:'TZ', fr:'Tanzanie',            en:'Tanzania',            it:'Tanzania',             es:'Tanzania',             nl:'Tanzania' },
  { code:'TH', fr:'Thaïlande',           en:'Thailand',            it:'Thailandia',           es:'Tailandia',            nl:'Thailand' },
  { code:'TN', fr:'Tunisie',             en:'Tunisia',             it:'Tunisia',              es:'Túnez',                nl:'Tunesië' },
  { code:'TR', fr:'Turquie',             en:'Turkey',              it:'Turchia',              es:'Turquía',              nl:'Turkije' },
  { code:'UY', fr:'Uruguay',             en:'Uruguay',             it:'Uruguay',              es:'Uruguay',              nl:'Uruguay' },
  { code:'VN', fr:'Viêt Nam',            en:'Vietnam',             it:'Vietnam',              es:'Vietnam',              nl:'Vietnam' },
  { code:'ZW', fr:'Zimbabwe',            en:'Zimbabwe',            it:'Zimbabwe',             es:'Zimbabue',             nl:'Zimbabwe' }
];

const BY_CODE = new Map(COUNTRIES.map(c => [c.code, c]));

/* Liste triée pour le sélecteur, dans l'ordre alphabétique français. */
export const COUNTRIES_FR = [...COUNTRIES].sort((a, b) => a.fr.localeCompare(b.fr, 'fr'));

/* Un code inconnu (import, saisie historique) ressort tel quel plutôt
   que de disparaître : mieux vaut « XX » affiché que rien. */
export function countryName(code, lang = 'fr') {
  if (!code) return '';
  const c = BY_CODE.get(String(code).toUpperCase().trim());
  return c ? (c[lang] || c.fr) : code;
}

/* Plusieurs origines : « Pérou, Maroc ». */
export const countryNames = (codes, lang = 'fr') =>
  (codes || []).filter(Boolean).map(c => countryName(c, lang)).join(', ');
