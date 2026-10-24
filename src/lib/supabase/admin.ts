import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";

let client: SupabaseClient | null = null;

/**
 * Privileged client using the secret (service role) key. Bypasses RLS:
 * only use it in server code that has already validated and authorised the
 * request (public booking flow, notification worker, scripts).
 */
export function createAdminClient(): SupabaseClient {
  if (client) return client;
  const env = serverEnv();
  client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client;
}
