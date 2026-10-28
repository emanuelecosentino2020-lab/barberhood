# Stato del progetto

Aggiornato: 26 ottobre 2026.

## Obiettivo

Sistema di prenotazione premium per Barberhood (Siracusa), riusabile e vendibile ad altre attività su appuntamento (multi-tenant).

## Fatto e verificato

- Schema multi-tenant, RLS, funzioni di prenotazione atomiche, coda notifiche, rate limit (migrazioni in `supabase/migrations`)
- Motore disponibilità con DST, pagina pubblica, flusso di prenotazione, link cliente sposta/annulla
- Dashboard completa (oggi, calendario, appuntamenti, clienti, servizi, team, orari, impostazioni)
- Email via Resend con coda, retry, idempotenza (codice e test con provider finto)
- Richiesta recensione Google via email N ore dopo l'appuntamento (default 2, max una ogni 6 mesi per cliente; serve il «Link recensioni Google» nelle impostazioni)
- Foto: nuovo ritratto di Diego, copertina con Luigi e Diego (`cover.webp`)
- Lint, typecheck, build di produzione, 38 test unitari, 26 test su Postgres reale, 12 test e2e (mobile e desktop) contro uno stack Supabase locale (Postgres 16, PostgREST, GoTrue)

## Demo per i clienti

- Barberia di fantasia «Lama & Pettine» su `/demo-barbiere`: `supabase/demo-barbiere.sql` (si incolla nello SQL Editor; rieseguirlo riporta la demo a zero con agenda centrata su oggi). Tocca solo l'attività demo.
- Chi gestisce più attività le cambia dal selettore in alto nella dashboard.
- Senza foto (mancano immagini con licenza): si aggiungono da Impostazioni e Team.

## Non ancora verificato

- **Invio email reale**: mai provato, mancano API key Resend e dominio verificato
- Deploy su Vercel e progetto Supabase reale: non creati (servono gli account del titolare)
- Cron pg_cron in Supabase cloud: SQL pronto in `docs/DEPLOY.md`, non eseguito
- Cloudflare Turnstile: integrato ma non provato con chiavi reali

## Dati da confermare con il titolare

- Indirizzo, telefono, orari reali di Barberhood (nel seed ci sono valori provvisori: mar–sab 9–13, 15–20)
- Titolare del trattamento (ragione sociale, P.IVA) per l'informativa
- Foto di Gabriel Formisano (ora mostra le iniziali)

## Prossimi passi

1. Repository GitHub e deploy (Supabase UE + Vercel)
2. Dominio e Resend, prova email reale
3. Inserire dati reali, prova con il titolare, link in bio Instagram
4. Dopo il pilota: onboarding self-service per nuove attività, pagamenti/abbonamenti, WhatsApp
