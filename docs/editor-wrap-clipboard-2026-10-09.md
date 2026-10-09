# Posizione delle immagini Wrap dopo incolla in Google Docs

## Segnalazione e causa

Nella sbobina «Patologia generale I lez. 4», la figura della steatosi risultava accanto al paragrafo corretto nell'app, ma dopo l'incolla appariva nella sezione «Reversibilità e Irreversibilità del Danno Cellulare».

Il layout `imageWrap` dispone il testo con decorazioni e compensa la posizione delle superfici delle immagini quando i paragrafi vengono spostati. Gli offset del modello restano invariati. `createNativeClipboardFormats` usava ancora l'offset salvato: per la seconda figura, 240,63 px invece dei 18,046875 px effettivamente visualizzati rispetto al paragrafo. L'ancoraggio in Docs era già al paragrafo della steatosi; era errato l'offset relativo, non l'identità del paragrafo.

Nel campione sintetico, la regressione Chromium prima della correzione esportava 180,4725 pt invece dei 28,7109375 pt misurati. La differenza era di circa 202 px. Nel campione reale il delta è circa 223 px.

## Correzione

`editorClipboard.ts` usa la posizione della superficie visualizzata rispetto al suo paragrafo per le immagini Wrap senza didascalia. Compensa lo zoom e conserva la conversione px → pt e il margine superiore del formato nativo.

`editorSelectionClipboard.ts` passa le esatte occorrenze selezionate del documento sorgente. Copiare solo la seconda occorrenza di un'immagine ripetuta non deve usare la geometria della prima. La copia tramite pulsante usa tutte le occorrenze in ordine di documento.

La correzione non modifica gli offset nell'HTML salvato, il contenuto del modello o la cronologia. Quando il DOM non offre una geometria misurabile, conserva il comportamento basato sugli attributi. I gruppi con didascalia continuano a usare il contratto separato delle tabelle flottanti.

## Verifiche

- **DOM:** 139 test mirati passati, comprese tre regressioni sulla geometria a scale 75%, 100% e 150%, sulla copia parziale dello stesso asset ripetuto e sulla conservazione dell'HTML originale.
- **Chromium:** sette casi pertinenti passati. Il nuovo caso verifica due immagini consecutive, copia da tastiera e pulsante alle tre scale, selezione della sola seconda figura, modello invariato dopo la copia, autosave e riapertura. Passati anche i casi esistenti su didascalie, copia/taglio, paste del menu contestuale, interlinea, spaziatura e Wrap libero.
- **Corpus reale in Chromium:** ripetuta la stessa verifica sull'estratto della sbobina segnalata, in un profilo isolato; la seconda figura esporta la posizione effettiva di 18,046875 px, conservando `data-offset-y="240.63"` nell'HTML.
- **Google Docs nel browser integrato:** incollati il campione sintetico e poi l'estratto reale in un documento di prova separato. Atteso `Saved to Drive`, ricaricato il documento e verificati tramite API testo, ancoraggi, coordinate e dimensioni. Tutti i valori geometrici del campione reale corrispondono esattamente alla clipboard esportata. La figura della steatosi resta accanto al proprio testo, sopra la sezione successiva. Nel campione sintetico verificati anche digitazione e annullamento. La ricopia tramite l'interfaccia della clipboard del browser ha restituito soltanto il contenuto del campo di accessibilità: non è usata come prova del formato nativo; il readback geometrico è quello dell'API dopo riapertura.
- **Windows dai sorgenti:** frontend di produzione e WebView2 con bridge Python reale, profilo isolato. Evento di copia e selezione sintetici via `evaluate_js`, senza esercitare la clipboard di sistema: i due offset coincidono con quelli Chromium prima e dopo autosave/riapertura; modello esattamente uguale e geometria stabile entro 1 px. La copia con input reale è verificata separatamente in Chromium.
- **Controllo completo:** `python scripts/build_release.py check --with-coverage --skip-npm-install` passato; 1.419 test frontend, copertura righe frontend 86,15%, Python 88,29%; Ruff, Pyright, ESLint e TypeScript passati. Build frontend e `git diff --check` passati.

## Evidenze e stato

Evidenze in `_smoke/wrap-clipboard-2026-10-09/`: regressione `before-results`, test finali `final-focused-results`, corpus reale `reported-results`, `docs-check.json`, letture API `docs-*-summary.json`, immagini `docs-reopened.png` e `docs-steatosi-reopened.png`, `native-report.json`, `full-check.log`.

Documento di prova: https://docs.google.com/document/d/138oSwiZqq2b-mDix-lVneXv9EEPDpJ7vh70yqez15hw/edit. La sbobina e il Google Doc originali sono stati solo letti.

Frontend ricompilato. Nessun nuovo exe/installer, commit, push o release. Le modifiche preesistenti sono preservate. Un eseguibile già confezionato deve essere ricostruito per includere la correzione. Questa verifica riguarda il bug riprodotto; non chiude geometria delle didascalie, HTML fallback, parità generale o runtime confezionati/macOS.

Proposta facoltativa di regola di revisione in `_smoke/wrap-clipboard-2026-10-09/learning_proposal.md`, non applicata.
