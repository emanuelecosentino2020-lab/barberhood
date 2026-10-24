import { z } from "zod";
import { isLocalDate } from "@/lib/booking/time";

const trimmed = (max: number) => z.string().trim().max(max);

export const uuid = z.uuid();
export const localDate = z.string().refine(isLocalDate, "Data non valida");
export const isoInstant = z.iso.datetime({ offset: true });
export const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, "Orario non valido");

/** Loose but safe phone check: digits, spaces, +, -, (), between 6 and 20 digits */
export const phone = z
  .string()
  .trim()
  .max(32)
  .refine((v) => {
    if (!/^[+\d\s().-]+$/.test(v)) return false;
    const digits = v.replace(/\D/g, "");
    return digits.length >= 6 && digits.length <= 20;
  }, "Numero di telefono non valido");

export const email = z.email("Email non valida").trim().toLowerCase().max(254);

export const availabilityQuerySchema = z.object({
  serviceId: uuid,
  staffId: z.union([uuid, z.literal("any")]).default("any"),
  from: localDate,
  days: z.coerce.number().int().min(1).max(31).default(14),
});

export const publicBookingSchema = z.object({
  serviceId: uuid,
  staffId: z.union([uuid, z.literal("any")]),
  startsAt: isoInstant,
  name: trimmed(120).min(2, "Inserisci nome e cognome"),
  email,
  phone: z.union([phone, z.literal("")]).optional(),
  note: trimmed(500).optional(),
  // Anti-spam: honeypot must stay empty, form must not be submitted instantly
  website: z.string().max(0).optional(),
  formStartedAt: z.number().int().optional(),
  turnstileToken: z.string().max(2048).optional(),
  acceptPrivacy: z.literal(true, "Devi prendere visione dell'informativa privacy"),
});
export type PublicBookingInput = z.infer<typeof publicBookingSchema>;

export const rescheduleSchema = z.object({
  startsAt: isoInstant,
});

export const cancelSchema = z.object({
  reason: trimmed(300).optional(),
});

// ---- Admin forms -----------------------------------------------------------

const euro = z
  .string()
  .trim()
  .regex(/^\d{1,5}([.,]\d{1,2})?$/, "Prezzo non valido")
  .transform((v) => Math.round(Number(v.replace(",", ".")) * 100));

export const serviceFormSchema = z.object({
  name: trimmed(120).min(1, "Nome obbligatorio"),
  description: trimmed(1000).optional().transform((v) => v || null),
  price: euro,
  duration_minutes: z.coerce.number().int().min(5).max(600),
  buffer_after_minutes: z.coerce.number().int().min(0).max(240).default(0),
  is_active: z.boolean(),
  staff_ids: z.array(uuid).default([]),
});

export const staffFormSchema = z.object({
  display_name: trimmed(80).min(1, "Nome obbligatorio"),
  bio: trimmed(500).optional().transform((v) => v || null),
  is_active: z.boolean(),
});

export const intervalSchema = z
  .object({ start: timeOfDay, end: timeOfDay })
  .refine((i) => i.end > i.start, "L'orario di fine deve essere dopo l'inizio");

export const weeklyHoursSchema = z.object({
  staffId: uuid.nullable(),
  days: z.array(z.object({ weekday: z.number().int().min(1).max(7), intervals: z.array(intervalSchema).max(6) })).length(7),
});

export const dateOverrideSchema = z
  .object({
    staffId: uuid.nullable(),
    date: localDate,
    isClosed: z.boolean(),
    intervals: z.array(intervalSchema).max(6).default([]),
    note: trimmed(200).optional(),
  })
  .refine((o) => o.isClosed || o.intervals.length > 0, "Indica gli orari o segna il giorno come chiuso");

export const timeBlockSchema = z
  .object({
    staffId: uuid.nullable(),
    startsAt: isoInstant,
    endsAt: isoInstant,
    reason: trimmed(200).optional(),
  })
  .refine((b) => Date.parse(b.endsAt) > Date.parse(b.startsAt), "La fine deve essere dopo l'inizio");

export const adminBookingSchema = z.object({
  serviceId: uuid,
  staffId: uuid,
  startsAt: isoInstant,
  customerId: uuid.optional(),
  name: trimmed(120).optional(),
  email: z.union([email, z.literal("")]).optional(),
  phone: z.union([phone, z.literal("")]).optional(),
  note: trimmed(500).optional(),
  allowOverride: z.boolean().default(false),
});

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Colore non valido");
const optionalUrl = z
  .union([z.url({ protocol: /^https?$/ }), z.literal("")])
  .optional()
  .transform((v) => v || null);
const optionalText = (max: number) => trimmed(max).optional().transform((v) => v || null);

export const businessSettingsSchema = z.object({
  name: trimmed(120).min(1),
  tagline: optionalText(160),
  description: optionalText(2000),
  address_line: optionalText(200),
  city: optionalText(100),
  postal_code: optionalText(16),
  phone: z.union([phone, z.literal("")]).optional().transform((v) => v || null),
  email: z.union([email, z.literal("")]).optional().transform((v) => v || null),
  website_url: optionalUrl,
  instagram_url: optionalUrl,
  facebook_url: optionalUrl,
  google_maps_url: optionalUrl,
  reviews_url: optionalUrl,
  staff_label: trimmed(40).min(1),
  accent: hexColor,
  slot_interval_minutes: z.coerce.number().int().min(5).max(120),
  min_notice_minutes: z.coerce.number().int().min(0).max(10080),
  max_advance_days: z.coerce.number().int().min(1).max(365),
  cancellation_cutoff_hours: z.coerce.number().int().min(0).max(168),
  reminder_hours_before: z.coerce.number().int().min(0).max(168),
  require_phone: z.boolean(),
  allow_staff_choice: z.boolean(),
  notification_email: z.union([email, z.literal("")]).optional().transform((v) => v || null),
  notify_owner_on_booking: z.boolean(),
  notify_owner_on_cancellation: z.boolean(),
  privacy_controller_name: optionalText(200),
  privacy_controller_email: z.union([email, z.literal("")]).optional().transform((v) => v || null),
  data_retention_months: z.coerce.number().int().min(1).max(120),
});

export function firstError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Dati non validi";
}
