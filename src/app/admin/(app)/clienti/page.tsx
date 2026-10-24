import { Search } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/admin/page-header";
import { Card, EmptyState } from "@/components/ui/misc";
import { formatShortDate } from "@/lib/booking/time";
import { requireMember } from "@/server/auth";
import { requestNow } from "@/server/now";

export const metadata = { title: "Clienti" };

const PAGE_SIZE = 50;

export default async function CustomersPage({ searchParams }: PageProps<"/admin/clienti">) {
  const { db, business: b } = await requireMember();
  const now = await requestNow();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 80) : "";
  const page = Math.max(1, Number(sp.pagina) || 1);

  let query = db
    .from("customers")
    .select("id, full_name, email, phone, created_at", { count: "exact" })
    .eq("business_id", b.id)
    .order("full_name")
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (q.length >= 2) {
    const term = q.replace(/[%_,()]/g, " ");
    query = query.or(`full_name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%`);
  }
  const { data, count } = await query;
  const customers = (data ?? []) as { id: string; full_name: string; email: string | null; phone: string | null; created_at: string }[];

  // Last visit and number of appointments for the customers on this page
  const ids = customers.map((c) => c.id);
  const { data: appts } = ids.length
    ? await db.from("appointments").select("customer_id, starts_at, status").eq("business_id", b.id).in("customer_id", ids).neq("status", "cancelled")
    : { data: [] };
  const stats = new Map<string, { count: number; last: string | null }>();
  for (const a of (appts ?? []) as { customer_id: string; starts_at: string }[]) {
    const s = stats.get(a.customer_id) ?? { count: 0, last: null };
    s.count++;
    if (Date.parse(a.starts_at) <= now && (!s.last || a.starts_at > s.last)) s.last = a.starts_at;
    stats.set(a.customer_id, s);
  }
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <PageHeader title="Clienti" description={`${total} ${total === 1 ? "cliente" : "clienti"}${q ? ` per “${q}”` : ""}`} />
      <form role="search" className="relative max-w-md">
        <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
        <label htmlFor="q" className="sr-only">
          Cerca cliente
        </label>
        <input
          id="q"
          name="q"
          defaultValue={q}
          placeholder="Cerca per nome, telefono o email"
          className="h-12 w-full rounded-xl border border-line bg-surface pr-4 pl-11 text-text placeholder:text-subtle focus:border-text focus:outline-none"
        />
      </form>

      {customers.length === 0 ? (
        <EmptyState title={q ? "Nessun cliente trovato" : "Ancora nessun cliente"}>
          {q ? "Prova con un altro nome o numero." : "I clienti compaiono qui alla prima prenotazione."}
        </EmptyState>
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {customers.map((c) => {
              const s = stats.get(c.id);
              return (
                <li key={c.id}>
                  <Link href={`/admin/clienti/${c.id}`} className="flex items-center gap-4 px-4 py-3.5 hover:bg-surface-2 sm:px-5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{c.full_name}</p>
                      <p className="truncate text-sm text-muted">{[c.phone, c.email].filter(Boolean).join(" · ") || "Nessun contatto"}</p>
                    </div>
                    <div className="hidden shrink-0 text-right text-sm sm:block">
                      <p className="tabular">{s?.count ?? 0} appuntamenti</p>
                      <p className="text-muted">{s?.last ? `Ultima visita ${formatShortDate(s.last, b.timezone)}` : "Nessuna visita passata"}</p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {pages > 1 && (
        <nav aria-label="Pagine" className="flex items-center justify-between text-sm">
          {page > 1 ? (
            <Link href={{ query: { ...(q ? { q } : {}), pagina: page - 1 } }} className="hover:underline underline-offset-4">
              Precedenti
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted">
            Pagina {page} di {pages}
          </span>
          {page < pages ? (
            <Link href={{ query: { ...(q ? { q } : {}), pagina: page + 1 } }} className="hover:underline underline-offset-4">
              Successivi
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
