"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { refresh, updateTag } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { computeAvailability, resolveSlot } from "@/lib/booking/availability";
import { localDateOf, localToEpoch, timeToMinutes } from "@/lib/booking/time";
import { createAdminClient } from "@/lib/supabase/admin";
import { createUserClient } from "@/lib/supabase/server";
import type { Appointment } from "@/lib/types";
import {
  adminBookingSchema,
  businessSettingsSchema,
  dateOverrideSchema,
  email as emailSchema,
  firstError,
  localDate,
  phone as phoneSchema,
  serviceFormSchema,
  staffFormSchema,
  timeBlockSchema,
  uuid,
  weeklyHoursSchema,
} from "@/lib/validation";
import { ACTIVE_BUSINESS_COOKIE, canManage, ForbiddenError, memberForAction, type MemberContext } from "@/server/auth";
import { AvailabilityError, loadAvailabilityQuery } from "@/server/availability";
import { BookingError, fromDbError } from "@/server/errors";
import { runNotificationWorker } from "@/server/notifications/supabase-store";
import { businessTag } from "@/server/public";
import { isAllowed, RATE_LIMITS } from "@/server/rate-limit";
import { ipKey } from "@/server/request";

export type ActionResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string };

function fail(err: unknown): { ok: false; error: string } {
  if (err instanceof ForbiddenError) return { ok: false, error: "Non hai i permessi per questa operazione." };
  if (err instanceof BookingError) return { ok: false, error: err.message };
  if (err instanceof z.ZodError) return { ok: false, error: firstError(err) };
  if (err instanceof AvailabilityError) return { ok: false, error: "Servizio o professionista non trovato." };
  console.error("[admin] action failed", err instanceof Error ? err.message : err);
  return { ok: false, error: "Operazione non riuscita. Riprova." };
}

function sendNotificationsSoon() {
  after(() => runNotificationWorker({ limit: 10 }).catch(() => undefined));
}

function invalidatePublic(ctx: MemberContext) {
  updateTag(businessTag(ctx.business.slug));
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
export async function login(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = z
    .object({ email: emailSchema, password: z.string().min(1, "Inserisci la password").max(200) })
    .safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const allowed = await isAllowed(createAdminClient(), RATE_LIMITS.login, ipKey(await headers()));
  if (!allowed) return { ok: false, error: "Troppi tentativi. Riprova tra qualche minuto." };

  const db = await createUserClient();
  const { error } = await db.auth.signInWithPassword(parsed.data);
  if (error) return { ok: false, error: "Email o password non corretti." };
  redirect("/admin");
}

export async function logout() {
  const db = await createUserClient();
  await db.auth.signOut();
  (await cookies()).delete(ACTIVE_BUSINESS_COOKIE);
  redirect("/admin/login");
}

export async function switchBusiness(businessId: string) {
  const ctx = await memberForAction();
  if (!ctx.memberships.some((m) => m.business_id === businessId)) return;
  (await cookies()).set(ACTIVE_BUSINESS_COOKIE, businessId, { httpOnly: true, sameSite: "lax", secure: true, path: "/admin" });
  redirect("/admin");
}

export async function changePassword(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    await memberForAction();
    const password = z
      .string()
      .min(10, "La password deve avere almeno 10 caratteri")
      .max(200)
      .parse(formData.get("password"));
    const db = await createUserClient();
    const { error } = await db.auth.updateUser({ password });
    if (error) return { ok: false, error: "Impossibile aggiornare la password." };
    return { ok: true, message: "Password aggiornata." };
  } catch (err) {
    return fail(err);
  }
}

