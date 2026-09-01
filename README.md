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

El Sbobinator è un'applicazione desktop standalone sviluppata con Python e un'interfaccia React/TypeScript (ospitata tramite pywebview). Elabora registrazioni di lezioni attraverso una pipeline a più stadi basata su Gemini, generando dispense di studio pronte per la lettura e la revisione che eliminano disfluenze, ripetizioni e digressioni del parlato preservando il rigore tecnico.

Tutte le operazioni avvengono in locale sul computer dell'utente, con chiamate API inviate direttamente a Google AI Studio senza server intermediari.

---

## Caratteristiche Principali

- **Pipeline AI a Più Stadi**: Architettura a 2 fasi ottimizzata per i modelli Google Gemini (`gemini-2.5-flash`, `gemini-3.7-flash`, `gemini-3.5-flash`, `gemini-3.5-flash-lite`) con trascrizione a blocchi e revisione editoriale macro.
- **Architettura BYOK e Resilienza**: Utilizza la tua chiave API gratuita di Google AI Studio. Supporta rotazione automatica multi-chiave, catene di fallback dei modelli e gestione automatica del rate limit.
- **Editor Rich-Text Integrato**: Editor TipTap completo con supporto markdown e formule LaTeX, indice dei contenuti (TOC) navigabile, funzione Trova e Sostituisci e immagini ridimensionabili.
- **Player Audio Sincronizzato**: Riproduttore multimediale integrato con streaming locale, velocità regolabile (1.0x–3.0x), avanzamento rapido e memorizzazione della posizione d'ascolto per ogni sessione.
- **Archivio e Ricerca Full-Text**: Ricerca istantanea su tutte le sbobine salvate con anteprima dei frammenti di testo e organizzazione in cartelle personalizzate.
- **Esportazione e Portabilità**: Copia diretta formattata per Google Docs e Microsoft Word, esportazione in documenti HTML standalone e pacchetti compressi `.sbobina` per backup e condivisione rapida.
- **Privacy e Sicurezza**: Elaborazione 100% locale. Le chiavi API sono memorizzate nel portachiavi sicuro del sistema operativo (Windows DPAPI / macOS Keychain) e i documenti esportati adottano rigide Content Security Policy.

---

## Download

I file binari precompilati sono disponibili nella sezione [Releases](https://github.com/vimuw/El-Sbobinator/releases/latest):

| Piattaforma | Pacchetto | Note / Architettura |
| :--- | :--- | :--- |
| **Windows** | `El-Sbobinator-Setup-v*.exe` | Installer per Windows 10 / 11 (64-bit) |
| **macOS** | `El-Sbobinator-v*.dmg` | Immagine disco per macOS 11 (Big Sur) o versioni successive |

L'applicazione include un sistema di aggiornamento automatico integrato che notifica e installa le nuove versioni direttamente dall'interfaccia.

---

## Guida Rapida

1. **Ottieni una Chiave API**: Crea una chiave API Gemini gratuita su [Google AI Studio](https://aistudio.google.com/app/apikey).
2. **Configura le Impostazioni**: Apri El Sbobinator, accedi alle **Impostazioni** e incolla la chiave API (salvata in modo sicuro nel portachiavi di sistema).
3. **Importa i File e Avvia**: Trascina i file audio o video nella coda e clicca su **Avvia Sbobinatura**.
4. **Modifica ed Esporta**: Revisiona il testo nell'editor integrato, copialo direttamente in Google Docs/Word oppure salvalo in formato HTML o pacchetto `.sbobina`.

### Formati Supportati

- **Audio**: `.mp3`, `.m4a`, `.wav`, `.aac`, `.ogg`, `.flac`, `.opus`
- **Video**: `.mp4`, `.mkv`, `.webm`, `.mov`, `.avi`

---

## Architettura

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

- **Fase 0 (Pre-conversione)**: Converte i media in MP3 mono a 16 kHz per velocizzare il taglio dei blocchi tramite stream-copy.
- **Fase 1 (Trascrizione a Blocchi)**: Suddivide l'audio in blocchi con memoria contestuale sovrapposta per garantire coerenza e continuità.
- **Fase 2 (Revisione Macro-Blocchi)**: Unisce i testi in blocchi tematici coerenti per normalizzare la formattazione e correggere imprecisioni.
- **Esportazione**: Genera documenti HTML sanitizzati e compatibili con i principali programmi di videoscrittura.

---

## Requisiti di Sistema

- **RAM**: Minimo 4 GB (8 GB consigliati)
- **Spazio su Disco**: ~200 MB per l'applicazione + spazio temporaneo per i file audio
- **Connessione di Rete**: Connessione internet attiva (richiesta per le chiamate API Gemini)

| Piattaforma | Sistema Operativo Minimo | Componenti Aggiuntivi |
| :--- | :--- | :--- |
| **Windows** | Windows 10 (64-bit) o successivo | [Microsoft Edge WebView2 Runtime](https://go.microsoft.com/fwlink/p/?LinkId=2124703) *(incluso di default in Windows 10/11)* |
| **macOS** | macOS 11 (Big Sur) o successivo | Nessuno *(utilizza WebKit nativo)* |

---

## Sviluppo e Contributi

Per configurare l'ambiente locale, eseguire i test di integrazione (`ruff`, `pytest`, `vitest`) o compilare i pacchetti di rilascio, consulta:

- [CONTRIBUTING.md](CONTRIBUTING.md) per i comandi di setup, test e compilazione dei binari.
- [docs/architecture.md](docs/architecture.md) per l'architettura dettagliata dei moduli Python e React.
- [docs/pipeline.md](docs/pipeline.md) per il funzionamento interno della pipeline e la gestione degli errori.
- [docs/bridge_protocol.md](docs/bridge_protocol.md) per il protocollo di comunicazione IPC tra Python e React.
- [docs/session_model.md](docs/session_model.md) per la persistenza su disco e il formato delle sessioni.

---

## Risoluzione Problemi

- **Avviso Windows SmartScreen / Antivirus**: Gli eseguibili open-source privi di certificato commerciale a pagamento possono generare falsi positivi. Clicca su *Ulteriori informazioni* -> *Esegui comunque*, oppure verifica il file su [VirusTotal](https://www.virustotal.com/).
- **Finestra vuota su Windows**: Verifica che il runtime [Microsoft Edge WebView2](https://go.microsoft.com/fwlink/p/?LinkId=2124703) sia installato e aggiornato.
- **Limiti di Quota API**: Il piano gratuito di Google AI Studio include limiti giornalieri di richieste e token. È possibile configurare chiavi di riserva nelle **Impostazioni** per abilitare la rotazione automatica.

---

## Disclaimer Legale ed Etico

- **Uso per Studio Personale**: Le registrazioni delle lezioni universitarie costituiscono proprietà intellettuale dei rispettivi docenti. L'uso di questo strumento è inteso esclusivamente a fini di studio personale.
- **Divieto per Dati Clinici e Sanitari (GDPR)**: È fatto divieto assoluto di elaborare registrazioni contenenti dati sanitari identificabili, conversazioni cliniche o informazioni personali sensibili.

---

## Sostieni il Progetto

Se El Sbobinator ti è stato utile per preparare i tuoi esami e desideri supportare lo sviluppo del software:

[![Ko-fi](https://img.shields.io/badge/Ko--fi-Offri%20un%20caffè-29abe0?style=flat-square&logo=kofi&logoColor=white)](https://ko-fi.com/vimuw)

---

## Licenza

Distribuito sotto **Licenza MIT**. Per i dettagli consulta il file [`LICENSE`](LICENSE).
