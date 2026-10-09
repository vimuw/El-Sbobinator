# Immagini dell'editor e copia formattata

L'editor offre esattamente due modalità: **In-line** e **Wrap**, con icone che rappresentano la disposizione del testo. Le immagini in linea sono nodi inline veri: possono stare fra due parole
nel medesimo paragrafo. Le immagini con testo attorno sono ancorate a un paragrafo e si
trascinano in orizzontale e verticale, anche in una posizione centrale con testo
su entrambi i lati. Non c'è una modalità separata sopra e sotto.

`imageLayout.ts`, `FloatingImage.tsx`, `imageWrap.ts` e `useEditorImageDrop.ts`
gestiscono disposizione, serializzazione e trascinamento. Il motore di wrap
misura le righe in una copia DOM nascosta e riserva spazi tramite decorazioni
ProseMirror. Testo e formattazione restano contenuto del documento; gli spazi di
disposizione non vengono salvati né copiati. Tabelle e blocchi complessi esterni
alla figura mantengono la loro geometria passando sotto l'ostacolo. Il movimento
e il ridimensionamento sono annullabili. Le vecchie immagini senza modalità e
quelle con `break` vengono riaperte in linea; la conversione cambia la precedente
disposizione centrata a blocco. `data-position` conserva l'allineamento di base;
`data-offset-x` e `data-offset-y` conservano gli spostamenti liberi, anche negativi,
delle immagini con testo attorno. Il trascinamento attraversa margini e bordi
del foglio. Soltanto la parte che interseca l'area testuale riserva spazio al testo.
Per tornare alla posizione precedente si usa **Annulla**, anche quando la
figura è stata trascinata fuori dal foglio. Il comando dedicato di recupero
è stato rimosso su richiesta dell'utente.

Durante il trascinamento Wrap l'anteprima viene aggiornata una volta per
fotogramma, usando l'ultima posizione del puntatore. Geometria, padding e
limiti delle guide vengono riutilizzati finché non cambia lo scroll o la
dimensione della finestra. Il rilascio applica comunque l'ultima posizione,
anche se il fotogramma in attesa non è ancora stato disegnato; annullamento
e chiusura del gesto cancellano gli aggiornamenti pendenti. L'anteprima
usa una trasformazione composita con `will-change: transform` e isolamento
del layout, senza ricalcolare il wrap del documento durante il movimento.
Nel corpus lungo del gruppo 37, 121 eventi del puntatore producono una sola
lettura di stili e una di geometria dell'editor, contro 120 e 120 prima del fix.
Questa misura riguarda il lavoro del gestore, non certifica FPS o fluidità
percepita della build Windows su ogni documento.

Anche il ridimensionamento (`imageResize.ts`) usa un'anteprima semitrasparente
con contorno verde opaco del tema e contrasto bianco. Durante il gesto le maniglie aggiornano
solo la sagoma, lasciando fermi il testo e l'immagine originale. Gli angoli
mantengono le proporzioni correnti e l'angolo opposto fermo, anche trascinando
solo in verticale. Le maniglie centrali cambiano soltanto larghezza o altezza,
tenendo fermo il bordo opposto e i due bordi perpendicolari. La maniglia superiore
centrale fa eccezione: modifica l'altezza mantenendo fermi il bordo superiore
e la posizione orizzontale, sia nell'anteprima sia al rilascio. L'allineamento
orizzontale non sposta l'immagine durante il resize.
Al rilascio dimensioni e posizione vengono applicate con una sola transazione
annullabile. Per le immagini inline l'altezza della riga viene misurata una sola
volta al rilascio, prima della transazione, per mantenere la posizione mostrata
dall'anteprima. `data-aspect-ratio` conserva le proporzioni modificate anche
negli appunti HTML e nativi di Docs; `data-offset-x` conserva lo spostamento
libero di entrambe le modalità e `data-offset-y` ammette anche valori negativi.
Il puntatore e la sagoma possono superare i margini e i bordi del foglio:
la larghezza può superare il 100% dell'area testuale, anche dopo salvataggio,
riapertura e copia formattata. Restano la larghezza minima già prevista
dall'editor e l'altezza minima di 24 px. Il movimento successivo di una figura
Wrap più larga del testo conserva l'origine mostrata dall'anteprima.
Le maniglie racchiudono l'immagine, lasciando la didascalia fuori dal contorno.
Esc, perdita del focus o pointercancel annullano il gesto; un'altra modifica del
documento durante il resize invalida il rilascio.

