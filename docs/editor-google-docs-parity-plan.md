# Piano: comportamento dell’editor e fedeltà della copia verso Google Docs

Data: 5 ottobre 2026. Stato: esecuzione avviata; inventario, riferimento Docs e
primi trentaquattro gruppi di verifica e correzione registrati nella
[matrice di parità](editor-google-docs-parity-matrix.md). Il piano completo
rimane aperto; i casi verificati non certificano le fasi intere.
Priorità aggiornata il 4 ottobre: mantenere l'editor continuo, verificare
documenti misti e completare la fedeltà app → Docs e l'accettazione desktop.
Impaginazione e numeri di pagina sono rinviati a una fase successiva.

## Obiettivo e perimetro

L’obiettivo principale è consentire all’utente di **modificare la sbobina
nell’editor dell’app, copiarla e incollarla in Google Docs conservando contenuto,
struttura e formattazione, senza doverli correggere manualmente dopo l’incolla**.
Il comportamento delle funzioni correnti dell’editor deve avvicinarsi a quello
di Docs, così che le modifiche abbiano un risultato prevedibile anche dopo il
trasferimento. La fedeltà riguarda sia il documento intero sia le selezioni.

Per ogni funzione già presente nell’app si confrontano contenuto, formattazione,
selezione, posizione del cursore, stato dei controlli e cronologia con il
corrispondente comportamento di Docs. La somiglianza dei controlli o degli
screenshot da sola non chiude il requisito di copia e incolla.

Il percorso principale di accettazione è **apri → modifica nell’app → salva →
riapri → copia → incolla formattato in Docs → verifica → salva e riapri in Docs**.
Il percorso inverso Docs → app rimane nel perimetro già descritto dal piano,
come verifica complementare di compatibilità e del ciclo completo; non
sostituisce le prove del percorso app → Docs.

Il perimetro è quello precisato dall’utente: **le funzioni correnti dell’app**.
La richiesta successiva di **impaginazione e numeri di pagina** rimane
documentata nella Fase P, rinviata e fuori dai criteri di completamento del
lavoro corrente.
Non si aggiungono checklist, commenti, suggerimenti, collaborazione, nuovi font,
note a piè di pagina, intestazioni liberamente modificabili, righelli o altri
strumenti di Docs assenti dall’app. Non si aggiungono comandi di tabella solo
perché l’estensione sottostante li rende tecnicamente possibili.

L'editor mantiene il foglio continuo. La paginazione verrà rivalutata dopo
l'accettazione delle funzioni correnti e del trasferimento, con una scelta
tecnica che gestisca stabilmente tabelle e immagini wrap. Il prototipo creato
in questa chat è stato rimosso su richiesta dell'utente. Il perimetro futuro
della Fase P comprende fogli separati e numerazione automatica; restano esclusi
un secondo editor di intestazioni/piè di pagina, sezioni e interruzioni manuali.

Adattare l’interazione di un controllo esistente, per esempio la modifica di una
formula, fa parte del lavoro. Aggiungere una nuova famiglia di funzioni no.
Anche le funzioni accessibili tramite tastiera, contenuti importati o nodi già
supportati devono essere censite: la toolbar da sola non descrive tutto l’editor.

La parità non si dichiara sulla sola base di screenshot o payload validi. Una
differenza non verificata rimane aperta nella matrice di accettazione. Eventuali
funzioni prive di un equivalente in Docs vengono segnalate esplicitamente;
non si eliminano funzionalità dell’app per far apparire completo il confronto.

## Contratto di fedeltà app → Google Docs

La copia deve trasferire il significato e i valori degli stili che l’utente vede
e modifica nell’app. Applicare soltanto i default di Docs al contenuto copiato
non basta: font, dimensioni e altri stili esplicitamente scelti devono prevalere.
I default dell’app si allineano al riferimento osservato in Docs per i nuovi
contenuti, conservando la formattazione esplicita dei documenti esistenti.

| Aspetto | Risultato richiesto dopo l’incolla formattato |
| --- | --- |
| Contenuto e struttura | Testo completo, paragrafi, ritorni di riga, livelli dei titoli, elenchi e struttura delle tabelle conservati; nessun blocco aggiunto per simulare distanze |
| Caratteri | Font, dimensioni in punti, grassetto, corsivo, sottolineato, barrato, colori, evidenziature e link coerenti con la selezione copiata |
| Paragrafi ed elenchi | Allineamento, interlinea, spazio prima/dopo, rientri, livelli e numerazione conservati, evitando sia spazi gonfiati sia l’eliminazione delle distanze volute |
| Oggetti | Immagini con dimensioni, proporzioni, disposizione e didascalia verificate; tabelle con celle e larghezze conservate; formule editabili nei casi con equivalente Docs |
| Resa | A capo, distanze e geometria confrontati a parità di font disponibili e larghezza utile; confini e numero di pagine appartengono alla Fase P rinviata |
| Modificabilità e durata | Testo, titoli, liste, tabelle e formule supportate restano modificabili in Docs; gli stili verificati rimangono dopo salvataggio e riapertura |

Per ogni proprietà si distingue **valore trasferito**, **risultato visivo** e
**modificabilità**. Per esempio, una formula visivamente corretta trasformata
in immagine non supera il criterio di formula editabile; una lista con numeri
digitati come testo non supera quello di elenco numerato.

Il riferimento per la resa è un documento Docs sintetico con configurazione
registrata. I test comprendono anche incolla in un paragrafo già formattato,
in una lista e in una cella, per rilevare l’influenza del punto di inserimento.
L’incolla senza formattazione ha un contratto distinto e non viene usato per
dimostrare la fedeltà dell’incolla formattato.

Il formato del foglio e i margini del destinatario vengono registrati per
rendere confrontabili le misure; non si dichiara trasferimento automatico
delle impostazioni di pagina. Conservazione dei confini, conteggio e numeri
automatici saranno verificati nella Fase P, quando verrà ripresa.

Per ogni incompatibilità si registrano il contenuto coinvolto, la proprietà
alterata e il risultato effettivo. Un ripiego HTML che perde formattazione resta
una differenza aperta anche quando conserva tutto il testo. L’assenza di un
equivalente Docs non autorizza sostituzioni silenziose o la dichiarazione di
parità. La matrice deve rendere verificabile quanto del contratto è soddisfatto.

## Stato attuale verificato nel codice

| Area esistente | Implementazione attuale | Lavoro da delimitare |
| --- | --- | --- |
| Testo e cronologia | TipTap/ProseMirror, StarterKit, undo/redo, selezione personalizzata della parola | Enter, Shift+Enter, Backspace, Delete, selezione, focus e raggruppamento delle azioni |
| Formattazione dei caratteri | Grassetto, corsivo, sottolineato, barrato, colore, evidenziatura | Applicazione/rimozione, selezioni miste, formattazione del testo digitato dopo il comando |
| Font e dimensioni | Font correnti e selettori in `TypographySelects.tsx` | Valori visualizzati, unità, ereditarietà e stato della selezione; nessun ampliamento del catalogo |
| Paragrafi e titoli | `CustomParagraph`, `CustomHeading`, titoli 1–5 nella UI | Font, peso, interlinea, spazi, ritorno a testo normale e formattazione diretta |
| Allineamento | Sinistra, centro, destra, giustificato | Applicazione al paragrafo, selezioni multiple, paragrafi negli elenchi e nelle celle |
| Elenchi | Elenchi puntati/numerati di StarterKit, livelli annidati nel documento | Creazione, conversione, uscita, annidamento, numerazione, rientri e spaziatura |
| Formule | `MathInline`, `MathBlock`, KaTeX, modifica del sorgente LaTeX | Editing, cursore, conferma/annullamento, formule modificabili nel trasferimento |
| Immagini | `FloatingImage`, inline/wrap, posizione, dimensioni, proporzioni e didascalia | Ancoraggio, esclusione del testo, drag/resize, annulla/ripristina e copia |
| Link | Toolbar, menu contestuale e bubble menu | Inserimento, modifica, rimozione, selezione e comportamento del testo circostante |
| Citazioni | `blockquote` e relativo pulsante | Confrontare rientro e modifica con un equivalente Docs verificato |
| Tabelle già supportate | Estensioni Table/Row/Cell/Header; resize delle colonne; contenuti importati | Soltanto operazioni già raggiungibili: editing, tastiera, selezione, resize e conservazione della struttura |
| Trova e sostituisci | Ricerca letterale, distinzione maiuscole/minuscole, navigazione, sostituzione singola/totale | Conteggio, selezione, formattazione attraversata, focus e cronologia |
| Indice e zoom | Indice dei titoli, navigazione e zoom della pagina | Titoli rilevati, navigazione, focus e stabilità del contenuto durante lo zoom |
| Conversioni automatiche | Typography e SmartArrows | Trasformazioni già attive, attivazione da tastiera e annullamento |
| Copia, taglia e incolla | HTML portabile, testo semplice e adattatore nativo Docs | Parità fra percorsi, selezioni parziali e trasferimento bidirezionale |
| Video YouTube | Inserimento di un embed tramite URL | Verificare quale equivalente esiste in Docs; nessuna equivalenza presunta con un semplice link |

