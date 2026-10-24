import { after, NextResponse, type NextRequest } from "next/server";
import { firstError, rescheduleSchema } from "@/lib/validation";
import { rescheduleByToken } from "@/server/bookings";
import { BookingError } from "@/server/errors";
import { isSameOrigin, jsonError, noStore } from "@/server/http";
import { runNotificationWorker } from "@/server/notifications/supabase-store";
import { ipKey } from "@/server/request";

export async function POST(request: NextRequest, ctx: RouteContext<"/api/manage/[token]/reschedule">) {
  if (!isSameOrigin(request)) return jsonError(new BookingError("spam"));
  const { token } = await ctx.params;
  const parsed = rescheduleSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return jsonError(new BookingError("invalid_input", firstError(parsed.error)));
  try {
    const result = await rescheduleByToken(token, parsed.data.startsAt, ipKey(request.headers));
    after(() => runNotificationWorker({ limit: 10 }).catch(() => undefined));
    return NextResponse.json(result, { headers: noStore });
  } catch (err) {
    return jsonError(err);
  }
}