// ---------------------------------------------------------------------------
// Availability for admin tools
// ---------------------------------------------------------------------------
export async function adminSlots(input: {
  serviceId: string;
  staffId: string;
  date: string;
  excludeAppointmentId?: string;
}): Promise<ActionResult<{ start: string }[]>> {
  try {
    const ctx = await memberForAction();
    const p = z.object({ serviceId: uuid, staffId: uuid, date: localDate, excludeAppointmentId: uuid.optional() }).parse(input);
    const { query } = await loadAvailabilityQuery(ctx.db, ctx.business, {
      serviceId: p.serviceId,
      staffId: p.staffId,
      from: p.date,
      to: p.date,
      includeInactiveService: true,
      ignoreBookingWindow: true,
      excludeAppointmentId: p.excludeAppointmentId,
    });
    if (p.excludeAppointmentId) {
      const { data: appt } = await ctx.db.from("appointments").select("starts_at, ends_at, blocked_until").eq("id", p.excludeAppointmentId).single();
      if (appt) {
        query.durationMinutes = Math.round((Date.parse(appt.ends_at) - Date.parse(appt.starts_at)) / 60_000);
        query.bufferMinutes = Math.round((Date.parse(appt.blocked_until) - Date.parse(appt.ends_at)) / 60_000);
      }
    }
    const [day] = computeAvailability(query);
    // Past times are only useful to record walk-ins: hide them for today
    const now = Date.now();
    return { ok: true, data: (day?.slots ?? []).filter((s) => Date.parse(s.start) > now - 30 * 60_000).map((s) => ({ start: s.start })) };
  } catch (err) {
    return fail(err);
  }
}

/** Converts a local date + "HH:MM" in the business timezone to an ISO instant */
function localIso(ctx: MemberContext, date: string, time: string): string {
  return new Date(localToEpoch(date, timeToMinutes(time), ctx.business.timezone)).toISOString();
}

// ---------------------------------------------------------------------------
// Appointments
// ---------------------------------------------------------------------------
export async function createAppointmentAction(input: z.input<typeof adminBookingSchema>): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await memberForAction();
    const p = adminBookingSchema.parse(input);
    if (!p.customerId && !p.name) throw new BookingError("invalid_input", "Inserisci il nome del cliente.");

    if (!p.allowOverride) {
      const date = localDateOf(p.startsAt, ctx.business.timezone);
      const { query } = await loadAvailabilityQuery(ctx.db, ctx.business, {
        serviceId: p.serviceId,
        staffId: p.staffId,
        from: date,
        to: date,
        includeInactiveService: true,
        ignoreBookingWindow: true,
      });
      if (!resolveSlot(query, p.startsAt, p.staffId)) {
        throw new BookingError("slot_taken", "Orario fuori disponibilità o già occupato. Attiva “Ignora orari” per forzarlo (le sovrapposizioni restano vietate).");
      }
    }

    const { data, error } = await ctx.db.rpc("create_appointment", {
      p_business_id: ctx.business.id,
      p_service_id: p.serviceId,
      p_staff_id: p.staffId,
      p_starts_at: p.startsAt,
      p_customer_id: p.customerId ?? null,
      p_customer_name: p.name ?? null,
      p_customer_email: p.email || null,
      p_customer_phone: p.phone || null,
      p_customer_note: p.note || null,
      p_allow_override: p.allowOverride,
    });
    if (error) throw fromDbError(error);
    sendNotificationsSoon();
    return { ok: true, data: { id: (data as Appointment).id } };
  } catch (err) {
    return fail(err);
  }
}

export async function rescheduleAppointmentAction(input: {
  id: string;
  date: string;
  time: string;
  staffId: string;
  allowOverride: boolean;
}): Promise<ActionResult> {
  try {
    const ctx = await memberForAction();
    const p = z
      .object({ id: uuid, date: localDate, time: z.string().regex(/^\d{2}:\d{2}$/), staffId: uuid, allowOverride: z.boolean() })
      .parse(input);
    const startsAt = localIso(ctx, p.date, p.time);

    if (!p.allowOverride) {
      const { data: appt } = await ctx.db.from("appointments").select("*").eq("id", p.id).single();
      if (!appt) throw new BookingError("not_found");
      const a = appt as Appointment;
      const { query } = await loadAvailabilityQuery(ctx.db, ctx.business, {
        serviceId: a.service_id,
        staffId: p.staffId,
        from: p.date,
        to: p.date,
        includeInactiveService: true,
        ignoreBookingWindow: true,
        excludeAppointmentId: a.id,
      });
      query.durationMinutes = Math.round((Date.parse(a.ends_at) - Date.parse(a.starts_at)) / 60_000);
      query.bufferMinutes = Math.round((Date.parse(a.blocked_until) - Date.parse(a.ends_at)) / 60_000);
      if (!resolveSlot(query, startsAt, p.staffId)) {
        throw new BookingError("slot_taken", "Orario fuori disponibilità o già occupato. Attiva “Ignora orari” per forzarlo.");
      }
    }

    const { error } = await ctx.db.rpc("reschedule_appointment", {
      p_appointment_id: p.id,
      p_starts_at: startsAt,
      p_staff_id: p.staffId,
      p_allow_override: p.allowOverride,
    });
    if (error) throw fromDbError(error);
    sendNotificationsSoon();
    refresh();
    return { ok: true, message: "Appuntamento spostato. Il cliente riceverà un'email." };
  } catch (err) {
    return fail(err);
  }
}

