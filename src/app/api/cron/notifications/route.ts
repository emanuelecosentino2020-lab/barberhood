import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { noStore } from "@/server/http";
import { runNotificationWorker } from "@/server/notifications/supabase-store";

function authorized(request: NextRequest, secret: string | undefined): boolean {
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  return header.length === expected.length && timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

/**
 * Notification worker, triggered every few minutes by Supabase pg_cron
 * (or Vercel Cron). Protected by CRON_SECRET.
 */
async function handle(request: NextRequest) {
  const env = serverEnv();
  if (!authorized(request, env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: noStore });
  }
  const total = { claimed: 0, sent: 0, skipped: 0, failed: 0 };
  // Drain in batches, bounded so one run never exceeds the function timeout
  for (let i = 0; i < 4; i++) {
    const r = await runNotificationWorker({ limit: 25 });
    total.claimed += r.claimed;
    total.sent += r.sent;
    total.skipped += r.skipped;
    total.failed += r.failed;
    if (r.claimed < 25) break;
  }
  // Daily-ish privacy housekeeping (cheap, idempotent)
  if (new Date().getUTCHours() === 3 && new Date().getUTCMinutes() < 10) {
    await createAdminClient().rpc("purge_inactive_customers");
  }
  return NextResponse.json({ ok: true, emailConfigured: Boolean(env.RESEND_API_KEY && env.EMAIL_FROM), ...total }, { headers: noStore });
}

export const GET = handle;
export const POST = handle;
