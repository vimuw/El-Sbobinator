# Formattazione e portabilità dei documenti

`el_sbobinator/document_formatting.json` è la fonte comune per font e dimensioni
predefiniti, interlinea HTML, spaziatura dei paragrafi, titoli, dimensioni delle
immagini e padding delle celle. Il frontend lo importa in `documentFormatting.ts`;
il backend lo legge per il CSS dei nuovi documenti HTML. La build include il file
anche nei pacchetti Windows e macOS.

L'editor usa variabili CSS ricavate dal profilo. La copia produce un frammento
HTML autonomo con stili inline, mantenendo titoli, elenchi e loro numerazione,
link, tabelle e celle unite. Le dimensioni relative vengono risolte in punti,
tenendo conto dei font ereditati, senza misurare lo zoom o i colori del tema.
Gli stili espliciti del contenuto prevalgono sui valori predefiniti. Il colore
predefinito del documento esportato è nero, indipendentemente dal tema dell'app.

`paragraphSpacing` calcola una sola distanza fra blocchi consecutivi. Le celle
di tabella hanno gruppi indipendenti. HTML e formato nativo di Docs usano gli
stessi risultati. La distanza maggiore rimane sul blocco che la definisce:
se prevale lo spazio prima del titolo, non viene trasferita al paragrafo precedente.
Il profilo corrente non sopprime lo spazio dopo h2/h3/h4.
Preparare più volte lo stesso frammento non accumula contenitori o distanze.

Dal 3 ottobre 2026 il testo normale usa Arial 11, interlinea CSS 1,38 e spazio
prima/dopo 0 pt. Il valore nativo Docs corrispondente nel riferimento osservato
è 1,15. I titoli 1–5 usano peso 400, dimensioni 20/16/14/12/11 pt, colori
nero/nero/`#434343`/`#666666`/`#666666` e spazi prima 20/18/16/14/12 pt e dopo
6/6/4/4/4 pt. Il titolo 6 importato conserva il profilo precedente.
I valori espliciti prevalgono; non si riscrivono i documenti storici in massa.

`EditorDocumentStyle` conserva e serializza gli stili diretti di paragrafi e
titoli e l’eventuale `data-document-line-spacing`. Il selettore della dimensione
mostra punti anche per valori importati in pixel. Colore ed evidenziatura
coesistono senza imporre il nero al testo; i link predefiniti usano `#1155cc`.

Ctrl+C, pulsante e menu contestuale usano la conversione comune anche quando
la selezione contiene solo testo. Gli appunti includono HTML e testo semplice;
per le strutture supportate includono anche il formato nativo di Docs. Gli
elementi temporanei di disposizione e i controlli dell'editor sono esclusi.
Nel testo semplice i paragrafi restano separati e le formule conservano LaTeX.

## Adattamento a Google Docs

`editorClipboard.ts` traduce gli stili risolti nel formato nativo, anziché
ridefinire dimensioni dei titoli e distanze fra paragrafi. L'interlinea CSS è
relativa alla dimensione del font; quella di Docs è relativa alla riga normale
del font. Per il profilo predefinito, il frammento preparato porta il valore
nativo 1,15 nel metadato `data-document-line-spacing`; l’adattatore lo legge
senza reinterpretarlo come rapporto CSS. Per un’interlinea esplicita senza
quel metadato, misura la riga normale del font a grande scala e converte il
rapporto. I test conservano anche il caso storico CSS 1,6 e gli spazi espliciti
13,75 pt: aggiornare i default non li azzera. Le metriche del destinatario
possono comunque differire.

Gli offset dell'editor individuano l'immagine; quelli nativi individuano il
rettangolo esterno dei margini di avvolgimento. L'adattatore sottrae i margini
sinistro e superiore, oltre a convertire pixel in punti. Questo vale per
posizioni laterali e centrali e per offset positivi, nulli e negativi.
Rientri degli elenchi ed equazioni richiedono una traduzione specifica.

Gli elenchi numerati importati conservano i tipi decimale, alfabetico e romano
in entrambe le casse. `EditorOrderedList` esplicita il CSS del marcatore per
evitare che Typography lo trasformi in decimale; la preparazione degli appunti
lo scrive anche sui figli `li`, perché Docs ignora il solo attributo `type`.
Il formato nativo usa i tipi osservati nel destinatario. Il rientro del testo
predefinito è 36 pt per livello nell'editor, nel nuovo HTML backend e nella
copia portabile. Il salvataggio backend conserva `ol[start]` e `ol[type]`.

