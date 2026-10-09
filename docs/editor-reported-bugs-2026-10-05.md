# Correzioni delle sette segnalazioni dell'editor — 5 ottobre 2026

## Integrazione locale

**Aggiornamento successivo alla consegna:** la spaziatura automatica di 15,18 pt
descritta nelle prove del gruppo 35 è stata rimossa dopo la segnalazione
«Troppo spazio con Invio». Il profilo corrente ha spazio prima/dopo zero:
un Invio crea il paragrafo seguente, due lasciano una normale riga vuota.
La richiesta chiarita applica invece una riga di separazione ai confini
dei paragrafi e degli elenchi delle nuove sbobine generate. Questa spaziatura
iniziale si conserva sui blocchi originali senza essere ereditata con Invio.
Le prove del gruppo 35 sotto restano storiche; il gruppo 36 della matrice
registra la regressione, il confronto Docs e i controlli aggiornati.

`main` è stato portato con fast-forward da `3ef7319` a `0ab9437`, includendo
l'intero `feature/archive-editor-wip`, archivio compreso. Prima dell'operazione
le modifiche locali e i file nuovi sono stati confrontati con il WIP mediante
un indice temporaneo: coincidevano. Rimane lo stash di sicurezza
`safety: identical WIP before main integration 2026-10-05`.
Le correzioni successive sono nel working tree di `main`, senza nuovi commit,
push o release. Editor continuo e numeri di pagina rinviati.

## Modifiche e regressioni

| Segnalazione | Implementazione | Prova disponibile |
| --- | --- | --- |
| Immagine copiata perde qualità | `text/html` conserva il sorgente; il bitmap ricampionato è solo nel formato nativo Docs. Nessuna ricompressione al montaggio. | PNG 1600×1000 trasparente visualizzato piccolo, due copie, ingrandimento, undo/redo, salvataggio/riapertura: stesso sorgente e risoluzione. Test di menu/taglio e nativo separato. |
| Resize superiore sposta la figura | `tc` mantiene bordo superiore e X; la misura inline compensa l'assestamento della riga al rilascio. Le altre maniglie mantengono le proprie regole. | Gesti Chromium In-line/Wrap a 75%, 100%, 150%, anteprima e rilascio entro 1 px, cronologia/cancellazione nelle regressioni immagini. |
| Wrap bloccato ai margini | Posizione di base più offset X/Y firmati; drag libero, guide entro 6 px attraversabili; soltanto l'intersezione orizzontale riserva spazio. Lo spostamento si annulla con il comando Annulla esistente. | Attraversamento margini/guide e undo/redo dalla toolbar; immagine larga quanto il testo e totalmente fuori, nessuno spazio residuo; parser e resize conservano offset negativi. |
| Titoli non neri/grassetti | Profilo condiviso: tutti i livelli 700 e `#000000`, stili diretti conservati. | Backend/DOM, clipboard, build WebView2 e Docs salvato. Titolo esplicitamente blu nel corpus rimane blu. |
| Paragrafi senza spazio | Distanza predefinita 15,18 pt come proprietà di paragrafo; liste/celle compatte. | DOM 20,24 px a 100%, payload nativo `ps_sa`, API Docs `spaceBelow: 15.18 PT`, stili espliciti 8/10 pt conservati. |
| Secondo Tab porta all'audio | Il gestore delle liste consuma anche il tentativo di annidamento non applicabile; Shift+Tab gestito. Dentro il testo resta il tab letterale. Audio invariato. | Liste puntate/numerate DOM e Chromium con audio, ripetizione e confini. Tre Tab nativi WebView2 sulla prima voce mantengono caret/focus nell'editor. |
| DOCX vuoto | Diagnosi di export Docs prima del salvataggio; nessuna modifica speculativa della serializzazione per questo sintomo. | Confronto dei dodici download e dei dodici documenti reimportati descritto sotto. |

## DOCX: caso riprodotto e procedura funzionante

Il riferimento originale è stato solamente letto. Il DOCX fornito contiene un
solo paragrafo vuoto: 6491 byte, zero testo, immagini, tabelle e formule.
Il Google Doc originale ha invece 76.692 caratteri API e 12 immagini salvate.
Il nuovo export del riferimento riaperto contiene 76.157 caratteri `w:t` e
12 `w:drawing`: i conteggi API includono terminatori che `w:t` non include.

Su documenti sintetici sono stati confrontati pulsante e Ctrl+A/Ctrl+C,
trasferendo i quattro formati prodotti realmente dai gesti dell'app Chromium
al normale incolla nel browser integrato Docs. Per ogni percorso sono stati
scaricati DOCX immediato, dopo «Saved to Drive» e dopo riapertura, poi importati
su Drive e riletti tramite connettore.

| Corpus / percorso | Immediato (`w:t` / disegni / tabelle / formule) | Salvato | Riaperto |
| --- | --- | --- | --- |
| Minimo / pulsante | 63 / 0 / 0 / 0 | 63 / 0 / 0 / 0 | 63 / 0 / 0 / 0 |
| Minimo / tastiera | 63 / 0 / 0 / 0 | 63 / 0 / 0 / 0 | 63 / 0 / 0 / 0 |
| Misto / pulsante | 0 / 0 / 0 / 0 | 500 / 1 / 1 / 1 | 500 / 1 / 1 / 1 |
| Misto / tastiera | 0 / 0 / 0 / 0 | 500 / 1 / 1 / 1 | 500 / 1 / 1 / 1 |

