import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run against a running app connected to a disposable
 * Supabase project (local stack or a staging project), never production:
 * they create real bookings. See docs/TESTING.md.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    locale: "it-IT",
    timezoneId: "America/New_York", // deliberately not the shop's zone: times must still show in Europe/Rome
    trace: "retain-on-failure",
  },
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
});
