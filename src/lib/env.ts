import "server-only";
import { z } from "zod";

/**
 * Server-side environment, validated lazily on first use so that `next build`
 * works without secrets and a misconfiguration fails loudly at runtime.
 */
const serverSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  SUPABASE_SECRET_KEY: z.string().min(20),
  NEXT_PUBLIC_SITE_URL: z.url().default("http://localhost:3000"),
  DEFAULT_BUSINESS_SLUG: z.string().min(1).optional(),
  RESEND_API_KEY: z.string().min(10).optional(),
  EMAIL_FROM: z.string().min(3).optional(),
  CRON_SECRET: z.string().min(16).optional(),
  TURNSTILE_SECRET_KEY: z.string().min(10).optional(),
  MANAGE_TOKEN_SECRET: z.string().min(32, "MANAGE_TOKEN_SECRET deve avere almeno 32 caratteri"),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || undefined,
    DEFAULT_BUSINESS_SLUG: process.env.DEFAULT_BUSINESS_SLUG || undefined,
    RESEND_API_KEY: process.env.RESEND_API_KEY || undefined,
    EMAIL_FROM: process.env.EMAIL_FROM || undefined,
    CRON_SECRET: process.env.CRON_SECRET || undefined,
    TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY || undefined,
    MANAGE_TOKEN_SECRET: process.env.MANAGE_TOKEN_SECRET,
  });
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Configurazione mancante o non valida: ${missing}. Vedi .env.example`);
  }
  cached = parsed.data;
  return cached;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  );
}
