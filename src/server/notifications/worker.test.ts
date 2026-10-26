import { describe, expect, it } from "vitest";
import type { NotificationKind, NotificationRow } from "@/lib/types";
import { ProviderError, type EmailProvider, type OutgoingEmail } from "./provider";
import { escapeHtml, renderEmail } from "./templates";
import { processNotifications, skipReason, type DeliveryContext, type NotificationStore } from "./worker";

const NOW = new Date("2026-11-10T08:00:00Z");
const STARTS = "2026-11-12T09:00:00Z";

function job(kind: NotificationKind, extra: Partial<NotificationRow> = {}): NotificationRow {
  return {
    id: `n-${kind}-${Math.random()}`,
    business_id: "b",
    appointment_id: "a",
    channel: "email",
    kind,
    recipient: kind.startsWith("owner") ? "business" : "customer",
    scheduled_for: NOW.toISOString(),
    status: "processing",
    attempts: 1,
    max_attempts: 5,
    last_error: null,
    payload: kind === "reminder" ? { starts_at: STARTS } : {},
    idempotency_key: `a:${kind}`,
    sent_at: null,
    ...extra,
  };
}

function ctx(over: Partial<DeliveryContext["appointment"]> = {}, biz: Partial<DeliveryContext["business"]> = {}): DeliveryContext {
  return {
    appointment: {
      id: "a",
      status: "confirmed",
      startsAt: STARTS,
      endsAt: "2026-11-12T09:40:00Z",
      serviceName: "Taglio uomo",
      priceCents: 1800,
      staffName: "Luigi",
      customerName: "Mario <b>Rossi</b>",
      customerEmail: "mario@example.com",
      customerPhone: null,
      customerNote: null,
      cancellationReason: null,
      manageTokenNonce: "nonce",
      ...over,
    },
    business: {
      name: "Barberhood",
      timezone: "Europe/Rome",
      currency: "EUR",
      address: "Via Roma 1, Siracusa",
      phone: null,
      email: null,
      logoUrl: null,
      accent: "#e8e4dc",
      slug: "barberhood",
      reviewsUrl: "https://g.page/r/test/review",
      notificationEmail: "shop@example.com",
      replyTo: null,
      ...biz,
    },
    reviewRecentlyRequested: false,
  };
}

class MemoryStore implements NotificationStore {
  log: string[] = [];
  constructor(
    private jobs: NotificationRow[],
    private context: DeliveryContext | null,
  ) {}
  async claim(limit: number) {
    const out = this.jobs.splice(0, limit);
    return out;
  }
  async loadContext() {
    return this.context;
  }
  async complete(id: string, msg: string) {
    this.log.push(`sent:${id}:${msg}`);
  }
  async fail(id: string, error: string, retryable: boolean) {
    this.log.push(`fail:${id}:${retryable}:${error}`);
  }
  async skip(id: string, reason: string) {
    this.log.push(`skip:${id}:${reason}`);
  }
}

function fakeProvider(behaviour: (e: OutgoingEmail) => { id: string } | Error = () => ({ id: "msg_1" })) {
  const sent: OutgoingEmail[] = [];
  const provider: EmailProvider = {
    async send(e) {
      const r = behaviour(e);
      if (r instanceof Error) throw r;
      sent.push(e);
      return r;
    },
  };
  return { provider, sent };
}

const config = (provider: EmailProvider | null) => ({
  provider,
  from: "Barberhood <prenotazioni@example.com>",
  siteUrl: "https://example.com",
  manageUrlFor: (nonce: string) => `https://example.com/gestisci/${nonce}-token`,
  now: () => NOW,
});

describe("skipReason", () => {
  it("sends a review request only after the original end of a done appointment", () => {
    const ENDS = "2026-11-12T09:40:00Z";
    const review = job("review_request", { payload: { ends_at: ENDS } });
    const after = new Date("2026-11-12T12:00:00Z");
    expect(skipReason(review, ctx(), after)).toBeNull();
    expect(skipReason(review, ctx({ status: "completed" }), after)).toBeNull();
    expect(skipReason(review, ctx({ status: "no_show" }), after)).toBe("appointment_not_done");
    expect(skipReason(review, ctx({ status: "cancelled" }), after)).toBe("appointment_not_done");
    expect(skipReason(review, ctx({ endsAt: "2026-11-12T10:00:00Z" }), after)).toBe("appointment_moved");
    expect(skipReason(review, ctx(), NOW)).toBe("appointment_not_ended");
    expect(skipReason(review, ctx(), new Date("2026-11-20T12:00:00Z"))).toBe("too_late");
    expect(skipReason(review, ctx({}, { reviewsUrl: null }), after)).toBe("no_reviews_url");
    expect(skipReason(review, { ...ctx(), reviewRecentlyRequested: true }, after)).toBe("review_recently_requested");
  });

  it("renders the review request with the review link and no price", () => {
    const html = renderEmail({
      kind: "review_request",
      siteUrl: "https://example.com",
      business: ctx().business,
      appointment: { ...ctx().appointment, previousStartsAt: null },
      manageUrl: null,
      adminUrl: "https://example.com/admin",
    });
    expect(html.html).toContain("https://g.page/r/test/review");
    expect(html.text).toContain("Lascia una recensione: https://g.page/r/test/review");
    expect(html.text).not.toContain("Prezzo");
    expect(html.subject).toContain("Mario");
  });

  it("sends a reminder only for the original start time of a confirmed future appointment", () => {
    expect(skipReason(job("reminder"), ctx(), NOW)).toBeNull();
    expect(skipReason(job("reminder"), ctx({ startsAt: "2026-11-13T09:00:00Z" }), NOW)).toBe("appointment_moved");
    expect(skipReason(job("reminder"), ctx({ status: "cancelled" }), NOW)).toBe("appointment_not_confirmed");
    expect(skipReason(job("reminder"), ctx(), new Date("2026-11-12T09:30:00Z"))).toBe("appointment_started");
  });

  it("does not send a cancellation email for an appointment that is confirmed again", () => {
    expect(skipReason(job("booking_cancelled"), ctx(), NOW)).toBe("appointment_not_cancelled");
    expect(skipReason(job("booking_cancelled"), ctx({ status: "cancelled" }), NOW)).toBeNull();
  });

  it("needs a recipient address", () => {
    expect(skipReason(job("booking_confirmed"), ctx({ customerEmail: null }), NOW)).toBe("no_customer_email");
    expect(skipReason(job("owner_new_booking"), ctx({}, { notificationEmail: null }), NOW)).toBe("no_business_email");
    expect(skipReason(job("booking_confirmed"), null, NOW)).toBe("appointment_missing");
  });
});

