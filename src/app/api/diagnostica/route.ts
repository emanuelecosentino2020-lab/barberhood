import { createClient } from "@supabase/supabase-js";
import { connection } from "next/server";
import { getPublicCatalog } from "@/server/public";

/**
 * Temporary setup check: tells which configuration is present and whether the
 * database answers, WITHOUT printing any secret value (only presence and the
 * key type). Remove once the deploy is verified.
 */
function keyKind(value: string | undefined): string {
  if (!value) return "MANCANTE";
  const v = value.trim();
  if (v !== value) return "presente ma con spazi all'inizio o alla fine";
  if (v.startsWith("sb_publishable_")) return "presente (chiave publishable)";
  if (v.startsWith("sb_secret_")) return "presente (chiave secret)";
  if (v.startsWith("eyJ")) {
    try {
      const payload = JSON.parse(Buffer.from(v.split(".")[1] ?? "", "base64url").toString()) as { role?: string };
      return `presente (chiave legacy, ruolo: ${payload.role ?? "sconosciuto"})`;
    } catch {
      return "presente ma non leggibile";
    }
  }
  return "presente ma formato non riconosciuto";
}

export async function GET() {
  await connection();
  const e = process.env;
  const url = e.NEXT_PUBLIC_SUPABASE_URL;
  const publishable = e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? e.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const secret = e.SUPABASE_SECRET_KEY ?? e.SUPABASE_SERVICE_ROLE_KEY;
  const slug = e.DEFAULT_BUSINESS_SLUG;
  const lines: string[] = [];
  const add = (k: string, v: string) => lines.push(`${k}: ${v}`);

  add("Sito (Vercel)", e.VERCEL_PROJECT_PRODUCTION_URL ?? e.VERCEL_URL ?? "n/d");
  add("Versione codice", (e.VERCEL_GIT_COMMIT_SHA ?? "n/d").slice(0, 7));
  add("NEXT_PUBLIC_SUPABASE_URL", !url ? "MANCANTE" : /^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(url.trim()) ? `ok (${url.trim()})` : `formato strano: "${url.slice(0, 60)}"`);
  add("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", keyKind(publishable));
  add("SUPABASE_SECRET_KEY", keyKind(secret));
  add("DEFAULT_BUSINESS_SLUG", slug ? `"${slug}"` : "MANCANTE");
  add("NEXT_PUBLIC_SITE_URL", e.NEXT_PUBLIC_SITE_URL ?? "MANCANTE");
  add("MANAGE_TOKEN_SECRET", e.MANAGE_TOKEN_SECRET ? (e.MANAGE_TOKEN_SECRET.length >= 32 ? "ok" : "troppo corto") : "MANCANTE");
  add("CRON_SECRET", e.CRON_SECRET ? "ok" : "MANCANTE");

  if (url && secret) {
    try {
      const db = createClient(url.trim(), secret.trim(), { auth: { persistSession: false, autoRefreshToken: false } });
      const { data, error } = await db.from("businesses").select("slug, is_active");
      if (error) add("Database", `ERRORE ${error.code ?? ""} ${error.message}`);
      else {
        add("Database", `raggiungibile, attività trovate: ${data.length}`);
        add("Attività nel database", data.map((b) => `${b.slug}${b.is_active ? "" : " (disattivata)"}`).join(", ") || "nessuna (il file SQL non è stato eseguito?)");
        if (slug) add("Attività del sito", data.some((b) => b.slug === slug && b.is_active) ? "TROVATA, tutto ok" : `"${slug}" NON trovata`);
        const { count, error: sErr } = await db.from("services").select("id", { count: "exact", head: true });
        add("Servizi", sErr ? `ERRORE ${sErr.message}` : String(count));
      }
    } catch (err) {
      add("Database", `ERRORE di connessione: ${err instanceof Error ? err.message : "sconosciuto"}`);
    }
  } else {
    add("Database", "non provato: mancano URL o chiave segreta");
  }

  if (slug) {
    try {
      const c = await getPublicCatalog(slug);
      add("Pagina pubblica (stesso codice del sito)", c ? `ok: ${c.services.length} servizi, ${c.staff.length} barbieri` : "VUOTA (pagina non trovata)");
    } catch (err) {
      add("Pagina pubblica (stesso codice del sito)", `ERRORE ${err instanceof Error ? err.message : ""}`);
    }
  }

  return new Response(lines.join("\n") + "\n", {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}
