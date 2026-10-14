# Disclaimer e Condizioni di Utilizzo

*El Sbobinator* è un'applicazione desktop open source distribuita gratuitamente sotto licenza MIT. Questo documento fornisce informazioni sui limiti di responsabilità, sul funzionamento dell'applicazione e sull'uso dei servizi terzi integrati.

---

### 1. Architettura Locale e Servizi di Terze Parti (BYOK)
- **Elaborazione locale con chiave personale**: L'applicazione viene eseguita sul computer dell'utente e non utilizza server proxy, backend o database gestiti dallo sviluppatore. File e bozze vengono conservati localmente. Per l'elaborazione AI, l'utente configura la propria API key e il proprio progetto Google (*Bring Your Own Key*, BYOK); le richieste vengono trasmesse direttamente e cifrate (TLS) agli endpoint ufficiali di Gemini (`generativelanguage.googleapis.com`).
- **Termini Google**: L'utilizzo delle API Gemini (incluse quote per progetto/modello, disponibilità dei modelli, fatturazione e trattamento dei dati) è soggetto ai [Termini di Servizio di Google](https://policies.google.com/terms), ai [Termini delle Google APIs](https://developers.google.com/terms) e ai [Termini Aggiuntivi di Gemini API / AI Studio](https://ai.google.dev/gemini-api/terms) applicabili all'account e al progetto dell'utente. I limiti RPD/RPM sono stabiliti a livello di progetto Google Cloud e non si moltiplicano con l'uso di più chiavi appartenenti al medesimo progetto.
- **Requisiti di accesso e utilizzo**: I termini Google richiedono almeno 18 anni e pongono restrizioni agli API client rivolti o probabilmente accessibili ai minori. Prevedono l'uso di Gemini API per finalità professionali o aziendali, con restrizioni per l'uso da parte dei consumatori; per gli API client resi disponibili a utenti nello Spazio Economico Europeo, in Svizzera o nel Regno Unito richiedono i servizi definiti *Paid Services*. L'applicabilità di queste condizioni a un'app desktop con chiave personale destinata allo studio deve essere verificata: la gratuità del software e l'uso di una propria API key non attestano automaticamente la conformità ai termini Google.


---

### 2. Diritto d'Autore e Registrazioni
L'utente è l'unico responsabile di verificare preventivamente di avere il diritto di registrare, elaborare, conservare e utilizzare le lezioni e i relativi materiali didattici, nel rispetto delle normative vigenti e dei regolamenti del proprio ateneo o istituto. L'utente non deve diffondere, pubblicare o condividere materiale protetto senza le necessarie autorizzazioni.

---

### 3. Dati Personali e Sanitari
Le registrazioni audio e video possono contenere informazioni su persone identificate o identificabili. Se tali informazioni riguardano la loro salute, come nel caso di un paziente riconoscibile in un esempio clinico, rientrano nelle categorie particolari di dati personali previste dall'art. 9 GDPR. Il solo fatto che una lezione tratti argomenti medici non rende il suo contenuto un dato personale relativo alla salute.

L'utente è tenuto a verificare di essere legittimato a trattare tali dati per la specifica finalità e deve astenersi dall'inviare a servizi cloud esterni contenuti che non sia autorizzato a trasmettere, adottando le opportune cautele di anonimizzazione preventiva.

---

### 4. Natura Assistiva dell'Output AI
La trascrizione e la rielaborazione sono generate automaticamente da modelli di intelligenza artificiale che possono commettere inesattezze, omissioni o allucinazioni. Il testo prodotto costituisce una bozza di supporto allo studio personale e non sostituisce l'ascolto critico, i libri di testo o l'insegnamento dei docenti. L'utente è tenuto a verificare e revisionare sempre il contenuto finale.

---

### 5. Esclusione di Garanzie e Limitazione di Responsabilità
Nei limiti consentiti dalla legge applicabile, il software è fornito "così com'è" (*AS IS*), secondo l'esclusione di garanzie e la limitazione di responsabilità contenute nella [licenza MIT](LICENSE). Restano ferme le responsabilità che non possono essere escluse per legge, incluse quelle per dolo o colpa grave e quelle derivanti da obblighi di ordine pubblico.

---

### 6. Fonti e Documentazione di Riferimento
- [Gemini API – Termini Aggiuntivi di Servizio](https://ai.google.dev/gemini-api/terms)
- [Google APIs Terms of Service](https://developers.google.com/terms)
- [Google Terms of Service](https://policies.google.com/terms)
- [Regolamento (UE) 2016/679 – GDPR (EUR-Lex)](https://eur-lex.europa.eu/eli/reg/2016/679/oj)
- [Legge 22 aprile 1941, n. 633 sul diritto d'autore (Normattiva)](https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1941-04-22;633)
- [Codice civile, art. 1229 – Clausole di esonero da responsabilità (Gazzetta Ufficiale)](https://www.gazzettaufficiale.it/atto/serie_generale/caricaArticolo?art.codiceRedazionale=042U0262&art.dataPubblicazioneGazzetta=1942-04-04&art.flagTipoArticolo=2&art.idArticolo=1229&art.idGruppo=151&art.idSottoArticolo=1&art.idSottoArticolo1=10&art.progressivo=0&art.versione=1)
