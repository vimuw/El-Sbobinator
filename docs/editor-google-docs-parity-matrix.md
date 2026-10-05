# Matrice di parità dell’editor e del trasferimento a Google Docs

Data: 5 ottobre 2026. Collegamento al [piano](editor-google-docs-parity-plan.md).
Stato: inventario iniziale e primi trentaquattro gruppi di verifica e correzione; il piano completo è
ancora aperto. Ogni riga copre soltanto le proprietà e le azioni indicate.

Priorità aggiornata il 4 ottobre: editor continuo, documenti misti, fedeltà
app → Docs e verifica nella build desktop. PAGE-01 è rinviato e non blocca
il completamento delle funzioni correnti. Le nuove microvarianti di tastiera
hanno priorità quando riproducono un difetto o proteggono una correzione;
le prove precedenti rimangono conservate.

## Ambiente e riferimento

- App: checkout corrente con modifiche preesistenti, host browser deterministico
  `scripts/run_browser_dev.py --scenario success`. Audio WAV sintetico, nessuna
  chiamata Gemini e nessuna sbobina dell’utente usata nel confronto.
- Prove automatiche: Chromium Playwright, viewport Desktop Chrome, zoom app 100%.
- Prova Docs: browser integrato su Windows, interfaccia Docs inglese, tastiera
  Ctrl, zoom Docs e app 100%; font Arial e Georgia disponibili nella prova.
- [Documento sintetico Docs](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit):
  inizialmente creato vuoto per misurare testo normale e titoli, poi usato per
  l’incolla dei corpus. Le misure iniziali precedono quell’incolla. Il contenuto
  del primo tab è il corpus del profilo; le evidenze del primo corpus restano
  separate. Il terzo gruppo aggiunge Tab 2 per le varianti HTML e Tab 3 per i
  risultati di rimozione della formattazione, preservando Tab 1.
- Il formato e i margini fisici del foglio non sono ancora misurati/allineati:
  questa prova certifica le proprietà elencate, non identità di a capo o pagine.
- WebView2/WKWebView impacchettate: da verificare. Il browser integrato non
  certifica il trasferimento degli appunti della build desktop.

Nel nuovo documento Docs osservato, il testo normale è Arial 11, nero, peso
400, interlinea nativa 1,15 e spazio prima/dopo 0 pt. I titoli 1–5 osservati
sono tutti Arial, peso 400, interlinea nativa 1,15:

| Livello | Dimensione | Colore | Spazio prima | Spazio dopo |
| --- | --- | --- | --- | --- |
| 1 | 20 pt | `#000000` | 20 pt | 6 pt |
| 2 | 16 pt | `#000000` | 18 pt | 6 pt |
| 3 | 14 pt | `#434343` | 16 pt | 4 pt |
| 4 | 12 pt | `#666666` | 14 pt | 4 pt |
| 5 | 11 pt | `#666666` | 12 pt | 4 pt |

Questi sono valori osservati nell’ambiente di prova, non una garanzia sui
default di ogni account. L’HTML copiato da Docs dichiara interlinea 1,38 per
questi casi; non va confusa con il valore nativo 1,15. Il secondo gruppo ha
allineato il profilo dell’app a questi valori e verificato la copia nativa con
incolla, salvataggio, riapertura e rilettura in Docs. Il titolo 6, soltanto
importato, conserva il profilo precedente: non è incluso in questa equivalenza.

## Corpus e procedura ripetibile

1. Aprire la sbobina WAV sintetica nell’host deterministico.
2. Incollare nell’app il [corpus HTML](../webui/e2e/fixtures/editor-parity.html).
   Contiene un titolo 2 Georgia 18 blu, testo con mark misti e Shift+Enter,
   evidenziatura gialla, formula inline `x^2`, elenco numerato da 4 e tabella.
3. Verificare nell’app gli stili espliciti. Selezionare tutto e usare Ctrl+C.
   Ripetere Ctrl+X e annulla per confrontare i percorsi senza perdere il corpus.
4. Incollare normalmente in Docs. Attendere «Saved to Drive», selezionare tutto
   e ricopiare per rileggere le proprietà realmente accettate dal destinatario.
5. Riaprire Docs e ripetere la rilettura. Confrontare font, dimensioni, colore,
   evidenziatura, livello del titolo, interlinea, spazi e rientri ai medesimi testi.
6. Ampliare il corpus con immagini e formule non rappresentabili, selezioni
   parziali e destinazioni già formattate prima di chiudere la fedeltà generale.

Le prove locali del 3 ottobre sono in `_smoke/editor-parity/`:
`transfer-readback.json` contiene soltanto proprietà dei testi sintetici, senza
payload Docs grezzi, credenziali o ID di risorse. `docs-transfer.png` e
`app-transfer.png` conservano le viste osservate. Le immagini non costituiscono
un confronto geometrico a parità di larghezza utile.

Il secondo gruppo usa due corpus aggiuntivi:

- [Profilo e stili diretti](../webui/e2e/fixtures/editor-parity-profile.html):
  titoli 1–5, paragrafi normali, colore insieme a evidenziatura, titolo Georgia
  18 rosso con interlinea e margini espliciti, link, formula `x^2`, elenco da 4
  e tabella. `profile-readback.json` confronta dieci testi campione alla fonte,
  dopo incolla e dopo riapertura; `profile-docs.png` conserva la vista finale.
- [Ripiego HTML](../webui/e2e/fixtures/editor-parity-fallback.html): testo
  formattato, formula inline e matrice non rappresentabile nel percorso nativo,
  elenco da 4. La matrice impone HTML per tutto il frammento. `fallback-readback.json`
  e `fallback-docs.png` registrano il risultato effettivo senza payload privati.

Per ripetere il secondo caso usare la normale copia dell’app, verificare che
gli appunti contengano HTML e testo semplice senza formato nativo e incollare
normalmente in Docs. Il readback del ripiego è stato eseguito dopo l’incolla;
la verifica dopo riapertura di questo caso rimane aperta.

## Casi eseguiti e correzioni

| ID | Azioni e risultato atteso | Differenza iniziale | Stato e prove | File principali |
| --- | --- | --- | --- | --- |
| COPY-01 | Selezionare parte di un titolo con font/colore/corsivo; copiare conservando stili e testo selezionato | Nessuna nel caso eseguito | Verificato nel payload/DOM; confronto di questa selezione in Docs e build desktop ancora aperto | `editorParity.dom.test.tsx` |
| SAVE-01 | Modificare, salvare e riaprire un documento con layout diretto e formule inline/blocco | La normalizzazione della preview eliminava line-height, margini verticali, interlinea nativa e attributi sorgente delle formule; la formula inline diventava testo duplicato | Corretto; regressioni DOM con schema reale e ciclo Chromium di modifica/undo/redo/taglio/riapertura. Testo e formati nativi persistono. La correzione non recupera formule già sovrascritte come testo | `previewHtml.ts`, test DOM, `editor_images.spec.ts` |
| MIX-04 | Trasferire il documento misto con tabella a colonne diverse/cella unita, immagine inline e formula supportata; salvare e riaprire in Docs | Il ciclo nell'app perdeva layout e formula prima della copia, risolto in SAVE-01 | Verificato dopo riapertura Docs: testo, 18 campioni di stile, D/b/E, colonne 157,5/292,5 pt, cinque celle visibili, immagine 166,5×111 pt e comandi frazione/apice. Wrap, didascalie, HTML, selezioni miste e desktop restano aperti | `editor-parity-mixed.html`, `representative-transfer-readback.json`, `representative-api-readback.json` |
| MIX-05 | Trasferire il documento misto con wrap destra e con didascalia sinistra dopo la tabella dati; salvare e riaprire in Docs | Due tabelle native adiacenti, la seconda per la didascalia, venivano mostrate ma il servizio rifiutava il salvataggio | Corretto il separatore; Docs salva e dopo riapertura coincidono testo, 18/19 campioni di stile, lista, celle visibili, larghezze, dimensioni immagine e formula. Wrap senza didascalia conserva coordinate/margini. Il gruppo 32 corregge la coordinata Y emessa, ma Docs la azzera all'incolla anche nella propria ricopia: geometria completa e desktop aperti | `editorClipboard.ts`, test DOM/browser, `mixed-caption-left-readback.json`, `caption-offset-positive-readback.json`, `caption-offset-self-paste-readback.json` |
| MIX-07 | Ripetere il documento misto con didascalia sinistra wrap e offset Y -20/0/18 px, cronologia, salvataggio e riapertura | Un offset negativo faceva spostare ripetutamente la tabella precedente insieme all'ancora immagine, fino a un layout enorme; la copia nativa azzerava la coordinata sorgente | Corretto il ciclo del wrap e l'emissione Y; cinque configurazioni Chromium passano. In Docs contenuto e struttura persistono, zero coincide, ma -15/+13,5 pt diventano zero. Nessuna chiusura della geometria nel destinatario | `imageWrap.ts`, `editorClipboard.ts`, `editor_images.spec.ts`, `caption-offset-*-readback.json` |
| MIX-08 | Verificare ancoraggio fisso, padding e spazio prima come alternative per il gruppo immagine/didascalia | La coordinata flottante viene riscritta all'incolla; gli spazi interni possono conservare Y visivo ma occupano anche l'area vuota nel wrap | Alternative misurate, nessuna correzione applicata: «Fix on page» modifica Y; padding/spazio prima conservano 18/120 px e struttura dopo riapertura, ma a 120 px le righe sopra la figura restano respinte a destra, diversamente dal riferimento nativo. Y non nullo e desktop aperti | `caption-alternatives-readback.json`, `caption-alternatives-geometry.json`, `caption-alternatives-api-readback.json` |
| MIX-06 | Copiare lo stesso documento con didascalia wrap a destra, che impone HTML all'intero frammento | Il ripiego degrada anche il contenuto circostante | Incompatibilità confermata dopo salvataggio/riapertura: immagine inline, interlinea 1,38 invece di 1,15, frazione non nativa e testo «yx2», seconda colonna 291,75 invece di 292,5 pt. Didascalia, celle unite, padding e bordi delle celle 0,75 pt rimangono presenti. MIX-09 verifica che i flag di allineamento destro non evitano il ripiego conservando la geometria. Nessuna chiusura della fedeltà HTML | `mixed-caption-right-html-readback.json`, `mixed-wrap-api-readback.json`, tab sintetico HTML |
| MIX-09 | Verificare allineamento nativo a destra con Y zero per il gruppo immagine/didascalia | Il riferimento Docs conserva X dopo riapertura, ma ricopia/incolla azzera X anche con allineamento destro | Verifica del destinatario/prototipo, nessuna modifica applicativa: X 284,315 -> 0 pt nella ricopia Docs; `tbls_al: 2` e `hp_a: 2` persistono ma non spostano la figura a destra. PNG: figura a X 778 nel riferimento e X 400 dopo incolla, stessa quota Y; il testo cambia lato. Contenuto, stili e frazione nativa persistono; 66 altri tab invariati. MIX-06, altri formati possibili e desktop restano aperti | `caption-right-readback.json`, `caption-right-geometry.json`, `caption-right-api-readback.json`, `caption-right-check.mjs` |
| CUT-01 | Copiare e tagliare lo stesso documento misto; confrontare tutti i formati e annullare il taglio | Ctrl+X usava HTML standard e testo con separatori diversi da Ctrl+C | Corretto; DOM e gesto browser verificati | `editorSelectionClipboard.ts`, `RichTextEditor.tsx`, `editor_images.spec.ts` |
| CUT-02 | Tagliare con appunti assenti, formato rifiutato o trasferimento fallito | Il percorso standard poteva eliminare comunque la selezione | Corretto; regressioni DOM, incluso fallimento del menu contestuale | `editorParity.dom.test.tsx`, `EditorContextMenu.dom.test.tsx` |
| CUT-03 | Cambiare selezione mentre la copia del menu è ancora in corso | Il menu tagliava la selezione corrente dopo l’attesa | Corretto; regressione con promessa controllata | `EditorContextMenu.tsx`, relativi test |
| PASTE-01 | Incollare titolo con dimensione/font/colore espliciti e testo evidenziato; serializzare e riaprire | Colore/evidenziatura CSS eliminati e dimensione del titolo cancellata | Corretto; parser reale, serializzazione e gesto browser verificati | `useEditorImageDrop.ts`, `editorParity.dom.test.tsx`, `editor_images.spec.ts` |
| PASTE-02 | Usare «Incolla» dal menu con HTML e testo semplice disponibili | Il menu leggeva soltanto testo semplice | Corretto; preferenza HTML, stili e parsing verificati in DOM/browser | `editorSelectionClipboard.ts`, `EditorContextMenu.tsx` |
| PASTE-03 | Usare «Incolla senza formattazione» con `a < b e <testo>` | Il menu eliminava sequenze fra parentesi angolari e usava il parser HTML | Corretto; testo letterale verificato in DOM/browser | `EditorContextMenu.dom.test.tsx`, `editor_images.spec.ts` |
| PASTE-04 | Cambiare selezione durante una lettura asincrona degli appunti | Mancava una verifica della destinazione dopo l’attesa | Corretto; operazione annullata senza modifiche, regressione DOM | `editorSelectionClipboard.ts`, `editorParity.dom.test.tsx` |
| PASTE-05 | Incollare HTML con testo e immagine quando gli appunti espongono anche il file immagine | L’intercettazione del file saltava l’intero HTML e perdeva il testo circostante | Corretto; regressione con schema reale. Gesto nativo desktop ancora da verificare | `useEditorImageDrop.ts`, `editorParity.dom.test.tsx` |
| SEARCH-01 | Cercare `anatomia` in `ana<strong>tom</strong>ia`; non unire paragrafi, formule o hard break | Ricerca separata per nodo di testo: mancava la parola con mark misti | Corretto; posizioni e distinzione maiuscole/minuscole verificate in DOM, conteggio nel browser | `SearchHighlight` in `editorExtensions.ts` |
| DOCS-01 | Copiare il corpus app → Docs; salvare, riaprire e rileggere gli stili ai sette testi campione | La copia dipendeva da percorsi e formattazione in ingresso discordanti | Verificato in Docs: proprietà campionate uguali al payload dell’app e stabili dopo riapertura; lista 4–5, due celle, strutture native dell’equazione presenti | `transfer-readback.json`, documento Docs sintetico |
| PROFILE-02 | Copiare titoli 1–5 e testo normale; confrontare font, peso, colore, interlinea e spazio prima/dopo | Default discordanti, grassetto implicito e letter-spacing dei titoli | Corretto; DOM/browser e Docs verificati su dieci campioni, uguali dopo incolla e riapertura. Geometria di pagina ancora aperta | Profilo JSON, CSS, `documentFormatting.ts`, `editorClipboard.ts`, `profile-readback.json` |
| MARK-02 | Usare colore insieme a evidenziatura in entrambi gli ordini di annidamento | CSS e conversione forzavano il testo evidenziato nero | Corretto; regressioni DOM, gesto browser e colore `#123abc` su sfondo `#ffee00` conservati in Docs nei due percorsi | CSS, conversioni, corpus e readback |
| FONT-02 | Incollare uno stile diretto sul blocco e leggere il selettore della dimensione | Stile del blocco non serializzato e valori px mostrati come punti | Corretto; 24px mostrati come 18pt, parser/serializzazione verificati; stili diretti del titolo conservati in Docs. Selezioni miste ancora aperte | `editorDocumentStyle.ts`, `TypographySelects.tsx` |
| CLEAR-02 | Rimuovere formattazione da toolbar, menu, bubble e Ctrl+Backslash; annullare | Comandi discordanti; alcuni trasformavano titoli/liste e rimuovevano link | Comando comune; quattro gesti browser conservano titoli, liste, tabelle e link, azzerano stile diretto/allineamento e permettono undo. Formule e selezione parziale coperte da DOM; comportamento strutturale, link e allineamento confrontati in Docs | `editorDocumentStyle.ts`, controlli, `editorParity.dom.test.tsx`, Playwright |
| MIX-02 | Copiare il corpus con matrice; verificare anche il testo e gli elenchi circostanti | HTML KaTeX escapato visibile, layer accessibile duplicava formula e annotazione LaTeX | Corretto rendering/duplicazione; HTML reale conserva colore, evidenziatura e lista 4–5. Incompatibilità aperta: interlinea nativa 1,38 anziché 1,15; formule ridotte a testo, matrice senza struttura matematica editabile | `editorExtensions.ts`, `documentFormatting.ts`, `fallback-readback.json` |
| CLEAR-03 | Rimuovere formattazione da selezione parziale, cursore vuoto e selezione su più paragrafi | Il comando ripristinava allineamento, interlinea e margini anche senza selezionare tutto il testo del blocco; le modifiche del documento azzeravano i mark per la digitazione successiva | Corretto; Docs confrontato su titolo parziale, paragrafo intero, cursore con digitazione e tre paragrafi. DOM/browser verificano layout, stili esterni, digitazione, undo e copia. Due risultati dell’app incollati e riletti in Docs mantengono font, colori, centratura, interlinea 1,6 e spazi 8/10 pt anche dopo riapertura | `editorDocumentStyle.ts`, `editorParity.dom.test.tsx`, Playwright, `clear-reference-readback.json`, `clear-transfer-readback.json` |
| MIX-03 | Provare varianti HTML in destinazioni con interlinea 1,15 e 2 | L’interlinea CSS e quella nativa hanno unità differenti nel parser HTML di Docs | Varianti non adottate: `calc(1.38)` eredita 2 dalla destinazione doppia, un wrapper sintetico di provenienza Docs non corregge il rapporto. Un’interlinea nel figlio conserva quella nativa del paragrafo nei campioni, ma non dimostra fedeltà generale. MIX-02 resta aperto | `fallback-variants-readback.json`, Tab 2 sintetico |
| MATH-02 | Copiare funzioni nominate, limiti inline/blocco, sommatoria, integrale, prodotto e frazione annidata; salvare e riaprire in Docs | `sin`, `cos`, `log` e altre funzioni diventavano lettere ordinarie; limiti inferiori usavano la funzione a due argomenti; operatori inline usavano apice/pedice generici anziché estremi | Corretto; nove equazioni e 26 comandi con posizioni identiche alla fonte dopo incolla e riapertura; dieci campioni di stile del testo/paragrafo uguali. `sin x` modificato in `sin y` da tastiera e ripristinato con undo. Matrici, nomi/stili non verificati e ripiego HTML restano aperti | `clipboardEquations.ts`, test DOM/browser, `editor-parity-equations.html`, `equations-reference-readback.json`, `equations-transfer-readback.json` |
| LIST-02 | Copiare elenchi alfabetici/romani con numeri iniziali, tre livelli e più paragrafi nella stessa voce | La copia nativa convertiva tutti i marcatori in decimali e aggiungeva un numero a ogni paragrafo; Typography sovrascriveva i marcatori importati | Corretto nel percorso nativo; 21 paragrafi conservano marcatori, livelli, inizi, rientri e spaziatura dopo incolla e riapertura. Continuazioni senza marcatori; D–E, ii–iii, c–d e III–IV verificati. HTML puro ha ancora differenze strutturali | `editorLists.ts`, CSS, `documentFormatting.ts`, `editorClipboard.ts`, DOM/Playwright, `lists-transfer-readback.json` |
| LIST-03 | Salvare e rileggere numero iniziale e tipo di un elenco numerato | La sanitizzazione backend eliminava `start` e `type` da `ol` | Corretto; regressione backend e incolla/serializzazione nell'app conservano gerarchia, tipo e numero iniziale. Il browser verifica copia/taglio identici e undo; non certifica il ciclo nella build desktop | `html_export.py`, relativo test, `editor-parity-lists.html` |
| LIST-04 | Creare una lista da tastiera, Tab/Shift+Tab, Shift+Enter e doppio Enter per uscire; annulla/ripristina | Da confrontare con Docs | Gesti browser verificati: Tab all'inizio annida, Shift+Tab risale, Shift+Enter resta nella voce, doppio Enter risale dal livello annidato e poi esce dalla lista; undo/redo dell'annidamento conservano il modello. Docs confrontato per Tab e doppio Enter. Il sesto gruppo corregge i marcatori delle nuove liste in LIST-05 | StarterKit, `editor_images.spec.ts`, `lists-reference-readback.json` |
| LIST-05 | Creare tre livelli con Tab all'inizio e risalire con Shift+Tab; serializzare e copiare | I nuovi livelli erano tutti decimali | Corretto nella transazione di annidamento; liste figlie nuove iniziano da 1 con ciclo numeri/lettere/romani. Liste figlie già importate mantengono tipo e inizio. Quattro paragrafi 1/a/i/b conservano livello, marcatore, rientri 36/72/108 pt e interlinea 1,15 in Docs dopo incolla e riapertura | `editorLists.ts`, test DOM/browser, `list-gestures-transfer-readback.json` |
| LIST-06 | Selezionare le voci successive di una lista alfabetica iniziata da D; copiare/tagliare e annullare | La selezione delle ultime due voci ripartiva da D | Corretto; HTML e formato nativo iniziano da E. Copia/taglio identici e undo verificati nel browser; E–F rimangono in Docs dopo riapertura. Selezioni fra liste separate coperte in DOM; livelli misti ancora aperti | `editorSelectionClipboard.ts`, test DOM/browser, Tab 12 sintetico |
| LIST-07 | Backspace all'inizio di una voce composta da paragrafi/titoli; copiare, annullare e rileggere | Il motore perdeva il rientro o trasformava il testo annidato in una voce del livello superiore; il frammento successivo perdeva il numero iniziale | Corretto nei casi delimitati; browser verifica separazione, posizione orizzontale, mark, cursore, undo/redo e rilettura HTML. Tre/cinque paragrafi conservano rientri 36/72 pt, interlinea 1,15 e marcatori D–E/d–e in Docs dopo incolla e riapertura. Voci con altri blocchi restano aperte; secondo Backspace coperto da LIST-08 | `editorLists.ts`, `editorDocumentStyle.ts`, `editorClipboard.ts`, test DOM/browser, `backspace-transfer-readback.json` |
| LIST-08 | Secondo Backspace sul testo appena separato dalla lista, di primo livello/annidato; digitare, annullare, serializzare e copiare | Al primo livello il testo si univa al precedente; annidato manteneva il rientro | Corretto nei casi delimitati: rientro complessivo 0 pt, testo separato e continuazioni successive intatte. DOM copre liste puntate/numerate e due livelli di contenitori; browser copre geometria, mark/caret, digitazione, undo/redo e ritorno HTML. Quattro/sei paragrafi conservano proprietà campionate, D–E e livelli dopo incolla e riapertura in Docs. Terzo Backspace coperto nei casi di LIST-09; voci con altri blocchi aperte | `editorLists.ts`, test DOM/browser, `second-backspace-transfer-readback.json` |
| LIST-09 | Terzo Backspace dopo l'azzeramento del rientro, primo livello/annidato; digitare, annullare, serializzare e copiare | Al primo livello l'undo annullava anche il rientro del secondo gesto; annidato non univa il testo alla voce figlia precedente | Corretto nei casi delimitati: fusione col testo precedente, caret al punto di unione, mark conservati, undo separato per fusione e digitazione. Continuazioni e numerazione successive intatte. Tre/cinque paragrafi coincidono con il gesto Docs e conservano proprietà campionate dopo incolla e riapertura. Delete, altri blocchi e fusioni generali aperti | `editorLists.ts`, test DOM/browser, `third-backspace-transfer-readback.json` |
| LIST-10 | Canc fra voci adiacenti della stessa lista, composte solo da paragrafi; digitare, annullare, serializzare e copiare | Un undo annullava insieme fusione e digitazione immediatamente successiva | Corretto nei casi delimitati: undo separato prima/dopo il join, caret e mark conservati, continuazioni e numerazione intatte. Tre/cinque paragrafi conservano proprietà campionate, 1–2/a–b e livelli dopo incolla e riapertura in Docs. Canc fra livelli diversi, titoli/oggetti e fusioni generali aperti | `editorLists.ts`, test DOM/browser, `delete-transfer-readback.json` |
| LIST-11 | Canc verso la prima figlia, dall'ultima figlia alla voce principale successiva e fra voci quando la successiva contiene una sottolista di paragrafi | Nei due attraversamenti di livello il testo rimaneva separato; la fusione con sottolista raggruppava la digitazione nella cronologia | Corretto nei tre corpus delimitati: testo unito al caret, mark conservati, undo separati, sottoliste e numerazione corrette. Sei/sei/quattro paragrafi coincidono per testo, grassetto, livelli, rientri e interlinea con il gesto Docs e dopo incolla/riapertura. Altre ramificazioni, attributi discordanti, oggetti/titoli e più livelli attraversati aperti | `editorLists.ts`, test DOM/browser, `delete-levels-transfer-readback.json`, `delete-levels-api-readback.json` |
| LIST-12 | Primo Backspace su una voce con sottolista, preceduta da una voce di soli paragrafi/titoli | La lista si spezzava e il ramo cambiava livello | Corretto nei corpus root/annidato: solo il marcatore scompare, testi separati, posizione e profondità conservate, undo della digitazione distinto. Cinque/sette paragrafi conservano testo, grassetto, livelli, rientri e interlinea dopo incolla e riapertura in Docs. Il precedente con sottolista è coperto nei casi di LIST-13; prima voce, oggetti e altre combinazioni restano aperti | `editorLists.ts`, test DOM/browser, `backspace-subtree-transfer-readback.json`, `backspace-subtree-api-readback.json` |
| LIST-13 | Primo Backspace fra due voci con un paragrafo e una sottolista ciascuna, di tipo/attributi uguali | Il percorso standard spezzava la lista e cambiava profondità; il secondo ramo deve proseguire i numeri del precedente | Corretto in root/annidato: solo il marcatore scompare, paragrafi fermi, figlie a/b → c/d oppure i/ii → iii/iv, caret e undo separati. Sette/nove paragrafi coincidono dopo incolla e riapertura in Docs per testo, grassetto, rientri, livelli, interlinea e numero effettivo. Altre forme/attributi, oggetti e build desktop aperti | `editorLists.ts`, test DOM/browser, `backspace-two-branches-transfer-readback.json`, `backspace-two-branches-api-readback.json` |
| LIST-14 | Primo Backspace sulla prima voce con paragrafo e sottolista di voci di soli paragrafi/titoli | Il motore sollevava il ramo cambiandone profondità; la copia inizialmente rinumerava la successiva voce da 1 | Corretto in root/annidato: marcatore nascosto, geometria e figlie conservate, successiva 2/b. Quattro/sei paragrafi coincidono con Docs dopo incolla e riapertura; caret, grassetto, undo/redo, HTML e preview verificati. Gesti successivi, oggetti, più rami e build desktop aperti | `editorLists.ts`, `editorClipboard.ts`, `documentFormatting.ts`, `previewHtml.ts`, test DOM/browser, `first-subtree-transfer-readback.json`, `first-subtree-api-readback.json` |
| LIST-15 | Secondo Backspace sulla prima voce senza marcatore e con sottolista; digitare, annullare, serializzare e copiare | L'undo del carattere digitato immediatamente dopo annullava anche l'azzeramento del rientro | Corretto: cronologia separata, rientro complessivo 0 pt e figlie ferme. Quattro/sei paragrafi coincidono con Docs dopo incolla e riapertura per testo, grassetto, livelli, rientri, interlinea e marcatori 2/b. Terzo gesto annidato, oggetti, più rami e build desktop aperti | `editorLists.ts`, test DOM/browser, `first-followup-transfer-readback.json`, `first-followup-api-readback.json` |
| LIST-16 | Terzo Backspace sulla prima voce senza marcatore, rientro azzerato e sottolista di paragrafi; primo livello e ramo annidato | Il motore sollevava la struttura al primo livello e non univa il testo all'antenato nel ramo annidato | Corretto nei corpus: primo livello invariato; annidato `MadrePrima`, figlie i/ii e successiva b conservate. Caret al join, grassetto, undo separati e HTML verificati. Quattro/cinque paragrafi coincidono con Docs dopo incolla e riapertura per proprietà campionate, senza paragrafi vuoti interni. Altri gesti, titoli, oggetti, più rami e build desktop aperti | `editorLists.ts`, `editorClipboard.ts`, test DOM/browser, `first-merge-transfer-readback.json`, `first-merge-api-readback.json` |
| LIST-17 | Backspace sulle due figlie dopo LIST-16, rimozione/reset/fusione, al primo livello e nel ramo annidato | L'undo poteva annullare il marcatore insieme alla digitazione; la rimozione dell'ultima figlia lasciava un contenitore che alterava numerazione e fusione | Corretto nei corpus: dodici stati app/Docs coincidono per proprietà campionate; ultima rimozione scioglie il contenitore e Seconda riparte da 1/a. Caret, grassetto, undo separati e HTML verificati. Due/tre paragrafi finali coincidono dopo incolla e riapertura in Docs. Altre strutture e build desktop restano aperte | `editorLists.ts`, test DOM/browser, `child-steps-readback.json`, `child-transfer-readback.json`, `child-api-readback.json` |
| LIST-18 | Enter all'inizio, a metà e alla fine del paragrafo di una voce con sottolista di paragrafi, root/annidato | L'undo raggruppava la divisione e il carattere digitato subito dopo | Corretto nei corpus: figli sulla seconda voce, caret iniziale, undo separati, grassetto e HTML conservati. Sei risultati coincidono con Docs anche dopo incolla e riapertura, incluse le voci numerate vuote. Dodici regressioni DOM puntate/numerate. Selezioni estese, titoli/oggetti, voci senza marcatore e build desktop aperti | `editorLists.ts`, test DOM/browser, `enter-reference-readback.json`, `enter-api-readback.json` |
| SELECT-01 | Copiare una parola dentro una voce e incollarla in mezzo a un paragrafo | Gli appunti aggiungevano elenco, marcatore e confine di paragrafo | Corretto; font/mark ereditati materializzati e frammento inline senza newline aggiunta. `PRIMA Seconda DOPO` resta un solo paragrafo senza marcatore in Docs, anche dopo riapertura. Titolo parziale formattato coperto dal test DOM esistente. Il settimo gruppo esclude il margine del paragrafo rientrato dallo span inline, verificato in DOM/browser | `editorSelectionClipboard.ts`, `editorClipboard.ts`, test DOM/browser, Tab 13 sintetico |
| TAB-01 | Premere Tab dentro il testo di una voce; annullare e rileggere HTML | L'app annidava la voce; una tabulazione letterale veniva poi eliminata dal parsing HTML | Corretto; tabulazione nel testo, un undo e persistenza HTML in liste numerate/puntate. Browser verifica Tab e incolla HTML di ritorno. Docs conferma l'inserimento letterale; geometria dei tab stop ancora aperta | `EditorListItem`/`EditorOrderedList`, `RichTextEditor.tsx`, test DOM/browser |
| PLAIN-01 | Copiare testo semplice con liste, sottoliste e continuazioni | Contenitore e paragrafo aggiungevano entrambi un separatore, creando righe vuote | Corretto; discendenti elaborati prima dei contenitori, un solo confine per paragrafo. Regressione DOM e appunti reali della selezione browser | `documentFormatting.ts`, test DOM/browser |
| LIST-19 | Secondo Enter sulla voce vuota creata all'inizio/alla fine del paragrafo con sottolista, root/annidato | Con figlie la voce rimaneva allo stesso livello; senza figlie il ramo annidato diventava una continuazione senza marcatore | Struttura corretta nei quattro corpus: riga root senza marcatore a 0 pt, riga annidata promossa di un livello, figlie alla profondità originale, Seconda 2/b e Ultima 3. Caret, geometria, undo separati e HTML verificati. Appunti, incolla e riapertura Docs coincidono per le proprietà campionate del testo esistente. Formattazione della riga vuota corretta separatamente in MARK-EMPTY-01 (gruppo 20) | `editorLists.ts`, test DOM/browser, `empty-enter-readback.json`, `empty-enter-api-readback.json` |
| MARK-EMPTY-01 | Tornare col caret nella riga vuota dopo LIST-19 e riapertura, quindi digitare X | Il grassetto della riga vuota non sopravviveva; X risultava normale nell'app | Corretto nel gruppo 20: grassetto persistente e ripristinato sui quattro corpus root/annidato, inizio/fine. Autosave, chiusura/riapertura, undo/redo, disattivazione e cancellazione verificati nell'app. Copia nativa, incolla/riapertura/ricopia e digitazione X in Docs coincidono. Altri stili/topologie e build desktop aperti | `emptyTextMarks.ts`, `editorEmptyTextMarks.ts`, `empty-marks-readback.json`, `empty-marks-api-readback.json` |
| SAVE-REOPEN-01 | Modificare e salvare nuovamente la stessa sbobina dopo chiusura/riapertura | Il getter pubblicato al solo evento create poteva leggere un'istanza precedente e restituire HTML vuoto | Corretto nel ciclo browser del gruppo 20: getter dell'istanza attiva pubblicato tramite effect, quattro chiusure/riaperture e successivi salvataggi con contenuto completo. Test DOM sulla sostituzione del callback. Build desktop ancora da verificare | `RichTextEditor.tsx`, `editorParity.dom.test.tsx`, `empty-marks-playwright/` |
| MARK-EMPTY-02 | Riga vuota di LIST-19 con stili combinati e font 18 pt; digitare dopo autosave e riapertura | I mark erano salvati ma la riga vuota usava le metriche predefinite: 20,23 → 33,11 px digitando X, con spostamento delle righe successive | Corretto nel gruppo 21: decorazione visiva con font salvato, geometria invariata nei quattro corpus, niente stile di paragrafo aggiuntivo in HTML o sfondo a tutta riga. Stili e testo coincidono con Docs dopo copia, riapertura e digitazione. Altri font/topologie, navigazioni e build desktop aperti | `editorEmptyTextMarks.ts`, `emptyTextMarks.ts`, `empty-styles-metrics-before.log`, `empty-styles-readback.json` |
| CLIP-MARK-01 | Copia nativa di sottolineato e barrato annidati nei due ordini, anche con CSS/link interni | La decorazione del discendente azzerava l'altra decorazione dell'antenato nel formato nativo | Corretto nel gruppo 21: entrambe trasferite su Prima e X, con otto attributi del carattere confrontati. Quattro regressioni DOM; tutti i corpus app → Docs coincidono dopo incolla e riapertura. Nessuna certificazione del ripiego HTML o di tutte le selezioni | `editorClipboard.ts`, `documentFormatting.dom.test.ts`, `empty-styles-readback.json`, `empty-styles-api-readback.json` |
| NAV-EMPTY-01 | Tornare con ArrowUp/ArrowDown nella riga vuota di LIST-19 con stili combinati, dopo riapertura | Caso lasciato aperto nel gruppo 21; nessun nuovo difetto riprodotto dopo la correzione delle metriche | Verificato nel gruppo 22: sette percorsi app e quattordici Docs conservano stile di X, struttura e undo/redo dopo riapertura. Geometria e HTML dell'app invariati durante navigazione e digitazione. Altre navigazioni, righe a capo, font, topologie e build desktop aperti | `editor_images.spec.ts`, `empty-keyboard-readback.json`, `empty-keyboard-api-readback.json` |
| TEXT-SOFT-01 | Shift+Enter a metà/fine di un paragrafo, voce numerata root/annidata con stili combinati; digitare X, annullare, salvare, riaprire e copiare | Il ritorno di riga veniva inserito senza mark e copiato come Arial 11 pt normale, mentre Docs conserva gli stili attivi anche sul ritorno stesso | Corretto nel gruppo 23: mark salvati sul nodo hardBreak e trasferiti nell'HTML/nativo. Sei regressioni DOM e sei cicli browser; sei copie coincidono con i riferimenti Docs dopo incolla e riapertura per testo, stili per carattere, livelli, rientri, interlinea e numerazione. Undo immediato di ritorno più X raggruppato come in Docs. Inizio, selezioni, altri blocchi, ritorni consecutivi e desktop aperti | `CustomHardBreak`, `editorParity.dom.test.tsx`, `editor_images.spec.ts`, `soft-break-readback.json`, `soft-break-api-readback.json` |
| TEXT-SOFT-02 | Shift+Enter iniziale e due ritorni consecutivi all'inizio/metà/fine di paragrafo e voci numerate root/annidate; digitare X, undo/redo, salvare, riaprire e copiare | Al caret iniziale CustomHardBreak scartava i mark del primo carattere e impostava un insieme vuoto per la digitazione successiva | Corretto nel gruppo 24: ereditarietà del primo carattere al caret iniziale, storedMarks espliciti prioritari. Sei regressioni prima/dopo, diciotto casi DOM e browser, due controlli sui mark espliciti. Dodici nuove copie e riferimenti coincidono dopo incolla e riapertura Docs per testo, otto stili per carattere, livelli, rientri, interlinea e numerazione; API di 24 tab verifica ritorni e X. Selezioni, altri blocchi/font, cancellazioni, HTML e desktop aperti | `CustomHardBreak`, `editorParity.dom.test.tsx`, `editor_images.spec.ts`, `soft-boundary-readback.json`, `soft-boundary-api-readback.json` |
| TEXT-SOFT-03 | Shift+Enter su selezione uniforme, mista o iniziale al confine degli stili nello stesso paragrafo/voce numerata root/annidata; digitare X, undo/redo, salvare, riaprire e copiare | Al confine dei mark il ritorno e X ereditavano gli stili del carattere precedente invece del primo selezionato, diversamente da Docs | Corretto nel gruppo 25: primo carattere selezionato per range nello stesso blocco, storedMarks espliciti prioritari. Tre regressioni falliscono prima; nove casi DOM e browser. Nove riferimenti e nove copie coincidono dopo incolla e riapertura per testo, otto stili per carattere, livelli, rientri, interlinea e numerazione; API dei 18 tab conferma gli stili salvati. Selezioni inverse/multiblocco, altri blocchi/font/stili, HTML e desktop aperti | `CustomHardBreak`, `editorParity.dom.test.tsx`, `editor_images.spec.ts`, `soft-selection-readback.json`, `soft-selection-api-readback.json` |
| TEXT-SOFT-04 | Shift+Enter su selezioni inverse uniformi/miste/al confine degli stili, da inizio blocco e di tutto il testo senza terminatore, in paragrafo/voce numerata root/annidata | I quindici nuovi casi seguono già il primo carattere selezionato, indipendentemente dal verso, come Docs | Verificato nel gruppo 26 senza nuova correzione al motore: direzione anchor/head, caret, struttura, otto stili, undo/redo e durata. Quindici riferimenti e quindici copie coincidono dopo incolla e riapertura; API dei trenta tab conferma tutti i caratteri del blocco modificato. Multiblocco, terminatori/oggetti, altri blocchi/stili, HTML e desktop aperti | `editorParity.dom.test.tsx`, `editor_images.spec.ts`, `soft-range-readback.json`, `soft-range-api-readback.json` |
| TEXT-SOFT-05 | Shift+Enter su selezioni inverse dal primo carattere e di tutto il testo senza terminatore, in paragrafo/voce numerata root/annidata | I sei nuovi casi seguono già lo stile del primo carattere selezionato, come Docs | Verificato nel gruppo 27 senza nuova correzione al motore: anchor/head, caret, struttura, otto stili, undo/redo e durata. Sei riferimenti e sei copie coincidono dopo incolla e riapertura; API dei dodici tab verifica ogni carattere e layout dei paragrafi. Multiblocco, terminatori/oggetti, altri blocchi/stili, HTML e desktop aperti | `editorParity.dom.test.tsx`, `editor_images.spec.ts`, `soft-reverse-readback.json`, `soft-reverse-api-readback.json` |
| TEXT-SOFT-06 | Shift+Enter su r + ritorno interno già presente + i, in avanti/inverso, nello stesso paragrafo/voce numerata root/annidata | I sei nuovi casi mantengono già gli stili del primo carattere selezionato e sostituiscono il ritorno, come Docs | Verificato nel gruppo 28 senza nuova correzione al motore: P + ritorno + Xma, anchor/head, caret, un solo hardBreak, struttura, otto stili, undo/redo e durata. Sei riferimenti e sei copie coincidono dopo incolla e riapertura; API dei dodici tab verifica ogni carattere e layout dei paragrafi. Altri range con ritorni, multiblocco, terminatori/oggetti, altri blocchi/stili, HTML e desktop aperti | `editorParity.dom.test.tsx`, `editor_images.spec.ts`, `soft-existing-readback.json`, `soft-existing-api-readback.json` |
| TEXT-SOFT-07 | Shift+Enter su ritorno interno come primo nodo selezionato + i, in avanti/inverso, nello stesso paragrafo/voce numerata root/annidata | I sei nuovi casi mantengono già gli stili del ritorno selezionato e sostituiscono ritorno + i, come Docs | Verificato nel gruppo 29 senza nuova correzione al motore: Pr + ritorno + Xma, anchor/head, caret, un solo hardBreak, struttura, otto stili, undo/redo e durata. Sei riferimenti e sei copie coincidono dopo incolla e riapertura; API dei dodici tab verifica ogni carattere e layout. Ritorno isolato, più ritorni, stili indipendenti dai vicini, multiblocco, terminatori/oggetti, altri blocchi/stili, HTML e desktop aperti | `editorParity.dom.test.tsx`, `editor_images.spec.ts`, `soft-first-readback.json`, `soft-first-api-readback.json` |

