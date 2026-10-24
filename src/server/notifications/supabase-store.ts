import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { tokenFromNonce } from "@/lib/tokens";
import type { NotificationRow } from "@/lib/types";
import { resendProvider } from "./provider";
import { processNotifications, type DeliveryContext, type NotificationStore, type WorkerResult } from "./worker";

interface ContextRow {
  id: string;
  status: string;
  starts_at: string;
  ends_at: string;
  service_name: string;
  price_cents: number;
  customer_note: string | null;
  cancellation_reason: string | null;
  manage_token_nonce: string | null;
  staff: { display_name: string } | null;
  customers: { full_name: string; email: string | null; phone: string | null } | null;
  businesses: {
    slug: string;
    name: string;
    timezone: string;
    currency: string;
    address_line: string | null;
    city: string | null;
    phone: string | null;
    email: string | null;
    logo_url: string | null;
    theme: Record<string, unknown>;
    notification_email: string | null;
  } | null;
}

export function supabaseNotificationStore(db: SupabaseClient, onlyAppointmentId?: string): NotificationStore {
  return {
    async claim(limit) {
      const { data, error } = await db.rpc("claim_notifications", {
        p_limit: limit,
        p_appointment_id: onlyAppointmentId ?? null,
      });
      if (error) throw new Error(`claim_failed:${error.code}`);
      return (data ?? []) as NotificationRow[];
    },
    async loadContext(n): Promise<DeliveryContext | null> {
      if (!n.appointment_id) return null;
      const { data, error } = await db
        .from("appointments")
        .select(
          "id, status, starts_at, ends_at, service_name, price_cents, customer_note, cancellation_reason, manage_token_nonce, staff(display_name), customers(full_name, email, phone), businesses(slug, name, timezone, currency, address_line, city, phone, email, logo_url, theme, notification_email)",
        )
        .eq("id", n.appointment_id)
        .maybeSingle();
      if (error) throw new Error(`context_failed:${error.code}`);
      if (!data) return null;
      const r = data as unknown as ContextRow;
      const b = r.businesses;
      if (!b || !r.customers) return null;
      const theme = b.theme ?? {};
      return {
        appointment: {
          id: r.id,
          status: r.status,
          startsAt: r.starts_at,
          endsAt: r.ends_at,
          serviceName: r.service_name,
          priceCents: r.price_cents,
          staffName: r.staff?.display_name ?? "",
          customerName: r.customers.full_name,
          customerEmail: r.customers.email,
          customerPhone: r.customers.phone,
          customerNote: r.customer_note,
          cancellationReason: r.cancellation_reason,
          manageTokenNonce: r.manage_token_nonce,
        },
        business: {
          slug: b.slug,
          name: b.name,
          timezone: b.timezone,
          currency: b.currency,
          address: [b.address_line, b.city].filter(Boolean).join(", ") || null,
          phone: b.phone,
          email: b.email,
          logoUrl: typeof theme.email_logo_url === "string" ? theme.email_logo_url : null,
          accent: typeof theme.accent === "string" ? theme.accent : "#111111",
          notificationEmail: b.notification_email,
          replyTo: b.email,
        },
      };
    },
    async complete(id, providerMessageId) {
      await db.rpc("complete_notification", { p_id: id, p_provider_message_id: providerMessageId });
    },
    async fail(id, message, retryable) {
      await db.rpc("fail_notification", { p_id: id, p_error: message, p_retryable: retryable });
    },
    async skip(id, reason) {
      await db.rpc("skip_notification", { p_id: id, p_reason: reason });
    },
  };
}

export function isEmailConfigured(): boolean {
  const env = serverEnv();
  return Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
}

/** Runs the worker with production wiring. */
export async function runNotificationWorker(opts: { appointmentId?: string; limit?: number } = {}): Promise<WorkerResult> {
  const env = serverEnv();
  const db = createAdminClient();
  return processNotifications(
    supabaseNotificationStore(db, opts.appointmentId),
    {
      provider: env.RESEND_API_KEY ? resendProvider(env.RESEND_API_KEY) : null,
      from: env.EMAIL_FROM ?? null,
      siteUrl: env.NEXT_PUBLIC_SITE_URL,
      manageUrlFor: (nonce) => `${env.NEXT_PUBLIC_SITE_URL}/gestisci/${tokenFromNonce(env.MANAGE_TOKEN_SECRET, nonce)}`,
    },
    opts.limit,
  );
}
