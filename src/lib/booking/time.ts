import { DateTime } from "luxon";

/** "YYYY-MM-DD" local calendar date */
export type LocalDate = string;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-4]):([0-5]\d)(:[0-5]\d)?$/;

export function isLocalDate(value: string): value is LocalDate {
  return DATE_RE.test(value) && DateTime.fromISO(value).isValid;
}

/** Minutes from local midnight for "HH:MM" or "HH:MM:SS". "24:00" = 1440. */
export function timeToMinutes(value: string): number {
  const m = TIME_RE.exec(value);
  if (!m) throw new Error(`Invalid time: ${value}`);
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  if (minutes > 1440) throw new Error(`Invalid time: ${value}`);
  return minutes;
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Converts a wall-clock time on a local date to an absolute instant (epoch ms),
 * respecting the zone's DST rules. 1440 minutes = midnight of the next day.
 */
export function localToEpoch(date: LocalDate, minutes: number, zone: string): number {
  const day = DateTime.fromISO(date, { zone });
  if (minutes === 1440) {
    return day.plus({ days: 1 }).startOf("day").toMillis();
  }
  return DateTime.fromObject(
    { year: day.year, month: day.month, day: day.day, hour: Math.floor(minutes / 60), minute: minutes % 60 },
    { zone },
  ).toMillis();
}

/** ISO weekday (1 = Monday ... 7 = Sunday) of a local date */
export function weekdayOf(date: LocalDate): number {
  return DateTime.fromISO(date).weekday;
}

export function todayIn(zone: string, now: Date = new Date()): LocalDate {
  return DateTime.fromJSDate(now, { zone }).toISODate()!;
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return DateTime.fromISO(date).plus({ days }).toISODate()!;
}

export function eachDate(from: LocalDate, to: LocalDate): LocalDate[] {
  const out: LocalDate[] = [];
  let cur = DateTime.fromISO(from);
  const end = DateTime.fromISO(to);
  while (cur <= end) {
    out.push(cur.toISODate()!);
    cur = cur.plus({ days: 1 });
  }
  return out;
}

export function localDateOf(epochOrIso: number | string | Date, zone: string): LocalDate {
  return toZoned(epochOrIso, zone).toISODate()!;
}

export function toZoned(value: number | string | Date, zone: string): DateTime {
  if (typeof value === "number") return DateTime.fromMillis(value, { zone });
  if (typeof value === "string") return DateTime.fromISO(value, { zone });
  return DateTime.fromJSDate(value, { zone });
}

/** Local "HH:mm" of an instant */
export function formatTime(value: number | string | Date, zone: string): string {
  return toZoned(value, zone).toFormat("HH:mm");
}

/** e.g. "sabato 14 novembre 2026" */
export function formatLongDate(value: number | string | Date, zone: string, locale = "it"): string {
  return toZoned(value, zone).setLocale(locale).toFormat("cccc d LLLL yyyy");
}

/** e.g. "sab 14 nov" */
export function formatShortDate(value: number | string | Date, zone: string, locale = "it"): string {
  return toZoned(value, zone).setLocale(locale).toFormat("ccc d LLL");
}

/** Range [start, end) in epoch ms covering a whole local date */
export function localDayRange(date: LocalDate, zone: string): { start: number; end: number } {
  return { start: localToEpoch(date, 0, zone), end: localToEpoch(date, 1440, zone) };
}
