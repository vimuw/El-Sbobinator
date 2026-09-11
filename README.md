# El Sbobinator

Applicazione desktop per trasformare registrazioni audio e video di lezioni universitarie in dispense di studio strutturate e formattate tramite i modelli Google Gemini.

<p align="center">
  <a href="https://github.com/vimuw/El-Sbobinator/releases/latest"><img src="https://img.shields.io/github/v/release/vimuw/El-Sbobinator?style=flat-square&color=blue" alt="Release" /></a>
  <a href="https://github.com/vimuw/El-Sbobinator/actions/workflows/build.yml"><img src="https://img.shields.io/github/actions/workflow/status/vimuw/El-Sbobinator/build.yml?branch=main&style=flat-square&label=CI" alt="CI" /></a>
  <a href="https://codecov.io/gh/vimuw/El-Sbobinator"><img src="https://codecov.io/gh/vimuw/El-Sbobinator/graph/badge.svg" alt="codecov" /></a>
  <a href="https://github.com/vimuw/El-Sbobinator/releases"><img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS-informational?style=flat-square" alt="Platform" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="License: MIT" /></a>
</p>

<p align="center">
  <img width="48%" alt="Interfaccia Principale" src="https://github.com/user-attachments/assets/cec7f84f-3a3f-4cd5-9d7c-938abbd32159" />
  <img width="48%" alt="Editor Integrato" src="https://github.com/user-attachments/assets/569c83b0-5244-4227-826e-95fc68991c80" />
</p>

---

## Panoramica

**El Sbobinator** è un'applicazione desktop pensata per studenti universitari: trasforma le registrazioni delle lezioni (audio o video, inclusi i memo vocali dello smartphone o le registrazioni da Teams/Meet) in **dispense di studio complete, ordinate e formattate**.

L'app pulisce il discorso parlato eliminando ripetizioni, intercalari e digressioni, e struttura gli argomenti con capitoli, paragrafi ed elenchi puntati preservando l'accuratezza del linguaggio tecnico e medico.

> [!NOTE]
> **Elaborazione 100% Locale e Privata**: Nessun server intermediario raccoglie i tuoi dati. I file audio e il testo rimangono sul tuo computer e comunicano unicamente con i modelli ufficiali di Google Gemini tramite la tua chiave personale gratuita.

---

## Caratteristiche Principali

- 📚 **Dispense Pronte per lo Studio**: Trascrive e riorganizza automaticamente il parlato in un testo coerente, fluido e pronto per preparare gli esami.
- 🔑 **Completamente Gratuito (Google Gemini)**: Funziona con la tua chiave personale gratuita di Google AI Studio — senza abbonamenti, carte di credito o costi nascosti. Include la rotazione automatica di più chiavi se si raggiungono i limiti giornalieri.
- ✍️ **Editor di Testo Integrato**: Rileggi e correggi la lezione all'interno dell'app con indice laterale navigabile, formule matematiche/chimiche, immagini e funzione Trova/Sostituisci.
- 🎧 **Player Audio Sincronizzato**: Riascolta i passaggi della lezione mentre revisioni il testo, con regolazione della velocità (1.0x–3.0x) e memorizzazione automatica del minuto in cui ti eri fermato.
- 🔍 **Archivio con Ricerca Istantanea**: Ritrova in un istante qualsiasi parola o concetto spiegato a lezione cercando all'interno di tutte le sbobine salvate.
- 📋 **Esportazione e Condivisione con un Clic**: Copia il testo con formattazione preservata direttamente in Google Docs o Microsoft Word, oppure esporta in file HTML o pacchetti condivisibili `.sbobina`.
- 🔒 **Massima Privacy e Sicurezza**: La tua chiave API è conservata nel portachiavi protetto del sistema operativo (Windows DPAPI / macOS Keychain) e non viene mai condivisa con terzi.

---

## Download e Installazione