«Verificato in Docs» riguarda soltanto i casi/proprietà esplicitamente indicati.
La presenza di strutture native
dell’equazione non chiude l’editing strutturato o la navigazione con la tastiera.
La ricerca attraversa mark contigui, ma non attraversa nodi non testuali.

## Inventario corrente e casi ancora da chiudere

| ID / area | Percorsi esistenti e casi da eseguire | Differenza o stato | Punto di implementazione |
| --- | --- | --- | --- |
| TEXT-01 — testo e cronologia | Digitazione, Enter/Shift+Enter, Backspace/Delete ai confini, parola e selezione, undo/redo | Da confrontare in Docs su tutti i nodi correnti | StarterKit, `RichTextEditor.tsx`, `editorUtils.ts` |
| MARK-01 — caratteri | Toolbar/menu/bubble/tastiera; mark misti, testo successivo | Colore insieme a evidenziatura chiuso in MARK-02; gli altri gesti e l’eredità del testo successivo rimangono aperti | `index.css`, `documentFormatting.ts`, `editorClipboard.ts` |
| FONT-01 — font e dimensioni | Selettori correnti, selezioni miste, testo digitato e titoli con stili espliciti | Import ora conserva gli stili coperti; stato misto ed eredità da confrontare | `TypographySelects.tsx`, `FontSize` |
| PROFILE-01 — titoli e paragrafi | Applicare titoli 1–5, tornare al testo normale, selezioni parziali, interlinea e distanze | Default e copia nativa coperti da PROFILE-02; conversioni interattive e geometria non chiuse | Profilo JSON, `documentFormatting.ts`, CSS frontend/backend |
| CLEAR-01 — rimuovi formattazione | Selezioni parziali/miste, cursore senza selezione e testo successivo | Comando unificato in CLEAR-02; selezione parziale, cursore con digitazione e selezione su tre paragrafi confrontati in CLEAR-03. Combinazioni con altri oggetti e prova desktop rimangono aperte | `editorDocumentStyle.ts`, controlli correnti |
| ALIGN-01 — allineamento | Sinistra/centro/destra/giustificato, selezioni multiple, liste e celle | Da confrontare | TextAlign, `AlignDropdownButton.tsx` |
| LIST-01 — elenchi | Toolbar, scorciatoie, Enter/Tab/Shift+Tab, split/merge, livelli e numero iniziale | LIST-02/03 coprono import, continuazioni native e salvataggio. LIST-04/05/06 coprono i gesti e le selezioni indicati. LIST-07 corregge il primo Backspace su voci composte da paragrafi/titoli, con testo separato, rientro e numerazione successiva conservati. LIST-08 azzera il rientro al secondo Backspace senza unire il testo. LIST-09 unisce al terzo gesto il testo alla voce precedente con undo separato. LIST-10 separa la cronologia di Canc e digitazione fra voci composte da paragrafi della stessa lista. LIST-11 corregge i tre confini con sottoliste di paragrafi indicati nella riga dedicata. LIST-12 corregge il primo Backspace con sottolista nei due corpus, conservando posizione e livelli. Prima voce, precedente con sottoliste/oggetti, altri confini di Canc, annidamento della prima voce, livelli misti, selezioni generali, split/merge e percorso inverso completo aperti. Nel ripiego HTML la continuazione dopo la sottolista diventa una nuova voce e altera il numero successivo | StarterKit, `editorLists.ts`, `editorClipboard.ts` |
| MATH-01 — formule | Inserimento inline, blocchi importati, input/textarea LaTeX, navigazione e annullamento | Editing atomico nell’app diverso da Docs; MATH-02 chiude funzioni nominate e limiti nei casi provati, inclusa una modifica da tastiera in Docs. Conversione generale, matrici e altri gesti aperti | `MathInline`, `MathBlock`, `clipboardEquations.ts` |
| IMAGE-01 — immagini | File, drop/paste, inline/wrap, drag/resize, proporzioni, didascalia, undo | Invarianti dei gesti già coperti dai test esistenti; confronto Docs combinato e desktop aperto | Moduli immagini e `FloatingImage.tsx` |
| TABLE-01 — tabelle | Tabelle importate, editing/tastiera, selezioni di celle, resize, celle unite | Due celle trasferite in DOCS-01; bordi, padding e larghezze non ancora equivalenti | Kit Table, CSS e adattatore |
| LINK-01 — link | Toolbar/menu/bubble, inserimento/modifica/rimozione, testo circostante | Da confrontare e uniformare | Controlli link, Link extension |
| QUOTE-01 — citazioni | Toolbar e blockquote importati; rientri e modifica | Equivalente Docs da verificare; CSS Typography interferisce | StarterKit, CSS, adattatore |
| SEARCH-02 — sostituzione | Successivo/precedente, selezione corrente, sostituisci singolo/tutto, formattazione e undo | SEARCH-01 non chiude focus, selezione o stile del testo sostitutivo | `EditorFindReplace.tsx` |
| OUTLINE-01 — indice | Titoli, annidamento, navigazione, focus | Da confrontare; estrazione attuale dei nodi principali | `extractHeadings`, `useTocScrollSpy.ts` |
| ZOOM-01 — zoom | Selettore e scroll, caret/selezione, larghezza fisica e futuro numero di pagine | Da confrontare nei casi combinati | `RichTextEditor.tsx`, `TypographySelects.tsx` |
| AUTO-01 — conversioni | Typography e SmartArrows da tastiera, undo | Da inventariare per sequenza e confrontare | `editorExtensions.ts`, Typography |
| IMPORT-01 — altri nodi correnti | Apice/pedice, codice inline/blocco, titolo 6 importato, tastiera | Distinguere percorsi raggiungibili e registrazione dello schema; non aggiungere toolbar | StarterKit, Subscript/Superscript, CustomHeading |
| VIDEO-01 — YouTube | Pulsante e embed importato | Equivalente Docs non verificato; conversione nativa ripiega su HTML | Youtube, `InsertDropdownButton.tsx`, `editorClipboard.ts` |
| MIX-01 — ripiego dell’intero frammento | Aggiungere formula non rappresentabile/video/immagine wrap con didascalia al corpus | Caso matrice misurato in MIX-02: formule appiattite e interlinea diversa. Video e immagini con didascalia ancora da provare | `createNativeClipboardFormats` |
| ROUNDTRIP-01 — percorso inverso | Docs → app → salva → riapri, con strutture miste | Parser HTML conserva ora gli stili coperti; equazioni native, interlinea e altri attributi ancora aperti | Import, schema, persistenza |
| PAGE-01 — pagine e numerazione (rinviato) | Perimetro futuro: A4, margini, paragrafo lungo, lista annidata, tabella multipagina, wrap a fondo pagina, caret/undo | Fuori dal lavoro corrente e dai suoi criteri di completamento; editor continuo. Prototipo, rapporto e artefatti di questa chat rimossi su richiesta. Rivalutare dopo l'accettazione delle funzioni correnti e del trasferimento nella build desktop | Fase P rinviata nel piano; nessuna integrazione corrente |
| DESKTOP-01 — appunti nativi | Copia/taglio/incolla nella build WebView2 e WKWebView reale | Da verificare; nessuna prova browser chiude questo requisito | Runtime desktop |

## Verifica ripetibile del primo gruppo

```powershell
npm --prefix webui run test -- src/editorParity.dom.test.tsx src/components/EditorContextMenu.dom.test.tsx src/hooks/useEditorImageDrop.dom.test.tsx src/editorClipboard.dom.test.ts
```

Da `webui/`:

```powershell
npx playwright test e2e/editor_images.spec.ts --grep 'copy and cut keep|context paste preserves|text-only copy exports standalone|native copy retains body|native copy preserves paragraph'
```

Prima della consegna: gate completo con copertura, build frontend e `git diff
--check`, come richiesto dal piano. I casi aperti non vengono chiusi perché
questi controlli sono verdi.

Risultati del primo gruppo al 3 ottobre 2026:

- Gate completo passato: lint, formattazione, typecheck backend/frontend e suite
  con copertura. Frontend: 93 file, 1.094 test; linee 84,35%, branch 74,43%,
  funzioni 78,05%. Backend: copertura 88,25%, sopra la soglia richiesta dell’85%.
- Cinque casi Playwright passati: copia/taglio misti, incolla dal menu,
  HTML autonomo e due regressioni di interlinea/spaziatura. Gli ultimi cinque
  casi sono stati eseguiti in due gruppi di tre e due test.
- Build frontend di produzione passata; controllo degli spazi della diff passato.
- Prova DOCS-01 completata con incolla reale, salvataggio, riapertura e
  rilettura delle proprietà campionate.

Questi risultati chiudono il primo gruppo di correzioni descritto sopra.
Le fasi del piano restano aperte fino all’esecuzione dei rispettivi casi.

## Verifica del secondo gruppo

Ripetere i test DOM includendo `editorParity.dom.test.tsx`,
`documentFormatting.dom.test.ts`, `editorClipboard.dom.test.ts`,
`editorExtensions.dom.test.tsx` e il test del bubble menu. Eseguire poi l’intera
suite `npx playwright test e2e/editor_images.spec.ts` da `webui/`, oltre al gate
e alla build richiesti dal piano.

Risultati del secondo gruppo al 3 ottobre 2026:

- Gate completo passato: backend 88,25%; frontend 93 file e 1.102 test,
  linee 84,49%, branch 74,45%, funzioni 78,28%.
- Build frontend di produzione passata; `git diff --check` passato.
- Suite browser completa dell’editor: 18 casi passati, inclusi copia/incolla,
  i quattro controlli di rimozione della formattazione e le regressioni dei
  gesti sulle immagini. Log locale: `profile-browser-delivery.log`.
- PROFILE-02: dieci campioni uguali alla fonte dopo incolla e dopo riapertura
  del documento salvato in Docs. Sono valori di stile, non misure di a capo.
- MIX-02: incolla reale senza HTML escapato o duplicazione delle formule;
  interlinea e modificabilità matematica rimangono incompatibilità aperte.

La fase 1 non è chiusa: mancano gli altri gesti e le selezioni miste. Pagine,
numerazione, editing matematico strutturato e prova desktop restano aperti.

## Verifica del terzo gruppo

Il riferimento Docs distingue tre comportamenti: la selezione parziale rimuove
la tipografia dei caratteri senza cambiare il layout del paragrafo; il cursore
vuoto modifica lo stile della digitazione successiva preservando il testo
esistente; la selezione di tutto il testo ripristina anche il layout del blocco.
Nella selezione su tre paragrafi vengono ripristinati solo quelli interamente
selezionati. Il titolo parziale usa lo stile predefinito del suo livello
(Arial 16 per il titolo 2 osservato), conservando il layout esplicito.

`clear-reference-readback.json` conserva le proprietà del riferimento e
`clear-transfer-readback.json` quelle dei due risultati dell’app dopo incolla
e riapertura. Gli appunti generati da Ctrl+C nel test Playwright sono trasferiti
senza conversione al browser integrato e incollati normalmente in Docs. Questa
procedura verifica il destinatario, ma non gli appunti di WebView2/WKWebView.
Il confronto riguarda font/dimensioni/peso/corsivo/colore dei campioni e
centratura, interlinea 1,6, spazio prima 8 pt e dopo 10 pt. La vista finale è
`clear-docs.png`; la rilettura delle proprietà dopo riapertura è identica.
Otto confronti fra i valori della fonte e quelli riletti dopo riapertura
coincidono: tre campioni di testo e lo stile del paragrafo per ciascun risultato.

Per ripetere:

```powershell
npm --prefix webui run test -- src/editorParity.dom.test.tsx src/components/EditorContextMenu.dom.test.tsx src/components/EditorBubbleMenu.dom.test.tsx
```

