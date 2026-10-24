/**
 * Availability engine — pure, deterministic, no I/O.
 *
 * Given the schedule configuration and what is already busy, it returns the
 * start times a service can be booked at. The same function is used to render
 * slots in the browser API and to re-validate a booking on the server right
 * before writing it (the database exclusion constraint is the final guard
 * against concurrent writes).
 */
import {
  addDays,
  eachDate,
  localDateOf,
  localToEpoch,
  timeToMinutes,
  todayIn,
  weekdayOf,
  type LocalDate,
} from "./time";

export interface WeeklyHours {
  staffId: string | null; // null = business opening hours
  weekday: number; // ISO 1..7
  start: string; // "HH:MM"
  end: string; // "HH:MM" (may be "24:00")
}

export interface DateOverride {
  staffId: string | null;
  date: LocalDate;
  isClosed: boolean;
  start?: string | null;
  end?: string | null;
}

export interface BusyRange {
  staffId: string | null; // null = applies to every staff member (business closure)
  start: number; // epoch ms
  end: number; // epoch ms (exclusive)
  appointmentId?: string;
}

export interface BookingRules {
  timezone: string;
  slotIntervalMinutes: number;
  minNoticeMinutes: number;
  maxAdvanceDays: number;
}

export interface AvailabilityQuery {
  rules: BookingRules;
  durationMinutes: number;
  bufferMinutes: number;
  /** Staff members able to perform the service (already filtered for active) */
  staffIds: string[];
  weekly: WeeklyHours[];
  overrides: DateOverride[];
  busy: BusyRange[];
  from: LocalDate;
  to: LocalDate;
  now: Date;
  /** Admin tools may ignore min notice / horizon (never overlaps). */
  ignoreBookingWindow?: boolean;
  /** When rescheduling, the appointment being moved doesn't block itself. */
  excludeAppointmentId?: string;
}

export interface Slot {
  start: string; // ISO instant (UTC)
  staffIds: string[]; // who is free at that time, in preference order
}

export interface DayAvailability {
  date: LocalDate;
  slots: Slot[];
}

type Interval = [number, number]; // minutes from local midnight

function toIntervals(rows: { start?: string | null; end?: string | null }[]): Interval[] {
  return normalize(
    rows
      .filter((r) => r.start && r.end)
      .map((r) => [timeToMinutes(r.start!), timeToMinutes(r.end!)] as Interval)
      .filter(([s, e]) => e > s),
  );
}

/** Sorts and merges overlapping/adjacent intervals */
export function normalize(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const out: Interval[] = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

export function intersect(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const s = Math.max(a[i][0], b[j][0]);
    const e = Math.min(a[i][1], b[j][1]);
    if (e > s) out.push([s, e]);
    if (a[i][1] < b[j][1]) i++;
    else j++;
  }
  return out;
}

/** Opening intervals of the business on a date (overrides win over weekly hours) */
function businessIntervals(q: AvailabilityQuery, date: LocalDate): Interval[] {
  const overrides = q.overrides.filter((o) => o.staffId === null && o.date === date);
  if (overrides.length > 0) {
    if (overrides.some((o) => o.isClosed)) return [];
    return toIntervals(overrides);
  }
  const wd = weekdayOf(date);
  return toIntervals(q.weekly.filter((w) => w.staffId === null && w.weekday === wd));
}

/** Working intervals of a staff member on a date, clipped to business hours */
export function staffIntervals(q: AvailabilityQuery, staffId: string, date: LocalDate): Interval[] {
  const business = businessIntervals(q, date);
  if (business.length === 0) return [];
  const overrides = q.overrides.filter((o) => o.staffId === staffId && o.date === date);
  if (overrides.length > 0) {
    if (overrides.some((o) => o.isClosed)) return [];
    return intersect(business, toIntervals(overrides));
  }
  const hasOwnSchedule = q.weekly.some((w) => w.staffId === staffId);
  if (!hasOwnSchedule) return business;
  const wd = weekdayOf(date);
  return intersect(business, toIntervals(q.weekly.filter((w) => w.staffId === staffId && w.weekday === wd)));
}