La verifica dell'8 ottobre 2026 copre in Chromium le maniglie ml/mr/tl/br
fuori dal foglio in entrambe le modalità, dimensioni superiori al 100%,
annulla/ripeti, autosave/riapertura e dimensioni della copia HTML/nativa.
Il riferimento Google Docs accetta il trascinamento oltre il bordo e conserva
763 × 147 px dopo riapertura e nuova copia. La figura Wrap dell'app al 120%
conserva in Docs 570,75 × 380,486603 pt dopo incolla nativo, salvataggio,
riapertura, digitazione annullabile e nuova copia. Docs riadatta la posizione
delle figure inline al rilascio; questa prova riguarda il resize oltre il bordo,
senza cambiare l'ancoraggio già adottato dall'app. Il gesto nel pacchetto
Windows WebView2 e nel runtime macOS rimane da verificare separatamente.
Evidenze in `_smoke/resize-outside-2026-10-08-final/`,
`resize-outside-docs-reference.json` e `resize-outside-docs-transfer.json`.

Il wrap usa un gesto pointer separato dal drag-and-drop nativo del testo.
Durante il movimento segue il punto afferrato solo un'anteprima semitrasparente,
senza toolbar, maniglie o linee di inserimento. L'immagine originale e il testo
restano fermi: il motore riadatta il testo una sola volta al rilascio, senza
clonare e impaginare l'intero documento a ogni movimento del puntatore.
Avvicinando la figura al margine sinistro, al centro o al margine destro dell'area
di testo, compare una guida verticale rossa e la posizione si aggancia entro
6 pixel visibili. Le guide seguono lo scorrimento e lo zoom, restano nella zona
visibile del documento e scompaiono al rilascio o all'interruzione del gesto.
Sono elementi temporanei esterni al contenuto: non vengono salvate o copiate.
L'aggancio non è un limite: il puntatore può attraversare la guida e proseguire.
Al rilascio si salva un solo movimento annullabile e
l'ancora viene scelta alla quota superiore della figura. Esc/pointercancel
ripristinano la disposizione senza salvare il movimento; Esc durante il gesto
non chiude l'editor. La selezione non scorre automaticamente all'ancora invisibile.

In entrambe le modalità, trascinando vicino al bordo superiore o inferiore della
zona visibile dell'editor, il documento scorre automaticamente, anche tenendo
fermo il puntatore. La velocità aumenta avvicinandosi al bordo. Al rilascio o
all'interruzione del gesto lo scorrimento si ferma.


## Appunti

Le regole condivise per editor, HTML portabile e formato nativo sono descritte
in [document-formatting.md](document-formatting.md). La copia del solo testo usa
ora lo stesso percorso delle selezioni con immagini o formule. Le verifiche
autenticate descritte sotto appartengono alle versioni precedenti: la nuova
unificazione è coperta dai test locali e browser, e richiede una nuova verifica
di incolla e salvataggio in Google Docs.

Google Docs elimina i float CSS durante l'incolla HTML. L'adattatore isolato
`editorClipboard.ts` aggiunge il formato nativo di Docs agli stessi appunti
HTML e testo usati dagli altri programmi. Funziona sia durante Ctrl+C sia dal
pulsante di copia e dal menu contestuale. L'evento di copia è sincrono: una
scrittura asincrona successiva non deve sovrascrivere gli appunti dell'utente.
Un taglio elimina la selezione solo dopo una copia riuscita.

Il formato `text/html` conserva il sorgente dell'immagine del documento e
separa le dimensioni di visualizzazione dal bitmap. Soltanto la copia destinata
al formato nativo Docs viene ricampionata alle dimensioni mostrate, in modo
sincrono durante la copia. Tastiera, menu e pulsante condividono questo percorso.
Il montaggio del nodo non ricomprime il sorgente: l'ottimizzazione del file
avviene una volta all'inserimento. Copie successive, incolla e resize mantengono
la risoluzione conservata nell'app.

