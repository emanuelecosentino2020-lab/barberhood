import "server-only";
import { headers } from "next/headers";
import { TENANT_HEADER } from "@/lib/hosts";

/** "" on the business's own subdomain (clean URLs), "/<slug>" everywhere else. */
export async function publicBasePath(slug: string): Promise<string> {
  return (await headers()).get(TENANT_HEADER) === slug ? "" : `/${slug}`;
}
