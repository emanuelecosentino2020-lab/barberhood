import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppointmentStatus } from "@/lib/types";

export interface AppointmentListItem {
  id: string;
  starts_at: string;
  ends_at: string;
  status: AppointmentStatus;
  source: "online" | "admin";
  service_name: string;
  price_cents: number;
  staff_id: string;
  customer_id: string;
  created_at: string;
  cancelled_at: string | null;
  customer_note: string | null;
  customers: { full_name: string; phone: string | null; email: string | null } | null;
  staff: { display_name: string } | null;
}

export const APPOINTMENT_LIST_COLUMNS =
  "id, starts_at, ends_at, status, source, service_name, price_cents, staff_id, customer_id, created_at, cancelled_at, customer_note, customers(full_name, phone, email), staff(display_name)";

export async function appointmentsBetween(
  db: SupabaseClient,
  businessId: string,
  fromIso: string,
  toIso: string,
  opts: { includeCancelled?: boolean; staffId?: string | null } = {},
): Promise<AppointmentListItem[]> {
  let q = db
    .from("appointments")
    .select(APPOINTMENT_LIST_COLUMNS)
    .eq("business_id", businessId)
    .gte("starts_at", fromIso)
    .lt("starts_at", toIso)
    .order("starts_at");
  if (!opts.includeCancelled) q = q.neq("status", "cancelled");
  if (opts.staffId) q = q.eq("staff_id", opts.staffId);
  const { data, error } = await q.limit(2000);
  if (error) throw new Error("appointments_load_failed");
  return (data ?? []) as unknown as AppointmentListItem[];
}