Capacità rinviata: `RichTextEditor.tsx` contiene oggi un unico `EditorContent`
in `.editor-page`; il CSS imposta larghezza di 794 px e altezza minima del testo,
senza limite di altezza, distribuzione su fogli o numeri di pagina.
L'impaginazione è una nuova capacità rinviata. Il foglio continuo resta
il riferimento per il lavoro corrente sulle funzioni esistenti.

Sono presenti anche nodi/mark non esposti dai pulsanti principali, per esempio
apice/pedice, blocchi di codice e titoli importati. La fase iniziale distingue
quelli effettivamente utilizzabili da quelli soltanto registrati nello schema.
Si conserva il supporto esistente senza introdurre nuovi strumenti visibili.

Differenze già accertate, da non trattare come semplici modifiche CSS:

- “Rimuovi formattazione” usava comandi discordanti. Il secondo gruppo usa
  `clearDocumentFormatting` nei tre controlli e da tastiera: conserva struttura
  e link e permette undo. Il terzo gruppo conserva allineamento, interlinea e
  margini nelle selezioni parziali e con il solo cursore; li ripristina solo
  quando è selezionato tutto il testo del blocco. I casi sono confrontati in
  Docs, inclusa la digitazione successiva e la selezione su tre paragrafi.
- L’incolla formattata eliminava colore, evidenziatura e dimensioni dei titoli.
  La prima correzione conserva questi stili; restano da verificare tutti gli
  attributi delle strutture importate nel ciclo completo.
- La formula inline è un nodo atomico che apre un input LaTeX; la formula a
  blocco apre una textarea. Docs permette editing dentro l’equazione.
  Il quarto gruppo corregge il trasferimento delle funzioni nominate e dei
  limiti degli operatori: nove equazioni mantengono 26 comandi nativi dopo
  riapertura. Una modifica da tastiera dell’argomento di `sin x`, seguita da
  due annullamenti, è verificata in Docs. Questo non chiude l’editing atomico
  nell’app né le formule non rappresentabili, fra cui le matrici.
- La ricerca esaminava separatamente i nodi di testo: il primo gruppo di
  correzioni cerca ora attraverso mark contigui senza attraversare paragrafi
  o oggetti. Focus, selezione e sostituzione rimangono aperti.
- Il secondo gruppo allinea peso, colori, dimensioni, interlinea e spazi dei
  titoli 1–5/paragrafi al riferimento osservato, verificandoli dopo incolla
  nativo e riapertura. Corregge colore insieme a evidenziatura e conserva stili
  diretti del blocco. Rientri degli elenchi, citazioni, selezioni miste e resa
  geometrica richiedono ancora confronto.
- Il quinto gruppo conserva marcatori alfabetici/romani importati, numero
  iniziale e tre livelli nelle copie native. I paragrafi di continuazione non
  ricevono nuovi marcatori. Rientro del testo 36 pt per livello e attributi
  `start`/`type` sono conservati anche nella preparazione/salvataggio HTML.
  Ventuno paragrafi sono riletti in Docs dopo incolla e riapertura. Il percorso
  HTML puro unisce paragrafi della voce e numera la continuazione dopo una
  sottolista; resta aperto con il ciclo dei marcatori delle nuove liste,
  selezioni parziali, divisioni/unioni e percorso inverso completo.
- Il sesto gruppo corregge i marcatori delle liste figlie create con Tab:
  numeri, lettere minuscole e numeri romani minuscoli, conservando i tipi e
  gli inizi delle liste importate già esistenti. Tab dentro il testo inserisce
  una tabulazione, con un solo undo e persistenza HTML in liste numerate/puntate.
  La copia delle ultime voci conserva il numero effettivo; la copia di solo
  testo dentro un paragrafo non aggiunge un elenco o un'interruzione. Quattro
  paragrafi su tre livelli, la selezione E–F e una parola incollata dentro un
  paragrafo sono verificati in Docs anche dopo riapertura. Il testo semplice
  non aggiunge più righe vuote fra voci, sottoliste e continuazioni. La differenza
  di Backspace allora rilevata è corretta nei casi di LIST-07: voci composte
  soltanto da paragrafi/titoli, conservazione del rientro e numerazione successiva.
  Selezioni attraverso livelli misti, annidamento della prima voce, divisioni/
  unioni generali, geometria dei tab stop e percorso inverso restano aperti.
- Il settimo gruppo rimuove il marcatore con Backspace all'inizio della voce
  mantenendo il testo separato e la posizione orizzontale. La lista viene
  separata intorno ai paragrafi della voce: il frammento successivo conserva
  tipo e inizio, senza contare il marcatore rimosso. Nel livello annidato il testo
  rimane una continuazione non numerata, con 36 pt di margine aggiuntivo rispetto
  alla voce madre. Il margine è serializzato, riletto e trasferito nel formato
  nativo. Due corpus, con tre e cinque paragrafi, mantengono rientri 36/72 pt,
  interlinea 1,15, marcatori D–E e d–e dopo incolla e riapertura in Docs.
  Undo/redo e stabilità orizzontale sono verificati nel browser. Voci con
  sottoliste/altri blocchi, Delete,
  annidamento della prima voce, selezioni miste e split/merge generale restano
  aperti. Il comando nuovo si limita ai paragrafi/titoli e non riscrive gli
  oggetti delle voci complesse.
- L'ottavo gruppo completa il secondo Backspace sul paragrafo senza marcatore:
  azzera il rientro complessivo a 0 pt senza unire il testo, conservando i mark,
  gli altri stili e le voci circostanti. Le continuazioni annidate restano nella
  voce madre; il margine compensa i rientri dei contenitori. Il browser verifica
  posizione, digitazione successiva, un undo/redo e rilettura HTML. Quattro/sei
  paragrafi conservano rientri, livelli, interlinea 1,15, grassetto e D–E dopo
  incolla e riapertura in Docs. Il terzo Backspace e le voci con altri blocchi
  restavano aperti alla consegna. I dettagli e le prove sono registrati in LIST-08.
- Il nono gruppo completa il terzo Backspace nei casi di LIST-09: dopo
  l'azzeramento del rientro, il testo si unisce al testo precedente, anche
  all'ultima voce della lista figlia. Il caret rimane al punto di unione;
  i mark e le continuazioni successive si conservano. Un undo annulla soltanto
  la fusione, e la digitazione immediata ha una cronologia separata. Tre/cinque
  paragrafi mantengono testo, grassetto, rientri, interlinea, marcatori D–E e
  livelli dopo incolla nativo e riapertura in Docs. Alla consegna restavano
  aperti Delete, voci con altri blocchi, fusioni generali e ripiego HTML in Docs.
- Il decimo gruppo corregge la cronologia di Canc alla fine di una voce,
  quando la successiva appartiene alla stessa lista ed entrambe contengono
  soltanto paragrafi. La fusione conserva mark, caret, continuazioni e numeri;
  un undo annulla solo la fusione, anche dopo aver digitato, e la digitazione
  successiva ha un undo separato. Tre/cinque paragrafi mantengono testo,
  grassetto, rientri, interlinea 1,15, marcatori 1–2/a–b e livelli dopo
  incolla nativo e riapertura in Docs. I dettagli sono in LIST-10; Canc fra
  livelli diversi, oggetti, titoli, fusioni generali e ripiego HTML restavano aperti.
- L'undicesimo gruppo corregge Canc da un paragrafo alla prima figlia e
  dall'ultima figlia alla voce principale successiva; estende il confine di
  cronologia alla fusione con una voce che contiene una sottolista di paragrafi.
  I testi si uniscono al caret, con mark conservati, una sola azione di undo e
  digitazione separata. Nei tre corpus Docs, 6/6/4 paragrafi conservano testo,
  grassetto per carattere, livelli, rientri 36/72 pt e interlinea 1,15 dopo
  incolla degli appunti del browser dell'app e riapertura. I marcatori visuali
  coincidono: 1–3/a–b, 1–2/a–d e 1–2/a–b. LIST-11 delimita i casi: attraversamenti
  di più livelli, sottoliste ramificate nel primo figlio, liste con attributi
  discordanti, oggetti, titoli e fusioni generali rimangono aperti.