Da `webui/`, eseguire `npx playwright test e2e/editor_images.spec.ts`, il gate
con copertura e la build. Le nuove regressioni fallivano prima della correzione
per la perdita di allineamento/interlinea/margini.

Risultati del terzo gruppo al 3 ottobre 2026:

- Gate completo passato: frontend 93 file e 1.104 test, linee 84,50%, branch
  74,69%, funzioni 78,38%; backend 88,26%, sopra la soglia richiesta dell’85%.
- Test DOM mirati: 37 passati in tre file.
- Due casi browser mirati passati: i quattro controlli su documento intero e
  il nuovo caso con selezione parziale, cursore, digitazione, copia, undo e
  incolla di ritorno. Altezza e margini del paragrafo conservati nel caso browser.
- Suite browser completa dell’editor: 19 casi passati, comprese le regressioni
  delle immagini. Log: `clear-browser.log`.
- Build frontend e `git diff --check` passati; gate in `clear-project-check.log`.
- MIX-03 conserva le prove delle varianti HTML senza dichiarare risolto MIX-02.

Restano aperti gli altri gesti di testo/elenchi, geometria delle tabelle e delle
immagini, formule complesse, pagine/numerazione e verifica nella build desktop.

## Verifica del quarto gruppo

Il riferimento matematico è nella scheda 4 del documento sintetico; il corpus
dell’app è nella [scheda 5](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.6i5xopvs3prt).
Il menu e le scorciatoie native di Docs producono marcatori distinti per le
funzioni nominate e quelle con argomenti. Il limite inferiore ordinario usa
`lima` con un argomento; la sommatoria con due estremi usa `sumab`.
Il convertitore riconosce ora gli estremi anche nel MathML inline (`msub`,
`msup`, `msubsup`), oltre a quello in blocco (`munder`, `mover`, `munderover`).

Le sedici funzioni nominate provate sono `sin`, `cos`, `tan`, `arcsin`,
`arccos`, `arctan`, `sinh`, `cosh`, `tanh`, `coth`, `csc`, `sec`, `cot`, `ln`,
`log` ed `exp`. Nomi e stili non verificati impongono il ripiego,
evitando una formula nativa che abbia perso la tipografia o il significato.
MIX-02 non è risolto da questa correzione.

Il [corpus](../webui/e2e/fixtures/editor-parity-equations.html) contiene nove
equazioni, fra cui una frazione con seno al quadrato e logaritmo in base 2,
insieme a titolo, colore/evidenziatura, lista 4–5 e due celle. I formati di
Ctrl+C nel test Playwright sono incollati senza conversione nel browser
integrato. Dopo salvataggio e riapertura, i 26 comandi matematici mantengono
le posizioni e gli argomenti della fonte; i dieci campioni mantengono font,
dimensioni, colore/evidenziatura e proprietà del paragrafo. Docs conserva anche
il paragrafo vuoto già presente nella destinazione dopo il corpus: la rilettura
ha quindi un ritorno a capo terminale in più, distinto dal testo copiato.

La prova di modificabilità entra nella formula `sin x` con le frecce, elimina
`x` e digita `y`. La funzione nativa rimane `sin`; due annullamenti, uno per
digitazione e uno per eliminazione, ripristinano la fonte. Questa prova non
certifica tutti i gesti nelle altre strutture né l’editing delle formule nell’app.

Evidenze in `_smoke/editor-parity/`: `equations-reference-readback.json`,
`equations-transfer-readback.json`, `equations-docs.png`, appunti/screenshot in
`equations-playwright/` e log `equations-*.log`. Le riletture archiviate contengono
soltanto il corpus sintetico e le proprietà selezionate, senza ID Docs privati.

Per ripetere i controlli mirati:

```powershell
npm --prefix webui run test -- src/clipboardEquations.dom.test.ts src/editorClipboard.dom.test.ts
```

Da `webui/`: `npx playwright test e2e/editor_images.spec.ts`. Il nuovo caso
verifica copia/taglio identici, undo e incolla di ritorno con sorgenti LaTeX,
colore/evidenziatura e proprietà native dei paragrafi conservati. L’HTML
portabile materializza gli stili predefiniti: la rilettura del modello può
quindi avere attributi espliciti diversi pur conservando i valori verificati.

Risultati del quarto gruppo al 3 ottobre 2026:

- Diciannove nuove regressioni matematiche fallivano prima della correzione.
- Test DOM mirati: 77 passati in due file.
- Gate completo passato: frontend 93 file e 1.130 test; linee 84,54%, branch
  74,76%, funzioni 78,41%. Backend: copertura 88,26%.
- Suite browser completa dell’editor: 20 casi passati, incluse immagini,
  drag/resize e i gruppi precedenti. Log `equations-full-browser.log`.
- Build frontend, lint/typecheck finali e `git diff --check` passati.

Geometria matematica a parità di larghezza utile, altre formule e selezioni,
ripiego HTML, percorso inverso delle equazioni e build desktop restano aperti.

## Verifica del quinto gruppo

Il riferimento da tastiera è nella scheda 6 del documento sintetico. Docs
annida la seconda voce con Tab e torna al livello principale con due Enter;
altri due Enter escono dalla lista. I suoi nuovi livelli usano decimali,
lettere minuscole e numeri romani minuscoli. La scheda 7 confronta i cinque
tipi di marcatore: Docs ignora il solo `ol[type]`, mentre CSS `list-style-type`
sul contenitore e sui suoi figli conserva il tipo. La conversione nativa usa
i valori osservati 3/4/5/6/7 per decimal/upper-alpha/lower-alpha/upper-roman/lower-roman.

Il [corpus degli elenchi](../webui/e2e/fixtures/editor-parity-lists.html) viene
incollato nell'app e ricopiato con Ctrl+C. Gli stessi formati sono trasferiti
senza conversione nel browser integrato, nella
[scheda 8](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.6zq41lwgd6hg).
I 21 paragrafi conservano tipi, livelli, numeri iniziali, interlinea, spazi e
rientri alla fonte, dopo incolla e dopo riapertura. L'interlinea è 1,15;
il testo parte a 36/72/108 pt nei tre livelli. Le continuazioni non hanno
marcatori e non consumano il numero successivo: la lista principale rimane
D–E, quella romana annidata ii–iii, la nipote parte da c. Le altre liste
mostrano c–d, iii–iv, III–IV e punti. Come nel quarto gruppo, Docs conserva
anche il paragrafo vuoto preesistente in fondo alla destinazione.

Il test browser verifica che i tipi importati siano visibili nell'app, copia e
taglio identici, undo e incolla di ritorno con topologia, tipo e numero iniziale
conservati. La preparazione HTML materializza gli stili predefiniti, perciò
il modello riaperto può avere attributi espliciti aggiuntivi. Da un documento
vuoto il test usa le scorciatoie reali: lista numerata, Tab, annulla/ripristina,
Shift+Tab, Shift+Enter e doppio Enter per risalire e uscire.
La regressione backend dimostra separatamente che la sanitizzazione del
salvataggio conserva `start` e `type`, prima eliminati.

La [scheda 9](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.d54l9w3zfiii)
contiene lo stesso HTML portabile senza formato nativo. La prova dopo incolla
mantiene i marcatori alfabetici/romani, ma Docs unisce i primi due paragrafi
della voce con un ritorno morbido e numera la continuazione dopo la sottolista:
la voce seguente diventa F anziché E. L'interlinea è ancora 1,38. Questo
percorso resta incompatibile; le prove native non lo certificano.

Evidenze locali in `_smoke/editor-parity/`: `lists-reference-readback.json`,
`lists-transfer-readback.json`, `lists-html-readback.json`, `lists-docs.png`
e appunti/screenshot Playwright in `lists-playwright/`. I readback salvati
contengono soltanto testo sintetico e proprietà selezionate, senza payload
privati o credenziali. Il confronto della geometria dei marcatori e degli a
capo a parità di larghezza utile resta aperto.

Risultati del quinto gruppo al 3 ottobre 2026:

- Sei regressioni DOM e una backend fallivano prima delle correzioni.
- Test mirati: 75 DOM in tre file e 41 backend nel file HTML export.
- Gate completo passato: frontend 93 file e 1.136 test; linee 84,61%, branch
  74,77%, funzioni 78,54%. Backend: copertura 88,26%.
- Suite browser completa dell'editor: 21 casi passati, comprese immagini,
  drag/resize, formule e i gruppi precedenti.
- Build frontend, lint, typecheck e `git diff --check` passati.

Restano aperti i marcatori predefiniti delle nuove liste annidate, selezioni
parziali, divisioni/unioni, liste miste, il ripiego HTML e il percorso inverso
completo. Questi casi non chiudono LIST-01 né la fase 3. Impaginazione,
numerazione delle pagine e prove desktop WebView2/WKWebView restano aperte.

## Verifica del sesto gruppo

La scheda 10 aggiunge il riferimento dei gesti. Tab all'inizio del testo crea
livelli numerici, alfabetici minuscoli e romani minuscoli; dentro il testo
inserisce una tabulazione. La copia di una sola parola non porta il marcatore
né un confine di paragrafo. Il rientro ereditato in questa scheda non viene
usato come misura dei default: il confronto dei rientri usa la scheda 11 e
gli appunti dell'app, con valori espliciti 36/72/108 pt.

Le prove principali usano gli appunti catturati dai gesti Playwright dell'app,
trasferiti senza conversione nel browser integrato:

- [Scheda 11](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.7hdehzy23anq):
  quattro paragrafi creati con scorciatoia, Enter, Tab e Shift+Tab. Marcatori
  1/a/i/b, livelli 0/1/2/1, inizi da 1, rientri 36/72/108/72 pt e interlinea
  1,15 coincidono alla fonte, dopo incolla e dopo riapertura.
- [Scheda 12](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.75lm8fx41cdf):
  selezione delle ultime due voci di una lista A iniziata da 4. Il frammento
  conserva inizio 5, mostra E–F e resta identico dopo riapertura. Copia/taglio
  identici e annullamento sono verificati nel browser dell'app.
- [Scheda 13](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.91o1vridiyfc):
  la parola `Seconda` viene incollata tra `PRIMA ` e ` DOPO`. Dopo incolla e
  riapertura rimane un solo paragrafo `PRIMA Seconda DOPO`, senza marcatore,
  con rientro zero e interlinea 1,15. Gli appunti dell'app contengono solo la
  parola, senza newline aggiunta. Il test DOM del titolo parziale continua
  a verificare font, dimensione, colore e corsivo ereditati.

Il nuovo `EditorListItem` conserva le tabulazioni nel salvataggio HTML tramite
`white-space:pre-wrap` e una regola di parsing limitata a quel valore. Senza
questa regola ProseMirror eliminava la tabulazione finale anche quando il
rendering manteneva lo spazio. Le regressioni DOM coprono liste numerate e
puntate, undo singolo e rilettura; il browser prova anche l'incolla HTML di
ritorno. La posizione geometrica dei tab stop non è certificata.

Le nuove liste figlie ricevono il tipo nella stessa transazione del gesto.
Una lista figlia importata già esistente mantiene tipo e inizio; non vengono
riscritti i marcatori dei vecchi documenti durante altre modifiche. Le prove
DOM coprono anche `can()` senza mutazioni e inizi distinti fra liste separate.
La preparazione del testo semplice elabora i discendenti prima di `li`/`tr`,
evitando i separatori duplicati fra voci e continuazioni.

Backspace all'inizio di `Seconda` nella lista annidata del riferimento rimuove
il marcatore e mantiene il paragrafo separato. Al termine del sesto gruppo il
keymap dell'app poteva unire il testo o risalire il livello. Il settimo gruppo
corregge i casi delimitati da LIST-07, descritti sotto. Restano aperti anche
annidamento della prima voce, selezioni fra livelli misti e attraverso altri
oggetti, split/merge generale, ripiego HTML e percorso inverso completo.

Evidenze in `_smoke/editor-parity/`: `list-gestures-reference-readback.json`,
`list-gestures-transfer-readback.json`, `list-gestures-docs.png`,
`list-selection-inline-docs.png` e le cartelle Playwright del gruppo. I readback
contengono solo testo sintetico e proprietà selezionate, senza payload privati,
ID di entità Docs o credenziali.

Risultati del sesto gruppo al 3 ottobre 2026:

- Tre regressioni DOM iniziali riproducono marcatori, inizio della selezione
  e marcatore spurio sulla parola. Due ulteriori regressioni riproducono la
  perdita della tabulazione durante la rilettura HTML.
- Test DOM mirati: 85 passati in quattro file.
- Gate completo passato: frontend 94 file e 1.146 test; linee 84,73%, branch
  75,00%, funzioni 78,76%. Backend: copertura 88,25%.
- Suite browser completa dell'editor: 22 casi passati, inclusi i gruppi
  precedenti, formule, immagini, drag/resize e ritorno HTML con tabulazione.
- Build frontend, lint, typecheck e `git diff --check` passati.

Questi risultati non chiudono LIST-01, la fase 3 o il piano generale.
Impaginazione, numeri di pagina, combinazioni delle altre funzioni e prove
desktop WebView2/WKWebView rimangono aperti.

## Verifica del settimo gruppo

LIST-07 copre il primo Backspace all'inizio del primo paragrafo di una voce
composta soltanto da paragrafi o titoli. Il riferimento nativo Docs è registrato
nella scheda 16, creata vuota per evitare rientri ereditati dalle altre prove:
il marcatore della seconda voce viene rimosso, il testo rimane separato a 36 pt
e la voce successiva diventa 2. La scheda 15 misura il caso annidato: il primo
Backspace conserva 72 pt; il secondo azzera il rientro a 0 pt. Quest'ultimo
gesto è registrato come differenza aperta e non è incluso nella correzione.
La scheda 14 conserva l'esplorazione iniziale con formattazione ereditata;
non viene usata come misura dei default.

Il comando dell'app solleva i paragrafi fuori dalla lista interessata,
conservando i loro mark/stili e il rientro perduto come `margin-left:36pt`.
Nel caso annidato rimangono dentro la voce madre, senza crearne una nuova.
Il frammento successivo di elenco mantiene il tipo e parte dal numero corretto,
contando soltanto i marcatori superstiti. La conversione nativa somma il margine
del paragrafo al rientro del contenitore; il salvataggio HTML già conserva lo
stile, e l'estensione del documento ora lo rilegge. Il gesto costituisce una
sola transazione annullabile, con cursore all'inizio del testo estratto.
La copia di una parola dal paragrafo rientrato conserva la tipografia senza
trasferire `margin-left` al nuovo span inline: una regressione DOM riproduceva
il margine spurio e il caso browser verifica HTML senza rientro e testo semplice
senza newline. Questo non certifica il ripiego HTML dell'intero elenco.

Gli appunti prodotti da Ctrl+C nel test Playwright sono trasferiti senza
conversione al browser integrato e incollati normalmente in due schede nuove:

- [Scheda 17](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.dsh7zx3iokhs):
  D per `Prima`, `Seconda` in grassetto senza marcatore a 36 pt, E per `Terza`.
  Tre paragrafi e interlinea 1,15 conservati dopo incolla e riapertura.
- [Scheda 18](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.4m02hw1o0v2l):
  lista principale 1–2, figlia d–e e `Seconda` senza marcatore a 72 pt.
  Cinque paragrafi, livelli, tipi, inizi e interlinea 1,15 conservati dopo
  incolla e riapertura. Il numero iniziale dell'entità principale è 1 anche
  per `Ultima`: il numero visibile 2 dipende dalla voce precedente, non da
  un nuovo inizio.

Le proprietà dei tre/cinque paragrafi coincidono alla fonte, dopo incolla e
dopo riapertura; un valore `ts_bd` assente in Docs viene confrontato come falso.
Docs conserva inoltre il paragrafo vuoto preesistente dopo il corpus, escluso
dal confronto dei testi. Il browser dell'app verifica posizione orizzontale
prima/dopo il gesto, grassetto, undo/redo e rilettura dell'HTML copiato.

Evidenze locali in `_smoke/editor-parity/`: `backspace-reference-readback.json`,
`backspace-transfer-readback.json`, `backspace-root-docs.png`,
`backspace-nested-docs.png`, `backspace-playwright/` e `backspace-full-playwright/`.
I readback contengono soltanto testo sintetico e proprietà selezionate, senza
ID di entità Docs, payload privati o credenziali.

Per ripetere i controlli mirati:

```powershell
npm --prefix webui run test -- src/editorLists.dom.test.ts src/documentFormatting.dom.test.ts src/editorClipboard.dom.test.ts src/editorParity.dom.test.tsx
```

Da `webui/`: `npx playwright test e2e/editor_images.spec.ts`. Il caso dedicato
si seleziona con `--grep 'list Backspace'`. Eseguire anche il gate con copertura,
la build e `git diff --check`, come richiesto dal piano.

Risultati del settimo gruppo al 3 ottobre 2026:

- Tre regressioni iniziali riproducono perdita del rientro e risalita impropria
  del testo annidato. Altri test coprono prima voce, tipo/inizio importati,
  elenchi puntati, più paragrafi, mark, cursore e selezione non collassata.
- Test DOM mirati: 93 passati in quattro file.
- Gate completo passato: frontend 94 file e 1.154 test; linee 84,81%, branch
  75,04%, funzioni 78,81%. Backend: copertura 88,26%.
- Suite browser completa dell'editor: 23 casi passati, inclusi gruppi precedenti,
  formule, immagini e drag/resize. Log `backspace-full-browser.log`.
- Build frontend, lint, typecheck e `git diff --check` passati; gate in
  `backspace-project-check.log`.

Voci con sottoliste, tabelle, citazioni o altri blocchi mantengono il percorso
del motore e richiedono un contratto dedicato per la separazione e gli ancoraggi.
Alla consegna del settimo gruppo, secondo Backspace, Delete, split/merge generale,
annidamento della prima voce, selezioni miste, ripiego HTML e percorso inverso
restavano aperti. Questi risultati
non chiudono LIST-01, la fase 3 o il piano generale; impaginazione, numerazione
delle pagine e prove desktop WebView2/WKWebView rimangono aperte.

## Verifica dell'ottavo gruppo

LIST-08 completa il secondo Backspace all'inizio del paragrafo senza marcatore.
Il riferimento è stato riprodotto da tastiera in due schede Docs nuove:

- [Scheda 19](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.pg9n6j3uftl1):
  lista 1–2, paragrafo centrale senza marcatore a 0 pt dopo due Backspace.
- [Scheda 20](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.kmxaiw79wuib):
  lista principale 1–2 e figlia a–b; il paragrafo centrale va a 0 pt, mentre
  entrambe le liste conservano livello e numerazione.

Nell'app il primo livello eliminava il confine con il testo precedente; le
continuazioni annidate mantenevano il margine. Quattro regressioni iniziali
coprono queste differenze in liste numerate/puntate e con uno/due contenitori
antenati. Il comando ora modifica soltanto il rientro del paragrafo al cursore.
Al primo livello rimuove `margin-left`; dentro una voce madre lo imposta a
`-36pt` per ogni lista antenata, compensando il padding dei contenitori.
La struttura rimane intatta, quindi le liste figlie successive conservano tipo,
livello e inizio. Gli altri stili e mark restano; un undo ripristina il risultato
del primo Backspace. Il gesto non intercetta selezioni né un cursore dentro il
testo, e si applica solo a paragrafi/titoli al livello principale o direttamente
dentro una voce. Il Backspace su un paragrafo già a 0 pt resta al motore e non è
certificato da questo gruppo.

La prova browser usa due voci con un ulteriore paragrafo di continuazione:
azzera il rientro soltanto di `Seconda`, conserva quello di `Continuazione`,
verifica la posizione sul margine utile, il grassetto e il cursore con una
digitazione successiva (`XSeconda`), undo/redo e rilettura dell'HTML copiato.
Per il caso annidato il margine compensativo sopravvive al parsing HTML e
l'adattatore nativo produce `ps_il:0` e `ps_ifl:0`.

Gli appunti prodotti da Ctrl+C nel browser dell'app sono incollati senza
conversione in due schede Docs vuote, poi ricopiati e confrontati dopo riapertura:

- [Scheda 21](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.65ryq6ch3s04):
  quattro paragrafi, D–E, `Seconda` in grassetto a 0 pt, continuazione a 36 pt.
- [Scheda 22](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.3kfqny7lv9mb):
  sei paragrafi, lista principale 1–2, figlia D–E, `Seconda` in grassetto a 0 pt
  e continuazione a 72 pt.

Le proprietà campionate (testo, rientri sinistro/prima riga, interlinea 1,15,
presenza del marcatore, livello, tipo/inizio e grassetto) coincidono fra fonte,
incolla e riapertura. Il paragrafo vuoto di destinazione è escluso dal confronto.
Questo verifica il trasferimento nativo dei corpus delimitati, senza chiudere
le differenze del ripiego HTML puro in Docs o il percorso inverso.

Evidenze in `_smoke/editor-parity/`: `second-backspace-reference-readback.json`,
`second-backspace-transfer-readback.json`, `second-backspace-root-docs.png`,
`second-backspace-nested-docs.png`, `second-backspace-playwright/` e
`second-backspace-full-playwright/`. I readback conservano solo testo sintetico
e proprietà campionate, senza identificatori interni Docs o credenziali.

Controlli dell'ottavo gruppo al 3 ottobre 2026:

- Test DOM mirati: 98 passati in quattro file, cinque casi aggiunti.
- Gate completo passato: frontend 94 file e 1.159 test; linee 84,84%, branch
  75,05%, funzioni 78,81%. Backend: copertura 88,25%.
- Suite browser completa dell'editor: 24 casi passati, compresi tutti i gruppi
  precedenti, formule, immagini e drag/resize. Un caso aggiunto per i due livelli.
- Build frontend, lint, typecheck e controllo della diff passati. Log
  `second-backspace-project-check.log`, `second-backspace-full-browser.log` e
  `second-backspace-build.log`.

Per ripetere usare gli stessi quattro file DOM del settimo gruppo e la suite
`e2e/editor_images.spec.ts`; il caso nuovo si seleziona con
`--grep 'second list Backspace'`. Eseguire anche gate, build e controllo della
diff secondo il piano.

Alla consegna dell'ottavo gruppo restavano aperti il terzo Backspace, Delete e
split/merge generali, il primo
Backspace sulle voci con sottoliste/altri blocchi, annidamento della prima voce,
selezioni miste, ripiego HTML e percorso inverso. Impaginazione, numeri di pagina
e prove desktop WebView2/WKWebView rimangono aperti. LIST-08 non chiude LIST-01,
la fase 3 o il piano generale.

## Verifica del nono gruppo

LIST-09 completa il terzo Backspace sul paragrafo portato a zero rientro da
LIST-08. Il riferimento è stato riprodotto da tastiera in Docs:

- [Scheda 23](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.4ok17urkuj8u):
  dopo tre Backspace `PrimaSeconda` è una sola voce; `Terza` segue col numero 2.
- [Scheda 24](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.lbelx6tcq366):
  `FigliaSeconda` mantiene il marcatore della figlia e `Terza` il successivo.
  Il testo `Seconda` rimane in grassetto.
- [Scheda 25](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.1kneb5yfxft9) e
  [scheda 26](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.pwm2rq7njqsd):
  appunti del secondo gesto incollati in Docs e uniti da tastiera con Backspace,
  mantenendo le continuazioni successive. Nel caso di primo livello una `X`
  digitata immediatamente al punto di unione eredita il testo precedente senza
  grassetto; un undo rimuove soltanto la digitazione e conserva la fusione.

Tre regressioni DOM iniziali riproducono le differenze: il motore univa già
il testo al primo livello, ma lo stesso undo annullava anche l'azzeramento del
rientro; nel caso annidato non univa il testo alla voce figlia precedente.
Il comando ora rimuove il paragrafo senza marcatore e inserisce il suo contenuto
inline alla fine del blocco di testo precedente. Se il fratello precedente è
una lista, segue soltanto i contenitori lista/voce fino all'ultimo
paragrafo/titolo. Mantiene gli attributi del blocco destinatario e i mark dei
contenuti, quindi il testo unito riprende il marcatore e il rientro precedenti.
Gli altri paragrafi di continuazione e le liste successive restano intatti.
Il caret è posto al punto di unione; un undo torna al secondo gesto.
La chiusura della cronologia dopo la fusione è una transazione senza modifica
del documento e separa anche la digitazione immediatamente successiva.

Il comando si applica con selezione vuota all'inizio di un paragrafo/titolo
senza marcatore, a rientro totale zero, direttamente nella voce o al livello
principale dopo una lista. Gli oggetti e i contenitori diversi da lista/voce
restano al motore; la loro fusione non è certificata da questo gruppo.
Non è certificata la combinazione di stili diretti diversi fra i due blocchi.

Il test browser esegue tutti e tre i gesti su due corpus, controllando posizione
del testo destinatario, grassetto, caret, digitazione immediata e relativi undo,
redo della fusione, rientro della continuazione, numero iniziale del frammento
successivo, copia da tastiera e rilettura HTML. Tre test DOM aggiunti coprono
liste numerate/puntate al primo livello e lista figlia numerata, con undo/redo
e persistenza degli stessi risultati.

Gli appunti prodotti da Ctrl+C nel browser dell'app sono incollati senza
conversione in due schede Docs vuote e riletti dopo salvataggio e riapertura:

- [Scheda 27](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.10foi21srnvc):
  tre paragrafi; `FigliaSeconda` con D, continuazione senza marcatore a 36 pt,
  `Terza` con E.
- [Scheda 28](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.8srmkdhrq4ls):
  cinque paragrafi; lista principale 1–2, figlia D–E, `FigliaSeconda` e
  continuazione a 72 pt.

Testo, rientri sinistro/prima riga, interlinea 1,15, marcatori, livelli,
tipo/inizio e grassetto per carattere coincidono fra app, gesto Docs,
incolla e riapertura. Il grassetto è letto espandendo i cambi di stile sparsi,
senza interpretare una voce nulla come rimozione dello stile. Il paragrafo
vuoto di destinazione è escluso dal confronto. Il trasferimento nativo è
verificato per questi corpus; il ripiego HTML puro in Docs rimane aperto.

Evidenze in `_smoke/editor-parity/`: `third-backspace-reference-readback.json`,
`third-backspace-transfer-readback.json`, `third-backspace-root-docs.png`,
`third-backspace-nested-docs.png`, `third-backspace-playwright/` e
`third-backspace-full-playwright/`. I readback conservano solo testo sintetico
e proprietà campionate, senza identificatori interni Docs o credenziali.

Controlli del nono gruppo al 3 ottobre 2026:

