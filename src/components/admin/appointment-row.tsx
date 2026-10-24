import Link from "next/link";
import { StatusBadge } from "@/components/ui/misc";
import { formatTime } from "@/lib/booking/time";
import { formatPrice } from "@/lib/format";
import type { AppointmentListItem } from "@/server/admin-queries";
import { QuickStatus } from "./quick-status";

export function AppointmentRow({ a, timezone, currency, showActions = false, showDate }: { a: AppointmentListItem; timezone: string; currency: string; showActions?: boolean; showDate?: string }) {
  return (
    <li className="flex items-center gap-4 px-4 py-3.5 sm:px-5">
      <div className="w-14 shrink-0">
        {showDate && <p className="text-xs text-muted">{showDate}</p>}
        <p className="tabular font-semibold">{formatTime(a.starts_at, timezone)}</p>
        <p className="tabular text-xs text-subtle">{formatTime(a.ends_at, timezone)}</p>
      </div>
      <Link href={`/admin/appuntamenti/${a.id}`} className="min-w-0 flex-1 rounded-lg outline-offset-4">
        <p className="truncate font-medium">{a.customers?.full_name ?? "Cliente"}</p>
        <p className="truncate text-sm text-muted">
          {a.service_name}
          {a.staff?.display_name ? ` · ${a.staff.display_name}` : ""} · {formatPrice(a.price_cents, currency)}
        </p>
      </Link>
      <div className="flex shrink-0 items-center gap-2">
        {showActions && a.status === "confirmed" ? <QuickStatus id={a.id} /> : <StatusBadge status={a.status} />}
      </div>
    </li>
  );
}