- Il dodicesimo gruppo corregge il primo Backspace su una voce con sottolista,
  quando la voce precedente contiene soltanto paragrafi/titoli. Rimuove solo
  il marcatore, mantiene separati i testi e conserva posizione e livelli delle
  figlie. Il caret resta all'inizio del paragrafo; rimozione e digitazione hanno
  undo distinti. I corpus al primo livello e annidato, cinque/sette paragrafi,
  coincidono con il gesto Docs e dopo incolla nativo, salvataggio e riapertura
  per testo, grassetto, livelli, rientri e interlinea 1,15. LIST-12 documenta le
  prove; alla consegna restavano aperti prima voce, precedente con
  sottolista/oggetti, combinazioni più ampie e ripiego HTML.
- Il tredicesimo gruppo copre il primo Backspace fra due voci che contengono
  ciascuna un paragrafo e una sottolista dello stesso tipo/attributi, con figlie
  di soli paragrafi/titoli. Il marcatore di `Seconda` scompare, tutti i paragrafi
  restano nella stessa posizione e le figlie proseguono la numerazione:
  a/b poi c/d al primo livello, i/ii poi iii/iv nel ramo annidato. Caret,
  grassetto, undo separati e riapertura HTML sono verificati. Sette/nove
  paragrafi coincidono con il gesto Docs e dopo incolla nativo, salvataggio
  e riapertura per testo, grassetto, rientri, livelli, interlinea 1,15 e numero
  effettivo dei marcatori. LIST-13 delimita il percorso: attributi discordanti,
  più rami per voce, oggetti e combinazioni più ampie restano aperti. LIST-14
  copre successivamente il caso delimitato della prima voce con sottolista.
- Il quattordicesimo gruppo copre il primo Backspace sulla prima voce con un
  paragrafo iniziale e una sottolista di voci di soli paragrafi/titoli. Il testo
  perde il marcatore senza spostarsi; figlie e livelli rimangono. La successiva
  `Seconda` conserva 2 al primo livello e b nel ramo annidato. Un attributo
  della voce conserva il ramo senza marcatore nell'HTML salvato e nella
  preview; gli appunti nativi conservano rientro e numero iniziale restante.
  Quattro/sei paragrafi coincidono con il gesto Docs, dopo incolla e riapertura,
  per testo, grassetto, livelli, rientri, interlinea 1,15 e marcatori effettivi.
  Caret, geometria, undo separati e riapertura HTML sono verificati. LIST-14
  non certifica gesti successivi, oggetti, più rami o stili diretti combinati.
- Il quindicesimo gruppo verifica il secondo Backspace sulla stessa prima voce
  senza marcatore. Il rientro di `Prima` passa da 36/72 pt a zero, conservando
  figlie, livelli e successiva numerazione 2/b. La correzione separa nella
  cronologia l'azzeramento dalla digitazione immediata: annullare il carattere
  non ripristina anche il rientro. Quattro/sei paragrafi coincidono con Docs
  dopo incolla e riapertura per testo, grassetto, livelli, rientri, interlinea
  e marcatori effettivi. LIST-15 lascia aperta la fusione al terzo Backspace
  nel ramo annidato: Docs unisce `Madre` e `Prima` conservando figlie i/ii e b.
- Il sedicesimo gruppo chiude quella fusione nei due corpus di paragrafi:
  al primo livello il terzo Backspace non modifica il documento; nel ramo
  annidato unisce `MadrePrima`, conserva il grassetto di `Prima`, figlie i/ii
  e successiva b. Il contenitore senza marcatore conserva soltanto la
  sottolista, senza introdurre un paragrafo vuoto salvato o copiato. Caret
  al punto di unione, undo separato, geometria e riapertura HTML sono verificati.
  Quattro/cinque paragrafi coincidono con Docs dopo incolla e riapertura per
  testo, grassetto, livelli, rientri, interlinea e marcatori effettivi. LIST-16
  non chiude gli altri confini, gesti successivi sulle figlie, titoli, oggetti,
  più rami, stili combinati, ripiego HTML o accettazione nelle build desktop.
- Il diciassettesimo gruppo verifica sei Backspace successivi sulle due figlie
  dei corpus di LIST-16, al primo livello e nel ramo annidato. La rimozione
  del marcatore conserva il rientro; il gesto seguente lo azzera e il terzo
  unisce il testo precedente. Quando viene rimosso il marcatore dell'ultima
  figlia, il contenitore senza sottolista viene sciolto: Seconda passa da 2 a 1
  oppure da b ad a, come in Docs. La rimozione e le fusioni separano l'undo
  dalla digitazione. Dodici stati degli appunti coincidono con Docs; i due
  risultati finali coincidono anche dopo incolla, salvataggio e riapertura.
  Il gruppo non certifica altre strutture, più rami, titoli, oggetti o le
  build desktop; LIST-01 e la fase 3 restano aperti.
- Il diciottesimo gruppo verifica Enter all'inizio, a metà e alla fine del
  paragrafo di una voce con una sottolista di paragrafi, root/annidato. La
  divisione standard conserva già le figlie sulla seconda voce; la correzione
  separa l'undo di Enter dalla digitazione immediatamente successiva. Dodici
  regressioni DOM coprono elenchi puntati/numerati; sei casi Chromium conservano
  caret, grassetto, geometria e HTML. Tutti e sei coincidono con Docs anche dopo
  incolla e riapertura per le proprietà campionate, comprese le voci vuote
  numerate. Titoli, oggetti, selezioni estese, contenitori senza marcatore e
  altre topologie restano aperti; LIST-01 e la fase 3 non sono chiusi.
- Il diciannovesimo gruppo corregge Enter sulla voce vuota prodotta dalla
  divisione all'inizio/alla fine nei corpus di LIST-18. Al primo livello la
  riga perde il marcatore e passa a rientro zero; nel ramo annidato diventa
  una voce del livello superiore. Le figlie conservano profondità e rientri;
  Seconda torna a 2/b e Ultima diventa 3 nel corpus annidato. Otto regressioni
  DOM e quattro casi Chromium verificano caret, geometria, undo separati e
  riapertura HTML. Tutti e quattro coincidono con Docs dopo incolla e
  riapertura per testo esistente, grassetto per carattere, livelli, rientri,
  interlinea e numerazione. La formattazione della riga vuota rimane distinta:
  tornando col caret dopo riapertura, X è normale nell'app e grassetto in Docs
  nel campione root/inizio. MARK-EMPTY-01 registra questa differenza, poi corretta
  nel gruppo 20 per i quattro corpus;
  LIST-19 non chiude la parità generale di Enter o degli elenchi.
- Il ventesimo gruppo conserva il grassetto della riga vuota generata dai due
  Enter di LIST-18/19: primi livelli e rami annidati, inizio e fine. Lo stile
  viene salvato come metadato del paragrafo, senza caratteri segnaposto,
  ripristinato tornando col caret e applicato alla newline della copia nativa.
  Autosave, chiusura e riapertura dell'app, digitazione di X, undo/redo e
  disattivazione/cancellazione del grassetto sono verificati. Il ciclo ha
  rilevato anche un getter dell'autosave rimasto legato a un'istanza precedente:
  ora viene pubblicato dall'editor attivo. Tutti e quattro i corpus coincidono
  con Docs dopo incolla, salvataggio, riapertura, ricopia e digitazione di X.
  Il confronto esclude le righe vuote finali del documento destinatario.
  MARK-EMPTY-01 è corretto nel perimetro campionato; la parità di altri stili,
  gesti, topologie e build desktop resta aperta.
- Il ventunesimo gruppo estende i quattro corpus di LIST-19 a grassetto,
  corsivo, sottolineato, barrato, Georgia 18 pt, colore #123abc ed evidenziatura
  #ffee00 combinati. Corregge l'altezza della riga vuota nell'editor: le
  decorazioni usano le metriche salvate prima della digitazione, senza
  aggiungere stili di paragrafo all'HTML o dipingere uno sfondo largo tutta la
  riga. Corregge inoltre la copia nativa delle decorazioni annidate: un
  sottolineato interno non elimina il barrato dell'antenato. Nove regressioni
  DOM sulle righe vuote e quattro sulla copia, ciclo browser con autosave e
  due riaperture per corpus, geometria ferma digitando X e undo/redo verificati.
  Tutte e quattro le fonti coincidono con Docs prima/dopo digitazione e dopo
  incolla, riapertura, ricopia e digitazione in Docs. La lettura API conferma
  testo e stili salvati. Il rientro e la numerazione restano quelli di LIST-19.
  La suite Chromium passa 36/36 e il gate completo 1.243 test frontend.
  MARK-EMPTY-02 e CLIP-MARK-01 sono corretti nel perimetro campionato; ritorno
  del caret verificato via click, altre navigazioni/topologie, formati di
  ripiego, percorso inverso e build desktop restano aperti.
