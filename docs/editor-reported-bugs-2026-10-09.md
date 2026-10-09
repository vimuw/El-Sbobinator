# Editor: menu contestuale, digitazione Wrap e inserimento LaTeX

## Correzioni

- Il menu contestuale usa le proprie dimensioni effettive per restare a 12 px dai bordi della finestra. La sua altezza massima segue la viewport; nelle finestre basse il contenuto scorre senza chiudere il menu. La selezione non vuota, che aggiunge Elimina selezione, non richiede dimensioni presunte.
- Il plugin Wrap mantiene le decorazioni quando gli intervalli modificati della transazione si trovano dopo tutti i blocchi coinvolti nel layout. Invalida il risultato per modifiche precedenti o interne, nuovi Wrap successivi e cambiamenti di attributi, marcature, font, immagini o larghezza. Il clone contiene soltanto il prefisso necessario, con un blocco successivo di margine e liste/tabelle complete; le posizioni degli ostacoli vengono riutilizzate fra le scritture DOM. Gli spazi rimangono decorazioni della vista e non entrano nel documento salvato.
- Toolbar, menu contestuale e Ctrl+M aprono lo stesso dialogo React LaTeX, senza prompt nativo né inserimento automatico di E=mc^2. Il campo parte vuoto e offre anteprima KaTeX e Inserisci/Annulla. La conferma inserisce nella selezione originale; una modifica concorrente del documento o la distruzione dell'editor chiude il dialogo. Le formule esistenti mantengono il loro editor.

## Regressioni automatizzate

`EditorMathDialog.dom.test.tsx` copre i tre ingressi, selezione e conferma, input invalido, annullamento, undo/redo, invalidazione del dialogo e focus da tastiera. `imageWrap.dom.test.ts` verifica la conservazione delle decorazioni e l'invalidazione dagli intervalli effettivi delle transazioni, indipendentemente dal cursore.

`editor_three_bugs.spec.ts` verifica in Chromium il menu nelle viewport da 720 e 400 px con e senza selezione, la raggiungibilità dell'ultima voce, i tre ingressi LaTeX con annullamento/storia/salvataggio/riapertura e la digitazione Wrap vicino e dopo la figura su un documento con 200 paragrafi.

Sono passati anche i casi esistenti per Wrap misti con didascalie, proprietà della cella di una tabella dopo trascinamento, Wrap arbitrario e offset positivi/negativi, con le rispettive verifiche di storia, persistenza e clipboard.

## Risultati del 9 ottobre 2026

- Controllo completo `python scripts/build_release.py check --skip-npm-install --with-coverage`: passato. 99 file di test frontend, 1.416 test; copertura righe frontend 86,71%, Python 88,31%.
- Tre nuovi casi Chromium: passati. Quattro casi Chromium esistenti pertinenti: passati.
- Build frontend, TypeScript, ESLint e `git diff --check`: passati.
- Desktop Windows avviato dai sorgenti con frontend di produzione, WebView2 e bridge Python reale, su profilo isolato con documento sintetico e stato delle credenziali simulato: passato. Menu entro la finestra, inserimento LaTeX dai tre comandi, undo/redo e uguaglianza esatta del modello dopo salvataggio e riapertura.
- Nello stesso host desktop, 11 inserimenti di caratteri dopo l'area della figura non producono alcun clone. Dieci modifiche vicino alla figura producono dieci misure su cinque blocchi; il resto dei 200 paragrafi viene escluso. Anche il modello Wrap riaperto coincide esattamente con quello salvato.

Le azioni native del profilo di prova sono state pilotate attraverso `evaluate_js`; la digitazione e i click reali automatizzati sono coperti separatamente in Chromium. Questa verifica non costituisce una prova di un nuovo pacchetto PyInstaller o installer Setup. Nessun commit, push o release eseguito.

Evidenze locali ignorate da Git: `_smoke/editor-three-bugs-2026-10-09/`, inclusi `native-fixed-report.json`, `native-fixed.log` e `full-check.log`.
