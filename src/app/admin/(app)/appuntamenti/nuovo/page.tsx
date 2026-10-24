import { NewAppointmentForm } from "@/components/admin/new-appointment-form";
import { PageHeader } from "@/components/admin/page-header";
import { EmptyState } from "@/components/ui/misc";
import { isLocalDate, todayIn } from "@/lib/booking/time";
import { requireMember } from "@/server/auth";

export const metadata = { title: "Nuovo appuntamento" };

export default async function NewAppointmentPage({ searchParams }: PageProps<"/admin/appuntamenti/nuovo">) {
  const ctx = await requireMember();
  const { db, business: b } = ctx;
  const sp = await searchParams;
  const [svc, staff, links] = await Promise.all([
    db.from("services").select("id, name, price_cents, duration_minutes, is_active").eq("business_id", b.id).order("is_active", { ascending: false }).order("sort_order"),
    db.from("staff").select("id, display_name").eq("business_id", b.id).eq("is_active", true).order("sort_order"),
    db.from("staff_services").select("staff_id, service_id").eq("business_id", b.id),
  ]);
  const linkRows = (links.data ?? []) as { staff_id: string; service_id: string }[];
  const services = ((svc.data ?? []) as { id: string; name: string; price_cents: number; duration_minutes: number; is_active: boolean }[]).map((s) => ({
    ...s,
    staffIds: linkRows.filter((l) => l.service_id === s.id).map((l) => l.staff_id),
  }));

  const date = typeof sp.data === "string" && isLocalDate(sp.data) ? sp.data : todayIn(b.timezone);
  const time = typeof sp.ora === "string" && /^\d{2}:\d{2}$/.test(sp.ora) ? sp.ora : null;
  const staffId = typeof sp.staff === "string" ? sp.staff : null;

  return (
    <div className="space-y-6">
      <PageHeader title="Nuovo appuntamento" description="Per clienti al telefono o in negozio. Il cliente riceve la conferma se inserisci l'email." />
      {services.length === 0 || (staff.data ?? []).length === 0 ? (
        <EmptyState title="Prima configura servizi e team">Serve almeno un servizio e un professionista attivo.</EmptyState>
      ) : (
        <NewAppointmentForm services={services} staff={staff.data ?? []} timeZone={b.timezone} currency={b.currency} initial={{ date, time, staffId }} />
      )}
    </div>
  );
}
