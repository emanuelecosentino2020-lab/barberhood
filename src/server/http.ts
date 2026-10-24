import "server-only";
import { NextResponse } from "next/server";
import { BookingError } from "./errors";

export function jsonError(err: unknown): NextResponse {
  if (err instanceof BookingError) {
    return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: err.status });
  }
  console.error("[api] unexpected error", err instanceof Error ? err.name : typeof err);
  return NextResponse.json(
    { error: { code: "unavailable", message: "Si è verificato un errore. Riprova tra poco." } },
    { status: 500 },
  );
}

export const noStore = { "Cache-Control": "no-store" } as const;

/** Rejects cross-site form posts to JSON endpoints (defense in depth). */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // non-browser clients
  try {
    return new URL(origin).host === new URL(request.url).host || origin === process.env.NEXT_PUBLIC_SITE_URL;
  } catch {
    return false;
  }
}
