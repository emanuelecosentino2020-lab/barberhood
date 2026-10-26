import type { NotificationKind, NotificationRow } from "@/lib/types";
import { ProviderError, type EmailProvider } from "./provider";
import { renderEmail, type EmailContext } from "./templates";

/** Data needed to render one notification, loaded fresh at send time. */
export interface DeliveryContext {
  appointment: {
    id: string;
    status: string;
    startsAt: string;
    endsAt: string;
    serviceName: string;
    priceCents: number;
    staffName: string;
    customerName: string;
    customerEmail: string | null;
    customerPhone: string | null;
    customerNote: string | null;
    cancellationReason: string | null;
    manageTokenNonce: string | null;
  };
  business: EmailContext["business"] & { notificationEmail: string | null; replyTo: string | null };
  /** True if this customer was already sent a review request recently (any appointment) */
  reviewRecentlyRequested: boolean;
}

export interface NotificationStore {
  claim(limit: number): Promise<NotificationRow[]>;
  loadContext(n: NotificationRow): Promise<DeliveryContext | null>;
  complete(id: string, providerMessageId: string): Promise<void>;
  fail(id: string, error: string, retryable: boolean): Promise<void>;
  skip(id: string, reason: string): Promise<void>;
}

export interface WorkerConfig {
  provider: EmailProvider | null;
  from: string | null;
  siteUrl: string;
  manageUrlFor: (nonce: string) => string;
  now?: () => Date;
}

export interface WorkerResult {
  claimed: number;
  sent: number;
  skipped: number;
  failed: number;
}

const CUSTOMER_KINDS: NotificationKind[] = ["booking_confirmed", "booking_rescheduled", "booking_cancelled", "reminder", "review_request"];

/** A review request that could not go out within this window is dropped instead of arriving days later. */
const REVIEW_REQUEST_MAX_DELAY_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Decides whether a notification is still relevant. Data is re-read at send
 * time so that a reminder for a moved or cancelled appointment never goes out.
 */
export function skipReason(n: NotificationRow, ctx: DeliveryContext | null, now: Date): string | null {
  if (!ctx) return "appointment_missing";
  const a = ctx.appointment;
  const started = Date.parse(a.startsAt) <= now.getTime();
  switch (n.kind) {
    case "reminder": {
      if (a.status !== "confirmed") return "appointment_not_confirmed";
      const expected = typeof n.payload.starts_at === "string" ? Date.parse(n.payload.starts_at) : NaN;
      if (expected !== Date.parse(a.startsAt)) return "appointment_moved";
      if (started) return "appointment_started";
      break;
    }
    case "booking_confirmed":
    case "booking_rescheduled":
      if (a.status !== "confirmed") return "appointment_not_confirmed";
      if (started) return "appointment_started";
      break;
    case "owner_new_booking":
      if (started) return "appointment_started";
      break;
    case "booking_cancelled":
    case "owner_booking_cancelled":
      if (a.status !== "cancelled") return "appointment_not_cancelled";
      break;
    case "review_request": {
      if (a.status !== "confirmed" && a.status !== "completed") return "appointment_not_done";
      const expected = typeof n.payload.ends_at === "string" ? Date.parse(n.payload.ends_at) : NaN;
      if (expected !== Date.parse(a.endsAt)) return "appointment_moved";
      if (Date.parse(a.endsAt) > now.getTime()) return "appointment_not_ended";
      if (now.getTime() - Date.parse(a.endsAt) > REVIEW_REQUEST_MAX_DELAY_MS) return "too_late";
      if (!ctx.business.reviewsUrl) return "no_reviews_url";
      if (ctx.reviewRecentlyRequested) return "review_recently_requested";
      break;
    }
  }
  if (CUSTOMER_KINDS.includes(n.kind) && !a.customerEmail) return "no_customer_email";
  if (!CUSTOMER_KINDS.includes(n.kind) && !ctx.business.notificationEmail) return "no_business_email";
  return null;
}

export async function processNotifications(store: NotificationStore, config: WorkerConfig, limit = 25): Promise<WorkerResult> {
  const result: WorkerResult = { claimed: 0, sent: 0, skipped: 0, failed: 0 };
  // Without a provider nothing is claimed: jobs stay pending until email is configured.
  if (!config.provider || !config.from) return result;
  const now = config.now ?? (() => new Date());

  const jobs = await store.claim(limit);
  result.claimed = jobs.length;

  for (const n of jobs) {
    try {
      if (n.channel !== "email") {
        await store.skip(n.id, "channel_not_supported");
        result.skipped++;
        continue;
      }
      const ctx = await store.loadContext(n);
      const reason = skipReason(n, ctx, now());
      if (reason || !ctx) {
        await store.skip(n.id, reason ?? "appointment_missing");
        result.skipped++;
        continue;
      }
      const a = ctx.appointment;
      const isCustomer = CUSTOMER_KINDS.includes(n.kind);
      const rendered = renderEmail({
        kind: n.kind,
        siteUrl: config.siteUrl,
        business: ctx.business,
        appointment: {
          ...a,
          previousStartsAt: typeof n.payload.previous_starts_at === "string" ? n.payload.previous_starts_at : null,
        },
        manageUrl: a.manageTokenNonce ? config.manageUrlFor(a.manageTokenNonce) : null,
        adminUrl: `${config.siteUrl.replace(/\/$/, "")}/admin/appuntamenti/${a.id}`,
      });
      const sent = await config.provider.send({
        from: config.from,
        to: isCustomer ? a.customerEmail! : ctx.business.notificationEmail!,
        replyTo: isCustomer ? (ctx.business.replyTo ?? undefined) : (a.customerEmail ?? undefined),
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        idempotencyKey: n.idempotency_key,
      });
      await store.complete(n.id, sent.id);
      result.sent++;
    } catch (err) {
      const retryable = err instanceof ProviderError ? err.retryable : true;
      const message = err instanceof Error ? err.message : "unknown_error";
      await store.fail(n.id, message, retryable);
      result.failed++;
    }
  }
  return result;
}