export async function cancelAppointmentAction(input: { id: string; reason?: string; notifyCustomer: boolean }): Promise<ActionResult> {
  try {
    const ctx = await memberForAction();
    const p = z.object({ id: uuid, reason: z.string().trim().max(300).optional(), notifyCustomer: z.boolean() }).parse(input);
    const { error } = await ctx.db.rpc("cancel_appointment", {
      p_appointment_id: p.id,
      p_reason: p.reason || null,
      p_notify_customer: p.notifyCustomer,
    });
    if (error) throw fromDbError(error);
    sendNotificationsSoon();
    refresh();
    return { ok: true, message: "Appuntamento annullato." };
  } catch (err) {
    return fail(err);
  }
}

export async function setStatusAction(input: { id: string; status: "confirmed" | "completed" | "no_show" }): Promise<ActionResult> {
  try {
    const ctx = await memberForAction();
    const p = z.object({ id: uuid, status: z.enum(["confirmed", "completed", "no_show"]) }).parse(input);
    const { error } = await ctx.db.rpc("set_appointment_status", { p_appointment_id: p.id, p_status: p.status });
    if (error) throw fromDbError(error);
    refresh();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function searchCustomersAction(q: string): Promise<ActionResult<{ id: string; full_name: string; email: string | null; phone: string | null }[]>> {
  try {
    const ctx = await memberForAction();
    const term = z.string().trim().min(2).max(80).parse(q).replace(/[%_,()]/g, " ");
    const { data, error } = await ctx.db
      .from("customers")
      .select("id, full_name, email, phone")
      .eq("business_id", ctx.business.id)
      .or(`full_name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%`)
      .order("full_name")
      .limit(8);
    if (error) throw error;
    return { ok: true, data: data ?? [] };
  } catch (err) {
    return fail(err);
  }
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------
export async function updateCustomerAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await memberForAction();
    const p = z
      .object({
        id: uuid,
        full_name: z.string().trim().min(1, "Nome obbligatorio").max(120),
        email: z.union([emailSchema, z.literal("")]),
        phone: z.union([phoneSchema, z.literal("")]),
        notes: z.string().trim().max(1000),
      })
      .parse(Object.fromEntries(formData));
    const { error } = await ctx.db
      .from("customers")
      .update({ full_name: p.full_name, email: p.email || null, phone: p.phone || null, notes: p.notes || null })
      .eq("id", p.id)
      .eq("business_id", ctx.business.id);
    if (error) {
      if (error.code === "23505") return { ok: false, error: "Esiste già un cliente con questa email." };
      throw error;
    }
    refresh();
    return { ok: true, message: "Cliente aggiornato." };
  } catch (err) {
    return fail(err);
  }
}

/** GDPR erasure request: personal data removed, appointments kept anonymously for statistics. */
export async function anonymizeCustomerAction(id: string): Promise<ActionResult> {
  try {
    const ctx = await memberForAction("admin");
    uuid.parse(id);
    const { error } = await ctx.db
      .from("customers")
      .update({ full_name: "Cliente anonimizzato", email: null, phone: null, notes: null })
      .eq("id", id)
      .eq("business_id", ctx.business.id);
    if (error) throw error;
    await ctx.db.from("appointments").update({ customer_note: null }).eq("customer_id", id).eq("business_id", ctx.business.id);
    refresh();
    return { ok: true, message: "Dati personali cancellati." };
  } catch (err) {
    return fail(err);
  }
}

// ---------------------------------------------------------------------------
// Services & staff (owner/admin)
// ---------------------------------------------------------------------------
export async function saveServiceAction(id: string | null, input: z.input<typeof serviceFormSchema>): Promise<ActionResult> {
  try {
    const ctx = await memberForAction("admin");
    const p = serviceFormSchema.parse(input);
    const row = {
      name: p.name,
      description: p.description,
      price_cents: p.price,
      duration_minutes: p.duration_minutes,
      buffer_after_minutes: p.buffer_after_minutes,
      is_active: p.is_active,
    };
    let serviceId = id;
    if (id) {
      const { error } = await ctx.db.from("services").update(row).eq("id", id).eq("business_id", ctx.business.id);
      if (error) throw error;
    } else {
      const { count } = await ctx.db.from("services").select("id", { count: "exact", head: true }).eq("business_id", ctx.business.id);
      const { data, error } = await ctx.db
        .from("services")
        .insert({ ...row, business_id: ctx.business.id, sort_order: (count ?? 0) + 1 })
        .select("id")
        .single();
      if (error) throw error;
      serviceId = data.id;
    }
    // Replace staff assignments
    const del = await ctx.db.from("staff_services").delete().eq("service_id", serviceId!).eq("business_id", ctx.business.id);
    if (del.error) throw del.error;
    if (p.staff_ids.length) {
      const ins = await ctx.db
        .from("staff_services")
        .insert(p.staff_ids.map((staff_id) => ({ business_id: ctx.business.id, staff_id, service_id: serviceId })));
      if (ins.error) throw ins.error;
    }
    invalidatePublic(ctx);
    refresh();
    return { ok: true, message: "Servizio salvato." };
  } catch (err) {
    return fail(err);
  }
}

export async function moveServiceAction(id: string, direction: -1 | 1): Promise<ActionResult> {
  try {
    const ctx = await memberForAction("admin");
    const { data } = await ctx.db.from("services").select("id, sort_order").eq("business_id", ctx.business.id).order("sort_order").order("name");
    const list = (data ?? []) as { id: string; sort_order: number }[];
    const i = list.findIndex((s) => s.id === id);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= list.length) return { ok: true };
    [list[i], list[j]] = [list[j]!, list[i]!];
    await Promise.all(list.map((s, idx) => ctx.db.from("services").update({ sort_order: idx + 1 }).eq("id", s.id)));
    invalidatePublic(ctx);
    refresh();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function saveStaffAction(id: string | null, input: z.input<typeof staffFormSchema> & { avatar_url?: string | null }): Promise<ActionResult> {
  try {
    const ctx = await memberForAction("admin");
    const p = staffFormSchema.parse(input);
    const avatar = input.avatar_url === undefined ? undefined : z.string().max(500).nullable().parse(input.avatar_url || null);
    const row = { display_name: p.display_name, bio: p.bio, is_active: p.is_active, ...(avatar !== undefined ? { avatar_url: avatar } : {}) };
    if (id) {
      const { error } = await ctx.db.from("staff").update(row).eq("id", id).eq("business_id", ctx.business.id);
      if (error) throw error;
    } else {
      const { count } = await ctx.db.from("staff").select("id", { count: "exact", head: true }).eq("business_id", ctx.business.id);
      const { data, error } = await ctx.db
        .from("staff")
        .insert({ ...row, business_id: ctx.business.id, sort_order: (count ?? 0) + 1 })
        .select("id")
        .single();
      if (error) throw error;
      // A new team member can perform every active service by default
      const { data: services } = await ctx.db.from("services").select("id").eq("business_id", ctx.business.id).eq("is_active", true);
      if (services?.length) {
        await ctx.db.from("staff_services").insert(services.map((s) => ({ business_id: ctx.business.id, staff_id: data.id, service_id: s.id })));
      }
    }
    invalidatePublic(ctx);
    refresh();
    return { ok: true, message: "Salvato." };
  } catch (err) {
    return fail(err);
  }
}

// ---------------------------------------------------------------------------
// Opening hours, overrides, time blocks
// ---------------------------------------------------------------------------
export async function saveWeeklyHoursAction(input: z.input<typeof weeklyHoursSchema>): Promise<ActionResult> {
  try {
    const ctx = await memberForAction("admin");
    const p = weeklyHoursSchema.parse(input);
    for (const day of p.days) {
      const sorted = [...day.intervals].sort((a, b) => a.start.localeCompare(b.start));
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i]!.start < sorted[i - 1]!.end) throw new BookingError("invalid_input", "Gli intervalli dello stesso giorno non possono sovrapporsi.");
      }
    }
    let del = ctx.db.from("working_hours").delete().eq("business_id", ctx.business.id);
    del = p.staffId ? del.eq("staff_id", p.staffId) : del.is("staff_id", null);
    const { error: dErr } = await del;
    if (dErr) throw dErr;
    const rows = p.days.flatMap((d) =>
      d.intervals.map((i) => ({ business_id: ctx.business.id, staff_id: p.staffId, weekday: d.weekday, start_time: i.start, end_time: i.end })),
    );
    if (rows.length) {
      const { error } = await ctx.db.from("working_hours").insert(rows);
      if (error) throw error;
    }
    invalidatePublic(ctx);
    refresh();
    return { ok: true, message: "Orari salvati." };
  } catch (err) {
    return fail(err);
  }
}

