# Prenotazioni online per barbieri e attività su appuntamento

Sistema di prenotazione multi-attività (multi-tenant): pagina pubblica dell'attività, prenotazione guidata senza account, link personale per spostare o annullare, dashboard di gestione, email transazionali con coda e promemoria.

Primo cliente: **Barberhood di Luigi Merlini** (Siracusa), slug `barberhood`.

## Cosa fa

- **Pagina pubblica** `/{slug}`: logo, foto, indirizzo, orari, servizi con prezzo e durata, team, social, pulsante Prenota.
- **Prenotazione** `/{slug}/prenota`: servizio → barbiere (o primo disponibile) → giorno e ora (solo orari realmente liberi) → dati → riepilogo → conferma. I dati restano se si torna indietro; se l'orario viene preso nel frattempo si torna alla scelta dell'ora con un messaggio chiaro.
- **Gestione cliente** `/gestisci/{token}`: sposta o annulla entro il limite impostato. Il link è casuale, firmato, scade all'orario dell'appuntamento e nel database ne resta solo l'hash.
- **Dashboard** `/admin`: oggi e statistiche del mese, calendario giorno/settimana/mese per barbiere, nuovo appuntamento (telefono/negozio), sposta, annulla, completato/non presentato, storico modifiche, clienti con ricerca e storico, servizi, team, orari settimanali, giorni speciali, ferie e blocchi, impostazioni (profilo, regole, notifiche, privacy, immagini, password).
- **Disponibilità** calcolata sul server: orari negozio e per barbiere, pause, durata più pausa dopo il servizio, chiusure, eccezioni per data, blocchi, appuntamenti esistenti, preavviso minimo, orizzonte massimo. Fuso `Europe/Rome` con cambio ora legale gestito.
- **Nessuna doppia prenotazione**: vincolo di esclusione Postgres per barbiere; anche con "primo disponibile" il barbiere viene assegnato sul server dentro la stessa transazione.
- **Email** (Resend): conferma, modifica, annullamento, promemoria, avvisi al negozio. Coda nel database con tentativi e backoff, chiave di idempotenza per ogni invio, promemoria riprogrammati quando l'appuntamento cambia.
- **WhatsApp**: solo predisposto nello schema (canale `whatsapp` nella coda), nessun invio implementato. Vedi [docs/WHATSAPP.md](docs/WHATSAPP.md).

## Stack

Next.js 16 (App Router, Cache Components) · TypeScript strict · Tailwind 4 · Supabase (Postgres, Auth, RLS, Storage) · Resend · Vercel.

## Avvio in locale

Requisiti: Node 22+, un progetto Supabase di sviluppo (oppure la CLI Supabase con Docker: `supabase start`).

```bash
npm install
cp .env.example .env.local        # compila le chiavi del progetto di sviluppo
# applica lo schema: supabase db push  (oppure incolla supabase/migrations/*.sql in ordine nello SQL editor)
# dati di esempio Barberhood: supabase/seed.sql
npm run owner:create -- --business barberhood --email tu@example.com
npm run dev                        # http://localhost:3000/barberhood  ·  /admin
```

## Comandi

| Comando | Cosa fa |
| --- | --- |
| `npm run dev` / `build` / `start` | sviluppo, build di produzione, avvio |
| `npm run check` | lint + typecheck + test unitari |
| `npm test` | test unitari (disponibilità, DST, worker email, template); i test DB partono solo con `TEST_DATABASE_URL` |
| `npm run test:db` | test su Postgres reale: concorrenza, RLS, isolamento tra attività, coda email |
| `npm run test:e2e` | test nel browser (Playwright) contro un'app avviata su un database di prova |
| `npm run business:create -- --slug x --name "X" --city Roma` | nuova attività (tenant) |
| `npm run owner:create -- --business x --email a@b.it [--role owner\|admin\|staff]` | account di gestione |

Dettagli sui test: [docs/TESTING.md](docs/TESTING.md).

## Struttura

```
supabase/migrations/   schema, sicurezza (RLS), funzioni di prenotazione, storage
supabase/seed.sql      dati di Barberhood
src/lib/booking/       motore disponibilità (puro, testato) e utilità fuso orario
src/server/            accesso dati, prenotazioni, notifiche, auth, rate limit
src/app/[slug]/        pagine pubbliche   src/app/gestisci/  link cliente
src/app/admin/         dashboard e server actions
src/app/api/           API pubbliche, gestione via token, cron notifiche
tests/db/  tests/e2e/  test su database e browser
docs/                  deploy, privacy, testing, stato del progetto
```

## Messa online

Guida passo passo: [docs/DEPLOY.md](docs/DEPLOY.md) (Supabase, Vercel, dominio, Resend, cron, backup, checklist di rilascio, problemi comuni, costi).

Privacy: [docs/PRIVACY-CHECKLIST.md](docs/PRIVACY-CHECKLIST.md). Il progetto aiuta a rispettare il GDPR ma **non** è una certificazione di conformità.

## Sicurezza in breve

- La chiave segreta Supabase si usa solo sul server (`server-only`); il browser vede solo la chiave pubblica.
- Ogni tabella ha RLS: i visitatori non leggono nulla direttamente, i membri vedono solo la propria attività, ruoli `owner`/`admin`/`staff` verificati sia nel database sia nelle server action.
- Input validati con zod sul server, errori generici verso l'esterno, rate limit su prenotazioni, login, link di gestione e disponibilità.
- Anti-spam: honeypot, tempo minimo di compilazione, limite per email e per IP, Cloudflare Turnstile opzionale.