Nei due download misti immediati la UI mostrava ancora «Saving…».
Il `word/document.xml` dei due file vuoti è identico a quello originale:
SHA-256 `5b83073ba7b7ea4d5892390f8749a1c4d57b61549b3008fc8f19e220bd21df11`.
I quattro DOCX misti salvati/riaperti hanno lo stesso XML e 8950 byte;
la rilettura dei quattro import conserva 519 caratteri API, un'immagine,
una tabella e un'equazione. Anche testo iniziale/finale, titoli, marcatori,
cella unita e stili campionati sono presenti nel readback salvato.
I due import immediati restano vuoti, confermando che il contenuto manca già
nel download, prima del caricamento su Drive.

Gli export temporizzati usano l'export autenticato `exportGsuite('docx')` del
browser. Il percorso UI File → Download → Microsoft Word è stato provato
separatamente dopo il salvataggio: stesso XML completo. Quel DOCX è stato
caricato anche senza conversione e aperto in Docs in formato Microsoft Word:
testo, immagine, tabella e formula sono visibili, stato «Saved to Drive».
Non è stata misurata separatamente la tempistica del menu UI durante Saving.

Conclusione: in questo caso Docs esporta la versione iniziale vuota finché il
nuovo contenuto non è salvato. È una causa riprodotta compatibile con il file
originale; non dimostra quando l'utente abbia scaricato quel file. Non è emersa
una perdita del payload per i due corpus dopo salvataggio/riapertura. La prova
non certifica ogni possibile struttura o l'intera sbobina originale ricopiata.

Procedura verificata: incollare, attendere «Saved to Drive», riaprire e
controllare inizio/fine, scaricare Word, caricare il DOCX su Drive e aprirlo.
Il ripiego HTML dell'intero frammento resta per strutture native non supportate,
con i limiti già registrati nel piano generale.

## Ambiente e limiti effettivi

Il frontend di produzione è stato ricostruito e avviato nel vero renderer
Windows WebView2 `154.0.4258.53`, build `ceb1d548d69687874aa9e67a`, con bridge
Python reale e sessione sintetica isolata. È un avvio da sorgente con dist
di produzione, non un nuovo installer/PyInstaller. Nessuna generazione Gemini.

Sono verificati avvio, titolo nero/grassetto, spazio normale 20,24 px,
liste/celle zero, stili espliciti, audio presente e tre Tab sulla prima voce.
Il pulsante produce nel clipboard Windows HTML, testo e i due MIME nativi Docs.
Questi byte sono stati letti dal clipboard OS, trasferiti tramite file al
browser integrato, incollati, salvati e riaperti in un nuovo Docs di test.
La rilettura conserva un'immagine posizionata, una tabella e un'equazione;
il DOCX riaperto contiene 500 caratteri `w:t`, un disegno, una tabella e una
formula OMML (9088 byte). Il corpus desktop differisce soltanto per i gesti
di elenco/disposizione eseguiti nella sessione isolata.
Questo certifica la produzione del payload nativo Windows e il suo import;
non è una prova di incolla diretto fra app desktop e browser esterno.

I drag del helper Windows, anche dopo riattivazione e screenshot aggiornato,
non avviano il gesto nel renderer: dimensioni e offset restano invariati.
Quindi resize/drag/copia interna con resize devono ancora completare
l'accettazione manuale WebView2. Le prove Chromium non sono presentate come
accettazione di quei gesti desktop. WKWebView e installer restano non provati.
Rimangono aperti i limiti generali di formule HTML e geometria Docs delle
didascalie; questo gruppo non dichiara parità generale né migra vecchi documenti.

## Controlli e artefatti

- Regressioni mirate: 230 test DOM/clipboard/geometria/liste.
- Suite Chromium immagini + segnalazioni: 50 casi del primo giro, con le cinque
  aspettative del vecchio profilo corrette e tutti i casi falliti ripassati;
  altre 11 regressioni delle segnalazioni passate.
- Gate `python scripts/build_release.py check --with-coverage --skip-npm-install`
  passato: Python 88,25%; frontend linee 85,61%, rami 76,12%, funzioni 79,78%.
- Build frontend, lint, typecheck e `git diff --check` passati.

Evidenze sintetiche locali in `_smoke/editor-reported-bugs/`: quattro payload,
dodici DOCX temporizzati, `docx-readback.json`, `docs-readback-summary.json`,
readback Tab e startup Windows, clipboard OS e schermate dei DOCX riaperti.
La directory è ignorata da Git; nessun URL firmato è incluso nella documentazione.

Documenti di prova:
[misto tastiera riaperto e reimportato](https://docs.google.com/document/d/1BC13Y21hjJ161NkocqX6gkp1F-8NRsfCQi5cGC0JJRs/edit),
[DOCX senza conversione](https://docs.google.com/document/d/1dmfuXf2WHkOp0Eunk-6xqytFlbL7NkTn/edit),
[payload WebView2](https://docs.google.com/document/d/1ZAB94ZT_iFIXT-MHYa6ETW77lNvkSfHfKFLj8te5dhM/edit).
