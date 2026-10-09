# Formule direttamente nella pagina — 9 ottobre 2026

L'inserimento LaTeX dalla toolbar, dal menu contestuale e da Ctrl+M apre ora un campo nel punto della selezione, senza finestra modale. La selezione originale viene sostituita soltanto alla conferma. Il campo e l'anteprima sono decorazioni temporanee: non entrano nel documento, nella clipboard o nell'autosalvataggio.

Le formule inline e a blocco condividono lo stesso editor compatto: sorgente con una singola sottolineatura, anteprima KaTeX nella pagina e piccole icone di conferma/annullamento. Invio conferma e riporta il cursore al documento, Esc annulla. Uscire dal campo conferma una sorgente valida; una sorgente vuota o invalida viene annullata. Invio su una sorgente invalida mantiene il campo aperto per correggerla. La conferma costituisce un evento di cronologia distinto dalla digitazione successiva.

Il formato salvato resta `mathInline`/`mathBlock` con attributo `latex`, e HTML `data-math`/`data-math-block`. Le formule restano modificabili dopo la riapertura. Non cambia il supporto della clipboard per le formule native o per il fallback HTML.

## Verifica

- `python scripts/build_release.py check --with-coverage --skip-npm-install`: passato. 99 file frontend, 1.423 test; copertura righe frontend 86,23%, Python 88,31%. TypeScript, Pyright e lint passati.
- `npm run build`: passato.
- `EditorMathComposer.dom.test.tsx`: otto casi passati per i tre ingressi, selezione, annullamento, sintassi invalida, draft obsoleto, conferma alla perdita di focus e modifica inline/a blocco con cronologia.
- Chromium: inserimento dai tre ingressi; modifica inline/a blocco; conferma e annullamento; posizione del cursore e digitazione dopo la formula; sostituzione della selezione; undo/redo; autosalvataggio e uguaglianza del modello dopo riapertura.
- Il caso esistente `editor_html_equations.spec.ts` passa con i nuovi controlli: clipboard nativa e fallback, reincolla, modifica di formula e matrice, cronologia, salvataggio e riapertura.
- Verifica visiva delle schermate inline e a blocco; la riga dei controlli resta entro 32 px.

Schermate locali ignorate da Git: `_smoke/editor-math-inline-2026-10-09/formula-inline.png` e `formula-block.png`.

Queste nuove evidenze sono di Chromium con backend browser reale e test DOM. Non è stata ripetuta la verifica WebView2 desktop né creato un nuovo pacchetto PyInstaller/Setup. Nessun commit, push o release.
