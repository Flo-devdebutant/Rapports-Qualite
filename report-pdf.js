/* ------------------------------------------------------------------
   Mise en page du rapport PDF, calquée sur le modèle reçu de
   Fruttital pour qu'un client déjà habitué à FreshControl retrouve
   exactement la même lecture : Général → Résumé → Emballage →
   Caractéristiques → Remarques → Photos.

   Le PDF est traduisible : c'est la pièce qui sort de l'entreprise et
   part chez un client italien, espagnol ou néerlandais. L'interface,
   elle, reste en français.
   ------------------------------------------------------------------ */

import { PDF, PAGE, MARGIN, COLORS, textWidth } from './pdf.js';
import { flatFields, fieldStatus, VERDICT_STATUS, QUALITY_STATUS, SHELF_STATUS } from './verdict.js';
import { logoJpeg } from './logo.js';
import { storage, currentUser } from './supa.js';
import { local } from './store.js';
import { countryName, countryNames } from './countries.js';
import { lotStats, weightLotStats, weightStats, calibreMin,
         chartModel, labelledPoints, labelAnchor, fmtP, fmtG,
         refSpec, palletSeverity, pressureVerdict, sevMark, SEV_ORDER, SEV_STEPS, RANGE_TOL } from './pressure.js';
import { reportType, badPallets } from './report-types.js';
import { safeName } from './ui.js';

/* ------------------------- traductions ------------------------- */
export const LANGS = { fr: 'Français', en: 'English', it: 'Italiano', es: 'Español', nl: 'Nederlands' };