- Il ventiduesimo gruppo verifica il ritorno sulle righe vuote di LIST-19 con
  ArrowUp/ArrowDown e gli stili combinati di MARK-EMPTY-02, dopo autosave e
  riapertura. Sette percorsi Chromium conservano caret, otto attributi di X,
  geometria, HTML e undo/redo; ArrowUp funziona anche tra i due Enter iniziali.
  Quattordici percorsi Docs, su quattro riferimenti del gruppo 21 e quattro
  nuove copie native, coincidono dopo salvataggio delle righe ancora vuote,
  reload, ritorno da tastiera e digitazione. Nuova riapertura e ricopia dei
  risultati digitati confermano la durata; lettura API degli otto tab verifica
  gli stili salvati. Nessun nuovo difetto nel perimetro campionato: estesi il
  test browser e la matrice, senza modifiche al comportamento dell'editor.
  NAV-EMPTY-01 non certifica selezioni estese, righe a capo, altri font,
  topologie, oggetti o build desktop. Gate completo e suite browser 36/36 passati.
- Il ventitreesimo gruppo verifica Shift+Enter a metà e alla fine di un
  paragrafo normale, di una voce numerata e di una voce numerata annidata,
  con gli stili combinati del gruppo 21. Corregge lo stile del ritorno di riga:
  il motore conservava i mark per la digitazione successiva, ma inseriva un
  hardBreak senza mark, copiato come Arial 11 pt normale. Ora il ritorno stesso
  conserva i mark consentiti, nell'HTML salvato e negli appunti nativi.
  Sei regressioni DOM falliscono prima della correzione e passano dopo; sei
  cicli browser verificano caret, un solo paragrafo/voce, autosave, riapertura
  e undo/redo. Nei sei riferimenti Docs l'undo immediato annulla insieme
  Shift+Enter e X, come nell'app. Tutte le sei copie coincidono semanticamente
  dopo incolla e riapertura; l'API conferma gli stili del ritorno e di X nei
  dodici campioni. TEXT-SOFT-01 non certifica inizio paragrafo, selezioni,
  titoli, oggetti, righe consecutive, vecchi ritorni non formattati o build
  desktop. Gate completo e suite browser 37/37 passati.
- Il ventiquattresimo gruppo estende Shift+Enter all'inizio e a due ritorni
  consecutivi all'inizio, a metà e alla fine degli stessi tre blocchi.
  Corregge l'ereditarietà al caret iniziale: senza storedMarks espliciti,
  il ritorno e la digitazione successiva ora usano i mark del primo carattere.
  Gli storedMarks espliciti, compreso l'insieme vuoto, hanno precedenza.
  Sei regressioni riproducono la perdita; diciotto casi DOM e diciotto cicli
  Chromium passano, con due controlli DOM aggiuntivi sui mark espliciti.
  Dodici nuovi riferimenti e dodici copie native coincidono per testo,
  stili per carattere, livelli, rientri, interlinea e numerazione dopo
  incolla e riapertura in una nuova scheda Docs. Undo immediato annulla
  insieme ritorni e X, redo li ripristina; API dei ventiquattro tab conferma
  gli stili salvati dei ritorni e di X. TEXT-SOFT-02 lascia aperti selezioni,
  altri blocchi/font, cancellazione ai confini, ritorni storici privi di mark,
  ripiego HTML, percorso inverso e build desktop. Gate completo e suite
  browser 37/37 passati; impaginazione e numeri di pagina rimangono aperti.
- Il venticinquesimo gruppo verifica Shift+Enter su una selezione interna a
  paragrafo, voce numerata root e voce annidata. Tre profili per struttura:
  selezione uniforme, mista e con inizio al confine tra testo formattato e
  testo normale. Corregge quest'ultimo caso: ritorno e X ereditavano i mark
  del carattere precedente, mentre Docs usa il primo carattere selezionato.
  La scelta dei mark per una selezione nello stesso blocco ora segue quel
  carattere, conservando la precedenza degli storedMarks espliciti.
  Tre regressioni falliscono prima della correzione; nove casi DOM e nove
  cicli browser verificano contenuto, caret, cronologia, autosave, riapertura
  e copia. I nove riferimenti Docs e le nove copie coincidono per testo,
  otto stili per carattere, livelli, rientri, interlinea e numerazione anche
  dopo riapertura in una nuova scheda; API dei 18 tab conferma gli stili
  salvati di ritorno e X. TEXT-SOFT-03 lascia aperti selezioni inverse,
  estese su piu blocchi, titoli/oggetti/celle, altre combinazioni di font e
  stili, ripiego HTML, percorso inverso e build desktop. Gate completo e
  suite browser 38/38 passati; impaginazione e numeri di pagina aperti.
- Il ventiseiesimo gruppo estende Shift+Enter a selezioni inverse con stile
  uniforme, misto e inizio al confine degli stili, oltre a una selezione dal
  primo carattere e all'intero testo del blocco, senza terminatore di paragrafo.
  Quindici nuovi casi coprono paragrafo e voci numerate root/annidate; tutti
  concordano con Docs senza nuove correzioni al comportamento dell'editor.
  Le prove DOM e Chromium includono ora anche i nove casi del gruppo 25:
  direzione anchor/head, caret, stili, struttura, undo/redo, autosave,
  riapertura e copia. Quindici riferimenti e quindici copie coincidono dopo
  incolla e riapertura in una nuova scheda Docs per testo, otto stili per
  carattere, livelli, rientri, interlinea e numerazione. API dei trenta tab
  conferma gli stili salvati dell'intero blocco modificato, ritorno e X inclusi.
  TEXT-SOFT-04 lascia aperti range su più blocchi o con terminatori/oggetti,
  altri blocchi/font/stili, cancellazione e navigazione ai confini, HTML,
  percorso inverso e build desktop. Passano 65 test DOM mirati, gate con
  1.287 test frontend, suite browser 38/38, build separata e diff check.
  Impaginazione e numeri di pagina rimangono aperti.
- Il ventisettesimo gruppo completa il corpus delle selezioni inverse nello
  stesso blocco con sei nuovi casi: Pri dal primo carattere e tutto Prima,
  escludendo il terminatore, in paragrafo e voci numerate root/annidate.
  Nessun nuovo difetto: ritorno e X seguono lo stile del primo carattere
  selezionato anche con anchor maggiore di head; il testo residuo mantiene
  i propri stili. Test DOM e Chromium coprono ora trenta combinazioni.
  Sei riferimenti e sei copie coincidono dopo incolla e riapertura in una
  nuova scheda Docs per testo, otto stili per carattere, livelli, rientri,
  interlinea e numerazione. La lettura API verifica tutti i caratteri e il
  layout dei paragrafi nei dodici tab. TEXT-SOFT-05 lascia aperti multiblocco,
  terminatori/ritorni/oggetti selezionati, altri blocchi/font/stili, HTML,
  percorso inverso e desktop. Passano 71 test DOM mirati, gate con 1.293
  test frontend, suite browser 38/38, build separata e diff check.
  Impaginazione e numeri di pagina rimangono aperti.
- Il ventottesimo gruppo verifica sei selezioni che attraversano un ritorno
  interno già presente: r + ritorno + i in Pr + ritorno + ima, in avanti e
  all'indietro, per paragrafo e voci numerate root/annidate. Nessun nuovo
  difetto: Shift+Enter e X producono P + ritorno + Xma; ritorno e X ereditano
  gli otto stili di r, ma resta normale. DOM e Chromium coprono ora 36
  combinazioni, incluse cronologia, autosave, riapertura e copia.
  Sei riferimenti e sei copie coincidono dopo incolla e riapertura Docs per
  testo, stili di ogni carattere, livelli, rientri, interlinea e numerazione;
  API dei dodici tab conferma tutti i caratteri e il layout dei paragrafi.
  TEXT-SOFT-06 lascia aperti altri range comprendenti ritorni, terminatori,
  oggetti, multiblocco, altri blocchi/font/stili, HTML, percorso inverso e
  desktop. Passano 73 test DOM mirati, gate con 1.299 test frontend,
  suite browser 38/38, build separata e diff check. Impaginazione e numeri
  di pagina rimangono aperti.
- Il ventinovesimo gruppo verifica sei selezioni che iniziano con un ritorno
  interno: ritorno + i in Pr + ritorno + ima, in avanti e all'indietro,
  per paragrafo e voci numerate root/annidate. Nessun nuovo difetto:
  Shift+Enter e X producono Pr + ritorno + Xma; ritorno e X ereditano gli
  otto stili del ritorno selezionato, ma resta normale. DOM e Chromium
  coprono ora 42 combinazioni, incluse cronologia, autosave e riapertura.
  Sei riferimenti e sei copie coincidono dopo incolla e riapertura Docs;
  API dei dodici tab conferma ogni carattere e il layout dei paragrafi.
  TEXT-SOFT-07 lascia aperti ritorno isolato, più ritorni, stili del ritorno
  indipendenti dai vicini, multiblocco, terminatori/oggetti, altri blocchi,
  HTML, percorso inverso e desktop. Passano 79 test DOM mirati, gate con
  1.305 test frontend, suite browser 38/38, build separata e diff check.
  Impaginazione e numeri di pagina rimangono aperti.

