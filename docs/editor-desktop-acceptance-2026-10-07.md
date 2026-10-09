# Collaudo Windows dell’editor e del trasferimento a Google Docs

Data: 7 ottobre 2026. Consolidamento dei tre documenti rappresentativi dopo
il gruppo 47 del [piano di parità](editor-google-docs-parity-plan.md).
La selezione parziale MIX-13 resta aperta e non è stata estesa in questo giro.

## Esito e ambiente

Verificati modifica, undo/redo, autosave, riavvio dell’app e recupero dei tre
documenti nella WebView2 reale. Copia da tastiera e «Copia formattata» producono
gli stessi contenuti semantici negli appunti Windows. I tre documenti Docs
isolati si salvano, si riaprono e consentono digitazione con annullamento.
È stato riprodotto e corretto un difetto: dopo un incolla interno HTML, il
titolo predefinito diventava nero anche nel tema scuro.

Ambiente Windows, Python 3.11.8, WebView2 154.0.4258.53. Avvio dal vero
entrypoint `el_sbobinator.webview_entry.main`, con `webui/dist` di produzione
e bridge Python reale; sessioni e configurazione isolate in `_smoke`.
Nessuna sbobina dell’utente utilizzata, nessuna trascrizione Gemini richiesta.
L’adattatore di prova sostituisce il percorso delle sessioni e la lettura
della chiave con un valore sintetico; non sostituisce editor, salvataggio,
appunti o renderer. Un osservatore di sola lettura registra stato e geometria.

Build finale `966fed359bed959b56f65223`; SHA-256 di `dist/index.html`:
`289c8db92f88683a9dac9311cffc90363ddb0a4e293be750536121ab56e8afcc`.
L’app è stata chiusa prima della ricostruzione e riavviata dopo la build.
Questo è un collaudo dell’app avviata dal sorgente, non di un installer.

## Documenti e proprietà verificate

| Campione | App Windows | Docs dopo salvataggio e riapertura |
| --- | --- | --- |
| Testo e formattazione | Titoli, colore esplicito, grassetto/corsivo, evidenziazione, link, Shift+Enter, interlinea e margini; digitazione finale con undo/redo e recupero dopo riavvio | Trasporto nativo; testo e stili di carattere/paragrafo confrontati; digitazione e undo ripristinano il contenuto |
| Liste e tabelle | Lista D/b/E con livello figlio, tabella 3×2 con ultima cella unita; modifica di «12 joule» in «12 joule verificati», undo/redo e recupero dopo riavvio | Numerazione, gerarchia e celle native; merge e colonne 157,5/292,5 pt; testo/stili e digitazione/undo conservati |
| Immagini, formule e HTML | Documento misto con immagine JPEG inline, frazione e matrice; due vuoti distinti Georgia 18 grassetto e Courier New 10 corsivo; digitazione/cronologia/riavvio e incolla interno completo | Matrice forza HTML per tutta la copia; immagine, topologia della tabella e due vuoti conservati; formule appiattite e arrotondamenti geometrici descritti sotto |

