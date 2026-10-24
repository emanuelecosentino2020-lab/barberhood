import { after, NextResponse, type NextRequest } from "next/server";
import { firstError, publicBookingSchema } from "@/lib/validation";
import { createPublicBooking } from "@/server/bookings";
import { BookingError } from "@/server/errors";
import { isSameOrigin, jsonError, noStore } from "@/server/http";
import { isEmailConfigured, runNotificationWorker } from "@/server/notifications/supabase-store";
import { clientIp, ipKey } from "@/server/request";

export async function POST(request: NextRequest, ctx: RouteContext<"/api/public/[slug]/bookings">) {
  if (!isSameOrigin(request)) return jsonError(new BookingError("spam"));
  const { slug } = await ctx.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(new BookingError("invalid_input"));
  }
  const parsed = publicBookingSchema.safeParse(body);
  if (!parsed.success) return jsonError(new BookingError("invalid_input", firstError(parsed.error)));

  try {
    const booking = await createPublicBooking(slug, parsed.data, { key: ipKey(request.headers), ip: clientIp(request.headers) });
    // Send the confirmation right away, after the response; the cron job is the safety net.
    after(async () => {
      try {
        await runNotificationWorker({ appointmentId: booking.appointmentId, limit: 5 });
      } catch {
        console.error("[notifications] immediate send failed, cron will retry");
      }
    });
    return NextResponse.json({ ...booking, emailEnabled: isEmailConfigured() }, { status: 201, headers: noStore });
  } catch (err) {
    return jsonError(err);
  }
}
