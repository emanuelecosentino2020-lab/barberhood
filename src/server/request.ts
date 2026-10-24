import "server-only";
import { createHash } from "node:crypto";

/** Best-effort client IP (Vercel sets x-forwarded-for / x-real-ip). */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip") || "unknown";
}

/** IPs are personal data: only a truncated hash is used as a rate-limit key. */
export function ipKey(headers: Headers): string {
  return createHash("sha256").update(clientIp(headers)).digest("hex").slice(0, 32);
}
