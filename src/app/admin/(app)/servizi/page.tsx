import { PageHeader } from "@/components/admin/page-header";
import { ServicesManager } from "@/components/admin/services-manager";
import type { Service } from "@/lib/types";
import { requireMember } from "@/server/auth";

export const metadata = { title: "Servizi" };

export default async function ServicesPage() {
  const { db, business: b } = await requireMember("admin");
  const [svc, staff, links] = await Promise.all([
    db.from("services").select("*").eq("business_id", b.id).order("sort_order").order("name"),
    db.from("staff").select("id, display_name, is_active").eq("business_id", b.id).order("sort_order"),
    db.from("staff_services").select("staff_id, service_id").eq("business_id", b.id),
  ]);
  const linkRows = (links.data ?? []) as { staff_id: string; service_id: string }[];
  const services = ((svc.data ?? []) as Service[]).map((s) => ({ ...s, staffIds: linkRows.filter((l) => l.service_id === s.id).map((l) => l.staff_id) }));

  return (
    <div className="space-y-6">
      <PageHeader title="Servizi" description="Prezzi e durate mostrati ai clienti. La pausa dopo il servizio blocca il tempo per pulizia o preparazione." />
      <ServicesManager services={services} staff={(staff.data ?? []) as { id: string; display_name: string; is_active: boolean }[]} currency={b.currency} staffLabel={b.staff_label} />
    </div>
  );
}
