import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asAnon,
  asUser,
  bookAsService,
  createFixture,
  createTestDatabase,
  futureAt,
  hasDatabase,
  type Fixture,
} from "./helpers";

describe.skipIf(!hasDatabase)("database: row level security and tenant isolation", () => {
  let pool: Pool;
  let a: Fixture;
  let b: Fixture;
  let apptB: { id: string };

  beforeAll(async () => {
    pool = await createTestDatabase("booking_test_rls");
    a = await createFixture(pool, "shop-a");
    b = await createFixture(pool, "shop-b");
    await bookAsService(pool, a, futureAt(3, 9));
    apptB = await bookAsService(pool, b, futureAt(3, 9));
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("anon sees no rows and cannot write", async () => {
    await expect(asAnon(pool, (c) => c.query(`select * from businesses`))).rejects.toMatchObject({ code: "42501" });
    await expect(asAnon(pool, (c) => c.query(`select * from customers`))).rejects.toMatchObject({ code: "42501" });
    await expect(
      asAnon(pool, (c) => c.query(`insert into services (business_id, name, price_cents, duration_minutes) values ($1, 'x', 1, 10)`, [a.businessId])),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("an owner only sees their own business data", async () => {
    await asUser(pool, a.ownerId, async (c) => {
      const businesses = await c.query(`select id from businesses`);
      expect(businesses.rows.map((r) => r.id)).toEqual([a.businessId]);
      for (const table of ["appointments", "customers", "services", "staff", "notifications", "appointment_events", "working_hours"]) {
        const { rows } = await c.query(`select distinct business_id from ${table}`);
        expect(rows.every((r) => r.business_id === a.businessId), table).toBe(true);
      }
    });
  });

  it("an owner cannot modify another business", async () => {
    await asUser(pool, a.ownerId, async (c) => {
      const upd = await c.query(`update services set price_cents = 1 where business_id = $1`, [b.businessId]);
      expect(upd.rowCount).toBe(0);
      const upd2 = await c.query(`update businesses set name = 'hacked' where id = $1`, [b.businessId]);
      expect(upd2.rowCount).toBe(0);
    });
    await expect(
      asUser(pool, a.ownerId, (c) =>
        c.query(`insert into services (business_id, name, price_cents, duration_minutes) values ($1, 'x', 1, 10)`, [b.businessId]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    const { rows } = await pool.query(`select name from businesses where id = $1`, [b.businessId]);
    expect(rows[0].name).toBe("Test shop-b");
  });

  it("an owner cannot cancel, reschedule or book into another business", async () => {
    await expect(asUser(pool, a.ownerId, (c) => c.query(`select cancel_appointment($1)`, [apptB.id]))).rejects.toMatchObject({
      message: "appointment_not_found",
    });
    await expect(
      asUser(pool, a.ownerId, (c) => c.query(`select reschedule_appointment($1, $2)`, [apptB.id, futureAt(4, 9)])),
    ).rejects.toMatchObject({ message: "appointment_not_found" });
    await expect(
      asUser(pool, a.ownerId, (c) =>
        c.query(`select create_appointment($1, $2, $3, $4, 'x', 'x@example.com')`, [
          b.businessId,
          b.serviceId,
          b.staffIds[0],
          futureAt(5, 9),
        ]),
      ),
    ).rejects.toMatchObject({ message: "business_not_found" });
    const { rows } = await pool.query(`select status from appointments where id = $1`, [apptB.id]);
    expect(rows[0].status).toBe("confirmed");
  });

  it("a member booking is always recorded as source=admin, actor=member", async () => {
    const appt = await asUser(pool, a.staffUserId, async (c) => {
      const { rows } = await c.query(
        `select * from create_appointment(p_business_id => $1, p_service_id => $2, p_staff_id => $3, p_starts_at => $4,
           p_customer_name => 'Walk-in', p_source => 'online')`,
        [a.businessId, a.serviceId, a.staffIds[1], futureAt(6, 9)],
      );
      return rows[0];
    });
    expect(appt.source).toBe("admin");
    const ev = await pool.query(`select actor_type, actor_user_id from appointment_events where appointment_id = $1`, [appt.id]);
    expect(ev.rows[0]).toEqual({ actor_type: "member", actor_user_id: a.staffUserId });
  });

  it("staff role can manage appointments but not services or business settings", async () => {
    await asUser(pool, a.staffUserId, async (c) => {
      const svc = await c.query(`update services set price_cents = 1 where business_id = $1`, [a.businessId]);
      expect(svc.rowCount).toBe(0);
      const biz = await c.query(`update businesses set name = 'x' where id = $1`, [a.businessId]);
      expect(biz.rowCount).toBe(0);
    });
    await asUser(pool, a.ownerId, async (c) => {
      const biz = await c.query(`update businesses set tagline = 'ok' where id = $1`, [a.businessId]);
      expect(biz.rowCount).toBe(1);
    });
  });

  it("owners cannot change platform-level fields (slug, plan, activation)", async () => {
    await expect(
      asUser(pool, a.ownerId, (c) => c.query(`update businesses set plan = 'enterprise' where id = $1`, [a.businessId])),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      asUser(pool, a.ownerId, (c) => c.query(`update businesses set slug = 'stolen' where id = $1`, [a.businessId])),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("the audit trail is append-only and appointments cannot be deleted", async () => {
    await expect(asUser(pool, a.ownerId, (c) => c.query(`delete from appointments`))).rejects.toMatchObject({ code: "42501" });
    await expect(asUser(pool, a.ownerId, (c) => c.query(`update appointment_events set data = '{}'`))).rejects.toMatchObject({
      code: "42501",
    });
    await expect(asUser(pool, a.ownerId, (c) => c.query(`delete from appointment_events`))).rejects.toMatchObject({ code: "42501" });
  });

  it("a user without memberships sees nothing", async () => {
    const { rows } = await pool.query(`insert into auth.users (email) values ('nobody@t.test') returning id`);
    await asUser(pool, rows[0].id, async (c) => {
      for (const table of ["businesses", "appointments", "customers", "services", "business_members"]) {
        const r = await c.query(`select count(*)::int as n from ${table}`);
        expect(r.rows[0].n, table).toBe(0);
      }
    });
  });

  it("set_appointment_status requires a logged-in member", async () => {
    const appt = await bookAsService(pool, a, futureAt(7, 9));
    const done = await asUser(pool, a.ownerId, (c) => c.query(`select * from set_appointment_status($1, 'no_show')`, [appt.id]));
    expect(done.rows[0].status).toBe("no_show");
    await expect(
      asUser(pool, b.ownerId, (c) => c.query(`select set_appointment_status($1, 'completed')`, [appt.id])),
    ).rejects.toMatchObject({ message: "appointment_not_found" });
  });
});