La copia nativa usa l'interlinea del profilo comune e conserva la separazione fra blocchi.
I margini adiacenti vengono collassati in un solo spazio dopo il blocco
precedente: il default aggiornato dopo la segnalazione su Invio è zero
fra paragrafi e voci/celle senza stili espliciti, senza sommare
uno spazio prima e uno dopo. Dopo h2/h3/h4 resta il margine inferiore del titolo,
come nell'editor. Ogni cella di tabella ha un gruppo di paragrafi indipendente.
Gli elenchi usano la modalità esplicita di spaziatura (`ps_sm: 1`): Google Docs
sopprime la separazione fra voci quando è attiva la modalità automatica.
I titoli mantengono dimensioni, grassetto, livello e separazione fra sezioni.
Interlinea e margini CSS non vengono trasferiti numericamente nelle proprietà
native di Docs: ciò produrrebbe testo più dilatato.
Questa scelta riguarda gli appunti nativi, non l'HTML salvato o l'aspetto dell'editor.

Il formato nativo è interno a Google Docs e non ha un contratto pubblico stabile.
La prova nel browser deve accompagnare ogni modifica a questa conversione.
I payload generati non contengono credenziali, riferimenti al documento di prova
o identificatori di immagini appartenenti a Google. Le mappe di blob sono vuote:
Docs carica i dati dell'immagine inclusi negli appunti come nuova risorsa.

## Copertura verificata

Il test `webui/e2e/editor_images.spec.ts` esercita l'app con una JPEG sintetica,
il wrap centrale e intermedio, immagini fra parole, trascinamento,
ridimensionamento, annullamento, Ctrl+C e il pulsante. Include formattazione,
formule, tabelle, immagini multiple e immagini nelle celle.
Produce i formati esatti degli appunti da usare nella prova reale di incolla.

Nella prova autenticata del 2 ottobre 2026, Google Docs ha salvato correttamente:

- immagini senza didascalia con wrap a destra e a sinistra;
- titoli, formattazione inline, link, font e colori espliciti;
- elenchi annidati, numerazione iniziale, tabelle e celle unite;
- un gruppo flottante a sinistra con immagine e didascalia modificabile;
- una didascalia centrata nella modalità sopra e sotto;
- formule inline e a blocco con frazioni, radici, indici e sommatorie.

La didascalia è testo in una tabella senza bordi. Le formule sono equazioni
native ottenute dal MathML semantico di KaTeX tramite `clipboardEquations.ts`.
Sono state modificate direttamente in Docs dopo l'incolla. L'esportazione del
documento salvato, usata esclusivamente per verifica, contiene tre equazioni
OMML, una sola immagine e testo per la didascalia. Non si richiede all'utente
un flusso di importazione DOCX.

Il 3 ottobre 2026 è stata verificata anche la nuova coppia di modalità: il
payload esatto prodotto dall'app è stato incollato normalmente in un nuovo
Google Doc. L'immagine centrale mantiene il wrap sui due lati e l'immagine
inline compare fra le parole del paragrafo. Il documento risulta salvato su
Drive. Le prove con didascalie/formule sopra descritte appartengono alla versione
precedente dell'adattatore; i test locali verificano anche il loro percorso di
copia aggiornato.

Nella precedente verifica della spaziatura del 3 ottobre 2026, il test
`native copy preserves paragraph and list gaps with compact line spacing`
ha prodotto gli appunti esatti di sette paragrafi, inclusi un titolo h3,
due voci di elenco e un'immagine con wrap a destra. Ctrl+C e il pulsante
producono gli stessi stili di paragrafo. Il normale incolla in Google Docs
conserva gli spazi fra paragrafi e voci, e il documento risulta salvato su Drive.
La ricopia conferma interlinea 1 per tutti i sette paragrafi: 12 pt prima e
6 pt dopo il titolo, 13,75 pt dopo i cinque blocchi intermedi e zero dopo
l'ultimo paragrafo. Entrambe le voci mantengono `ps_sm: 1`; il testo coincide
dopo la normalizzazione dei ritorni finali aggiunti da Docs. I paragrafi vuoti
della destinazione possono conservare il loro stile precedente.
Gli artefatti locali sono in `_smoke/paragraph-spacing/`, inclusi
`paragraph-spacing-editor.png`, `docs-paragraph-gaps.jpg` e gli appunti JSON.
Questa prova non verifica il trasferimento dagli appunti di WebView2/WKWebView
nell'app impacchettata.

