import { describe, expect, it } from "vitest";
import { computeAvailability, resolveSlot, type AvailabilityQuery, type WeeklyHours } from "./availability";
import { formatTime, localToEpoch } from "./time";

const ZONE = "Europe/Rome";
const A = "staff-a";
const B = "staff-b";

// Tue-Sat 09:00-13:00 and 14:30-19:30
const shopHours: WeeklyHours[] = [2, 3, 4, 5, 6].flatMap((weekday) => [
  { staffId: null, weekday, start: "09:00", end: "13:00" },
  { staffId: null, weekday, start: "14:30", end: "19:30" },
]);

function query(overrides: Partial<AvailabilityQuery> = {}): AvailabilityQuery {
  return {
    rules: { timezone: ZONE, slotIntervalMinutes: 30, minNoticeMinutes: 60, maxAdvanceDays: 60 },
    durationMinutes: 30,
    bufferMinutes: 0,
    staffIds: [A],
    weekly: shopHours,
    overrides: [],
    busy: [],
    from: "2026-11-10",
    to: "2026-11-10",
    // Monday 2026-11-09 12:00 Rome
    now: new Date("2026-11-09T11:00:00Z"),
    ...overrides,
  };
}

const times = (q: AvailabilityQuery) => computeAvailability(q).flatMap((d) => d.slots.map((s) => formatTime(s.start, ZONE)));
const at = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return localToEpoch(date, h * 60 + m, ZONE);
};

describe("computeAvailability: opening hours", () => {
  it("generates slots inside opening intervals, respecting the lunch break and closing time", () => {
    const t = times(query());
    expect(t[0]).toBe("09:00");
    expect(t).toContain("12:30"); // last morning slot ends exactly at 13:00
    expect(t).not.toContain("13:00");
    expect(t).not.toContain("14:00");
    expect(t).toContain("14:30");
    expect(t[t.length - 1]).toBe("19:00");
    expect(t).toHaveLength(8 + 10);
  });

  it("does not offer a slot whose service would end after closing", () => {
    const t = times(query({ durationMinutes: 45 }));
    expect(t).toContain("12:00"); // 12:00-12:45
    expect(t).not.toContain("12:30"); // 12:30-13:15 would cross the break
    expect(t[t.length - 1]).toBe("18:30");
  });

  it("returns no slots on closed weekdays", () => {
    expect(times(query({ from: "2026-11-15", to: "2026-11-16" }))).toEqual([]); // Sun, Mon
  });

  it("a date override closes a day or replaces its hours", () => {
    expect(times(query({ overrides: [{ staffId: null, date: "2026-11-10", isClosed: true }] }))).toEqual([]);
    const t = times(query({ overrides: [{ staffId: null, date: "2026-11-10", isClosed: false, start: "10:00", end: "11:00" }] }));
    expect(t).toEqual(["10:00", "10:30"]);
  });

  it("an override can open a day that is normally closed", () => {
    const t = times(query({ from: "2026-11-16", to: "2026-11-16", overrides: [{ staffId: null, date: "2026-11-16", isClosed: false, start: "09:00", end: "10:00" }] }));
    expect(t).toEqual(["09:00", "09:30"]);
  });

  it("staff hours are clipped to business hours", () => {
    const t = times(
      query({ weekly: [...shopHours, { staffId: A, weekday: 2, start: "08:00", end: "10:00" }] }),
    );
    expect(t).toEqual(["09:00", "09:30"]);
  });

  it("a staff member with own schedule but no row that weekday is off", () => {
    const t = times(query({ weekly: [...shopHours, { staffId: A, weekday: 3, start: "09:00", end: "19:00" }] }));
    expect(t).toEqual([]);
  });

  it("staff day-off override only affects that staff member", () => {
    const q = query({ staffIds: [A, B], overrides: [{ staffId: A, date: "2026-11-10", isClosed: true }] });
    const day = computeAvailability(q)[0];
    expect(day.slots.length).toBe(18);
    expect(day.slots.every((s) => s.staffIds.length === 1 && s.staffIds[0] === B)).toBe(true);
  });

  it("supports intervals ending at midnight", () => {
    const t = times(query({ weekly: [{ staffId: null, weekday: 2, start: "23:00", end: "24:00" }] }));
    expect(t).toEqual(["23:00", "23:30"]);
  });
});

