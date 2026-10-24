import "server-only";

/**
 * Optional Cloudflare Turnstile verification (free). Enabled only when
 * TURNSTILE_SECRET_KEY is configured; otherwise honeypot + timing + rate
 * limits protect the public form.
 */
export async function verifyTurnstile(secret: string | undefined, token: string | undefined, ip: string): Promise<boolean> {
  if (!secret) return true;
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret, response: token, remoteip: ip });
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      signal: AbortSignal.timeout(5000),
    });
    const json = (await res.json()) as { success?: boolean };
    return json.success === true;
  } catch {
    return false;
  }
}