[Testo](https://docs.google.com/document/d/15Ls9CzVryjCYfT2VoXLCfu5gxeHe58FWJlir7W7zFRg/edit),
[liste e tabelle](https://docs.google.com/document/d/1emn6iyEskMAXJaJ6f6J5s11yjJf30Dg8vTbLMCOHgZQ/edit),
[documento misto HTML](https://docs.google.com/document/d/13mH5P_2qmohJxKB-UdYZQiKVt4lYP7H0eCpQA_zrmPM/edit).

Nel documento misto Docs conserva i due vuoti come paragrafi normali senza
marker/rientri, con i due font, dimensioni, grassetto/corsivo, margini 8 pt
prima e 10 pt dopo. Interlinee API 140,814% e 158,94%, adattate alle metriche
dei font come nel gruppo 47. La prova non estende la selezione parziale.

## Correzione dei titoli nel tema scuro

Prima della correzione, `formatPortableHtml` attribuiva nero al titolo
predefinito per l’esportazione; l’incolla interno lo interpretava come colore
scelto dall’autore. Il titolo diventava illeggibile sullo sfondo scuro.
Il nuovo attributo di trasporto identifica soltanto il colore predefinito
generato; il parser interno lo rimuove quando valore e contenitore portabile
coincidono. Nero e blu espliciti restano colori dell’autore. Il marker non
diventa contenuto persistito. Il colore portabile e quello nativo per Docs
restano invariati.

Test DOM sui sei livelli, colori espliciti, preparazione ripetuta e marker
discordante. Regressione Chromium con copia/incolla, autosave e riapertura:
fallisce prima della correzione e passa dopo. Confermata nella WebView2
finale: titolo leggibile dopo incolla, undo/redo e riapertura, geometria dei
blocchi e dimensioni dell’immagine identiche prima e dopo la riapertura.

Il confronto del documento persistito normalizza esclusivamente marche
`textStyle` vuote e il token `nofollow` del link, che il parser normalizza;
URL, target, marche effettive, contenuto e stili restano confrontati.

## Metodo, verifiche e limiti

Gli appunti sono stati letti dall’OS con CF_HTML, testo UTF-16 e MIME custom
Chromium. Testo e tabella espongono il payload Docs nativo; il misto soltanto
HTML/testo. Questi payload sono stati trasferiti senza riscriverne i contenuti
negli appunti del browser integrato, poi incollati con Ctrl+V in Docs.
«Saved to Drive», reload, ricopie con identificatori distinti e API attestano
il contenuto salvato. La build finale mantiene il payload nativo dei primi
due campioni; anche il payload HTML corretto è stato reinviato, salvato,
riaperto e confrontato. Tutti i documenti hanno una prova di digitazione e
undo dopo riapertura. I confronti verificano proprietà semantiche, non il
solo screenshot né l’intero JSON Docs con valori predefiniti materializzati.

Il ripiego HTML non è equivalente al trasporto nativo: la frazione e la
matrice arrivano come testo, senza struttura di equazione. La seconda colonna
del campione HTML misura 291,75 pt invece di 292,5 pt, scarto −0,75 pt;
l’immagine in Docs misura 167×111 pt, contro 166,5×111 pt attesi dal profilo
portabile. Sono limiti riprodotti, non risultati accettati come esatti.
Layout generale delle didascalie, wrap e altre geometrie restano fuori dalla
certificazione di questo campione inline.

La prima prova dal sorgente copre separatamente produzione degli appunti OS
e consumo del payload nel browser integrato. Le estensioni sotto aggiungono
PyInstaller e Ctrl+V diretto nel browser esterno. Restano aperti installer,
WKWebView/macOS, taglio e selezioni più ampie, gesti immagine, uso prolungato
con riproduzione audio attiva e trasferimento inverso. DESKTOP-01 è parziale.
Paginazione e numeri di pagina restano rinviati.

Verifiche passate:

- 99 test DOM mirati su formattazione, interlinea e appunti.
- Due casi Chromium: regressione dei colori e due vuoti con stili distinti.
- Build Vite di produzione.
- `python scripts/build_release.py check --with-coverage --skip-npm-install`:
  lint, formattazione, backend, lint/typecheck frontend e 1.352 test in 96 file;
  copertura backend 88,28%, frontend linee 85,74%, branch 76,36%, funzioni 80,02%.
- Comparatore del collaudo e `git diff --check`.

Evidenze locali in `_smoke/desktop-acceptance-2026-10-07/`: `probe.py`,
`clipboard.py`, snapshot app, payload OS/Docs, letture API, `check.mjs`,
`results.json`, log dei test/build/gate e screenshot. La directory è ignorata
da Git; questo resoconto e i test di regressione sono nel checkout.
Le modifiche preesistenti sono state preservate. Nessun commit, push o release.

Prossimo passo desktop dopo le estensioni sotto: collaudare i tre campioni
con l’installer Windows, quindi macOS.
La selezione parziale MIX-13 può riprendere quando richiesta o quando serve
a riprodurre un difetto; non è una nuova microvariante automaticamente avviata.

## Estensione: eseguibile Windows PyInstaller

Il 7 ottobre è stato costruito e avviato anche il vero eseguibile PyInstaller
onedir, usando il comando del processo di release con sole directory di
output isolate. Launcher, moduli Python e risorse sono quelli del prodotto;
nessun adattatore o osservatore è inserito nel pacchetto. Configurazione,
profilo WebView2 e tre sessioni sintetiche sono isolati mediante l’ambiente
del processo figlio. La chiave sintetica non avvia trascrizioni.

SHA-256 dell’eseguibile:
`3636b8c02aacc7fa49bd2364eeefe2095f10993163c671cc5afa0210dcea175d`.
L’index impacchettato è identico byte per byte al dist descritto sopra.
La diagnostica registra `edgechromium`, bridge pronto e avvio riuscito al
primo tentativo, anche dopo chiusura e riavvio. La versione diagnostica 1.0.0
è allineata al frontend corrente: una prima preparazione della prova aveva
usato erroneamente 2.7.2 e attivato il recupero per versioni discordanti;
corretta la preparazione e ricostruito il pacchetto prima del collaudo.
Questa versione non costituisce un nuovo tag o una release.

Azioni eseguite nella UI nativa WebView2 e verificate nei file/appunti OS:

- Testo: aggiunta di «Verifica pacchetto Windows.», annulla/ripeti, autosave,
  riavvio dell’eseguibile, riapertura e ricopia.
- Tabella: modifica della cella in «12 joule verificati», annulla/ripeti,
  autosave, riavvio, riapertura e ricopia; lista D/b/E e cella unita conservate.
- Misto: aggiunta di «Verifica pacchetto misto.», annulla/ripeti, copia di
  tutto il documento, incolla interno dagli appunti Windows, annulla/ripeti
  dell’incolla, salvataggio, riavvio, riapertura e ricopia. Fonte JPEG e
  larghezza 222 px, due sorgenti LaTeX, topologia della tabella, numerazione
  e due vuoti Georgia 18 grassetto / Courier New 10 corsivo conservati.
  Titolo predefinito leggibile nel tema scuro; colore blu esplicito conservato.

Per testo e tabella Ctrl+C e «Copia formattata» producono gli stessi payload;
la ricopia dopo riavvio mantiene identici testo e MIME Docs nativi. L’HTML
ricopiato differisce soltanto per la normalizzazione `nofollow` del link.
Per il misto resta il percorso HTML/testo; tastiera e pulsante coincidono
dopo normalizzazione dei fine riga e del contenitore html/head/body.
Il file persistito dopo il riavvio coincide esattamente con quello salvato
prima della chiusura. Undo e redo dell’incolla ripristinano esattamente i
rispettivi HTML prima/dopo; occorre rifocalizzare l’editor dopo il pulsante
di copia per indirizzare Ctrl+Z al documento.

Il confronto non certifica l’identità geometrica prima/dopo l’incolla:
l’HTML portabile materializza gli stili predefiniti e i margini dei titoli.
Le marche dei vuoti sono persistite come `data-editor-empty-marks`; i
contenitori `data-editor-empty-paragraph` compaiono soltanto nella ricopia
di trasporto e non nel documento salvato. Non sono state estese le prove
di digitazione dentro i vuoti o di selezione parziale di MIX-13.

Il comparatore `check.py` passa 46 confronti mirati sulle evidenze, inclusi
hash del pacchetto, cronologia, HTML persistito e ricopie. Evidenze in
`_smoke/packaged-acceptance-2026-10-07/`: script di preparazione/avvio,
log PyInstaller, diagnostica, snapshot di accessibilità, HTML salvati,
payload OS e `results.json`. Directory ignorata da Git.

Questo chiude la porzione PyInstaller del collaudo dei tre campioni.
L’installer Setup non è compilato/eseguito: Inno Setup non è disponibile.
Nessuna modifica al codice prodotto in questa estensione, nessun nuovo
gate completo eseguito: i risultati del gate sopra appartengono alla prova
dal sorgente. Modifiche preesistenti preservate; nessun commit, push o release.

## Estensione: appunti Windows direttamente in Brave e Google Docs

Completato il 7 ottobre il percorso eseguibile PyInstaller → «Copia
formattata» → appunti OS → Ctrl+V in Docs nel browser Brave esterno, per
tutti e tre i campioni. Nessuna reiniezione o riscrittura del payload fra
copia nell’app e incolla in Brave. Le letture OS sono di sola lettura;
le API Docs verificano il documento e non ne scrivono il contenuto.
Il misto copiato è quello persistito dopo l’incolla interno e il riavvio
descritti sopra, con stili portabili materializzati.

| Campione diretto | Risultato dopo salvataggio, reload e ricopia OS |
| --- | --- |
| [Testo](https://docs.google.com/document/d/10I1ld8YMs8fPQZQiVTHbMwcx7JvPaJpyZhsHYc05MYA/edit) | Testo e stili campionati identici alla sorgente nativa: titoli, Georgia 18 blu, grassetto/corsivo, evidenziazione, Shift+Enter, interlinea e margini. API prima/dopo reload identiche. |
| [Liste e tabella](https://docs.google.com/document/d/1EnFBSly2FNzdbE6FGAL3CPq6S3clTGOgUbwWWPn4bIw/edit) | Lista D/b/E, «12 joule verificati», tabella 3×2, merge finale e colonne 157,5/292,5 pt conservati. Testo e stili campionati identici alla sorgente; API e ricopie prima/dopo reload concordano. |
| [Misto HTML](https://docs.google.com/document/d/1bzRhavvefoPmPi290704wtArDuepcbYdF1NoNKzDM2I/edit) | Due vuoti Georgia 18 grassetto / Courier New 10 corsivo con margini 8/10 pt e interlinee 140,814%/158,94%; tabella unita e immagine inline 167×111 pt conservate. API e stili delle ricopie prima/dopo reload concordano. Formule e geometria mantengono i limiti del fallback HTML. |

Ogni documento ha una prova di digitazione finale con Ctrl+Z. Atteso
«Saved to Drive» prima del reload; eseguita poi una ricopia reale da Docs
negli appunti Windows. Tabella e misto hanno ricopie sia prima sia dopo
reload, con identificatori distinti; per il testo è conservata la ricopia
dopo reload e il confronto API prima/dopo. Durante una pausa del misto un
input esterno ha sostituito la selezione: Ctrl+Z ha ripristinato il contenuto
e il confronto API lo conferma identico al campione prima dell’intervento.
Questo passaggio è registrato separatamente dalla prova di reload.

Il comparatore `check_direct.py` passa: 3.101 confronti di stili sul testo
e 5.051 sulla tabella, controlli delle proprietà del misto e identità
semantica dell’API salvata prima/dopo per tutti e tre. Sono confronti sulle
evidenze, non nuovi test della suite di prodotto. Le evidenze `direct-*`,
snapshot di accessibilità, appunti OS, letture API e `direct-results.json`
sono nella stessa directory `_smoke/packaged-acceptance-2026-10-07/` ignorata.

Restano incompatibilità misurate: equazioni HTML appiattite, seconda colonna
del misto −0,75 pt, larghezza dell’immagine +0,5 pt. La didascalia e l’immagine
occupano paragrafi distinti in Docs; non è certificata l’identità geometrica
con l’app né il wrap. Non si estende la prova alle selezioni parziali MIX-13.
La porzione diretta dei tre campioni è completata; installer, macOS e gli
altri gesti desktop elencati sopra restano aperti. DESKTOP-01 rimane parziale.
Nessuna nuova modifica al prodotto, nessun commit, push o release.

## Estensione SAVE-02: chiusura Windows e salvataggi falliti

Ripresa il 7 ottobre dalla chat `01a11630-cf17-7031-a074-38f8148dd743`,
seguendo il primo blocco proposto per la soglia di affidabilità quotidiana.
Tre sessioni sintetiche copiate in `_smoke/editor-safety-2026-10-07/` con
configurazione e profilo separati; nessuna sbobina reale dell'utente modificata.
La prova riguarda il documento testuale. Gli altri due HTML restano identici
byte per byte ai rispettivi baseline.

Difetto riprodotto nel pacchetto precedente: un handle di sola lettura sul
file HTML consente lettura/scrittura ma nega la sostituzione atomica. Il vero
autosave fallisce, compare «Errore salvataggio» e il token `SAFETY-LOCK-01`
rimane soltanto nell'editor. Alt+F4 chiude comunque finestra e processo;
il token manca dal file. Non è un arresto simulato del bridge o del renderer.

Correzione in `build_close_handler`: la chiusura nativa viene sospesa mentre
un worker richiede il flush dell'editor attraverso il bridge asincrono. La
finestra viene distrutta soltanto su esito booleano positivo. Errori,
eccezioni o mancata risposta mantengono aperta la finestra; le richieste
sovrapposte non avviano più flush concorrenti. Il worker evita di attendere
JavaScript sul thread nativo della UI. Rimane la conferma dell'elaborazione
in corso; anche la chiusura già confermata attraversa il flush.

Il flush frontend consente una nuova richiesta dopo un errore, aggiorna
correttamente lo stato salvato e rifiuta di autorizzare la chiusura se il
bridge è assente o se durante l'attesa cambia documento/generazione.
Una risposta vecchia non aggiorna il contenuto persistito del nuovo
documento. Il comando esplicito «Chiudi senza salvare» dell'editor resta
coperto dalla regressione esistente.

Nuovo PyInstaller onedir dal comando di release, con frontend Vite isolato.
Il dist ordinario e il precedente eseguibile di collaudo non sono sostituiti.
Build `0de9e54563bb6ebdbfdb282e`, versione diagnostica/frontend 1.0.0;
WebView2 154.0.4258.53, bridge reale e nessun adattatore nel pacchetto.
SHA-256 eseguibile:
`c18398e8021ecc4d8df7ef71c983a04a0f66c68171b0b232f088eedb5f69ed2b`.
SHA-256 index sorgente e impacchettato, identici:
`a86625616be49a0137fd1676f7de38be40d200d29bd635d32dc7fe15f655cfd8`.

Prova nella UI Windows del nuovo pacchetto:

1. Stesso blocco del file, digitazione di `SAFETY-LOCK-02`: errore visibile,
   token assente dal file e presente nell'editor.
2. Alt+F4 avvia un nuovo salvataggio e lascia aperta la finestra dopo il
   fallimento. Il testo rimane disponibile e compare di nuovo l'errore.
3. Rilasciato l'handle, un nuovo Alt+F4 salva il token e chiude la finestra.
4. Riavvio del pacchetto e riapertura dalla UI: token presente.
5. Arresto forzato del solo processo isolato, dopo quel salvataggio
   confermato; nuovo avvio e apertura dalla UI: stesso testo e file identico
   byte per byte alla versione acquisita prima dell'arresto.
6. Chiusura finale ordinaria del pacchetto di prova.

Passati 15 test backend di entrypoint e 20 frontend mirati sul primo stato
del fix. Gate completo passato: lint/format, pytest con coverage 88,28%,
pyright, ESLint, TypeScript e 1.355 test frontend / 96 file; linee 85,75%,
branch 76,42%, funzioni 80,02%. Dopo il gate aggiunta una regressione sul
cambio documento durante un flush: file autosave finale 10/10 passato,
typecheck e diff-check passati. Nessun cambiamento ulteriore al runtime.
Il comparatore delle evidenze passa 11 controlli; sono confronti delle prove
conservate, non test aggiuntivi della suite di prodotto.

Evidenze: script `prepare.py`, `hold_file.py`, `build_package.py`, `check.py`,
snapshot di accessibilità prima/dopo la chiusura, HTML prima dell'arresto e
finale, hash, log del pacchetto/gate e `results.json` nella directory ignorata
`_smoke/editor-safety-2026-10-07/`.

SAVE-02 chiude questo difetto di perdita su Windows. Il primo blocco di
affidabilità resta parziale: chiusura entro i 700 ms di debounce e cambi
rapidi con salvataggi ritardati richiedono ancora tempi e stato osservati
nel desktop reale. Il test di arresto certifica l'ultima versione già
salvata, non recupero del lavoro mai salvato o interruzione a metà scrittura.
Restano taglio/selezioni/undo, sbobine preesistenti, sessione lunga con audio,
installer e WKWebView/macOS. Nessun nuovo trasferimento Docs in questo giro.
Modifiche preesistenti preservate; nessun commit, push o release.

## Estensione SAVE-03: eccezioni autosave obsolete e cambio documento

Ripresa il 7 ottobre dalla chat `01a116e0-97a6-7a91-966f-bcb12bd28c6f`.
Il nuovo corpus usa copie delle tre sessioni SAVE-02 in
`_smoke/editor-save-latency-2026-10-07/`, con configurazione/profilo isolati.
Nessuna sbobina dell'utente modificata. Liste/tabella e misto coincidono
byte per byte con i rispettivi baseline al termine.

Difetto: il catch dell'autosave a timer impostava lo stato di errore anche
quando una richiesta più recente aveva già salvato o era cambiato documento.
Due regressioni riproducono Errore anziché Salvato/Idle prima del fix.
La correzione aggiunge al catch il controllo di path e generazione già
presente nel ramo delle risposte riuscite; il testo persistito non cambia.
Questo caso riproduce un falso indicatore, non una nuova perdita di testo.

Prova Windows con il vero entrypoint dal sorgente e frontend Vite: WebView2
154.0.4258.62, bridge Python reale e profilo separato. L'osservatore di prova
trattiene una risposta dopo la vera scrittura e la rilascia come eccezione
sintetica. Non modifica il contenuto dell'editor o i risultati della scrittura.
Le azioni sul documento e sulla finestra usano la UI Windows. Il ritardo è
indotto: non è una misura di latenza spontanea o della scrittura bloccata.
L'osservatore è nel launcher di prova e non nel prodotto/pacchetto.

Sequenze conservate:

- Frontend precedente: prima modifica salvata ma risposta trattenuta;
  seconda modifica salvata; dopo 19.320,6 ms dalla prima scrittura,
  eccezione vecchia → Errore salvataggio, pur con dirty nullo e testo su disco.
- Frontend corretto: stessa sequenza, risposta trattenuta per 15.687,4 ms;
  dopo l'eccezione vecchia rimane Autosave e dirty nullo, con entrambe le
  modifiche nel documento e sul disco. I round trip del secondo salvataggio
  misurati nel renderer sono rispettivamente 5,8 e 4,0 ms, escluso debounce.
- Cambio documento: modifica A e risposta trattenuta; Escape avvia un flush
  con generazione più recente e torna all'archivio. Aperto B, l'eccezione di A
  arriva 28.523,3 ms dopo la sua richiesta; B conserva testo e stato prima/dopo,
  senza token di A. Riaperto A dalla UI, tutte le modifiche sono presenti.

Gate completo finale passato: backend coverage 88,28%; frontend 1.358 test
su 96 file, linee 85,75%, branch 76,43%, funzioni 80,02%. Passano le 12
regressioni autosave, il build Vite isolato e diff-check. Il comparatore
`check.py` verifica ordine delle risposte/generazioni, stato dirty, indicatore,
persistenza dei token e identità dei due documenti non modificati.
Evidenze: launcher `source.py`, `observe.js`, snapshot/cronologie in
`evidence/`, `results.json` e `full-check.log` nella directory ignorata.
SHA-256 dell'index del nuovo frontend:
`8fb1ae36ceb2d5d707edf08c6019e830fa4932973a2dcb1343d025bb0bcb3709`.

Il nuovo caso chiude SAVE-03 nel corpus automatico e WebView2 dal sorgente.
Non estende il precedente collaudo PyInstaller alla nuova correzione.
Restano chiusura entro i 700 ms, nuovo pacchetto/installer, WKWebView/macOS,
taglio/selezioni/undo, sbobine preesistenti e sessione lunga con audio.
Non certifica risposte ritardate per tutti i tipi di documento o errori OS
durante scritture parziali. Sessione isolata chiusa; nessun commit, push o release.

## Estensione SAVE-04 e SAVE-03 nel pacchetto: chiusura prima del debounce

Ripresa l'8 ottobre dalla chat `01a1179e-f770-78f3-903a-903094d9568e`.
Corpus in `_smoke/editor-close-debounce-2026-10-08/`, copiato dai baseline
SAVE-02; configurazione, profilo e tre sessioni sintetiche separati.
Il dist ordinario, le sbobine reali e le modifiche preesistenti non sono
sostituiti. Nessuna nuova correzione al prodotto in questo giro.

Nuovo frontend Vite isolato e PyInstaller onedir dal checkout attuale,
incluso il fix SAVE-03. Build `c044d75fb782996197b237b7`, versione di prova
1.0.0, WebView2 154.0.4258.62. Tutti i file del frontend di prova coincidono
byte per byte con quelli inclusi nel pacchetto. SHA-256 index:
`68257eb250462f0a14ab740cde701c47eb43b8768b698cc486d146c72efd4d30`.
SHA-256 eseguibile:
`2f8a85d3cf00161416eb6287737c733622c0d335f164d09bd6cb9df4cd47e588`.

Il pacchetto contiene un runtime hook di collaudo, assente dal prodotto,
che aggiunge l'osservatore e un metodo per conservare gli eventi. La porta
CDP dei primi tentativi non era raggiungibile; quelle build non sono usate
per le misure accettate. L'osservatore registra mutazioni del testo, richieste,
risposte, flush ed eventi nativi di chiusura. I wrapper delegano al bridge e
al flush originali, senza cambiare contenuto o decisioni di chiusura.
Nel caso SAVE-03 possono trattenere una risposta dopo la vera scrittura e
rilasciarla come eccezione sintetica. Questo non simula una scrittura bloccata.
La digitazione, Alt+F4, Escape, apertura e riapertura usano Computer Use nella
UI Windows. I tempi includono l'osservatore; non sono benchmark del prodotto.

Tempi riferiti alla mutazione del documento successiva all'inserimento del
token, con `performance.now()` per il renderer e timestamp OS per gli eventi
nativi. `type_text` di Computer Use inserisce il token con un evento paste;
la misura parte dalla conseguente mutazione del documento, non dalla
battitura carattere per carattere. La lettura UI prima di Alt+F4 resta entro
il debounce.

| Caso | Chiusura nativa dalla modifica | Inizio flush dalla modifica | Esito e riapertura |
| --- | --- | --- | --- |
| `DEBOUNCE-MEASURED-01`, file libero | 143,0 ms | 146,6 ms | Documento dirty; una sola richiesta parte nel flush, prima del timer. Risposta positiva dopo 15,2 ms; la chiusura effettiva segue il flush riuscito. Token presente alla riapertura |
| `DEBOUNCE-LOCKED-01`, sostituzione atomica bloccata | 155,4 ms | 158,4 ms | WinError 5 dopo 93,5 ms; flush false, Errore salvataggio e finestra aperta. Token presente nell'editor e assente dal file. Sblocco → nuovo Alt+F4 → risposta positiva e chiusura; riavvio/riapertura conservano il token |

Il blocco usa un vero handle del file che consente lettura e scrittura ma
nega la sostituzione atomica, come SAVE-02. Il primo inserimento preparatorio
`DEBOUNCE-CLOSE-01` è stato salvato dal timer dopo un errore dell'API di
cattura; la successiva chiusura con `DEBOUNCE-CLOSE-02` conserva il testo,
ma manca la misura dell'input. Entrambi restano nelle evidenze e non sono
conteggiati come misure del caso sotto 700 ms.

SAVE-03 nel medesimo eseguibile:

- Prima modifica A scritta, risposta trattenuta; seconda modifica scritta
  e confermata. Eccezione della prima rilasciata 20.651,6 ms dopo la sua
  scrittura: testo invariato, dirty nullo e indicatore Autosave, senza errore.
- Nuova modifica A e risposta trattenuta. Escape salva con generazione più
  recente e torna all'archivio; apertura B liste/tabella. L'eccezione di A
  viene rilasciata 31.189,8 ms dopo la richiesta vecchia: B conserva testo,
  dirty nullo e indicatore, senza token di A. Riapertura A conserva tutte
  le modifiche. Il cambio passa attraverso il flush, non è un cambio
  cronometrato sotto 700 ms o una scrittura lenta spontanea.

Il comparatore `check.py` passa: ordine degli eventi e generazioni, tempi
sotto 700 ms, mancata chiusura su errore, recupero, riapertura, indicatori
e identità di B prima/dopo. Rimuovendo i soli sette token aggiunti, l'HTML
finale del testo coincide byte per byte con il baseline, inclusa tutta la
formattazione. Liste/tabella e misto coincidono con i baseline senza alcuna
rimozione. Confermate le chiusure delle finestre isolate e la fine del blocco.

Passano i 15 test backend dell'entrypoint e le 12 regressioni autosave.
Gate completo sul checkout attuale: backend coverage 88,27%; 1.358 test
frontend su 96 file, linee 85,77%, branch 76,46%, funzioni 80,04%.
Build Vite, PyInstaller e diff-check passati. Evidenze: `inspection_hook.py`,
`observe.js`, `hold_file.py`, `check.py`, cronologie JSONL, snapshot UI/stato,
HTML, `results.json`, hash e log build/gate nella directory ignorata.

SAVE-04 chiude il caso misurato del documento testuale e SAVE-03 aggiunge
questo livello PyInstaller strumentato alla precedente prova dal sorgente.
Restano altri documenti/tempistiche, interruzioni a metà scrittura, selezioni
ampie/taglio/undo, sbobine preesistenti, sessione lunga con audio, installer
e macOS/WKWebView. La soglia complessiva di affidabilità quotidiana resta
aperta. Nessun nuovo trasferimento Docs; nessun commit, push o release.

## Estensione SAFE-EDIT-01: selezioni estese e sostituzioni con cronologia

Ripresa l'8 ottobre dalla chat `01a11afe-680c-7400-8bf5-50bc65a6a4fb`.
Corpus in `_smoke/editor-destructive-2026-10-08/`, copie dei tre campioni
precedenti con i baseline SAVE-02 e nuovo profilo/configurazione isolati.
Nessuna sbobina reale modificata. Le azioni usano Computer Use nella UI
Windows, con bridge Python e scritture su disco reali. L'osservatore di
collaudo legge DOM, modello ProseMirror, selezione e autosave; non modifica
documenti, cronologia o risultati. Nessun ritardo indotto in questo giro.

Prima della correzione, riusato l'eseguibile SAVE-04
`2f8a85d3cf00161416eb6287737c733622c0d335f164d09bd6cb9df4cd47e588`:

- Ctrl+A → Ctrl+X svuota il misto; Ctrl+Z ripristina tutto, Ctrl+Y ripete
  il taglio e un secondo Ctrl+Z ripristina. HTML e testo presenti negli
  appunti Windows. Autosave, chiusura nativa, riavvio e apertura dalla UI:
  DOM iniziale e DOM riaperto coincidono esattamente.
- Selezione dal primo paragrafo a fine documento, posizioni 63–611,
  comprendente elenchi, tabella a celle unite, immagine, formula inline
  e matrice. Canc elimina la porzione mantenendo i due titoli; undo
  ripristina l'intero modello, redo ripete la cancellazione, undo recupera.
- Stessa selezione sostituita con `DESTRUCTIVE-REPLACE-01`: i due titoli
  restano e il token sostituisce tutti i blocchi selezionati. Undo recupera
  il modello integrale e redo restituisce lo stesso risultato sostitutivo.
  Ripristino finale e salvataggio conservati.
- Sostituisci tutto, `energia` → `potenza`, trova tre occorrenze in titolo,
  paragrafo e cella. Difetto riprodotto: l'occorrenza del paragrafo perde
  il grassetto. Annulla recupera contenuto e stili, senza perdita irreversibile.

Correzione in `EditorFindReplace.tsx`: entrambi i comandi usavano testo
senza marche. Ora ogni sostituzione eredita quelle del primo carattere
trovato. Per un'occorrenza che attraversa marche diverse, tutto il testo
sostitutivo usa i formati del primo carattere; non si tenta una mappatura
carattere per carattere fra stringhe di lunghezza diversa. Link e stili
espliciti sono conservati. Le sostituzioni vuote restano cancellazioni.
Quattro test DOM con editor/schema reali coprono singolo al confine delle
marche, tutto con grassetto/corsivo/link/colore, marche miste e cancellazione
annullabile. Tre erano rossi prima del fix; tutti verdi dopo.

Nuovo frontend Vite isolato e PyInstaller onedir con il fix, build
`68f3a7890cecf3531135051f`, versione di prova 1.0.0. Tutti gli 86 file
frontend coincidono byte per byte con quelli inclusi nel pacchetto.
SHA-256 index:
`709a1aa905006b34411e2f629bc206c48a867904a768eb3b9b5674cbbf270ebc`.
SHA-256 eseguibile:
`b29df0647ee36ac0787464ce5b66e9f5170aea08ef94ad52234d3e6c7d22e750`.
Il dist ordinario e il pacchetto SAVE-04 non sono sostituiti.

Prove nel nuovo pacchetto:

- Sostituisci tutto nel misto modifica soltanto le tre stringhe attese.
  Il confronto integrale del modello conserva marche, attributi, titoli,
  interlinee, liste, tabella, immagine e formule. Annulla della toolbar
  ripristina il modello iniziale; Ripeti della toolbar ripristina il modello
  sostituito. Il focus del pannello non è usato per certificare Ctrl+Z.
- Campioni testo e liste/tabella: Ctrl+A → Ctrl+X → Ctrl+Z → Ctrl+Y →
  Ctrl+Z. Ogni taglio svuota il modello, ogni undo ripristina esattamente
  il modello iniziale, ogni redo ripete il taglio.
- Autosave, chiusura nativa e nuovo processo. Tutti e tre aperti dalla UI:
  testo e liste/tabella conservano il modello iniziale; il misto conserva
  le tre sostituzioni e tutti gli altri valori. Stato dirty nullo nei tre.
  Nessun token distruttivo rimane nei file finali.

Il salvataggio normalizza alcuni span HTML neutri del testo/misto: non si
afferma identità byte per byte con quei baseline. Sono verificati DOM
iniziale/riaperto per il taglio del misto e modello integrale per le altre
prove. L'HTML finale liste/tabella coincide anche byte per byte col baseline.

Passano quattro regressioni nuove e gate completo finale: lint/format,
pytest con coverage 88,25%, pyright, ESLint, TypeScript, 1.362 test frontend
su 97 file; linee 85,77%, branch 76,46%, funzioni 80,04%. Build Vite,
PyInstaller e diff-check passati. Il primo gate si è fermato su un'opzione
non supportata dai tipi Testing Library nel nuovo test, rimossa prima del
gate finale; il runtime non è cambiato dopo il build.

Il comparatore `check.py` passa 35 confronti sulle evidenze, non nuovi test
della suite di prodotto. Evidenze: `prepare.py`, `observe.js`, snapshot
UI/DOM/modello in `evidence/`, appunti del taglio, cronologie JSONL, HTML
finali, hash build, `results.json` e `full-check-final.log`. La prima lettura
del modello non era disponibile nel probe: quei snapshot usano il DOM;
il probe corretto usa la proprietà dell'editor per il modello e la selezione.
Confermate chiusura finale della finestra e fine del processo isolato.

SAFE-EDIT-01 chiude questo corpus di gesti distruttivi. SEARCH-02 resta
parziale: navigazione, focus/selezione corrente, altri stili e sostituzione
singola nel desktop non sono certificati da queste prove. Restano selezioni
di celle/oggetti diverse, appunti falliti nel desktop, altri tempi di
salvataggio, sbobine reali preesistenti, sessione lunga con audio, installer
e macOS/WKWebView. La soglia complessiva di affidabilità quotidiana resta
aperta. Nessun nuovo trasferimento Docs; nessun commit, push o release.

## Estensione SAFE-REAL-01 e SAVE-05: sbobine reali e spazi salvati

Ripresa l'8 ottobre dalla chat `01a11b10-d3fd-78b0-9f79-b2d4e88bf7c5`.
Corpus in `_smoke/editor-real-transcripts-2026-10-08/`: copie isolate dei
quattro documenti reali presenti nell'archivio locale, dei rispettivi metadati
e audio. Gli originali non sono modificati: SHA-256 di HTML, session.json e
audio uguali prima/dopo. Configurazione di collaudo separata e nessun invio
dei documenti a un servizio esterno. Computer Use esegue i gesti nella UI
Windows; bridge Python, WebView2, autosave e chiusura nativa reali. Riutilizzato
inizialmente il pacchetto SAFE-EDIT-01; ricostruito il PyInstaller dopo il fix.
L'osservatore legge DOM/modello/selezione e registra le chiamate di salvataggio;
non imposta contenuto o cronologia. Nessuna risposta ritardata in questo giro.

| Copia reale | Caratteri iniziali nel modello | Contenuto strutturale | Modifica collaudata |
| --- | ---: | --- | --- |
| Immunologia I Lezione 1 | 76.157 | 66 titoli, 476 paragrafi, 237 elementi di elenco, 12 immagini | Token nel paragrafo finale inizialmente vuoto |
| Fisiopatologia generale I - Lezione 1 | 83.282 | 112 titoli, 453 paragrafi, 276 elementi di elenco, un'immagine | Token alla fine del testo |
| Patologia generale I lez. 4 | 106.020 | 80 titoli, 354 paragrafi, 181 elementi di elenco, due tabelle/10 righe/45 celle | Token nel primo gruppo di paragrafi, posizione 764 |
| Patologia Generale I - Lezione 2 | 38.236 | 41 titoli, 202 paragrafi, 115 elementi di elenco, tre immagini | Token all'inizio del titolo |

SAFE-REAL-01 verifica apertura dall'archivio, modifica, Ctrl+Z/Ctrl+Y,
autosave, ritorno all'archivio, Alt+F4, nuovo processo e riapertura dalla UI.
Ogni undo restituisce l'intero modello iniziale; ogni redo restituisce il
modello modificato. Sottraendo il solo token, tutti gli altri valori del
modello sono identici, comprese marche e attributi di immagini/liste/tabelle.
Per il token nel paragrafo vuoto, la sottrazione elimina il nodo di testo
divenuto vuoto: non è una normalizzazione del contenuto restante.

L'importazione conserva il testo e i formati espliciti grassetto/corsivo/
sottolineato/barrato confrontati carattere per carattere senza gli spazi di
impaginazione dell'HTML. Conserva livelli e ordine dei titoli, conteggi di
paragrafi/elenchi/righe/celle, dati e ordine delle 16 immagini. Il confronto
completo alla riapertura usa invece il JSON esatto, inclusi tutti gli spazi.
Non si afferma identità byte per byte dell'HTML sorgente, né si certifica ogni
regola CSS preesistente o una nuova parità con Docs.

SAVE-05 nasce da una perdita riprodotta nel primo documento: l'HTML salvato
conteneva ` VERIFICA-REALE-01.`, ma la riapertura eliminava lo spazio iniziale.
Una regressione DOM conferma anche compressione degli spazi ripetuti,
tabulazioni e spazi finali in paragrafi e titoli. Correzione: i blocchi che
contengono quegli spazi dichiarano `white-space: pre-wrap` nella serializzazione
e il parser dedicato li conserva; i blocchi ordinari usano le regole precedenti.

La prima correzione era verde in jsdom ma ancora rossa in Chromium/WebView2:
CSSOM espone il shorthand come `white-space-collapse` e `text-wrap-mode`,
scartati dal filtro della preview. La normalizzazione ora legge `pre-wrap`
esplicitamente prima di filtrare, con guardia per elementi MathML senza style.
Regressione DOM su setContent e nuova istanza; regressione Playwright sul
percorso reale della preview salva → chiudi editor → riapri. Entrambe rosse
prima della rispettiva correzione e verdi dopo. Nel pacchetto, spazio inserito
con un vero evento tastiera, undo/redo, salvataggio, chiusura e nuovo processo:
il modello riaperto coincide esattamente col modello modificato, spazio incluso.
Il fix conserva le nuove scritture; non recupera spazi già persi e sovrascritti.

Due inserimenti con type_text hanno incollato il link della chat presente negli
appunti anziché il token richiesto. Le prove sono conservate, annullate e
ripetute con il token verificato. Non attribuita una causa al prodotto; nessun
link estraneo resta nei file finali. Il caso dello spazio usa press_key, così
la verifica finale non dipende dal contenuto degli appunti.

Build finale isolata, versione di prova 1.0.0:

- Eseguibile SHA-256 `c97ac3a0df1506a5f64cd86cb42d7f2d6c5343ff79d1fefa6d4704dde7701b1e`.
- Index frontend/pacchetto SHA-256 `8acaa295bf1e0896b106c52975393e12eb1fd17ee2b37902270d97275e5993d9`.
- Tutti i file del frontend incluso coincidono con il dist isolato.
- Gate completo finale: backend coverage 88,25%, lint/format/pyright,
  ESLint/TypeScript, 1.363 test frontend su 97 file, linee 85,76%,
  branch 76,46%, funzioni 80,04%. Vite, PyInstaller e diff-check passano.
- `check.py` passa 113 confronti sulle evidenze, non 113 test aggiunti al
  prodotto. Tutte le riaperture finali hanno dirty nullo e lo stesso modello
  modificato; snapshot successivi all'ultimo riavvio e route frontend identica.

Terminata la verifica, Alt+F4 chiude anche l'ultima sessione di prova; assenza
del processo finale confermata e registrata in `evidence/final-closure.json`.

Evidenze: manifest/hash originali, prepare.py, observe.js, check.py, modelli/UI
in evidence/, HTML iniziali/finali, JSONL, results.json, hash/log build e gate,
log della regressione Chromium rossa/verde e lettura CSSOM. Sono conservati
anche gli esiti della prima build incompleta del fix e del gate MathML rosso.

SAFE-REAL-01 chiude questo corpus di apertura/modifica di sbobine reali.
Audio collegato e durata visibili nei quattro documenti; nessuna sessione
prolungata con riproduzione audio collaudata qui. Restano la sessione di
30–60 minuti con audio, installer Windows, altri salvataggi/selezioni e macOS.
La soglia complessiva quotidiana resta aperta. Nessun nuovo trasferimento
Docs; nessun commit, push o release.

## Estensione SAFE-LONG-01: sessione prolungata con audio in Windows

Ripresa l'8 ottobre dalla chat `01a11b21-78ae-78e3-ac45-80bdc855635c`.
Nuovo corpus isolato `_smoke/editor-long-audio-2026-10-08/`: copia dagli
originali di Immunologia I Lezione 1, HTML, metadati e MP3 da 2 h 31 min 56 s.
Modello iniziale da 76.157 caratteri, con titoli, elenchi e 12 immagini.
Profilo/configurazione/sessione separati; nessun invio del documento a servizi
esterni. Gli originali mantengono gli stessi SHA-256 prima e dopo.

Riutilizzato esattamente l'eseguibile finale SAFE-REAL-01 con WebView2 reale,
SHA-256 `c97ac3a0df1506a5f64cd86cb42d7f2d6c5343ff79d1fefa6d4704dde7701b1e`.
Nessuna nuova modifica al codice di prodotto o ricostruzione del pacchetto.
Il runtime hook già incluso legge lo script osservatore dalla directory di
prova: il nuovo script registra modelli, eventi del player, tasti, richieste
e risposte delle scritture, flush e errori. Delega salvataggio e flush alle
funzioni originali; non imposta contenuto, selezione o cronologia e non
ritarda risposte. Campiona l'audio ogni circa cinque secondi; l'osservatore
rimane una strumentazione di collaudo e aggiunge un proprio carico.
Computer Use esegue apertura, modifica, controlli audio e chiusura nella UI.

Sessione dal primo `playing` delle **17:38:22,671** allo snapshot finale
delle **18:10:05,839**, ora italiana dell'8 ottobre: **31 min 43,168 s**.
Il comparatore somma soltanto intervalli con entrambi i campioni in
riproduzione: almeno **30 min 11,691 s** su 358 campioni attivi. La pausa
richiesta nella UI dura 89,701 s; i confini fra campioni rendono la somma
attiva una misura conservativa. La durata non è ricavata dall'avanzamento
del file audio, che cambia con velocità e seek.

Prove e risultati:

- Sei inserimenti distinti `VERIFICA-AUDIO-01`–`06` distribuiti nella sessione.
  I primi quattro sono aggiunti al paragrafo conclusivo esistente; gli
  ultimi due al paragrafo finale inizialmente vuoto, con spazio iniziale.
  Modello finale da 76.271 caratteri. Tolti i soli token e il nodo di testo
  che diventa vuoto, il JSON completo coincide con il modello iniziale:
  nessuna altra modifica a testo, marche o attributi di titoli/liste/immagini.
- Due cicli Ctrl+Z/Ctrl+Y, all'inizio e dopo circa venti minuti. Ogni undo
  restituisce esattamente il modello precedente, ogni redo quello modificato.
- Ctrl+Home, Pagina giù e Ctrl+End raggiungono inizio, elenchi e fine del
  documento; la digitazione successiva funziona nella posizione osservata.
- Player a 1× e 1,25×, indietro/avanti di dieci secondi, pausa e ripresa.
  Nei 353 intervalli senza cambi di stato/seek il tempo audio avanza entro
  un secondo dal valore atteso per la velocità. Due `waiting` coincidono
  coi seek e sono seguiti da `playing` nello stesso timestamp in millisecondi;
  i campioni successivi avanzano. Nessun evento `stalled` o errore media,
  nessun errore JavaScript/unhandled rejection osservato.
- Volume del player a zero durante la riproduzione attiva: verificati
  caricamento, avanzamento e controlli, senza prova acustica dell'uscita.
- Un inserimento tramite `type_text` dopo Ctrl+B arriva come testo normale.
  La lettera `x` immessa con `press_key` eredita invece la marca bold;
  il suo undo recupera esattamente il modello delle sei modifiche.
  Non attribuita una causa al prodotto per la differenza dell'automazione.
  Grassetto finale applicato con Ctrl+B alla selezione verificata dei soli
  token 05/06: marca bold e spazio iniziale presenti nel JSON salvato.
- Tredici risposte di scrittura, tutte `ok: true, saved: true`; nessun
  campione con errore salvataggio. Stato finale dirty nullo.
- Alt+F4 mentre l'audio è ancora attivo: flush `true`, evento `native-closed`
  e fine del processo. Stesso eseguibile avviato in un nuovo processo,
  apertura dalla UI dell'archivio e modello riaperto **esattamente identico**
  al finale, inclusi grassetto e spazio iniziale. Audio caricato senza errore.
- Il nuovo processo presenta player in pausa a 0:00, 1× e volume 1.
  Questa prova non dimostra persistenza di posizione/velocità/volume fra
  processi; i valori sono stati reimpostati alla riapertura.
- Chiusa anche la sessione riaperta. Assenza di entrambi i PID e dei
  processi WebView2 con percorso del profilo isolato verificata.

Campioni RSS del pacchetto e dei discendenti: circa **665–875 MB**. Sono
osservazioni di questa sessione strumentata, non una soglia di prestazioni
o una prova generale di assenza di leak. Non si certificano tutti i carichi,
durate, macchine, documenti o percorsi di focus con questa singola prova.

`check.py` passa **41 controlli sulle evidenze**; non sono nuovi test della
suite di prodotto. Riconfermati anche i 113 confronti SAFE-REAL-01 e il
diff-check. Il gate completo della build riutilizzata resta quello già
registrato in SAFE-REAL-01; non è stato rieseguito per i soli script di
collaudo e gli aggiornamenti documentali di questo giro.

Evidenze: `prepare.py`, `observe.js`, `status.py`, `check.py`, `finalize.py`,
manifest/hash originali, due launch JSON, modelli/UI nei checkpoint,
`long-audio-events.jsonl`, `resources.jsonl`, HTML sorgente/finale,
`final-closure.json` e `results.json`. Gli esiti parziali del comparatore
sono conservati soltanto nell'ultimo `partial-results.json`; la verifica
finale distingue i `waiting` brevi dovuti ai seek dagli errori/stalli.

SAFE-LONG-01 chiude la sessione descritta su questo documento Windows.
La soglia quotidiana complessiva resta aperta per installer/aggiornamento,
altri salvataggi e selezioni non descritti, carichi diversi e macOS/WKWebView.
Inno Setup (`ISCC.exe`) risulta ancora assente l'8 ottobre nel PATH e nelle
due installazioni standard cercate da `scripts/build_release.py`:
nessun installer è generato o installato in questo giro. Nessun nuovo
trasferimento Docs; nessun commit, push o release.

## Estensione SAFE-SETUP-01 e SAVE-06: Setup Windows e chiusura forzata

Data: 8 ottobre 2026. Evidenze sotto
`_smoke/editor-installer-2026-10-08/`. Ripresa della chat SAFE-LONG-01 dal
blocco installazione/aggiornamento, preservando tutte le modifiche preesistenti.

### Ambiente e isolamento

- Scaricato Inno Setup 6.7.3 dal collegamento GitHub del sito ufficiale.
  Firma Authenticode valida, editore Pyrsys B.V.; SHA-256
  `9c73c3bae7ed48d44112a0f48e66742c00090bdb5bef71d9d3c056c66e97b732`.
  Installato in modalità portatile sotto `tools/inno`, senza registrazione
  globale del compilatore e senza modifica permanente del PATH.
- Rilevata l'installazione reale per utente v2.7.3. Il test usa un altro
  GUID AppId, nome, directory predefinita e collegamenti, incluso il GUID
  della migrazione HKLM; `evidence/isolation.diff` e `isolation-fixed.diff`
  riportano esattamente le differenze. Le altre sezioni operative rimangono
  identiche allo script di prodotto. Registrazione reale, eseguibile,
  uninstaller e collegamenti campionati rimangono invariati.
- Compilato anche lo script originale prima e dopo il fix, con il nuovo
  payload. Questi due Setup non sono installati con l'identità reale.
- Installazioni silenziose `/CURRENTUSER /VERYSILENT /SUPPRESSMSGBOXES /SP-
  /NORESTART`, directory `installed` sotto la prova. Le versioni Setup
  `0.0.1`, `0.0.2`, `0.0.3` sono artificiali; i payload strumentati per
  osservazione mantengono la versione interna `1.0.0`. Non sono artefatti
  di release né un aggiornamento pubblicato della v2.7.3.
- Payload precedente SAFE-EDIT-01: eseguibile
  `b29df0647ee36ac0787464ce5b66e9f5170aea08ef94ad52234d3e6c7d22e750`.
  Payload nuovo SAFE-REAL-01/SAFE-LONG-01:
  `c97ac3a0df1506a5f64cd86cb42d7f2d6c5343ff79d1fefa6d4704dde7701b1e`.
  Riutilizzati i pacchetti, senza ricostruire il codice desktop per il fix
  che riguarda esclusivamente lo script Inno Setup.
- Nuova copia isolata di Immunologia dalla prova lunga, con 12 immagini e
  audio. APPDATA, LOCALAPPDATA, USERPROFILE e session_root separati. Il
  vecchio payload precede SAVE-05: il confronto dell'aggiornamento parte
  dal suo modello effettivamente salvato, senza attribuirgli il recupero
  di spazi già normalizzati. Originali reali e file della prova precedente
  mantengono gli hash.

### Installazione e aggiornamento ordinari

1. Setup precedente installato: 982 file del payload coincidono byte per
   byte con i file installati. Apertura dall'archivio, token
   `VERIFICA-SETUP-PRIMA.`, autosave, Ctrl+Z e Ctrl+Y: modelli interi esatti.
2. Chiusura normale, Setup nuovo e avvio dall'eseguibile installato:
   996 file del payload coincidono; l'HTML è identico prima/dopo Setup e
   il modello riaperto coincide con quello salvato dalla build precedente.
3. Token `VERIFICA-SETUP-DOPO.`, undo/redo, autosave e riproduzione audio
   a volume zero passano; avanzamento superiore a dieci secondi, nessun
   errore media/JavaScript osservato. Non è una nuova prova acustica o lunga.
4. Ripetizione del Setup con app aperta e documento già salvato: Restart
   Manager termina l'app e il modello salvato persiste alla riapertura.
   Il log registra però chiusura forzata e fine finestra prima del risultato
   del flush: questo rende necessario il caso SAVE-06.

### SAVE-06: perdita riprodotta e correzione

Bloccata realmente la sostituzione atomica dell'HTML con un handle Windows
che permette lettura/scrittura ma non condivisione delete. Il token
`VERIFICA-SETUP-NON-SALVATO.` è presente nel modello dell'editor, assente
dal file, stato dirty vero e `Errore salvataggio` visibile. Il Setup con
`CloseApplications=force` chiude comunque app/WebView2 e completa
l'installazione; dopo riavvio il modello è esattamente quello precedente
alla modifica non salvata. Il token è perso nella sola copia di prova.

La documentazione Inno Setup conferma che `force` può perdere lavoro non
salvato: [CloseApplications](https://jrsoftware.org/ishelp/topic_setup_closeapplications.htm).
Modifica applicativa minima in `packaging/windows/installer.iss`:
`CloseApplications=yes`, con commento sul veto di chiusura dell'editor.

Una variante isolata equivalente allo script corretto salvo il commento
ripete il medesimo blocco di scrittura con `VERIFICA-SETUP-GRACEFUL.`:
Setup termina con codice 5, log `Some applications could not be shut down`
e abort prima della sostituzione dei file; app ancora aperta, versione
installata ancora `0.0.2` e modello intero con token identico prima/dopo.
Non vengono simulati esito di salvataggio o comportamento del renderer.

Sblocco e Alt+F4 normale: richiesta reale salva, `flush-end: true` e fine
finestra. Setup corretto ricompilato dai sorgenti finali, aggiornamento a
`0.0.3`, 996 file coincidenti e hash di tutti i dati/config identici nel
confronto immediatamente prima/dopo. Avvio e apertura conservano esattamente
il modello recuperato, con stato salvato. Il comparatore controlla che la
variante del caso bloccato abbia lo stesso codice eseguibile dello script
finale, ignorando soltanto commenti e terminazioni di riga.

### Disinstallazione, reinstallazione e verifiche finali

- Chiusura normale e disinstallazione: registro, programma e collegamenti
  di prova rimossi; HTML, audio, session.json e config.json identici nel
  confronto prima/dopo. L'uninstaller elimina la propria directory con
  pulizia differita; l'osservatore ora attende fino a dieci secondi il
  completamento, senza confondere il ritardo con un residuo permanente.
- Reinstallazione dello stesso Setup corretto: 996 file coincidenti, dati
  e configurazione conservati; apertura dall'archivio restituisce esattamente
  il modello recuperato, incluse marche e attributi di liste/immagini.
- Chiusura finale e seconda disinstallazione completate; nessun processo
  app/WebView2 di prova, nessuna registrazione, directory installata o
  collegamento di prova residuo. Dati/config di prova conservati.
- `python _smoke/editor-installer-2026-10-08/check.py`: 64 controlli delle
  evidenze passano, inclusa la riproduzione della perdita iniziale e il
  confronto con il comportamento corretto. È un verificatore delle prove
  registrate, non una nuova regressione pytest/Vitest che avvia da sola Setup.
- Gate completo `python scripts/build_release.py check --with-coverage
  --skip-npm-install` passato: Ruff/formattazione, backend con coverage
  88,29%, Pyright zero errori, lint/typecheck WebUI, 97 file Vitest e 1.363
  test passati; coverage frontend linee 85,76%, branch 76,46%, funzioni 80,04%.

Evidenze: script di preparazione, lock, checkpoint, stati e comparatore;
`builds.json`/`builds-fixed.json`, script originali/isolati e diff;
log/hash/firma del compilatore; log/risultati Setup, manifest e checkpoint
JSON/HTML, eventi di salvataggio/audio/chiusura, stato finale e `results.json`.

SAFE-SETUP-01 chiude il ciclo per utente isolato e silenzioso descritto;
SAVE-06 corregge la perdita da chiusura forzata in quel percorso. Restano
updater online completo, wizard interattivo/avvio automatico `[Run]`,
migrazione da installazione HKLM, identità/installazione reale v2.7.3,
pacchetto di release senza strumentazione, altri carichi/tempi e macOS.
Il prossimo collaudo Windows è il percorso updater completo su istanza
isolata, compreso errore di salvataggio e ritorno al lavoro senza perdita.
Nessuna nuova prova Docs. Nessun commit, push, tag o release pubblicata.

## Decisione di perimetro: accettazione operativa Windows

8 ottobre 2026: l'utente indica che macOS può essere ignorato per questo lavoro.
Il collaudo operativo attivo e i relativi requisiti di chiusura sono quindi
limitati a Windows. macOS non blocca questa accettazione; le precedenti
indicazioni di macOS aperto restano come limiti storici delle evidenze.
La somiglianza del comportamento dell'editor non viene usata per dichiarare
verificati appunti, persistenza, chiusura o aggiornamento nativi macOS.
Il prossimo caso attivo rimane l'updater Windows completo su istanza isolata.

## Estensione SAFE-UPDATE-01: updater, wizard interattivo e recupero Windows

Data: 8 ottobre 2026. Ripresa della chat SAFE-SETUP-01, mantenendo macOS
fuori dal perimetro attivo. Evidenze `_smoke/editor-updater-2026-10-08/`.
Nessun nuovo difetto applicativo riprodotto; il caso usa le protezioni
SAVE-02 e SAVE-06 già presenti nei sorgenti.

### Isolamento e differenze del collaudo

- Nuovo PyInstaller dai sorgenti correnti e build WebUI corrente, installato
  con GUID, nome, collegamenti e directory Setup separati dalla v2.7.3 reale.
  APPDATA, LOCALAPPDATA, USERPROFILE e copie di Immunologia sono isolati.
  La precedente prova Setup e i file originali mantengono gli hash.
- Altra istanza già aperta sulla porta standard 42001: il primo avvio di
  prova mostra correttamente il recupero per conflitto porta ed è chiuso.
  Il pacchetto finale di collaudo usa la porta separata 42003 tramite hook,
  senza chiudere l'altra istanza o modificare la porta di prodotto.
- Un solo script aggiunto all'HTML di prova instrada la ricerca della
  versione verso `/latest` su HTTP loopback; tutti gli asset JavaScript/CSS
  rimangono quelli della build. Il downloader Python instrada soltanto
  l'URL del Setup artificiale v9.9.1 e il relativo `.sha256` allo stesso
  server locale. Download, file temporaneo e verifica SHA-256 sono reali.
- L'hook di avvio Setup aggiunge `/DIR`, `/GROUP` e `/LOG` al lancio
  `/CURRENTUSER` con le stesse creationflags di prodotto. Il launcher di
  collaudo sostituisce quello di prodotto: non verifica il suo `atexit`
  per la pulizia del temporaneo. I due EXE temporanei della fixture sono
  rimossi manualmente dopo confronto SHA-256; `temp-cleanup.json` lo registra.
- Le versioni Setup 9.9.0 e 9.9.1 usano lo stesso nuovo payload strumentato;
  versione interna 1.0.0. Si collauda il meccanismo di aggiornamento e il
  ritorno al lavoro, senza attestare migrazioni tra due release pubbliche.
  Hook e observer registrano UI/modelli/eventi, senza sostituire salvataggi,
  esiti del flush, comportamento del renderer o Restart Manager.

### Casi eseguiti

1. Dalle impostazioni, `Aggiorna ora` scarica il Setup con checksum
   intenzionalmente errato. Errore di integrità visibile, app aperta,
   versione installata 9.9.0, dati/config invariati e nessun Setup avviato.
   Il pulsante permette di riprovare; ripristinato il checksum corretto.
2. Nuova ricerca e download rallentato sul server locale, ritorno
   all'archivio e apertura dell'editor durante il download. La sostituzione
   atomica dell'HTML è bloccata con un handle Windows. Aggiunto il token
   `VERIFICA-UPDATER-BLOCCATO.`: errore reale, dirty vero, token nel modello
   e assente dal file. La chiusura dell'updater dopo l'avvio del Setup
   viene rifiutata dal flush; app e intero modello restano aperti.
3. Nel wizard interattivo, `Install` e chiusura automatica delle app:
   Restart Manager rispetta il veto. Setup segnala di non poter chiudere
   tutte le applicazioni. Scelto `Cancel installation`, senza ignorare
   l'errore: uscita 5, versione 9.9.0 e modello intero identico; token
   ancora assente dal file e recuperabile nell'editor. Lo stato updater
   riporta correttamente che l'installer è stato avviato; non rileva il
   successivo annullamento nel wizard come esito dell'installazione.
4. Sblocco e Alt+F4 normale: scrittura riuscita, `flush-end: true` e chiusura.
   Riapertura manuale e modello intero identico al checkpoint bloccato,
   incluso il token recuperato. Poi nuovo tentativo dalle impostazioni:
   download e SHA-256 validi, chiusura ordinaria dell'app, wizard interattivo,
   installazione riuscita e avvio automatico `[Run]` dell'eseguibile installato.
   Registro 9.9.1, 982 file del payload identici byte per byte, dati/config
   invariati attraverso il Setup e modello riaperto ancora esatto.
5. Nella build riavviata dal Setup, token `VERIFICA-UPDATER-DOPO.`, Ctrl+Z
   e Ctrl+Y: modello modificato, baseline e redo esatti, con autosave reale.
   Ultima chiusura/riapertura manuale conserva esattamente il modello finale.

### Verifica e pulizia

- `python _smoke/editor-updater-2026-10-08/check.py`: 68 controlli delle
  evidenze passano. Comparano modelli completi, HTML, versioni, hash dei
  dati/config, payload e isolamento; non sono test che avviano da soli il
  desktop o il Setup. Risultato in `results.json`.
- Gate completo `python scripts/build_release.py check --with-coverage
  --skip-npm-install` passato: Ruff/formato, coverage backend 88,29%,
  Pyright zero errori, lint/typecheck WebUI, 97 file e 1.385 test Vitest.
  Coverage frontend linee 85,77%, branch 76,53%, funzioni 80,07%.
- Disinstallazione di prova completata, registro/directory rimossi, nessun
  processo app/WebView2 della prova residuo. Server locale fermato; lock
  rilasciato. Copie dei dati e prove conservate. Installazione reale,
  registro/file campionati, sbobina/audio originali e corpus precedente
  invariati nei confronti registrati.

SAFE-UPDATE-01 chiude questi casi con endpoint controllati e aggiunge il
wizard interattivo e `[Run]` al precedente collaudo silenzioso. Rimangono
distribuzione GitHub reale e relativi errori di rete, UAC/migrazione HKLM,
identità/installazione reale, pacchetto di release senza strumentazione,
pulizia automatica del temporaneo, altri documenti e tempi non descritti.
Questi confini Windows sostituiscono il precedente prossimo caso updater;
macOS resta escluso. Nessuna nuova prova Docs. Solo aggiornamenti documentali
e artefatti di collaudo in questo turno; nessun commit, push, tag o release.