const T = {
  fr: { shared:'Rapport partagé par', general:'Général', summary:'Résumé', packaging:'Emballage',
        characteristics:'Caractéristiques', remarks:'Remarques', photos:'Photos', date:'Date', dept:'Département',
        group:'Groupe de Prod.', origin:'Origine', loadId:'IdDeChargement', order:'Commande', supplier:'Fournisseur',
        customer:'Client', by:'Par', product:'Produit', quality:'Qualité', shelf:'Conservabilité', verdict:'Évaluation',
        pallets:'Nombre de palettes', badPallet:'Palette Problématique', lot:'Lot', pkgType:"Type d'Emballage",
        pkgCond:"Condition d'Emballage", gross:'Poids Brut (Kg)', tare:'Tare (Kg)', net:'Poids Net (Kg)',
        variety:'Variété', calibre:'Calibre', category:'Catégorie', reception:'Réception', shipment:'Expédition',
        reportRec:'Rapport de réception', reportShip:'Rapport d\'expédition client', conform:'Conforme',
        nonConform:'Non Conforme', wk:'sem', bl:'N° de BL', origins:'Origines', sizes:'Détail du lot', boxes:'Nombre de colis', page:(i,n)=>`Page ${i} sur ${n}` , pressures:'Pressions', pressAvg:'Moyenne du lot', palletWord:'palette', palletsWord:'palettes', readings:'relevés', pressCurve:'Moyenne par palette', pressRef:'Référence', pallet:'Palette', average:'Moyenne', carrier:'Transporteur', voyage:'N° de Voyage' , reportProd:'Rapport contrôle production', packKind:'Conditionnement' , weightsTitle:'Poids par fruit', weightAvg:'Moyenne', weighings:'pesées', minRequired:'Min. requis', underOne:'fruit sous-calibré', underMany:'fruits sous-calibrés', underNone:'Aucun fruit sous le poids minimum de son calibre.' , pressState:'État', pressOk:'Conforme', pressTol:'Toléré', pressMinor:'Écart mineur', pressMajor:'Écart majeur', pressCrit:'Écart critique', pressRange:'Plage acceptée', pressZone:'Zone acceptée', pressScaleT:(a,b,c)=>`Écart toléré ${a} point ; jusqu'à ${b} mineur, jusqu'à ${c} majeur, au-delà critique. Barème appliqué à la moyenne de chaque palette.`, pressScaleR:(t)=>`Dans la plage : conforme. ${t} point de débordement toléré ; au-delà, écart critique et palette non conforme. Barème appliqué à la moyenne de chaque palette.`, pressOff:(n)=>`${n} ${n>1?'palettes hors référence':'palette hors référence'}`, refFrom:'selon', ripeness:'Maturité du lot :', photosMissing:(n)=>`${n} photo${n>1?'s':''} du rapport n'${n>1?'ont':'a'} pas pu être jointe${n>1?'s':''} à ce document.` },
  en: { shared:'Report shared by', general:'General', summary:'Summary', packaging:'Packaging',
        characteristics:'Characteristics', remarks:'Remarks', photos:'Photos', date:'Date', dept:'Department',
        group:'Product group', origin:'Origin', loadId:'Load ID', order:'Order', supplier:'Supplier',
        customer:'Customer', by:'By', product:'Product', quality:'Quality', shelf:'Shelf life', verdict:'Assessment',
        pallets:'Number of pallets', badPallet:'Problem pallet', lot:'Batch', pkgType:'Packaging type',
        pkgCond:'Packaging condition', gross:'Gross weight (Kg)', tare:'Tare (Kg)', net:'Net weight (Kg)',
        variety:'Variety', calibre:'Size', category:'Class', reception:'Arrival', shipment:'Outbound',
        reportRec:'Arrival report', reportShip:'Customer shipment report', conform:'Compliant',
        nonConform:'Non-compliant', wk:'wk', bl:'Delivery note', origins:'Origins', sizes:'Lot breakdown', boxes:'Number of boxes', page:(i,n)=>`Page ${i} of ${n}` , pressures:'Firmness', pressAvg:'Lot average', palletWord:'pallet', palletsWord:'pallets', readings:'readings', pressCurve:'Average per pallet', pressRef:'Reference', pallet:'Pallet', average:'Average', carrier:'Carrier', voyage:'Voyage No.' , reportProd:'Production control report', packKind:'Pack format' , weightsTitle:'Fruit weights', weightAvg:'Average', weighings:'weighings', minRequired:'Min. required', underOne:'undersized fruit', underMany:'undersized fruit', underNone:'No fruit below the minimum weight for its size.' , pressState:'Status', pressOk:'Compliant', pressTol:'Within tolerance', pressMinor:'Minor deviation', pressMajor:'Major deviation', pressCrit:'Critical deviation', pressRange:'Accepted range', pressZone:'Accepted zone', pressScaleT:(a,b,c)=>`${a} point of deviation accepted; up to ${b} minor, up to ${c} major, beyond that critical. Applied to each pallet average.`, pressScaleR:(t)=>`Within the range: compliant. ${t} point outside is tolerated; beyond that the deviation is critical and the pallet non-compliant. Applied to each pallet average.`, pressOff:(n)=>`${n} pallet${n>1?'s':''} outside the reference`, refFrom:'per', ripeness:'Lot ripeness:', photosMissing:(n)=>`${n} photo${n>1?'s':''} from this report could not be attached to this document.` },
  it: { shared:'Rapporto condiviso da', general:'Generale', summary:'Riepilogo', packaging:'Imballaggio',
        characteristics:'Caratteristiche', remarks:'Osservazioni', photos:'Foto', date:'Data', dept:'Reparto',
        group:'Gruppo di Prod.', origin:'Origine', loadId:'ID Carico', order:'Ordine', supplier:'Fornitore',
        customer:'Cliente', by:'Da', product:'Prodotto', quality:'Qualità', shelf:'Conservabilità', verdict:'Valutazione',
        pallets:'Numero di pallet', badPallet:'Pallet Problematico', lot:'Lotto', pkgType:'Tipo di Imballaggio',
        pkgCond:'Condizione Imballaggio', gross:'Peso Lordo (Kg)', tare:'Tara (Kg)', net:'Peso Netto (Kg)',
        variety:'Varietà', calibre:'Calibro', category:'Categoria', reception:'Arrivo', shipment:'Spedizione',
        reportRec:'Rapporto di arrivo', reportShip:'Rapporto di spedizione cliente', conform:'Conforme',
        nonConform:'Non Conforme', wk:'sett', bl:'N. DDT', origins:'Origini', sizes:'Dettaglio lotto', boxes:'Numero di colli', page:(i,n)=>`Pagina ${i} di ${n}` , pressures:'Pressioni', pressAvg:'Media del lotto', palletWord:'pallet', palletsWord:'pallet', readings:'rilievi', pressCurve:'Media per pallet', pressRef:'Riferimento', pallet:'Pallet', average:'Media', carrier:'Trasportatore', voyage:'N. Viaggio' , reportProd:'Rapporto controllo produzione', packKind:'Confezionamento' , weightsTitle:'Peso per frutto', weightAvg:'Media', weighings:'pesate', minRequired:'Min. richiesto', underOne:'frutto sottocalibro', underMany:'frutti sottocalibro', underNone:'Nessun frutto sotto il peso minimo del suo calibro.' , pressState:'Stato', pressOk:'Conforme', pressTol:'Tollerato', pressMinor:'Scostamento lieve', pressMajor:'Scostamento grave', pressCrit:'Scostamento critico', pressRange:'Intervallo accettato', pressZone:'Zona accettata', pressScaleT:(a,b,c)=>`Scostamento tollerato ${a} punto; fino a ${b} lieve, fino a ${c} grave, oltre critico. Applicato alla media di ogni pallet.`, pressScaleR:(t)=>`Entro l'intervallo: conforme. ${t} punto di sconfinamento tollerato; oltre, scostamento critico e pallet non conforme. Applicato alla media di ogni pallet.`, pressOff:(n)=>`${n} pallet fuori riferimento`, refFrom:'secondo', ripeness:'Maturazione del lotto:', photosMissing:(n)=>`${n} foto del rapporto non ${n>1?'sono state allegate':'è stata allegata'} a questo documento.` },
  es: { shared:'Informe compartido por', general:'General', summary:'Resumen', packaging:'Embalaje',
        characteristics:'Características', remarks:'Observaciones', photos:'Fotos', date:'Fecha', dept:'Departamento',
        group:'Grupo de Prod.', origin:'Origen', loadId:'ID de Carga', order:'Pedido', supplier:'Proveedor',
        customer:'Cliente', by:'Por', product:'Producto', quality:'Calidad', shelf:'Conservación', verdict:'Evaluación',
        pallets:'Número de palés', badPallet:'Palé Problemático', lot:'Lote', pkgType:'Tipo de Embalaje',
        pkgCond:'Condición de Embalaje', gross:'Peso Bruto (Kg)', tare:'Tara (Kg)', net:'Peso Neto (Kg)',
        variety:'Variedad', calibre:'Calibre', category:'Categoría', reception:'Recepción', shipment:'Expedición',
        reportRec:'Informe de recepción', reportShip:'Informe de expedición cliente', conform:'Conforme',
        nonConform:'No Conforme', wk:'sem', bl:'Albarán', origins:'Orígenes', sizes:'Detalle del lote', boxes:'Número de bultos', page:(i,n)=>`Página ${i} de ${n}` , pressures:'Presiones', pressAvg:'Media del lote', palletWord:'palé', palletsWord:'palés', readings:'lecturas', pressCurve:'Media por palé', pressRef:'Referencia', pallet:'Palé', average:'Media', carrier:'Transportista', voyage:'N.º de Viaje' , reportProd:'Informe de control de producción', packKind:'Acondicionamiento' , weightsTitle:'Peso por fruto', weightAvg:'Media', weighings:'pesajes', minRequired:'Mín. exigido', underOne:'fruto subcalibrado', underMany:'frutos subcalibrados', underNone:'Ningún fruto por debajo del peso mínimo de su calibre.' , pressState:'Estado', pressOk:'Conforme', pressTol:'Tolerado', pressMinor:'Desviación leve', pressMajor:'Desviación grave', pressCrit:'Desviación crítica', pressRange:'Rango aceptado', pressZone:'Zona aceptada', pressScaleT:(a,b,c)=>`Desviación tolerada ${a} punto; hasta ${b} leve, hasta ${c} grave, más allá crítica. Aplicado a la media de cada palé.`, pressScaleR:(t)=>`Dentro del rango: conforme. ${t} punto de desbordamiento tolerado; más allá, desviación crítica y palé no conforme. Aplicado a la media de cada palé.`, pressOff:(n)=>`${n} palé${n>1?'s':''} fuera de referencia`, refFrom:'según', ripeness:'Madurez del lote:', photosMissing:(n)=>`${n} foto${n>1?'s':''} del informe no ${n>1?'pudieron':'pudo'} adjuntarse a este documento.` },
  nl: { shared:'Rapport gedeeld door', general:'Algemeen', summary:'Samenvatting', packaging:'Verpakking',
        characteristics:'Kenmerken', remarks:'Opmerkingen', photos:"Foto's", date:'Datum', dept:'Afdeling',
        group:'Productgroep', origin:'Herkomst', loadId:'Laad-ID', order:'Order', supplier:'Leverancier',
        customer:'Klant', by:'Door', product:'Product', quality:'Kwaliteit', shelf:'Houdbaarheid', verdict:'Beoordeling',
        pallets:'Aantal pallets', badPallet:'Probleempallet', lot:'Partij', pkgType:'Verpakkingstype',
        pkgCond:'Verpakkingsconditie', gross:'Brutogewicht (Kg)', tare:'Tarra (Kg)', net:'Nettogewicht (Kg)',
        variety:'Ras', calibre:'Maat', category:'Klasse', reception:'Aankomst', shipment:'Uitgaand',
        reportRec:'Aankomstrapport', reportShip:'Klantrapport uitgaand', conform:'Conform',
        nonConform:'Niet conform', wk:'wk', bl:'Vrachtbrief', origins:'Herkomsten', sizes:'Partijdetail', boxes:'Aantal colli', page:(i,n)=>`Pagina ${i} van ${n}` , pressures:'Drukmetingen', pressAvg:'Gemiddelde partij', palletWord:'pallet', palletsWord:'pallets', readings:'metingen', pressCurve:'Gemiddelde per pallet', pressRef:'Referentie', pallet:'Pallet', average:'Gemiddelde', carrier:'Vervoerder', voyage:'Reisnummer' , reportProd:'Productiecontrolerapport', packKind:'Verpakkingsvorm' , weightsTitle:'Gewicht per vrucht', weightAvg:'Gemiddelde', weighings:'wegingen', minRequired:'Min. vereist', underOne:'vrucht onder maat', underMany:'vruchten onder maat', underNone:'Geen vrucht onder het minimumgewicht van zijn maat.' , pressState:'Status', pressOk:'Conform', pressTol:'Getolereerd', pressMinor:'Geringe afwijking', pressMajor:'Grote afwijking', pressCrit:'Kritieke afwijking', pressRange:'Geaccepteerd bereik', pressZone:'Geaccepteerde zone', pressScaleT:(a,b,c)=>`${a} punt afwijking toegestaan; tot ${b} gering, tot ${c} groot, daarboven kritiek. Toegepast op het gemiddelde van elke pallet.`, pressScaleR:(t)=>`Binnen het bereik: conform. ${t} punt overschrijding wordt getolereerd; daarboven is de afwijking kritiek en de pallet niet conform. Toegepast op het gemiddelde van elke pallet.`, pressOff:(n)=>`${n} pallet${n>1?'s':''} buiten referentie`, refFrom:'volgens', ripeness:'Rijpheid partij:', photosMissing:(n)=>`${n} foto${n>1?`'s`:''} uit dit rapport ${n>1?'konden':'kon'} niet worden bijgevoegd.` }
};

/* ------------------------------------------------------------------
   Traduction du contenu, pas seulement des titres.
   Les libellés de critères vivent en base, en français, parce qu'ils
   sont modifiables par l'utilisateur. On les traduit donc au moment
   d'imprimer, via ce dictionnaire qui couvre toutes les grilles
   livrées. Un critère ajouté à la main par l'entreprise et absent
   d'ici reste en français : c'est prévisible, et il suffit d'ajouter
   sa ligne ci-dessous pour le traduire à son tour.
   ------------------------------------------------------------------ */
const TERMS = {
  /* --- groupes de produits --- */
  'Avocat':             { en:'Avocado', it:'Avocado', es:'Aguacate', nl:'Avocado' },
  'Mangue':             { en:'Mango', it:'Mango', es:'Mango', nl:'Mango' },
  'Fruits & légumes':   { en:'Fruit & vegetables', it:'Frutta e verdura', es:'Frutas y verduras', nl:'Groente & fruit' },

  /* --- stades de mûrissement (déduits de la moyenne des pressions) --- */
  'Dur':              { en:'Hard', it:'Duro', es:'Duro', nl:'Hard' },
  'En mûrissement':   { en:'Ripening', it:'In maturazione', es:'En maduración', nl:'Rijpend' },
  'Bon pour rayon':   { en:'Shelf ready', it:'Pronto per lo scaffale', es:'Listo para lineal', nl:'Schapklaar' },
  'Prêt à manger':    { en:'Ready to eat', it:'Pronto da mangiare', es:'Listo para comer', nl:'Klaar om te eten' },
  'À consommer':      { en:'Eat now', it:'Da consumare', es:'Consumir ya', nl:'Nu eten' },
  'Surmûr':           { en:'Overripe', it:'Troppo maturo', es:'Sobremaduro', nl:'Overrijp' },

  /* --- sections --- */
  'Palettisation':          { en:'Palletisation', it:'Pallettizzazione', es:'Paletización', nl:'Palletisering' },
  'Emballage':              { en:'Packaging', it:'Imballaggio', es:'Embalaje', nl:'Verpakking' },
  'Température marchandise':{ en:'Product temperature', it:'Temperatura merce', es:'Temperatura mercancía', nl:'Producttemperatuur' },
  'Traçabilité':            { en:'Traceability', it:'Tracciabilità', es:'Trazabilidad', nl:'Traceerbaarheid' },
  'Aspect':                 { en:'Appearance', it:'Aspetto', es:'Aspecto', nl:'Uiterlijk' },
  'Maturité':               { en:'Ripeness', it:'Maturazione', es:'Madurez', nl:'Rijpheid' },
  'Qualitatifs':            { en:'Quality measures', it:'Qualitativi', es:'Cualitativos', nl:'Kwaliteitsmetingen' },
  'Troubles / Maladies':    { en:'Disorders / Diseases', it:'Disturbi / Malattie', es:'Trastornos / Enfermedades', nl:'Afwijkingen / Ziekten' },
  'Quantité évaluation':    { en:'Assessed quantity', it:'Quantità valutata', es:'Cantidad evaluada', nl:'Beoordeelde hoeveelheid' },
  'Transport':              { en:'Transport', it:'Trasporto', es:'Transporte', nl:'Transport' },
  'Défauts':                { en:'Defects', it:'Difetti', es:'Defectos', nl:'Gebreken' },

  /* --- critères --- */
  'Nombre de palettes':   { en:'Number of pallets', it:'Numero di pallet', es:'Número de palés', nl:'Aantal pallets' },
  'Nombre de colis':      { en:'Number of boxes', it:'Numero di colli', es:'Número de bultos', nl:'Aantal colli' },
  /* anciens libellés : un rapport déjà enregistré garde sa grille,
     il doit rester traduisible après le renommage */
  'N° de palettes':       { en:'Number of pallets', it:'Numero di pallet', es:'Número de palés', nl:'Aantal pallets' },
  'N° de colis':          { en:'Number of boxes', it:'Numero di colli', es:'Número de bultos', nl:'Aantal colli' },
  'État palettisation':   { en:'Palletisation condition', it:'Condizione pallettizzazione', es:'Estado paletización', nl:'Palletconditie' },
  "Type d'emballage":     { en:'Packaging type', it:'Tipo di imballaggio', es:'Tipo de embalaje', nl:'Verpakkingstype' },
  "Condition d'emballage":{ en:'Packaging condition', it:'Condizione imballaggio', es:'Condición de embalaje', nl:'Verpakkingsconditie' },
  'Poids brut':           { en:'Gross weight', it:'Peso lordo', es:'Peso bruto', nl:'Brutogewicht' },
  'Tare':                 { en:'Tare', it:'Tara', es:'Tara', nl:'Tarra' },
  'Poids net':            { en:'Net weight', it:'Peso netto', es:'Peso neto', nl:'Nettogewicht' },
  'Température pulpe':    { en:'Pulp temperature', it:'Temperatura polpa', es:'Temperatura pulpa', nl:'Pulptemperatuur' },
  'Conformité étiquetage':{ en:'Label compliance', it:'Conformità etichettatura', es:'Conformidad etiquetado', nl:'Etiketconformiteit' },
  'Conformité catégorie': { en:'Class compliance', it:'Conformità categoria', es:'Conformidad categoría', nl:'Klasseconformiteit' },
  'Apparence générale':   { en:'General appearance', it:'Aspetto generale', es:'Aspecto general', nl:'Algemeen uiterlijk' },
  'Apparence pulpe':      { en:'Pulp appearance', it:'Aspetto polpa', es:'Aspecto pulpa', nl:'Uiterlijk vruchtvlees' },
  'Matière sèche':        { en:'Dry matter', it:'Sostanza secca', es:'Materia seca', nl:'Droge stof' },
  'Stade de mûrissement': { en:'Ripeness stage', it:'Stadio di maturazione', es:'Estado de madurez', nl:'Rijpheidsstadium' },
  'Dureté min':           { en:'Min firmness', it:'Durezza min', es:'Dureza mín', nl:'Hardheid min' },
  'Dureté max':           { en:'Max firmness', it:'Durezza max', es:'Dureza máx', nl:'Hardheid max' },
  'Dureté moyenne':       { en:'Average firmness', it:'Durezza media', es:'Dureza media', nl:'Gemiddelde hardheid' },
  'Fermeté moyenne':      { en:'Average firmness', it:'Durezza media', es:'Dureza media', nl:'Gemiddelde hardheid' },
  'Mûr/Mou':              { en:'Ripe/Soft', it:'Maturo/Molle', es:'Maduro/Blando', nl:'Rijp/Zacht' },
  'Taches / Maculatures': { en:'Spots / Blemishes', it:'Macchie / Maculature', es:'Manchas / Máculas', nl:'Vlekken / Verkleuringen' },
  'Dommages lenticelles': { en:'Lenticel damage', it:'Danni lenticelle', es:'Daños lenticelas', nl:'Lenticelschade' },
  'Blessures / Chocs':    { en:'Bruising / Injuries', it:'Lesioni / Urti', es:'Lesiones / Golpes', nl:'Kneuzingen / Beschadigingen' },
  'Dégâts de froid':      { en:'Chilling injury', it:'Danni da freddo', es:'Daños por frío', nl:'Koudeschade' },
  'Brunissement vasculaire':{ en:'Vascular browning', it:'Imbrunimento vascolare', es:'Pardeamiento vascular', nl:'Vaatbruinverkleuring' },
  'Coups de soleil':      { en:'Sunburn', it:'Scottature solari', es:'Quemaduras de sol', nl:'Zonnebrand' },
  'Pourriture / Anthracnose':{ en:'Decay / Anthracnose', it:'Marciume / Antracnosi', es:'Podredumbre / Antracnosis', nl:'Rot / Antracnose' },
  'Caisses échantillon':  { en:'Sample boxes', it:'Colli campione', es:'Cajas muestra', nl:'Steekproefcolli' },
  'Caisses problématiques':{ en:'Problem boxes', it:'Colli problematici', es:'Cajas problemáticas', nl:'Probleemcolli' },
  'Mode de fret':         { en:'Freight mode', it:'Modalità di trasporto', es:'Modo de transporte', nl:'Vrachtwijze' },
  'Couleur peau':         { en:'Skin colour', it:'Colore buccia', es:'Color piel', nl:'Schilkleur' },
  'Couleur pulpe':        { en:'Pulp colour', it:'Colore polpa', es:'Color pulpa', nl:'Vruchtvleeskleur' },
  'Couleur':              { en:'Colour', it:'Colore', es:'Color', nl:'Kleur' },
  'Brûlure de sève (sap burn)':{ en:'Sap burn', it:'Ustione da lattice', es:'Quemadura de savia', nl:'Sapbrand' },
  'Anthracnose / Taches noires':{ en:'Anthracnose / Black spot', it:'Antracnosi / Macchie nere', es:'Antracnosis / Manchas negras', nl:'Antracnose / Zwarte vlekken' },
  'Pourriture pédonculaire':{ en:'Stem-end rot', it:'Marciume peduncolare', es:'Podredumbre peduncular', nl:'Steelrot' },
  'Effondrement interne / Jelly seed':{ en:'Internal breakdown / Jelly seed', it:'Collasso interno / Jelly seed', es:'Colapso interno / Jelly seed', nl:'Inwendige afbraak / Jelly seed' },
  'Taches de lenticelles':{ en:'Lenticel spotting', it:'Macchie lenticellari', es:'Manchas de lenticelas', nl:'Lenticelvlekken' },
  'Défauts mineurs':      { en:'Minor defects', it:'Difetti minori', es:'Defectos menores', nl:'Kleine gebreken' },
  'Défauts majeurs':      { en:'Major defects', it:'Difetti maggiori', es:'Defectos mayores', nl:'Grote gebreken' },
  'Pourriture':           { en:'Decay', it:'Marciume', es:'Podredumbre', nl:'Rot' },

  /* --- valeurs des listes de choix --- */
  'Carton':           { en:'Carton', it:'Cartone', es:'Cartón', nl:'Karton' },
  /* --- conditionnements (contrôle production) --- */
  'Premium':          { en:'Premium', it:'Premium', es:'Premium', nl:'Premium' },
  'Barquette':        { en:'Tray', it:'Vaschetta', es:'Bandeja', nl:'Schaal' },
  'Filets':           { en:'Nets', it:'Retine', es:'Mallas', nl:'Netjes' },
  'Plateau bois':     { en:'Wooden tray', it:'Plateau in legno', es:'Bandeja de madera', nl:'Houten tray' },
  'Caisse plastique': { en:'Plastic crate', it:'Cassa di plastica', es:'Caja de plástico', nl:'Plastic krat' },
  'Vrac':             { en:'Bulk', it:'Sfuso', es:'Granel', nl:'Bulk' },
  'Bonne':            { en:'Good', it:'Buona', es:'Buena', nl:'Goed' },
  'Acceptable':       { en:'Acceptable', it:'Accettabile', es:'Aceptable', nl:'Acceptabel' },
  'Mauvaise':         { en:'Poor', it:'Scarsa', es:'Mala', nl:'Slecht' },
  'Améliorable':      { en:'Needs improvement', it:'Migliorabile', es:'Mejorable', nl:'Voor verbetering vatbaar' },
  'Dur (> 10 kg)':                { en:'Hard (> 10 kg)', it:'Duro (> 10 kg)', es:'Duro (> 10 kg)', nl:'Hard (> 10 kg)' },
  'En mûrissement (2,2–10 kg)':   { en:'Ripening (2.2–10 kg)', it:'In maturazione (2,2–10 kg)', es:'En maduración (2,2–10 kg)', nl:'Rijpend (2,2–10 kg)' },
  'Bon pour rayon (1,1–2,1 kg)':  { en:'Retail ready (1.1–2.1 kg)', it:'Pronto per scaffale (1,1–2,1 kg)', es:'Listo para lineal (1,1–2,1 kg)', nl:'Schapklaar (1,1–2,1 kg)' },
  'Prêt à manger (0,7–1,0 kg)':   { en:'Ready to eat (0.7–1.0 kg)', it:'Pronto da mangiare (0,7–1,0 kg)', es:'Listo para comer (0,7–1,0 kg)', nl:'Eetrijp (0,7–1,0 kg)' },
  'À consommer (0,4–0,6 kg)':     { en:'Eat now (0.4–0.6 kg)', it:'Da consumare (0,4–0,6 kg)', es:'Consumir ya (0,4–0,6 kg)', nl:'Nu eten (0,4–0,6 kg)' },
  'Surmûr (< 0,4 kg)':            { en:'Overripe (< 0.4 kg)', it:'Troppo maturo (< 0,4 kg)', es:'Sobremaduro (< 0,4 kg)', nl:'Overrijp (< 0,4 kg)' },
  'Verte':            { en:'Green', it:'Verde', es:'Verde', nl:'Groen' },
  'Tournante':        { en:'Turning', it:'In viraggio', es:'Envero', nl:'Omkleurend' },
  'Colorée':          { en:'Coloured', it:'Colorata', es:'Coloreada', nl:'Gekleurd' },
  'Hétérogène':       { en:'Uneven', it:'Disomogenea', es:'Heterogénea', nl:'Ongelijkmatig' },
  'Jaune clair':      { en:'Light yellow', it:'Giallo chiaro', es:'Amarillo claro', nl:'Lichtgeel' },
  'Jaune orangé':     { en:'Yellow-orange', it:'Giallo arancio', es:'Amarillo anaranjado', nl:'Geeloranje' },
  'Orange':           { en:'Orange', it:'Arancione', es:'Naranja', nl:'Oranje' },
  'Blanchâtre':       { en:'Whitish', it:'Biancastra', es:'Blanquecina', nl:'Witachtig' },
  'Aérien':           { en:'Air freight', it:'Aereo', es:'Aéreo', nl:'Luchtvracht' },
  'Maritime':         { en:'Sea freight', it:'Marittimo', es:'Marítimo', nl:'Zeevracht' },
  'Conforme':         { en:'Compliant', it:'Conforme', es:'Conforme', nl:'Conform' },
  'Non conforme':     { en:'Non-compliant', it:'Non conforme', es:'No conforme', nl:'Niet conform' }
};

/* Traduit une chaîne venue de la base ; laisse passer ce qu'elle ne
   connaît pas (noms de variétés, calibres, texte libre). */
const tr = (lang, s) => (lang === 'fr' || !s) ? s : (TERMS[s]?.[lang] || s);

/* Ordre de priorité pour un libellé venu des Réglages :
     1. la traduction saisie sur le critère ou la section ;
     2. le dictionnaire ci-dessus, qui couvre les grilles livrées ;
     3. le français, faute de mieux.
   Un critère ajouté à la main sans traduction reste donc en français
   dans le PDF, jamais vide et jamais approximatif. */
const trLabel = (lang, label, i18n) => {
  if (lang === 'fr' || !label) return label;
  return (i18n && i18n[lang]) || TERMS[label]?.[lang] || label;
};

/* Utilisé par l'éditeur de critères pour indiquer qu'un libellé est
   déjà traduit d'office. */
export const builtinTranslation = (label) => TERMS[label] || null;

/* Valeurs de verdict traduites (le stockage reste en français). */
const V = {
  fr: {}, // identité
  en: { 'Bonne':'Good','Moyenne':'Moderate','Mauvaise':'Poor','Élevée':'High','Minimale':'Minimal',
        'Conforme':'Compliant','Acceptable':'Acceptable','Non Conforme':'Non-compliant' },
  it: { 'Bonne':'Buona','Moyenne':'Media','Mauvaise':'Scarsa','Élevée':'Alta','Minimale':'Minima',
        'Conforme':'Conforme','Acceptable':'Accettabile','Non Conforme':'Non Conforme' },
  es: { 'Bonne':'Buena','Moyenne':'Media','Mauvaise':'Mala','Élevée':'Alta','Minimale':'Mínima',
        'Conforme':'Conforme','Acceptable':'Aceptable','Non Conforme':'No Conforme' },
  nl: { 'Bonne':'Goed','Moyenne':'Matig','Mauvaise':'Slecht','Élevée':'Hoog','Minimale':'Minimaal',
        'Conforme':'Conform','Acceptable':'Acceptabel','Non Conforme':'Niet conform' }
};
const tv = (lang, val) => (V[lang] && V[lang][val]) || val;

/* Origines du rapport, quelle que soit la version qui l'a écrit :
   liste dédiée, sinon déduite des lignes de lot, sinon le champ
   historique. */
function originList(h) {
  if (Array.isArray(h?.origins) && h.origins.length) return h.origins;
  if (Array.isArray(h?.calibres)) {
    const set = [...new Set(h.calibres.map(c => (c.o || '').toUpperCase()).filter(Boolean))];
    if (set.length) return set;
  }
  return h?.origin ? String(h.origin).split(/[,;]\s*/).filter(Boolean) : [];
}

export function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
}
const fmtDate = (iso) => {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/* ------------------- récupération des photos ------------------- */
/* Renvoie les images ET le nombre de photos manquantes. Le document
   part chez un client : l'absence d'une photo doit s'y lire. Sans ce
   décompte, un rapport annonçant douze photos à l'écran en livrait
   cinq, sans un mot, et la différence passait pour une négligence de
   l'inspecteur. */
async function photoBytes(report, max = 8) {
  const all = report.photos || [];
  const out = [];
  for (const p of all.slice(0, max)) {
    let blob = null;
    if (p.localId) blob = (await local.get('photos', p.localId))?.blob || null;
    if (!blob && p.uploaded) blob = await storage.download(p.path).catch(() => null);
    if (blob) out.push(new Uint8Array(await blob.arrayBuffer()));
  }
  out.missing = all.length - out.length;
  return out;
}

/* ========================= document ========================= */
export async function buildReportPDF(report, group, { lang = 'fr', company = 'SARL Mehadrin International' } = {}) {
  const t = T[lang] || T.fr;
  const s = report.summary || {};
  const m = report.measures || {};
  const h = report.header || {};
  const doc = new PDF();
  doc.footer = t.page;

  const RT = reportType(report.type);
  const isShip = RT.refKey === 'bl';

  /* -- Bandeau -- */
  const cx = PAGE.w / 2;
  doc.text(t.shared, cx, MARGIN + 8, { size: 8.5, color: COLORS.GREY, align: 'center' });
  doc.text(company, cx, MARGIN + 22, { size: 11, bold: true, align: 'center' });
  const logo = await logoJpeg(560, 206);
  if (logo) doc.image(logo, cx - 82, MARGIN + 30, 164, 60);
  doc.y = MARGIN + 104;

  doc.text(report.type === 'production' ? t.reportProd : (report.type === 'reception' ? t.reportRec : t.reportShip), cx, doc.y, { size: 9.5, bold: true, color: COLORS.ACCENT, align: 'center' });
  doc.y += 16;

  /* -- Général -- */
  doc.sectionTitle(t.general);
  const d = new Date(report.report_date);
  doc.row(t.date, `${fmtDate(report.report_date)} (${t.wk}${isoWeek(d)})`);
  if (h.department) doc.row(t.dept, h.department);
  doc.row(t.group, tr(lang, group?.name) || report.product_group_id || '');
  const origins = originList(h);
  if (origins.length) doc.row(origins.length > 1 ? t.origins : t.origin, countryNames(origins, lang));
  if (h.carrier) doc.row(t.carrier, h.carrier);
  if (RT.voyage && (h.voyage || h.load_id)) doc.row(t.voyage, h.voyage || h.load_id);
  /* Hors réception, il n'y a pas de n° de voyage où loger l'identifiant
     de chargement : il n'apparaissait alors nulle part dans le PDF,
     alors que c'est parfois la seule référence de traçabilité du
     rapport — et que l'Excel, lui, l'exporte. */
  else if (h.load_id) doc.row(t.loadId, h.load_id);
  if (h.order) doc.row(t.order, h.order);   // ancien champ « Commande », conservé pour les rapports antérieurs
  doc.row(RT.partnerKind === 'fournisseur' ? t.supplier : t.customer, report.partner_name || '');
  doc.row(t.by, report.inspector_name || '');
  doc.y += 8;

  /* -- Résumé -- */
  const label = [tr(lang, group?.name), h.variety, countryNames(origins, lang), h.calibre].filter(Boolean).join(' ');
  const cals = Array.isArray(h.calibres) ? h.calibres.filter(c => c.c) : [];
  const detailed = cals.length > 1 || cals.some(c => c.pal || c.col || c.o);
  doc.sectionTitle(t.summary);
  doc.table(
    [ { k:'p', h:t.product, w:150 }, { k:'q', h:t.quality, w:95 }, { k:'s', h:t.shelf, w:100 },
      { k:'v', h:t.verdict, w:95 }, { k:'nc', h:'%NC', w:50 }, { k:'pal', h:t.pallets, w:70 },
      { k:'bad', h:t.badPallet, w:85 }, { k:'lot', h: isShip ? t.bl : t.lot, w:115 } ],
    [ { p: label,
        q:  { v: tv(lang, s.quality), s: QUALITY_STATUS[s.quality] },
        s:  { v: tv(lang, s.shelf),   s: SHELF_STATUS[s.shelf] },
        v:  { v: tv(lang, s.verdict), s: VERDICT_STATUS[s.verdict] },
        nc: s.nc == null ? '' : String(s.nc),
        pal: fmt(m.pal_count), bad: badCell(h), lot: (isShip ? h.bl : h.lot) || '' } ]
  );

  /* -- Calibres -- (seulement si l'envoi en mélange plusieurs, ou si
     le détail palettes/colis a été saisi : sinon le calibre figure
     déjà dans Caractéristiques) */
  if (detailed) {
    doc.sectionTitle(t.sizes);
    const showOrigin = cals.some(c => c.o);
    doc.table(
      showOrigin
        ? [ { k:'o', h:t.origin, w:170 }, { k:'c', h:t.calibre, w:130 },
            { k:'p', h:t.pallets, w:140 }, { k:'b', h:t.boxes, w:140 } ]
        : [ { k:'c', h:t.calibre, w:200 }, { k:'p', h:t.pallets, w:180 }, { k:'b', h:t.boxes, w:180 } ],
      cals.map(c => ({ o: countryName(c.o, lang), c: c.c, p: fmt(c.pal), b: fmt(c.col) }))
    );
  }

  /* -- Emballage -- */
  if (m.pkg_type || m.pkg_cond || (m.pkg_gross !== '' && m.pkg_gross != null)) {
    doc.sectionTitle(t.packaging);
    doc.table(
      [ { k:'p', h:t.product, w:170 }, { k:'ty', h:t.pkgType, w:130 }, { k:'co', h:t.pkgCond, w:140 },
        { k:'g', h:t.gross, w:110 }, { k:'ta', h:t.tare, w:95 }, { k:'n', h:t.net, w:110 } ],
      [ { p: label, ty: tr(lang, m.pkg_type) || '', co: tr(lang, m.pkg_cond) || '',
          g: fmt(m.pkg_gross, DP2), ta: fmt(m.pkg_tare, DP2), n: fmt(m.pkg_net, DP2) } ]
    );
  }

  /* -- Caractéristiques -- */
  doc.sectionTitle(t.characteristics);
  if (h.variety)  doc.row(t.variety, h.variety);
  if (h.calibre)  doc.row(t.calibre, h.calibre);
  if (h.category) doc.row(t.category, h.category);
  if (h.packaging_kind) doc.row(t.packKind, tr(lang, h.packaging_kind));
  doc.row(t.quality, tv(lang, s.quality), { status: QUALITY_STATUS[s.quality], bold: true });
  doc.row(t.shelf,   tv(lang, s.shelf),   { status: SHELF_STATUS[s.shelf], bold: true });
  doc.row(t.verdict, tv(lang, s.verdict), { status: VERDICT_STATUS[s.verdict], bold: true });
  doc.y += 6;

  const fields = flatFields(group || {}, report.type);
  const bySection = new Map();
  for (const fl of fields) {
    if (m[fl.key] === '' || m[fl.key] == null) continue;
    if (!bySection.has(fl.sectionLabel)) bySection.set(fl.sectionLabel, []);
    bySection.get(fl.sectionLabel).push(fl);
  }
  for (const [secLabel, list] of bySection) {
    doc.subhead(trLabel(lang, secLabel, list[0]?.sectionI18n));
    for (const fl of list) {
      const st = fieldStatus(fl, m[fl.key]);
      const val = fl.type === 'bool'
        ? (m[fl.key] === true || m[fl.key] === 'true' ? t.conform : t.nonConform)
        : fl.type === 'choice'
          ? trLabel(lang, m[fl.key], (fl.options || []).find(o => o.v === m[fl.key])?.i18n)
          : `${fmt(m[fl.key], fl)}${fl.unit ? ' ' + fl.unit : ''}`;
      doc.row(trLabel(lang, fl.label, fl.i18n), val, { status: st && st !== 'ok' ? st : (fl.type === 'bool' || fl.type === 'choice' ? st : null), indent: 8 });
    }
    doc.y += 4;
  }

  /* -- Pressions et poids -- */
  const pStats = lotStats(h.pressures);
  if (pStats) drawPressures(doc, h.pressures, pStats, t, lang, refSpec(h.pressures, group), pressureVerdict(h.pressures, group), s.ripeness?.stage);
  const wStats = weightLotStats(h.pressures, group);
  if (wStats) drawWeights(doc, h.pressures, wStats, group, t, lang);

  /* -- Remarques -- */
  if (report.remarks?.trim()) {
    doc.sectionTitle(t.remarks);
    doc.need(20);
    doc.text('"', MARGIN + 4, doc.y + 10, { size: 15, bold: true, color: COLORS.GREY });
    for (const line of report.remarks.split('\n')) {
      const chunks = splitToWidth(line, 8.6, PAGE.w - 2 * MARGIN - 26);
      for (const c of chunks) { doc.need(12); doc.text(c, MARGIN + 22, doc.y + 8, { size: 8.6 }); doc.y += 12; }
    }
    doc.y += 8;
  }

  /* -- Photos -- */
  const imgs = await photoBytes(report);
  if (imgs.length || imgs.missing) {
    doc.sectionTitle(t.photos);
    const cols = 3, gap = 10;
    const w = (PAGE.w - 2 * MARGIN - gap * (cols - 1)) / cols;
    const hgt = w * 0.75;
    for (let i = 0; i < imgs.length; i++) {
      const col = i % cols;
      if (col === 0) doc.need(hgt + gap);
      const x = MARGIN + col * (w + gap);
      doc.rect(x, doc.y, w, hgt, { fill: [0.96, 0.96, 0.97] });
      doc.image(imgs[i], x, doc.y, w, hgt, { fit: true });
      if (col === cols - 1 || i === imgs.length - 1) doc.y += hgt + gap;
    }
    if (imgs.missing > 0) {
      doc.need(16);
      doc.text(t.photosMissing(imgs.missing), MARGIN, doc.y + 8,
        { size: 8, color: COLORS.GREY });
      doc.y += 12;
    }
  }

  return doc.build();
}

/* Les mesures au centième (poids, duretés, températures) gardent leurs
   deux décimales même sur un nombre rond : « 4.00 kg » se lit comme une
   pesée, « 4 kg » comme une estimation. Les comptages restent entiers. */
/* ------------------- graphique de pression (PDF) -------------------
   Même géométrie que la version écran : chartModel() est la source
   unique, seuls les outils de tracé changent. Une seule série, donc
   pas de légende encadrée — une note sous le graphique nomme la courbe,
   et la référence. Les valeurs ne sont posées que sur les points qui
   portent l'information : les extrêmes, les bornes, et tout point hors
   tolérance. */
function drawPressures(doc, pressures, stats, t, lang, spec, pv, ripe) {
  const unit = pressures.unit || 'kg';
  const SEVT = { ok: t.pressOk, mineur: t.pressMinor, majeur: t.pressMajor, critique: t.pressCrit };
  const col = (lvl) => lvl ? COLORS.SEV[lvl] : COLORS.SERIES;

  /* Titre, résumé, graphique et légende tiennent ensemble : un titre
     orphelin en bas de page rendrait le bloc illisible. */
  doc.need(300);
  doc.sectionTitle(t.pressures);

  doc.text(
    `${t.pressAvg} ${fmtP(stats.avg)} ${unit} · min ${fmtP(stats.min)} · max ${fmtP(stats.max)} · ` +
    `${stats.count} ${stats.count > 1 ? t.palletsWord : t.palletWord} · ${stats.measures} ${t.readings}`,
    MARGIN, doc.y + 8, { size: 8.6, color: COLORS.GREY });
  doc.y += 14;

  /* La référence et son barème sont écrits noir sur blanc : c'est la
     règle que le destinataire doit pouvoir contester, pas deviner. */
  if (spec) {
    const label = spec.mode === 'range'
      ? `${t.pressRange} ${fmtP(spec.min)} – ${fmtP(spec.max)} ${unit}`
      : `${t.pressRef} ${fmtP(spec.ref)} ${unit}`;
    /* La portée de la règle client passe par le dictionnaire : elle
       contient le conditionnement (« Vrac », « Barquette »), et le
       laisser en français au milieu d'un PDF anglais donnait
       « Pack format: Tray » d'un côté et « · Barquette » de l'autre,
       sur la même page. */
    const scope = (pressures.refScope || pressures.refPack || '')
      .split(' · ').map(x => tr(lang, x)).join(' · ');
    doc.text(label + (pressures.refClient ? ` (${t.refFrom} ${pressures.refClient}${
        scope ? ` · ${scope}` : ''})` : ''),
      MARGIN, doc.y + 8, { size: 8.6, bold: true });
    doc.y += 12;
    /* La maturité déduite de la moyenne : c'est elle qui dit si le lot
       va tenir, indépendamment de l'écart à la référence. */
    if (ripe) {
      doc.text(`${t.ripeness} ${tr(lang, ripe)}`, MARGIN, doc.y + 8, { size: 8.4 });
      doc.y += 11;
    }
    const scale = spec.mode === 'range'
      ? t.pressScaleR(RANGE_TOL)
      : t.pressScaleT(SEV_STEPS.ok, SEV_STEPS.mineur, SEV_STEPS.majeur);
    for (const ln of splitToWidth(scale, 7.6, PAGE.w - 2 * MARGIN)) {
      doc.text(ln, MARGIN, doc.y + 7, { size: 7.6, color: COLORS.GREY });
      doc.y += 9;
    }

    /* Synthèse des écarts, en toutes lettres et en couleur d'encre
       lisible. L'inspecteur la voyait à l'écran ; le client, lui, ne
       recevait que la colonne « État » ligne à ligne et devait faire
       le compte lui-même. */
    if (pv) {
      const off = pv.count.mineur + pv.count.majeur + pv.count.critique;
      if (off) {
        const detail = [
          pv.count.critique && `${pv.count.critique} ${t.pressCrit.toLowerCase()}`,
          pv.count.majeur   && `${pv.count.majeur} ${t.pressMajor.toLowerCase()}`,
          pv.count.mineur   && `${pv.count.mineur} ${t.pressMinor.toLowerCase()}`
        ].filter(Boolean).join(' · ');
        doc.y += 4;
        doc.text(`${t.pressOff(off)} — ${detail}`, MARGIN, doc.y + 8,
          { size: 8.4, bold: true, color: COLORS.SEV_INK[pv.worst] || COLORS.GREY });
        doc.y += 12;
      }
    }
  }
  doc.y += 6;

  /* Hauteur choisie pour que les quinze graduations de 0 à 14 tiennent
     toutes, étiquetées : c'est la demande, et c'est ce qui permet de
     comparer deux rapports à l'œil. */
  const W = PAGE.w - 2 * MARGIN, H = 215;
  doc.need(H + 34);
  const top = doc.y;
  const m = chartModel(pressures, { width: W, height: H, spec });
  const X = (v) => MARGIN + v, Y = (v) => top + v;
  const pts = m.points.map(p => ({ ...p, X: X(p.x), Y: Y(p.y), YMin: Y(p.yMin), YMax: Y(p.yMax), LabelY: Y(p.labelY) }));

  /* Zone acceptée peinte d'abord : l'écart se lit à la position du
     point, la couleur ne fait que le confirmer. */
  for (const z of m.zones)
    doc.rect(X(m.axis.x0), Y(z.y), m.w, z.h,
      { fill: z.kind === 'tol' ? COLORS.ZONE_TOL : COLORS.ZONE });

  // grille horizontale et graduations — toutes les valeurs de 0 à 14
  for (const tick of m.ticks) {
    doc.line(X(m.axis.x0), Y(tick.y), X(m.axis.x1), Y(tick.y), { color: COLORS.GRID, w: 0.6 });
    if (tick.label)
      doc.text(String(tick.v), X(m.axis.x0) - 5, Y(tick.y) + 2.6,
        { size: 7, color: COLORS.GREY, align: 'right' });
  }
  doc.line(X(m.axis.x0), Y(m.axis.yBottom), X(m.axis.x1), Y(m.axis.yBottom), { color: COLORS.GRID, w: 0.9 });

  // bornes de la référence
  for (const r of m.refLines)
    doc.line(X(m.axis.x0), Y(r.y), X(m.axis.x1), Y(r.y), { color: COLORS.GREY, w: 1, dash: [4, 3] });

  /* Le trait relie les palettes dans l'ordre et garde une couleur
     unique : c'est le point qui porte la gravité, par sa forme et sa
     couleur, sur fond de zone acceptée. */
  if (pts.length > 1)
    doc.poly(pts.map(q => ({ x: q.X, y: q.Y })), { stroke: COLORS.SERIES, w: 2 });

  for (const p of pts) drawMark(doc, p.level, p.X, p.Y, col(p.level));

  const keep = labelledPoints(m);
  for (const p of pts) {
    if (keep.has(p.i)) {
      const a = labelAnchor(p.i, pts.length);
      doc.text(fmtP(p.avg), p.X, p.LabelY,
        { size: 7.5, bold: true, align: a === 'start' ? 'left' : a === 'end' ? 'right' : 'center' });
    }
    if (p.label) doc.text(p.label, p.X, Y(m.axis.yBottom) + 11, { size: 7.5, color: COLORS.GREY, align: 'center' });
  }

  /* Légende dessinée, pas écrite : les symboles de puce ne font pas
     partie de l'encodage WinAnsi et sortiraient en « ? ». Chaque
     niveau y apparaît avec sa forme ET son nom — imprimé en noir et
     blanc, ou lu par un daltonien, le rapport reste juste. */
  doc.y = top + H + 6;
  const levels = [...new Set(pts.map(p => p.level).filter(Boolean))]
    .sort((a, b) => SEV_ORDER.indexOf(a) - SEV_ORDER.indexOf(b));
  const keys = [];
  if (levels.length) for (const l of levels)
    keys.push([(x, y) => drawMark(doc, l, x + 6, y, COLORS.SEV[l]), SEVT[l]]);
  else keys.push([(x, y) => { doc.line(x, y, x + 13, y, { color: COLORS.SERIES, w: 2 });
                              doc.circle(x + 6.5, y, 2.4, { fill: COLORS.SERIES }); }, t.pressCurve]);
  if (spec) keys.push([(x, y) => { doc.rect(x, y - 4, 13, 8, { fill: COLORS.ZONE });
                                   doc.line(x, y, x + 13, y, { color: COLORS.GREY, w: 1, dash: [3, 2.5] }); },
                       spec.mode === 'range' ? t.pressRange : t.pressZone]);

  /* La légende passe à la ligne quand elle déborde : cinq entrées en
     néerlandais ne tiennent pas sur une seule. */
  let lx = MARGIN, ly = doc.y + 6;
  doc.need(24);
  for (const [draw, label] of keys) {
    const wNeeded = 18 + textWidth(label, 7.5, false) + 14;
    if (lx > MARGIN && lx + wNeeded > PAGE.w - MARGIN) { lx = MARGIN; ly += 12; }
    draw(lx, ly);
    doc.text(label, lx + 18, ly + 3, { size: 7.5, color: COLORS.GREY });
    lx += wNeeded;
  }
  doc.y = ly + 16;

  /* Détail chiffré : le graphique montre la tendance, le tableau porte
     la preuve — c'est lui qu'on oppose à un fournisseur. La colonne
     État nomme la gravité, pour que la couleur ne soit jamais seule. */
  const fruits = pressures.fruits || 5, sides = pressures.sides || 2;
  const cols = [{ k: 'n', h: t.pallet, w: 42 }];
  for (let fI = 1; fI <= fruits; fI++)
    for (let sI = 1; sI <= sides; sI++)
      cols.push({ k: `v${(fI - 1) * sides + (sI - 1)}`, h: sides > 1 ? `F${fI}·${sI}` : `F${fI}`, w: 38 });
  cols.push({ k: 'avg', h: t.average, w: 46 });
  /* « Scostamento critico » est le libellé le plus long des cinq
     langues : la colonne est taillée pour qu'il tienne sur une ligne. */
  if (spec) cols.push({ k: 'st', h: t.pressState, w: 104 });

  doc.table(cols, (pressures.pallets || []).map(pal => {
    const row = { n: String(pal.n ?? '') };
    const vals = [];
    (pal.v || []).forEach((v, i) => {
      row['v' + i] = (v === '' || v == null) ? '' : fmtP(Number(v)).replace('.0', '');
      if (v !== '' && v != null && isFinite(Number(v))) vals.push(Number(v));
    });
    if (!vals.length) { row.avg = ''; row.st = ''; return row; }
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sev = palletSeverity(avg, spec);
    row.avg = sev ? { v: fmtP(avg), color: COLORS.SEV_INK[sev.level], bold: true } : fmtP(avg);
    if (spec && sev)
      row.st = { v: sev.tol ? t.pressTol : SEVT[sev.level], color: COLORS.SEV_INK[sev.level],
                 bold: sev.level !== 'ok' };
    return row;
  }));
}

/* Même jeu de formes qu'à l'écran : rond conforme, losange mineur,
   triangle majeur, carré critique. */
function drawMark(doc, level, x, y, color) {
  const m = sevMark(level, x, y, 0.62);
  if (m.kind === 'circle') doc.circle(x, y, m.r, { fill: color, stroke: [1, 1, 1], w: 1 });
  else doc.poly(m.pts, { fill: color, stroke: [1, 1, 1], w: 1, close: true });
}

/* Tableau des poids : le contrôle production cherche les fruits sous
   le minimum de leur calibre. Ils sortent en rouge, et le compte est
   annoncé en tête — c'est l'information que le lecteur doit voir en
   premier, pas après avoir relu cinquante nombres. */
function drawWeights(doc, pressures, stats, group, t, lang) {
  const fruits = pressures.fruits || 5;
  doc.need(90);
  doc.sectionTitle(t.weightsTitle);

  doc.need(18);
  doc.text(`${t.weightAvg} ${fmtG(stats.avg)} g · min ${fmtG(stats.min)} · max ${fmtG(stats.max)} · ` +
           `${stats.measures} ${t.weighings}`,
           MARGIN, doc.y + 8, { size: 8.6, color: COLORS.GREY });
  doc.y += 15;

  doc.need(16);
  doc.text(stats.under
      ? `${stats.under} ${stats.under > 1 ? t.underMany : t.underOne}`
      : t.underNone,
    MARGIN, doc.y + 8, { size: 9, bold: true, color: stats.under ? COLORS.RED : COLORS.GREEN });
  doc.y += 18;

  const cols = [{ k: 'n', h: t.pallet, w: 52 }, { k: 'cal', h: t.calibre, w: 60 }];
  for (let f = 1; f <= fruits; f++) cols.push({ k: 'w' + (f - 1), h: `F${f}`, w: 46 });
  cols.push({ k: 'avg', h: t.average, w: 50 }, { k: 'min', h: t.minRequired, w: 56 });

  doc.table(cols, (pressures.pallets || [])
    .filter(pal => (pal.w || []).some(v => v !== '' && v != null))
    .map(pal => {
      const min = calibreMin(group, pal.cal);
      const st = weightStats(pal, min);
      const row = { n: String(pal.n ?? ''), cal: pal.cal || '', min: min != null ? fmtG(min) : '' };
      (pal.w || []).forEach((v, i) => {
        if (v === '' || v == null) { row['w' + i] = ''; return; }
        const under = min != null && Number(v) < min;
        row['w' + i] = under ? { v: fmtG(v), color: COLORS.RED, bold: true } : fmtG(v);
      });
      row.avg = st ? fmtG(st.avg) : '';
      return row;
    }));
}

/* Palettes problématiques : le NOMBRE d'abord — c'est ce que le client
   lit —, les numéros ensuite pour que le fournisseur sache lesquelles
   aller voir. Le champ n'en acceptait qu'une seule. */
function badCell(h) {
  const list = badPallets(h);
  if (!list.length) return '';
  return list.length === 1 ? list[0] : `${list.length} — ${list.join(', ')}`;
}

const DP2 = { step: 0.01 };
const fmt = (v, field) => {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v !== 'number') return String(v);
  const twoDp = field ? (field.step === 0.01 || field.type === 'pct') : false;
  if (twoDp) return v.toFixed(2);
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
};

