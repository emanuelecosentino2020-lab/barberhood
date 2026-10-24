import { after, NextResponse, type NextRequest } from "next/server";
import { cancelSchema, firstError } from "@/lib/validation";
import { cancelByToken } from "@/server/bookings";
import { BookingError } from "@/server/errors";
import { isSameOrigin, jsonError, noStore } from "@/server/http";
import { runNotificationWorker } from "@/server/notifications/supabase-store";
import { ipKey } from "@/server/request";

export async function POST(request: NextRequest, ctx: RouteContext<"/api/manage/[token]/cancel">) {
  if (!isSameOrigin(request)) return jsonError(new BookingError("spam"));
  const { token } = await ctx.params;
  const parsed = cancelSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return jsonError(new BookingError("invalid_input", firstError(parsed.error)));
  try {
    await cancelByToken(token, parsed.data.reason, ipKey(request.headers));
    after(() => runNotificationWorker({ limit: 10 }).catch(() => undefined));
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch (err) {
    return jsonError(err);
  }
}
