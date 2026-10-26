import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asService, asUser, bookAsService, createFixture, createTestDatabase, futureAt, hasDatabase, type Fixture } from "./helpers";

describe.skipIf(!hasDatabase)("database: review request after the appointment", () => {
  let pool: Pool;
  let f: Fixture;

  const reviewJobs = async (appointmentId: string) =>
    (
      await pool.query(
        `select status, scheduled_for, idempotency_key from notifications
          where appointment_id = $1 and kind = 'review_request' order by created_at`,
        [appointmentId],
      )
    ).rows as { status: string; scheduled_for: Date; idempotency_key: string }[];

  beforeAll(async () => {
    pool = await createTestDatabase("booking_test_review");
    f = await createFixture(pool, "shop-review");
    await pool.query(`update businesses set reviews_url = 'https://g.page/r/x/review' where id = $1`, [f.businessId]);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("queues one review request a couple of hours after the end", async () => {
    const appt = await bookAsService(pool, f, futureAt(3, 9));
    const jobs = await reviewJobs(appt.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe("pending");
    expect(jobs[0].scheduled_for.getTime()).toBe(new Date(appt.ends_at).getTime() + 2 * 3600_000);
  });

  it("follows a reschedule and is dropped on cancellation", async () => {
    const appt = await bookAsService(pool, f, futureAt(4, 9), { email: "move@example.com" });
    await asService(pool, (c) => c.query(`select reschedule_appointment($1, $2)`, [appt.id, futureAt(4, 11)]));
    let jobs = await reviewJobs(appt.id);
    expect(jobs.map((j) => j.status)).toEqual(["cancelled", "pending"]);
    expect(jobs[1].scheduled_for.getTime()).toBe(new Date(futureAt(4, 11, 30)).getTime() + 2 * 3600_000);

    await asService(pool, (c) => c.query(`select cancel_appointment($1, 'imprevisto')`, [appt.id]));
    jobs = await reviewJobs(appt.id);
    expect(jobs.map((j) => j.status)).toEqual(["cancelled", "cancelled"]);
  });

  it("keeps the request when marked completed and drops it on no-show", async () => {
    const a = await bookAsService(pool, f, futureAt(5, 9), { email: "done@example.com" });
    const b = await bookAsService(pool, f, futureAt(5, 10), { email: "noshow@example.com" });
    await asUser(pool, f.ownerId, (c) => c.query(`select set_appointment_status($1, 'completed')`, [a.id]));
    await asUser(pool, f.ownerId, (c) => c.query(`select set_appointment_status($1, 'no_show')`, [b.id]));
    expect((await reviewJobs(a.id)).map((j) => j.status)).toEqual(["pending"]);
    expect((await reviewJobs(b.id)).map((j) => j.status)).toEqual(["cancelled"]);
  });

  it("queues nothing when the business has no review link or turned it off", async () => {
    await pool.query(`update businesses set review_request_hours_after = 0 where id = $1`, [f.businessId]);
    const off = await bookAsService(pool, f, futureAt(6, 9), { email: "off@example.com" });
    expect(await reviewJobs(off.id)).toHaveLength(0);
    await pool.query(`update businesses set review_request_hours_after = 2, reviews_url = null where id = $1`, [f.businessId]);
    const noUrl = await bookAsService(pool, f, futureAt(6, 10), { email: "nourl@example.com" });
    expect(await reviewJobs(noUrl.id)).toHaveLength(0);
  });

  it("lets the owner change the delay but not set it out of range", async () => {
    await asUser(pool, f.ownerId, (c) =>
      c.query(`update businesses set review_request_hours_after = 4 where id = $1`, [f.businessId]),
    );
    const { rows } = await pool.query(`select review_request_hours_after from businesses where id = $1`, [f.businessId]);
    expect(rows[0].review_request_hours_after).toBe(4);
    await expect(
      asUser(pool, f.ownerId, (c) => c.query(`update businesses set review_request_hours_after = 500 where id = $1`, [f.businessId])),
    ).rejects.toMatchObject({ code: "23514" });
  });
});
