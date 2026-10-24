// Browser-safe date helpers that always format in the business timezone,
// whatever the visitor's device timezone is.

export function todayInZone(timeZone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return parts; // en-CA gives YYYY-MM-DD
}

export function addDaysLocal(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + days));
  return dt.toISOString().slice(0, 10);
}

/** Noon UTC of a local date: safe anchor to format weekday/day names */
function anchor(date: string): Date {
  return new Date(`${date}T12:00:00Z`);
}

export function weekdayShort(date: string): string {
  return new Intl.DateTimeFormat("it-IT", { weekday: "short", timeZone: "UTC" }).format(anchor(date)).replace(".", "");
}

export function dayNumber(date: string): string {
  return String(Number(date.slice(8, 10)));
}

export function monthShort(date: string): string {
  return new Intl.DateTimeFormat("it-IT", { month: "short", timeZone: "UTC" }).format(anchor(date)).replace(".", "");
}

export function longDate(date: string): string {
  return new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(anchor(date));
}

export function timeIn(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(new Date(iso));
}

export function longDateTimeIn(iso: string, timeZone: string): string {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "numeric", month: "long", timeZone }).format(d);
  return `${date}, ore ${timeIn(iso, timeZone)}`;
}

export function hourIn(iso: string, timeZone: string): number {
  return Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone }).format(new Date(iso)));
}

export function googleCalendarLink(opts: { title: string; start: string; end: string; location?: string; details?: string; timeZone: string }) {
  const fmt = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const p = new URLSearchParams({
    action: "TEMPLATE",
    text: opts.title,
    dates: `${fmt(opts.start)}/${fmt(opts.end)}`,
    ctz: opts.timeZone,
  });
  if (opts.location) p.set("location", opts.location);
  if (opts.details) p.set("details", opts.details);
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}