function splitToWidth(str, size, maxW) {
  const words = String(str).split(/\s+/).filter(Boolean);
  const out = []; let line = '';
  const wOf = (s) => s.length * size * 0.5;
  for (const w of words) {
    const probe = line ? line + ' ' + w : w;
    if (wOf(probe) > maxW && line) { out.push(line); line = w; } else line = probe;
  }
  if (line) out.push(line);
  return out.length ? out : [''];
}

/* ------------------------- nom du fichier -------------------------
   Le fichier arrive chez un client ou un fournisseur : son nom doit se
   lire tel quel dans une pièce jointe, sans avoir à l'ouvrir. D'où des
   mots entiers, des accents, des espaces — et une composition propre à
   chaque type de rapport :

     réception   Rapport Qualité Avocat Hass Sol Andino lot 4412
     expédition  Rapport Qualité Avocat Hass Mtex NL du 21-09-2026
     production  Rapport Contrôle Qualité Avocat Hass Premium Monoprix du 21-09-2026

   La date s'écrit avec des tirets : la barre oblique est interdite dans
   un nom de fichier sur tous les systèmes. */
export function reportFilename(report, group, ext = 'pdf') {
  const d = new Date(report.report_date);
  const p = (n) => String(n).padStart(2, '0');
  const date = `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
  const h = report.header || {};
  const produit = [group?.name || report.product_group_id, h.variety].filter(Boolean).join(' ');
  const partenaire = report.partner_name || '';

  /* Deux contrôles du même client, le même produit, le même jour : sans
     le n° de BL — ou, à défaut, le n° de rapport — les deux fichiers
     portaient le même nom. Le second écrasait le premier dans les
     téléchargements, et en pièce jointe rien ne les distinguait. */
  const ref = h.bl || report.report_no || '';

  let parts;
  if (report.type === 'reception') {
    parts = ['Rapport Qualité', produit, partenaire, h.lot ? `lot ${h.lot}` : `n° ${report.report_no || ''}`];
  } else if (report.type === 'production') {
    parts = ['Rapport Contrôle Qualité',
             [produit, h.packaging_kind].filter(Boolean).join(' '),
             partenaire, `du ${date}`, ref];
  } else {
    parts = ['Rapport Qualité', produit, partenaire, `du ${date}`, ref];
  }
  const name = safeName(parts.filter(Boolean).join(' '));
  return (name || 'Rapport Qualité') + '.' + ext;
}

/* Ancien nom, conservé le temps que les appels existants migrent. */
export const pdfFilename = (report, group) => reportFilename(report, group, 'pdf');