Scarica la versione più recente dalla pagina [**Releases**](https://github.com/vimuw/El-Sbobinator/releases/latest):

| Piattaforma | File da scaricare | Istruzioni rapide |
| :--- | :--- | :--- |
| **Windows** | `El-Sbobinator-Setup-v*.exe` | Scarica il file `.exe`, avvialo e segui la procedura di installazione. |
| **macOS** | `El-Sbobinator-v*.dmg` | Apri il file `.dmg` scaricato e trascina l'icona di *El Sbobinator* nella cartella **Applicazioni**. |

> [!TIP]
> L'app include un sistema di aggiornamento automatico: non dovrai riscaricarla manualmente ogni volta, ti avviserà direttamente quando è disponibile una nuova versione.

---

## Guida Rapida (Primi Passi)

Segui questi 4 semplici passaggi per iniziare a sbobinare:

### 1. Ottieni la tua chiave Google Gemini gratuita (1 minuto)
1. Vai su [**aistudio.google.com/apikey**](https://aistudio.google.com/apikey) e accedi con il tuo account Google.
2. Clicca sul pulsante blu **"Create API key"** (oppure *"Get API key"*).
3. Seleziona un progetto (o creane uno nuovo se richiesto) e clicca su **"Create API key in existing/new project"**.
4. Copia il codice generato (una stringa che inizia per `AIzaSy...`).
   *(Il servizio è gratuito e non richiede l'inserimento di carte di credito).*

### 2. Inserisci la chiave nell'applicazione
Apri **El Sbobinator**: alla prima apertura vedrai una schermata di benvenuto. Incolla la tua chiave nel campo di testo e clicca su **Salva e inizia**.

### 3. Trascina la lezione e avvia
Trascina il file audio o video della lezione direttamente nella finestra del programma e clicca su **Avvia Sbobinatura**. Puoi anche inserire più lezioni in coda: verranno elaborate una dopo l'altra.

### 4. Rivedi ed Esporta
Al termine, apri la sbobina nell'editor per leggerla o integrarla. Clicca su **Copia formattato** per incollarla direttamente su **Microsoft Word** o **Google Docs**, oppure salvala in file HTML.

### Formati Supportati
- **File Audio**: `.mp3`, `.m4a` (memo vocali iPhone/Android), `.wav`, `.aac`, `.ogg`, `.flac`, `.opus`
- **File Video**: `.mp4` (lezioni registrate da Teams/Zoom), `.mkv`, `.webm`, `.mov`, `.avi`

---

## Risoluzione Problemi Comuni

### ⚠️ Avviso al primo avvio su Windows ("PC protetto da Windows" / SmartScreen)
I programmi gratuiti e open-source privi di certificato commerciale a pagamento possono essere temporaneamente segnalati da Windows SmartScreen o dall'antivirus:
1. Nella schermata blu che appare, clicca sulla scritta **Ulteriori informazioni**.
2. Clicca sul pulsante **Esegui comunque**.
*(Puoi verificare in qualsiasi momento l'assoluta sicurezza del file caricandolo su [VirusTotal](https://www.virustotal.com/)).*

### ⚠️ Avviso al primo avvio su Mac ("Sviluppatore non verificato" o "Impossibile aprire")
Su macOS, i software scaricati da internet non distribuiti tramite App Store richiedono una conferma al primo avvio:
1. Apri la cartella **Applicazioni**, fai **clic destro** (oppure premi `Control` e fai clic) sull'icona di *El Sbobinator* e scegli **Apri**.
2. Nella finestra di dialogo che compare, conferma cliccando su **Apri**.
3. *In alternativa*: se compare l'avviso di blocco, apri **Impostazioni di Sistema** -> **Privacy e Sicurezza**, scorri verso il basso fino alla sezione *Sicurezza* e clicca su **Apri comunque**.

### ⚪ Finestra bianca o vuota su Windows
Su sistemi Windows 10 datati potrebbe non essere aggiornato il componente Microsoft WebView2:
- Scarica e installa il runtime ufficiale gratuito: [Microsoft Edge WebView2 Runtime](https://go.microsoft.com/fwlink/p/?LinkId=2124703) *(già presente di default su Windows 11 e sulla maggior parte dei Windows 10).*

### ⏳ Limiti di Quota ("Quota giornaliera esaurita")
Il piano gratuito di Google AI Studio offre limiti giornalieri di richieste per modello. Se hai molte ore di lezione da trascrivere nello stesso giorno:
- Nelle **Impostazioni** dell'app puoi aggiungere **chiavi di riserva** (ad esempio create con un secondo account Google): l'applicazione passerà automaticamente alla chiave successiva quando la prima si esaurisce.

---

## Architettura del Sistema (Dettagli Tecnici)

```
Audio/Video di input
       │
       ▼
┌──────────────┐      ┌──────────────────────────┐      ┌──────────────────────────┐      ┌──────────────────┐
│    Fase 0    │ ───▶ │          Fase 1          │ ───▶ │          Fase 2          │ ───▶ │   Esportazione   │
│ Pre-convers. │      │ Trascrizione a Blocchi   │      │ Revisione Macro-Blocchi  │      │ Markdown → HTML  │
│ Mono 16 kHz  │      │   (Gemini + Contesto)    │      │ (Struttura e Pulizia)    │      │ (Sicurezza CSP)  │
└──────────────┘      └──────────────────────────┘      └──────────────────────────┘      └──────────────────┘
```

- **Fase 0 (Pre-conversione)**: Converte i file multimediali in MP3 mono a 16 kHz per velocizzare il taglio dei blocchi audio.
- **Fase 1 (Trascrizione a Blocchi)**: Suddivide l'audio in spezzoni con memoria contestuale per garantire continuità discorsiva e assenza di allucinazioni.
- **Fase 2 (Revisione Macro-Blocchi)**: Unisce i testi in blocchi tematici coerenti per normalizzare la formattazione e correggere la punteggiatura e i termini tecnici.
- **Esportazione**: Genera documenti HTML sanitizzati (tramite libreria `nh3`) con policy CSP rigide, completamente compatibili con i programmi di videoscrittura.

---

## Per Sviluppatori e Contributori

Se desideri consultare l'architettura del codice sorgente, eseguire i test o compilare l'app in autonomia:

- [CONTRIBUTING.md](CONTRIBUTING.md) — Setup ambiente locale, test (`pytest`, `vitest`, `ruff`) e script di build.
- [docs/architecture.md](docs/architecture.md) — Architettura dettagliata dei moduli Python e React.
- [docs/pipeline.md](docs/pipeline.md) — Funzionamento interno della pipeline, gestione rate limit ed errori.
- [docs/bridge_protocol.md](docs/bridge_protocol.md) — Protocollo di comunicazione IPC tra Python e React.
- [docs/session_model.md](docs/session_model.md) — Modello di persistenza locale su disco delle sessioni.

---

## Disclaimer Legale ed Etico

> [!IMPORTANT]
> - **Uso per Studio Personale**: Le registrazioni delle lezioni universitarie costituiscono proprietà intellettuale dei docenti. L'uso di questo strumento è inteso esclusivamente a fini di studio personale e ripasso.
> - **Divieto per Dati Clinici e Sanitari (GDPR)**: È fatto **divieto assoluto** di elaborare registrazioni contenenti dati sanitari identificabili di pazienti reali, cartelle cliniche, visite o conversazioni ospedaliere confidenziali.

---

## Sostieni il Progetto

Se El Sbobinator ti è stato utile per preparare i tuoi esami e desideri supportare lo sviluppo del software:

[![Ko-fi](https://img.shields.io/badge/Ko--fi-Offri%20un%20caffè-29abe0?style=flat-square&logo=kofi&logoColor=white)](https://ko-fi.com/vimuw)

---

## Licenza

Distribuito sotto **Licenza MIT**. Per i dettagli consulta il file [`LICENSE`](LICENSE).