Nel formato nativo, solo il primo paragrafo di una voce possiede il marcatore.
I successivi sono continuazioni allineate al testo; una sottolista possiede
il proprio stato e la sua numerazione. Il corpus `editor-parity-lists.html`
verifica 21 paragrafi e tre livelli in Docs, anche dopo salvataggio e riapertura,
con i marcatori D–E, ii–iii, c–d e III–IV e due continuazioni senza marcatori.
Queste prove non chiudono il percorso HTML puro: Docs unisce i primi due
paragrafi della stessa voce con un ritorno morbido e trasforma la continuazione
dopo la sottolista in una nuova voce, facendo avanzare il numero successivo.
Rimane anche la differenza di interlinea 1,38/1,15 già descritta sotto.
I nuovi livelli digitati nell'app conservano per ora il marcatore decimale;
il ciclo predefinito decimal/alpha/roman di Docs resta aperto.

Per contenuti non rappresentabili l'adattatore lascia il percorso HTML. La copia
conserva gli stili comuni anche in questo caso, ma non garantisce la resa di ogni
formula o disposizione di immagini nel destinatario. Il formato nativo di Docs
è privato e la correttezza del payload non sostituisce una prova reale di incolla,
salvataggio e ricopia in Google Docs.

Nel corpus con matrice non rappresentabile, Docs interpreta il ripiego HTML
CSS 1,38 come interlinea nativa 1,38, mentre la copia nativa del profilo conserva
1,15. La differenza è riprodotta anche con CSS espresso in punti o pixel.
Questo ripiego richiede ancora un adattamento specifico e non soddisfa il
contratto di fedeltà generale. Cambiare l’HTML autonomo a 1,15 senza distinguere
il destinatario altererebbe la resa negli altri editor.

Le formule vengono serializzate come DOM KaTeX, evitando che il markup
appaia letteralmente nel testo. La copia HTML esclude il layer accessibile
`katex-mathml` che Docs duplicava insieme all’annotazione LaTeX; il documento
salvato conserva quel layer e il sorgente semantico. Nella prova di ripiego
le formule sono comunque ridotte a testo, e la matrice perde la struttura
matematica editabile: eliminare la duplicazione non chiude tale incompatibilità.

## Verifica e limiti

I test verificano titoli, paragrafi, elenchi, font espliciti ed ereditati, unità
relative, colori, allineamento, tabelle, separazione delle celle, conversione
ripetuta e percorsi di ripiego. La prova Playwright sul solo testo confronta
tastiera e pulsante e incolla normalmente in un documento `contenteditable`
separato, senza CSS dell'app. La suite immagini controlla anche drag, resize,
annullamento, appunti nativi e HTML.