- Test DOM mirati: 101 passati in quattro file, tre casi aggiunti.
- Gate completo passato: frontend 94 file e 1.162 test; linee 84,88%, branch
  75,14%, funzioni 78,81%. Backend: copertura 88,25%.
- Suite browser completa dell'editor: 25 casi passati, inclusi tutti i gruppi
  precedenti, formule, immagini e drag/resize. Un caso aggiunto per i due livelli.
- Build frontend, lint, typecheck e controllo della diff passati. Log
  `third-backspace-project-check.log`, `third-backspace-full-browser.log` e
  `third-backspace-build.log`.

Per ripetere usare gli stessi quattro file DOM dell'ottavo gruppo e la suite
`e2e/editor_images.spec.ts`; il nuovo caso si seleziona con
`--grep 'third list Backspace'`. Eseguire anche gate, build e controllo della
diff secondo il piano.

Alla consegna del nono gruppo restavano aperti Delete e split/merge generali, primo Backspace sulle voci con
sottoliste/altri blocchi, annidamento della prima voce, selezioni miste, stili
diretti diversi nei blocchi uniti, ripiego HTML e percorso inverso.
Impaginazione, numeri di pagina e prove desktop WebView2/WKWebView rimangono
aperti. LIST-09 non chiude LIST-01, la fase 3 o il piano generale.

## Verifica del decimo gruppo

LIST-10 verifica Canc alla fine di una voce di elenco, prima di un'altra voce
della stessa lista. Nei due corpus entrambe le voci contengono solo paragrafi;
la seconda include `Seconda` in grassetto e una `Continuazione` senza marcatore.
Il primo corpus ha lista numerata 1–3, il secondo una lista figlia a–c dentro
la voce 1, seguita dalla voce principale 2.

La fusione standard era già corretta: `FigliaSeconda`, grassetto del testo
spostato conservato, caret dopo `Figlia`, continuazione separata e numero della
voce successiva ridotto di uno. La differenza riprodotta riguarda la cronologia:
digitando subito dopo Canc, un solo undo nell'app annullava insieme carattere e
fusione. In Docs l'undo della digitazione mantiene il testo unito; il successivo
undo separa nuovamente le voci.

`editorLists.ts` mantiene lo stesso join ProseMirror di profondità 2 e apre
un confine nella cronologia prima/dopo la transazione. Il comando intercetta
solo una selezione vuota alla fine dell'ultimo paragrafo di una voce, con una
voce successiva nella stessa lista, quando entrambe contengono solo paragrafi.
Elenchi puntati e numerati condividono il comportamento. Titoli, oggetti,
sottoliste dentro le voci e attraversamenti di livello mantengono il percorso
standard e restano da confrontare. Canc nel testo e su selezioni mantiene il
normale percorso di cancellazione.

Quattro regressioni DOM coprono elenchi numerati/puntati, lista figlia importata
con tipo A e inizio 4, mark, continuazioni, appunti nativi, serializzazione,
undo/redo e selezione. La regressione falliva prima della correzione. Il caso
browser verifica i due livelli con digitazione prima/dopo Canc, undo separati,
redo, caret al punto di fusione, geometria del testo, grassetto, conservazione
della continuazione, copia da tastiera e rilettura HTML.

Il confronto reale usa il browser integrato nella chat. Il riferimento è
preparato nativamente con le API Docs e modificato con Canc nell'interfaccia:

- [Riferimento primo livello](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.hi6716r5fz69).
- [Riferimento annidato](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.by9gmswhrk17).

Gli appunti prodotti da Ctrl+C nel browser dell'app vengono incollati senza
conversione nelle nuove schede vuote e riletti dopo salvataggio e riapertura:

- [Copia app primo livello](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.w2g6f8prms7t):
  tre paragrafi, `FigliaSeconda` con 1, continuazione senza marcatore a 36 pt,
  `Terza` con 2.
- [Copia app annidata](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.e70guyfgeu8s):
  cinque paragrafi, lista principale 1–2, figlia a–b; continuazione a 72 pt.

Testo, grassetto per carattere, rientri sinistro/prima riga, interlinea 1,15,
presenza del marcatore, livello e numero iniziale coincidono con il gesto Docs.
Gli appunti di fonte, incolla e riapertura coincidono anche nei codici nativi
dei marcatori. Il riferimento preparato via API usa invece `b_gt` 10/13 e
`b_gf` `%0.`/`%1.`, mentre l'app usa 3/5: si documenta questa differenza di
rappresentazione, senza chiamare uguali i payload. I marcatori visuali sono
1–2/a–b in entrambi i documenti. La lettura API della copia riporta
`GLYPH_TYPE_UNSPECIFIED`; la verifica del tipo usa gli appunti nativi riletti e
la vista Docs. Non si certificano qui tutte le proprietà dei marcatori.

Evidenze in `_smoke/editor-parity/`: `delete-transfer-readback.json`,
`delete-root-docs.png`, `delete-nested-docs.png`, `delete-playwright/` e
`delete-full-playwright/`. Il readback contiene testo sintetico e proprietà
campionate; esclude identificatori interni e credenziali.

Controlli del decimo gruppo al 3 ottobre 2026:

- Test DOM mirati: 105 passati in quattro file, quattro casi aggiunti.
- Gate completo passato: 94 file frontend, 1.166 test; linee 84,91%, branch
  75,16%, funzioni 78,82%. Backend: copertura 88,25%.
- Suite browser completa dell'editor: 26 casi passati, inclusi i gruppi
  precedenti, formule, immagini e drag/resize; un caso aggiunto per i due livelli.
- Build frontend, lint, typecheck e controllo della diff passati. Log
  `delete-project-check.log`, `delete-full-browser.log`, `delete-build.log`.

Per ripetere eseguire i quattro file DOM degli altri gruppi e
`e2e/editor_images.spec.ts`, selezionando il nuovo caso con `--grep 'list Delete'`.
Eseguire anche gate completo, build e controllo della diff secondo il piano.

Alla consegna del decimo gruppo restavano aperti Canc fra livelli diversi, voci con sottoliste/oggetti/titoli,
fusioni e divisioni generali, stili diretti diversi fra blocchi uniti, selezioni
miste, annidamento della prima voce, ripiego HTML in Docs e percorso inverso.
Impaginazione, numeri di pagina e prove desktop WebView2/WKWebView restano
aperti. LIST-10 non chiude LIST-01, la fase 3 o il piano generale.

## Verifica dell'undicesimo gruppo