- Il trentesimo gruppo avvia i documenti misti rappresentativi: titoli, mark,
  ritorno interno, link, lista D/E con figlia b, tabella 3×2 con colonne
  210/390 px e cella unita, immagine inline 222×148 px e frazione con apice.
  Il ciclo modifica → salva → riapri ha trovato due perdite nella
  normalizzazione della preview: rimozione di interlinea/spazi e degli
  attributi sorgente delle formule. Corretto `previewHtml.ts`, con regressioni
  di interlinea nativa e formule inline/blocco nello schema reale. Chromium
  verifica modifica di una cella, undo/redo, taglio/undo, riapertura e copia da
  tastiera/pulsante. In Docs dopo riapertura coincidono testo, 18 campioni di
  stile, livelli D/b/E, larghezze, cinque celle visibili, immagine e comandi
  della formula; API conferma tabella, oggetto inline, link e formula nativa.
  MIX-04/SAVE-01 non certificano wrap/didascalie, ripiego HTML, selezioni miste
  o desktop. Gate passato con 1.308 test frontend, suite browser 39/39 e build
  separata; coperture backend 88,26%, frontend linee 85,46%, branch 76,06%,
  funzioni 79,78%. Nessun commit, push o release.

- Il trentunesimo gruppo amplia il documento misto con wrap destra, didascalia
  sinistra nativa e didascalia destra con ripiego HTML. Docs rifiutava il
  salvataggio della tabella dati seguita dal gruppo con didascalia: il formato
  nativo emetteva due tabelle adiacenti senza paragrafo separatore. Corretto
  l'adattatore, con due regressioni e nuovo ciclo Chromium sui tre casi.
  Il caso corretto si salva e dopo riapertura coincidono testo, 19 campioni
  di stile, lista, celle/larghezze, immagine e formula nativa. Il wrap senza
  didascalia conserva anche coordinate e margini dell'immagine. Nel caso HTML
  Docs salva ma rende l'immagine inline, importa interlinea 1,38 anziché 1,15,
  perde i comandi della frazione e restituisce testo «yx2»; la seconda colonna
  diventa 291,75 anziché 292,5 pt. I bordi delle celle HTML rimangono 0,75 pt.
  MIX-05/MIX-06 non chiudono la fedeltà geometrica delle didascalie: offset Y
  18 px rimane nell'app ma non viene tradotto nella tabella flottante nativa.
  Passano 144 test mirati, gate con 1.310 test frontend, suite browser 40/40
  e build separata. Restano aperti HTML, selezioni miste e desktop.
  Nessun commit/push/release.

- Il trentaduesimo gruppo corregge l'emissione dell'offset Y delle didascalie
  wrap e un ciclo del layout con offset negativo: spostare la tabella precedente
  spostava anche l'ancora dell'immagine, producendo spazi enormi e bloccando
  la digitazione. Il wrap ora esclude le collisioni con blocchi precedenti
  all'ancora, che non possono essere risolte spostando quei blocchi.
  Sei nuove regressioni DOM e il ciclo Chromium esteso a cinque configurazioni
  verificano conversione px/pt, stabilita' del layout, cronologia e riapertura.
  Docs azzera Y durante l'incolla anche nella ricopia di una sua tabella
  modificata direttamente: +13,5 e -15 pt diventano zero, mentre il controllo
  zero conserva tutte le proprieta' confrontate. Contenuto, stili, liste,
  celle/larghezze, immagine e formula persistono in tutti e tre i casi app.
  La geometria delle didascalie rimane aperta; il payload corretto da solo
  non risolve il comportamento del destinatario. Passano 150 test mirati,
  gate con 1.316 test frontend, suite browser 40/40 e build separata.
  Il prossimo lavoro deve verificare una rappresentazione alternativa del
  gruppo immagine/didascalia prima di ampliare il percorso a destra che
  impone HTML. Nessun commit/push/release.

- Il trentatreesimo gruppo verifica rappresentazioni alternative della didascalia
  senza cambiare il codice dell'app. La ricopia della tabella impostata da Docs
  su «Fix on page» modifica Y da circa 386,021 a 92 pt. Padding della cella e
  spazio prima del paragrafo immagine conservano invece 13,5/90 pt e il contenuto
  modificabile dopo incolla, salvataggio e riapertura. Le misure a 120 px
  mostrano pero' un wrap diverso: l'immagine raggiunge la stessa quota del
  riferimento spostato nativamente, ma le righe sopra la figura rimangono
  respinte a destra. Queste alternative non vengono applicate all'adattatore.
  MIX-08 registra prove e controesempio geometrico; Y non nullo rimane aperto.
  La lettura API conferma che gli altri 66 tab sono invariati, escludendo solo
  gli URL temporanei di consegna delle immagini. Prossimo caso: verificare
  allineamento nativo a destra con Y zero per evitare il ripiego HTML, mantenendo
  separata la posizione verticale non risolta. Nessun commit/push/release.

- L’adattatore nativo di copia traduce già interlinea e origine dei margini delle
  immagini, ma non costituisce una soluzione completa per il percorso inverso.
- `createNativeClipboardFormats` restituisce `null` per alcuni contenuti, fra
  cui formule non rappresentabili, video e specifiche immagini wrap con
  didascalia; il percorso di copia ripiega sull’HTML per l’intero frammento.
  Il secondo gruppo verifica il caso matrice: elimina markup KaTeX visibile e
  duplicazione delle formule, ma il ripiego conserva interlinea nativa 1,38
  invece di 1,15 e appiattisce le formule. Sono incompatibilità aperte; immagini
  con didascalia sono misurate nel gruppo 31; i video restano da misurare.

- Il trentaquattresimo gruppo misura il wrap con didascalia a destra e Y zero,
  senza cambiare l'app. Il riferimento creato nelle opzioni native Docs conserva
  X 284,315 pt dopo salvataggio e riapertura; ricopia/incolla azzera X anche
  conservando l'allineamento destro. Un prototipo con `tbls_al: 2` e `hp_a: 2`
  conserva i flag e gli stili ma lascia la figura a sinistra. Le PNG misurano
  378 px di differenza orizzontale e il testo passa dal lato sinistro al destro.
  MIX-09 registra questo controesempio: il flag di allineamento non risolve
  MIX-06, e il controllo del destinatario non diventa una nuova prova app -> Docs.
  Formula, stili, tabelle e liste D/b/E rimangono nel campione; gli altri 66 tab
  sono invariati, esclusi gli URL temporanei delle immagini. Prossimo caso:
  verificare l'interlinea nel ripiego HTML sullo stesso documento misto, nelle
  destinazioni con interlinea 1,15 e 2, prima di adottare una conversione.
  Posizioni delle didascalie, formule HTML e desktop restano aperti.
  Nessun commit/push/release.

Questi sono punti di partenza verificati nel sorgente. Gli altri scostamenti
devono essere misurati nella fase 0 prima di essere chiamati bug di parità.

## Impostazione tecnica

Si mantiene inizialmente TipTap/ProseMirror. Si estendono i punti necessari;
non si cambia motore né si riscrive l’editor in anticipo rispetto alle prove.

Tre responsabilità devono restare distinte e coerenti:

1. **Modello del documento:** struttura, mark, attributi e significato delle unità.
2. **Comandi di editing:** cosa cambia nel documento, nel cursore e nella cronologia.
3. **Resa e trasferimento:** CSS dell’app, HTML salvato/portabile e formato Docs.

Google Docs diventa il riferimento dei valori e delle interazioni. Il profilo
comune esistente viene completato dove necessario, evitando regole duplicate
nei componenti e valori aggiustati per singoli documenti di prova.

Ogni fase comprende la conversione e la prova app → Docs delle proprietà che
modifica. Si confrontano insieme modello del documento, resa nell’app, HTML
portabile e risultato in Docs: correggere soltanto uno di questi livelli può
lasciare invariata o introdurre una differenza al momento dell’incolla.

## Fase 0 — Inventario definitivo e riferimento misurabile

**Interventi**

- Congelare l’inventario delle funzioni correnti e dei percorsi che le attivano:
  toolbar, menu contestuale, bubble menu, tastiera e contenuti importati.
- Creare una matrice con ID del caso, azioni, documento iniziale, risultato in
  Docs, risultato nell’app, differenza, file interessati e stato. Per il
  trasferimento registrare inoltre selezione copiata, comando di copia, formato
  effettivamente trasferito, punto di inserimento in Docs, proprietà attese e
  osservate, prova dopo riapertura, ambiente e collegamento alle evidenze.
- Usare stati distinti: da verificare, differenza riprodotta, verificato in
  browser, verificato nella build desktop, incompatibilità aperta. Una prova
  del payload non equivale a incolla verificato; una prova browser non chiude
  automaticamente quella desktop.
