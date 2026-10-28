# Messa online

Ordine consigliato: Supabase → Vercel → dominio → Resend → cron → prova completa. Tempo stimato: 1–2 ore la prima volta.

Nulla di questa guida è stato eseguito su account reali: va fatto dal titolare degli account (o con la sua autorizzazione).

## 1. Supabase (database e login)

1. Crea un progetto su [supabase.com](https://supabase.com). **Regione UE** (es. Frankfurt) per tenere i dati in Europa. Salva la password del database in un password manager.
2. **Schema**. Con la CLI (consigliato, versionato):
   ```bash
   npx supabase login
   npx supabase link --project-ref <ref-progetto>
   npx supabase db push            # applica supabase/migrations/* in ordine
   ```
   In alternativa: SQL Editor → incolla ed esegui i file di `supabase/migrations/` uno alla volta, in ordine di nome.
3. **Dati di Barberhood**: SQL Editor → esegui `supabase/seed.sql` una sola volta. Poi correggi indirizzo, telefono e orari reali dalla dashboard (Impostazioni e Orari).
   Per un'altra attività usa invece `npm run business:create`.
4. **Auth** (Authentication → Sign In / Providers):
   - disattiva "Allow new users to sign up": gli account si creano solo con `npm run owner:create`;
   - Email provider attivo; conferma email non necessaria per account creati dallo script.
   - Authentication → URL Configuration → Site URL: l'URL pubblico (es. `https://prenota.barberhood.it`).
5. **Chiavi** (Project Settings → API Keys): copia URL, chiave *publishable* e chiave *secret*. La secret non va mai nel browser né nel repository.
6. **Storage**: il bucket `business-assets` viene creato dalla migrazione. Verifica che esista (Storage). Se la migrazione lo ha saltato, crealo pubblico con lo stesso nome.
7. **Account del titolare** (dal tuo computer, con `.env.local` che punta al progetto di produzione, poi rimetti quello di sviluppo):
   ```bash
   npm run owner:create -- --business barberhood --email titolare@dominio.it
   ```
   La password generata viene stampata una sola volta: consegnala al titolare, che può cambiarla da Impostazioni.

## 2. Vercel (hosting)

1. Collega il repository GitHub a un nuovo progetto Vercel (framework Next.js rilevato in automatico).
2. Environment Variables (Production), vedi `.env.example`:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`
   - `NEXT_PUBLIC_SITE_URL` (dominio definitivo, senza `/` finale)
   - `DEFAULT_BUSINESS_SLUG=barberhood`
   - `MANAGE_TOKEN_SECRET`: `openssl rand -base64 48`. **Non cambiarlo** dopo il lancio: i link già inviati smetterebbero di funzionare.
   - `CRON_SECRET`: `openssl rand -hex 32`
   - `RESEND_API_KEY`, `EMAIL_FROM` (dopo il punto 4)
3. Deploy. Controlla `/<slug>`, `/<slug>/prenota`, `/admin/login`.
4. Nota piano: Vercel Hobby è per uso non commerciale; per un servizio venduto a clienti serve il piano Pro.

## 3. Dominio

1. Vercel → Project → Settings → Domains → aggiungi `prenota.dominio.it` (o il dominio principale).
2. Dal registrar crea il record indicato da Vercel (di solito `CNAME prenota → cname.vercel-dns.com`). HTTPS è automatico.
3. Aggiorna `NEXT_PUBLIC_SITE_URL` e la Site URL di Supabase, poi rifai il deploy.

### Dominio dell'agenzia con sottodomini (agendafacile.it)

Con la variabile `ROOT_DOMAIN=agendafacile.it` (logica in `src/lib/hosts.ts`, applicata da `src/proxy.ts`):

| Indirizzo | Mostra |
| --- | --- |
| `agendafacile.it`, `www.agendafacile.it` | landing dell'agenzia (`public/landing/index.html`) |
| `admin.agendafacile.it` | dashboard (`/` porta a `/admin`) |
| `demo.agendafacile.it` | attività `demo-barbiere` (alias in `SUBDOMAIN_ALIASES`) |
| `<slug>.agendafacile.it` | l'attività con quello slug, con indirizzi puliti: `/`, `/prenota`, `/privacy` |

`/admin`, `/api` e `/gestisci` funzionano su ogni host; i vecchi link `/<slug>/...` sul sottodominio fanno redirect alla versione pulita. Gli altri host (vercel.app, dominio proprio di un negozio) restano come prima.

In Vercel aggiungi i domini al progetto. Senza wildcard bastano un record A per il dominio e un CNAME per ogni sottodominio; per `*.agendafacile.it` Vercel chiede di usare i suoi nameserver.

## 4. Email con Resend

Senza questo passo le prenotazioni funzionano, ma le email restano in coda (non vengono perse: partono quando l'invio viene attivato, saltando quelle ormai inutili, come promemoria di appuntamenti passati).

1. Crea un account su [resend.com](https://resend.com) → Domains → aggiungi il dominio (consigliato un sottodominio, es. `mail.dominio.it`).
2. Inserisci nel DNS i record SPF, DKIM (e il record MX di ritorno) che Resend mostra; aggiungi anche un record DMARC, ad esempio `_dmarc  TXT  "v=DMARC1; p=none; rua=mailto:titolare@dominio.it"`.
3. Attendi lo stato *Verified*, crea una API key con permesso *Sending access* e mettila in `RESEND_API_KEY`.
4. `EMAIL_FROM="Barberhood <prenotazioni@mail.dominio.it>"`, poi redeploy.
5. **Prova reale**: prenota con la tua email, sposta, annulla; controlla posta in arrivo e spam. Nella dashboard, nel dettaglio appuntamento, la sezione Email mostra lo stato di ogni invio.

## 5. Cron (invio coda e promemoria)

Le email di conferma partono subito dopo la prenotazione. Promemoria e tentativi falliti richiedono un'esecuzione periodica di `/api/cron/notifications`.

- `vercel.json` programma un'esecuzione al giorno (limite del piano Hobby) per manutenzione e pulizia dati.
- Per i promemoria serve una frequenza di qualche minuto. Soluzione gratuita: **pg_cron + pg_net in Supabase**. SQL Editor (sostituisci URL e segreto; i valori restano cifrati nel Vault):

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('https://prenota.dominio.it/api/cron/notifications', 'cron_url');
select vault.create_secret('<CRON_SECRET>', 'cron_secret');

select cron.schedule(
  'booking-notifications',
  '*/5 * * * *',
  $$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'cron_url'),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 20000
  );
  $$
);
```

Verifica: `select * from cron.job_run_details order by start_time desc limit 5;` e `select status_code, content from net._http_response order by created desc limit 5;` (atteso `200` con `{"ok":true,...}`).

Con Vercel Pro puoi invece cambiare la frequenza in `vercel.json` (es. `*/5 * * * *`) e non usare pg_cron.

## 6. Backup

- **Supabase Pro**: backup giornalieri automatici (conservazione secondo il piano); point-in-time recovery a pagamento.
- **Supabase Free**: nessun backup scaricabile. Fai almeno un dump settimanale e conservalo cifrato fuori da Supabase:
  ```bash
  npx supabase db dump --linked -f backup-schema.sql
  npx supabase db dump --linked --data-only -f backup-dati-$(date +%F).sql
  ```
- Prova il ripristino almeno una volta su un progetto di prova (`psql <url-progetto-prova> -f backup-...sql`).
- Le immagini caricate (Storage) vanno salvate a parte se non hai copie originali.

## 7. Checklist di rilascio

- [ ] Migrazioni applicate, `select count(*) from public.businesses` restituisce le attività attese
- [ ] Iscrizioni pubbliche disattivate in Supabase Auth
- [ ] Tutte le variabili d'ambiente presenti in Vercel; nessun segreto nel repository (`git grep -i "secret\|service_role"` mostra solo nomi di variabili)
- [ ] Indirizzo, telefono, orari, servizi e prezzi verificati con il titolare
- [ ] Titolare del trattamento e email privacy compilati in Impostazioni; informativa letta e approvata
- [ ] Dominio con HTTPS attivo; `NEXT_PUBLIC_SITE_URL` corretto
- [ ] Resend verificato e prova reale di conferma, modifica, annullamento ricevuta
- [ ] Cron attivo e risposta `200` registrata
- [ ] Prova completa da telefono: prenota, sposta, annulla dal link; prenotazione visibile in dashboard
- [ ] Prova di concorrenza manuale: due telefoni sullo stesso orario, uno solo riesce
- [ ] Primo backup fatto
- [ ] Link alla prenotazione messo in bio Instagram e su Google Business Profile

## 8. Problemi comuni

| Sintomo | Causa probabile | Soluzione |
| --- | --- | --- |
| Pagina pubblica "non trovata" | slug errato o attività `is_active = false` | controlla `businesses.slug` e `is_active` |
| Nessun orario disponibile | mancano orari settimanali, servizio senza barbieri, preavviso o orizzonte troppo restrittivi | Orari, Servizi (chi lo esegue), Impostazioni → Regole |
| Login rimanda sempre al login | l'utente non è membro dell'attività | `npm run owner:create` con lo slug giusto |
| Email non arrivano | dominio non verificato, `EMAIL_FROM` su dominio diverso, cron assente | stato in Resend, dettaglio appuntamento → Email, `net._http_response` |
| Email "non consegnata" in dashboard | errore permanente del provider (indirizzo non valido, dominio non verificato) | correggi e usa "Riprova invio" nella dashboard (pagina Oggi) |
| Cron risponde 401 | `CRON_SECRET` diverso tra Vercel e Vault | riallinea il segreto |
| Link "sposta o annulla" non valido | appuntamento già iniziato, oppure `MANAGE_TOKEN_SECRET` cambiato | il link scade all'orario dell'appuntamento; non cambiare il segreto |
| Caricamento immagini fallisce | bucket `business-assets` mancante | crea il bucket pubblico o riesegui la migrazione storage |
| Progetto Supabase in pausa | piano Free inattivo per giorni | riattiva dal pannello; per produzione valuta il piano Pro |

## 9. Costi indicativi

Prezzi pubblici al momento della scrittura (ottobre 2026), da verificare sui siti ufficiali prima di decidere.

| Voce | Per iniziare | Uso commerciale stabile |
| --- | --- | --- |
| Vercel | Hobby 0 € (non commerciale) | Pro circa 20 $/mese |
| Supabase | Free 0 € (limiti di spazio, pausa per inattività, niente backup) | Pro circa 25 $/mese, include backup giornalieri |
| Resend | Free: 3.000 email/mese, 100/giorno | Pro circa 20 $/mese per volumi più alti |
| Dominio | circa 10–15 €/anno | uguale |
| Turnstile (anti-bot) | gratuito | gratuito |

Un barbiere con 3 poltrone sta comodamente nei piani gratuiti di Supabase e Resend. Più attività sullo stesso deploy condividono gli stessi costi fissi: è il vantaggio del modello multi-tenant.
