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
import { flatFields, statusIn, savedContext, ripenessField, ncDetail, criticalText, VERDICT_STATUS, QUALITY_STATUS, SHELF_STATUS } from './verdict.js';
import { receptionStats, samplingCfg } from './reception.js';
import { logoJpeg } from './logo.js';
import { storage, currentUser } from './supa.js';
import { local } from './store.js';
import { countryName, countryNames } from './countries.js';
import { lotStats, weightLotStats, palletWeighing,
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

/* Réception : date du quai, camion, indicateurs du lot et détail
   par palette — dans les cinq langues, comme le reste du rapport. */
const T_REC = {
  fr: { lotNo:'N° de lot', arrivalDate:'Date de réception', truck:'N° de camion', kpiTitle:'Indicateurs du lot', under:'Sous-calibre',
        light:'Défauts légers', loss:'Pertes', palletDetail:'Détail par palette', palletsId:'Identification des palettes',
        defectsTitle:'Défauts par palette', underTitle:'Sous-calibre par palette', boxKg:'Colis (kg)', brand:'Marque',
        producer:'Producteur', producers:'Producteurs', checked:'Contrôlés', ext:'Ext.', int:'Int.', lossPct:'Pertes %',
        weighed:'Pesés', underN:'Sous-poids', underW:'Poids sous-calibrés (g)', underPct:'Sous-cal. %',
        badLegend:'Palettes problématiques surlignées en rouge.', toneWarn:'à surveiller', toneFail:'hors tolérance',
        photosArchived:(n, d) => `${n} photo${n > 1 ? 's' : ''} archivée${n > 1 ? 's' : ''} le ${d} : ${n > 1 ? 'elles figurent' : 'elle figure'} dans la version archivée de ce rapport.`,
        weighedLine:(n, f) => `${n} fruits pesés (${f} par palette)`,
        underOf:(u, w) => `${u} fruit${u > 1 ? 's' : ''} sous-calibré${u > 1 ? 's' : ''} sur ${w} pesés`,
        noMinWeight:'Poids minimum inconnu pour ces calibres : rien n\'est jugé.',
        blankOk:'Seuls les fruits sous le poids minimum sont notés : une case vide est un fruit pesé et conforme.',
        kpiNote:(c, f, k) => `Sur ${c} fruits contrôlés${k ? ` et ${k} fruits coupés` : ''}${f ? ` (${f} fruits dans le lot)` : ''}.`,
        ncWhy:'Détail du %NC :',
        ncW:{ fruit:'fruits touchés', boxes:'caisses problématiques', criteria:'critères', pressure:'pressions',
              capped:(r, n, v) => `${r} %, ramené à ${n} % (plafond d'un lot ${v})` },
        critW:{ one:'Défaut critique :', many:'Défauts critiques :',
                pallets:(ns) => ns.length === 1 ? `Pression palette ${ns[0]}` : ns.length <= 4 ? `Pression palettes ${ns.join(', ')}` : `Pression de ${ns.length} palettes` },
        cut:'Coupés',
        defNote:(b, k) => k == null
          ? `Nombre de fruits touchés, comptés sur ${b} colis ouverts par palette. Pertes : % des fruits contrôlés.`
          : `Nombre de fruits touchés. Défauts externes : comptés sur ${b} colis ouverts par palette ; défauts internes : ${
              k === 'var' ? 'sur les fruits coupés de chaque palette (colonne « Coupés »)' : `sur ${k} fruits coupés par palette`}. ` +
            `Pertes : somme des % de chaque défaut, rapporté à son propre échantillon.` },
  en: { lotNo:'Batch No.', arrivalDate:'Arrival date', truck:'Truck No.', kpiTitle:'Lot indicators', under:'Undersize',
        light:'Minor defects', loss:'Losses', palletDetail:'Pallet details', palletsId:'Pallet identification',
        defectsTitle:'Defects per pallet', underTitle:'Undersize per pallet', boxKg:'Box (kg)', brand:'Brand',
        producer:'Grower', producers:'Growers', checked:'Checked', ext:'Ext.', int:'Int.', lossPct:'Losses %',
        weighed:'Weighed', underN:'Underweight', underW:'Undersized weights (g)', underPct:'Undersize %',
        badLegend:'Problem pallets highlighted in red.', toneWarn:'to monitor', toneFail:'out of tolerance',
        photosArchived:(n, d) => `${n} photo${n > 1 ? 's' : ''} archived on ${d}: see the archived version of this report.`,
        weighedLine:(n, f) => `${n} fruit weighed (${f} per pallet)`,
        underOf:(u, w) => `${u} undersized fruit out of ${w} weighed`,
        noMinWeight:'Minimum weight unknown for these sizes: nothing is assessed.',
        blankOk:'Only fruit below the minimum weight are recorded: an empty cell is a fruit weighed and compliant.',
        kpiNote:(c, f, k) => `Based on ${c} fruit checked${k ? ` and ${k} fruit cut open` : ''}${f ? ` (${f} fruit in the lot)` : ''}.`,
        ncWhy:'%NC breakdown:',
        ncW:{ fruit:'affected fruit', boxes:'problem boxes', criteria:'criteria', pressure:'firmness',
              capped:(r, n, v) => `${r} %, brought down to ${n} % (cap for a ${v} lot)` },
        critW:{ one:'Critical defect:', many:'Critical defects:',
                pallets:(ns) => ns.length === 1 ? `Firmness, pallet ${ns[0]}` : ns.length <= 4 ? `Firmness, pallets ${ns.join(', ')}` : `Firmness of ${ns.length} pallets` },
        cut:'Cut',
        defNote:(b, k) => k == null
          ? `Number of affected fruit, counted in ${b} boxes opened per pallet. Losses: % of fruit checked.`
          : `Number of affected fruit. External defects: counted in ${b} boxes opened per pallet; internal defects: ${
              k === 'var' ? 'on the fruit cut open on each pallet ("Cut" column)' : `on ${k} fruit cut open per pallet`}. ` +
            `Losses: sum of the % of each defect, relative to its own sample.` },
  it: { lotNo:'N. lotto', arrivalDate:'Data di arrivo', truck:'N. camion', kpiTitle:'Indicatori del lotto', under:'Sottocalibro',
        light:'Difetti lievi', loss:'Perdite', palletDetail:'Dettaglio per pallet', palletsId:'Identificazione dei pallet',
        defectsTitle:'Difetti per pallet', underTitle:'Sottocalibro per pallet', boxKg:'Collo (kg)', brand:'Marchio',
        producer:'Produttore', producers:'Produttori', checked:'Controllati', ext:'Est.', int:'Int.', lossPct:'Perdite %',
        weighed:'Pesati', underN:'Sottopeso', underW:'Pesi sottocalibro (g)', underPct:'Sottocal. %',
        badLegend:'Pallet problematici evidenziati in rosso.', toneWarn:'da monitorare', toneFail:'fuori tolleranza',
        photosArchived:(n, d) => `${n} foto archiviat${n > 1 ? 'e' : 'a'} il ${d}: ${n > 1 ? 'sono' : 'è'} nella versione archiviata di questo rapporto.`,
        weighedLine:(n, f) => `${n} frutti pesati (${f} per pallet)`,
        underOf:(u, w) => `${u} frutt${u > 1 ? 'i' : 'o'} sottocalibro su ${w} pesati`,
        noMinWeight:'Peso minimo sconosciuto per questi calibri: nulla viene valutato.',
        blankOk:'Si annotano solo i frutti sotto il peso minimo: una casella vuota è un frutto pesato e conforme.',
        kpiNote:(c, f, k) => `Su ${c} frutti controllati${k ? ` e ${k} frutti tagliati` : ''}${f ? ` (${f} frutti nel lotto)` : ''}.`,
        ncWhy:'Dettaglio %NC:',
        ncW:{ fruit:'frutti colpiti', boxes:'colli problematici', criteria:'criteri', pressure:'pressioni',
              capped:(r, n, v) => `${r} %, riportato al ${n} % (tetto di un lotto ${v})` },
        critW:{ one:'Difetto critico:', many:'Difetti critici:',
                pallets:(ns) => ns.length === 1 ? `Pressione pallet ${ns[0]}` : ns.length <= 4 ? `Pressione pallet ${ns.join(', ')}` : `Pressione di ${ns.length} pallet` },
        cut:'Tagliati',
        defNote:(b, k) => k == null
          ? `Numero di frutti colpiti, contati su ${b} colli aperti per pallet. Perdite: % dei frutti controllati.`
          : `Numero di frutti colpiti. Difetti esterni: contati su ${b} colli aperti per pallet; difetti interni: ${
              k === 'var' ? 'sui frutti tagliati di ogni pallet (colonna «Tagliati»)' : `su ${k} frutti tagliati per pallet`}. ` +
            `Perdite: somma delle % di ciascun difetto, rispetto al proprio campione.` },
  es: { lotNo:'N.º de lote', arrivalDate:'Fecha de llegada', truck:'N.º de camión', kpiTitle:'Indicadores del lote', under:'Subcalibre',
        light:'Defectos leves', loss:'Pérdidas', palletDetail:'Detalle por palé', palletsId:'Identificación de los palés',
        defectsTitle:'Defectos por palé', underTitle:'Subcalibre por palé', boxKg:'Caja (kg)', brand:'Marca',
        producer:'Productor', producers:'Productores', checked:'Controlados', ext:'Ext.', int:'Int.', lossPct:'Pérdidas %',
        weighed:'Pesados', underN:'Bajo peso', underW:'Pesos subcalibre (g)', underPct:'Subcal. %',
        badLegend:'Palés problemáticos resaltados en rojo.', toneWarn:'a vigilar', toneFail:'fuera de tolerancia',
        photosArchived:(n, d) => `${n} foto${n > 1 ? 's' : ''} archivada${n > 1 ? 's' : ''} el ${d}: ${n > 1 ? 'figuran' : 'figura'} en la versión archivada de este informe.`,
        weighedLine:(n, f) => `${n} frutos pesados (${f} por palé)`,
        underOf:(u, w) => `${u} fruto${u > 1 ? 's' : ''} subcalibrado${u > 1 ? 's' : ''} de ${w} pesados`,
        noMinWeight:'Peso mínimo desconocido para estos calibres: no se evalúa nada.',
        blankOk:'Solo se anotan los frutos por debajo del peso mínimo: una casilla vacía es un fruto pesado y conforme.',
        kpiNote:(c, f, k) => `Sobre ${c} frutos controlados${k ? ` y ${k} frutos cortados` : ''}${f ? ` (${f} frutos en el lote)` : ''}.`,
        ncWhy:'Detalle del %NC:',
        ncW:{ fruit:'frutos afectados', boxes:'cajas problemáticas', criteria:'criterios', pressure:'presiones',
              capped:(r, n, v) => `${r} %, reducido al ${n} % (tope de un lote ${v})` },
        critW:{ one:'Defecto crítico:', many:'Defectos críticos:',
                pallets:(ns) => ns.length === 1 ? `Presión palé ${ns[0]}` : ns.length <= 4 ? `Presión palés ${ns.join(', ')}` : `Presión de ${ns.length} palés` },
        cut:'Cortados',
        defNote:(b, k) => k == null
          ? `Número de frutos afectados, contados en ${b} cajas abiertas por palé. Pérdidas: % de los frutos controlados.`
          : `Número de frutos afectados. Defectos externos: contados en ${b} cajas abiertas por palé; defectos internos: ${
              k === 'var' ? 'en los frutos cortados de cada palé (columna «Cortados»)' : `en ${k} frutos cortados por palé`}. ` +
            `Pérdidas: suma de los % de cada defecto, respecto a su propia muestra.` },
  nl: { lotNo:'Partijnummer', arrivalDate:'Aankomstdatum', truck:'Vrachtwagennr.', kpiTitle:'Kerncijfers partij', under:'Ondermaat',
        light:'Lichte gebreken', loss:'Verliezen', palletDetail:'Details per pallet', palletsId:'Identificatie van de pallets',
        defectsTitle:'Gebreken per pallet', underTitle:'Ondermaat per pallet', boxKg:'Colli (kg)', brand:'Merk',
        producer:'Teler', producers:'Telers', checked:'Gecontroleerd', ext:'Uitw.', int:'Inw.', lossPct:'Verlies %',
        weighed:'Gewogen', underN:'Ondergewicht', underW:'Gewichten ondermaat (g)', underPct:'Ondermaat %',
        badLegend:'Probleempallets rood gemarkeerd.', toneWarn:'aandachtspunt', toneFail:'buiten tolerantie',
        photosArchived:(n, d) => `${n} foto${n > 1 ? "'s" : ''} gearchiveerd op ${d}: zie de gearchiveerde versie van dit rapport.`,
        weighedLine:(n, f) => `${n} vruchten gewogen (${f} per pallet)`,
        underOf:(u, w) => `${u} ${u > 1 ? 'vruchten' : 'vrucht'} onder maat van ${w} gewogen`,
        noMinWeight:'Minimumgewicht onbekend voor deze maten: niets wordt beoordeeld.',
        blankOk:'Alleen vruchten onder het minimumgewicht worden genoteerd: een leeg vak is een gewogen, conforme vrucht.',
        kpiNote:(c, f, k) => `Op ${c} gecontroleerde vruchten${k ? ` en ${k} doorgesneden vruchten` : ''}${f ? ` (${f} vruchten in de partij)` : ''}.`,
        ncWhy:'Opbouw %NC:',
        ncW:{ fruit:'aangetaste vruchten', boxes:'probleemcolli', criteria:'criteria', pressure:'drukmetingen',
              capped:(r, n, v) => `${r} %, teruggebracht tot ${n} % (plafond voor een ${({ conform: 'conforme', acceptabel: 'acceptabele' })[v] || v} partij)` },
        critW:{ one:'Kritiek gebrek:', many:'Kritieke gebreken:',
                pallets:(ns) => ns.length === 1 ? `Drukmeting pallet ${ns[0]}` : ns.length <= 4 ? `Drukmeting pallets ${ns.join(', ')}` : `Drukmeting van ${ns.length} pallets` },
        cut:'Gesneden',
        defNote:(b, k) => k == null
          ? `Aantal aangetaste vruchten, geteld in ${b} geopende colli per pallet. Verliezen: % van de gecontroleerde vruchten.`
          : `Aantal aangetaste vruchten. Uitwendige gebreken: geteld in ${b} geopende colli per pallet; inwendige gebreken: ${
              k === 'var' ? 'op de doorgesneden vruchten van elke pallet (kolom „Gesneden")' : `op ${k} doorgesneden vruchten per pallet`}. ` +
            `Verliezen: som van de % van elk gebrek, ten opzichte van de eigen steekproef.` }
};
for (const l of Object.keys(T_REC)) Object.assign(T[l], T_REC[l]);

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
  /* --- défauts comptés palette par palette (réception) --- */
  'Lenticelle':           { en:'Lenticel damage', it:'Lenticelle', es:'Lenticelas', nl:'Lenticellen' },
  'Lenticelles':          { en:'Lenticel damage', it:'Lenticelle', es:'Lenticelas', nl:'Lenticellen' },
  'Griffures':            { en:'Scratches', it:'Graffi', es:'Rasguños', nl:'Krassen' },
  'Anthracnose':          { en:'Anthracnose', it:'Antracnosi', es:'Antracnosis', nl:'Antracnose' },
  'Taches de froid':      { en:'Chilling spots', it:'Macchie da freddo', es:'Manchas de frío', nl:'Koudevlekken' },
  'Pulpe grise':          { en:'Grey pulp', it:'Polpa grigia', es:'Pulpa gris', nl:'Grijze pulp' },
  'Brûlure de sève':      { en:'Sap burn', it:'Bruciatura da linfa', es:'Quemadura de savia', nl:'Sapverbranding' },
  'Effondrement interne': { en:'Internal breakdown', it:'Collasso interno', es:'Colapso interno', nl:'Inwendig bederf' },
  'Pourriture / Anthracnose':{ en:'Decay / Anthracnose', it:'Marciume / Antracnosi', es:'Podredumbre / Antracnosis', nl:'Rot / Antracnose' },
  'Caisses échantillon':  { en:'Sample boxes', it:'Colli campione', es:'Cajas muestra', nl:'Steekproefcolli' },
  'Caisses problématiques':{ en:'Problem boxes', it:'Colli problematici', es:'Cajas problemáticas', nl:'Probleemcolli' },
  '% caisses problématiques':{ en:'% problem boxes', it:'% colli problematici', es:'% cajas problemáticas', nl:'% probleemcolli' },
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

/* Un terme du dictionnaire suivi de sa plage — « Prêt à manger
   (0,6–2,5 kg) », tel qu'on le retouche dans les réglages. On traduit
   le terme et on garde la plage (avec le point décimal en anglais) :
   sans cela, le moindre libellé ajusté sortait en français au milieu
   d'un PDF anglais. */
function termOf(lang, s) {
  if (TERMS[s]?.[lang]) return TERMS[s][lang];
  const m = /^(.*?)\s*(\([^()]*\))\s*$/.exec(String(s));
  if (!m || !TERMS[m[1]]?.[lang]) return null;
  const range = lang === 'en' ? m[2].replace(/(\d),(\d)/g, '$1.$2') : m[2];
  return `${TERMS[m[1]][lang]} ${range}`;
}

/* Traduit une chaîne venue de la base ; laisse passer ce qu'elle ne
   connaît pas (noms de variétés, calibres, texte libre). */
const tr = (lang, s) => (lang === 'fr' || !s) ? s : (termOf(lang, s) || s);

/* Ordre de priorité pour un libellé venu des Réglages :
     1. la traduction saisie sur le critère ou la section ;
     2. le dictionnaire ci-dessus, qui couvre les grilles livrées ;
     3. le français, faute de mieux.
   Un critère ajouté à la main sans traduction reste donc en français
   dans le PDF, jamais vide et jamais approximatif. */
const trLabel = (lang, label, i18n) => {
  if (lang === 'fr' || !label) return label;
  return (i18n && i18n[lang]) || termOf(lang, label) || label;
};

/* Utilisé par l'éditeur de critères pour indiquer qu'un libellé est
   déjà traduit d'office. */
export const builtinTranslation = (label) => {
  if (TERMS[label]) return TERMS[label];
  const out = {};
  for (const l of ['en', 'it', 'es', 'nl']) { const t = termOf(l, label); if (!t) return null; out[l] = t; }
  return out;
};

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
async function photoBytes(report) {
  /* Une photo archivée n'est plus sur Supabase : elle est comptée à
     part, et le PDF le dit avec la date — ce n'est pas une panne. */
  const arch = (report.photos || []).filter(p => p.archived);
  const all = (report.photos || []).filter(p => !p.archived);
  /* TOUTES les photos du rapport : le PDF s'arrêtait à 8, et annonçait
     les suivantes comme « n'ayant pas pu être jointes » — une panne qui
     n'en était pas une. Copie locale d'abord ; sinon la photo est sur
     Supabase — même si l'objet rapport tenu par l'écran la croit
     encore « à envoyer » : elle est partie entre-temps. */
  const blobs = await Promise.all(all.map(async p =>
    (p.localId ? (await local.get('photos', p.localId))?.blob : null) || null));
  const remote = await storage.downloadMany(all.filter((p, i) => !blobs[i] && p.path).map(p => p.path))
    .catch(() => new Map());
  const out = [];
  for (const [i, p] of all.entries()) {
    const blob = blobs[i] || remote.get(p.path) || null;
    if (blob) out.push(new Uint8Array(await blob.arrayBuffer()));
  }
  out.missing = all.length - out.length;
  out.archived = arch.length;
  out.archivedOn = arch.map(p => p.archived).sort().pop() || '';
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
  /* Le n° de lot en tête : c'est par lui qu'on retrouve la marchandise.
     Il n'était que dans le tableau Résumé. */
  if (isShip ? h.bl : h.lot) doc.row(isShip ? t.bl : t.lotNo, isShip ? h.bl : h.lot);
  const origins = originList(h);
  if (origins.length) doc.row(origins.length > 1 ? t.origins : t.origin, countryNames(origins, lang));
  if (h.carrier) doc.row(t.carrier, h.carrier);
  if (RT.voyage && (h.voyage || h.load_id)) doc.row(t.voyage, h.voyage || h.load_id);
  if (h.arrival) doc.row(t.arrivalDate, wallDate(h.arrival));
  if (h.truck) doc.row(t.truck, h.truck);
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
        pal: fmt(m.pal_count), bad: badCell(h, t), lot: (isShip ? h.bl : h.lot) || '' } ]
  );
  /* Sous le Résumé : ce qui rend le lot non conforme d'office, puis
     d'où vient le %NC. Le fournisseur y lit le détail du chiffre qu'on
     lui oppose. Rien pour un rapport enregistré avant la 3.3. */
  const critLine = criticalText(s, t.critW, (c) => {
    const f = flatFields(group, report.type).find(x => x.key === c.key);
    return trLabel(lang, f?.label || c.label, f?.i18n);
  });
  const whyLine = ncDetail(s, t.ncW, (v) => tv(lang, v).toLowerCase());
  if (critLine) doc.note(critLine, { color: COLORS.RED, bold: true });
  if (whyLine) doc.note(`${t.ncWhy} ${whyLine}`);

  /* -- Indicateurs de la réception : en tête, c'est ce que le
     fournisseur lit en premier. -- */
  const recK = report.type === 'reception' ? (s.reception || null) : null;
  if (recK && (recK.checked || recK.weighed)) {
    /* Couleur ET mot : ceux du verdict des critères que l'indicateur
       remplit (verdict.js, receptionTones). Un rapport enregistré avant
       ce calcul n'a pas de ton : chiffres en noir, sans jugement. */
    const tone = recK.tone || {};
    const cell = (v, tn) => ({
      v: v == null ? '—' : pctTxt(v, lang) + ' %' + (tn === 'fail' ? ` — ${t.toneFail}` : tn === 'warn' ? ` — ${t.toneWarn}` : ''),
      bold: true,
      color: tn === 'fail' ? COLORS.RED : tn === 'warn' ? COLORS.SEV_INK.mineur : COLORS.BLACK });
    doc.need(46);
    doc.subhead(t.kpiTitle);
    doc.table(
      [ { k:'u', h:t.under, w:120 }, { k:'l', h:t.light, w:120 }, { k:'p', h:t.loss, w:120 } ],
      [ { u: cell(recK.under, tone.under), l: cell(recK.light, tone.light), p: cell(recK.loss, tone.loss) } ]);
    if (recK.checked) {
      doc.need(12);
      doc.text(t.kpiNote(recK.checked.toLocaleString(numLocale(lang)), recK.fruits ? Number(recK.fruits).toLocaleString(numLocale(lang)) : '',
                         recK.cut ? Number(recK.cut).toLocaleString(numLocale(lang)) : ''),
        MARGIN, doc.y + 4, { size: 7.6, color: COLORS.GREY });
      doc.y += 12;
    }
  }

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
  /* Même lecture que le verdict : une dureté ou un stade que la
     référence client a validés ne s'affichent pas en défaut. */
  const judged = savedContext(s);
  for (const [secLabel, list] of bySection) {
    doc.subhead(trLabel(lang, secLabel, list[0]?.sectionI18n));
    for (const fl of list) {
      const st = statusIn(judged, fl, m[fl.key]);
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
  /* Le stade déduit passe par la même traduction que la ligne
     « Stade de mûrissement » du tableau : les deux doivent se lire
     pareil sur la même page. */
  const ripe = s.ripeness?.stage;
  const ripeOpt = ripe && (ripenessField(group, report.type)?.options || []).find(o => o.v === ripe);
  const ripeText = ripe ? trLabel(lang, ripe, ripeOpt?.i18n) : null;
  if (pStats) drawPressures(doc, h.pressures, pStats, t, lang, refSpec(h.pressures, group), pressureVerdict(h.pressures, group), ripeText, badPallets(h));
  const wStats = weightLotStats(h.pressures, group);
  if (wStats) drawWeights(doc, h.pressures, wStats, group, t, lang, badPallets(h));
  if (report.type === 'reception') drawReceptionPallets(doc, h, group, t, lang);

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
  if (imgs.length || imgs.missing || imgs.archived) {
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
    if (imgs.archived > 0) {
      const d = imgs.archivedOn;
      doc.need(16);
      doc.text(t.photosArchived(imgs.archived, d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : ''),
        MARGIN, doc.y + 8, { size: 8, color: COLORS.GREY });
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
function drawPressures(doc, pressures, stats, t, lang, spec, pv, ripe, bad = []) {
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
      doc.text(`${t.ripeness} ${ripe}`, MARGIN, doc.y + 8, { size: 8.4 });
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
  /* « # » : le rang sur le graphique ; le n° réel de la palette prend
     la largeur de son texte (18 chiffres chez certains fournisseurs). */
  const cols = [{ k: 'i', h: '#', w: 10, fit: true }, { k: 'n', h: t.pallet, w: 42, fit: true }];
  for (let fI = 1; fI <= fruits; fI++)
    for (let sI = 1; sI <= sides; sI++)
      cols.push({ k: `v${(fI - 1) * sides + (sI - 1)}`, h: sides > 1 ? `F${fI}·${sI}` : `F${fI}`, w: 38 });
  cols.push({ k: 'avg', h: t.average, w: 46 });
  /* La colonne État prend la largeur de son libellé le plus long dans
     ce rapport (« Scostamento critico » en italien) : il tient sur une
     ligne, et les colonnes de mesures gardent le reste. */
  if (spec) cols.push({ k: 'st', h: t.pressState, w: 40, fit: true });

  const badSet = new Set(bad);
  let rank = 0;
  doc.table(cols, (pressures.pallets || []).map(pal => {
    const nm = String(pal.n ?? '');
    const row = badSet.has(nm.trim()) ? { _bg: BAD_BG, n: { v: nm, bold: true, color: COLORS.RED } } : { n: nm };
    const vals = [];
    (pal.v || []).forEach((v, i) => {
      row['v' + i] = (v === '' || v == null) ? '' : fmtP(Number(v)).replace('.0', '');
      if (v !== '' && v != null && isFinite(Number(v))) vals.push(Number(v));
    });
    if (!vals.length) { row.avg = ''; row.st = ''; return row; }
    row.i = { v: String(++rank), color: COLORS.GREY };
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
function drawWeights(doc, pressures, stats, group, t, lang, bad = []) {
  const fruits = pressures.fruits || 5;
  const badSet = new Set(bad);
  doc.need(90);
  doc.sectionTitle(t.weightsTitle);

  /* Tous les fruits de la pression sont pesés ; seuls les trop légers
     sont forcément notés. La ligne dit donc combien de fruits ont été
     pesés, et la moyenne n'apparaît que si tous les poids sont notés. */
  doc.need(18);
  doc.text((stats.weighed ? t.weighedLine(stats.weighed, stats.fruits) : `${stats.measures} ${t.weighings}`) +
           (stats.complete ? ` · ${t.weightAvg} ${fmtG(stats.avg)} g · min ${fmtG(stats.min)} · max ${fmtG(stats.max)}` : ''),
           MARGIN, doc.y + 8, { size: 8.6, color: COLORS.GREY });
  doc.y += 15;

  doc.need(16);
  doc.text(!stats.judged ? t.noMinWeight : stats.under ? t.underOf(stats.under, stats.weighed) : t.underNone,
    MARGIN, doc.y + 8, { size: 9, bold: true, color: !stats.judged ? COLORS.GREY : stats.under ? COLORS.RED : COLORS.GREEN });
  doc.y += 18;

  const cols = [{ k: 'n', h: t.pallet, w: 60, fit: true }, { k: 'cal', h: t.calibre, w: 44 }];
  for (let f = 1; f <= fruits; f++) cols.push({ k: 'w' + (f - 1), h: `F${f}`, w: 40 });
  cols.push({ k: 'avg', h: t.average, w: 46 }, { k: 'min', h: t.minRequired, w: 50 },
            { k: 'un', h: t.underN, w: 50 }, { k: 'up', h: t.underPct, w: 48 });

  doc.table(cols, (pressures.pallets || [])
    .filter(pal => (pal.w || []).some(v => v !== '' && v != null))
    .map(pal => {
      const s = palletWeighing(pal, group, fruits);
      const nm = String(pal.n ?? '');
      const row = { n: nm, cal: pal.cal || '', min: s.min != null ? fmtG(s.min) : '' };
      if (badSet.has(nm.trim())) { row._bg = BAD_BG; row.n = { v: nm, bold: true, color: COLORS.RED }; }
      if (s.min != null && s.weighed) {
        row.un = s.under ? { v: `${s.under}/${s.weighed}`, bold: true, color: COLORS.RED } : `0/${s.weighed}`;
        row.up = pctTxt(s.pct, lang, 0);
      }
      (pal.w || []).forEach((v, i) => {
        if (v === '' || v == null) { row['w' + i] = ''; return; }
        const under = s.min != null && Number(v) < s.min;
        row['w' + i] = under ? { v: fmtG(v), color: COLORS.RED, bold: true } : fmtG(v);
      });
      row.avg = s.avg != null ? fmtG(s.avg) : '';
      return row;
    }));
  doc.need(12);
  doc.text(t.blankOk, MARGIN, doc.y + 2, { size: 7.6, color: COLORS.GREY });
  doc.y += 10;
}

/* Fond des palettes problématiques : un rouge très pâle, qui laisse
   le texte lisible une fois imprimé en noir et blanc. */
const BAD_BG = [0.99, 0.89, 0.89];

/* « 2026-09-22T08:38 » → « 22/09/2026 08:38 », l'heure du quai. */
const wallDate = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}${s.length > 10 ? ' ' + s.slice(11, 16) : ''}` : '');
const numLocale = (lang) => ({ fr: 'fr-FR', en: 'en-GB', it: 'it-IT', es: 'es-ES', nl: 'nl-NL' }[lang] || 'fr-FR');
/* Point décimal dans toutes les langues, comme le reste du rapport
   (critères, pressions, poids) : une page ne mélange pas « 1,7 % » et
   « 1.52 % ». `lang` reste en paramètre pour les appels existants. */
const pctTxt = (v, lang, dp = 1) => {
  if (v == null || !isFinite(v)) return '';
  return (Math.round(v * 10 ** dp) / 10 ** dp).toFixed(dp);
};
const numTxt = (v, lang) => String(Math.round(Number(v) * 100) / 100);

/* Réception : une ligne par palette reçue — n° réel, variété, colis,
   calibre, catégorie, marque, GGN — puis les défauts comptés. Les
   palettes problématiques sont surlignées dans chaque tableau. */
function drawReceptionPallets(doc, h, group, t, lang) {
  const pals = h.pressures?.pallets || [];
  if (!pals.length) return;
  const rs = receptionStats(h.pressures, group, 'reception');
  const bad = new Set(badPallets(h));
  const mark = (n) => bad.has(n) ? { _bg: BAD_BG, n: { v: n, bold: true, color: COLORS.RED } } : { n };

  const ident = pals.some(p => p.sub || p.ggn || p.variety || p.boxes || p.cat || p.brand);
  if (!ident && !(rs.defs.length && rs.sampled)) return;
  doc.need(140);
  doc.sectionTitle(t.palletDetail);
  if (ident) {
  doc.subhead(t.palletsId);
  doc.table([
      { k: 'n', h: t.pallet, w: 60, fit: true }, { k: 'va', h: t.variety, w: 60 }, { k: 'kg', h: t.boxKg, w: 42 },
      { k: 'c', h: t.calibre, w: 42 }, { k: 'ca', h: t.category, w: 48 }, { k: 'b', h: t.brand, w: 54 },
      { k: 'g', h: 'GGN', w: 82 }, { k: 'o', h: t.origin, w: 54 }, { k: 'bx', h: t.boxes, w: 40 } ],
    rs.rows.map(x => ({ ...mark(x.n), va: x.p.variety || '', kg: x.p.boxKg ? numTxt(x.p.boxKg, lang) : '',
      c: x.p.cal || '', ca: x.p.cat || '', b: x.p.brand || '', g: x.p.ggn || '',
      o: x.p.origin ? countryName(x.p.origin, lang) : '', bx: x.p.boxes ?? '' })),
    { size: 7.8, headSize: 7.8 });

  /* Producteurs : leurs noms sont longs, on les donne une fois, sous
     le tableau, rattachés à leur GGN. */
  const prods = [...new Map(pals.filter(p => p.ggn || p.producer).map(p => [`${p.ggn}|${p.producer}`, p])).values()];
  if (prods.length) {
    doc.need(14);
    doc.text(t.producers, MARGIN, doc.y + 6, { size: 7.8, bold: true });
    doc.y += 11;
    for (const p of prods) {
      for (const ln of splitToWidth(`${p.ggn ? 'GGN ' + p.ggn : ''}${p.ggn && p.producer ? ' — ' : ''}${p.producer || ''}`,
                                    7.6, PAGE.w - 2 * MARGIN - 8)) {
        doc.need(10);
        doc.text(ln, MARGIN + 6, doc.y + 6, { size: 7.6, color: COLORS.GREY });
        doc.y += 9.5;
      }
    }
    doc.y += 6;
  }
  }

  if (rs.defs.length && rs.sampled) {
    doc.need(120);
    doc.subhead(t.defectsTitle);
    const cols = [{ k: 'n', h: t.pallet, w: 60, fit: true }, { k: 'ck', h: t.checked, w: 44 },
      ...(rs.legacy ? [] : [{ k: 'ct', h: t.cut, w: 40 }]),
      ...rs.defs.map(d => ({ k: 'd_' + d.key, h: trLabel(lang, d.label, d.i18n), w: 30, rot: true })),
      { k: 'e', h: t.ext, w: 30 }, { k: 'i', h: t.int, w: 30 }, { k: 'l', h: t.lossPct, w: 46 }];
    doc.table(cols, rs.rows.map(x => {
      const row = { ...mark(x.n), ck: x.def.checked ?? '', ct: x.def.cut ?? '', e: x.def.ext || '', i: x.def.int || '',
        l: x.def.checked == null ? '' : x.def.loss
          ? { v: pctTxt(x.def.lossPct, lang), bold: true, color: COLORS.RED } : pctTxt(0, lang) };
      for (const d of rs.defs) row['d_' + d.key] = x.def.counts[d.key] || '';
      return row;
    }), { size: 7.8, headSize: 7.4 });
    /* Défauts internes : un seul nombre de fruits coupés pour tout le
       lot, ou « chaque palette » quand certaines en ont eu davantage. */
    const cuts = [...new Set(rs.rows.filter(x => x.def.checked).map(x => x.def.cut))];
    const note = t.defNote(samplingCfg(group).boxes,
      rs.legacy || !rs.defs.some(d => d.where === 'int') ? null : cuts.length === 1 ? cuts[0] : 'var');
    for (const ln of splitToWidth(note, 7.6, PAGE.w - 2 * MARGIN)) {
      doc.need(10);
      doc.text(ln, MARGIN, doc.y + 4, { size: 7.6, color: COLORS.GREY });
      doc.y += 9.5;
    }
  }
  if (bad.size) {
    doc.need(14);
    doc.rect(MARGIN, doc.y + 1, 10, 7, { fill: BAD_BG, stroke: COLORS.RED, lw: 0.5 });
    doc.text(t.badLegend, MARGIN + 15, doc.y + 7.5, { size: 7.8, color: COLORS.GREY });
    doc.y += 14;
  }
}

/* Palettes problématiques : le NOMBRE d'abord — c'est ce que le client
   lit —, les numéros ensuite pour que le fournisseur sache lesquelles
   aller voir. Plusieurs n° longs (18 chiffres chez certains
   fournisseurs) ne tiennent pas dans la case du Résumé : on n'en donne
   alors que le nombre — elles sont surlignées dans les tableaux. */
function badCell(h, t) {
  const list = badPallets(h);
  if (!list.length) return '';
  if (list.length === 1) return list[0];
  if (list.some(n => String(n).length > 10))
    return `${list.length} ${t?.palletsWord || 'palettes'}`;
  return `${list.length} — ${list.join(', ')}`;
}

const DP2 = { step: 0.01 };
const fmt = (v, field) => {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v !== 'number') return String(v);
  /* Deux décimales pour une mesure (elle porte une unité : kg, °C…) ou
     un pourcentage. Un comptage sans unité reste un comptage, même s'il
     accepte les demi-palettes : « 21 », « 1.5 » — pas « 21.00 ». */
  const measure = field ? (field.type === 'pct' || (Number(field.step) === 0.01 && !!field.unit)) : false;
  if (measure) return v.toFixed(2);
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
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
   un nom de fichier sur tous les systèmes.

   Un PDF dans une autre langue que le français porte son code entre
   parenthèses — « … (EN).pdf » — pour qu'on ne confonde pas, dans un
   dossier ou une pièce jointe, la version client et la version interne
   du même rapport. */
export function reportFilename(report, group, ext = 'pdf', lang = 'fr') {
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
  const suffix = ext === 'pdf' && lang && lang !== 'fr' ? ` (${String(lang).toUpperCase()})` : '';
  return (name || 'Rapport Qualité') + suffix + '.' + ext;
}

/* Ancien nom, conservé le temps que les appels existants migrent. */
export const pdfFilename = (report, group, lang) => reportFilename(report, group, 'pdf', lang);
