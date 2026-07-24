<div align="center">

# 🤠 El Sbobinator

**Trasforma le registrazioni delle tue lezioni in dispense dettagliate, ordinate e pronte da studiare.**

[![Release](https://img.shields.io/github/v/release/vimuw/El-Sbobinator?style=flat-square&color=blue)](https://github.com/vimuw/El-Sbobinator/releases/latest)
[![CI](https://img.shields.io/github/actions/workflow/status/vimuw/El-Sbobinator/build.yml?branch=main&style=flat-square&label=CI)](https://github.com/vimuw/El-Sbobinator/actions/workflows/build.yml)
[![codecov](https://codecov.io/gh/vimuw/El-Sbobinator/graph/badge.svg)](https://codecov.io/gh/vimuw/El-Sbobinator)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-informational?style=flat-square)](https://github.com/vimuw/El-Sbobinator/releases)
[![License](https://img.shields.io/github/license/vimuw/El-Sbobinator?style=flat-square&color=green)](LICENSE)

<br />

[Scarica Ora](#-download) • [Caratteristiche](#-caratteristiche-principali) • [Guida Rapida](#-guida-rapida) • [FAQ & Risoluzione Problemi](#-domande-frequenti-faq)

<br />

<p align="center">
  <img width="48%" alt="Interfaccia Principale" src="https://github.com/user-attachments/assets/cec7f84f-3a3f-4cd5-9d7c-938abbd32159" />
  <img width="48%" alt="Editor Integrato" src="https://github.com/user-attachments/assets/569c83b0-5244-4227-826e-95fc68991c80" />
</p>

</div>

---

## ⚡ Caratteristiche Principali

* **🧠 AI-Powered by Google Gemini**: Basato su **Gemini 2.5 Flash** (con supporto a **3.5 Flash** e **3.1 Flash Lite**) per generare dispense chiare eliminando esitazioni, ripetizioni e retorica del parlato.
* **🔑 100% Gratuito (BYOK)**: Collega la tua API Key gratuita di Google AI Studio. Gestisce la **rotazione automatica delle chiavi** e la **catena di fallback dei modelli** in caso di limiti di quota.
* **✍️ Editor Rich-Text Integrato**: Modifica il testo, applica formattazione (**grassetto**, *corsivo*, titoli `H1`-`H3`), inserisci immagini, usa *Trova & Sostituisci* e riascolta l'audio con il player multimediale avanzato.
* **📂 Archivio & Ricerca Full-Text**: Organizza le lezioni in cartelle e ricerca istantaneamente qualsiasi argomento tra i testi e i titoli delle sbobine salvate.
* **🛡️ Autosalvataggio & Ripresa**: In caso di chiusura accidentale, spegnimento o esaurimento della quota API, le sessioni si salvano in automatico e riprendono esattamente da dove si erano interrotte.
* **🔒 Privacy First & 100% Locale**: Nessun server proprietario intermediate. I file audio e i dati rimangono esclusivamente sul tuo computer.

---

## 📦 Download

Scarica l'ultima versione per il tuo sistema operativo dalla sezione [**Releases**](https://github.com/vimuw/El-Sbobinator/releases/latest):

| Piattaforma | Pacchetto | Note |
| :--- | :--- | :--- |
| **Windows** | [`El-Sbobinator-Setup-v*.exe`](https://github.com/vimuw/El-Sbobinator/releases/latest) | Installer guidato per Windows 10/11 (64-bit) |
| **macOS** | [`El-Sbobinator-v*.dmg`](https://github.com/vimuw/El-Sbobinator/releases/latest) | Immagine disco per macOS 11 (Big Sur) o successivi |

> 🔄 **Aggiornamenti Automatici**: L'app include un sistema di aggiornamento integrato: quando esce una nuova versione, basta un clic nell'interfaccia per installarla in autonomia.

---

## 🚀 Guida Rapida

1. **Ottieni la Chiave API (Gratis)**: Accedi a [Google AI Studio](https://aistudio.google.com/app/apikey) col tuo account Google e clicca su *"Create API Key"*.
2. **Configura le Impostazioni**: Apri El Sbobinator, incolla la chiave nelle *Impostazioni* (verrà salvata in modo sicuro nel Portachiavi/Keyring di sistema).
3. **Carica l'Audio & Avvia**: Trascina i tuoi file audio/video (`.mp3`, `.m4a`, `.wav`, `.aac`, `.mp4`, `.mkv`, `.webm`, ecc.) e clicca su **Avvia Sbobinatura**.
4. **Rifinisci ed Esporta**: Correggi il testo nell'editor integrato e copialo direttamente su **Google Docs** / **Word** con la formattazione intatta, oppure esporta in **PDF**.

---

## ❓ Domande Frequenti (FAQ)

<details>
<summary><b>💰 La chiave API di Gemini è davvero gratuita? Rischio addebiti?</b></summary>

Sì, è al 100% gratuita. Google AI Studio non richiede carte di credito per il piano "Free Tier", rendendo fisicamente impossibili addebiti imprevisti. In caso di superamento della quota giornaliera, l'app ruoterà le chiavi di riserva o si metterà in pausa in attesa del reset.
</details>

<details>
<summary><b>⚡ Quanto dura l'elaborazione di una lezione?</b></summary>

Molto rapida: anche una registrazione di **3 ore** viene elaborata in circa **10-12 minuti**. I tempi dipendono dai server di Google, non dalla potenza del tuo computer.
</details>

<details>
<summary><b>🧠 Quale modello conviene scegliere nelle Impostazioni?</b></summary>

- **Gemini 2.5 Flash** *(Consigliato / Default)*: Il modello più stabile e testato per l'app. Offre il miglior bilanciamento tra velocità, qualità e quota gratuita.
- **Gemini 3.5 Flash**: Modello di ultima generazione per massima capacità espressiva.
- **Gemini 3.1 Flash Lite**: Ultra-veloce e con quote gratuite particolarmente ampie, ideale per volumi elevati.
</details>

<details>
<summary><b>🔒 Google utilizza le mie registrazioni per addestrare l'AI?</b></summary>

- **Piano Gratuito (Free Tier)**: I dati inviati possono essere analizzati da Google per il miglioramento dei modelli. Si raccomanda di non inviare registrazioni contenenti dati personali o sensibili.
- **Piano a Consumo (Paid Tier)**: I dati rimangono riservati e Google non li impiega per l'addestramento.
- **Nota Locale**: El Sbobinator non invia dati a nessun altro server ed elabora tutto in locale sul tuo PC.
</details>

<details>
<summary><b>💾 Come funziona l'autosalvataggio delle sessioni?</b></summary>

I progressi parziali vengono salvati continuamente in una cartella locale (`%LOCALAPPDATA%\El Sbobinator` su Windows, `~/Library/Caches/El Sbobinator` su Mac). Nelle *Impostazioni* puoi pulire i file vecchi o spostare la cartella di salvataggio in un'altra posizione.
</details>

---

## 🛠️ Risoluzione Problemi (Troubleshooting)

<details>
<summary><b>⚠️ Windows Defender o l'antivirus segnala il file come minaccia?</b></summary>

È un **falso positivo** del tutto normale. Succede spesso con gli eseguibili generati da script Python privi di firma digitale commerciale.
- **Windows SmartScreen**: Clicca su *"Ulteriori Informazioni"* e poi su *"Esegui Comunque"*.
- **Antivirus**: Nella cronologia di protezione, seleziona *"Consenti nel dispositivo"*.
- Puoi comunque analizzare il file su [VirusTotal](https://www.virustotal.com/) per verificare la sicurezza del pacchetto.
</details>

<details>
<summary><b>📺 Su Windows l'app mostra una finestra nera o non si avvia?</b></summary>

Verifica che sia installato il componente di sistema **Microsoft Edge WebView2 Runtime**, necessario per l'interfaccia grafica. Può essere scaricato gratuitamente da qui: 👉 [Scarica WebView2 Runtime](https://go.microsoft.com/fwlink/p/?LinkId=2124703).
</details>

---

## 💻 Requisiti di Sistema

| Specifiche | Windows | macOS |
| :--- | :--- | :--- |
| **OS Minimo** | Windows 10 (64-bit) | macOS 11 Big Sur |
| **RAM** | 4 GB consigliati | 4 GB consigliati |
| **Spazio Disco** | ~160 MB (Installata) + ~0.5–2 GB temporanei per lezione | ~160 MB (Installata) + ~0.5–2 GB temporanei per lezione |
| **Connessione** | ✅ Richiesta durante l'elaborazione (chiamate API Gemini) | ✅ Richiesta durante l'elaborazione (chiamate API Gemini) |

---

## ⚖️ Disclaimer Legale ed Etico

* **Diritto d'autore e Uso Personale**: Le lezioni universitarie sono proprietà intellettuale dei rispettivi docenti. L'uso di questo strumento è inteso **esclusivamente per scopi di studio personale**.
* **Divieto per Dati Clinici e Sanitari (GDPR)**: È rigorosamente vietato elaborare registrazioni effettuate in contesti clinici, ospedalieri o contenenti dati di pazienti reali.
* **Licenza**: Software distribuito sotto licenza MIT "così com'è", senza alcuna garanzia.

---

## 🤝 Contribuire & Supporto

Segnalazioni di bug e proposte di nuove funzionalità sono sempre le benvenute! Apri una **[Issue](https://github.com/vimuw/El-Sbobinator/issues)** o consulta la guida [CONTRIBUTING.md](CONTRIBUTING.md) per le istruzioni riservate ai contributor.

Se El Sbobinator ti ha salvato la sessione d'esami e desideri sostenere il progetto:

<a href="https://ko-fi.com/vimuw" target="_blank"><img src="https://storage.ko-fi.com/cdn/kofi3.png?v=3" height="36" alt="Buy Me a Coffee at ko-fi.com" /></a>

---

## 📝 Licenza

Distribuito sotto **Licenza MIT**. Per i dettagli consulta il file [`LICENSE`](LICENSE).
