/**
 * Creates a new business (tenant) with sensible defaults, one staff member,
 * and Tue-Sat 09:00-19:00 opening hours, ready to be configured from the dashboard.
 *
 *   npm run business:create -- --slug nuovo-negozio --name "Nuovo Negozio" --city Roma [--vertical barber|hair|beauty|tattoo|wellness|other] [--staff "Mario Rossi"]
 */
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";

const { values } = parseArgs({
  options: {
    slug: { type: "string" },
    name: { type: "string" },
    city: { type: "string" },
    vertical: { type: "string", default: "barber" },
    staff: { type: "string" },
  },
});

const STAFF_LABEL: Record<string, string> = {
  barber: "Barbiere",
  hair: "Stilista",
  beauty: "Estetista",
  tattoo: "Artista",
  wellness: "Operatore",
  other: "Professionista",
};

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Imposta NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SECRET_KEY (.env.local)");
  if (!values.slug || !values.name) throw new Error('Uso: --slug <slug> --name "<nome>" [--city <città>]');

  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: business, error } = await db
    .from("businesses")
    .insert({
      slug: values.slug,
      name: values.name,
      city: values.city ?? null,
      vertical: values.vertical,
      staff_label: STAFF_LABEL[values.vertical!] ?? "Professionista",
    })
    .select("id")
    .single();
  if (error) throw new Error(`Creazione fallita: ${error.message}`);

  const { error: sErr } = await db.from("staff").insert({ business_id: business.id, display_name: values.staff ?? values.name });
  if (sErr) throw sErr;
  const hours = [2, 3, 4, 5, 6].map((weekday) => ({ business_id: business.id, weekday, start_time: "09:00", end_time: "19:00" }));
  const { error: hErr } = await db.from("working_hours").insert(hours);
  if (hErr) throw hErr;

  console.log(`✓ Creata "${values.name}" → /${values.slug}`);
  console.log(`  Ora crea il titolare: npm run owner:create -- --business ${values.slug} --email <email>`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
