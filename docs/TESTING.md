# Test

| Livello | Comando | Cosa copre | Requisiti |
| --- | --- | --- | --- |
| Unitari | `npm test` | motore disponibilità (orari, pause, buffer, eccezioni, blocchi, preavviso, orizzonte, DST 25/10/2026 e 28/03/2027, buco delle 02:00), worker email (idempotenza, promemoria spostati, errori ritentabili e permanenti, niente WhatsApp), template (escape HTML, fuso orario) | nessuno |
| Database | `TEST_DATABASE_URL=postgres://... npm run test:db` | prenotazioni atomiche, 8 prenotazioni simultanee sullo stesso orario (ne vince una), buffer, blocchi, annulla/sposta con eventi e promemoria, coda email (claim concorrente, backoff, invio unico), rate limit, RLS e isolamento tra attività, ruoli | Postgres 15+ con `btree_gist`. Il test crea e distrugge un database temporaneo, **non** usare il database di produzione |
| Browser | `npm run test:e2e` | prenotazione completa e annullamento dal link, dati conservati tornando indietro e ricaricando, stesso orario prenotato due volte (409), input non valido, protezione dashboard, login titolare e appuntamento telefonico. Su viewport mobile e desktop | app avviata (`npm run dev`) collegata a un progetto Supabase **di prova** con `seed.sql`. Variabili: `E2E_BASE_URL`, `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD` |

I test e2e creano prenotazioni reali nel database collegato: per questo vanno eseguiti solo su un ambiente di prova. Se ripetuti molte volte di seguito possono attivare il rate limit delle prenotazioni (8 ogni 10 minuti per IP): in locale si azzera con `delete from private.rate_limits`.

Controllo completo prima di un rilascio:

```bash
npm run check && npm run build
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run test:db
E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... npm run test:e2e
```
