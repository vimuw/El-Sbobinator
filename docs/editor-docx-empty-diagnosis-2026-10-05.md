# DOCX vuoto dopo editor → Google Docs — causa confermata

## Stato

Segnalazione riesaminata il 5 ottobre 2026: l'utente riferiva che il problema
persisteva e si presentava in modo intermittente anche nelle versioni precedenti.
Dopo il confronto dei file, del codice e del nuovo export, ha confermato:
«ok no era perchè non aspettavo il salvataggio».
Il caso segnalato è quindi spiegato dal download anticipato rispetto al
completamento del salvataggio di Docs. Non richiede una modifica al codice
dell'editor; nessuna correzione al codice è stata applicata per questo caso.

Il gruppo BUG-01 precedente dimostra un caso sintetico di esportazione vuota
durante il salvataggio di Docs. Da solo non dimostrava la tempistica del
download reale; la conferma successiva dell'utente chiarisce questo punto.
La procedura per il caso segnalato è attendere «Salvato in Drive» prima
di scaricare il DOCX.

## Confronto dei file forniti

Sono stati letti gli originali sul Desktop senza modificarli. I conteggi testo
si riferiscono agli elementi `w:t` del file `word/document.xml`.

| File / origine dichiarata | Dimensione | Caratteri | Paragrafi | Disegni / immagini incorporate |
| --- | ---: | ---: | ---: | ---: |
| `IMMUNOLOGIA 1, LEZIONE 1 (FUNZIONA).docx`, 2.7.1 | 394.220 byte | 76.157 | 426 | 12 / 12 |
| `IMMUNOLOGIA 1, LEZIONE 1 (NON FUNZIONA).docx`, 2.7.3 | 6.491 byte | 0 | 1 | 0 / 0 |
| Nuovo export del Google Doc di riferimento salvato | 394.251 byte | 76.157 | 426 | 12 / 12 |

Entrambi gli originali sono ZIP validi. Nel file non funzionante manca già il
contenuto OOXML: non è testo nascosto né un problema della visualizzazione di
Word/Drive. Il suo XML coincide con il download sintetico immediato del gruppo
precedente, ma l'identità di un documento vuoto non prova una causa comune.

## Verifica attuale del riferimento

È stato letto ed esportato nuovamente il Google Doc indicato nella chat
`01a10cce-c403-7153-b138-234ac752d61c`:
[IMMUNOLOGIA 1, LEZIONE 1](https://docs.google.com/document/d/1_-zH8VL7Fnbu-XV-KORsPAV72OenPuzVtWQ_fyQb9EE/edit?tab=t.0).

Il browser mostrava «Saved to Drive». L'export autenticato
`content.exportGsuite('docx')` contiene tutto il testo del DOCX funzionante:
SHA-256 della concatenazione dei `w:t` identico. Anche i dodici file immagine
incorporati coincidono byte per byte, confrontando l'insieme degli hash.
Questa prova recupera il contenuto; non certifica identità completa di tutti
gli stili o della disposizione, né riproduce una nuova copia dalla build 2.7.3.

La successiva verifica del menu File è stata impedita dal dialogo «File is in
the bin». Il riferimento non è stato ripristinato o modificato. Il nuovo export
provato è quindi quello autenticato, non una nuova misura del menu UI.

## Confronto del codice delle release

Nei tag `v2.7.1` e `v2.7.3` sono identici gli oggetti Git dei seguenti file:

- `EditorFullPage.tsx`, `RichTextEditor.tsx`, `EditorContextMenu.tsx`;
- `utils.ts` e `previewHtml.ts`;
- `webui/package.json` e `webui/package-lock.json`;
- `el_sbobinator/utils/html_export.py`.

Questi tag usano HTML/testo per la copia; l'adattatore con i formati nativi
Docs del WIP corrente non è presente in nessuno dei due. Il confronto esclude
una modifica a questi file di copia come differenza fra le due release.
Non esclude un difetto preesistente comune o effetti dell'ambiente/runtime
e non equivale a una prova dei due installer.

## Evidenze e procedura

Artefatti locali, ignorati da Git:
`_smoke/docx-empty-diagnosis-20261005/comparison.json` contiene dimensioni,
conteggi, hash OOXML/testo/immagini e identità degli oggetti Git.
`IMMUNOLOGIA 1, LEZIONE 1 - recuperata.docx` contiene il nuovo export completo.

Per questo caso: incollare, attendere «Salvato in Drive», quindi scaricare
il documento Word. La conferma dell'utente chiude la diagnosi del download
anticipato; non certifica ogni possibile trasferimento o entrambi gli installer.
Un eventuale DOCX ancora vuoto dopo salvataggio e riapertura sarebbe un caso
distinto, da riprodurre conservando clipboard, scheda Docs e file scaricato.

Nessuna modifica al codice, commit, push o release in questa diagnosi.
