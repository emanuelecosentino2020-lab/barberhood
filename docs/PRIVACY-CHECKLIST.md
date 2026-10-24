# Privacy e GDPR: checklist

Questo progetto è costruito per **aiutare** a rispettare il GDPR (Reg. UE 2016/679). Non è una certificazione e non sostituisce la verifica di un consulente privacy o di un legale. Chi usa il sistema (il negozio) è **titolare del trattamento**; chi lo gestisce tecnicamente per più negozi è **responsabile del trattamento** e deve firmare con ciascuno un accordo (art. 28).

## Cosa fa già il software

- **Minimizzazione**: si chiedono solo nome, email, telefono (facoltativo o obbligatorio a scelta del negozio) e una nota facoltativa con l'avviso di non inserire dati sulla salute.
- **Informativa** (art. 13) generata da un modello in `/{slug}/privacy`, con titolare ed email presi dalle Impostazioni. Presa visione obbligatoria prima di prenotare.
- **Base giuridica**: esecuzione di un servizio richiesto dall'interessato (art. 6.1.b). Nessun marketing, nessuna profilazione, nessun cookie di tracciamento o analytics.
- **Conservazione**: i clienti senza appuntamenti da più dei mesi impostati (default in Impostazioni → Privacy) vengono anonimizzati automaticamente dal cron giornaliero.
- **Diritti** (artt. 15–17): dalla scheda cliente il negozio vede tutti i dati e lo storico (accesso), li modifica (rettifica) e può cancellare i dati personali (cancellazione), mantenendo gli appuntamenti in forma anonima per la contabilità.
- **Sicurezza** (art. 32): HTTPS, accesso alla dashboard con account personali e ruoli, isolamento tra negozi a livello di database (RLS), link cliente non indovinabili con scadenza e salvati solo come hash, chiavi segrete solo lato server, log senza dati personali nei messaggi di errore.
- **Dati in UE**: possibile scegliendo una regione europea per Supabase.

## Cosa resta da fare (non automatizzabile)

- [ ] Compilare titolare del trattamento (ragione sociale, P.IVA, indirizzo) ed email privacy in Impostazioni
- [ ] Far rileggere l'informativa generata e adattarla all'attività reale
- [ ] Creare il progetto Supabase in regione UE
- [ ] Verificare i trasferimenti extra UE dei fornitori: Vercel (USA, hosting), Resend (USA, email). Entrambi offrono DPA e clausole contrattuali standard / Data Privacy Framework: scaricare e conservare i DPA
- [ ] Tenere il registro dei trattamenti (art. 30) se dovuto, indicando questo sistema
- [ ] Se si offre il servizio ad altri negozi: contratto di nomina a responsabile (art. 28) con ciascuno
- [ ] Definire chi nel negozio ha un account e con quale ruolo; disattivare gli account di chi non lavora più lì
- [ ] Procedura per violazioni dei dati (art. 33): chi avvisare entro 72 ore
- [ ] Backup cifrati e conservati in UE, con durata coerente con l'informativa
- [ ] Se un giorno si aggiungono analytics, marketing o WhatsApp: aggiornare informativa ed eventuale consenso
