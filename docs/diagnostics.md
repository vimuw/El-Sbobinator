# Diagnostica e log locali

In **Impostazioni → Diagnostica**, **Esporta diagnostica** salva uno ZIP tramite
la finestra di salvataggio del sistema. **Copia report diagnostico** copia gli
stessi dati in formato testo. È possibile selezionare la sbobina interessata:
verranno aggiunti il suo log recente e un riepilogo tecnico dei progressi.
**Apri cartella log** apre la cartella di configurazione.

Il report si genera localmente, senza contattare Gemini. Include versione/build,
sistema operativo, versioni delle dipendenze, spazio libero, stato dell'avvio,
errori recenti e risultato dell'ultima verifica esplicita, se disponibile.
**Verifica ora** resta un'azione separata e può verificare la chiave con Gemini.

Il file `el_sbobinator.log` viene creato automaticamente all'avvio, anche senza
attivare il debug. Raggiunto 1 MiB, ruota mantenendo fino a tre copie precedenti.
Il debug facoltativo scrive nello stesso file; i vecchi `app.log` non vengono
eliminati o importati. Le chiavi API riconosciute vengono oscurate.

`startup_diagnostic.json` conserva separatamente l'ultimo controllo di avvio:
data e ora con fuso orario, piattaforma, interprete Python, renderer selezionato,
versione WebView2 rilevata ed eventuali errori del caricatore o del renderer.
Lo stato passa a `ui_ready` quando React viene montato. `startup_failure.json`
conserva separatamente l'ultimo avvio che ha richiesto il recupero WebView2,
anche dopo un avvio riuscito. Questi stati sopravvivono alla rotazione del log.
Su macOS il requisito WebView2 è indicato come non necessario.

Se su Windows appare la schermata di recupero WebView2, il percorso del log è
mostrato nella stessa schermata. I controlli periodici del monitor non producono
righe ripetitive; viene registrata la richiesta di riavvio dopo il rilevamento.

Gli errori Python non gestiti, dei thread, del bridge e del frontend vengono
conservati in `incidents.json` (fino a 20 eventi, entro un limite di dimensione). `last_failure.json` mantiene
l'ultimo errore anche se seguono avvisi o avvii riusciti. Gli identificativi
`boot_id` e `operation_id`/`run_id` collegano avvio, eventi e sbobina. L'interfaccia
limita e deduplica le segnalazioni; una coda conserva gli errori prima che il
bridge sia pronto. I mancati caricamenti di script/stili sono rilevati da uno
script separato. Se un invio al bridge fallisce, viene ritentato fino a tre
volte a un secondo di distanza, mantenendo l'ordine della coda. Esauriti i
ritentativi, gli eventi restano in coda per un successivo tentativo di invio.
Se anche questo script o il bridge non funzionano, non è
possibile registrare l'errore JavaScript. La pagina di errore React consente
anch'essa di esportare la diagnostica quando il bridge è disponibile.

I dettagli di elaborazione delle singole sbobine restano nei rispettivi
`run.log`, esclusi dal log generale quando associati a una sessione. I file
diagnostici sono locali e non vengono inviati automaticamente. Lo ZIP esclude
audio, trascrizioni e configurazione completa. Usa campi selezionati di
`session.json`; oscura le chiavi riconosciute, il percorso home/configurazione
e, se selezionata, il percorso della sbobina e il nome del suo media. I log
possono comunque contenere altri nomi o percorsi negli errori: controllare
`report.md` prima di condividerlo. Eventuali errori di scrittura dei log non
bloccano l'avvio.

Per una segnalazione utile chiedere allo studente: cosa stava facendo, ora
approssimativa del problema, cosa si aspettava e cosa è successo, screenshot
se utile, ZIP esportato selezionando la sbobina coinvolta. Se l'app non si apre,
chiedere i file della cartella log indicata nel recupero WebView2. La nuova
raccolta sarà disponibile agli studenti dopo l'installazione della release
che contiene queste modifiche; non ricostruisce errori precedenti non registrati.
