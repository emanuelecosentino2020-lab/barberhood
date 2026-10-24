import { CalendarPlus, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/admin/page-header";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Card, statusLabel } from "@/components/ui/misc";
import { addDays, eachDate, formatTime, isLocalDate, localDayRange, todayIn, toZoned, weekdayOf } from "@/lib/booking/time";
import { WEEKDAYS_SHORT } from "@/lib/hours";
import type { Staff, TimeBlock } from "@/lib/types";
import { appointmentsBetween, type AppointmentListItem } from "@/server/admin-queries";
import { requireMember } from "@/server/auth";

export const metadata = { title: "Calendario" };

type View = "giorno" | "settimana" | "mese";
const PX_PER_MIN = 1.1;

export default async function CalendarPage({ searchParams }: PageProps<"/admin/calendario">) {
  const ctx = await requireMember();
  const { db, business: b } = ctx;
  const tz = b.timezone;
  const sp = await searchParams;
  const view: View = sp.vista === "settimana" || sp.vista === "mese" ? sp.vista : "giorno";
  const date = typeof sp.data === "string" && isLocalDate(sp.data) ? sp.data : todayIn(tz);
  const staffFilter = typeof sp.staff === "string" ? sp.staff : null;

  // Range for the view
  const d = toZoned(`${date}T12:00:00`, tz);
  let from = date;
  let to = date;
  if (view === "settimana") {
    from = addDays(date, -(weekdayOf(date) - 1));
    to = addDays(from, 6);
  } else if (view === "mese") {
    const first = d.startOf("month").toISODate()!;
    from = addDays(first, -(weekdayOf(first) - 1));
    const last = d.endOf("month").toISODate()!;
    to = addDays(last, 7 - weekdayOf(last));
  }
  const rangeStart = new Date(localDayRange(from, tz).start).toISOString();
  const rangeEnd = new Date(localDayRange(to, tz).end).toISOString();

  const [staffRes, appts, blocksRes, hoursRes] = await Promise.all([
    db.from("staff").select("*").eq("business_id", b.id).eq("is_active", true).order("sort_order"),
    appointmentsBetween(db, b.id, rangeStart, rangeEnd, { staffId: staffFilter, includeCancelled: view === "giorno" }),
    db.from("time_blocks").select("*").eq("business_id", b.id).lt("starts_at", rangeEnd).gt("ends_at", rangeStart),
    db.from("working_hours").select("start_time, end_time").eq("business_id", b.id).is("staff_id", null),
  ]);
  const staff = (staffRes.data ?? []) as Staff[];
  const blocks = (blocksRes.data ?? []) as TimeBlock[];
  const visibleStaff = staffFilter ? staff.filter((s) => s.id === staffFilter) : staff;

  const step = view === "giorno" ? 1 : view === "settimana" ? 7 : 0;
  const prev = view === "mese" ? d.minus({ months: 1 }).toISODate()! : addDays(date, -step);
  const next = view === "mese" ? d.plus({ months: 1 }).toISODate()! : addDays(date, step);
  const href = (patch: Record<string, string | null>) => {
    const params = new URLSearchParams();
    const merged = { vista: view, data: date, staff: staffFilter, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    return `/admin/calendario?${params.toString()}`;
  };

  const title =
    view === "giorno"
      ? d.setLocale("it").toFormat("cccc d LLLL")
      : view === "settimana"
        ? `${toZoned(`${from}T12:00:00`, tz).setLocale("it").toFormat("d LLL")} – ${toZoned(`${to}T12:00:00`, tz).setLocale("it").toFormat("d LLL yyyy")}`
        : d.setLocale("it").toFormat("LLLL yyyy");

  // Visible hours: opening hours, widened to include any appointment
  const hours = (hoursRes.data ?? []) as { start_time: string; end_time: string }[];
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  let dayStartMin = hours.length ? Math.min(...hours.map((h) => toMin(h.start_time))) : 8 * 60;
  let dayEndMin = hours.length ? Math.max(...hours.map((h) => toMin(h.end_time))) : 20 * 60;
  for (const a of appts) {
    const s = toZoned(a.starts_at, tz);
    const e = toZoned(a.ends_at, tz);
    dayStartMin = Math.min(dayStartMin, s.hour * 60 + s.minute);
    dayEndMin = Math.max(dayEndMin, e.hour * 60 + e.minute || 1440);
  }
  dayStartMin = Math.floor(dayStartMin / 60) * 60;
  dayEndMin = Math.min(1440, Math.ceil(dayEndMin / 60) * 60);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Calendario"
        actions={
          <ButtonLink href={`/admin/appuntamenti/nuovo?data=${date}${staffFilter ? `&staff=${staffFilter}` : ""}`} size="sm">
            <CalendarPlus className="size-4" aria-hidden="true" /> Nuovo
          </ButtonLink>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Link href={href({ data: prev })} className="inline-flex size-10 items-center justify-center rounded-full border border-line-strong hover:border-text" aria-label="Periodo precedente">
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Link>
          <Link href={href({ data: next })} className="inline-flex size-10 items-center justify-center rounded-full border border-line-strong hover:border-text" aria-label="Periodo successivo">
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
          <Link href={href({ data: todayIn(tz) })} className="ml-1 inline-flex h-10 items-center rounded-full border border-line-strong px-4 text-sm hover:border-text">
            Oggi
          </Link>
        </div>
        <h2 className="text-lg font-medium first-letter:uppercase">{title}</h2>
        <div className="ml-auto flex rounded-full border border-line-strong p-1" role="tablist" aria-label="Vista">
          {(["giorno", "settimana", "mese"] as View[]).map((v) => (
            <Link
              key={v}
              href={href({ vista: v })}
              role="tab"
              aria-selected={view === v}
              className={cn("h-8 rounded-full px-3.5 text-sm leading-8 capitalize", view === v ? "bg-text text-bg" : "text-muted hover:text-text")}
            >
              {v}
            </Link>
          ))}
        </div>
      </div>

      {staff.length > 1 && (
        <div className="flex flex-wrap gap-2" aria-label="Filtra per professionista">
          <Link href={href({ staff: null })} className={cn("h-8 rounded-full border px-3.5 text-sm leading-[1.9rem]", !staffFilter ? "border-text bg-text text-bg" : "border-line-strong text-muted hover:text-text")}>
            Tutti
          </Link>
          {staff.map((s) => (
            <Link key={s.id} href={href({ staff: s.id })} className={cn("h-8 rounded-full border px-3.5 text-sm leading-[1.9rem]", staffFilter === s.id ? "border-text bg-text text-bg" : "border-line-strong text-muted hover:text-text")}>
              {s.display_name}
            </Link>
          ))}
        </div>
      )}

      {view === "giorno" && (
        <DayView date={date} tz={tz} staff={visibleStaff} appts={appts} blocks={blocks} startMin={dayStartMin} endMin={dayEndMin} />
      )}
      {view === "settimana" && <WeekView from={from} tz={tz} appts={appts} startMin={dayStartMin} endMin={dayEndMin} today={todayIn(tz)} staffCount={visibleStaff.length} />}
      {view === "mese" && <MonthView from={from} to={to} month={d.month} tz={tz} appts={appts} today={todayIn(tz)} hrefFor={(day) => href({ vista: "giorno", data: day })} />}

      <Legend />
    </div>
  );
}

function minutesOf(iso: string, tz: string) {
  const z = toZoned(iso, tz);
  return z.hour * 60 + z.minute;
}

const statusClass: Record<string, string> = {
  confirmed: "bg-text text-bg border-text",
  completed: "bg-surface-2 text-text border-line-strong",
  no_show: "bg-warning/10 text-warning border-warning/50",
  cancelled: "bg-surface text-subtle border-dashed border-line-strong line-through",
};

function DayView({
  date,
  tz,
  staff,
  appts,
  blocks,
  startMin,
  endMin,
}: {
  date: string;
  tz: string;
  staff: Staff[];
  appts: AppointmentListItem[];
  blocks: TimeBlock[];
  startMin: number;
  endMin: number;
}) {
  const height = (endMin - startMin) * PX_PER_MIN;
  const hoursMarks: number[] = [];
  for (let m = startMin; m <= endMin; m += 60) hoursMarks.push(m);
  const halfHours: number[] = [];
  for (let m = startMin; m < endMin; m += 30) halfHours.push(m);
  const { start: dayStart, end: dayEnd } = localDayRange(date, tz);

  return (
    <Card className="overflow-x-auto">
      <div className="min-w-fit" style={{ minWidth: 64 + staff.length * 180 }}>
        <div className="sticky top-0 z-10 flex border-b border-line bg-surface">
          <div className="w-16 shrink-0" />
          {staff.map((s) => (
            <div key={s.id} className="min-w-44 flex-1 border-l border-line px-3 py-3 text-sm font-medium">
              {s.display_name}
            </div>
          ))}
        </div>
        <div className="relative flex" style={{ height }}>
          <div className="relative w-16 shrink-0">
            {hoursMarks.map((m) => (
              <span key={m} className="tabular absolute right-2 -translate-y-1/2 text-xs text-subtle" style={{ top: (m - startMin) * PX_PER_MIN }}>
                {String(Math.floor(m / 60)).padStart(2, "0")}:00
              </span>
            ))}
          </div>
          {staff.map((s) => (
            <div key={s.id} className="relative min-w-44 flex-1 border-l border-line">
              {/* Clickable half-hour cells to create an appointment */}
              {halfHours.map((m) => (
                <Link
                  key={m}
                  href={`/admin/appuntamenti/nuovo?data=${date}&ora=${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}&staff=${s.id}`}
                  className={cn("absolute inset-x-0 block hover:bg-surface-2", m % 60 === 0 ? "border-t border-line" : "border-t border-dashed border-line/60")}
                  style={{ top: (m - startMin) * PX_PER_MIN, height: 30 * PX_PER_MIN }}
                  aria-label={`Nuovo appuntamento con ${s.display_name} alle ${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`}
                  tabIndex={-1}
                />
              ))}
              {blocks
                .filter((bl) => bl.staff_id === null || bl.staff_id === s.id)
                .map((bl) => {
                  const st = Math.max(Date.parse(bl.starts_at), dayStart);
                  const en = Math.min(Date.parse(bl.ends_at), dayEnd);
                  if (en <= st) return null;
                  const top = Math.max(0, (minutesOf(new Date(st).toISOString(), tz) - startMin) * PX_PER_MIN);
                  const bottom = en >= dayEnd ? height : Math.min(height, (minutesOf(new Date(en).toISOString(), tz) - startMin) * PX_PER_MIN);
                  return (
                    <div
                      key={bl.id}
                      className="pointer-events-none absolute inset-x-1 rounded-lg border border-line-strong bg-[repeating-linear-gradient(135deg,var(--surface-2)_0_6px,transparent_6px_12px)] px-2 py-1 text-xs text-muted"
                      style={{ top, height: Math.max(18, bottom - top) }}
                    >
                      {bl.reason || "Bloccato"}
                    </div>
                  );
                })}
              {appts
                .filter((a) => a.staff_id === s.id)
                .map((a) => {
                  const top = (minutesOf(a.starts_at, tz) - startMin) * PX_PER_MIN;
                  const h = Math.max(22, ((Date.parse(a.ends_at) - Date.parse(a.starts_at)) / 60_000) * PX_PER_MIN - 2);
                  return (
                    <Link
                      key={a.id}
                      href={`/admin/appuntamenti/${a.id}`}
                      className={cn("absolute inset-x-1 overflow-hidden rounded-lg border px-2 py-1 text-xs shadow-sm hover:opacity-90", statusClass[a.status], a.status === "cancelled" && "z-0 opacity-60")}
                      style={{ top: top + 1, height: h }}
                      title={`${formatTime(a.starts_at, tz)} ${a.customers?.full_name ?? ""} · ${a.service_name} · ${statusLabel(a.status)}`}
                    >
                      <span className="tabular font-semibold">{formatTime(a.starts_at, tz)}</span> {a.customers?.full_name}
                      {h > 34 && <span className="block truncate opacity-75">{a.service_name}</span>}
                    </Link>
                  );
                })}
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function WeekView({
  from,
  tz,
  appts,
  startMin,
  endMin,
  today,
  staffCount,
}: {
  from: string;
  tz: string;
  appts: AppointmentListItem[];
  startMin: number;
  endMin: number;
  today: string;
  staffCount: number;
}) {
  const days = eachDate(from, addDays(from, 6));
  const height = (endMin - startMin) * PX_PER_MIN;
  const byDay = (day: string) => appts.filter((a) => toZoned(a.starts_at, tz).toISODate() === day);
  return (
    <>
      {/* Mobile: agenda list */}
      <div className="space-y-4 md:hidden">
        {days.map((day) => {
          const list = byDay(day);
          return (
            <Card key={day}>
              <Link href={`/admin/calendario?vista=giorno&data=${day}`} className={cn("flex items-center justify-between border-b border-line px-4 py-3 text-sm font-medium", day === today && "text-text")}>
                <span className="first-letter:uppercase">{toZoned(`${day}T12:00:00`, tz).setLocale("it").toFormat("cccc d LLL")}</span>
                <span className="text-muted">{list.length}</span>
              </Link>
              {list.length > 0 && (
                <ul className="divide-y divide-line">
                  {list.map((a) => (
                    <li key={a.id}>
                      <Link href={`/admin/appuntamenti/${a.id}`} className="flex gap-3 px-4 py-2.5 text-sm">
                        <span className="tabular w-11 font-semibold">{formatTime(a.starts_at, tz)}</span>
                        <span className="min-w-0 flex-1 truncate">
                          {a.customers?.full_name} <span className="text-muted">· {a.service_name}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          );
        })}
      </div>

      {/* Desktop: time grid */}
      <Card className="hidden overflow-hidden md:block">
        <div className="grid grid-cols-[4rem_repeat(7,minmax(0,1fr))] border-b border-line">
          <div />
          {days.map((day, i) => (
            <Link key={day} href={`/admin/calendario?vista=giorno&data=${day}`} className={cn("border-l border-line px-2 py-2.5 text-center text-sm hover:bg-surface-2", day === today && "font-semibold")}>
              {WEEKDAYS_SHORT[i]} <span className="tabular">{Number(day.slice(8))}</span>
            </Link>
          ))}
        </div>
        <div className="grid grid-cols-[4rem_repeat(7,minmax(0,1fr))]" style={{ height }}>
          <div className="relative">
            {Array.from({ length: Math.floor((endMin - startMin) / 60) + 1 }, (_, i) => startMin + i * 60).map((m) => (
              <span key={m} className="tabular absolute right-2 -translate-y-1/2 text-xs text-subtle" style={{ top: (m - startMin) * PX_PER_MIN }}>
                {String(Math.floor(m / 60)).padStart(2, "0")}:00
              </span>
            ))}
          </div>
          {days.map((day) => {
            const list = byDay(day);
            return (
              <div key={day} className={cn("relative border-l border-line", day === today && "bg-surface-2/50")}>
                {Array.from({ length: Math.floor((endMin - startMin) / 60) }, (_, i) => (
                  <div key={i} className="absolute inset-x-0 border-t border-line" style={{ top: i * 60 * PX_PER_MIN }} />
                ))}
                {list.map((a) => {
                  // Overlapping appointments of different staff are shown side by side
                  const lane = staffCount > 1 ? list.filter((o) => o.staff_id < a.staff_id && Date.parse(o.starts_at) < Date.parse(a.ends_at) && Date.parse(a.starts_at) < Date.parse(o.ends_at)).length : 0;
                  const lanes = staffCount > 1 ? 1 + list.filter((o) => o.id !== a.id && Date.parse(o.starts_at) < Date.parse(a.ends_at) && Date.parse(a.starts_at) < Date.parse(o.ends_at)).length : 1;
                  const top = (minutesOf(a.starts_at, tz) - startMin) * PX_PER_MIN;
                  const h = Math.max(20, ((Date.parse(a.ends_at) - Date.parse(a.starts_at)) / 60_000) * PX_PER_MIN - 2);
                  return (
                    <Link
                      key={a.id}
                      href={`/admin/appuntamenti/${a.id}`}
                      className={cn("absolute overflow-hidden rounded-md border px-1.5 py-0.5 text-[0.7rem] leading-tight hover:opacity-90", statusClass[a.status])}
                      style={{ top: top + 1, height: h, left: `calc(${(lane / lanes) * 100}% + 2px)`, width: `calc(${100 / lanes}% - 4px)` }}
                      title={`${formatTime(a.starts_at, tz)} ${a.customers?.full_name ?? ""} · ${a.service_name}${a.staff ? ` · ${a.staff.display_name}` : ""}`}
                    >
                      <span className="tabular font-semibold">{formatTime(a.starts_at, tz)}</span> <span className="truncate">{a.customers?.full_name}</span>
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </div>
      </Card>
    </>
  );
}

function MonthView({
  from,
  to,
  month,
  tz,
  appts,
  today,
  hrefFor,
}: {
  from: string;
  to: string;
  month: number;
  tz: string;
  appts: AppointmentListItem[];
  today: string;
  hrefFor: (day: string) => string;
}) {
  const days = eachDate(from, to);
  const counts = new Map<string, AppointmentListItem[]>();
  for (const a of appts) {
    const k = toZoned(a.starts_at, tz).toISODate()!;
    counts.set(k, [...(counts.get(k) ?? []), a]);
  }
  return (
    <Card className="overflow-hidden">
      <div className="grid grid-cols-7 border-b border-line text-center text-xs text-muted">
        {WEEKDAYS_SHORT.map((w) => (
          <div key={w} className="py-2">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const list = counts.get(day) ?? [];
          const inMonth = Number(day.slice(5, 7)) === month;
          return (
            <Link
              key={day}
              href={hrefFor(day)}
              className={cn("min-h-20 border-b border-l border-line p-1.5 text-left hover:bg-surface-2 sm:min-h-28 sm:p-2", !inMonth && "bg-surface-2/40 text-subtle")}
              aria-label={`${day}: ${list.length} appuntamenti`}
            >
              <span className={cn("tabular inline-flex size-7 items-center justify-center rounded-full text-sm", day === today && "bg-text text-bg font-semibold")}>
                {Number(day.slice(8))}
              </span>
              {list.length > 0 && (
                <>
                  <p className="mt-1 text-xs font-medium sm:hidden">{list.length}</p>
                  <ul className="mt-1 hidden space-y-0.5 sm:block">
                    {list.slice(0, 3).map((a) => (
                      <li key={a.id} className="truncate text-xs">
                        <span className="tabular text-muted">{formatTime(a.starts_at, tz)}</span> {a.customers?.full_name}
                      </li>
                    ))}
                    {list.length > 3 && <li className="text-xs text-muted">+{list.length - 3} altri</li>}
                  </ul>
                </>
              )}
            </Link>
          );
        })}
      </div>
    </Card>
  );
}

function Legend() {
  const items = [
    ["confirmed", "Confermato"],
    ["completed", "Completato"],
    ["no_show", "Non presentato"],
    ["cancelled", "Annullato (solo vista giorno)"],
  ] as const;
  return (
    <ul className="flex flex-wrap gap-4 text-xs text-muted">
      {items.map(([k, label]) => (
        <li key={k} className="flex items-center gap-2">
          <span className={cn("inline-block size-3 rounded border", statusClass[k])} aria-hidden="true" />
          {label}
        </li>
      ))}
    </ul>
  );
}
