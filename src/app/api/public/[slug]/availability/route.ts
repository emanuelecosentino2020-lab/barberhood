import { NextResponse, type NextRequest } from "next/server";
import { firstError, availabilityQuerySchema } from "@/lib/validation";
import { getPublicAvailability } from "@/server/bookings";
import { BookingError } from "@/server/errors";
import { jsonError, noStore } from "@/server/http";
import { ipKey } from "@/server/request";

export async function GET(request: NextRequest, ctx: RouteContext<"/api/public/[slug]/availability">) {
  const { slug } = await ctx.params;
  const parsed = availabilityQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return jsonError(new BookingError("invalid_input", firstError(parsed.error)));
  try {
    const result = await getPublicAvailability(slug, parsed.data, ipKey(request.headers));
    return NextResponse.json(result, { headers: noStore });
  } catch (err) {
    return jsonError(err);
  }
}
