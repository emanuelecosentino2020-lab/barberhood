import "server-only";
import { computeAvailability, resolveSlot, type DayAvailability } from "@/lib/booking/availability";
import { addDays, localDateOf, todayIn, type LocalDate } from "@/lib/booking/time";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { createManageToken, hashToken, isWellFormedToken } from "@/lib/tokens";
import type { Appointment, AppointmentStatus, PublicBusiness } from "@/lib/types";
import type { PublicBookingInput } from "@/lib/validation";
import { AvailabilityError, loadAvailabilityQuery } from "./availability";
import { BookingError, fromDbError } from "./errors";
import { getPublicCatalog } from "./public";
import { isAllowed, RATE_LIMITS } from "./rate-limit";
import { verifyTurnstile } from "./turnstile";

/** Minimum time a human needs to fill the form; faster submissions are bots. */
const MIN_FORM_MS = 2500;

async function requireCatalog(slug: string) {
  const catalog = await getPublicCatalog(slug);
  if (!catalog) throw new BookingError("not_found");
  return catalog;
}

function mapAvailabilityError(err: unknown): never {
  if (err instanceof AvailabilityError) {
    throw new BookingError(err.code === "load_failed" ? "unavailable" : "not_found");
  }
  throw err;
}

// ---------------------------------------------------------------------------
// Public availability
// ---------------------------------------------------------------------------
export interface PublicAvailability {
  timezone: string;
  days: { date: LocalDate; slots: { start: string; staffIds: string[] }[] }[];
}

export async function getPublicAvailability(
  slug: string,
  params: { serviceId: string; staffId: string | "any"; from: LocalDate; days: number },
  clientKey: string,
): Promise<PublicAvailability> {
  const db = createAdminClient();
  if (!(await isAllowed(db, RATE_LIMITS.availability, clientKey))) throw new BookingError("rate_limited");
  const { business } = await requireCatalog(slug);
  const staffId = params.staffId === "any" || !business.allow_staff_choice ? null : params.staffId;
  const to = addDays(params.from, params.days - 1);
  try {
    const { query } = await loadAvailabilityQuery(db, business, { serviceId: params.serviceId, staffId, from: params.from, to });
    return { timezone: business.timezone, days: computeAvailability(query) };
  } catch (err) {
    mapAvailabilityError(err);
  }
}

// ---------------------------------------------------------------------------
// Public booking
// ---------------------------------------------------------------------------
export interface BookingConfirmation {
  appointmentId: string;
  manageUrl: string;
  startsAt: string;
  endsAt: string;
  serviceName: string;
  priceCents: number;
  staffName: string;
}

export async function createPublicBooking(
  slug: string,
  input: PublicBookingInput,
  client: { key: string; ip: string },
): Promise<BookingConfirmation> {
  const env = serverEnv();
  const db = createAdminClient();

  // Anti-abuse: honeypot, timing, captcha (optional), rate limits per IP and per email
  if (input.website) throw new BookingError("spam");
  if (input.formStartedAt && Date.now() - input.formStartedAt < MIN_FORM_MS) throw new BookingError("spam");
  if (!(await verifyTurnstile(env.TURNSTILE_SECRET_KEY, input.turnstileToken, client.ip))) throw new BookingError("spam");
  if (!(await isAllowed(db, RATE_LIMITS.booking, client.key))) throw new BookingError("rate_limited");
  if (!(await isAllowed(db, RATE_LIMITS.bookingPerEmail, hashToken(input.email)))) throw new BookingError("rate_limited");

  const { business, staff } = await requireCatalog(slug);
  if (business.require_phone && !input.phone) {
    throw new BookingError("invalid_input", "Inserisci un numero di telefono.");
  }
  const preferred = input.staffId === "any" || !business.allow_staff_choice ? null : input.staffId;

  // Re-compute availability on the server: never trust what the browser showed.
  // If "any staff" loses a race we retry once with fresh data.
  for (let attempt = 0; attempt < 2; attempt++) {
    const date = localDateOf(input.startsAt, business.timezone);
    let assigned: string | null;
    try {
      const { query } = await loadAvailabilityQuery(db, business, { serviceId: input.serviceId, staffId: preferred, from: date, to: date });
      assigned = resolveSlot(query, input.startsAt, preferred);
    } catch (err) {
      mapAvailabilityError(err);
    }
    if (!assigned) throw new BookingError("slot_taken");

    const token = createManageToken(env.MANAGE_TOKEN_SECRET);
    const { data, error } = await db.rpc("create_appointment", {
      p_business_id: business.id,
      p_service_id: input.serviceId,
      p_staff_id: assigned,
      p_starts_at: input.startsAt,
      p_customer_name: input.name,
      p_customer_email: input.email,
      p_customer_phone: input.phone || null,
      p_customer_note: input.note || null,
      p_manage_token_hash: token.hash,
      p_manage_token_nonce: token.nonce,
    });
    if (error) {
      const mapped = fromDbError(error);
      if (mapped.code === "slot_taken" && !preferred && attempt === 0) continue;
      throw mapped;
    }
    const appt = data as Appointment;
    return {
      appointmentId: appt.id,
      manageUrl: `${env.NEXT_PUBLIC_SITE_URL}/gestisci/${token.token}`,
      startsAt: appt.starts_at,
      endsAt: appt.ends_at,
      serviceName: appt.service_name,
      priceCents: appt.price_cents,
      staffName: staff.find((s) => s.id === appt.staff_id)?.display_name ?? "",
    };
  }
  throw new BookingError("slot_taken");
}

