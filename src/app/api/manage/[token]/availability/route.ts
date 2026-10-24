import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { firstError, localDate } from "@/lib/validation";
import { availabilityForToken } from "@/server/bookings";
import { BookingError } from "@/server/errors";
import { jsonError, noStore } from "@/server/http";
import { ipKey } from "@/server/request";

const schema = z.object({ from: localDate, days: z.coerce.number().int().min(1).max(31).default(14) });

export async function GET(request: NextRequest, ctx: RouteContext<"/api/manage/[token]/availability">) {
  const { token } = await ctx.params;
  const parsed = schema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return jsonError(new BookingError("invalid_input", firstError(parsed.error)));
  try {
    const result = await availabilityForToken(token, parsed.data.from, parsed.data.days, ipKey(request.headers));
    return NextResponse.json(result, { headers: noStore });
  } catch (err) {
    return jsonError(err);
  }
}