LIST-11 estende Canc a tre confini con sottoliste di paragrafi. Il confronto
reale usa il browser integrato nella chat, il documento sintetico precedente e
schede nuove; conserva le schede e i corpus degli altri gruppi. Il riferimento
è preparato con le API native Docs e modificato con il tasto Canc. Il preset
numerato usa `NUMBERED_DECIMAL_ALPHA_ROMAN`, come nella
[documentazione delle richieste Docs](https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/request#BulletGlyphPreset).

| Confine | Differenza iniziale | Risultato verificato |
| --- | --- | --- |
| `Madre` → prima figlia `Figlia` | Il motore toglieva il marcatore ma lasciava `Figlia` su un paragrafo separato | `MadreFiglia` nella voce 1, `Figlia` in grassetto; `Sorella` resta figlia e diventa a; la seconda voce e la sua sottolista restano integre |
| Ultima figlia `Sorella` → voce principale `Seconda` | Il motore portava `Seconda` al livello figlio ma lasciava il suo testo separato | `SorellaSeconda` nella figlia b; `Nipote` e `Altra` proseguono nello stesso elenco con c/d, senza un ulteriore livello; `Ultima` diventa la voce principale 2 |
| `Prima` → voce `Seconda` con sottolista | Il join standard conservava la struttura ma raggruppava la digitazione successiva con la fusione | `PrimaSeconda` con `Seconda` in grassetto, sottolista a/b conservata sotto la voce unita, `Ultima` con 2; digitazione e fusione hanno undo distinti |

I primi due percorsi costruiscono una sola transazione strutturale e lasciano
il caret nella posizione iniziale di Canc. Il terzo mantiene il join standard.
Tutti aprono un confine di cronologia prima e dopo la fusione: undo della
digitazione mantiene il testo unito, undo successivo ripristina la struttura;
anche un carattere digitato prima di Canc rimane quando si annulla la fusione.
Redo, geometria del paragrafo di destinazione, grassetto e rilettura HTML sono
verificati nei tre corpus dal caso browser `cross-level list Delete`.

Dodici regressioni DOM verificano elenchi puntati e numerati, attraversamenti
nei due sensi anche sotto un ulteriore elenco esterno, caret, mark,
cronologia e livelli degli appunti. I casi supplementari coprono l'ultimo
figlio verso una voce senza sottolista e l'unico figlio con continuazione:
la continuazione mantiene il proprio rientro totale, compresi 12 pt diretti,
e i blocchi successivi mantengono l'ordine. Questi due casi supplementari sono
verificati automaticamente, senza un corpus di trasferimento reale dedicato.

Il percorso verso la prima figlia intercetta un paragrafo seguito da una lista
il cui primo elemento contiene soltanto paragrafi. Eventuali continuazioni
escono dalla lista rimossa con 36 pt compensativi di rientro. Il percorso nel
senso opposto attraversa un solo livello: l'ultima voce figlia deve essere di
paragrafi, la lista figlia deve chiudere la voce contenitrice, e la voce
successiva contiene un paragrafo ed eventualmente una lista dello stesso tipo
con gli stessi attributi e figli di soli paragrafi. Il join allo stesso livello
ammette anche sottoliste di paragrafi nella voce successiva. Titoli, oggetti,
ramificazioni nel primo figlio, più livelli attraversati, attributi discordanti
e altre combinazioni mantengono il percorso standard; non sono certificati qui.

Riferimenti del gesto:

- [Voce principale/prima figlia e ultima figlia/voce successiva](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.yse6px3d2y55).
- [Fusione con una voce che contiene una sottolista](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.h3b25z8k2mhi).

Gli appunti provengono da Ctrl+C nel browser dell'app dopo Canc e redo. Vengono
incollati senza conversione in schede Docs vuote, salvati, riaperti e ricopiati:

- [Prima figlia: sei paragrafi](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.7odhf6f8ovn0).
- [Ultima figlia: sei paragrafi](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.ymm3qjh9wsbl).
- [Voce con sottolista: quattro paragrafi](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.pmbmb9nyo5sg).

Per ogni paragrafo non vuoto coincidono fonte app, gesto Docs e ricopia dopo
riapertura: testo, livello, rientri sinistro/prima riga 36/18 e 72/54 pt,
interlinea nativa 1,15 e grassetto per carattere. Le run sparse degli appunti
Docs vengono espanse mantenendo l'ultimo stile applicato. L'API conferma testi,
livelli, rientri e run in grassetto nel documento salvato. I marcatori visuali
1–3/a–b, 1–2/a–d e 1–2/a–b coincidono. Non si confrontano gli identificatori
interni delle liste né si certificano tutte le proprietà dei marcatori. I
paragrafi vuoti finali del corpus/browser sono esclusi dal campione di stile.

Evidenze in `_smoke/editor-parity/`: `delete-levels-transfer-readback.json`,
`delete-levels-api-readback.json`, `delete-levels-parent-docs.png`,
`delete-levels-higher-docs.png`, `delete-levels-subtree-docs.png`,
`delete-levels-playwright/` e `delete-levels-full-playwright/`.
I readback campionati conservano soltanto contenuto sintetico e proprietà;
escludono identificatori privati e credenziali.

Controlli dell'undicesimo gruppo al 4 ottobre 2026:

- Test DOM degli elenchi: 40 passati, dodici casi aggiunti.
- Gate completo passato: 94 file frontend, 1.178 test; linee 85,03%, branch
  75,25%, funzioni 78,98%. Backend: copertura 88,25%.
- Suite browser completa dell'editor: 27 casi passati, incluso un caso nuovo
  che ripete i tre confini con cronologia, copia e serializzazione.
- Build frontend, lint, typecheck e controllo della diff passati. Log
  `delete-levels-project-check.log`, `delete-levels-full-browser.log`,
  `delete-levels-browser.log` e `delete-levels-build.log`.

Per ripetere eseguire `src/editorLists.dom.test.ts`, il gate completo e
`e2e/editor_images.spec.ts`; il nuovo caso si seleziona con
`--grep 'cross-level list Delete'`. Eseguire anche build e controllo della diff.

Alla consegna dell'undicesimo gruppo restavano aperti i confini di Canc non inclusi sopra, primo Backspace su voci
con sottoliste/altri blocchi, stili diretti diversi dei blocchi uniti,
divisioni/fusioni generali, selezioni miste, annidamento della prima voce,
ripiego HTML in Docs e percorso inverso. Impaginazione, numeri di pagina e
accettazione WebView2/WKWebView rimangono aperti. LIST-11 non chiude LIST-01,
la fase 3 o il piano generale.

## Verifica del dodicesimo gruppo

LIST-12 copre il primo Backspace all'inizio di una voce con sottolista,
preceduta da una voce composta soltanto da paragrafi/titoli. Il comportamento
standard del motore spezzava la lista e portava il ramo a un livello diverso.
Le quattro nuove regressioni DOM fallivano prima della correzione.

Il comando conserva i blocchi come continuazioni nella voce precedente:
`Prima` e `Seconda` restano paragrafi separati e `Seconda` perde solo il
marcatore. La lista figlia rimane alla stessa profondità, con tipo, start e
contenuto originali. Le voci successive contano soltanto i marcatori rimasti.
Il caret resta a offset zero in `Seconda`; la rimozione è una transazione con
confini di cronologia prima e dopo. Undo della digitazione conserva il ramo,
undo successivo ripristina le voci, redo ripete la rimozione.

| Corpus | Risultato Docs e app |
| --- | --- |
| Primo livello, cinque paragrafi | `Prima` con 1, `Seconda` senza marcatore a 36/36 pt, `Figlia`/`Sorella` con a/b a 72/54 pt, `Terza` con 2 |
| Annidato, sette paragrafi | `Madre` con 1, `Prima` con a, `Seconda` senza marcatore a 72/72 pt, `Figlia`/`Sorella` con i/ii a 108/90 pt, `Terza` con b e `Ultima` con 2 |

Il riferimento sintetico è preparato con API native Docs, poi modificato con
Backspace nel browser integrato nella chat. Non si alterano le schede degli
altri gruppi. Gli appunti dell'app sono prodotti con Ctrl+C dal nuovo caso
Chromium, trasferiti integralmente nella clipboard del browser integrato e
incollati realmente nelle due schede Docs vuote.

Cinque/sette paragrafi non vuoti coincidono per testo, grassetto per carattere,
livello, rientri e interlinea nativa 1,15 fra app, gesto di riferimento, incolla
e ricopia dopo salvataggio e riapertura. La lettura API conferma testo, run in
grassetto, livelli e rientri salvati; l'interlinea del trasferimento è rilevata
dagli appunti nativi, perché l'API non espone qui un override esplicito.
Marcatori e posizione sono osservati anche negli screenshot. Identificatori
interni delle liste e paragrafi vuoti finali non fanno parte del campione.

Riferimenti e destinazioni:

- [Primo livello, gesto Docs](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.vwssgxh4myzt).
- [Primo livello, copia app](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.v3vizigm6r6i).
- [Annidato, gesto Docs](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.16j0wso4w9xp).
- [Annidato, copia app](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.saaakqoc8ye).

Controlli al 4 ottobre 2026:

- Test DOM degli elenchi: 44 passati, quattro regressioni aggiunte per
  puntati/numerati, root/annidati, caret, grassetto, tipo/start importati,
  undo/redo, serializzazione e profondità degli appunti.
- Un nuovo caso browser ripete entrambi i corpus; i rettangoli dei paragrafi
  `Seconda`, `Figlia`, `Sorella` e `Terza` restano identici durante la rimozione.
  Verifica digitazione, undo/redo e riapertura dell'HTML salvato.
- Gate completo passato: 94 file frontend, 1.182 test; linee 85,08%, branch
  75,28%, funzioni 79,08%. Backend: copertura 88,26%.
- Suite browser completa: 28 passati. Build, lint, typecheck e diff passati.

Evidenze in `_smoke/editor-parity/`: `backspace-subtree-transfer-readback.json`,
`backspace-subtree-api-readback.json`, `backspace-subtree-root-docs.jpg`,
`backspace-subtree-nested-docs.jpg`, `backspace-subtree-playwright/`,
`backspace-subtree-full-playwright/` e log `backspace-subtree-*.log`.
Per ripetere usare `src/editorLists.dom.test.ts`, il gate completo e
`e2e/editor_images.spec.ts`; il nuovo caso si seleziona con
`--grep 'list Backspace retains a child'`.

Il nuovo percorso richiede una voce precedente di soli paragrafi/titoli e un
ramo formato da paragrafi/titoli e liste. La conservazione dei nodi è ricorsiva;
le prove reali qui certificano soltanto i due corpus di paragrafi. Alla consegna
del dodicesimo gruppo restavano aperti prima voce,
precedente con sottoliste, oggetti, titoli nel trasferimento, stili diretti
combinati, ramificazioni più ampie e gesti successivi. Rimangono
anche gli altri confini di Canc, annidamento della prima voce, selezioni miste,
ripiego HTML, percorso inverso, impaginazione, numeri di pagina e accettazione
WebView2/WKWebView. LIST-12 non chiude LIST-01, la fase 3 o il piano generale.

## Verifica del tredicesimo gruppo

LIST-13 estende il primo Backspace al confine fra due voci con sottolista.
Il riferimento nativo Docs è preparato con il preset
`NUMBERED_DECIMAL_ALPHA_ROMAN` tramite le
[richieste API ufficiali](https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/request#CreateParagraphBulletsRequest),
poi modificato con Backspace nel browser integrato della chat. Quattro schede
nuove conservano i corpus dei gruppi precedenti. Le quattro regressioni DOM
nuove fallivano prima della correzione; le 44 precedenti restavano verdi.

Entrambe le voci contengono un paragrafo iniziale e una sottolista di due voci.
`Seconda` è in grassetto. Backspace rimuove soltanto il suo marcatore, conserva
testo, posizione e profondità dei due rami e rinumera la successiva `Terza`.
Le figlie di `Seconda` proseguono i marcatori delle figlie di `Prima`:

| Corpus | Prima di Backspace | Dopo Backspace |
| --- | --- | --- |
| Primo livello, sette paragrafi | Prima 1, Vecchia/Precedente a/b, Seconda 2, Figlia/Sorella a/b, Terza 3 | Prima 1, Vecchia/Precedente a/b, Seconda senza marcatore a 36/36 pt, Figlia/Sorella c/d, Terza 2 |
| Annidato, nove paragrafi | Madre 1, Prima a, Vecchia/Precedente i/ii, Seconda b, Figlia/Sorella i/ii, Terza c, Ultima 2 | Madre 1, Prima a, Vecchia/Precedente i/ii, Seconda senza marcatore a 72/72 pt, Figlia/Sorella iii/iv, Terza b, Ultima 2 |

`editorLists.ts` conserva i blocchi della seconda voce come continuazioni
nella precedente. Le sottoliste rimangono separate dal paragrafo senza
marcatore; la seconda lista numerata riceve `start` uguale all'inizio della
precedente più il numero delle sue voci. Tipo, contenuto, mark e altri attributi
rimangono. Per le liste puntate non serve modificare `start`.
Il caret resta a offset zero di `Seconda`. La rimozione rimane una sola
transazione con confini di cronologia prima/dopo. La digitazione immediata ha
undo distinto; undo del marcatore e redo ripristinano le strutture.
La sequenza digitazione → undo → undo del marcatore → redo è verificata anche
nel corpus annidato Docs.

Il percorso nuovo richiede che entrambe le voci abbiano esattamente un blocco
di testo iniziale e una sottolista, che le sottoliste abbiano tipo e attributi
uguali prima del gesto, e che le loro voci contengano solo paragrafi/titoli.
La prova reale certifica i due corpus di paragrafi e marcatori predefiniti.
Liste con inizi/tipi discordanti, più sottoliste per voce, rami più profondi,
oggetti, stili diretti combinati e titoli nel trasferimento restano aperti.

Riferimenti e destinazioni:

- [Primo livello, gesto Docs](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.aq7mocoy8hu9).
- [Primo livello, copia app](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.cesrbizbdx0t).
- [Annidato, gesto Docs](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.z8n2ztwdk31e).
- [Annidato, copia app](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.9yl8ixa78ib2).

Gli appunti provengono da Ctrl+C nel browser Chromium dell'app dopo Backspace
e redo. Sono trasferiti integralmente nella clipboard del browser integrato,
incollati nelle schede Docs vuote, salvati, riaperti e ricopiati. In tutti i
sette/nove paragrafi non vuoti coincidono gesto Docs, fonte app, incolla e
riapertura: testo, grassetto per carattere, livelli, rientri sinistro/prima riga,
interlinea nativa 1,15 e numero effettivo dei marcatori. Le run sparse vengono
espanse mantenendo l'ultimo stile applicato. Il numero effettivo è ricostruito
da `start`, livello e progressione; non si richiede identità degli ID interni
delle liste né degli inizi grezzi fra rappresentazioni. I marcatori a/b/c/d e
i/ii/iii/iv sono osservati anche nell'interfaccia Docs e negli screenshot.
La lettura API conferma contenuto, grassetto, livelli e rientri salvati;
l'interlinea della copia è verificata negli appunti nativi. I paragrafi vuoti
finali sono esclusi dal campione; il ripiego HTML puro rimane aperto.

Controlli al 4 ottobre 2026:

- Test DOM degli elenchi: 48 passati, quattro nuove regressioni
  puntate/numerate e root/annidate, con caret, mark, numerazione, undo/redo,
  serializzazione HTML e appunti nativi.
- Nuovo caso browser su entrambi i corpus: geometria di tutti i paragrafi
  invariata durante la rimozione, tipo/start, grassetto, caret, cronologia,
  copia da tastiera e riapertura dell'HTML salvato.
- Gate completo passato: 94 file frontend, 1.186 test; linee 85,09%, branch
  75,34%, funzioni 79,11%. Backend: copertura 88,28%.
- Suite browser completa dell'editor: 29 passati. Build, lint, typecheck e
  controllo della diff passati.

Evidenze in `_smoke/editor-parity/`: `backspace-two-branches-transfer-readback.json`,
`backspace-two-branches-api-readback.json`, `backspace-two-branches-root-docs.jpg`,
`backspace-two-branches-nested-docs.jpg`, `backspace-two-branches-playwright/`,
`backspace-two-branches-full-playwright/` e log `backspace-two-branches-*.log`.
I readback campionati contengono solo testo sintetico e proprietà, senza
credenziali o identificatori interni delle liste.
Per ripetere usare `src/editorLists.dom.test.ts`, il gate completo e
`e2e/editor_images.spec.ts` con `--grep 'Backspace between two child branches'`,
poi build e controllo della diff.

Restano aperti gli altri confini di Backspace/Canc, prima voce, selezioni miste,
divisioni/fusioni generali, combinazioni più ampie, ripiego HTML in Docs e
percorso inverso. Impaginazione, numeri di pagina e accettazione desktop
WebView2/WKWebView rimangono aperti. LIST-13 non chiude LIST-01, la fase 3 o il
piano generale.

## Verifica del quattordicesimo gruppo

LIST-14 copre il primo Backspace sulla prima voce con sottolista. Le quattro
regressioni nuove fallivano prima della correzione; le 48 precedenti passavano.
Il riferimento è preparato nel documento di prova con il preset nativo
`NUMBERED_DECIMAL_ALPHA_ROMAN`, poi modificato con Backspace nel browser
integrato. Le quattro nuove schede conservano i corpus precedenti.

| Corpus | Risultato Docs, editor e copia salvata |
| --- | --- |
| Primo livello, quattro paragrafi | Prima in grassetto senza marcatore, rientri 36/36 pt; Figlia/Sorella a/b a 72/54 pt; Seconda con 2 a 36/18 pt |
| Annidato, sei paragrafi | Madre con 1; Prima in grassetto senza marcatore a 72/72 pt; Figlia/Sorella i/ii a 108/90 pt; Seconda con b; Ultima con 2 |

Il risultato differisce dalla rimozione fra due voci: la prima voce con figlie
conserva il posto nella sequenza e la successiva mantiene 2/b. La correzione
conserva il contenitore della voce e delle figlie, impostando `markerHidden`.
L'HTML usa `list-style-type:none` soltanto su quella voce; i marcatori delle
figlie restano normali. L'attributo viene ricostruito dalla stessa proprietà
CSS al caricamento. La preview conserva soltanto questo stile aggiuntivo per
le voci; non amplia genericamente la lista delle proprietà permesse.

La preparazione del documento non sovrascrive il marcatore nascosto con quello
dell'elenco. La copia nativa emette un paragrafo senza marcatore con rientro
pieno, conserva i livelli delle figlie e adegua l'inizio della sequenza restante.
La prima prova reale mostrava 2 nell'editor e 1 dopo incolla: l'incremento
dell'inizio nativo corregge questa differenza, con una regressione sul payload
e un secondo trasferimento verificato. L'HTML continua a contare la voce
nascosta nella sequenza.

Il caret resta all'inizio di Prima. La transazione ha confini di cronologia
prima/dopo: la digitazione immediata ha undo distinto, un altro undo ripristina
il marcatore, redo e riapertura dell'HTML conservano il risultato. Il test
Chromium verifica la geometria invariata di tutti i paragrafi nei due corpus.
I quattro test DOM ripetono liste numerate/puntate, root/annidate; una regressione
aggiuntiva verifica la preview.

Il percorso richiede la prima voce, con esattamente un blocco di testo e una
sottolista le cui voci contengono solo paragrafi/titoli. Le prove reali qui
certificano i corpus numerati di paragrafi, con marcatori predefiniti. Oggetti,
più sottoliste, titoli nel trasferimento, stili diretti combinati, altre profondità
e gesti successivi rimangono aperti.

Riferimenti e destinazioni:

- [Primo livello, gesto Docs](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.a6i2zkkai5de).
- [Primo livello, copia app](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.iqge8ttweqju).
- [Annidato, gesto Docs](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.2bt692v11t7l).
- [Annidato, copia app](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.7e2njh4qk95).

Gli appunti provengono da Ctrl+C nel browser Chromium dell'app, trasferiti
integralmente e incollati nel browser integrato. Dopo salvataggio e ricaricamento
del documento, entrambe le schede sono ricopiate. Il confronto automatico
dei quattro/sei paragrafi non vuoti verifica testo, grassetto per carattere,
livelli, rientri, interlinea nativa 1,15 e marcatori/numero effettivi dall'HTML.
Non confronta gli ID interni o gli inizi grezzi: il riferimento Docs ha ancora
inizio 1 ma mostra 2/b, mentre la copia usa inizio 2 per mantenere lo stesso
numero. API e screenshot confermano contenuto, grassetto, rientri, livelli e
marcatori salvati. I paragrafi vuoti finali sono esclusi dal campione.
Il ripiego HTML puro in Docs e il percorso inverso rimangono aperti.

Il bridge file-backed della skill Docs rifiuta i percorsi Windows come non
assoluti. Il read completo è quindi salvato su disco tramite il connettore
diretto; il detector ufficiale della skill è eseguito sullo stesso risultato:
nessun controllo protetto rilevato. Le scritture API aggiungono solo le schede
e i corpus sintetici nuovi. Le prove dei gesti e dell'incolla richiedono il
browser perché non sono rappresentabili dalle sole scritture API.

Controlli al 4 ottobre 2026:

- 52 test DOM degli elenchi passati, quattro nuovi; 17 della preview passati,
  uno nuovo. Nuovo caso browser su entrambi i corpus passato.
- Gate completo passato: 94 file frontend, 1.191 test; linee 85,12%, branch
  75,42%, funzioni 79,17%. Copertura backend 88,25%.
- Suite browser completa dell'editor: 30 passati. Build, lint, typecheck e
  controllo della diff passati.

Evidenze in `_smoke/editor-parity/`: `first-subtree-transfer-readback.json`,
`first-subtree-api-readback.json`, `first-subtree-root-docs.png`,
`first-subtree-nested-docs.png`, `first-subtree-playwright/`,
`first-subtree-full-playwright/`, `first-subtree-compare.mjs` e log
`first-subtree-*.log`. I readback campionati contengono testo sintetico e stili,
senza credenziali o identificatori interni delle liste.

LIST-14 non chiude LIST-01, la fase 3 o il piano generale. Restano gli altri
gesti, selezioni miste, fusioni/divisioni generali, trasferimenti di strutture
più ampie, ripiego HTML, percorso inverso, impaginazione, numeri di pagina e
accettazione nelle build desktop WebView2/WKWebView.

## Verifica del quindicesimo gruppo

LIST-15 continua il caso LIST-14 con il secondo Backspace all'inizio di `Prima`,
dopo la rimozione del primo marcatore. Il riferimento nasce in due nuove schede
con il preset `NUMBERED_DECIMAL_ALPHA_ROMAN`; i gesti sono reali nel browser
integrato. Due ulteriori schede ricevono la copia reale dell'app. Le schede
precedenti restano intatte.

| Corpus | Risultato del secondo Backspace |
| --- | --- |
| Primo livello | Prima senza marcatore, rientri 0/0 pt; Figlia/Sorella a/b a 72/54 pt; Seconda con 2 a 36/18 pt |
| Annidato | Madre con 1; Prima senza marcatore a 0/0 pt; Figlia/Sorella i/ii a 108/90 pt; Seconda con b; Ultima con 2 |

L'azzeramento del rientro già produceva il documento atteso, ma mancava il
confine di cronologia dopo la transazione. Digitare subito `X` e annullare
annullava insieme carattere e rientro. Le quattro nuove regressioni fallivano
su questo passaggio, mentre i 52 test precedenti passavano. La correzione in
`editorLists.ts` aggiunge `closeHistory` dopo l'azzeramento, nel comando già
usato anche dalle continuazioni senza marcatore.

Ora un undo elimina soltanto `X`, un secondo ripristina il rientro, un terzo
ripristina il marcatore. Redo e riapertura dell'HTML conservano il documento.
I test DOM coprono elenchi puntati/numerati e root/annidato. Il nuovo test
Chromium misura tutte le righe: solo `Prima` si sposta di 48/96 px, pari a
36/72 pt; figlie e voci successive mantengono posizione orizzontale e verticale.
Il caret rimane all'inizio del paragrafo e il grassetto rimane presente.

Il documento conserva il contenitore della voce senza marcatore; il margine
diretto negativo del paragrafo compensa il padding dei contenitori lista.
Le figlie restano alla stessa profondità. La copia nativa risolve invece il
rientro complessivo a zero, senza esportare quella compensazione come rientro
negativo. La sequenza restante continua a partire da 2/b.

Il percorso app → Ctrl+C → incolla formattato → salvataggio → riapertura →
Ctrl+C in Docs è verificato nei due corpus numerati di paragrafi. Il confronto
automatico dei quattro/sei paragrafi non vuoti verifica testo, grassetto per
carattere, livelli, rientri, interlinea nativa 1,15 e marcatori/numero effettivi
dall'HTML. Il confronto riguarda queste proprietà, escludendo ID interni,
newline finale, paragrafi vuoti finali e identità geometrica dei glifi.
Il readback API conferma testo, grassetto e rientri/livelli salvati.

- [Primo livello, gesto Docs](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.201kamin8qz7).
- [Primo livello, copia app](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.fuaw50o9puk5).
- [Annidato, gesto Docs](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.m8bgkoddvyu9).
- [Annidato, copia app](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.m8uhso4klqe3).

La lettura completa corrente è salvata su disco tramite il connettore diretto
e analizzata dal detector ufficiale della skill Docs: nessun controllo protetto
rilevato. Il bridge file-backed richiede percorsi POSIX e rimane incompatibile
con quelli Windows di questo ambiente. Le scritture API preparano soltanto
schede e corpus nuovi; il browser serve a verificare i gesti e l'incolla.

Controlli al 4 ottobre 2026:

- 56 test DOM degli elenchi passati, quattro nuove regressioni; nuovo caso
  browser sui due corpus passato.
- Gate completo passato: 94 file frontend, 1.195 test; linee 85,12%, branch
  75,42%, funzioni 79,17%. Copertura backend 88,25%. Lint e typecheck passati.
- Suite browser completa dell'editor: 31 casi passati. Controllo della diff
  passato.

Evidenze in `_smoke/editor-parity/`: `first-followup-transfer-readback.json`,
`first-followup-api-readback.json`, `first-followup-root-docs.png`,
`first-followup-nested-docs.png`, `first-followup-compare.mjs`,
`first-followup-playwright/`, `first-followup-full-playwright/` e log
`first-followup-*.log`.

Il terzo Backspace è stato osservato in Docs: all'inizio del documento non
cambia nulla; nel corpus annidato unisce `Madre` e `Prima`, conservando figlie
i/ii e successiva b. Il gesto annidato è annullato per lasciare il riferimento
nello stato del secondo Backspace. Questa fusione non è implementata o
certificata da LIST-15: richiede la conservazione della profondità delle figlie
anche dopo la rimozione del loro paragrafo padre. Restano inoltre oggetti,
più rami, stili combinati, altre profondità, ripiego HTML, percorso inverso,
impaginazione, numeri di pagina e accettazione desktop WebView2/WKWebView.
LIST-15 non chiude LIST-01, la fase 3 o il piano generale.

## Verifica del sedicesimo gruppo

LIST-16 prosegue LIST-15 con il terzo Backspace all'inizio di `Prima` dopo
la rimozione del marcatore e l'azzeramento del rientro. I corpus Docs sono
preparati in due nuove schede con il preset `NUMBERED_DECIMAL_ALPHA_ROMAN`;
due ulteriori schede ricevono la copia reale dell'app. I gesti e l'incolla
sono eseguiti nel browser integrato. Le schede precedenti sono preservate.

| Corpus | Risultato Docs e app | Rientri sinistro / prima riga |
| --- | --- | --- |
| Primo livello | Il terzo Backspace non cambia testo o struttura; figlie a/b e successiva 2 | Prima 0/0 pt; figlie 72/54 pt; Seconda 36/18 pt |
| Annidato | MadrePrima con marcatore 1; solo Prima in grassetto; figlie i/ii, Seconda b, Ultima 2 | MadrePrima 36/18 pt; figlie 108/90 pt; Seconda 72/54 pt; Ultima 36/18 pt |

Le quattro nuove regressioni DOM fallivano prima della correzione, mentre i
56 test precedenti passavano: al primo livello il percorso standard sollevava
il contenitore; annidato non univa `Prima` a `Madre`. Il comando ora intercetta
il primo ramo senza marcatore e a rientro zero. All'inizio del documento il
gesto è consumato senza transazione. Nel ramo annidato il testo si unisce al
paragrafo immediatamente precedente dell'antenato; viene rimosso soltanto il
paragrafo originario, conservando il contenitore senza marcatore e la sottolista.

Lo schema `EditorListItem` accetta anche una singola sottolista senza un primo
paragrafo. Questo permette di conservare il livello e la posizione nella
sequenza senza inserire un paragrafo vuoto fittizio. L'HTML serializza il `li`
senza marcatore con la sola sottolista; il caricamento conserva questa forma.
L'adattatore nativo di copia non emette un paragrafo per quel contenitore.
La successiva voce continua da b; la sottolista conserva i/ii e livello 2.

Il caret è fra `Madre` e `Prima`, offset 5. Digitare subito `X` e annullare
elimina soltanto quel carattere; il successivo undo ripristina il documento
prima della fusione. Redo e riapertura dell'HTML conservano il risultato;
la validità dello schema è verificata con `doc.check()`. Le quattro regressioni
DOM coprono liste numerate/puntate, primo livello/annidato. Il test Chromium
misura tutte le righe: nel corpus annidato scompare la riga di `Prima`, le
figlie e le voci successive conservano la posizione orizzontale e salgono
di una riga. Nel corpus root la geometria è invariata. L'HTML riaperto
conserva esattamente la geometria rilevata dopo il gesto.

App → Ctrl+C → trasferimento di tutti i formati → incolla formattato in Docs
→ salvataggio → riapertura → Ctrl+C è verificato per entrambi i corpus
numerati. Il confronto automatico dei quattro/cinque paragrafi confronta
testo, grassetto per carattere, livelli, rientri, interlinea nativa 1,15 e
marcatori/numero effettivi dall'HTML. Verifica anche l'assenza di righe vuote
interne e l'identità delle proprietà root prima/dopo il terzo Backspace.
Sono esclusi ID interni, newline e paragrafi vuoti finali, identità geometrica
dei glifi. Il readback API conferma testi, grassetto, rientri e livelli salvati
nei riferimenti e nelle copie.

- [Primo livello, riferimento](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.sjvjyfgkj97f).
- [Primo livello, copia app](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.wlicwabpwr03).
- [Annidato, riferimento](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.4zp5yi3jd52n).
- [Annidato, copia app](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.7kuypfxnecxq).

La lettura iniziale completa è eseguita dal bridge ufficiale della skill Docs
con un adattatore `fileIO` per Windows e percorsi virtuali POSIX mappati alle
directory locali. Il bridge, il wrapper e il detector rimangono quelli
ufficiali, con verifica degli hash: nessun controllo protetto rilevato.
Risultato, outline, inventario e ricevuta sono salvati in
`_smoke/editor-parity/first-merge-trusted/`. Le scritture API preparano solo le
quattro schede nuove e i corpus sintetici; il browser verifica gesti e incolla.

Controlli al 4 ottobre 2026:

- 60 test DOM degli elenchi, quattro nuove regressioni; 42 test della copia
  passati. Nuovo caso browser sui due corpus passato.
- Gate completo passato: 94 file frontend, 1.199 test; linee 85,16%, branch
  75,51%, funzioni 79,17%. Copertura backend 88,25%. Lint e typecheck passati.
- Suite browser completa dell'editor: 32 casi passati. Build e controllo
  della diff passati.

Evidenze in `_smoke/editor-parity/`: `first-merge-transfer-readback.json`,
`first-merge-api-readback.json`, `first-merge-root-docs.png`,
`first-merge-nested-docs.png`, `first-merge-compare.mjs`,
`first-merge-playwright/`, `first-merge-full-playwright/` e log
`first-merge-*.log`.

Il comando è limitato alla prima voce senza marcatore con un solo paragrafo
e una sottolista di voci contenenti solo paragrafi, con rientro complessivo zero;
la fusione richiede il paragrafo immediatamente precedente dell'antenato.
Non certifica gesti successivi sulle figlie dopo la fusione, titoli, oggetti,
più rami, altre profondità o stili diretti combinati. Restano aperti gli altri
confini di Backspace/Canc, selezioni miste, fusioni/divisioni generali, ripiego
HTML puro in Docs, percorso inverso, impaginazione, numeri di pagina e
accettazione nelle build desktop WebView2/WKWebView. LIST-16 non chiude
LIST-01, la fase 3 o il piano generale.

## Verifica del diciassettesimo gruppo

LIST-17 prosegue i due corpus di LIST-16 con tre Backspace all'inizio di
`Figlia`, poi tre all'inizio di `Sorella`. In Docs le prove sono eseguite nel
browser integrato, su due nuove schede sintetiche create con il preset
`NUMBERED_DECIMAL_ALPHA_ROMAN`. Due ulteriori schede ricevono gli appunti
reali dell'app. Le 57 schede preesistenti conservano titoli, ordine e identità.

| Gesto | Risultato nei due corpus |
| --- | --- |
| Primo sulla figlia | Rimuove soltanto il marcatore; rientro totale 72 pt al primo livello, 108 pt annidato. Sorella diventa a/i; Seconda resta 2/b. |
| Secondo sulla figlia | Azzera il rientro della figlia senza unire il testo. |
| Terzo sulla figlia | Forma PrimaFiglia oppure MadrePrimaFiglia; Sorella mantiene profondità e rientro. |
| Primo sulla sorella | Rimuove il marcatore e scioglie il contenitore rimasto senza sottolista. Il testo resta a 72/108 pt; Seconda diventa 1/a. |
| Secondo sulla sorella | Azzera il suo rientro senza unire il testo. |
| Terzo sulla sorella | Forma PrimaFigliaSorella oppure MadrePrimaFigliaSorella; Seconda resta 1/a e Ultima conserva 2. |

Le quattro nuove regressioni DOM fallivano prima della correzione, mentre i
60 test precedenti passavano. La rimozione del marcatore poteva condividere
la cronologia con il carattere successivo; il contenitore rimasto dopo la
rimozione dell'ultima figlia manteneva un conteggio ormai assente in Docs e
il ramo annidato veniva sollevato al terzo Backspace.

Il comando ora scioglie la prima voce senza marcatore quando viene rimossa
l'unica voce di una sua sottolista terminale. Il corpus supportato contiene
una figlia con un solo paragrafo e un contenitore con la sola sottolista oppure
un paragrafo seguito dalla sottolista. I paragrafi sollevati compensano i livelli
rimossi nei rientri diretti; la lista restante mantiene i suoi attributi e
riparte dal suo start, senza contare il contenitore rimosso. Titoli, oggetti,
contenitori con più paragrafi o altre sottoliste conservano il percorso standard.

La rimozione del marcatore chiude la cronologia anche dopo la transazione.
Anche la fusione fra due paragrafi al primo livello e a rientro zero passa
attraverso la transazione delimitata già usata per le continuazioni: un undo
elimina soltanto il carattere successivo, quello seguente annulla il gesto.
Le quattro regressioni coprono elenchi numerati/puntati e root/annidato, tutti
i sei stati, caret, undo/redo, schema valido e serializzazione/riapertura HTML.

Il nuovo test Chromium esegue i dodici gesti e misura i paragrafi: il reset
sposta solo la riga coinvolta; la fusione elimina una riga mantenendo le
posizioni orizzontali delle successive. Verifica anche grassetto, caret,
undo/redo e identità della geometria dopo riapertura dell'HTML. Gli appunti
di ogni stato coincidono con il riferimento Docs per testo, grassetto per
carattere, livelli, rientri, interlinea 1,15 e marcatori/numero effettivi.

I risultati finali sono verificati con app → Ctrl+C → trasferimento di tutti
i formati → incolla formattato in Docs → salvataggio → riapertura → Ctrl+C.
I due/tre paragrafi coincidono con il riferimento per le proprietà campionate,
senza paragrafi vuoti interni. ID interni, newline e paragrafi vuoti finali sono
esclusi. Il confronto richiede anche un nuovo ID di copia dopo la riapertura.
Il readback API conferma contenuto, grassetto, livelli e rientri salvati nei
quattro tab. Il trasferimento reale finale riguarda i corpus numerati;
quelli puntati sono coperti dalle regressioni DOM.

- [Root, riferimento](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.z3t4tfssp6jt).
- [Root, copia app](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.fq501s4bq480).
- [Annidato, riferimento](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.5dl6lhkwcs5o).
- [Annidato, copia app](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.frzapzyg81ue).

La lettura iniziale completa usa il bridge, wrapper e detector ufficiali della
skill Docs con un adattatore fileIO per Windows e percorsi POSIX virtuali.
Gli hash dei moduli sono verificati; non sono rilevati controlli protetti.
Gli artefatti sono in `_smoke/editor-parity/child-followup-trusted-03/`.

Controlli al 4 ottobre 2026: 64 test DOM degli elenchi e 42 della copia passati;
gate completo passato con 94 file e 1.203 test frontend, copertura linee
85,21%, branch 75,61%, funzioni 79,20%; backend 88,26%. Lint e typecheck,
33 casi browser dell'editor, build frontend e controllo della diff passati.

Evidenze in `_smoke/editor-parity/`: `child-steps-readback.json`,
`child-transfer-readback.json`, `child-api-readback.json`,
`child-reference-summary.json`, `child-*-compare.mjs`, `child-playwright/`,
`child-full-playwright/`, `child-root-docs.png`, `child-nested-docs.png` e log
`child-*.log`.

Restano aperti altri gesti e topologie, più rami/profondità, titoli, oggetti,
stili combinati, selezioni miste, ripiego HTML puro, percorso inverso,
impaginazione, numeri di pagina e build desktop WebView2/WKWebView.
LIST-17 non chiude LIST-01, la fase 3 o il piano generale.

## Verifica del diciottesimo gruppo

LIST-18 confronta Enter con caret collassato all'inizio, dopo `Pr` e alla fine
di `Prima`, prima voce con una sottolista di due figlie di soli paragrafi.
I corpus sono root e annidato, con `Prima` in grassetto. Il riferimento è un
nuovo documento sintetico privato, A4 con pagine, margini 72 pt, Arial 11 pt,
zoom 100%, interlinea nativa 1,15 e preset `NUMBERED_DECIMAL_ALPHA_ROMAN`.
Le sei schede di riferimento e le sei copie sono create nel nuovo documento;
nessuna scheda delle prove precedenti viene modificata.

| Punto di Enter | Risultato nei corpus root/annidato |
| --- | --- |
| Inizio | Voce vuota 1/a, seguita da Prima 2/b con entrambe le figlie. |
| Dopo Pr | Pr resta 1/a; ima diventa 2/b e conserva entrambe le figlie. |
| Fine | Prima resta 1/a; una voce vuota 2/b conserva entrambe le figlie. |
| Tutti i casi | Seconda passa a 3/c, le figlie restano a–b/i–ii; Ultima resta 2 nel corpus annidato. |

La divisione standard di TipTap conservava già testo, mark, struttura e
profondità corretti. Tutte le dodici nuove regressioni DOM fallivano invece
sulla cronologia: l'undo del carattere digitato dopo Enter annullava anche
la divisione. I 64 test precedenti passavano. In Docs, sul corpus annidato
con Enter alla fine, l'undo della digitazione e quello di Enter sono due
gesti distinti; redo ripristina la divisione.

Il comando conserva `splitListItem` e delimita la cronologia prima e dopo
la sua transazione. Si applica al caret collassato nel primo paragrafo non
vuoto di una voce con marcatore visibile e una sola sottolista, composta da
voci di soli paragrafi con testo/mark. Selezioni estese, paragrafi con oggetti,
titoli, voci senza marcatore, più sottoliste e altre strutture mantengono
il percorso standard. Questo gruppo non ne dichiara la parità.

Le dodici regressioni DOM coprono elenchi numerati/puntati, root/annidato e
tutti e tre i punti di divisione: figli sulla seconda voce, caret iniziale,
schema valido, undo separati, redo e serializzazione/riapertura HTML.
Il test Chromium copre i sei corpus numerati con gesti reali: conserva gli
allineamenti orizzontali, aggiunge una riga, sposta verticalmente le figlie,
mantiene il grassetto e verifica caret, cronologia e identità dopo riapertura.

Gli appunti reali di Ctrl+C coincidono con i riferimenti per testo,
grassetto per carattere, livelli, rientri, interlinea e marcatori/numero
effettivi. Il confronto include esplicitamente le voci numerate vuote create
da Enter: non le scarta come righe finali. Solo i paragrafi vuoti finali senza
marcatore, i newline e gli ID interni sono esclusi dalla normalizzazione.

Tutti e sei i risultati coincidono anche dopo trasferimento di tutti i
formati dell'app, incolla formattato in Docs, salvataggio, ricaricamento del
documento e ricopia. Ogni ricopia produce un nuovo ID degli appunti. La lettura
API confronta le sei coppie e conferma testo, grassetto, livelli, rientri e
interlinea salvati, incluse le voci vuote. I corpus puntati sono verificati
nei test DOM; il trasferimento reale di questo gruppo riguarda quelli numerati.

- [Documento sintetico con i sei riferimenti e le sei copie](https://docs.google.com/document/d/1Ov4i7iJFivQFVMAviV38ebWoR7GvmVmzql7Zc51RVeQ/edit).
- [Copia root con Enter a metà](https://docs.google.com/document/d/1Ov4i7iJFivQFVMAviV38ebWoR7GvmVmzql7Zc51RVeQ/edit?tab=t.nca355up7dsa).
- [Copia annidata con Enter alla fine](https://docs.google.com/document/d/1Ov4i7iJFivQFVMAviV38ebWoR7GvmVmzql7Zc51RVeQ/edit?tab=t.zc7d0w9yylgl).

Controlli al 4 ottobre 2026: 76 test DOM degli elenchi e 42 della copia passati;
gate completo passato con 94 file e 1.215 test frontend, copertura linee
85,23%, branch 75,62%, funzioni 79,33%; backend 88,26%. Lint e typecheck,
34 casi browser dell'editor, build frontend e controllo della diff passati.

Evidenze in `_smoke/editor-parity/`: `enter-before.log`, `enter-targeted.log`,
`enter-docs-undo.json`, `enter-*-reference-clipboard.json`,
`enter-*-transfer-clipboard.json`, `enter-*-reopened-clipboard.json`,
`enter-reference-readback.json`, `enter-api-readback.json`, `enter-compare.mjs`,
`enter-playwright/`, `enter-full-playwright/`, `enter-nested-docs.png` e log
`enter-check.log`, `enter-full-playwright.log`, `enter-build.log`.

Restano aperti altri gesti e topologie, titoli, oggetti, voci senza marcatore,
stili combinati, selezioni estese/miste, ripiego HTML puro, percorso inverso,
impaginazione, numeri di pagina e build desktop WebView2/WKWebView.
LIST-18 non chiude LIST-01, la fase 3 o il piano generale.

## Verifica del diciannovesimo gruppo

LIST-19 prosegue i corpus di LIST-18 con un secondo Enter sulla riga vuota
creata all'inizio o alla fine di Prima. Dopo il primo Enter all'inizio, il
caret torna sulla riga vuota tramite Freccia su e Home; nel caso fine resta
sulla seconda voce, che contiene le figlie. Il riferimento è un nuovo
documento sintetico privato: A4 con pagine, margini 72 pt, Arial 11 pt, zoom
100%, interlinea nativa 1,15 e preset NUMBERED_DECIMAL_ALPHA_ROMAN. Quattro
schede contengono il gesto Docs, quattro il trasferimento dall'app.

| Corpus | Risultato del secondo Enter |
| --- | --- |
| Root, inizio | Riga vuota senza marcatore a 0 pt; Prima torna 1, Seconda 2; figlie a–b a 72 pt. |
| Root, fine | Prima resta 1; riga vuota senza marcatore a 0 pt; figlie a–b a 72 pt; Seconda torna 2. |
| Annidato, inizio | Madre 1, riga vuota 2; Prima a e Seconda b a 72 pt; figlie i–ii a 108 pt; Ultima 3. |
| Annidato, fine | Madre 1 con Prima a; riga vuota 2; figlie i–ii a 108 pt, Seconda b a 72 pt; Ultima 3. |

Prima della correzione, Enter sulla voce vuota con figlie aggiungeva un
paragrafo nello stesso contenitore senza uscire di livello. Nel caso annidato
senza figlie, il percorso standard creava una continuazione senza marcatore,
mentre Docs promuove la voce vuota al livello superiore. Il nuovo comando
mantiene la profondità delle figlie tramite i contenitori già supportati
dallo schema. Al primo livello conserva la riga vuota come continuazione
della voce precedente, con margine compensativo -36 pt. Nel caso annidato
crea una voce superiore e conserva il ramo figlio in un contenitore senza
marcatore. I contenitori non aggiungono paragrafi agli appunti nativi.

Il comando riguarda caret collassato nel primo paragrafo vuoto di una voce
con marcatore visibile, al primo livello o nel primo ramo annidato. Con figlie
richiede una sola sottolista di voci di soli paragrafi/testo, una precedente
voce di soli paragrafi e una voce successiva. Senza figlie riguarda la prima
voce vuota seguita da una voce con una sola sottolista di paragrafi. Anche
le altre voci della lista devono appartenere a queste strutture semplici;
l'antenato annidato ha un paragrafo e quella lista. Altri livelli/topologie,
titoli, oggetti, selezioni estese e voci senza marcatore mantengono il percorso
standard e non sono certificati.

Otto regressioni DOM coprono elenchi numerati/puntati, root/annidato,
inizio/fine: schema valido, struttura e livelli degli appunti, caret,
digitazione con undo separato dal secondo Enter, redo e identità dopo
serializzazione/riapertura HTML. Quattro casi numerati con tastiera reale
in Chromium verificano gli stessi passaggi e la geometria: solo la riga
vuota arretra di 48 px, mentre testo e coordinate delle altre righe restano
invariati. Il grassetto di Prima si conserva. La cronologia Docs è campionata
in annidato/inizio, nella stessa scheda del gesto: un undo rimuove X e quello
successivo ripristina la voce vuota al livello annidato; redo la promuove.

Tutti e quattro gli appunti reali Ctrl+C coincidono col riferimento per
testo esistente, grassetto per carattere, livelli, rientri, interlinea e
numerazione effettiva. Le righe vuote interne, numerate o senza marcatore,
sono incluse. La lettura dei marcatori HTML esclude soltanto i contenitori
list-only esplicitamente senza marcatore; non li associa al paragrafo di una
figlia. Gli appunti sono trasferiti con tutti i formati reali dell'app,
incollati in schede vuote, salvati e riletti dopo ricaricamento. Le quattro
ricopie hanno nuovi ID e coincidono col riferimento. La lettura API conferma
le quattro coppie salvate per testo, grassetto del testo esistente, livelli,
rientri e interlinea. I paragrafi vuoti finali senza marcatore, gli ID interni
e le differenze di newline sono esclusi dalla normalizzazione.

**Limite di formattazione misurato, MARK-EMPTY-01:** il confronto per carattere
non certifica lo stile di un paragrafo vuoto. L'API Docs conserva bold=true
nel newline della riga vuota di riferimento, mentre la copia dell'app non
lo conserva. Nel campione root/inizio, tornando col caret nella riga dopo
riapertura e digitando X, Docs produce grassetto e l'app testo normale.
`empty-enter-typing-difference.json` registra i due risultati nativi. Questa
differenza resta aperta; LIST-19 corregge struttura, rientro e cronologia,
senza dichiarare equivalenza completa della digitazione o del trasferimento
degli stili delle righe vuote.

- [Documento sintetico del secondo Enter](https://docs.google.com/document/d/1nfUrXx0wCHkZb-HzTCWjOfZa_-7fh-HXaL9oyxMuzpg/edit).
- [Copia annidata alla fine, salvata e riaperta](https://docs.google.com/document/d/1nfUrXx0wCHkZb-HzTCWjOfZa_-7fh-HXaL9oyxMuzpg/edit?tab=t.v5zkdd4c1i0t).

Controlli al 4 ottobre 2026: 84 test DOM degli elenchi e 42 della copia passati;
gate completo passato con 94 file e 1.223 test frontend; backend 88,26%;
frontend linee 85,30%, branch 75,73%, funzioni 79,42%. Lint e typecheck,
35 casi browser dell'editor, test mirato finale con campione di digitazione,
build frontend e controllo della diff passati.

Evidenze in `_smoke/editor-parity/`: `empty-enter-before.log`,
`empty-enter-targeted.log`, `empty-enter-docs-undo.json`,
`empty-enter-*-reference-clipboard.json`, `empty-enter-*-transfer-clipboard.json`,
`empty-enter-*-reopened-clipboard.json`, `empty-enter-readback.json`,
`empty-enter-api-readback.json`, `empty-enter-typing-difference.json`,
`empty-enter-compare.mjs`, `empty-enter-playwright/`,
`empty-enter-full-playwright/`, `empty-enter-nested-docs.png` e log
`empty-enter-check.log`, `empty-enter-build.log`.

Al termine del gruppo 19 restavano aperti MARK-EMPTY-01, altri gesti/topologie, titoli, oggetti, più
rami/livelli, stili combinati, selezioni estese/miste, ripiego HTML puro,
percorso inverso, impaginazione, numeri di pagina e build desktop
WebView2/WKWebView. LIST-19 non chiude LIST-01, la fase 3 o il piano generale.

## Verifica del ventesimo gruppo

MARK-EMPTY-01: grassetto della riga vuota prodotta da LIST-18/19, dopo ritorno
del cursore e riapertura. Il gruppo corregge il caso originario root/inizio e
verifica anche root/fine, annidato/inizio e annidato/fine. Il riferimento è un
nuovo documento sintetico:
[stile della riga vuota dopo Enter](https://docs.google.com/document/d/1jHShVShV940VmNQCWHpLAVbTCdT5s0NES4KWu9t0b_4/edit),
con quattro tab di riferimento e quattro copie dell'app.

La riga vuota conserva lo stile come attributo `emptyTextMarks` del paragrafo.
Non contiene caratteri invisibili, spazi segnaposto o nuovi nodi. Il primo
Enter nei corpus delimitati conserva i mark della posizione originale; il
secondo Enter conserva l'attributo durante l'uscita/promozione del livello.
Tornando sul paragrafo vuoto il plugin ripristina i mark di digitazione; un
comando esplicito di formattazione prevale. Appena viene digitato testo, i
mark inline possiedono lo stile e il metadato vuoto viene rimosso, nello
stesso gruppo di cronologia. Non viene esteso un link al testo futuro.

I filtri HTML di salvataggio e lettura mantengono il solo nuovo attributo sui
paragrafi/titoli. La preparazione degli appunti materializza lo stile della
newline vuota nel frammento esportato. Il riferimento Docs assegna grassetto
alla newline della riga vuota in tutti e quattro i corpus; il confronto ora
include questa proprietà, esclusa dal confronto per carattere del gruppo 19.

Nel ciclo reale di autosave è emerso SAVE-REOPEN-01: dopo una chiusura e
riapertura il secondo salvataggio inviava HTML vuoto nonostante il documento
visibile. Il trace della prima suite completa conserva la richiesta con
contenuto `""`. `RichTextEditor` pubblica ora il getter dall'istanza attiva
tramite effect anziché dal solo evento create. La regressione DOM controlla
anche il cambio del callback di lettura; la prova browser ripete quattro
cicli di autosave, chiusura, riapertura e successiva modifica dello stesso
file, senza perdita del contenuto. L'attesa nel test usa l'inizializzazione
dell'editor e la lettura del documento, non un ritardo fisso.

### Risultati app e trasferimento

| Corpus | Riga vuota dopo i due Enter | Digitazione dopo riapertura | Incolla, riapertura e ricopia Docs |
| --- | --- | --- | --- |
| Root/inizio | Senza marcatore, rientro 0 pt, newline grassetto | X grassetto | Coincide con riferimento |
| Root/fine | Senza marcatore, rientro 0 pt, newline grassetto | X grassetto | Coincide con riferimento |
| Annidato/inizio | Voce 2 del livello superiore, rientri 36/18 pt, newline grassetto | X grassetto | Coincide con riferimento |
| Annidato/fine | Voce 2 del livello superiore, rientri 36/18 pt, newline grassetto | X grassetto | Coincide con riferimento |

Appunti nativi reali acquisiti con Ctrl+C nel browser dell'app, trasferiti in
Docs tramite Ctrl+V e ricopiati. Dopo reload dell'intero documento Docs,
nuovi ID di copia confermano nuove acquisizioni. In ogni copia riaperta viene
digitata X nella riga vuota e ricopiato il risultato: grassetto per carattere,
testo, livelli, rientri, interlinea e numerazione coincidono con il rispettivo
riferimento modificato nello stesso modo. La lettura API conferma testo,
grassetto, livelli, rientri e interlinea salvati; per lo stile ereditato usa
`NORMAL_TEXT` effettivo del tab. Il confronto esclude le righe vuote finali
del destinatario e non certifica il loro numero.

Le otto regressioni puntate/numerate già presenti vengono estese alla
riapertura e al grassetto della newline e di X. Nuovi test verificano anche
toggle/clear sulla riga vuota, metadati malformati, mark combinati nella sola
serializzazione HTML/nativa, filtri di lettura/salvataggio e getter attivo.
Undo/redo separano ancora digitazione e secondo Enter; le geometrie e la
profondità delle figlie restano quelle di LIST-19.

Controlli: 143 test DOM mirati passati; gate completo passato, 1.230 test
frontend, backend 88,26%, frontend linee 85,43%, branch 76,02%, funzioni
79,72%. Suite browser completa 35/35; dopo la separazione del helper puro
dal plugin, nuova prova mirata sul ciclo completo e build/typecheck passati.
Il helper della copia non carica TipTap nel bundle iniziale dell'app.

Evidenze in `_smoke/editor-parity/`: `empty-marks-before.log`,
`empty-marks-targeted.log`, `empty-marks-check.log`, `empty-marks-build.log`,
`empty-marks-playwright.log`, `empty-marks-final-playwright.log`,
`empty-marks-playwright/`, `empty-marks-final-playwright/`,
`empty-marks-full-playwright/` (trace della perdita di contenuto),
`empty-marks-*-reference-clipboard.json`,
`empty-marks-*-typed-reference-clipboard.json`,
`empty-marks-*-transfer-clipboard.json`,
`empty-marks-*-reopened-clipboard.json`,
`empty-marks-*-typed-transfer-clipboard.json`, `empty-marks-compare.mjs`,
`empty-marks-readback.json`, `empty-marks-api-readback.json` e
`empty-marks-root0-docs.png`.

MARK-EMPTY-01 è corretto per il grassetto dei quattro corpus. La
serializzazione di mark combinati coperta in DOM non dimostra la loro parità
di editing o trasferimento reale in Docs. Restano aperti altri gesti,
topologie, titoli, oggetti, selezioni estese/miste, HTML puro, percorso
inverso, impaginazione, numeri di pagina e build desktop WebView2/WKWebView.
Il gruppo 20 non chiude LIST-01, la fase 3 o il piano generale.

## Verifica del ventunesimo gruppo

MARK-EMPTY-02 e CLIP-MARK-01: stili combinati sulle righe vuote dei quattro
corpus di LIST-19 e sui caratteri esistenti/digitati.

Riferimento sintetico nuovo:
[El Sbobinator — stili combinati della riga vuota](https://docs.google.com/document/d/18ElLbsNcqRs9T2x5hfflKd8Z8j-avMF9lnfgons9rzw/edit).
Otto schede: quattro gesti reali in Docs e quattro copie native dall'app.

Il corpus usa grassetto, corsivo, sottolineato, barrato, Georgia 18 pt,
colore #123abc ed evidenziatura #ffee00 sulla voce Prima. Le figlie e le altre
voci restano Arial 11 pt, senza mark. I due Enter sono eseguiti all'inizio o
alla fine della voce con sottolista, al primo livello e nel ramo annidato.

**Difetti riprodotti:**

- Lo stile della riga vuota era conservato semanticamente, ma il suo rendering
  usava Arial 11 pt. Nel campione root/inizio la riga passava da 20,234375 a
  33,109375 px quando si digitava X; tutte le successive scendevano di
  12,875 px. La prova prima della correzione fallisce su queste coordinate.
- La copia nativa perdeva il barrato sul testo con sottolineato interno
  (`s > u`), e il sottolineato nell'ordine inverso. Un CSS/link discendente
  poteva eliminare entrambe le decorazioni ereditate. Quattro regressioni
  fallivano prima della correzione. Il confronto degli appunti di Prima e X
  rilevava la perdita anche nel corpus reale.

**Correzioni e prova locale:**

- Le decorazioni ProseMirror applicano le metriche del font salvato alle righe
  vuote. Il documento logico e la serializzazione non acquisiscono il relativo
  CSS come formattazione diretta del paragrafo. Niente caratteri segnaposto,
  sfondo giallo largo tutto il paragrafo o nuova transazione di layout.
- La copia unisce le decorazioni ereditate con quelle locali. Il CSS sullo
  stesso elemento continua a governare la sua decorazione; un discendente
  non elimina quelle dipinte dagli antenati.
- Nove regressioni DOM coprono HTML, ripristino dei mark, metriche visibili,
  assenza di CSS aggiuntivo nell'HTML, rimozione delle decorazioni quando il
  paragrafo contiene testo, undo/redo e disattivazione selettiva del corsivo.
  Otto casi combinano elenchi puntati/numerati, primo livello/annidato e
  inizio/fine. La parità reale Docs è limitata ai quattro corpus numerati.
- Nel browser: incolla sorgente, due Enter, copia nativa, autosave,
  chiusura/riapertura dell'editor, ritorno del caret nella riga tramite click,
  digitazione X, undo/redo e seconda chiusura/riapertura. La geometria di tutti
  i paragrafi è identica prima/dopo X. Font, dimensioni, colore, evidenziatura
  e combinazione degli altri mark sono verificati sul testo digitato.

**Trasferimento reale e durata:**

Per tutti i corpus coincidono fonte app, gesto Docs, copia incollata e copia
riaperta: testo, otto attributi per carattere e della newline vuota, livelli,
rientri, interlinea e numerazione. Dopo riapertura delle copie, digitando X
nelle righe prima vuote, gli stessi otto attributi coincidono con quelli del
riferimento Docs e della digitazione nell'app. Gli ID della ricopia sono nuovi.
Il confronto esclude soltanto le righe vuote finali del destinatario.
La lettura API conferma contenuto e mark di X nei riferimenti e nelle copie.
La forma CSS esadecimale/rgb equivalente dell'evidenziatura viene normalizzata
nel confronto dell'HTML; i colori nativi sono confrontati in forma canonica.

**Controlli:** 163 test mirati passati; gate completo con 95 file e 1.243 test
frontend; backend 88,26%; frontend linee 85,46%, branch 76,04%, funzioni 79,78%.
Typecheck, build e diff check passati. Suite browser finale 36/36 passata.
Nel primo giro completo un caso preesistente di selezione/clear non era passato;
è passato nella verifica mirata e nell'intera ripetizione finale. Il nuovo test
attende esplicitamente l'incolla e la divisione prima di tornare alla riga vuota.
Il gesto di ritorno via ArrowUp con font 18 pt non è certificato da questo gruppo.

Evidenze locali in `_smoke/editor-parity/`: `empty-styles-metrics-before.log`,
`empty-styles-metrics-before/`, `empty-styles-decoration-before.log`,
`empty-styles-targeted.log`, `empty-styles-final-check.log`,
`empty-styles-build.log`, `empty-styles-final-playwright.log`,
`empty-styles-final-full-playwright.log`, `empty-styles-playwright/`,
`empty-styles-final-full-playwright/`, `empty-styles-*-reference-clipboard.json`,
`empty-styles-*-typed-reference-clipboard.json`,
`empty-styles-*-transfer-clipboard.json`, `empty-styles-*-reopened-clipboard.json`,
`empty-styles-*-typed-transfer-clipboard.json`, `empty-styles-compare.mjs`,
`empty-styles-readback.json`, `empty-styles-api-readback.json` e
`empty-styles-root0-docs.png`.

Questa verifica non chiude altri font/stili/topologie, selezioni miste/estese,
titoli e oggetti, navigazione con tastiera, ripiego HTML, percorso inverso,
impaginazione, numeri di pagina o build desktop WebView2/WKWebView. Il gruppo
21 non chiude LIST-01, la fase 3 o il piano generale. Nessun commit/push/release.

## Verifica del ventiduesimo gruppo

NAV-EMPTY-01: ritorno da tastiera sulle righe vuote dei quattro corpus
numerati di LIST-19 con gli stili combinati del gruppo 21. Nessuna modifica
al comportamento dell'editor è stata necessaria nel perimetro verificato.

Documento sintetico nuovo:
[El Sbobinator — ritorno da tastiera sulle righe vuote](https://docs.google.com/document/d/1kaXQ6P2tcmuMMLy2_y0wQFIWd7rEN3FynHktB4wZuik/edit).
Otto tab: quattro riferimenti ricavati dagli appunti nativi dei gesti Docs
registrati nel gruppo 21 e quattro copie native acquisite dall'app in questo
gruppo. Non vengono modificati i riferimenti originali del gruppo 21.

| Corpus | Ritorno dal paragrafo successivo con ArrowUp | Ritorno dal precedente con ArrowDown |
| --- | --- | --- |
| Root/inizio | Verificato | Non applicabile: la riga vuota è il primo paragrafo |
| Root/fine | Verificato | Verificato |
| Annidato/inizio | Verificato | Verificato |
| Annidato/fine | Verificato | Verificato |

**Prova nell'app:** il test browser del gruppo 21 viene esteso, sostituendo
il ritorno diretto sulla riga vuota con navigazione reale dalla riga adiacente.
La posizione iniziale nel paragrafo adiacente viene predisposta tramite
selezione ProseMirror; il passaggio alla riga vuota avviene con il tasto reale.
Sette percorsi sono eseguiti dopo autosave, chiusura e riapertura dell'editor.
ArrowUp viene usato anche per tornare alla voce vuota fra i due Enter nel
corpus all'inizio. Il caret raggiunge offset zero; la navigazione non cambia
l'HTML. X conserva grassetto, corsivo, sottolineato, barrato, Georgia 18 pt,
colore #123abc ed evidenziatura #ffee00. Tutte le coordinate dei paragrafi
restano identiche prima/dopo digitazione. Un undo elimina X conservando la
riga e la struttura; redo la ripristina. Il documento digitato viene salvato
e riaperto una seconda volta senza variazioni.

**Prova in Docs:** appunti nativi reali trasferiti con Ctrl+V nel browser
integrato nella chat. Gli otto campioni ancora vuoti vengono salvati e
riaperti con reload prima delle navigazioni. Sette percorsi sono ripetuti sui
riferimenti e sette sulle copie. Dopo digitazione, undo e redo vengono
ricopiati gli stati e confrontati semanticamente: testo, stili per carattere
e della newline vuota, livelli, rientri, interlinea e numerazione coincidono
con l'app e con i riferimenti del gruppo 21. Una successiva riapertura e
nuova ricopia degli otto risultati digitati conservano le stesse proprietà;
ID di copia nuovi distinguono le acquisizioni. La lettura API conferma i
campioni salvati ancora vuoti e gli otto stili combinati di X dopo reload.
Le righe vuote finali del documento destinatario sono escluse dal confronto.

**Controlli:** gate completo passato, 95 file e 1.243 test frontend;
backend 88,26%; frontend linee 85,46%, branch 76,04%, funzioni 79,78%.
Suite browser dell'editor 36/36 passata. Il test esteso passa anche nella
verifica mirata. Nessuna build frontend necessaria: cambiano soltanto il
test e la documentazione. Diff check passato.

Evidenze in `_smoke/editor-parity/`: `empty-keyboard-before.log`,
`empty-keyboard-playwright.log`, `empty-keyboard-playwright/`,
`empty-keyboard-check.log`, `empty-keyboard-full-playwright.log`,
`empty-keyboard-full-playwright/`, `empty-keyboard-*-navigation.json`
(nelle cartelle dei test), `empty-keyboard-*-clipboard.json`,
`empty-keyboard-compare.mjs`, `empty-keyboard-readback.json`,
`empty-keyboard-api-readback.json` e `empty-keyboard-docs.png`.

Il gruppo verifica soltanto le frecce verticali su questi paragrafi brevi.
Restano aperti altri font, righe a capo, selezioni estese/miste, navigazioni
con Home/End e modificatori, titoli, oggetti, topologie, ripiego HTML,
percorso inverso, impaginazione, numeri di pagina e build WebView2/WKWebView.
NAV-EMPTY-01 non chiude LIST-01, la fase 3 o il piano generale.
Nessun commit/push/release.


## Verifica del ventitreesimo gruppo

TEXT-SOFT-01: Shift+Enter a metà (dopo Pr) e alla fine di Prima, con
stili combinati: grassetto, corsivo, sottolineato, barrato, Georgia 18 pt,
colore #123abc ed evidenziatura #ffee00. Tre strutture, sei corpus:
paragrafo normale, voce numerata di primo livello e voce numerata annidata.

Documento sintetico:
[El-Sbobinator — Shift+Enter, gruppo 23](https://docs.google.com/document/d/196yBFdGHimBvmSSFKQYdXM3TXDezpJBTpiA1UIQAUcs/edit).
Dodici tab: sei riferimenti costruiti con API Docs e poi modificati con i
veri tasti nel browser integrato, e sei copie degli appunti reali dell'app.
A4 verticale, margini 72 pt, zoom Docs e app 100%, interlinea 1,15.

**Differenza e correzione:** StarterKit conserva i mark per la digitazione
successiva a Shift+Enter, ma inserisce il nodo hardBreak senza mark.
L'HTML salvato conteneva br fuori dalla formattazione del testo; la copia
nativa attribuiva al ritorno Arial 11 pt normale. In Docs lo stesso ritorno
conserva tutti gli stili del testo attivo. CustomHardBreak inserisce il
ritorno con i mark consentiti dal motore, preservando i percorsi standard
per uscita da codice, isolamento e filtro dei mark. Il formato/schema del
nodo resta hardBreak; non sono aggiunti caratteri segnaposto o paragrafi.
Non si riscrivono retroattivamente i vecchi ritorni privi di mark.

**Prova nell'app:** sei regressioni DOM riproducono la perdita dei mark
prima della correzione. Dopo, verificano modello, stile nativo del ritorno,
undo/redo e rilettura dell'HTML. Sei cicli browser con i tasti reali
verificano stili di X, caret dopo X, un solo ritorno nello stesso paragrafo,
geometria su due righe, autosave, chiusura/riapertura e copia identica.
L'undo immediato annulla insieme ritorno e X; redo ripristina entrambi.
La posizione iniziale nel testo è predisposta con selezione ProseMirror.

**Prova in Docs:** i sei riferimenti confermano lo stesso raggruppamento
undo di Shift+Enter e X. Appunti confrontati dopo gesto, undo e redo.
Le sei copie native dell'app sono incollate con Ctrl+V e ricopiate. Tutti
coincidono per testo (incluso U+000B come ritorno morbido), otto attributi
di ogni carattere, livelli, rientri, interlinea e numerazione. Il documento
viene riaperto in una nuova scheda; la ricopia dei dodici campioni conserva
le stesse proprietà. La lettura API conferma gli stili salvati del ritorno
e di X in tutti i dodici tab. Si escludono i paragrafi vuoti finali del
documento destinatario; non si escludono ritorni interni o caratteri.

**Controlli:** 69 test DOM mirati passati, incluse le sei nuove regressioni.
Gate completo passato: 95 file, 1.249 test frontend; backend 88,26%;
frontend linee 85,46%, branch 76,04%, funzioni 79,78%. Suite browser
37/37 passata. Build Vite passata in una cartella separata sotto _smoke,
senza sostituire webui/dist. Diff check passato. Un primo giro mirato
browser si è fermato prima dell'editor, con il pannello Notifiche aperto;
la ripetizione mirata e l'esecuzione completa finale sono passate.

Evidenze locali in `_smoke/editor-parity/`: `soft-break-regression-before.log`,
`soft-break-focused.log`, `soft-break-browser.log`, `soft-break-playwright/`,
`soft-break-check.log`, `soft-break-full-browser.log`, `soft-break-full-browser/`,
`soft-break-build.log`, `soft-break-reference.json`, `soft-break-transfer.json`,
`soft-break-compare.mjs`, `soft-break-readback.json`,
`soft-break-api-readback.json` e `soft-break-docs.png`.

Restano aperti inizio del paragrafo, selezioni estese/miste, altri font,
titoli, link, formule, immagini, celle, ritorni consecutivi e cancellazione
ai relativi confini, vecchi ritorni non formattati, ripiego HTML in Docs,
percorso inverso e build desktop WebView2/WKWebView. Il gruppo non chiude
TEXT-01, LIST-01, le fasi 2/3, impaginazione o numeri di pagina.
Nessun commit/push/release.

## Verifica del ventiquattresimo gruppo

TEXT-SOFT-02 estende il gruppo 23 con dodici casi: per ognuno di paragrafo,
voce numerata root e voce numerata annidata, un ritorno iniziale oppure due
ritorni consecutivi all'inizio, dopo Pr e alla fine di Prima. La prova
browser ripete anche i sei casi precedenti, per diciotto cicli complessivi.
Stili combinati: grassetto, corsivo, sottolineato, barrato, Georgia 18 pt,
testo #123abc ed evidenziatura #ffee00. Sorgente sintetica con Seconda;
nel ramo annidato sono presenti anche Madre e Ultima, con marcatori 1/a/b/2.
[Documento Docs con 24 tab](https://docs.google.com/document/d/1j7jqtD947BMWbo66oefou8oExyR7sDy5ofoSGiaRrok/edit).

**Difetto riprodotto:** CustomHardBreak conservava i mark a metà/fine, ma
al caret iniziale, con parentOffset 0 e storedMarks null, sceglieva un
insieme vuoto. Ritorno e digitazione successiva perdevano gli stili.
Sei casi DOM falliscono prima della correzione. Il riferimento reale Docs
conserva gli otto attributi sia sul ritorno iniziale sia su X.

**Correzione:** una selezione vuota usa i mark risolti da ProseMirror anche
all'inizio del blocco. Gli storedMarks espliciti hanno precedenza, compreso
l'insieme vuoto; non si cambia il trattamento delle selezioni estese, il
filtro dei mark consentiti, l'isolamento o l'uscita dai blocchi di codice.
Nessun nuovo attributo/schema o riscrittura dei vecchi ritorni non formattati.
Due controlli DOM verificano anche due ritorni iniziali con mark espliciti
vuoti o solo grassetto, lasciando il testo originale corsivo.

**App:** diciotto casi DOM verificano nodo, stili nativi dei ritorni,
undo/redo e rilettura HTML. Diciotto gesti Chromium reali verificano X,
caret a offset + numero di ritorni + 1, lo stesso numero di paragrafi/voci,
uno/due ritorni nel blocco, stili combinati, autosave, chiusura/riapertura e
copia identica. Il testo Prima rimane nel medesimo blocco. Le altezze
rilevate sono 33,109 px prima, 66,219 px con un ritorno e 99,328 px con due.
Undo immediato annulla insieme ritorni e X; redo li ripristina.
La selezione iniziale viene predisposta via ProseMirror; i ritorni e la
digitazione usano i tasti del browser.

**Docs:** dodici riferimenti creati con struttura/stili nativi, dodici copie
provenienti da Ctrl+C dopo salvataggio e riapertura dell'app. I gesti sui
riferimenti verificano testo e undo/redo. Incolla reale Ctrl+V e ricopia
coincidono per testo, incluso U+000B, otto attributi di ciascun carattere,
livelli, rientri, interlinea, numerazione e tipo di marcatore. Dopo apertura
in una nuova scheda, la ricopia dei 24 tab conserva le stesse proprietà;
i nuovi ID di copia sono distinti da quelli precedenti. L'API conferma
font, dimensione, quattro mark, colore ed evidenziatura sui ritorni e X
salvati in tutti i campioni. Il confronto rimuove soltanto i paragrafi
vuoti finali senza marcatore del destinatario; non esclude ritorni interni,
caratteri o stili. Non è una misura di identità geometrica app/Docs.

**Controlli:** 135 test DOM mirati passati. Una prima esecuzione mirata ha
rilevato un'intermittenza nella fixture del test preesistente di rimozione
parziale della formattazione: il paragrafo finale automatico poteva arrivare
dopo la fotografia iniziale usata per undo. La fixture ora include già il
paragrafo finale, senza cambiare il comportamento dell'app. Il gate finale
passa con 95 file e 1.263 test frontend; backend 88,26%, frontend linee
85,48%, branch 76,04%, funzioni 79,85%. Suite browser 37/37 passata.
Build Vite passata in cartella separata sotto _smoke, senza sostituire
webui/dist. Diff check passato.

Evidenze locali in `_smoke/editor-parity/`: `soft-boundary-regression-before.log`,
`soft-boundary-focused.log`, `soft-boundary-browser.log`,
`soft-boundary-playwright/`, `soft-boundary-check-final.log`,
`soft-boundary-full-browser.log`, `soft-boundary-full-browser/`,
`soft-boundary-build.log`, `soft-boundary-reference.json`,
`soft-boundary-transfer.json`, `soft-boundary-compare.mjs`,
`soft-boundary-readback.json`, `soft-boundary-api-readback.json` e
`soft-boundary-docs.png`.

Restano aperti selezioni estese/miste, altri font, titoli, link, formule,
immagini, celle, più di due ritorni, navigazione/cancellazione ai confini,
ritorni storici senza mark, ripiego HTML in Docs, percorso inverso e build
desktop WebView2/WKWebView. Il gruppo non chiude TEXT-01, LIST-01, le fasi
2/3, impaginazione o numeri di pagina. Nessun commit/push/release.

## Verifica del venticinquesimo gruppo

TEXT-SOFT-03 verifica Shift+Enter su nove selezioni interne a un blocco:
paragrafo normale, voce numerata root e voce numerata annidata, ciascuno
con tre profili. La parola Prima è tutta formattata nel profilo uniforme;
nei profili misto e confine soltanto Pr ha grassetto, corsivo, sottolineato,
barrato, Georgia 18 pt, testo #123abc ed evidenziatura #ffee00; ima è Arial
11 pt normale. Uniforme/misto selezionano rim, confine seleziona im.
Shift+Enter sostituisce la selezione con un ritorno e viene digitata X:
risultato P + ritorno + Xa oppure Pr + ritorno + Xa. Seconda segue;
il ramo annidato comprende Madre e Ultima, con marcatori 1/a/b/2.
[Documento Docs con 18 tab](https://docs.google.com/document/d/1JN3_Wuu0eJCoJe2Gyq_MWz-QCjpJRG9FnDYe1Mzt9vA/edit).

**Difetto riprodotto:** al confine dopo Pr, selection.$from.marks()
restituiva i mark del carattere precedente. Ritorno e X diventavano
Georgia 18 formattati, benché tutti i caratteri selezionati fossero
normali. Il riferimento Docs usa Arial 11 normale su entrambi. Tre
regressioni, una per struttura, falliscono prima della correzione;
gli altri sei casi concordavano già con i riferimenti.

**Correzione:** per una selezione non vuota nello stesso blocco,
CustomHardBreak usa i mark del primo nodo inline selezionato. Conserva
la precedenza degli storedMarks espliciti e il filtro dei mark ammessi.
Il percorso delle selezioni fra blocchi conserva il comportamento
precedente. Nessun nuovo schema o riscrittura dei ritorni già salvati.

**App:** nove regressioni DOM controllano mark del ritorno e X, payload
nativo, posizione del caret, undo/redo e round-trip HTML. Nove cicli
Chromium selezionano rim/im con ArrowRight e Shift+ArrowRight, poi
usano Shift+Enter e digitano X. Prima del gesto, la fixture attende che
ProseMirror recepisca ogni selectionchange del browser; la prima prova
leggeva la selezione troppo presto e si fermava prima di Shift+Enter.
Caret finale a offset 3 nei profili uniforme/misto e 4 al confine;
stesso numero di paragrafi e medesimi rientri orizzontali. Le altezze
del blocco passano da 33,109 px a 66,219 px nei profili uniforme/misto,
a 53,344 px al confine. Undo immediato ripristina l'intera sorgente,
annullando insieme ritorno e X; redo ripristina il risultato, come Docs.
Autosave, chiusura/riapertura dell'editor e Ctrl+C conservano l'HTML
e gli stessi formati di copia.

**Docs:** nove riferimenti creati con stili/struttura nativi e modificati
con selezione da tastiera, Shift+Enter, X e undo/redo. Nove copie native
provengono dall'app dopo autosave e riapertura. Incolla formattato e
ricopia coincidono per testo, U+000B incluso, otto stili per carattere,
livelli, rientri, interlinea e numerazione. Dopo riapertura in una nuova
scheda, tutti i 18 campioni conservano le proprietà; gli ID di copia
sono nuovi. La lettura API conferma gli stili di ogni carattere del
blocco modificato, inclusi ritorno e X, in tutti i tab. Il primo giro
di incolla ricopiava prima del completamento dell'operazione: ripetuto
sulle destinazioni sintetiche attendendo Saved to Drive, prima della
ricopia. Il confronto esclude soltanto paragrafi vuoti finali senza
marcatore, conservando tutti i ritorni interni e gli stili. Non è una
misura di identità geometrica app/Docs.

**Controlli:** 92 test DOM mirati passati e 46 nel controllo della fixture
finale. Il primo gate rileva un'intermittenza nel test preesistente di
copia parziale del titolo: la fotografia iniziale precedeva l'aggiunta
del paragrafo finale automatico. La sorgente della fixture ora include
quel paragrafo; nessun cambiamento al comportamento dell'app. Gate
finale passato: 95 file, 1.272 test frontend; backend 88,27%, frontend
linee 85,46%, branch 76,04%, funzioni 79,78%. Suite browser dell'editor
38/38 passata. Build Vite passata in cartella separata sotto _smoke,
senza sostituire webui/dist. Diff check passato.

Evidenze locali in `_smoke/editor-parity/`: `soft-selection-regression-before.log`,
`soft-selection-focused.log`, `soft-selection-fixture.log`,
`soft-selection-browser.log`, `soft-selection-playwright/`,
`soft-selection-check.log`, `soft-selection-check-final.log`,
`soft-selection-full-browser.log`, `soft-selection-full-browser/`,
`soft-selection-build.log`, `soft-selection-reference.json`,
`soft-selection-transfer.json`, `soft-selection-compare.mjs`,
`soft-selection-readback.json`, `soft-selection-api-readback.json` e
`soft-selection-docs.png`.

Restano aperti selezioni inverse, selezioni dell'intero testo o da inizio
blocco, range su più blocchi, selezioni di ritorni/oggetti, titoli, celle,
link, formule, altre combinazioni di font e stili, navigazione/cancellazione
ai confini, ritorni storici senza mark, ripiego HTML, percorso inverso e
build desktop WebView2/WKWebView. Il gruppo non chiude TEXT-01, LIST-01,
le fasi 2/3, impaginazione o numeri di pagina. Nessun commit/push/release.


## Verifica del ventiseiesimo gruppo

TEXT-SOFT-04 verifica quindici nuovi casi nello stesso blocco, cinque per
ognuno di paragrafo normale, voce numerata root e voce numerata annidata.
Tre selezioni inverse ripetono i profili del gruppo 25: rim uniforme, rim
misto e im al confine dopo Pr. Le altre due selezioni procedono in avanti:
Pri dal primo carattere e tutto Prima, escludendo il terminatore di paragrafo.
Nel profilo uniforme Prima ha grassetto, corsivo, sottolineato, barrato,
Georgia 18 pt, colore #123abc ed evidenziatura #ffee00; negli altri solo Pr
ha tali stili e ima è Arial 11 pt normale. Seguono Seconda e, nel ramo
annidato, Madre e Ultima con marcatori 1/a/b/2.
[Documento Docs con trenta tab](https://docs.google.com/document/d/1f_yg7or9XZLezqsN0_m3CDmNBhvf5sZemE-f3MWBFls/edit).

**Risultato:** nessun nuovo difetto nel corpus campionato. La correzione del
gruppo 25 usa già il primo carattere selezionato anche con anchor maggiore
di head, a inizio blocco e quando viene sostituito tutto il testo del blocco.
Shift+Enter più X produce P + ritorno + Xa, Pr + ritorno + Xa,
ritorno + Xma o ritorno + X, mantenendo il medesimo paragrafo/voce e gli stili
del testo rimasto. Il ritorno e X hanno lo stile del primo carattere selezionato;
al confine dopo Pr rimangono normali. Nessuna modifica al codice del motore.

**App:** estesi i test DOM e Chromium del gruppo 25 con quindici nuovi casi,
per ventiquattro combinazioni in ciascun test parametrico. DOM verifica
anchor/head prima del gesto, mark dei due nodi inseriti, offset finale,
payload nativo, undo/redo e rilettura HTML. Chromium usa ArrowRight e
Shift+ArrowLeft/Right per le selezioni reali e attende selectionchange;
controlla anche verso, testo selezionato, geometria orizzontale invariata,
stesso numero di paragrafi, un solo hardBreak, autosave, chiusura/riapertura
e copia identica. Offset finale 3, 4 o 2 secondo il profilo. Undo immediato
annulla insieme il ritorno e X; redo ripristina il risultato, come Docs.

**Docs:** quindici sorgenti con testo, stili e liste native, modificate con
selezione da tastiera, Shift+Enter, X e undo/redo; quindici copie dall'app
salvata e riaperta. Incolla reale e ricopia coincidono per ogni carattere,
U+000B incluso, otto attributi di testo, livelli, rientri, interlinea,
numerazione e marcatore. Riapertura in una nuova scheda browser e ricopia
di tutti i trenta tab confermano la durata, con ID di copia nuovi rispetto
ai precedenti. La lettura API conferma gli stili di tutti i caratteri del
blocco modificato in ciascun tab, ritorno e X inclusi. Il confronto rimuove
soltanto i paragrafi vuoti finali senza marcatore del destinatario; conserva
ritorni interni, testo e stili. Non misura identità geometrica app/Docs.

**Procedura di prova:** il primo giro ha individuato due problemi
dell'automazione: tasti inviati prima che il cambio di tab Docs fosse
completato e ricopia nella nuova scheda senza focus nativo sul documento.
Ripetute le prove interessate sulle destinazioni sintetiche, caricando
ogni tab dal suo indirizzo e usando focus esplicito e ID di copia nuovi.
Il confronto semantico finale e la lettura API passano per tutti i campioni.

**Controlli:** 65 test DOM mirati passati. Gate completo passato con 95 file
e 1.287 test frontend; copertura backend 88,25%, frontend linee 85,46%,
branch 76,04%, funzioni 79,78%. Lint e typecheck passati. Suite browser
dell'editor 38/38 passata, inclusi i ventiquattro cicli del test esteso.
Build Vite separata sotto _smoke, senza sostituire webui/dist. Diff check
passato. Il file di coverage backend temporaneo di questa prova è stato rimosso.

Evidenze locali in `_smoke/editor-parity/`: `soft-range-focused.log`,
`soft-range-browser.log`, `soft-range-playwright/`, `soft-range-check.log`,
`soft-range-full-browser.log`, `soft-range-full-browser/`,
`soft-range-build.log`, `soft-range-reference.json`,
`soft-range-transfer.json`, `soft-range-compare.mjs`, `soft-range-compare.log`,
`soft-range-readback.json`, `soft-range-api-readback.json` e `soft-range-docs.png`.

Restano aperti range su più blocchi, selezioni comprendenti terminatori di
paragrafo, ritorni o oggetti, selezioni inverse da inizio/intero blocco,
titoli, celle, link, formule, altre combinazioni di font/stili,
navigazione/cancellazione ai confini, ritorni storici senza mark, ripiego
HTML, percorso inverso e build desktop WebView2/WKWebView. Il gruppo non
chiude TEXT-01, LIST-01, le fasi 2/3, impaginazione o numeri di pagina.
Nessun commit/push/release.


## Verifica del ventisettesimo gruppo

TEXT-SOFT-05 chiude il caso di selezione inversa da inizio/intero testo del
corpus limitato dei gruppi 25/26: sei nuovi campioni, due per ognuno di
paragrafo normale, voce numerata root e voce numerata annidata. Si seleziona
Pri oppure tutto Prima da destra verso sinistra, senza il terminatore di
paragrafo. Pr ha grassetto, corsivo, sottolineato, barrato, Georgia 18 pt,
colore #123abc ed evidenziatura #ffee00; ima è Arial 11 pt normale.
Seguono Seconda e, nel ramo annidato, Madre e Ultima con marcatori 1/a/b/2.
[Documento Docs con dodici tab](https://docs.google.com/document/d/1X1y05xdhEemwE41KeoLiC8T58YnaqkICT6ClprVnG5o/edit).

**Risultato:** nessun nuovo difetto nel corpus campionato. Shift+Enter e X
producono ritorno + Xma o ritorno + X nello stesso paragrafo/voce. Il ritorno
e X ricevono gli otto stili del primo carattere selezionato; ma resta normale.
Il caret termina all'offset 2 e la voce successiva mantiene la numerazione.
Nessuna modifica al codice del motore.

**App:** i test parametrizzati DOM e Chromium comprendono ora trenta casi,
con sei nuovi campioni. DOM verifica anchor/head inversi, mark di ritorno e X,
caret, payload nativo, undo/redo e rilettura HTML. Chromium costruisce le
selezioni con ArrowRight e Shift+ArrowLeft, attende selectionchange e verifica
verso, testo selezionato, geometria orizzontale, stesso numero di paragrafi,
un solo hardBreak, cronologia, autosave, chiusura/riapertura e copia identica.
Undo immediato annulla insieme ritorno e X; redo ripristina il risultato,
come nei riferimenti Docs.

**Docs:** sei sorgenti con testo, stili e liste native, modificate con i
medesimi gesti da tastiera, e sei incolla delle copie dall'app salvata e
riaperta. Il confronto semantico coincide per tutti i caratteri, U+000B
incluso, otto stili, livelli, rientri, interlinea, marcatori e numerazione.
Riapertura in una nuova scheda e ricopia dei dodici tab confermano la durata;
gli ID di copia sono nuovi rispetto ai campioni precedenti. La lettura API
conferma tutti i caratteri e gli otto stili di ogni paragrafo conservato,
oltre a livelli, rientri e interlinea, in tutti i dodici tab. Si escludono
soltanto i paragrafi vuoti finali senza marcatore del destinatario. Non si
misura identità geometrica app/Docs.

**Procedura di prova:** tre incolla inviati prima del completamento del
focus hanno lasciato vuote le destinazioni; ripetuti con focus esplicito e
controllo del contenuto. La prima automazione di ricopia nella nuova scheda
riutilizzava il binding della scheda precedente. Ripetute tutte le ricopie
passando il tab esplicitamente alla procedura e verificando testo atteso e
ID di copia nuovo; il confronto semantico finale e quello API passano.

**Controlli:** 71 test DOM mirati passati. Gate completo passato con 95 file
e 1.293 test frontend; copertura backend 88,28%, frontend linee 85,46%,
branch 76,04%, funzioni 79,78%. Lint e typecheck passati. Suite browser
editor 38/38 passata, inclusi i trenta cicli del test esteso. Build Vite
separata sotto _smoke, senza sostituire webui/dist. Diff check passato.
Il file di coverage backend temporaneo di questa prova è stato rimosso.

Evidenze locali in `_smoke/editor-parity/`: `soft-reverse-focused.log`,
`soft-reverse-browser.log`, `soft-reverse-playwright/`,
`soft-reverse-check.log`, `soft-reverse-full-browser.log`,
`soft-reverse-full-browser/`, `soft-reverse-build.log`,
`soft-reverse-reference.json`, `soft-reverse-transfer.json`,
`soft-reverse-compare.mjs`, `soft-reverse-compare.log`,
`soft-reverse-readback.json`, `soft-reverse-api.json`,
`soft-reverse-api-check.mjs`, `soft-reverse-api-readback.json` e
`soft-reverse-docs.png`.

Restano aperti range su più blocchi, selezioni comprendenti terminatori di
paragrafo, ritorni o oggetti, titoli, celle, link, formule, altre combinazioni
di font/stili, navigazione/cancellazione ai confini, ritorni storici senza
mark, ripiego HTML, percorso inverso e build desktop WebView2/WKWebView.
Il gruppo non chiude TEXT-01, LIST-01, le fasi 2/3, impaginazione o numeri
di pagina. Nessun commit/push/release.


## Verifica del ventottesimo gruppo

TEXT-SOFT-06 verifica sei nuovi casi nello stesso blocco: selezione in avanti
e inversa di r + ritorno interno + i nel testo Pr + ritorno + ima, in
paragrafo normale, voce numerata root e voce numerata annidata. Pr e il
ritorno iniziale hanno grassetto, corsivo, sottolineato, barrato, Georgia
18 pt, colore #123abc ed evidenziatura #ffee00; ima è Arial 11 pt normale.
Seguono Seconda e, nel ramo annidato, Madre e Ultima con marcatori 1/a/b/2.
[Documento Docs con dodici tab](https://docs.google.com/document/d/1zG6W6wMOkdKSHn6ScHnVXcATwK6-337Kvh6IwguvBEA/edit).

**Risultato:** nessun nuovo difetto nel corpus campionato. Shift+Enter e X
producono P + ritorno + Xma nello stesso paragrafo/voce: il ritorno precedente
è sostituito e rimane un solo hardBreak. Il nuovo ritorno e X ricevono gli
otto stili di r, primo carattere selezionato, anche con anchor maggiore di
head; ma resta normale. Il caret termina all'offset 3. Numero di paragrafi,
livelli, rientri orizzontali e numerazione successiva restano invariati.
Undo immediato annulla insieme sostituzione e X, ripristinando r, il ritorno
originario e i; redo ripristina il risultato, come Docs. Nessuna modifica
al codice del motore.

**App:** i test parametrizzati DOM e Chromium comprendono ora 36 casi,
con sei nuovi campioni. DOM verifica verso anchor/head, mark del ritorno
e di X, caret, payload nativo, undo/redo e rilettura HTML. Chromium costruisce
le selezioni con ArrowRight e Shift+ArrowLeft/Right, attende selectionchange
e verifica il testo selezionato includendo U+000B come leafText di hardBreak.
Controlla anche un solo hardBreak dopo la sostituzione, geometria orizzontale,
stesso numero di paragrafi, cronologia, autosave, chiusura/riapertura e copia
identica. Il timeout del test esteso passa da 180 a 210 secondi; il ciclo
mirato completa le 36 combinazioni in circa 1,2 minuti.

**Docs:** sei sorgenti native con ritorno interno, stili e liste salvati,
modificate con i medesimi gesti da tastiera; sei copie dall'app salvata e
riaperta, incollate e ricopiate. Tutti i campioni coincidono per testo,
U+000B incluso, otto stili di ogni carattere, livelli, rientri, interlinea
1,15, marcatori e numerazione. Ricarica del documento salvato e ricopia dei
dodici tab confermano la durata con ID di copia nuovi. La lettura API
conferma tutti i caratteri e gli otto stili di ogni paragrafo conservato,
oltre a livelli, rientri e interlinea, in tutti i dodici tab. Si escludono
soltanto i paragrafi vuoti finali senza marcatore del destinatario. Non si
misura identità geometrica app/Docs.

**Procedura di prova:** la prima preparazione tramite Shift+Enter aveva
raggruppato il ritorno sorgente e la sostituzione nella cronologia Docs;
l'undo rimuoveva anche il ritorno preparatorio. Inoltre un cambio di tab
seguito troppo presto da tasti aveva modificato un altro campione sintetico.
Ripristinate tutte le sei sorgenti tramite API, incluso U+000B con gli stili
delimitati, e ricaricato il documento. Ripetuti tutti i gesti verificando
tab selezionato, focus, testo iniziale/selezionato, stato dopo le azioni,
undo/redo e nuovi ID di ricopia. Le prove finali semantiche e API passano.

**Controlli:** 73 test DOM mirati passati. Gate completo passato con 95 file
e 1.299 test frontend; copertura backend 88,25%, frontend linee 85,46%,
branch 76,04%, funzioni 79,78%. Lint e typecheck passati. Suite browser
editor 38/38 passata, incluse le 36 combinazioni del test esteso. Build Vite
separata sotto _smoke, senza sostituire webui/dist. Diff check passato.
Il file di coverage backend temporaneo di questa prova è stato rimosso.

Evidenze locali in `_smoke/editor-parity/`: `soft-existing-focused.log`,
`soft-existing-browser.log`, `soft-existing-playwright/`,
`soft-existing-check.log`, `soft-existing-full-browser.log`,
`soft-existing-full-browser/`, `soft-existing-build.log`,
`soft-existing-reference.json`, `soft-existing-transfer.json`,
`soft-existing-compare.mjs`, `soft-existing-compare.log`,
`soft-existing-readback.json`, `soft-existing-api.json`,
`soft-existing-api-check.mjs`, `soft-existing-api-readback.json` e
`soft-existing-docs.png`.

Restano aperti altri range comprendenti ritorni (ritorno come primo nodo
selezionato, ritorno isolato o più ritorni), range su più blocchi, terminatori
di paragrafo, oggetti, titoli, celle, link, formule, altre combinazioni di
font/stili, navigazione/cancellazione ai confini, ritorni storici senza mark,
ripiego HTML, percorso inverso e build desktop WebView2/WKWebView. Il gruppo
non chiude TEXT-01, LIST-01, le fasi 2/3, impaginazione o numeri di pagina.
Nessun commit/push/release.

## Verifica del ventinovesimo gruppo

TEXT-SOFT-07 verifica sei nuovi casi nello stesso blocco: selezione in avanti
e inversa del ritorno interno + i nel testo Pr + ritorno + ima, in
paragrafo normale, voce numerata root e voce numerata annidata. Pr e il
ritorno iniziale hanno grassetto, corsivo, sottolineato, barrato, Georgia
18 pt, colore #123abc ed evidenziatura #ffee00; ima è Arial 11 pt normale.
Seguono Seconda e, nel ramo annidato, Madre e Ultima con marcatori 1/a/b/2.
[Documento Docs con dodici tab](https://docs.google.com/document/d/1W-1y4Aj1Q5Wun5jQMbcWKXpM31c5LGD0wRgCf_njpKE/edit).

**Risultato:** nessun nuovo difetto nel corpus campionato. Shift+Enter e X
producono Pr + ritorno + Xma nello stesso paragrafo/voce: rimane un solo
hardBreak e il nuovo ritorno e X ricevono gli otto stili del ritorno
selezionato, anche con anchor maggiore di head; ma resta normale.
Il caret app termina all'offset 4. Numero di paragrafi, livelli, rientri
orizzontali e numerazione successiva restano invariati. Undo immediato
annulla insieme sostituzione e X, ripristinando il ritorno originario e i;
redo ripristina il risultato, come Docs. Nessuna modifica al motore.

**App:** i test parametrizzati DOM e Chromium comprendono ora 42 casi,
con sei nuovi campioni. DOM verifica verso anchor/head, mark del ritorno
e di X, caret, payload nativo, undo/redo e rilettura HTML. Chromium costruisce
le selezioni con ArrowRight e Shift+ArrowLeft/Right e verifica il testo
selezionato includendo U+000B come leafText di hardBreak. Controlla anche
un solo hardBreak, geometria orizzontale, stesso numero di paragrafi,
cronologia, autosave, chiusura/riapertura e copia identica. Il timeout del
test esteso passa da 210 a 240 secondi; il ciclo mirato completa le 42
combinazioni in circa 1,4 minuti.

**Docs:** sei sorgenti native con ritorno interno, stili e liste salvati,
modificate con gli stessi gesti da tastiera; verificati tab selezionato,
focus e selezione di ritorno + i tramite copia. Sei copie dall'app salvata
e riaperta, incollate e ricopiate. Tutti i campioni coincidono per testo,
U+000B incluso, otto stili di ogni carattere, livelli, rientri, interlinea
1,15, marcatori e numerazione. Ricarica del documento salvato e ricopia dei
dodici tab confermano la durata con ID di copia nuovi. La lettura API
conferma ogni carattere e gli otto stili di ogni paragrafo conservato,
oltre a livelli, rientri e interlinea, in tutti i dodici tab. Si escludono
soltanto i paragrafi vuoti finali senza marcatore del destinatario. Non si
misura identità geometrica app/Docs.

**Controlli:** 79 test DOM mirati passati. Gate completo passato con 95 file
e 1.305 test frontend; copertura backend 88,25%, frontend linee 85,46%,
branch 76,04%, funzioni 79,78%. Lint e typecheck passati. Test browser mirato
passato con 42 combinazioni; suite browser editor 38/38 passata. Build Vite
separata sotto _smoke, senza sostituire webui/dist. Il file di coverage
backend temporaneo di questa prova è stato rimosso. Diff check passato.

Evidenze locali in `_smoke/editor-parity/`: `soft-first-focused.log`,
`soft-first-browser.log`, `soft-first-playwright/`, `soft-first-check.log`,
`soft-first-full-browser.log`, `soft-first-full-browser/`,
`soft-first-build.log`, `soft-first-reference.json`,
`soft-first-transfer.json`, `soft-first-compare.mjs`,
`soft-first-compare.log`, `soft-first-readback.json`, `soft-first-api.json`,
`soft-first-api-check.mjs`, `soft-first-api-check.log`,
`soft-first-api-readback.json` e `soft-first-docs.png`.

Restano aperti ritorno isolato, più ritorni selezionati, ritorni con stili
indipendenti da quelli dei caratteri vicini, range su più blocchi, terminatori
di paragrafo, oggetti, titoli, celle, link, formule, altre combinazioni di
font/stili, navigazione/cancellazione ai confini, ritorni storici senza mark,
ripiego HTML, percorso inverso e build desktop WebView2/WKWebView. Il gruppo
non chiude TEXT-01, LIST-01, le fasi 2/3, impaginazione o numeri di pagina.
Nessun commit/push/release.

## Verifica del trentesimo gruppo

**Data:** 4–5 ottobre 2026. **Perimetro:** SAVE-01 e MIX-04, primo documento
misto rappresentativo nel percorso nativo. Rimane l'editor continuo.

Il [corpus](../webui/e2e/fixtures/editor-parity-mixed.html) contiene titolo 1,
titolo 2 Georgia 18 blu, grassetto/corsivo, ritorno interno, colore insieme a
evidenziatura, link sintetico, paragrafo con line-height CSS 1,6 e spazi 8/10 pt,
lista maiuscola da D con figlia b, tabella 3×2 con colonne 210/390 px, due
paragrafi in una cella e ultima riga unita, immagine inline senza didascalia
al 35% della larghezza utile e frazione `\frac{x^2}{y}`. Il placeholder
dell'immagine viene sostituito con il JPEG sintetico già presente nei test.

**Difetto riprodotto:** dopo modifica, autosave e riapertura dell'app,
`normalizePreviewHtmlContent` eliminava line-height e margini verticali,
`data-document-line-spacing`, `data-math` e `data-math-block`. La formula
inline perdeva il proprio nodo e veniva importata come testo duplicato
del rendering KaTeX. Il backend aveva conservato gli attributi: la perdita
avveniva durante la preparazione della preview per riaprire l'editor.

**Correzione:** la normalizzazione conserva interlinea/margini e gli attributi
semantici sui rispettivi nodi, continuando a rimuovere data-* non ammessi.
L'iterazione degli stili gestisce anche elementi MathML senza CSSStyleDeclaration
nel DOM di test. Due nuove regressioni della normalizzazione e una con lo
schema reale verificano paragrafi/titoli, interlinea nativa e formule
inline/blocco, confrontando documento e formati nativi prima/dopo.

**App:** Chromium esegue incolla, modifica della cella «Misura da correggere»,
annulla/ripristina, copia, taglio/annulla, autosave, chiusura e riapertura,
Ctrl+C e pulsante «Copia formattata». Rimangono celle/larghezze, formula,
stili e testo. I pixel copiati dell'immagine sono 222×148, con formato nativo
166,5×111 pt; il bitmap sorgente nell'app non viene sostituito.

**Docs:** nuovo tab
[Documento misto — copia app](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.utudchv88po5).
Il browser integrato incolla normalmente gli stessi formati acquisiti dal
vero evento Ctrl+C nel test Chromium dopo la riapertura dell'app; nessuna
modifica dei payload per il destinatario. Dopo «Saved to Drive», reload e
ricopia coincidono il testo nativo, i 18 campioni di carattere/paragrafo,
marcatori/livelli D/b/E, colonne 157,5/292,5 pt, cinque celle visibili con
padding 6/9 pt, dimensioni dell'immagine e comandi frazione/apice con posizioni
511/512. La API conferma tabella, cella unita, link, oggetto immagine inline e
formula nativa. Non è stata eseguita una nuova modifica della formula in Docs.

Docs aggiunge un paragrafo vuoto finale e materializza padding di 5 pt nello
slot coperto dalla cella unita, con colspan/rowspan zero. Il confronto conserva
questa differenza e verifica separatamente le cinque celle visibili. La vista
e l'albero accessibile confermano tre righe, due colonne e ultima riga unita.
Il foglio Docs è A4, margini 72 pt, zoom 100%; non si certifica identità
geometrica di tutto il documento o dei cambi pagina.

**Controlli:** 100 test DOM mirati passati dopo la correzione; gate completo
passato con 95 file/1.308 test frontend, backend 88,26%, frontend linee 85,46%,
branch 76,06%, funzioni 79,78%. Suite browser editor 39/39 passata, build Vite
separata senza sostituire `webui/dist`, lint/typecheck e diff check passati.
Il primo gate aveva esposto l'assenza di `style` sugli elementi MathML nel DOM
di test; il gate finale include la correzione. Coverage temporanea rimossa.

Evidenze in `_smoke/editor-parity/`: `representative-playwright/`,
`representative-full-playwright/`, `representative-transfer-readback.json`,
`representative-api-readback.json`, `representative-docs.png`,
`representative-focused.log`, `representative-check-final.log`,
`representative-full-browser.log`, `representative-build.log`.
Il readback Docs conserva soltanto dati del campione e proprietà, senza URL
delle immagini firmati, credenziali o identificatori delle risorse native.

Restano aperti wrap/didascalie, ripiego HTML MIX-02/MIX-03, selezioni miste,
altre topologie di tabella, modifica della formula nel destinatario,
percorso inverso e appunti nella build desktop WebView2/WKWebView. Questo
campione non chiude TABLE-01, IMAGE-01, MATH-01 o la fase 7. Paginazione e numeri
rimangono rinviati. La prossima consegna amplia il campione con wrap/didascalia
e una configurazione che impone HTML. Nessun commit/push/release.

## Verifica del trentunesimo gruppo

**Data:** 5 ottobre 2026. **Perimetro:** MIX-05/MIX-06; ampliamento del
documento misto del gruppo 30 con wrap e didascalie. Editor continuo.

Il nuovo test Chromium riusa `editor-parity-mixed.html`, sostituendo la figura
inline con tre configurazioni: wrap destra senza didascalia, wrap sinistra con
«Figura 1: campione sintetico», wrap destra con la stessa didascalia che impone
il ripiego HTML. Tutte usano larghezza 35% e offset Y 18 px. Restano titolo,
mark, ritorno interno, link, D/b/E, tabella 3×2 a colonne 210/390 px con cella
unita e frazione con apice. Per ogni caso si verificano modifica della cella,
undo/redo, copia, taglio/undo, autosave, chiusura/riapertura e copia da
tastiera/pulsante. Testo, attributi immagine, celle e HTML salvato persistono.
I due casi supportati emettono il formato nativo; il terzo emette HTML/testo.
Gli involucri html/head/body aggiunti dal browser e le sole canonicalizzazioni
di `rel`/colore sono normalizzati nel confronto, non nel contenuto copiato.

**Difetto riprodotto:** il primo incolla del caso con didascalia sinistra
mostrava tabella, immagine, formula e stili corretti, ma Docs rifiutava la
sincronizzazione: «Can’t sync your changes». La ricopia prima del ripristino
mostrava due marcatori tabella consecutivi `U+0011 U+0010`. La seconda tabella
è il contenitore senza bordi di immagine/didascalia. Il corpus isolato con
questa tabella e formule si salvava: il problema era l'adiacenza alla tabella
dati, non la sola didascalia. Lo stato rifiutato è registrato separatamente
e non conta come prova di persistenza. È stato ripristinato solo il tab
sintetico appena usato; gli altri tab del documento rimangono presenti.

**Correzione:** `separateAdjacentTables` in `editorClipboard.ts` inserisce
un paragrafo nativo normale fra tabelle adiacenti, sia per tabelle HTML sia
per il contenitore della didascalia. Non cambia l'HTML salvato nell'app.
Due regressioni inizialmente rosse verificano il confine, interlinea e spazi
del separatore, le due larghezze e i comandi della formula successiva.
L'E2E verifica il separatore nel vero Ctrl+C dopo il ciclo nell'app.

**Docs dopo la correzione:** gli appunti rigenerati dall'app sono incollati
normalmente, senza modifiche per il destinatario. «Saved to Drive», reload
e ricopia confermano il testo, i 19 campioni di carattere/paragrafo, lista,
le sei celle visibili (cinque dati più la cella del gruppo), colonne dati
157,5/292,5 pt, contenitore didascalia 166,5 pt, immagine 166,5×111 pt e
comandi frazione/apice. La didascalia rimane testo 9 pt, centrato nel gruppo.
Tab [Documento misto — didascalia sinistra](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.hgv7wxlnjexe).
La API conferma tabella dati, contenitore 1×1, oggetto inline ed equazione.
Il separatore e i ritorni vuoti finali vengono mantenuti come normalizzazioni
strutturali necessarie; non si dichiara identità geometrica dell'intero documento.

Il tab [Documento misto — wrap destra](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.8pnfp8d31xqn)
conserva dopo riapertura testo, 18 campioni, tabella/celle, formula e immagine
posizionata. Dimensioni 166,5×111 pt, origine nativa 297/10,5 pt e margini
sinistra/sopra 12/3 pt mantengono la traduzione del rettangolo sorgente.
I default di posizione flottante materializzati sulle tabelle inline sono
registrati ma non confrontati come proprietà attive.

**Ripiego HTML:** il tab
[Documento misto — didascalia destra HTML](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.4lg9fj4u1z4b)
si salva e il readback rimane uguale dopo reload, ma la fedeltà fallisce:

- L'immagine 222×148 px diventa inline, senza posizione wrap; la didascalia
  resta testo in un paragrafo separato, con interlinea 1,4 e spazi 9/12 pt.
- I paragrafi normali, i titoli e le liste importano interlinea nativa 1,38
  invece di 1,15; il paragrafo CSS 1,6 importa 1,6 nativo.
- La frazione non contiene più comandi di equazione: il testo diventa
  «yx2» seguito da uno spazio a larghezza zero, senza struttura frazione/apice.
- La seconda colonna diventa 291,75 anziché 292,5 pt (389 anziché 390 px).
  Celle unite, padding 6/9 pt e bordi delle celle 0,75 pt grigi rimangono.
  Il campo globale `tbls_bw` zero non significa assenza di questi bordi:
  la API conferma gli override per cella.

**Limite geometrico distinto:** nel caso nativo con didascalia l'app conserva
offset Y 18 px, ma la tabella flottante emessa usa ancora `vp_to: 0`.
Questa prova non certifica la posizione verticale app → Docs del gruppo.
La prossima consegna parte da questo limite e mantiene aperto il problema
della didascalia a destra/ripiego HTML, che degrada anche le formule circostanti.

**Controlli:** 144 test DOM mirati passati. Gate finale passato: 95 file,
1.310 test frontend, backend 88,25%; frontend linee 85,48%, branch 76,06%,
funzioni 79,79%. Build Vite separata sotto `_smoke`, lint e typecheck passati.
Suite browser finale 40/40 passata, eseguita senza il gate concorrente.
Una prova precedente aveva fallito sul test preesistente di rimozione della
formattazione: digitazione un carattere prima del caret atteso. Tre ripetizioni
isolate e la suite finale passano senza modificare quel test; non si attribuisce
con certezza la causa. Il nuovo test attende che l'istanza dell'editor sia
disponibile dopo la riapertura, oltre alla visibilità del suo contenitore.
Anche la ripetizione mirata finale con questa attesa passa sui tre casi.
Coverage backend temporanea rimossa e diff check passato.

Evidenze in `_smoke/editor-parity/`: `mixed-wrap-regression-before.log`,
`mixed-wrap-focused.log`, `mixed-wrap-final-playwright/`,
`mixed-wrap-right-readback.json`, `mixed-caption-left-rejected-readback.json`,
`mixed-caption-left-readback.json`, `mixed-caption-right-html-readback.json`,
`mixed-wrap-api-readback.json`, le corrispondenti viste `*-docs.png`,
`mixed-wrap-check-final.log`, `mixed-wrap-build-final.log` e
`mixed-wrap-caret-recheck.log`, `mixed-wrap-acceptance-browser.log` e
`mixed-wrap-acceptance-playwright/`, `mixed-wrap-ready-browser.log` e
`mixed-wrap-ready-playwright/`. Readback conservati senza URL immagini firmati,
credenziali o identificatori privati di oggetti Docs.

Restano aperti geometria completa delle didascalie, HTML MIX-02/MIX-03/MIX-06,
selezioni miste, altri layout/tabelle, modifica delle formule nel destinatario,
percorso inverso e appunti nella build WebView2/WKWebView. Paginazione e numeri
di pagina rimangono rinviati. Nessun commit, push o release.

## Verifica del trentaduesimo gruppo

**Data:** 5 ottobre 2026. **Perimetro:** MIX-05/MIX-07, coordinate verticali
dei gruppi immagine/didascalia wrap sinistra nel documento misto del gruppo 31.
Editor continuo; medesimi titolo, stili, D/b/E, tabella 3x2 con cella unita,
colonne 210/390 px, immagine 222x148 px e frazione nativa con apice.

**Emissione sorgente:** la tabella flottante della didascalia usava sempre
`vp_to: 0`. Ora traduce `data-offset-y` da px a pt per il solo layout wrap:
-20/0/18/120 px diventano -15/0/13,5/90 pt; valori invalidi diventano zero.
Il contenitore inline mantiene la coordinata flottante inattiva a zero.
Sei regressioni DOM coprono valori, dimensioni e didascalia modificabile;
tre fallivano prima della correzione sull'offset non zero.

**Difetto del layout app:** il nuovo caso negativo falliva ripetutamente
sull'undo della digitazione. La trace mostrava scroll superiore a 328.000 px:
l'immagine risaliva di 20 px e intersecava la tabella precedente; il risolutore
aggiungeva un gap prima della tabella, spostando sia la tabella sia l'ancora
dell'immagine. La collisione persisteva per tutte le 1.000 iterazioni di misura.
Il carico del layout interrompeva anche il raggruppamento della digitazione
nella cronologia. Non era un semplice fallimento occasionale del test.

**Correzione del wrap:** le collisioni con blocchi prima del paragrafo di
ancoraggio vengono escluse, sia per oggetti sia per testo. Spostare quei
blocchi sposterebbe anche l'immagine, quindi non puo' risolvere la collisione.
Il contenuto del documento e l'offset richiesto restano gli stessi; non si
certifica l'assenza di sovrapposizione per spostamenti negativi arbitrari.
Il test Chromium mantiene la digitazione da tastiera e il singolo undo,
senza cambiare il gesto per far passare la prova. Controlla altezza limitata
del documento e assenza di gap nella tabella precedente, oltre al ciclo
modifica/undo/redo/copia/taglio/undo/salva/riapri/copia da tastiera e pulsante.
Le cinque configurazioni passano: wrap destra senza didascalia, didascalia
sinistra con Y 18/-20/0 px e didascalia destra HTML.

**Riferimento Docs:** nel solo nuovo tab sintetico, le opzioni della tabella
impostano Y a 1 cm rispetto al paragrafo. La copia nativa emette
`vp_rt: 4`, `vp_t: 1`, `vp_to: 28,34645669291339`. Ricopiando e incollando
il documento nello stesso tab, Docs azzera `vp_to`; testo, stili, paragrafi,
celle, immagini ed equazione restano equivalenti. Salvataggio e reload
confermano lo zero. L'azzeramento appartiene dunque anche al percorso
Docs -> Docs e non viene risolto dalla sola traduzione della coordinata app.

**App -> Docs:** incollati senza modifiche gli appunti Ctrl+C acquisiti da
Chromium dopo la riapertura dell'app, nei tre casi con didascalia sinistra.
Attesi «Saved to Drive», reload e nuova ricopia per ciascuno. Tutti conservano
testo nativo, otto proprieta' di stile per ogni carattere, paragrafi/interlinea,
marcatori e livelli attivi, celle visibili e padding, larghezze, dimensioni
immagine e comandi frazione/apice. Si normalizzano solo i ritorni vuoti finali
e il default `tbls_pt: 0` della tabella inline, esplicitato da Docs.
Il controllo Y zero coincide anche per tutte le proprieta' flottanti.
Nei casi positivo/negativo la sola differenza flottante e' Y:
13,5/-15 pt nella sorgente diventano zero nel destinatario e restano zero
dopo riapertura. La fedelta' della posizione verticale rimane **aperta**.

Il tab finale [Didascalia - prova offset verticale](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.f1d8tte0gh9)
contiene il caso positivo. La API conferma tabella dati 3x2, contenitore
didascalia 1x1, un'immagine inline e un'equazione; i restanti 65 tab sono
identici alla lettura iniziale. Durante la preparazione sono stati ripristinati
solo i contenuti del nuovo tab sintetico dopo un input prematuro; le prove
finali verificano focus attivo, tab selezionato e contenuto ricopiato.

**Controlli:** 150 test DOM mirati passati; gate completo con 95 file e
1.316 test frontend, backend 88,25%, frontend linee 85,47%, branch 76,05%,
funzioni 79,73%. Suite browser editor 40/40 passata dopo la correzione;
il caso ampliato passa in circa 15 secondi. Build Vite separata sotto
`_smoke`, lint/typecheck e diff check passati; coverage backend temporanea rimossa.

Evidenze sotto `_smoke/editor-parity/`: `caption-offset-reference.json`,
`caption-offset-self-paste-readback.json`, `caption-offset-positive-readback.json`,
`caption-offset-negative-readback.json`, `caption-offset-zero-readback.json`,
`caption-offset-api-readback.json`, `caption-offset-compare.mjs`,
`caption-offset-docs.png`, `caption-offset-fixed-playwright/`,
`caption-offset-fixed-browser.log`, `caption-offset-check.log`,
`caption-offset-full-browser.log`, `caption-offset-full-playwright/` e
`caption-offset-build.log`. Le trace delle due prove iniziali fallite restano
in `caption-offset-playwright/` e `caption-offset-final-playwright/`.
Readback Docs conservati senza URL firmati o identificatori privati degli oggetti.

Il prossimo lavoro deve verificare una rappresentazione alternativa del gruppo
immagine/didascalia che conservi le coordinate dopo l'incolla prima di ampliare
la variante a destra. Rimangono aperti geometria completa, ripiego HTML,
selezioni miste e appunti nella build WebView2/WKWebView. Paginazione e numeri
di pagina restano rinviati. Nessun commit/push/release.

## Verifica del trentatreesimo gruppo

**Data:** 5 ottobre 2026. **Perimetro:** MIX-08, rappresentazioni alternative
del gruppo immagine/didascalia wrap sinistra. Prova del destinatario e dei
prototipi di formato; nessuna modifica al codice applicativo e nessun nuovo
ciclo app -> Docs dichiarato. Il corpus sorgente e' la ricopia Docs del
campione misto del gruppo 32, con Y ormai zero, stili, D/b/E, tabella dati,
immagine, didascalia e frazione ancora native.

Tutte le nuove scritture sono nel solo tab sintetico
[Didascalia - alternative di posizione](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit?tab=t.inhcdc2rlnfw).
I payload di prova modificano esclusivamente la proprieta' candidata della
ricopia sorgente. Non sono appunti finali dell'app e non certificano la sua
build desktop. Per i confronti controllati il tab viene svuotato prima
dell'incolla: una sostituzione diretta aveva riposizionato il gruppo a X
178,5 pt; il controllo su tab svuotato conserva X/Y zero e tutte le proprieta'.

**Ancoraggi:** un primo prototipo con basi diverse (orizzontale 4, verticale
1) mostra il corpus ma viene rifiutato dal servizio con «Can't sync your
changes»; il tab sperimentale viene ripristinato. Il riferimento corretto
«Fix on page», creato nelle opzioni native Docs, usa invece base 1 su entrambi
gli assi. La sua ricopia/incolla conserva X 72 pt ma modifica Y da circa
386,021 a 92 pt. Contenuto e stili coincidono; reload conferma il valore
riposizionato, non quello sorgente. Nessun ancoraggio viene applicato all'app.

**Spazi interni:** padding superiore della cella e spazio prima del paragrafo
immagine conservano 13,5 pt (+18 px) dopo incolla, «Saved to Drive», reload
e ricopia. Rimangono testo, otto stili dei caratteri, proprieta' dei paragrafi,
larghezze/posizione delle tabelle, celle, dimensioni immagine e comandi di
frazione/apice. I livelli e marcatori D/b/E sono confrontati separatamente
nel readback nativo. La didascalia con padding e' modificabile come testo:
la sostituzione conserva cella e immagine; undo ripristina tutte le proprieta'
confrontate, comprese le posizioni dei comandi dell'equazione successiva.
Durante l'edit tali posizioni cambiano con la lunghezza della didascalia e
non vengono confrontate come indici invarianti.

**Controesempio del wrap:** gli stessi due prototipi a 90 pt (+120 px) si
salvano e rimangono uguali dopo riapertura. Il confronto geometrico usa
viewport 1280x1000, zoom 100%, e misura il rettangolo blu interno dell'immagine
rispetto al bordo inferiore della tabella dati, cosi' da eliminare le
differenze di scorrimento della pagina. Il controllo dista 22 px; le varianti
+18 px distano 40 px; i due prototipi +120 px e il riferimento Docs spostato
direttamente distano tutti 142 px. L'opzione Docs arrotonda 3,175 cm a 3,17 cm,
emettendo Y 89,858 pt; il rettangolo osservato coincide alla risoluzione pixel.

La stessa quota dell'immagine non rende equivalenti i layout: nei prototipi
le prime righe del testo iniziano a X 635 px, mentre nel riferimento nativo
iniziano a X 398 px e occupano la larghezza sopra la figura. Padding e spazio
prima lasciano il contenitore flottante nell'origine e ne ampliano l'ingombro
vuoto. Spostare l'intera tabella libera invece quell'area per il testo.
Le alternative non vengono promosse a una correzione: risolverebbero una
coordinata visiva introducendo un'altra differenza di wrap. Questa prova non
copre spostamenti negativi, tutte le altre rappresentazioni native possibili
o la geometria completa dell'editor.

Il tab finale contiene il prototipo diagnostico con spazio prima 90 pt.
La API conferma due tabelle, un'immagine inline, un'equazione e `spaceAbove`
90 pt sul paragrafo immagine; gli altri 66 tab sono invariati in contenuto,
struttura, stili e metadati. Il confronto esclude solo `imageProperties.contentUri`,
URL temporaneo cambiato in tre tab; tutte le altre proprieta' sono confrontate.

**Controlli:** `caption-alternatives-check.mjs` passa: readback semantico,
salvataggio/riapertura, livelli, edit/undo didascalia, differenza del wrap e
preservazione dei tab. Le misure derivano dalle PNG tramite lo script Python.
Diff check passato. Il codice applicativo non cambia: gate/build/suite
Chromium del gruppo 32 non vengono rieseguiti e non sono nuove prove di questo
gruppo. Nessuna accettazione WebView2/WKWebView.

Evidenze sotto `_smoke/editor-parity/`: `caption-alternatives-readback.json`,
`caption-alternatives-api-readback.json`, `caption-alternatives-geometry.py`,
`caption-alternatives-geometry.json`, `caption-alternatives-check.mjs`,
`caption-alternatives-check.log`, `caption-alternatives-baseline.png`,
`caption-alternatives-padding.png`, `caption-alternatives-paragraph.png`,
`caption-alternatives-padding-120.png`, `caption-alternatives-paragraph-120.png`,
`caption-alternatives-native-120.png` e `caption-alternatives-final.png`.
Readback conservati senza URL firmati o identificatori privati degli oggetti.

Y non nullo resta aperto. Il prossimo caso misura se l'allineamento nativo a
destra, con Y zero, evita il ripiego HTML della didascalia senza perdere la
formula e gli stili circostanti. Le alternative appena provate non diventano
il punto di partenza della correzione. Rimangono aperti geometria, HTML,
selezioni miste e desktop. Paginazione e numeri rimangono rinviati.
Nessun commit, push o release.

## Verifica del trentaquattresimo gruppo

**Data:** 5 ottobre 2026. **Perimetro:** MIX-09, allineamento nativo a destra
del gruppo immagine/didascalia con Y zero nel campione misto. Verifica del
destinatario e di prototipi derivati dagli appunti del gruppo 32; nessuna
modifica applicativa, nessun nuovo ciclo di copia nell'app o test desktop.
Le scritture interessano soltanto il tab sintetico `t.inhcdc2rlnfw`, gia'
usato per le alternative di posizione. Gli altri 66 tab sono confrontati
con una lettura API precedente alla prima scrittura.

**Riferimento nativo:** dalle opzioni della tabella, lo stile inline con
allineamento destro, riconvertito a wrap, produce `hp_a: 2` insieme alla
coordinata X. Il riferimento finale imposta X 10,03 cm nelle opzioni native,
con «Move with text» e Y zero: ricopia emette X 284,31496062992125 pt.
Dopo «Saved to Drive» e reload restano testo, otto proprieta' dei caratteri,
paragrafi, tabelle, celle, comandi della frazione/apice e dimensioni immagine.
La tabella dati resta prima del gruppo figura nel contenuto del documento.

**Prototipo di allineamento:** il payload del campione a sinistra con Y zero
riceve `tbls_al: 2`, `hp_a: 2` e margini orizzontali sinistra 12/destra 0 pt.
Incolla, salvataggio e reload conservano i flag e tutte le proprieta' confrontate,
ma la figura rimane a sinistra. Anche il solo `hp_a: 2` aveva lasciato la
figura a sinistra; questo tentativo preliminare non ha readback autonomo.
La presenza dei flag non certifica il risultato geometrico.

**Ricopia del riferimento Docs:** il riferimento a destra, gia' riaperto,
viene ricopiato, il tab viene svuotato e gli stessi appunti sono incollati.
X diventa zero; Y resta zero, `hp_a: 2` e `tbls_al: 2` rimangono. Dopo un'altra
riapertura il risultato resta uguale. Il confronto nativo individua nella
coordinata X l'unica differenza fra le proprieta' delle tabelle campionate;
testo, caratteri, paragrafi, celle, formule e immagini coincidono.
La prova distingue il salvataggio del documento dalla normalizzazione
all'incolla: il primo mantiene X, la seconda lo azzera in questo corpus.

**Geometria:** viewport 1280x1000, zoom 100%, stesso scorrimento. Il rettangolo
blu interno della figura parte da X 778 px nel riferimento e X 400 px nel
prototipo/ricopia riaperti, differenza 378 px. La quota resta 22 px sotto il
bordo inferiore della tabella dati in tutti i campioni. Le prime righe del
testo partono invece da X 397 px nel riferimento e X 620 px dopo incolla.
Il testo passa quindi al lato opposto della figura: nessuna fedelta' geometrica
viene dichiarata. Le misure riguardano il rettangolo blu interno, non una
certificazione completa dei bordi e di tutte le righe.

La ricopia accessibile conserva i marcatori effettivi D/b/E. La API finale
conferma due tabelle, un'immagine inline e una formula; contenuto, struttura,
stili e metadati degli altri 66 tab sono invariati. Il confronto esclude
soltanto `imageProperties.contentUri`, URL temporaneo di consegna.

**Controlli:** `caption-right-check.mjs` passa per riferimento/reload,
ricopia/reload, persistenza dei flag, differenza circoscritta di X, stili,
geometria e preservazione dei tab. `git diff --check` passa. Nessun codice
applicativo cambia: gate, build e suite Chromium non sono rieseguiti e non
sono nuove prove di questo gruppo. Nessuna accettazione WebView2/WKWebView.

Evidenze sotto `_smoke/editor-parity/`: `caption-right-readback.json`,
`caption-right-api-readback.json`, `caption-right-geometry.py`,
`caption-right-geometry.json`, `caption-right-check.mjs`,
`caption-right-check.log`, `caption-right-native-reference.png`,
`caption-right-alignment-reopened.png`, `caption-right-self-paste.png`
e `caption-right-final.png`. I readback non conservano URL firmati o
identificatori degli oggetti privati.

MIX-09 documenta un'incompatibilita' del percorso misurato, senza escludere
tutte le altre rappresentazioni native possibili. I flag non vengono adottati
come correzione dell'app e MIX-06 resta aperto. Il prossimo caso riprende
MIX-03 sullo stesso documento misto: misurare la conversione dell'interlinea
nel ripiego HTML in destinazioni 1,15 e 2 prima di cambiare l'adattatore.
Formule HTML, geometria delle didascalie, selezioni miste e desktop rimangono
aperti. Paginazione e numeri di pagina restano rinviati.
Nessun commit, push o release.
