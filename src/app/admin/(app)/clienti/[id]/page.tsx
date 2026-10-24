import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CustomerForm } from "@/components/admin/customer-form";
import { Card, StatusBadge } from "@/components/ui/misc";
import { formatShortDate, formatTime } from "@/lib/booking/time";
import { formatPrice } from "@/lib/format";
import type { AppointmentStatus, Customer } from "@/lib/types";
import { canManage, requireMember } from "@/server/auth";

export const metadata = { title: "Cliente" };

export default async function CustomerPage({ params }: PageProps<"/admin/clienti/[id]">) {
  const { db, business: b, role } = await requireMember();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();

  const [cRes, aRes] = await Promise.all([
    db.from("customers").select("*").eq("id", id).eq("business_id", b.id).maybeSingle(),
    db
      .from("appointments")
      .select("id, starts_at, status, service_name, price_cents, staff(display_name)")
      .eq("business_id", b.id)
      .eq("customer_id", id)
      .order("starts_at", { ascending: false })
      .limit(200),
  ]);
  if (!cRes.data) notFound();
  const c = cRes.data as Customer;
  const appts = (aRes.data ?? []) as unknown as {
    id: string;
    starts_at: string;
    status: AppointmentStatus;
    service_name: string;
    price_cents: number;
    staff: { display_name: string } | null;
  }[];
  const done = appts.filter((a) => a.status === "completed");
  const noShows = appts.filter((a) => a.status === "no_show").length;
  const spent = done.reduce((sum, a) => sum + a.price_cents, 0);

  return (
    <div className="space-y-6">
      <Link href="/admin/clienti" className="inline-flex items-center gap-2 text-sm text-muted hover:text-text">
        <ArrowLeft className="size-4" aria-hidden="true" /> Clienti
      </Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{c.full_name}</h1>
        <p className="mt-1 text-sm text-muted">Cliente dal {formatShortDate(c.created_at, b.timezone)}</p>
      </div>

      <dl className="grid grid-cols-3 gap-3">
        {[
          { label: "Appuntamenti", value: String(appts.filter((a) => a.status !== "cancelled").length) },
          { label: "Completati", value: `${done.length} · ${formatPrice(spent, b.currency)}` },
          { label: "Non presentato", value: String(noShows) },
        ].map((s) => (
          <Card key={s.label} className="p-4">
            <dt className="text-xs text-muted">{s.label}</dt>
            <dd className="tabular mt-1 font-semibold">{s.value}</dd>
          </Card>
        ))}
      </dl>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-4 text-sm font-medium text-muted">Dati e note</h2>
          <CustomerForm customer={c} canErase={canManage(role)} />
        </Card>
        <Card>
          <h2 className="px-5 pt-5 text-sm font-medium text-muted">Storico appuntamenti</h2>
          {appts.length === 0 ? (
            <p className="p-5 text-sm text-muted">Nessun appuntamento.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line">
              {appts.map((a) => (
                <li key={a.id}>
                  <Link href={`/admin/appuntamenti/${a.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-2">
                    <div className="tabular w-24 shrink-0 text-sm">
                      <p>{formatShortDate(a.starts_at, b.timezone)}</p>
                      <p className="text-muted">{formatTime(a.starts_at, b.timezone)}</p>
                    </div>
                    <p className="min-w-0 flex-1 truncate text-sm">
                      {a.service_name}
                      {a.staff && <span className="text-muted"> · {a.staff.display_name}</span>}
                    </p>
                    <StatusBadge status={a.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
