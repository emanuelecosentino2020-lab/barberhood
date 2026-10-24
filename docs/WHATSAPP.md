# WhatsApp: predisposizione

Stato: **non implementato**. Nessun messaggio WhatsApp viene inviato o simulato.

## Cosa c'è già

- Nella coda `notifications` la colonna `channel` accetta `whatsapp`; ogni job ha già `kind`, `recipient`, `payload`, `idempotency_key`, tentativi e backoff.
- Il worker (`src/server/notifications/worker.ts`) salta i job con canale diverso da email con motivo `channel_not_supported`, quindi oggi non ne vengono creati né persi.
- Il telefono del cliente viene già raccolto e validato.

## Cosa serve per attivarlo

1. Account WhatsApp Business Platform (Meta Cloud API, direttamente o tramite un BSP come Twilio/360dialog), numero dedicato, verifica dell'azienda.
2. Template approvati da Meta per conferma, modifica, annullamento e promemoria (i messaggi transazionali fuori dalla finestra di 24 ore devono usare template). Costo per conversazione secondo il listino Meta per l'Italia.
3. Consenso esplicito del cliente a ricevere messaggi WhatsApp (checkbox nel form) e aggiornamento dell'informativa.
4. Codice: un `WhatsAppProvider` accanto a `src/server/notifications/provider.ts`, accodamento dei job `whatsapp` nelle funzioni SQL quando il cliente ha dato il consenso, ramo nel worker che usa `idempotency_key` per evitare doppi invii, webhook per gli stati di consegna.
