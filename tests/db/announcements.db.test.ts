import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole, asUser, createFixture, createTestDatabase, hasDatabase, type Fixture } from "./helpers";

describe.skipIf(!hasDatabase)("database: announcements", () => {
  let pool: Pool;
  let f: Fixture;

  beforeAll(async () => {
    pool = await createTestDatabase("booking_test_announcements");
    f = await createFixture(pool, "shop-news");
  });

  afterAll(async () => {
    await pool?.end();
  });

  const insert = (userId: string) =>
    asUser(pool, userId, (c) =>
      c.query(`insert into announcements (business_id, title, video_url) values ($1, 'Chiusi lunedì', 'https://youtu.be/abcdefghijk') returning id`, [f.businessId]),
    );

  it("lets the owner publish and the staff only read", async () => {
    const { rows } = await insert(f.ownerId);
    expect(rows).toHaveLength(1);
    await expect(insert(f.staffUserId)).rejects.toThrow(/row-level security/);
    const seen = await asUser(pool, f.staffUserId, (c) => c.query(`select title from announcements`));
    expect(seen.rows.map((r) => r.title)).toEqual(["Chiusi lunedì"]);
  });

  it("is invisible to anonymous visitors (the public page reads it server-side)", async () => {
    await expect(asRole(pool, "anon", null, (c) => c.query(`select * from announcements`))).rejects.toThrow(/permission denied/);
  });

  it("only accepts https video links", async () => {
    await expect(
      asUser(pool, f.ownerId, (c) => c.query(`insert into announcements (business_id, title, video_url) values ($1, 'x', 'javascript:alert(1)')`, [f.businessId])),
    ).rejects.toThrow(/check constraint/);
  });
});