La regressione con figura al 56% e offset verticale 18px è stata incollata anche
in Google Docs, salvata su Drive e riletta: interlinea e coordinate native
conservano i valori convertiti e il testo torna a scorrere accanto alla figura
fin dalla prima riga. Il documento sintetico è
[verifica interlinea comune](https://docs.google.com/document/d/1ZfSbjYkH0aizzO1JW_bqzL9wv2mI4454Nsxzf-PnxUA/edit).
Questa prova non copre Word, LibreOffice o il trasferimento dall'app
impacchettata WebView2/WKWebView.
Le prove precedenti in Docs riportate in `editor-images.md` precedono questa
unificazione e non certificano la versione attuale.

Il destinatario può applicare i propri stili o scartare proprietà. Il wrap
centrale sui due lati resta una funzione del motore dell'editor e del formato
nativo: l'HTML portabile usa un float laterale. Le formule complesse conservano
il percorso HTML. Il profilo non promette identità di paginazione o posizione
in qualsiasi editor.

I nuovi file HTML del backend usano il profilo comune. I documenti già salvati
conservano il proprio head e CSS durante l'autosalvataggio, come previsto dal
contratto esistente; la copia formattata applica il profilo corrente. Questa
modifica non migra i file storici. L’incolla formattato conserva ora colori,
evidenziature e dimensioni esplicite dei titoli, usando lo schema dell’editor
per le strutture supportate.

## Avvio del piano di parità — 3 ottobre 2026

La selezione usa una preparazione comune per Ctrl+C, Ctrl+X e copia/taglio dal
menu contestuale. Il taglio elimina il contenuto soltanto dopo il trasferimento
degli appunti; un trasferimento fallito lo conserva. Le operazioni asincrone
del menu non modificano una selezione cambiata durante la lettura/scrittura.
L’incolla dal menu preferisce l’HTML e passa attraverso il normale parser
dell’editor. Quello senza formattazione inserisce testo letterale, conservando
anche caratteri come `<` e `>`.

Il corpus misto di testo, titolo esplicito, evidenziatura, lista numerata,
tabella ed equazione inline è stato copiato dal browser dell’app nel
[documento Docs sintetico](https://docs.google.com/document/d/1nff_qGqdxuHYhaCpRfIya5zW7vTNQcnmmTOj2jN5ey8/edit).
La rilettura prima e dopo riapertura conserva i valori controllati di font,
dimensioni, colori, livello del titolo, interlinea, spaziatura e rientri.
La lista mantiene 4–5; la formula `x^2` è presente nelle strutture native
`equation`/`equation_function`, oltre che nella resa. Questa prova non certifica
la tastiera delle equazioni, le dimensioni delle celle o tutti i casi del piano.
Il secondo gruppo allinea i default del profilo e conserva gli stili diretti:
dieci campioni del corpus esteso coincidono alla fonte, dopo incolla nativo e
dopo riapertura in Docs. Il documento sintetico ora contiene questo corpus;
le evidenze del primo confronto rimangono in `_smoke/editor-parity/`.

“Rimuovi formattazione” usa un comando comune da toolbar, menu contestuale,
bubble e Ctrl+Backslash. Conserva struttura e link, rimuove i mark diretti e
azzera allineamento/stili del blocco quando è selezionato tutto il suo testo;
un solo undo ripristina l’operazione.
Se la selezione è parziale, la tipografia ereditata viene trasferita sul testo
esterno prima di rimuoverla dal blocco, preservandone font, dimensione e colore.
Allineamento, interlinea e margini del blocco parzialmente selezionato rimangono.
Con il solo cursore, il testo esistente mantiene gli stili e quello digitato
dopo il comando usa lo stile predefinito del paragrafo o titolo. I mark per la
digitazione vengono impostati dopo le modifiche del documento, che altrimenti
li azzererebbero. Nelle selezioni su più paragrafi si ripristina il layout dei
soli blocchi interamente selezionati.

Il terzo gruppo confronta in Docs selezione parziale, titolo, cursore seguito
da digitazione, paragrafo intero e selezione su tre paragrafi. DOM e gesti
browser verificano conservazione del layout, tipografia esterna, copia e undo;
la rilettura dei due campioni copiati dall’app conserva gli stili dopo incolla
e riapertura in Docs. Gli appunti prodotti dai gesti Playwright sono trasferiti
al browser integrato per l’incolla reale: questa prova non copre la build desktop.
Le evidenze sintetiche sono `clear-reference-readback.json` e
`clear-transfer-readback.json` in `_smoke/editor-parity/`.

Il quarto gruppo conserva sedici funzioni nominate (`sin`, `cos`, `log` e le
altre registrate nella matrice) come funzioni native, anziché lettere ordinarie.
Il limite inferiore usa la funzione nativa a un argomento `lima`; sommatorie,
integrali e prodotti mantengono gli estremi anche quando KaTeX usa MathML
inline. Il corpus con nove equazioni, titolo, testo evidenziato, lista 4–5 e
tabella conserva 26 comandi matematici e dieci campioni di stile dopo incolla,
salvataggio e riapertura in Docs. L’argomento di `sin x` è stato modificato in
`sin y` da tastiera e ripristinato con due annullamenti, mantenendo la funzione
nativa. Le prove sono in `equations-reference-readback.json` e
`equations-transfer-readback.json`. Matrici, nomi/stili non verificati, editing
atomico nell’app, geometria e trasferimento desktop rimangono aperti.

Le varianti del ripiego HTML non sono state adottate: `line-height:calc(1.38)`
conserva 1,15 soltanto nella destinazione predefinita, ma eredita 2 in un
paragrafo con interlinea doppia. Un wrapper con identificatore sintetico di
provenienza Docs non corregge il rapporto. L’incolla con interlinea nel figlio
mantiene il valore nativo del paragrafo, ma non prova un ripiego generale per
blocchi vuoti, oggetti e stili espliciti. Le incompatibilità di MIX-02 restano.

Ambiente, corpus, differenze e criteri ancora aperti sono nella
[matrice di parità](editor-google-docs-parity-matrix.md).
