import { ArrowLeft, Mail, Phone } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppointmentActions } from "@/components/admin/appointment-actions";
import { Card, StatusBadge, statusLabel } from "@/components/ui/misc";
import { formatLongDate, formatTime, toZoned } from "@/lib/booking/time";
import { formatDuration, formatPrice } from "@/lib/format";
import type { Appointment, AppointmentEvent, AppointmentStatus, Staff } from "@/lib/types";
import { requireMember } from "@/server/auth";
import { requestNow } from "@/server/now";

export const metadata = { title: "Appuntamento" };

const NOTIFICATION_LABEL: Record<string, string> = {
  booking_confirmed: "Conferma",
  booking_rescheduled: "Spostamento",
  booking_cancelled: "Annullamento",
  reminder: "Promemoria",
  owner_new_booking: "Avviso al negozio",
  owner_booking_cancelled: "Avviso disdetta al negozio",
};
const NOTIFICATION_STATUS: Record<string, string> = {
  pending: "in coda",
  processing: "in invio",
  sent: "inviata",
  failed: "non consegnata",
  cancelled: "non necessaria",
};

export default async function AppointmentPage({ params }: PageProps<"/admin/appuntamenti/[id]">) {
  const ctx = await requireMember();
  const now = await requestNow();
  const { db, business: b } = ctx;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const tz = b.timezone;

  const [apptRes, eventsRes, notifRes, staffRes] = await Promise.all([
    db.from("appointments").select("*, customers(id, full_name, email, phone, notes), staff(display_name)").eq("id", id).eq("business_id", b.id).maybeSingle(),
    db.from("appointment_events").select("*").eq("appointment_id", id).order("created_at"),
    db.from("notifications").select("kind, status, scheduled_for, sent_at, last_error").eq("appointment_id", id).order("created_at"),
    db.from("staff").select("id, display_name, is_active").eq("business_id", b.id).order("sort_order"),
  ]);
  if (!apptRes.data) notFound();
  const a = apptRes.data as Appointment & {
    customers: { id: string; full_name: string; email: string | null; phone: string | null; notes: string | null } | null;
    staff: { display_name: string } | null;
  };
  const events = (eventsRes.data ?? []) as AppointmentEvent[];
  const staffList = ((staffRes.data ?? []) as Pick<Staff, "id" | "display_name" | "is_active">[]).filter((s) => s.is_active || s.id === a.staff_id);
  const staffName = (sid: unknown) => staffList.find((s) => s.id === sid)?.display_name ?? "";
  const duration = Math.round((Date.parse(a.ends_at) - Date.parse(a.starts_at)) / 60_000);

  const describe = (e: AppointmentEvent) => {
    const who = e.actor_type === "customer" ? "dal cliente" : e.actor_type === "member" ? "dal negozio" : "dal sistema";
    const when = (v: unknown) => (typeof v === "string" ? `${formatLongDate(v, tz)} ${formatTime(v, tz)}` : "");
    switch (e.event_type) {
      case "created":
        return `Creato ${e.data.source === "online" ? "online" : who}`;
      case "rescheduled":
        return `Spostato ${who}: da ${when(e.data.from)} a ${when(e.data.to)}${e.data.staff_from !== e.data.staff_to ? ` (${staffName(e.data.staff_from)} → ${staffName(e.data.staff_to)})` : ""}`;
      case "cancelled":
        return `Annullato ${who}`;
      case "status_changed":
        return `Stato: ${statusLabel(e.data.from as AppointmentStatus)} → ${statusLabel(e.data.to as AppointmentStatus)}`;
      default:
        return "Modificato";
    }
  };

  return (
    <div className="space-y-6">
      <Link href={`/admin/calendario?data=${toZoned(a.starts_at, tz).toISODate()}`} className="inline-flex items-center gap-2 text-sm text-muted hover:text-text">
        <ArrowLeft className="size-4" aria-hidden="true" /> Calendario
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted first-letter:uppercase">{formatLongDate(a.starts_at, tz)}</p>
          <h1 className="tabular mt-1 text-3xl font-semibold tracking-tight">
            {formatTime(a.starts_at, tz)}–{formatTime(a.ends_at, tz)}
          </h1>
          <p className="mt-1 text-muted">
            {a.service_name} · {formatDuration(duration)} · {formatPrice(a.price_cents, b.currency)}
            {a.staff && ` · ${a.staff.display_name}`}
          </p>
        </div>
        <StatusBadge status={a.status} />
      </div>

      <AppointmentActions
        id={a.id}
        status={a.status}
        serviceId={a.service_id}
        staffId={a.staff_id}
        date={toZoned(a.starts_at, tz).toISODate()!}
        time={formatTime(a.starts_at, tz)}
        timeZone={tz}
        staff={staffList.map((s) => ({ id: s.id, display_name: s.display_name }))}
        isPast={Date.parse(a.starts_at) <= now}
        hasEmail={!!a.customers?.email}
      />

      {a.status === "cancelled" && (
        <Card className="p-4 text-sm">
          <p className="font-medium">
            Annullato {a.cancelled_by === "customer" ? "dal cliente" : "dal negozio"}
            {a.cancelled_at && ` il ${formatLongDate(a.cancelled_at, tz)} alle ${formatTime(a.cancelled_at, tz)}`}
          </p>
          {a.cancellation_reason && <p className="mt-1 text-muted">Motivo: {a.cancellation_reason}</p>}
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-sm font-medium text-muted">Cliente</h2>
          {a.customers && (
            <>
              <Link href={`/admin/clienti/${a.customers.id}`} className="mt-2 block text-lg font-medium hover:underline underline-offset-4">
                {a.customers.full_name}
              </Link>
              <div className="mt-3 space-y-2 text-sm">
                {a.customers.phone && (
                  <a href={`tel:${a.customers.phone.replace(/\s/g, "")}`} className="flex items-center gap-2 hover:underline underline-offset-4">
                    <Phone className="size-4 text-muted" aria-hidden="true" /> {a.customers.phone}
                  </a>
                )}
                {a.customers.email && (
                  <a href={`mailto:${a.customers.email}`} className="flex items-center gap-2 hover:underline underline-offset-4">
                    <Mail className="size-4 text-muted" aria-hidden="true" /> {a.customers.email}
                  </a>
                )}
              </div>
              {a.customer_note && <p className="mt-4 rounded-xl bg-surface-2 p-3 text-sm">“{a.customer_note}”</p>}
              {a.customers.notes && <p className="mt-3 text-sm text-muted">Note interne: {a.customers.notes}</p>}
            </>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-medium text-muted">Storico</h2>
          <ol className="mt-3 space-y-3 text-sm">
            {events.map((e) => (
              <li key={e.id} className="flex gap-3">
                <span className="tabular w-28 shrink-0 text-subtle">
                  {toZoned(e.created_at, tz).setLocale("it").toFormat("d LLL HH:mm")}
                </span>
                <span>{describe(e)}</span>
              </li>
            ))}
          </ol>
          {(notifRes.data?.length ?? 0) > 0 && (
            <>
              <h3 className="mt-6 text-sm font-medium text-muted">Email</h3>
              <ul className="mt-2 space-y-1.5 text-sm">
                {(notifRes.data as { kind: string; status: string; scheduled_for: string; sent_at: string | null; last_error: string | null }[]).map((n, i) => (
                  <li key={i} className="flex justify-between gap-3">
                    <span>{NOTIFICATION_LABEL[n.kind] ?? n.kind}</span>
                    <span className={n.status === "failed" ? "text-danger" : "text-muted"}>
                      {NOTIFICATION_STATUS[n.status] ?? n.status}
                      {n.status === "pending" && Date.parse(n.scheduled_for) > now && ` · ${toZoned(n.scheduled_for, tz).setLocale("it").toFormat("d LLL HH:mm")}`}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