- Partire da una sbobina rappresentativa modificata nell’app: testo, titoli,
  stili misti, liste, tabella, immagine e formula. Affiancare casi isolati per
  diagnosticare le differenze e casi con un oggetto non rappresentabile per
  verificare il ripiego dell’intero frammento.
- Usare documenti sintetici privati, separati dai documenti dell’utente.
  Un documento Docs già modificato con l’incolla non è prova dei default di Docs.
- Registrare piattaforma, lingua/tastiera, font disponibili, zoom, larghezza
  utile, formato del foglio, margini e modalità di documento. Usare il formato
  con pagine di Docs come riferimento per la copia e registrarne formato e
  margini, senza presumere i default dell'utente. Nel lavoro corrente l'app
  resta continua: il confronto dei punti di cambio pagina è rinviato alla Fase P.
- Rilevare sia le proprietà persistenti sia il comportamento con gesti reali:
  caret, selezione, menu attivo e undo/redo.
- Verificare equivalenti effettivi per citazioni, video e strutture matematiche
  particolari. Se mancano, aprire una voce di incompatibilità specifica.

**Consegna:** matrice di parità e corpus ripetibile di documenti/gesti.

**Criterio di chiusura:** ogni funzione corrente è coperta da casi verificabili;
impaginazione e numerazione sono registrate come capacità rinviate;
nessun’altra nuova funzione è stata inclusa implicitamente.

## Fase 1 — Profilo del documento e comandi comuni

**Interventi**

- Completare `document_formatting.json` e `documentFormatting.ts` con valori
  osservati in Docs per le strutture correnti: titoli, testo, liste, citazioni,
  celle, immagini e didascalie.
- Rappresentare esplicitamente il significato dell’interlinea, dei rientri e
  delle distanze; distinguere punti, pixel e multipli della riga normale.
- Separare valori predefiniti e formattazione diretta. Un default nuovo non
  deve cancellare il font o lo stile esplicitamente scelto nel documento.
- Eliminare le interferenze del CSS Typography sui valori del documento;
  completare anche il CSS backend e la preparazione HTML portabile.
- Centralizzare i comandi duplicati in un modulo di funzioni condivise,
  utilizzato dai controlli esistenti. Evitare un framework generico di comandi.
- Definire con prove Docs la semantica di “Rimuovi formattazione” su testo,
  titoli, liste, link e formule; applicare la stessa semantica in ogni percorso.
- Derivare lo stato dei controlli dalla selezione, anche quando è mista;
  preservare selezione e focus durante l’uso dei popup.
- Fare in modo che ogni operazione intenzionale produca una cronologia coerente.

**File principali:** `document_formatting.json`, `documentFormatting.ts`,
`index.css`, `editorExtensions.ts`, `EditorToolbar.tsx`, `EditorBubbleMenu.tsx`,
`EditorContextMenu.tsx`, controlli in `components/editor/toolbar/`, `html_export.py`.

**Criterio di chiusura:** lo stesso comando, applicato alla stessa selezione,
ha il medesimo risultato da toolbar, tastiera e menu; il profilo osservato in
Docs guida la resa dell’app e delle copie.

## Fase 2 — Testo, formattazione e comportamento della tastiera

**Interventi**

- Allineare Enter e Shift+Enter; Backspace/Delete a confini di paragrafi,
  titoli, mark, link e nodi atomici; movimento e selezione della parola.
- Verificare l’eredità della formattazione digitando prima/dopo una selezione,
  un titolo, un link, una formula e un’immagine.
- Allineare grassetto, corsivo, sottolineato, barrato, colore ed evidenziatura,
  inclusi selezioni miste e comandi senza testo selezionato.
- Allineare i selettori correnti di font, dimensioni e titoli; risolvere le unità
  prima di mostrarle e rispettare gli stili espliciti.
- Verificare allineamento singolo/multiplo e dentro le strutture correnti.
- Allineare le scorciatoie delle funzioni già disponibili a Docs, con Ctrl/Cmd
  secondo la piattaforma e senza intercettare tasti dentro input o formule.
- Verificare le conversioni automatiche già attive e la loro reversibilità.

**Criterio di chiusura:** sequenze di digitazione e selezione equivalenti
producono lo stesso testo, i medesimi stili e lo stesso comportamento del caret.

## Fase 3 — Elenchi puntati e numerati

**Interventi**

- Allineare creazione e conversione paragrafo ↔ elenco e puntato ↔ numerato.
- Allineare Enter, Shift+Enter, voce vuota, Backspace a inizio voce,
  Tab/Shift+Tab e selezioni che attraversano più voci o paragrafi.
- Definire rientro del simbolo, rientro del testo, continuazione delle righe,
  distanze fra voci e comportamento dei livelli annidati usando il riferimento.
- Conservare correttamente numerazione iniziale già presente nei contenuti,
  numerazione dopo split/merge e identità delle liste dove serve.
- Estendere gli attributi di lista solo se necessari a queste operazioni;
  serializzarli nei documenti e tradurli in HTML/Docs.
- Verificare mark, formule e immagini dentro le voci.
- Non aggiungere checklist, gallerie di simboli o menu nuovi per ricominciare
  la numerazione: si correggono i comportamenti delle operazioni correnti.

**File principali:** estensioni liste dedicate se necessarie, `RichTextEditor.tsx`,
`documentFormatting.ts`, `editorClipboard.ts`, CSS ed esportazione HTML.

**Criterio di chiusura:** strutture, numerazione, rientri e gesti coincidono
nei casi semplici, annidati e misti; salvataggio e trasferimento non li alterano.

## Fase P — Impaginazione reale e numeri di pagina (rinviata)

**Stato:** fuori dal lavoro corrente e dai suoi criteri di completamento.
L'editor resta continuo. Riprendere la valutazione dopo l'accettazione delle
funzioni esistenti e del trasferimento app → Docs nella build desktop.
Il prototipo di questa chat, il rapporto e gli artefatti sono stati rimossi.
Gli interventi seguenti descrivono il perimetro futuro, senza avviare nuovi
prototipi o introdurre dipendenze di paginazione nel lavoro corrente.

**Comportamento da ottenere**

- Fogli separati nello stesso scorrimento verticale, con formato, margini e
  spazio visivo tra pagine coerenti con il riferimento Docs.
- Quando il contenuto riempie una pagina, il testo prosegue automaticamente
  nella successiva. Rimuovendo contenuto, quello seguente torna indietro e i
  fogli vuoti generati automaticamente scompaiono.
- Numeri consecutivi automatici, a partire da 1. Impostazione iniziale proposta:
  numero in basso a destra e indicatore discreto “Pagina X di Y” nell’interfaccia,
  calcolato dalla pagina del cursore durante l’editing e da quella visibile
  durante lo scorrimento. Non sono testo digitato nel corpo del documento.
- Il documento vuoto mostra una pagina. Zoom e dimensione della finestra
  modificano la vista, non il formato fisico del foglio o il numero di pagine.
  Sulle finestre strette si scala la vista o si consente lo scorrimento laterale;
  non si restringe il testo cambiando l’impaginazione.

**Scelta tecnica da chiudere con un prototipo**

Conservare un documento logico e una cronologia unici. Le pagine sono una
proiezione del layout, con una mappatura stabile tra posizioni del documento e
posizioni visive. I cambi automatici di pagina non devono creare paragrafi,
spazi, interruzioni semantiche o operazioni aggiuntive in undo.

Valutare prima una soluzione di paginazione compatibile con TipTap/ProseMirror
e con i nodi personalizzati. Non adottare automaticamente Tiptap Pages:
la sua documentazione richiede un kit specifico per le tabelle e segnala limiti
con blocchi non divisibili troppo alti. L’app usa attualmente il kit tabelle
open source e immagini con layout personalizzato. Verificare compatibilità,
licenza, uso locale/offline ed eventuali migrazioni prima della scelta.

Il prototipo deve coprire un paragrafo più lungo di una pagina, una lista
annidata, una tabella multipagina e un’immagine wrap vicino al bordo inferiore.
Se una soluzione pronta non li gestisce, confrontare un adattamento mirato del
layout con un’alternativa di motore. La scelta deve avere prove di editing;
un fondale con rettangoli, un’anteprima separata o più editor indipendenti non
soddisfano questo requisito.

**Interventi**

- Aggiungere al profilo comune il formato del foglio, margini e impostazione
  della numerazione, distinguendo unità fisiche e pixel di rendering.
  Calcolare la larghezza utile dai margini senza mantenere un secondo valore
  discordante di `contentWidthPx`.
- Suddividere anche paragrafi lunghi e voci di elenco tra pagine conservando
  identità, mark, livelli e numerazione. Il calcolo non può limitarsi a spostare
  blocchi interi sulla pagina successiva.