export async function clearStaffHoursAction(staffId: string): Promise<ActionResult> {
  try {
    const ctx = await memberForAction("admin");
    uuid.parse(staffId);
    const { error } = await ctx.db.from("working_hours").delete().eq("business_id", ctx.business.id).eq("staff_id", staffId);
    if (error) throw error;
    refresh();
    return { ok: true, message: "Ora segue gli orari del negozio." };
  } catch (err) {
    return fail(err);
  }
}

export async function addDateOverrideAction(input: z.input<typeof dateOverrideSchema>): Promise<ActionResult> {
  try {
    const ctx = await memberForAction("admin");
    const p = dateOverrideSchema.parse(input);
    let del = ctx.db.from("date_overrides").delete().eq("business_id", ctx.business.id).eq("date", p.date);
    del = p.staffId ? del.eq("staff_id", p.staffId) : del.is("staff_id", null);
    await del;
    const rows = p.isClosed
      ? [{ business_id: ctx.business.id, staff_id: p.staffId, date: p.date, is_closed: true, note: p.note ?? null }]
      : p.intervals.map((i) => ({
          business_id: ctx.business.id,
          staff_id: p.staffId,
          date: p.date,
          is_closed: false,
          start_time: i.start,
          end_time: i.end,
          note: p.note ?? null,
        }));
    const { error } = await ctx.db.from("date_overrides").insert(rows);
    if (error) throw error;
    refresh();
    return { ok: true, message: "Eccezione salvata." };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteDateOverrideAction(input: { date: string; staffId: string | null }): Promise<ActionResult> {
  try {
    const ctx = await memberForAction("admin");
    const p = z.object({ date: localDate, staffId: uuid.nullable() }).parse(input);
    let del = ctx.db.from("date_overrides").delete().eq("business_id", ctx.business.id).eq("date", p.date);
    del = p.staffId ? del.eq("staff_id", p.staffId) : del.is("staff_id", null);
    const { error } = await del;
    if (error) throw error;
    refresh();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function addTimeBlockAction(input: {
  staffId: string | null;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  reason?: string;
}): Promise<ActionResult> {
  try {
    const ctx = await memberForAction();
    const raw = z
      .object({
        staffId: uuid.nullable(),
        startDate: localDate,
        startTime: z.string().regex(/^\d{2}:\d{2}$/),
        endDate: localDate,
        endTime: z.string().regex(/^\d{2}:\d{2}$/),
        reason: z.string().trim().max(200).optional(),
      })
      .parse(input);
    const p = timeBlockSchema.parse({
      staffId: raw.staffId,
      startsAt: localIso(ctx, raw.startDate, raw.startTime),
      endsAt: localIso(ctx, raw.endDate, raw.endTime === "00:00" && raw.endDate === raw.startDate ? "24:00" : raw.endTime),
      reason: raw.reason,
    });
    const { error } = await ctx.db.from("time_blocks").insert({
      business_id: ctx.business.id,
      staff_id: p.staffId,
      starts_at: p.startsAt,
      ends_at: p.endsAt,
      reason: p.reason ?? null,
      created_by: ctx.user.id,
    });
    if (error) throw error;

    // Warn about appointments already booked inside the block (they are NOT cancelled automatically)
    let q = ctx.db
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("business_id", ctx.business.id)
      .eq("status", "confirmed")
      .lt("starts_at", p.endsAt)
      .gt("ends_at", p.startsAt);
    if (p.staffId) q = q.eq("staff_id", p.staffId);
    const { count } = await q;
    refresh();
    return {
      ok: true,
      message: count
        ? `Blocco salvato. Attenzione: ci sono ${count} appuntamenti già prenotati in quel periodo, gestiscili dal calendario.`
        : "Blocco salvato.",
    };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteTimeBlockAction(id: string): Promise<ActionResult> {
  try {
    const ctx = await memberForAction();
    uuid.parse(id);
    const { error } = await ctx.db.from("time_blocks").delete().eq("id", id).eq("business_id", ctx.business.id);
    if (error) throw error;
    refresh();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

// ---------------------------------------------------------------------------
// Settings & branding
// ---------------------------------------------------------------------------
export async function saveSettingsAction(input: z.input<typeof businessSettingsSchema>): Promise<ActionResult> {
  try {
    const ctx = await memberForAction("admin");
    const { accent, ...rest } = businessSettingsSchema.parse(input);
    const theme = { ...(ctx.business.theme ?? {}), accent };
    const { error } = await ctx.db.from("businesses").update({ ...rest, theme }).eq("id", ctx.business.id);
    if (error) throw error;
    invalidatePublic(ctx);
    refresh();
    return { ok: true, message: "Impostazioni salvate." };
  } catch (err) {
    return fail(err);
  }
}

const IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif" };

/** Uploads an image to Supabase Storage under <business_id>/ (RLS-protected bucket). */
export async function uploadImageAction(formData: FormData): Promise<ActionResult<{ url: string }>> {
  try {
    const ctx = await memberForAction("admin");
    const file = formData.get("file");
    const target = z.enum(["logo", "cover", "gallery", "staff"]).parse(formData.get("target"));
    if (!(file instanceof File)) throw new BookingError("invalid_input", "Nessun file selezionato.");
    const ext = IMAGE_TYPES[file.type];
    if (!ext) throw new BookingError("invalid_input", "Formato non supportato: usa JPG, PNG, WebP o AVIF.");
    if (file.size > 5 * 1024 * 1024) throw new BookingError("invalid_input", "Immagine troppo grande (massimo 5 MB).");

    const path = `${ctx.business.id}/${target}-${crypto.randomUUID()}.${ext}`;
    const { error } = await ctx.db.storage.from("business-assets").upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw new BookingError("unavailable", "Caricamento non riuscito. Verifica che lo storage sia configurato.");
    const { data } = ctx.db.storage.from("business-assets").getPublicUrl(path);

    if (target === "logo" || target === "cover") {
      await ctx.db.from("businesses").update(target === "logo" ? { logo_url: data.publicUrl } : { cover_image_url: data.publicUrl }).eq("id", ctx.business.id);
    } else if (target === "gallery") {
      await ctx.db.from("businesses").update({ gallery: [...(ctx.business.gallery ?? []), data.publicUrl].slice(0, 12) }).eq("id", ctx.business.id);
    }
    invalidatePublic(ctx);
    refresh();
    return { ok: true, data: { url: data.publicUrl } };
  } catch (err) {
    return fail(err);
  }
}

export async function removeGalleryImageAction(url: string): Promise<ActionResult> {
  try {
    const ctx = await memberForAction("admin");
    const gallery = (ctx.business.gallery ?? []).filter((g) => g !== url);
    const { error } = await ctx.db.from("businesses").update({ gallery }).eq("id", ctx.business.id);
    if (error) throw error;
    invalidatePublic(ctx);
    refresh();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function retryFailedNotificationsAction(): Promise<ActionResult> {
  try {
    const ctx = await memberForAction("admin");
    if (!canManage(ctx.role)) throw new ForbiddenError();
    const { error } = await ctx.db
      .from("notifications")
      .update({ status: "pending", attempts: 0, scheduled_for: new Date().toISOString(), last_error: null })
      .eq("business_id", ctx.business.id)
      .eq("status", "failed");
    if (error) throw error;
    sendNotificationsSoon();
    refresh();
    return { ok: true, message: "Nuovo tentativo avviato." };
  } catch (err) {
    return fail(err);
  }
}