// ---------------------------------------------------------------------------
// Self-service management through the secret link
// ---------------------------------------------------------------------------
export interface ManagedAppointment {
  id: string;
  status: AppointmentStatus;
  startsAt: string;
  endsAt: string;
  serviceId: string;
  serviceName: string;
  priceCents: number;
  staffId: string;
  staffName: string;
  customerFirstName: string;
  business: PublicBusiness;
  canModify: boolean;
  modifyDeadline: string;
}

interface ManageRow extends Appointment {
  manage_token_expires_at: string | null;
  customers: { full_name: string } | null;
  staff: { display_name: string } | null;
  businesses: { slug: string } | null;
}

async function loadByToken(token: string): Promise<{ row: ManageRow; business: PublicBusiness } | null> {
  if (!isWellFormedToken(token)) return null;
  const db = createAdminClient();
  const { data, error } = await db
    .from("appointments")
    .select("*, customers(full_name), staff(display_name), businesses(slug)")
    .eq("manage_token_hash", hashToken(token))
    .maybeSingle();
  if (error) throw new BookingError("unavailable");
  if (!data) return null;
  const row = data as unknown as ManageRow;
  // Links stop working a week after the appointment
  if (Date.parse(row.starts_at) < Date.now() - 7 * 86_400_000) return null;
  const catalog = row.businesses ? await getPublicCatalog(row.businesses.slug) : null;
  if (!catalog) return null;
  return { row, business: catalog.business };
}

function modifiable(row: ManageRow, business: PublicBusiness, now = Date.now()) {
  const deadline = Date.parse(row.starts_at) - business.cancellation_cutoff_hours * 3_600_000;
  const tokenValid = row.manage_token_expires_at !== null && Date.parse(row.manage_token_expires_at) > now;
  return { canModify: row.status === "confirmed" && tokenValid && now < deadline, deadline };
}

export async function getManagedAppointment(token: string): Promise<ManagedAppointment | null> {
  const found = await loadByToken(token);
  if (!found) return null;
  const { row, business } = found;
  const { canModify, deadline } = modifiable(row, business);
  return {
    id: row.id,
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    serviceId: row.service_id,
    serviceName: row.service_name,
    priceCents: row.price_cents,
    staffId: row.staff_id,
    staffName: row.staff?.display_name ?? "",
    customerFirstName: (row.customers?.full_name ?? "").split(" ")[0] ?? "",
    business,
    canModify,
    modifyDeadline: new Date(deadline).toISOString(),
  };
}

async function requireModifiable(token: string, clientKey: string) {
  const db = createAdminClient();
  if (!(await isAllowed(db, RATE_LIMITS.manage, clientKey))) throw new BookingError("rate_limited");
  const found = await loadByToken(token);
  if (!found) throw new BookingError("not_found");
  const { canModify } = modifiable(found.row, found.business);
  if (found.row.status !== "confirmed") throw new BookingError("not_modifiable");
  if (!canModify) throw new BookingError("too_late");
  return { db, ...found };
}

export async function cancelByToken(token: string, reason: string | undefined, clientKey: string): Promise<void> {
  const { db, row } = await requireModifiable(token, clientKey);
  const { error } = await db.rpc("cancel_appointment", { p_appointment_id: row.id, p_reason: reason ?? null });
  if (error) throw fromDbError(error);
}

export async function availabilityForToken(token: string, from: LocalDate, days: number, clientKey: string): Promise<PublicAvailability> {
  const { db, row, business } = await requireModifiable(token, clientKey);
  const start = from < todayIn(business.timezone) ? todayIn(business.timezone) : from;
  try {
    const { query } = await loadAvailabilityQuery(db, business, {
      serviceId: row.service_id,
      staffId: row.staff_id,
      from: start,
      to: addDays(start, days - 1),
      includeInactiveService: true,
      excludeAppointmentId: row.id,
    });
    // Same service duration as originally booked
    query.durationMinutes = Math.round((Date.parse(row.ends_at) - Date.parse(row.starts_at)) / 60_000);
    query.bufferMinutes = Math.round((Date.parse(row.blocked_until) - Date.parse(row.ends_at)) / 60_000);
    return { timezone: business.timezone, days: computeAvailability(query) as DayAvailability[] };
  } catch (err) {
    mapAvailabilityError(err);
  }
}

export async function rescheduleByToken(token: string, startsAt: string, clientKey: string): Promise<{ startsAt: string }> {
  const { db, row, business } = await requireModifiable(token, clientKey);
  const date = localDateOf(startsAt, business.timezone);
  let ok: string | null;
  try {
    const { query } = await loadAvailabilityQuery(db, business, {
      serviceId: row.service_id,
      staffId: row.staff_id,
      from: date,
      to: date,
      includeInactiveService: true,
      excludeAppointmentId: row.id,
    });
    query.durationMinutes = Math.round((Date.parse(row.ends_at) - Date.parse(row.starts_at)) / 60_000);
    query.bufferMinutes = Math.round((Date.parse(row.blocked_until) - Date.parse(row.ends_at)) / 60_000);
    ok = resolveSlot(query, startsAt, row.staff_id);
  } catch (err) {
    mapAvailabilityError(err);
  }
  if (!ok) throw new BookingError("slot_taken");
  const { data, error } = await db.rpc("reschedule_appointment", { p_appointment_id: row.id, p_starts_at: startsAt });
  if (error) throw fromDbError(error);
  return { startsAt: (data as Appointment).starts_at };
}
