import "server-only";

export type BookingErrorCode =
  | "slot_taken"
  | "invalid_input"
  | "not_found"
  | "rate_limited"
  | "spam"
  | "not_modifiable"
  | "too_late"
  | "unavailable";

const MESSAGES: Record<BookingErrorCode, string> = {
  slot_taken: "Questo orario è appena stato prenotato. Scegline un altro.",
  invalid_input: "Alcuni dati non sono validi. Controlla e riprova.",
  not_found: "Non abbiamo trovato quello che cercavi.",
  rate_limited: "Troppe richieste in poco tempo. Attendi qualche minuto e riprova.",
  spam: "Non è stato possibile completare la richiesta. Riprova.",
  not_modifiable: "Questo appuntamento non può più essere modificato.",
  too_late: "È troppo tardi per modificare online questo appuntamento. Contatta direttamente il negozio.",
  unavailable: "Servizio temporaneamente non disponibile. Riprova tra poco.",
};

const STATUS: Record<BookingErrorCode, number> = {
  slot_taken: 409,
  invalid_input: 400,
  not_found: 404,
  rate_limited: 429,
  spam: 400,
  not_modifiable: 409,
  too_late: 409,
  unavailable: 503,
};

export class BookingError extends Error {
  constructor(
    public readonly code: BookingErrorCode,
    message?: string,
  ) {
    super(message ?? MESSAGES[code]);
  }
  get status() {
    return STATUS[this.code];
  }
}

interface PgLikeError {
  code?: string;
  message?: string;
}

/** Maps database errors raised by our SQL functions to safe user-facing errors. */
export function fromDbError(error: PgLikeError): BookingError {
  if (error.code === "23P01" || error.message === "slot_unavailable") return new BookingError("slot_taken");
  if (error.message === "staff_not_available_for_service") return new BookingError("slot_taken");
  if (
    error.message === "appointment_not_found" ||
    error.message === "service_not_found" ||
    error.message === "business_not_found" ||
    error.message === "customer_not_found"
  ) {
    return new BookingError("not_found");
  }
  if (error.message === "appointment_not_modifiable") return new BookingError("not_modifiable");
  if (error.code === "22023" || error.code === "23514") return new BookingError("invalid_input");
  // Never leak internal details: log the code only.
  console.error("[booking] database error", { code: error.code });
  return new BookingError("unavailable");
}
