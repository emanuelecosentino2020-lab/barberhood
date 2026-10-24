/**
 * Creates (or reuses) an admin account and links it to a business.
 *
 *   npm run owner:create -- --business barberhood --email titolare@example.com [--role owner|admin|staff] [--password '...']
 *
 * Without --password a strong random one is generated and printed once.
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in the environment (.env.local).
 */
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";

const { values } = parseArgs({
  options: {
    business: { type: "string" },
    email: { type: "string" },
    role: { type: "string", default: "owner" },
    password: { type: "string" },
  },
});

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Imposta NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SECRET_KEY (.env.local)");
  if (!values.business || !values.email) throw new Error("Uso: --business <slug> --email <email> [--role owner|admin|staff]");
  if (!["owner", "admin", "staff"].includes(values.role!)) throw new Error("Ruolo non valido");

  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: business, error: bErr } = await db.from("businesses").select("id, name").eq("slug", values.business).maybeSingle();
  if (bErr || !business) throw new Error(`Attività "${values.business}" non trovata`);

  const email = values.email.trim().toLowerCase();
  const password = values.password ?? randomBytes(12).toString("base64url");
  let userId: string | undefined;

  const created = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.data.user) {
    userId = created.data.user.id;
  } else {
    // Already registered: look the user up
    for (let page = 1; page < 50 && !userId; page++) {
      const list = await db.auth.admin.listUsers({ page, perPage: 200 });
      if (list.error) throw list.error;
      userId = list.data.users.find((u) => u.email?.toLowerCase() === email)?.id;
      if (list.data.users.length < 200) break;
    }
    if (!userId) throw created.error ?? new Error("Impossibile creare l'utente");
  }

  const { error: mErr } = await db
    .from("business_members")
    .upsert({ business_id: business.id, user_id: userId, role: values.role }, { onConflict: "business_id,user_id" });
  if (mErr) throw mErr;

  console.log(`✓ ${email} è ${values.role} di ${business.name}`);
  if (created.data.user && !values.password) console.log(`  Password temporanea (cambiala al primo accesso): ${password}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