describe("computeAvailability: existing bookings, blocks and buffers", () => {
  it("removes slots overlapping an existing appointment", () => {
    const busy = [{ staffId: A, start: at("2026-11-10", "10:00"), end: at("2026-11-10", "10:45"), appointmentId: "x" }];
    const t = times(query({ busy }));
    expect(t).toContain("09:30");
    expect(t).not.toContain("10:00");
    expect(t).not.toContain("10:30");
    expect(t).toContain("11:00");
  });

  it("the buffer after a service blocks the following slot", () => {
    const busy = [{ staffId: A, start: at("2026-11-10", "10:00"), end: at("2026-11-10", "10:30"), appointmentId: "x" }];
    const t = times(query({ busy, bufferMinutes: 15 }));
    expect(t).not.toContain("09:30"); // 09:30-10:00 + 15 min buffer overlaps 10:00
    expect(t).toContain("09:00");
    expect(t).toContain("10:30");
  });

  it("a business-wide time block (holiday) removes every staff member", () => {
    const busy = [{ staffId: null, start: at("2026-11-10", "00:00"), end: at("2026-11-11", "00:00") }];
    expect(times(query({ staffIds: [A, B], busy }))).toEqual([]);
  });

  it("multi-day vacations for one staff member", () => {
    const busy = [{ staffId: A, start: at("2026-11-09", "00:00"), end: at("2026-11-14", "00:00") }];
    const days = computeAvailability(query({ busy, from: "2026-11-10", to: "2026-11-14" }));
    expect(days.slice(0, 4).every((d) => d.slots.length === 0)).toBe(true);
    expect(days[4].slots.length).toBeGreaterThan(0); // Saturday back at work
  });

  it("the appointment being rescheduled does not block itself", () => {
    const busy = [{ staffId: A, start: at("2026-11-10", "10:00"), end: at("2026-11-10", "10:30"), appointmentId: "me" }];
    expect(times(query({ busy, excludeAppointmentId: "me" }))).toContain("10:00");
  });

  it("merges staff: a slot is offered while at least one staff member is free", () => {
    const busy = [{ staffId: A, start: at("2026-11-10", "09:00"), end: at("2026-11-10", "09:30"), appointmentId: "x" }];
    const day = computeAvailability(query({ staffIds: [A, B], busy }))[0];
    const nine = day.slots.find((s) => formatTime(s.start, ZONE) === "09:00");
    expect(nine?.staffIds).toEqual([B]);
  });

  it("offers the least busy staff member first", () => {
    const busy = [{ staffId: A, start: at("2026-11-10", "15:00"), end: at("2026-11-10", "15:30"), appointmentId: "x" }];
    const day = computeAvailability(query({ staffIds: [A, B], busy }))[0];
    expect(day.slots[0].staffIds).toEqual([B, A]);
  });
});

describe("computeAvailability: booking window rules", () => {
  it("applies the minimum notice", () => {
    // now = Tue 10/11 09:10 Rome, notice 60 -> first slot 10:30
    const t = times(query({ now: new Date("2026-11-10T08:10:00Z") }));
    expect(t[0]).toBe("10:30");
  });

  it("never offers past dates", () => {
    expect(times(query({ from: "2026-11-03", to: "2026-11-03" }))).toEqual([]);
  });

  it("applies the maximum advance horizon", () => {
    const days = computeAvailability(query({ from: "2026-11-10", to: "2027-03-01", rules: { ...query().rules, maxAdvanceDays: 7 } }));
    expect(days[days.length - 1].date).toBe("2026-11-16");
  });

  it("admins can ignore the booking window, but not overlaps", () => {
    const busy = [{ staffId: A, start: at("2026-11-03", "09:00"), end: at("2026-11-03", "09:30"), appointmentId: "x" }];
    const t = times(query({ from: "2026-11-03", to: "2026-11-03", ignoreBookingWindow: true, busy }));
    expect(t[0]).toBe("09:30");
  });
});