La successiva prova del profilo comune ha evidenziato che l'interlinea fissa 1
e gli offset dei margini producevano una disposizione diversa dall'editor.
La conversione attuale misura le metriche del font e traduce l'origine del
rettangolo dell'immagine. La prova reale aggiornata, con salvataggio e ricopia
in Docs, è documentata in [document-formatting.md](document-formatting.md).

## Limiti aperti

Il 5 ottobre 2026 il documento misto del gruppo 31 ha ripetuto il ciclo
modifica/salvataggio/riapertura/copia nell'app e incolla/salvataggio/riapertura
in Docs con wrap destra, didascalia sinistra e didascalia destra HTML.
La didascalia sinistra subito dopo una tabella causava un rifiuto del
salvataggio Docs: mancava un paragrafo tra le due tabelle native. L'adattatore
ora emette questo separatore; il nuovo campione si salva e conserva testo,
formattazione campionata, tabella/cella unita, didascalia, immagine e formula.
Il caso HTML si salva ma perde wrap ed equazione nativa e altera interlinea
e proprietà della tabella. Prove e limiti sono nella matrice MIX-05/MIX-06.

Questa implementazione non soddisfa ancora un requisito di identità visiva
universale fra l'editor e Google Docs.

- Docs azzera la coordinata X delle tabelle flottanti durante il normale
  incolla, anche copiando dal suo stesso editor. Per una didascalia con wrap
  e X diversa da zero l'adattatore restituisce `null` e mantiene l'HTML originale:
  il wrap non è garantito. Non deve generare una figura spostata a sinistra.
- L'offset verticale del gruppo wrap con didascalia viene conservato nell'app,
  ma non tradotto nella tabella flottante nativa: nel gruppo 31 `data-offset-y`
  è 18 px, mentre `tbls_ftp.ft_p.p_vp.vp_to` rimane zero. La copia nativa salva
  correttamente, ma la geometria verticale completa rimane da allineare.
- Matrici, ambienti multilinea e stili/spaziature matematiche non rappresentati
  dalla conversione conservano il percorso HTML. Non sono convertiti in bitmap
  né appiattiti deliberatamente in una falsa equazione nativa. La resa e la
  modificabilità di questi casi in Docs restano da risolvere.
- Il renderer di equazioni di Docs usa metriche proprie. La struttura nativa
  modificabile non prova che font, dimensioni e spazi siano identici a KaTeX.
- L'E2E usa Chromium. Il trasferimento dei MIME personalizzati dall'app
  impacchettata WebView2/WKWebView al browser esterno richiede prove native.
- L'HTML portabile mantiene un float laterale: il wrap sui due lati di una figura
  centrale richiede il motore dell'editor oppure il formato nativo di Docs.
  Anteprime/esportazioni HTML non garantiscono la disposizione centrale esatta.
- L'E2E copre immagini multiple e in tabella nell'editor. La loro resa in Google
  Docs, i conflitti fra figure sovrapposte e documenti molto estesi richiedono
  ulteriori prove.

Prima di estendere la copertura, verificare sia il rendering sia lo stato
"Saved to Drive" e ricopiare il documento per controllare la struttura.
Un formato non valido può apparire corretto sul canvas ma essere rifiutato
alla sincronizzazione. Evitare proprietà nulle dentro gli stili di equazione;
sono i delimitatori a definire il confine della formula.

## Verifiche locali

Eseguire i test mirati degli appunti, della disposizione immagini e del drop,
l'E2E immagini, la build frontend e il check autorevole del progetto:

```powershell
python scripts/build_release.py check --with-coverage --skip-npm-install
git diff --check
```

Usare un `COVERAGE_FILE` temporaneo unico e rimuoverlo alla fine, come indicato
dal workflow di verifica del progetto.
