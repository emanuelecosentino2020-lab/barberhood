import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/db/**/*.test.ts"],
    testTimeout: 20_000,
    hookTimeout: 60_000,
    // DB suites create their own databases; run files in parallel, tests in order
    fileParallelism: true,
  },
});
