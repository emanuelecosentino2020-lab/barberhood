import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface RateLimitRule {
  name: string;
  limit: number;
  windowSeconds: number;
}

export const RATE_LIMITS = {
  availability: { name: "availability", limit: 120, windowSeconds: 60 },
  booking: { name: "booking", limit: 8, windowSeconds: 600 },
  bookingPerEmail: { name: "booking-email", limit: 4, windowSeconds: 3600 },
  manage: { name: "manage", limit: 30, windowSeconds: 600 },
  login: { name: "login", limit: 10, windowSeconds: 600 },
} satisfies Record<string, RateLimitRule>;

/**
 * Fixed-window limiter backed by Postgres (no extra service to pay for).
 * Fails open on infrastructure errors so a DB hiccup doesn't block real
 * customers; the booking itself is still protected by the database.
 */
export async function isAllowed(db: SupabaseClient, rule: RateLimitRule, key: string): Promise<boolean> {
  const { data, error } = await db.rpc("rate_limit_hit", {
    p_key: `${rule.name}:${key}`,
    p_limit: rule.limit,
    p_window_seconds: rule.windowSeconds,
  });
  if (error) {
    console.error("[rate-limit] check failed", { code: error.code });
    return true;
  }
  return data === true;
}
