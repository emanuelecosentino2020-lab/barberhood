import { PageHeader } from "@/components/admin/page-header";
import { TeamManager } from "@/components/admin/team-manager";
import type { Staff } from "@/lib/types";
import { requireMember } from "@/server/auth";

export const metadata = { title: "Team" };

export default async function TeamPage() {
  const { db, business: b } = await requireMember("admin");
  const { data } = await db.from("staff").select("*").eq("business_id", b.id).order("sort_order");
  return (
    <div className="space-y-6">
      <PageHeader title="Team" description="Chi può essere scelto dai clienti. Un professionista disattivato non riceve nuove prenotazioni, quelle esistenti restano." />
      <TeamManager staff={(data ?? []) as Staff[]} />
    </div>
  );
}