describe("processNotifications", () => {
  it("claims nothing when email is not configured (jobs stay pending)", async () => {
    const store = new MemoryStore([job("booking_confirmed")], ctx());
    const r = await processNotifications(store, config(null));
    expect(r).toEqual({ claimed: 0, sent: 0, skipped: 0, failed: 0 });
    expect(store.log).toEqual([]);
  });

  it("sends with the job idempotency key and records the provider id", async () => {
    const n = job("booking_confirmed");
    const store = new MemoryStore([n], ctx());
    const { provider, sent } = fakeProvider();
    const r = await processNotifications(store, config(provider));
    expect(r.sent).toBe(1);
    expect(sent[0]!.to).toBe("mario@example.com");
    expect(sent[0]!.idempotencyKey).toBe(n.idempotency_key);
    expect(sent[0]!.html).toContain("https://example.com/gestisci/nonce-token");
    expect(store.log).toEqual([`sent:${n.id}:msg_1`]);
  });

  it("sends owner notifications to the shop with reply-to the customer", async () => {
    const store = new MemoryStore([job("owner_new_booking")], ctx());
    const { provider, sent } = fakeProvider();
    await processNotifications(store, config(provider));
    expect(sent[0]!.to).toBe("shop@example.com");
    expect(sent[0]!.replyTo).toBe("mario@example.com");
    expect(sent[0]!.html).toContain("https://example.com/admin/appuntamenti/a");
  });

  it("skips a reminder for a moved appointment without calling the provider", async () => {
    const n = job("reminder", { payload: { starts_at: "2026-11-11T09:00:00Z" } });
    const store = new MemoryStore([n], ctx());
    const { provider, sent } = fakeProvider();
    const r = await processNotifications(store, config(provider));
    expect(r.skipped).toBe(1);
    expect(sent).toHaveLength(0);
    expect(store.log).toEqual([`skip:${n.id}:appointment_moved`]);
  });

  it("marks provider errors as retryable or permanent", async () => {
    const a = job("booking_confirmed", { id: "temp" });
    const b = job("booking_confirmed", { id: "perm" });
    const store = new MemoryStore([a, b], ctx());
    const { provider } = fakeProvider((e) => (e.idempotencyKey && store.log.length === 0 ? new ProviderError("rate_limited", true) : new ProviderError("invalid_to", false)));
    const r = await processNotifications(store, config(provider));
    expect(r.failed).toBe(2);
    expect(store.log).toEqual(["fail:temp:true:rate_limited", "fail:perm:false:invalid_to"]);
  });

  it("never sends WhatsApp (channel not implemented)", async () => {
    const n = job("booking_confirmed", { channel: "whatsapp" });
    const store = new MemoryStore([n], ctx());
    const { provider, sent } = fakeProvider();
    await processNotifications(store, config(provider));
    expect(sent).toHaveLength(0);
    expect(store.log).toEqual([`skip:${n.id}:channel_not_supported`]);
  });
});

describe("renderEmail", () => {
  const base = (kind: NotificationKind) => {
    const c = ctx();
    return renderEmail({
      kind,
      siteUrl: "https://example.com",
      business: c.business,
      appointment: { ...c.appointment, previousStartsAt: "2026-11-11T15:00:00Z", cancellationReason: "Imprevisto <script>" },
      manageUrl: "https://example.com/gestisci/x",
      adminUrl: "https://example.com/admin/appuntamenti/a",
    });
  };

  it("escapes user-provided content", () => {
    const r = base("owner_new_booking");
    expect(r.html).not.toContain("<b>Rossi</b>");
    expect(r.html).toContain(escapeHtml("Mario <b>Rossi</b>"));
    expect(base("booking_cancelled").html).not.toContain("<script>");
  });

  it("shows times in the business timezone and has a plain-text part", () => {
    for (const kind of ["booking_confirmed", "booking_rescheduled", "booking_cancelled", "reminder", "owner_new_booking", "owner_booking_cancelled"] as const) {
      const r = base(kind);
      expect(r.subject.length).toBeGreaterThan(5);
      expect(r.text).toContain("10:00"); // 09:00Z = 10:00 in Rome (CET)
      expect(r.html).toContain("Barberhood");
    }
    expect(base("booking_rescheduled").text).toContain("16:00"); // previous time
  });
});