describe("computeAvailability: daylight saving time (Europe/Rome)", () => {
  const allWeek: WeeklyHours[] = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ staffId: null, weekday, start: "09:00", end: "18:00" }));

  it("keeps 09:00 local on the day clocks go back (CEST -> CET, 25 Oct 2026)", () => {
    const q = query({ weekly: allWeek, from: "2026-10-24", to: "2026-10-26", now: new Date("2026-10-20T10:00:00Z") });
    const days = computeAvailability(q);
    expect(days.map((d) => d.slots[0].start)).toEqual([
      "2026-10-24T07:00:00.000Z", // CEST = UTC+2
      "2026-10-25T08:00:00.000Z", // CET  = UTC+1
      "2026-10-26T08:00:00.000Z",
    ]);
    // Same number of slots each day: the 25-hour day doesn't create phantom slots
    expect(new Set(days.map((d) => d.slots.length)).size).toBe(1);
    expect(days.every((d) => formatTime(d.slots[d.slots.length - 1].start, ZONE) === "17:30")).toBe(true);
  });

  it("keeps 09:00 local on the day clocks go forward (CET -> CEST, 28 Mar 2027)", () => {
    const q = query({ weekly: allWeek, from: "2027-03-27", to: "2027-03-29", now: new Date("2027-03-20T10:00:00Z"), rules: { ...query().rules, maxAdvanceDays: 30 } });
    const days = computeAvailability(q);
    expect(days.map((d) => d.slots[0].start)).toEqual([
      "2027-03-27T08:00:00.000Z",
      "2027-03-28T07:00:00.000Z",
      "2027-03-29T07:00:00.000Z",
    ]);
    expect(new Set(days.map((d) => d.slots.length)).size).toBe(1);
  });

  it("handles an interval that spans the 02:00-03:00 gap", () => {
    const q = query({
      weekly: [{ staffId: null, weekday: 7, start: "01:00", end: "04:00" }],
      from: "2027-03-28",
      to: "2027-03-28",
      now: new Date("2027-03-20T10:00:00Z"),
      rules: { ...query().rules, maxAdvanceDays: 30 },
    });
    const t = computeAvailability(q)[0].slots.map((s) => formatTime(s.start, ZONE));
    // Only 2 real hours exist between 01:00 and 04:00 that night
    expect(t).toEqual(["01:00", "01:30", "03:00", "03:30"]);
  });
});

describe("resolveSlot (server-side re-validation)", () => {
  const base = () => {
    const { from: _f, to: _t, ...rest } = query({ staffIds: [A, B] });
    return rest;
  };

  it("accepts an offered slot and assigns the preferred staff member", () => {
    expect(resolveSlot(base(), new Date(at("2026-11-10", "09:00")).toISOString(), B)).toBe(B);
  });

  it("auto-assigns when no preference", () => {
    expect(resolveSlot(base(), new Date(at("2026-11-10", "09:00")).toISOString(), null)).toBe(A);
  });

  it("rejects a time off the slot grid, outside hours, or already taken", () => {
    expect(resolveSlot(base(), new Date(at("2026-11-10", "09:10")).toISOString(), null)).toBeNull();
    expect(resolveSlot(base(), new Date(at("2026-11-10", "13:30")).toISOString(), null)).toBeNull();
    const busy = [{ staffId: A, start: at("2026-11-10", "09:00"), end: at("2026-11-10", "09:30"), appointmentId: "x" }];
    expect(resolveSlot({ ...base(), busy }, new Date(at("2026-11-10", "09:00")).toISOString(), A)).toBeNull();
    expect(resolveSlot({ ...base(), busy }, new Date(at("2026-11-10", "09:00")).toISOString(), null)).toBe(B);
  });

  it("rejects an unknown staff member and garbage input", () => {
    expect(resolveSlot(base(), new Date(at("2026-11-10", "09:00")).toISOString(), "nope")).toBeNull();
    expect(resolveSlot(base(), "not-a-date", null)).toBeNull();
  });
});
