import { CalendarPlus, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { AppointmentRow } from "@/components/admin/appointment-row";
import { PageHeader } from "@/components/admin/page-header";
import { RetryNotifications } from "@/components/admin/retry-notifications";
import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState, Notice } from "@/components/ui/misc";
import { addDays, formatLongDate, formatShortDate, formatTime, localDayRange, todayIn, toZoned } from "@/lib/booking/time";
import { formatPrice } from "@/lib/format";
import { APPOINTMENT_LIST_COLUMNS, appointmentsBetween, type AppointmentListItem } from "@/server/admin-queries";
import { canManage, requireMember } from "@/server/auth";
import { isEmailConfigured } from "@/server/notifications/supabase-store";
import { requestNow } from "@/server/now";

export default async function DashboardPage({ searchParams }: PageProps<"/admin">) {
  const ctx = await requireMember();
  const now = await requestNow();
  const { db, business: b } = ctx;
  const sp = await searchParams;
  const tz = b.timezone;
  const today = todayIn(tz);
  const { start: dayStart, end: dayEnd } = localDayRange(today, tz);
  const weekEnd = localDayRange(addDays(today, 7), tz).end;
  const monthStart = toZoned(now, tz).startOf("month");
  const monthStartIso = monthStart.toUTC().toISO()!;
  const monthEndIso = monthStart.plus({ months: 1 }).toUTC().toISO()!;
  const iso = (ms: number) => new Date(ms).toISOString();

  const [todayList, upcoming, recent, cancellations, monthRows, failed] = await Promise.all([
    appointmentsBetween(db, b.id, iso(dayStart), iso(dayEnd)),
    appointmentsBetween(db, b.id, iso(dayEnd), iso(weekEnd)),
    db
      .from("appointments")
      .select(APPOINTMENT_LIST_COLUMNS)
      .eq("business_id", b.id)
      .eq("source", "online")
      .order("created_at", { ascending: false })
      .limit(5),
    db
      .from("appointments")
      .select(APPOINTMENT_LIST_COLUMNS)
      .eq("business_id", b.id)
      .eq("status", "cancelled")
      .gte("cancelled_at", iso(now - 14 * 86_400_000))
      .order("cancelled_at", { ascending: false })
      .limit(5),
    db.from("appointments").select("status, price_cents, source").eq("business_id", b.id).gte("starts_at", monthStartIso).lt("starts_at", monthEndIso),
    db.from("notifications").select("id", { count: "exact", head: true }).eq("business_id", b.id).eq("status", "failed"),
  ]);

  const month = (monthRows.data ?? []) as { status: string; price_cents: number; source: string }[];
  const active = month.filter((r) => r.status !== "cancelled");
  const completed = month.filter((r) => r.status === "completed");
  const noShows = month.filter((r) => r.status === "no_show").length;
  const attended = completed.length + noShows;
  const stats = [
    { label: "Appuntamenti del mese", value: String(active.length), note: `${month.filter((r) => r.status !== "cancelled" && r.source === "online").length} online` },
    { label: "Incassato (completati)", value: formatPrice(completed.reduce((s, r) => s + r.price_cents, 0), b.currency), note: "Prezzi registrati alla prenotazione" },
    { label: "Previsto (confermati)", value: formatPrice(active.filter((r) => r.status === "confirmed").reduce((s, r) => s + r.price_cents, 0), b.currency), note: "Ancora da svolgere o da chiudere" },
    { label: "No-show", value: attended ? `${Math.round((noShows / attended) * 100)}%` : "–", note: `${noShows} su ${attended} · ${month.length - active.length} annullati` },
  ];
  const remainingToday = todayList.filter((a) => Date.parse(a.ends_at) > now && a.status === "confirmed");

  return (
    <div className="space-y-8">
      <PageHeader
        title={`Oggi, ${formatLongDate(now, tz).replace(/ \d{4}$/, "")}`}
        description={
          todayList.length === 0
            ? "Nessun appuntamento in agenda oggi."
            : `${todayList.length} appuntamenti · ${remainingToday.length} ancora da fare${remainingToday[0] ? ` · prossimo alle ${formatTime(remainingToday[0].starts_at, tz)}` : ""}`
        }
        actions={
          <ButtonLink href="/admin/appuntamenti/nuovo" size="sm">
            <CalendarPlus className="size-4" aria-hidden="true" /> Nuovo appuntamento
          </ButtonLink>
        }
      />

      {sp.errore === "permessi" && <Notice tone="error">Non hai i permessi per aprire quella sezione.</Notice>}
      {!isEmailConfigured() && canManage(ctx.role) && (
        <Notice tone="warning" title="Email non ancora attive">
          Le prenotazioni funzionano, ma conferme e promemoria non vengono inviati finché non configuri Resend (vedi README, sezione Email).
          Le email restano in coda e partono appena il servizio è attivo.
        </Notice>
      )}
      {(failed.count ?? 0) > 0 && (
        <Notice tone="error" title={`${failed.count} email non consegnate`}>
          <div className="flex flex-wrap items-center gap-3">
            <span>Dopo diversi tentativi l&apos;invio non è riuscito.</span>
            {canManage(ctx.role) && <RetryNotifications />}
          </div>
        </Notice>
      )}

      <section aria-labelledby="today-title">
        <h2 id="today-title" className="sr-only">
          Appuntamenti di oggi
        </h2>
        {todayList.length === 0 ? (
          <EmptyState title="Giornata libera" action={<ButtonLink href="/admin/calendario" variant="secondary" size="sm">Apri il calendario</ButtonLink>}>
            Le nuove prenotazioni online compariranno qui automaticamente.
          </EmptyState>
        ) : (
          <Card>
            <ul className="divide-y divide-line">
              {todayList.map((a) => (
                <AppointmentRow key={a.id} a={a} timezone={tz} currency={b.currency} showActions={Date.parse(a.starts_at) <= now} />
              ))}
            </ul>
          </Card>
        )}
      </section>

      <section aria-labelledby="stats-title">
        <h2 id="stats-title" className="mb-3 text-sm font-medium text-muted">
          Questo mese
        </h2>
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats.map((s) => (
            <Card key={s.label} className="p-4">
              <dt className="text-xs text-muted">{s.label}</dt>
              <dd className="tabular mt-1 text-2xl font-semibold">{s.value}</dd>
              <dd className="mt-1 text-xs text-subtle">{s.note}</dd>
            </Card>
          ))}
        </dl>
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <ListSection title="Prossimi 7 giorni" empty="Nessun appuntamento nei prossimi giorni." items={upcoming.slice(0, 8)} tz={tz} currency={b.currency} showDate more={upcoming.length > 8 ? { href: "/admin/calendario?vista=settimana", label: `Vedi tutti (${upcoming.length})` } : undefined} />
        <ListSection title="Ultime prenotazioni online" empty="Ancora nessuna prenotazione online." items={(recent.data ?? []) as unknown as AppointmentListItem[]} tz={tz} currency={b.currency} showDate />
        {(cancellations.data?.length ?? 0) > 0 && (
          <ListSection title="Annullamenti recenti" empty="" items={(cancellations.data ?? []) as unknown as AppointmentListItem[]} tz={tz} currency={b.currency} showDate icon />
        )}
      </div>
    </div>
  );
}

function ListSection({
  title,
  items,
  empty,
  tz,
  currency,
  showDate,
  more,
  icon,
}: {
  title: string;
  items: AppointmentListItem[];
  empty: string;
  tz: string;
  currency: string;
  showDate?: boolean;
  more?: { href: string; label: string };
  icon?: boolean;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-medium text-muted">
          {icon && <TriangleAlert className="size-4" aria-hidden="true" />}
          {title}
        </h2>
        {more && (
          <Link href={more.href} className="text-sm text-muted underline-offset-4 hover:text-text hover:underline">
            {more.label}
          </Link>
        )}
      </div>
      {items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line-strong px-4 py-6 text-center text-sm text-muted">{empty}</p>
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {items.map((a) => (
              <AppointmentRow key={a.id} a={a} timezone={tz} currency={currency} showDate={showDate ? formatShortDate(a.starts_at, tz) : undefined} />
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}