- Verificare con Docs titoli in fondo pagina, prime/ultime righe di paragrafo,
  spaziatura ai confini, formule a blocco e didascalie; applicare le regole
  osservate senza aggiungere menu nuovi per questi vincoli.
- Gestire tabelle che proseguono nelle pagine successive, celle unite e righe
  alte; non tagliare il contenuto né duplicarlo nel documento salvato.
- Definire comportamento esplicito per immagini, video e altri oggetti più
  alti dell’area utile, evitando cicli infiniti di riposizionamento, pagine
  vuote senza fine o ridimensionamenti distruttivi del contenuto originale.
- Integrare ancoraggio e wrap delle immagini con i confini delle pagine.
  Durante drag/resize preservare la stabilità dell’anteprima; al rilascio
  aggiornare documento e flusso una volta, con undo coerente.
- Allineare frecce, Home/End, Backspace/Delete e selezioni attraverso il cambio
  pagina. Il mouse deve posizionare il caret sulla riga scelta; copia/taglia,
  trova/sostituisci e indice devono usare posizioni logiche corrette.
- Ripaginare dopo modifiche di testo/stili, caricamento di font o immagini e
  variazioni reali delle dimensioni degli oggetti. Stabilizzare le misure prima
  di mostrare conteggio e numeri definitivi, evitando conteggi oscillanti.
- Aggiornare le regioni interessate senza ricalcolare inutilmente l’intero
  documento a ogni tasto; misurare digitazione, selezione e scroll su documenti
  lunghi. Non introdurre virtualizzazione prima di verificarne la necessità e
  l’effetto su selezione e ricerca.
- Salvare configurazione di pagina/numerazione come metadati e ricalcolare i
  confini automatici all’apertura; non salvare separatori visivi come contenuto.
  Aprire i documenti storici senza perdere testo o stili espliciti.
- Distinguere copia del contenuto e resa paginata: i numeri non finiscono nel
  testo degli appunti. Dove i formati correnti permettono metadati di pagina,
  tradurli e verificarli. La numerazione nelle rese stampabili deve usare campi
  o il renderer di pagina; non aggiungere falsi paragrafi numerati e non
  dichiarare trasferibili proprietà che il percorso di copia non rappresenta.

**File principali:** `RichTextEditor.tsx`, `EditorFullPage.tsx`, `index.css`,
profilo comune e document formatting, nuove estensioni/componenti di layout,
moduli di immagini, tabelle e conversione/persistenza interessati.

**Criterio di chiusura:** a parità di formato, margini, font e contenuto, i casi
del corpus hanno lo stesso flusso tra pagine del riferimento; numeri e conteggio
si aggiornano correttamente. Il testo rimane selezionabile e modificabile
attraverso i confini. Salvataggio, undo, zoom e caricamenti tardivi non perdono
contenuto e non generano salti del caret. Verificare nella WebView desktop reale.

## Fase 4 — Formule già supportate

**Interventi**

- Separare la rappresentazione semantica della formula dal suo rendering.
  KaTeX può continuare a renderizzare; non fornisce da solo editing strutturato.
- Prototipare la modifica dentro l’equazione per le strutture correnti con
  equivalente Docs: caratteri/simboli, frazioni, radici, apici/pedici e operatori.
- Allineare inserimento, entrata/uscita dal campo, frecce, selezione,
  cancellazione e tastiera; confrontare i gesti in Docs invece di inventarli.
- Sostituire la dipendenza dai prompt nativi per l’interazione principale.
  Il sorgente LaTeX esistente deve restare recuperabile, anche per formule
  storiche o strutture che il nuovo editor non può ancora modificare.
- Definire conferma/annullamento e integrazione con la cronologia del documento;
  un annullamento non deve salvare implicitamente la modifica per effetto del blur.
- Completare la traduzione delle strutture già supportate in
  `clipboardEquations.ts` e progettare il riconoscimento del contenuto proveniente
  da Docs. Il testo digitato dopo una formula non eredita i suoi attributi.
- Non rasterizzare una formula per dichiararla compatibile. Le strutture senza
  equivalente verificato rimangono integre e sono marcate come non equivalenti.
- Scegliere una libreria aggiuntiva soltanto dopo il prototipo di tastiera,
  annullamento, serializzazione e WebView; nessuna dipendenza è decisa dal piano.

**File principali:** `editorExtensions.ts`, controlli di inserimento correnti,
`clipboardEquations.ts`, `editorClipboard.ts`, percorso di incolla.

**Criterio di chiusura:** le formule del corpus si modificano e si trasferiscono
come oggetti matematici editabili, con posizione del caret e cronologia verificati.

## Fase 5 — Immagini, tabelle e altre funzioni correnti

**Interventi**

- Immagini: allineare inserimento, inline/wrap, ancoraggio, coordinate, margini,
  proporzioni, ridimensionamento, trascinamento e comportamento della didascalia
  nei casi con equivalente Docs.
- Conservare gli invarianti già implementati: anteprima senza reimpaginazioni
  ripetute durante il gesto, un commit al rilascio, annullamento e undo coerenti.
- Ripetere i confronti con immagini all’inizio, in mezzo e alla fine di un
  paragrafo, in elenchi/celle, con più immagini e a zoom differenti.
- Tabelle: allineare soltanto editing, tastiera, selezione e resize già
  disponibili; conservare celle unite, larghezze e formattazione importate.
- Link: uniformare inserimento, modifica e rimozione nei tre percorsi correnti.
- Citazioni e video: attuare il confronto definito nella fase 0; una differenza
  strutturale con Docs va dichiarata, senza sostituire silenziosamente il contenuto.
- Indice/zoom: mantenere titoli, destinazioni e posizione visuale coerenti
  nell'editor continuo, senza modificare contenuto o larghezza logica durante
  lo zoom. L'adattamento ai confini di pagina appartiene alla Fase P rinviata.

**File principali:** `FloatingImage.tsx`, `imageLayout.ts`, `imageWrap.ts`,
`imageDrag.ts`, `imageResize.ts`, `useEditorImageDrop.ts`, estensioni tabelle,
controlli link, `RichTextEditor.tsx` e CSS.

**Criterio di chiusura:** i gesti producono la stessa struttura finale e la stessa
disposizione locale del riferimento; la modifica resta stabile durante il gesto.

## Fase 6 — Ricerca e sostituzione

**Interventi**

- Cercare nel testo logico del paragrafo attraversando i mark; ricostruire le
  posizioni ProseMirror senza unire paragrafi o attraversare oggetti per errore.
- Allineare ricerca letterale, maiuscole/minuscole, successivo/precedente,
  ritorno alla prima occorrenza, selezione corrente e Escape.
- Definire la formattazione del testo sostitutivo con prove Docs.
- Allineare sostituzione singola e totale, aggiornamento del conteggio e undo.
- Non aggiungere ricerca con espressioni regolari o altre opzioni assenti.

**File principali:** `SearchHighlight` in `editorExtensions.ts`,
`EditorFindReplace.tsx`, integrazione tastiera in `RichTextEditor.tsx`.

**Criterio di chiusura:** il medesimo testo viene trovato anche quando cambia
formattazione; sostituzione, focus e cronologia coincidono nei casi coperti.

## Fase 7 — Trasferimento, persistenza e verifica finale

La conversione si aggiorna insieme a ogni fase precedente. Questa fase chiude
il confronto combinato e la compatibilità con i documenti esistenti.

**Interventi**

- Uniformare copia, taglia, Ctrl+C e pulsante per documento intero e selezioni
  parziali; verificare anche oggetti selezionati e frammenti di lista/cella.
- Confrontare tutti i percorsi disponibili per la stessa selezione e registrare
  se usano formato nativo o HTML. Quando un oggetto impone il ripiego, verificare
  anche testo, titoli, liste e altri oggetti circostanti; progettare l’eventuale
  correzione senza scartare l’oggetto incompatibile.
- Distinguere incolla formattata e senza formattazione. Rimuovere la cancellazione
  incondizionata di colori/evidenziature nell’incolla formattata mantenendo
  validazione dei valori e sanitizzazione HTML.
- Completare il percorso Docs → app per le strutture correnti, senza fidarsi
  indiscriminatamente del formato privato e senza dipendere da ID del documento
  sorgente. I dati non rappresentabili restano segnalati come tali.
- Verificare contenuti misti: i limiti di un singolo oggetto non devono provocare
  perdita silenziosa della formattazione o degli altri oggetti.
- Salvare tutti gli attributi necessari anche nell’HTML e nei pacchetti esistenti;
  aggiornare selettivamente allowlist/sanitizzazione e preview.
- Definire la lettura dei documenti storici: distinguere vecchi default e stili
  espliciti, normalizzare senza perdita e verificare il salvataggio atomico.
  Nessuna riscrittura massiva dei file o reset degli stili scelti dall’utente.