function overlapsBusy(busy: BusyRange[], staffId: string, start: number, end: number, excludeId?: string): boolean {
  for (const b of busy) {
    if (b.staffId !== null && b.staffId !== staffId) continue;
    if (excludeId && b.appointmentId === excludeId) continue;
    if (b.start < end && start < b.end) return true;
  }
  return false;
}

/** The [earliest, latest] instants bookable under the rules */
function bookingWindow(q: AvailabilityQuery): { earliest: number; lastDate: LocalDate } {
  if (q.ignoreBookingWindow) return { earliest: -Infinity, lastDate: "9999-12-31" };
  return {
    earliest: q.now.getTime() + q.rules.minNoticeMinutes * 60_000,
    lastDate: addDays(todayIn(q.rules.timezone, q.now), q.rules.maxAdvanceDays),
  };
}

export function computeAvailability(q: AvailabilityQuery): DayAvailability[] {
  const zone = q.rules.timezone;
  const durationMs = q.durationMinutes * 60_000;
  const blockedMs = (q.durationMinutes + q.bufferMinutes) * 60_000;
  const stepMs = q.rules.slotIntervalMinutes * 60_000;
  const { earliest, lastDate } = bookingWindow(q);
  const today = todayIn(zone, q.now);
  const from = q.ignoreBookingWindow || q.from > today ? q.from : today;
  const to = q.to < lastDate ? q.to : lastDate;
  if (from > to || q.staffIds.length === 0) return from > to ? [] : eachDate(from, to).map((date) => ({ date, slots: [] }));

  // Spread load: staff with fewer appointments that day are offered first
  const loadByDay = new Map<string, number>();
  for (const b of q.busy) {
    if (!b.appointmentId || !b.staffId || b.appointmentId === q.excludeAppointmentId) continue;
    const key = `${b.staffId}|${localDateOf(b.start, zone)}`;
    loadByDay.set(key, (loadByDay.get(key) ?? 0) + 1);
  }

  return eachDate(from, to).map((date) => {
    const byStart = new Map<number, string[]>();
    const staffOrder = [...q.staffIds].sort(
      (a, b) => (loadByDay.get(`${a}|${date}`) ?? 0) - (loadByDay.get(`${b}|${date}`) ?? 0),
    );
    for (const staffId of staffOrder) {
      for (const [s, e] of staffIntervals(q, staffId, date)) {
        const intervalStart = localToEpoch(date, s, zone);
        const intervalEnd = localToEpoch(date, e, zone);
        for (let t = intervalStart; t + durationMs <= intervalEnd; t += stepMs) {
          if (t < earliest) continue;
          if (overlapsBusy(q.busy, staffId, t, t + blockedMs, q.excludeAppointmentId)) continue;
          const list = byStart.get(t);
          if (list) list.push(staffId);
          else byStart.set(t, [staffId]);
        }
      }
    }
    const slots = [...byStart.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([t, staffIds]) => ({ start: new Date(t).toISOString(), staffIds }));
    return { date, slots };
  });
}

/**
 * Server-side re-validation of a single requested start time.
 * Returns the staff member to assign (the preferred one if free), or null.
 */
export function resolveSlot(
  q: Omit<AvailabilityQuery, "from" | "to">,
  startIso: string,
  preferredStaffId: string | null,
): string | null {
  const start = Date.parse(startIso);
  if (Number.isNaN(start)) return null;
  const date = localDateOf(start, q.rules.timezone);
  const staffIds = preferredStaffId ? q.staffIds.filter((id) => id === preferredStaffId) : q.staffIds;
  if (staffIds.length === 0) return null;
  const [day] = computeAvailability({ ...q, staffIds, from: date, to: date });
  const slot = day?.slots.find((s) => Date.parse(s.start) === start);
  return slot?.staffIds[0] ?? null;
}
