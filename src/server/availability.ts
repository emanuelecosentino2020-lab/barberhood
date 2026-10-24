import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AvailabilityQuery, BusyRange } from "@/lib/booking/availability";
import { addDays, localDayRange, type LocalDate } from "@/lib/booking/time";
import type { DateOverrideRow, Service, WorkingHoursRow } from "@/lib/types";

export interface RulesSource {
  id: string;
  timezone: string;
  slot_interval_minutes: number;
  min_notice_minutes: number;
  max_advance_days: number;
}

export class AvailabilityError extends Error {
  constructor(public readonly code: "service_not_found" | "staff_not_found" | "load_failed") {
    super(code);
  }
}

const hhmm = (t: string) => t.slice(0, 5);

/**
 * Loads everything the availability engine needs for a service and date range.
 * Works with either the privileged client (public flow) or the user client
 * (admin, filtered by RLS). Only time ranges are read from appointments: no
 * customer data ever reaches this code path.
 */
export async function loadAvailabilityQuery(
  db: SupabaseClient,
  business: RulesSource,
  opts: {
    serviceId: string;
    staffId: string | null;
    from: LocalDate;
    to: LocalDate;
    now?: Date;
    includeInactiveService?: boolean;
    ignoreBookingWindow?: boolean;
    excludeAppointmentId?: string;
  },
): Promise<{ query: AvailabilityQuery; service: Service }> {
  const zone = business.timezone;
  const rangeStart = new Date(localDayRange(addDays(opts.from, -1), zone).start).toISOString();
  const rangeEnd = new Date(localDayRange(addDays(opts.to, 1), zone).end).toISOString();

  let serviceQuery = db.from("services").select("*").eq("business_id", business.id).eq("id", opts.serviceId);
  if (!opts.includeInactiveService) serviceQuery = serviceQuery.eq("is_active", true);
  const serviceRes = await serviceQuery.maybeSingle();
  if (serviceRes.error) throw new AvailabilityError("load_failed");
  if (!serviceRes.data) throw new AvailabilityError("service_not_found");
  const service = serviceRes.data as Service;

  const staffRes = await db
    .from("staff_services")
    .select("staff_id, staff!inner(id, is_active, sort_order)")
    .eq("business_id", business.id)
    .eq("service_id", service.id)
    .eq("staff.is_active", true);
  if (staffRes.error) throw new AvailabilityError("load_failed");
  type StaffJoin = { staff_id: string; staff: { sort_order: number } | { sort_order: number }[] };
  const sortOf = (r: StaffJoin) => (Array.isArray(r.staff) ? r.staff[0]?.sort_order : r.staff.sort_order) ?? 0;
  let staffIds = (staffRes.data as StaffJoin[]).sort((a, b) => sortOf(a) - sortOf(b)).map((r) => r.staff_id);
  if (opts.staffId) {
    if (!staffIds.includes(opts.staffId)) throw new AvailabilityError("staff_not_found");
    staffIds = [opts.staffId];
  }

  const [hoursRes, overridesRes, blocksRes, apptRes] = await Promise.all([
    db.from("working_hours").select("staff_id, weekday, start_time, end_time").eq("business_id", business.id),
    db
      .from("date_overrides")
      .select("staff_id, date, is_closed, start_time, end_time")
      .eq("business_id", business.id)
      .gte("date", opts.from)
      .lte("date", opts.to),
    db
      .from("time_blocks")
      .select("staff_id, starts_at, ends_at")
      .eq("business_id", business.id)
      .lt("starts_at", rangeEnd)
      .gt("ends_at", rangeStart),
    staffIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : db
          .from("appointments")
          .select("id, staff_id, starts_at, blocked_until")
          .eq("business_id", business.id)
          .in("staff_id", staffIds)
          .neq("status", "cancelled")
          .lt("starts_at", rangeEnd)
          .gt("blocked_until", rangeStart),
  ]);
  if (hoursRes.error || overridesRes.error || blocksRes.error || apptRes.error) {
    throw new AvailabilityError("load_failed");
  }

  const busy: BusyRange[] = [
    ...(blocksRes.data as { staff_id: string | null; starts_at: string; ends_at: string }[]).map((b) => ({
      staffId: b.staff_id,
      start: Date.parse(b.starts_at),
      end: Date.parse(b.ends_at),
    })),
    ...(apptRes.data as { id: string; staff_id: string; starts_at: string; blocked_until: string }[]).map((a) => ({
      staffId: a.staff_id,
      start: Date.parse(a.starts_at),
      end: Date.parse(a.blocked_until),
      appointmentId: a.id,
    })),
  ];

  const query: AvailabilityQuery = {
    rules: {
      timezone: zone,
      slotIntervalMinutes: business.slot_interval_minutes,
      minNoticeMinutes: business.min_notice_minutes,
      maxAdvanceDays: business.max_advance_days,
    },
    durationMinutes: service.duration_minutes,
    bufferMinutes: service.buffer_after_minutes,
    staffIds,
    weekly: (hoursRes.data as Pick<WorkingHoursRow, "staff_id" | "weekday" | "start_time" | "end_time">[]).map((h) => ({
      staffId: h.staff_id,
      weekday: h.weekday,
      start: hhmm(h.start_time),
      end: hhmm(h.end_time),
    })),
    overrides: (overridesRes.data as Pick<DateOverrideRow, "staff_id" | "date" | "is_closed" | "start_time" | "end_time">[]).map(
      (o) => ({
        staffId: o.staff_id,
        date: o.date,
        isClosed: o.is_closed,
        start: o.start_time ? hhmm(o.start_time) : null,
        end: o.end_time ? hhmm(o.end_time) : null,
      }),
    ),
    busy,
    from: opts.from,
    to: opts.to,
    now: opts.now ?? new Date(),
    ignoreBookingWindow: opts.ignoreBookingWindow,
    excludeAppointmentId: opts.excludeAppointmentId,
  };
  return { query, service };
}
