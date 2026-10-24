@AGENTS.md

# Progetto

Sistema di prenotazione multi-tenant (Next.js 16 + Supabase). Leggi `README.md` per la panoramica e `docs/STATUS.md` per lo stato attuale.

## Regole

- Next.js 16 con `cacheComponents` e `partialPrefetching`: dati dinamici dentro `<Suspense>` o `loading.tsx`; "now" nei Server Component con `requestNow()` (`src/server/now.ts`); docs in `node_modules/next/dist/docs`.
- Ogni modifica allo schema è una nuova migrazione in `supabase/migrations/` (mai modificare quelle già applicate in produzione).
- Le prenotazioni passano sempre dalle funzioni SQL (`create_appointment`, `reschedule_appointment`, `cancel_appointment`): sono loro a garantire niente sovrapposizioni, eventi e notifiche.
- La chiave segreta Supabase solo in moduli `server-only`. Mai segreti nel repository.
- Non dichiarare funzionanti le email senza una prova reale con Resend e dominio verificato. WhatsApp non è implementato.
- Prima di chiudere un lavoro: `npm run check && npm run build`; test DB ed e2e come in `docs/TESTING.md`.