- Ripetere prima il percorso principale: apri → modifica nell’app → salva →
  riapri → copia → incolla formattato in Docs → verifica → salva e riapri in
  Docs → verifica di nuovo. Il risultato non deve richiedere rimozione della
  formattazione o aggiustamenti manuali per corrispondere a quello dell’app.
- Ripetere poi il ciclo completo: modifica in Docs → ricopia nell’app → salva →
  riapri, verificando separatamente le differenze del percorso inverso.

**File principali:** `utils.ts`, `documentFormatting.ts`, `editorClipboard.ts`,
`clipboardEquations.ts`, `useEditorImageDrop.ts`, `previewHtml.ts`,
`html_export.py`, percorsi di importazione/salvataggio e relativi test.

**Criterio di chiusura:** struttura, stili espliciti e modificabilità rimangono
coerenti nell’intero ciclo; le voci ancora incompatibili non vengono dichiarate 1:1.

## Verifica e definizione di completamento

Ogni caso della matrice deve verificare:

1. Risultato semantico: testo, nodi, attributi, livelli di elenco e formule.
2. Interazione: caret, selezione, focus, stato dei controlli, annulla/ripristina.
3. Resa: font, distanze, a capo, rientri e geometria degli oggetti.
4. Persistenza: salvataggio/riapertura senza perdite.
5. Trasferimento principale: app → Docs mantenendo formattazione ed editabilità,
   anche dopo salvataggio e riapertura in Docs.
6. Trasferimento complementare: Docs → app e ciclo completo, con esito distinto.

Per il percorso principale includere copia da tastiera, pulsante e menu
contestuale, taglia dove disponibile, documento intero, selezione parziale e
selezioni attraverso strutture differenti. Confrontare testo semplice, HTML e
formato nativo effettivamente presenti negli appunti, quindi eseguire l’incolla
reale: la presenza di una proprietà nel payload non prova che Docs la conservi.

La prima accettazione della fedeltà app → Docs richiede che la sbobina
rappresentativa e i casi delle funzioni correnti superino il contratto senza
correzioni manuali, con le condizioni del destinatario dichiarate. Si riportano
separatamente copertura raggiunta e differenze aperte; questa accettazione non
dichiara completate impaginazione, interazioni o percorso inverso ancora aperti.

Quando si riprenderà la Fase P, verificare anche formato/margini, punti di cambio pagina,
numero di fogli, numerazione e selezione attraverso i confini. Includere
aggiunta/rimozione di testo all’inizio del documento, paragrafi e tabelle più
lunghi di una pagina, immagini caricate in ritardo e zoom multipli.

Le tolleranze geometriche vengono stabilite per piattaforma nella fase 0 e non
ampliate per nascondere a capo o posizioni differenti. Il contenuto e la struttura
non hanno tolleranza di perdita. I test devono riprodurre i gesti dell’utente,
non soltanto invocare i comandi del motore.

Si usano test di comandi/schema, test DOM, Playwright e prove reali in Docs
con salvataggio e ricopia. Il browser non certifica gli appunti nativi:
per la chiusura servono prove nella build desktop WebView2 e, per il supporto
macOS, WKWebView su hardware reale. Nei payload di test conservati si escludono
credenziali, token e riferimenti privati del documento di origine.

Ogni gruppo di modifiche conclude i controlli mirati e il gate del progetto:

```powershell
python scripts/build_release.py check --with-coverage --skip-npm-install
git -c core.safecrlf=false diff --check
npm --prefix webui run build
```

Le fasi si consegnano separatamente e preservano il lavoro non correlato presente
nel checkout. Il piano non autorizza commit, push o release.

Il lavoro corrente è completo quando tutte le funzioni correnti con equivalente
Docs verificato soddisfano la matrice, comprese le combinazioni fra funzioni e
l'accettazione nella build desktop. Impaginazione e numerazione sono escluse
da questa chiusura e saranno valutate separatamente nella Fase P. Le
eccezioni documentate rimangono differenze aperte: non equivalgono a parità raggiunta.

## Ordine consigliato e punti di decisione

Ordine del lavoro corrente: **0 → 1 → 2 → 3 → 4 → 5 → 6 → 7**.
**Fase P rinviata dopo l'accettazione del lavoro corrente.**

In questo ordine la fedeltà app → Docs è un criterio di ogni consegna. La fase 7
verifica le combinazioni e chiude il ciclo; non rimanda a fine piano la scoperta
di perdite nella copia. Nella fase 0 si riproducono prima le variazioni lungo il
percorso principale; le differenze di editing e del percorso inverso mantengono
casi e risultati distinti.

Il campione misto inline ha completato il ciclo nel gruppo 30; il gruppo 31
aggiunge wrap/didascalie e il ripiego HTML, correggendo il rifiuto di salvataggio
per tabelle native adiacenti. Il gruppo 32 traduce l'offset verticale sorgente,
che Docs azzera all'incolla. Il gruppo 33 verifica alternative: padding e
spazio prima conservano lo spostamento positivo, ma alterano il wrap; il
riferimento fisso sulla pagina viene riposizionato. La geometria Y non nulla
resta aperta e queste alternative non diventano una correzione nell'app.
Il gruppo 34 misura l'allineamento nativo a destra con Y zero: il riferimento
creato in Docs resta a destra dopo riapertura, ma ricopia/incolla azzera X.
I flag di allineamento non bastano e non vengono applicati all'app come fix.
La prossima consegna riprende MIX-03 sullo stesso documento misto: confrontare
l'interlinea del ripiego HTML nelle destinazioni con interlinea 1,15 e 2,
senza dichiarare risolte le posizioni delle didascalie o le formule HTML.
Ripetere lo stesso corpus e l'intero ciclo fino alla riapertura Docs, confrontando
sia proprietà sia geometria. MIX-02/MIX-03/MIX-06 rimangono incompatibilità aperte.

Priorità operative:

1. Documenti misti e trasferimento app → Docs, con attenzione a tabelle e immagini.
2. Correzioni delle perdite di formattazione e struttura, incluso il ripiego HTML.
3. Interazioni comuni: selezioni miste, comandi, link, ricerca/sostituzione e cronologia.
4. Accettazione degli stessi percorsi nella vera build desktop.
5. Rivalutazione separata di paginazione e numerazione.

Le ulteriori microvarianti di tastiera diventano prioritarie quando riproducono
un difetto concreto o proteggono una correzione. I test già presenti restano.
Le verifiche di documenti completi iniziano subito e accompagnano le fasi;
il loro numero non viene usato come misura percentuale di parità complessiva.

La fase 0 evita di implementare il riferimento sbagliato; la fase 1 elimina
le regole discordanti; testo e liste stabilizzano le strutture in cui vivono
formule e immagini. Le conversioni e i test accompagnano ogni fase.

I punti di maggiore incertezza del lavoro corrente sono trasferimento dei
documenti misti e ripiego HTML, modifica delle formule e percorso inverso
Docs → app. Tabelle/wrap ai confini di pagina appartengono alla Fase P rinviata.
Se un prototipo dimostra un limite
del motore, si formula una decisione circoscritta a quella funzione, con prove e
costo, prima di cambiare dipendenze o architettura. Nessuna stima in giorni viene
fissata prima dell’inventario e di questi prototipi.

## Riferimenti del comportamento Docs

La documentazione ufficiale guida i casi; i dettagli di interazione non descritti
devono essere rilevati nel prodotto reale.

- [Elenchi puntati e numerati](https://support.google.com/docs/answer/3300615?hl=it):
  riferimento per le operazioni sui tipi di elenco già presenti; non include nel
  perimetro checklist e altri strumenti assenti nell’app.
- [Formattazione di paragrafi e caratteri](https://support.google.com/docs/answer/1663349?hl=en):
  riferimento per le proprietà già usate dall’editor.
- [Copia e incolla di testo e immagini](https://support.google.com/docs/answer/161768?hl=en):
  riferimento per i percorsi di trasferimento; il risultato delle proprietà
  specifiche del corpus deve essere verificato nel prodotto reale.
- [Equazioni](https://support.google.com/docs/answer/160749?hl=it) e
  [navigazione/modifica delle equazioni](https://support.google.com/docs/answer/16712774?hl=en):
  riferimento per editing e tastiera delle formule.
- [Formato con pagine e senza pagine](https://support.google.com/docs/answer/11528737?hl=en)
  e [numeri di pagina](https://support.google.com/docs/answer/86629?hl=en):
  riferimento futuro per impaginazione e numerazione nella Fase P rinviata.
- [Limiti di Tiptap Pages](https://tiptap.dev/docs/pages/core-concepts/limitations):
  vincoli da verificare nel prototipo, in particolare tabelle e blocchi alti.
- [Profilo e conversione attuali dell’app](document-formatting.md): base esistente,
  con prove e limiti della conversione già svolta.
