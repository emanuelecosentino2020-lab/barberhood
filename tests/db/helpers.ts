import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Pool, type PoolClient } from "pg";

export const ADMIN_URL = process.env.TEST_DATABASE_URL ?? "";
export const hasDatabase = ADMIN_URL.length > 0;

const root = path.resolve(__dirname, "../..");

function migrationFiles(): string[] {
  const dir = path.join(root, "supabase/migrations");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => path.join(dir, f));
}

/** Creates a fresh database with the Supabase shim and all migrations applied. */
export async function createTestDatabase(name: string): Promise<Pool> {
  const admin = new Pool({ connectionString: ADMIN_URL, max: 1 });
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.query(`create database ${name}`);
  await admin.end();

  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  const pool = new Pool({ connectionString: url.toString(), max: 10 });
  const client = await pool.connect();
  try {
    await client.query("set client_min_messages = warning");
    await client.query(readFileSync(path.join(root, "tests/db/supabase-shim.sql"), "utf8"));
    for (const file of migrationFiles()) {
      await client.query(readFileSync(file, "utf8"));
    }
  } finally {
    client.release();
  }
  return pool;
}

type Role = "anon" | "authenticated" | "service_role";

/** Runs fn inside a transaction impersonating a PostgREST role (and user). */
export async function asRole<T>(
  pool: Pool,
  role: Role,
  userId: string | null,
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`set local role ${role}`);
    const claims = JSON.stringify(userId ? { sub: userId, role } : { role });
    await client.query("select set_config('request.jwt.claims', $1, true)", [claims]);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export const asService = <T>(pool: Pool, fn: (c: PoolClient) => Promise<T>) => asRole(pool, "service_role", null, fn);
export const asUser = <T>(pool: Pool, userId: string, fn: (c: PoolClient) => Promise<T>) =>
  asRole(pool, "authenticated", userId, fn);
export const asAnon = <T>(pool: Pool, fn: (c: PoolClient) => Promise<T>) => asRole(pool, "anon", null, fn);

export interface Fixture {
  businessId: string;
  staffIds: string[];
  serviceId: string;
  bufferedServiceId: string;
  ownerId: string;
  staffUserId: string;
}

let counter = 0;

/** Superuser-created tenant with 2 staff, 2 services, Mon-Sun 09-19 hours. */
export async function createFixture(pool: Pool, slug: string): Promise<Fixture> {
  counter += 1;
  const q = (sql: string, params: unknown[] = []) => pool.query(sql, params);
  const business = await q(
    `insert into businesses (slug, name, notification_email, reminder_hours_before)
     values ($1, $2, 'owner@example.com', 24) returning id`,
    [slug, `Test ${slug}`],
  );
  const businessId: string = business.rows[0].id;
  const staff = await q(
    `insert into staff (business_id, display_name) values ($1, 'A'), ($1, 'B') returning id`,
    [businessId],
  );
  const staffIds: string[] = staff.rows.map((r) => r.id);
  const svc = await q(
    `insert into services (business_id, name, price_cents, duration_minutes, buffer_after_minutes)
     values ($1, 'Taglio', 2000, 30, 0), ($1, 'Rasatura', 2500, 30, 15) returning id`,
    [businessId],
  );
  const [serviceId, bufferedServiceId] = svc.rows.map((r) => r.id as string);
  await q(
    `insert into staff_services (business_id, staff_id, service_id)
     select $1, s.id, v.id from staff s, services v where s.business_id = $1 and v.business_id = $1`,
    [businessId],
  );
  await q(
    `insert into working_hours (business_id, weekday, start_time, end_time)
     select $1, d, '09:00', '19:00' from generate_series(1, 7) d`,
    [businessId],
  );
  const owner = await q(`insert into auth.users (email) values ($1) returning id`, [`owner${counter}@t.test`]);
  const staffUser = await q(`insert into auth.users (email) values ($1) returning id`, [`staff${counter}@t.test`]);
  const ownerId: string = owner.rows[0].id;
  const staffUserId: string = staffUser.rows[0].id;
  await q(`insert into business_members (business_id, user_id, role) values ($1, $2, 'owner'), ($1, $3, 'staff')`, [
    businessId,
    ownerId,
    staffUserId,
  ]);
  return { businessId, staffIds, serviceId, bufferedServiceId, ownerId, staffUserId };
}

/** A future instant aligned to the hour, `daysAhead` days from now. */
export function futureAt(daysAhead: number, hourUtc: number, minute = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysAhead);
  d.setUTCHours(hourUtc, minute, 0, 0);
  return d.toISOString();
}

export async function bookAsService(
  pool: Pool,
  f: Fixture,
  startsAt: string,
  opts: { staffId?: string; serviceId?: string; email?: string } = {},
) {
  return asService(pool, async (c) => {
    const { rows } = await c.query(
      `select * from create_appointment(
         p_business_id => $1, p_service_id => $2, p_staff_id => $3, p_starts_at => $4,
         p_customer_name => 'Mario Rossi', p_customer_email => $5, p_customer_phone => '+39 333 0000000')`,
      [f.businessId, opts.serviceId ?? f.serviceId, opts.staffId ?? f.staffIds[0], startsAt, opts.email ?? "mario@example.com"],
    );
    return rows[0];
  });
}
