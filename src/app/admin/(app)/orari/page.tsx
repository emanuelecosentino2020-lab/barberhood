import Link from "next/link";
import { DateOverrides, TimeBlocks, WeeklyHoursEditor } from "@/components/admin/hours-editor";
import { PageHeader } from "@/components/admin/page-header";
import { cn } from "@/components/ui/cn";
import { todayIn } from "@/lib/booking/time";
import { canManage, requireMember } from "@/server/auth";

export const metadata = { title: "Orari" };

const hhmm = (t: string | null) => (t ? (t.startsWith("24") ? "24:00" : t.slice(0, 5)) : "");

export default async function HoursPage({ searchParams }: PageProps<"/admin/orari">) {
  const { db, business: b, role } = await requireMember();
  const sp = await searchParams;
  const { data: staffRows } = await db.from("staff").select("id, display_name, is_active").eq("business_id", b.id).order("sort_order");
  const staff = (staffRows ?? []) as { id: string; display_name: string; is_active: boolean }[];
  const scope = typeof sp.staff === "string" && staff.some((s) => s.id === sp.staff) ? sp.staff : null;
  const today = todayIn(b.timezone);

  const [hoursRes, overridesRes, blocksRes] = await Promise.all([
    db.from("working_hours").select("staff_id, weekday, start_time, end_time").eq("business_id", b.id),
    db.from("date_overrides").select("staff_id, date, is_closed, start_time, end_time, note").eq("business_id", b.id).gte("date", today).order("date").order("start_time"),
    db.from("time_blocks").select("id, staff_id, starts_at, ends_at, reason").eq("business_id", b.id).gt("ends_at", new Date().toISOString()).order("starts_at").limit(200),
  ]);
  const hours = ((hoursRes.data ?? []) as { staff_id: string | null; weekday: number; start_time: string; end_time: string }[]).map((h) => ({
    staffId: h.staff_id,
    weekday: h.weekday,
    start: hhmm(h.start_time),
    end: hhmm(h.end_time),
  }));
  const businessHours = hours.filter((h) => h.staffId === null);
  const scopeHours = hours.filter((h) => h.staffId === scope);
  const followsBusiness = scope !== null && scopeHours.length === 0;

  // Group per-date override rows into one entry per (date, staff)
  const overrides = new Map<string, { date: string; staffId: string | null; isClosed: boolean; intervals: { start: string; end: string }[]; note: string | null }>();
  for (const o of (overridesRes.data ?? []) as { staff_id: string | null; date: string; is_closed: boolean; start_time: string | null; end_time: string | null; note: string | null }[]) {
    if (o.staff_id !== scope) continue;
    const key = `${o.date}|${o.staff_id ?? ""}`;
    const entry = overrides.get(key) ?? { date: o.date, staffId: o.staff_id, isClosed: o.is_closed, intervals: [], note: o.note };
    if (!o.is_closed) entry.intervals.push({ start: hhmm(o.start_time), end: hhmm(o.end_time) });
    overrides.set(key, entry);
  }

  const manage = canManage(role);
  const scopeName = scope ? staff.find((s) => s.id === scope)!.display_name : "Negozio";

  return (
    <div className="space-y-8">
      <PageHeader title="Orari e disponibilità" description="Gli orari del negozio valgono per tutti. Un professionista può avere orari propri, sempre dentro l'apertura del negozio." />

      <nav aria-label="Di chi sono gli orari" className="flex flex-wrap gap-2">
        {[{ id: null as string | null, name: "Negozio" }, ...staff.map((s) => ({ id: s.id as string | null, name: s.display_name }))].map((s) => (
          <Link
            key={s.id ?? "shop"}
            href={s.id ? `/admin/orari?staff=${s.id}` : "/admin/orari"}
            aria-current={scope === s.id ? "page" : undefined}
            className={cn("inline-flex h-9 items-center rounded-full border px-4 text-sm", scope === s.id ? "border-text bg-text text-bg" : "border-line-strong hover:border-text")}
          >
            {s.name}
          </Link>
        ))}
      </nav>

      <section aria-labelledby="weekly" className="space-y-3">
        <h2 id="weekly" className="text-lg font-semibold">
          Orario settimanale · {scopeName}
        </h2>
        <WeeklyHoursEditor
          key={`${scope}-${followsBusiness}`}
          staffId={scope}
          initial={followsBusiness ? businessHours : scopeHours}
          followsBusiness={followsBusiness}
          canEdit={manage}
        />
      </section>

      <section aria-labelledby="overrides" className="space-y-3">
        <div>
          <h2 id="overrides" className="text-lg font-semibold">
            Giorni speciali · {scopeName}
          </h2>
          <p className="text-sm text-muted">Sostituiscono l&apos;orario settimanale per una data: festivi, chiusure, aperture straordinarie.</p>
        </div>
        <DateOverrides staffId={scope} items={[...overrides.values()]} today={today} canEdit={manage} />
      </section>

      <section aria-labelledby="blocks" className="space-y-3">
        <div>
          <h2 id="blocks" className="text-lg font-semibold">
            Blocchi e ferie
          </h2>
          <p className="text-sm text-muted">Periodi in cui non si prende nessuna prenotazione, anche su più giorni.</p>
        </div>
        <TimeBlocks items={(blocksRes.data ?? []) as { id: string; staff_id: string | null; starts_at: string; ends_at: string; reason: string | null }[]} staff={staff} timeZone={b.timezone} today={today} />
      </section>
    </div>
  );
}
