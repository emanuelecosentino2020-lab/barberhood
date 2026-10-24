import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asAnon,
  asService,
  asUser,
  bookAsService,
  createFixture,
  createTestDatabase,
  futureAt,
  hasDatabase,
  type Fixture,
} from "./helpers";

describe.skipIf(!hasDatabase)("database: bookings, concurrency and notifications", () => {
  let pool: Pool;
  let f: Fixture;

  beforeAll(async () => {
    pool = await createTestDatabase("booking_test_core");
    f = await createFixture(pool, "shop-core");
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("creates an appointment with price snapshot, event and queued notifications", async () => {
    const appt = await bookAsService(pool, f, futureAt(3, 9));
    expect(appt.status).toBe("confirmed");
    expect(appt.price_cents).toBe(2000);
    expect(appt.service_name).toBe("Taglio");
    expect(new Date(appt.ends_at).getTime() - new Date(appt.starts_at).getTime()).toBe(30 * 60_000);

    const events = await pool.query(`select event_type, actor_type from appointment_events where appointment_id = $1`, [appt.id]);
    expect(events.rows).toEqual([{ event_type: "created", actor_type: "customer" }]);

    const notes = await pool.query(
      `select kind, recipient, status from notifications where appointment_id = $1 order by kind`,
      [appt.id],
    );
    expect(notes.rows.map((r) => r.kind).sort()).toEqual(["booking_confirmed", "owner_new_booking", "reminder"]);
  });

  it("rejects an overlapping appointment for the same staff member (23P01)", async () => {
    await bookAsService(pool, f, futureAt(4, 10));
    await expect(bookAsService(pool, f, futureAt(4, 10, 15), { email: "other@example.com" })).rejects.toMatchObject({
      code: "23P01",
    });
  });

  it("allows back-to-back appointments and parallel ones on different staff", async () => {
    await bookAsService(pool, f, futureAt(5, 10));
    await expect(bookAsService(pool, f, futureAt(5, 10, 30), { email: "b2b@example.com" })).resolves.toBeTruthy();
    await expect(
      bookAsService(pool, f, futureAt(5, 10), { staffId: f.staffIds[1], email: "par@example.com" }),
    ).resolves.toBeTruthy();
  });

  it("enforces the service buffer", async () => {
    // 30 min service + 15 min buffer -> busy until 11:45
    await bookAsService(pool, f, futureAt(6, 11), { serviceId: f.bufferedServiceId });
    await expect(bookAsService(pool, f, futureAt(6, 11, 30), { email: "buf@example.com" })).rejects.toMatchObject({
      code: "23P01",
    });
    await expect(bookAsService(pool, f, futureAt(6, 11, 45), { email: "buf2@example.com" })).resolves.toBeTruthy();
  });

  it("lets exactly one of many simultaneous bookings for the same slot win", async () => {
    const start = futureAt(7, 12);
    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) => bookAsService(pool, f, start, { email: `race${i}@example.com` })),
    );
    const ok = attempts.filter((a) => a.status === "fulfilled");
    const failed = attempts.filter((a) => a.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(7);
    for (const r of failed) expect((r.reason as { code: string }).code).toBe("23P01");
  });

  it("reuses the customer record by email (case-insensitive) without overwriting the name", async () => {
    await bookAsService(pool, f, futureAt(8, 9), { email: "Same@Example.com" });
    await asService(pool, (c) =>
      c.query(
        `select create_appointment(p_business_id => $1, p_service_id => $2, p_staff_id => $3, p_starts_at => $4,
           p_customer_name => 'Impostore', p_customer_email => 'same@example.com')`,
        [f.businessId, f.serviceId, f.staffIds[0], futureAt(8, 10)],
      ),
    );
    const { rows } = await pool.query(`select full_name from customers where business_id = $1 and lower(email) = 'same@example.com'`, [
      f.businessId,
    ]);
    expect(rows).toEqual([{ full_name: "Mario Rossi" }]);
  });

  it("refuses bookings inside a time block and in the past", async () => {
    await pool.query(`insert into time_blocks (business_id, starts_at, ends_at, reason) values ($1, $2, $3, 'ferie')`, [
      f.businessId,
      futureAt(9, 0),
      futureAt(10, 0),
    ]);
    await expect(bookAsService(pool, f, futureAt(9, 10))).rejects.toMatchObject({ message: "slot_unavailable" });
    await expect(bookAsService(pool, f, futureAt(-1, 10))).rejects.toMatchObject({ message: "slot_unavailable" });
  });

  it("cancelling frees the slot, cancels the reminder and is idempotent", async () => {
    const start = futureAt(11, 9);
    const appt = await bookAsService(pool, f, start);
    const cancel = () => asService(pool, (c) => c.query(`select * from cancel_appointment($1, 'imprevisto')`, [appt.id]));
    const first = (await cancel()).rows[0];
    expect(first.status).toBe("cancelled");
    expect(first.cancelled_by).toBe("customer");
    await cancel(); // second call is a no-op

    const notes = await pool.query(`select kind, status from notifications where appointment_id = $1`, [appt.id]);
    const byKind = Object.fromEntries(notes.rows.map((r) => [r.kind, r.status]));
    expect(byKind.reminder).toBe("cancelled");
    expect(byKind.booking_cancelled).toBe("pending");
    expect(byKind.owner_booking_cancelled).toBe("pending");
    expect(notes.rows.filter((r) => r.kind === "booking_cancelled")).toHaveLength(1);

    await expect(bookAsService(pool, f, start, { email: "next@example.com" })).resolves.toBeTruthy();
  });

  it("rescheduling moves the appointment, re-checks overlap and replaces the reminder", async () => {
    const appt = await bookAsService(pool, f, futureAt(12, 9));
    const blocker = await bookAsService(pool, f, futureAt(12, 14), { email: "blocker@example.com" });
    expect(blocker).toBeTruthy();

    await expect(
      asService(pool, (c) => c.query(`select * from reschedule_appointment($1, $2)`, [appt.id, futureAt(12, 14, 15)])),
    ).rejects.toMatchObject({ code: "23P01" });

    const moved = (
      await asService(pool, (c) => c.query(`select * from reschedule_appointment($1, $2)`, [appt.id, futureAt(12, 16)]))
    ).rows[0];
    expect(new Date(moved.starts_at).toISOString()).toBe(futureAt(12, 16));
    expect(new Date(moved.ends_at).getTime() - new Date(moved.starts_at).getTime()).toBe(30 * 60_000);

    const reminders = await pool.query(
      `select status, scheduled_for from notifications where appointment_id = $1 and kind = 'reminder' order by created_at`,
      [appt.id],
    );
    expect(reminders.rows.map((r) => r.status)).toEqual(["cancelled", "pending"]);
    expect(new Date(reminders.rows[1].scheduled_for).getTime()).toBe(new Date(futureAt(12, 16)).getTime() - 24 * 3600_000);

    const events = await pool.query(`select event_type from appointment_events where appointment_id = $1 order by created_at`, [appt.id]);
    expect(events.rows.map((r) => r.event_type)).toEqual(["created", "rescheduled"]);

    // Old slot is free again
    await expect(bookAsService(pool, f, futureAt(12, 9), { email: "free@example.com" })).resolves.toBeTruthy();
  });

  it("moving A -> B -> A revives the original reminder instead of duplicating it", async () => {
    const a = futureAt(13, 9);
    const appt = await bookAsService(pool, f, a);
    await asService(pool, (c) => c.query(`select reschedule_appointment($1, $2)`, [appt.id, futureAt(13, 11)]));
    await asService(pool, (c) => c.query(`select reschedule_appointment($1, $2)`, [appt.id, a]));
    const { rows } = await pool.query(
      `select status, count(*)::int as n from notifications where appointment_id = $1 and kind = 'reminder' group by status`,
      [appt.id],
    );
    const counts = Object.fromEntries(rows.map((r) => [r.status, r.n]));
    expect(counts).toEqual({ pending: 1, cancelled: 1 });
  });

  it("does not schedule a reminder when the appointment is inside the reminder window", async () => {
    const soon = new Date(Date.now() + 3 * 3600_000);
    soon.setUTCMinutes(0, 0, 0);
    const appt = await bookAsService(pool, f, soon.toISOString(), { staffId: f.staffIds[1], email: "soon@example.com" });
    const { rows } = await pool.query(`select kind from notifications where appointment_id = $1 and kind = 'reminder'`, [appt.id]);
    expect(rows).toHaveLength(0);
  });

  describe("notification worker", () => {
    it("claims each due job exactly once across concurrent workers", async () => {
      await pool.query(`update notifications set status = 'sent' where status in ('pending', 'processing')`);
      await bookAsService(pool, f, futureAt(20, 9), { email: "worker@example.com" });
      const claim = () => asService(pool, (c) => c.query(`select id from claim_notifications(10)`));
      const [a, b, c] = await Promise.all([claim(), claim(), claim()]);
      const ids = [...a.rows, ...b.rows, ...c.rows].map((r) => r.id);
      expect(ids.length).toBe(2); // confirmation + owner (reminder is in the future)
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("retries with backoff and gives up after max attempts", async () => {
      await pool.query(`update notifications set status = 'sent' where status in ('pending', 'processing')`);
      const appt = await bookAsService(pool, f, futureAt(21, 9), { email: "retry@example.com" });
      const { rows } = await pool.query(
        `select id from notifications where appointment_id = $1 and kind = 'booking_confirmed'`,
        [appt.id],
      );
      const id = rows[0].id;
      await pool.query(`update notifications set max_attempts = 2 where id = $1`, [id]);

      await asService(pool, (c) => c.query(`select claim_notifications(50)`));
      await asService(pool, (c) => c.query(`select fail_notification($1, 'timeout', true)`, [id]));
      let row = (await pool.query(`select status, attempts, scheduled_for from notifications where id = $1`, [id])).rows[0];
      expect(row.status).toBe("pending");
      expect(row.attempts).toBe(1);
      expect(new Date(row.scheduled_for).getTime()).toBeGreaterThan(Date.now() + 60_000);

      await pool.query(`update notifications set scheduled_for = now() where id = $1`, [id]);
      await asService(pool, (c) => c.query(`select claim_notifications(50)`));
      await asService(pool, (c) => c.query(`select fail_notification($1, 'timeout', true)`, [id]));
      row = (await pool.query(`select status, attempts from notifications where id = $1`, [id])).rows[0];
      expect(row).toEqual({ status: "failed", attempts: 2 });
    });

    it("marks a job as sent only once", async () => {
      await pool.query(`update notifications set status = 'sent' where status in ('pending', 'processing')`);
      await bookAsService(pool, f, futureAt(22, 9), { email: "sent@example.com" });
      const claimed = await asService(pool, (c) => c.query(`select id from claim_notifications(1)`));
      const id = claimed.rows[0].id;
      await asService(pool, (c) => c.query(`select complete_notification($1, 'msg_1')`, [id]));
      await asService(pool, (c) => c.query(`select complete_notification($1, 'msg_2')`, [id]));
      const row = (await pool.query(`select status, provider_message_id from notifications where id = $1`, [id])).rows[0];
      expect(row).toEqual({ status: "sent", provider_message_id: "msg_1" });
    });
  });

  it("rate_limit_hit allows up to the limit within a window", async () => {
    const results: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await asService(pool, (c) => c.query(`select rate_limit_hit('ip:1.2.3.4', 3, 60) as ok`));
      results.push(r.rows[0].ok);
    }
    expect(results).toEqual([true, true, true, false]);
  });

  it("anon cannot call booking functions nor the worker API", async () => {
    await expect(
      asAnon(pool, (c) =>
        c.query(`select create_appointment($1, $2, $3, $4, 'x', 'x@example.com')`, [
          f.businessId,
          f.serviceId,
          f.staffIds[0],
          futureAt(30, 9),
        ]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(asAnon(pool, (c) => c.query(`select claim_notifications(10)`))).rejects.toMatchObject({ code: "42501" });
    await expect(asUser(pool, f.ownerId, (c) => c.query(`select claim_notifications(10)`))).rejects.toMatchObject({
      code: "42501",
    });
    await expect(asAnon(pool, (c) => c.query(`select rate_limit_hit('x', 1, 60)`))).rejects.toMatchObject({ code: "42501" });
  });
});
