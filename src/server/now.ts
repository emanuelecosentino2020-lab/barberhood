import "server-only";
import { connection } from "next/server";
import { cache } from "react";

/**
 * The request time, read once per request. Marks the render as dynamic
 * (never prerendered) and keeps every "now" comparison on a page consistent.
 */
export const requestNow = cache(async (): Promise<number> => {
  await connection();
  return Date.now();
});
