# Immagini Wrap multiple: posizione e rallentamento

La segnalazione prosegue la chat `01a121b3-f88d-7b72-8190-b598a913adff`. La correzione precedente evitava il ricalcolo quando si scriveva dopo l'area di una figura; non risolveva le interazioni tra più figure.

## Difetti riprodotti

- Con due immagini al 56%, il rilascio di una figura poteva collocarla circa 81 px lontano dall'anteprima. Gli spazi di esclusione spostavano i paragrafi e quindi anche le altre immagini ancorate a quei paragrafi.
- Il motore misurava nuovamente tutte le immagini a ogni passaggio del calcolo. Nel campione con quattro figure e testo lungo tra le figure: 336 letture della geometria delle superfici per misurazione, con due misurazioni iniziali da circa 133 e 183 ms.
- Nell'affiancamento, spazi separati potevano andare a capo indipendentemente. Inoltre, uno spazio largo esattamente fino al bordo poteva andare a capo da solo nel DOM reale, lasciando parole sotto un'immagine.

## Correzione

`webui/src/imageWrap.ts` ora misura e mantiene stabili gli ingombri delle figure durante il calcolo degli spazi del testo. Compensa poi lo spostamento degli ancoraggi nel DOM reale, senza modificare il contenuto salvato o aggiungere passaggi nella cronologia.

Il testo precedente a un ancoraggio può essere spostato per evitare sovrapposizioni: con le figure stabili, non genera più il ciclo che la vecchia regola cercava di evitare. Questo conserva anche il caso con una tabella tra due figure.

Gli ingombri vicini vengono considerati insieme quando una parola non può entrare tra essi. Al bordo della riga viene lasciato un pixel CSS di margine. Le porzioni di testo che non toccano le figure vengono saltate prima della misurazione delle singole parole; si riutilizzano i nodi e i Range necessari.

Il trascinamento mantiene l'anteprima separata dal documento e non avvia misurazioni del Wrap durante il movimento del puntatore. La scrittura oltre l'area coinvolta conserva il layout già calcolato.

## Verifiche

- **Chromium:** 17 casi pertinenti passati: 16 nella sequenza finale e un caso aggiuntivo con due figure al 35% affiancate completamente nella pagina. I nuovi casi verificano due e quattro figure, posizione rispetto all'anteprima entro 2 px, spostamento accanto/sotto/sopra, assenza di parole sovrapposte alle immagini, nessun ricalcolo durante il gesto, scrittura vicina e lontana, undo/redo, autosave e uguaglianza del modello e della posizione nel documento dopo riapertura. Passate anche le regressioni su tabelle, formule, didascalie, elenchi, zoom, ridimensionamento e clipboard.
- **Confronto prestazioni sul campione con quattro figure:** le letture delle superfici scendono da 336 a 12 per misurazione. Nella prova finale eseguita separatamente dal controllo completo, le due misurazioni iniziali impiegano circa 15 e 18 ms. Le 25 misurazioni complessive registrate nella prova sono tra circa 14 e 37 ms. I tempi sono misure di questo corpus e di questa macchina, non una garanzia per ogni documento.
- **Desktop Windows dai sorgenti:** frontend di produzione ricompilato, WebView2 e bridge Python reale, profilo isolato. Due e quattro figure mantengono le coordinate al rilascio, la cronologia e il modello esatto dopo salvataggio e riapertura. Massimo registrato nel campione desktop: 6 letture con due figure, 12 con quattro. Azioni pilotate tramite `evaluate_js`, eventi PointerEvent sintetici e transazioni; il percorso con input del browser è verificato separatamente in Chromium.
- **Controllo completo:** `python scripts/build_release.py check --with-coverage --skip-npm-install` passato. 1.416 test frontend, copertura delle righe frontend 86,59%, Python 88,31%. ESLint, TypeScript, build e `git diff --check` passati.

## Evidenze e stato del repository

Le evidenze si trovano in `_smoke/wrap-multiple-2026-10-09/`: `before-trace.zip`, `baseline-results/`, `final-results/`, `inside-page-results/`, `isolated-performance-results/`, `native-report.json`, `verified-final-check.log` e `wrap-fix.patch`.

Il confronto degli hash prima/dopo conferma che l'unico file preesistente modificato da questa correzione è `webui/src/imageWrap.ts`. Aggiunti il test `webui/e2e/editor_multiple_wrap.spec.ts` e questo resoconto. Preservate le altre modifiche della chat precedente.

Frontend ricompilato. Nessun nuovo exe/installer, commit, push o release. Un eseguibile già confezionato deve essere ricostruito per includere la correzione.
