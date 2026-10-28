/**
 * Host-based routing for the agency domain (ROOT_DOMAIN, e.g. agendafacile.it):
 *
 *   agendafacile.it, www.agendafacile.it  -> agency landing page
 *   admin.agendafacile.it                 -> dashboard
 *   demo.agendafacile.it                  -> business "demo-barbiere" (alias)
 *   <slug>.agendafacile.it                -> business <slug>, with clean URLs (/, /prenota, /privacy)
 *
 * Any other host (vercel.app, a shop's own domain) keeps the path-based routes.
 * Pure functions: used by src/proxy.ts and unit-tested.
 */

/** Subdomains that are not businesses */
const RESERVED = new Set(["www", "admin", "app", "api", "mail", "email"]);

/** Short subdomains that point to a longer business slug */
export const SUBDOMAIN_ALIASES: Record<string, string> = { demo: "demo-barbiere" };

/** Request header the proxy sets on business subdomains (always overwritten, never trusted from the client). */
export const TENANT_HEADER = "x-tenant-slug";

export const LANDING_PATH = "/landing/index.html";

/** Public pages of a business, relative to its base path */
const TENANT_PAGES = ["/", "/prenota", "/privacy"];

/** Routes shared by every host */
const SHARED_PREFIXES = ["/admin", "/api", "/gestisci", "/_next", "/brand", "/landing"];

export type HostRoute =
  | { kind: "other" }
  | { kind: "landing" }
  | { kind: "admin" }
  | { kind: "tenant"; slug: string };

export function resolveHost(rawHost: string | null, rootDomain: string | undefined): HostRoute {
  const root = rootDomain?.trim().toLowerCase().replace(/^www\./, "");
  if (!root || !rawHost) return { kind: "other" };
  const host = rawHost.toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  if (host === root || host === `www.${root}`) return { kind: "landing" };
  if (!host.endsWith(`.${root}`)) return { kind: "other" };
  const sub = host.slice(0, -(root.length + 1));
  if (sub.includes(".")) return { kind: "other" };
  if (sub === "admin") return { kind: "admin" };
  if (RESERVED.has(sub)) return { kind: "landing" };
  const slug = SUBDOMAIN_ALIASES[sub] ?? sub;
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) ? { kind: "tenant", slug } : { kind: "other" };
}

export type TenantAction = { type: "rewrite"; path: string } | { type: "redirect"; path: string } | { type: "pass" };

/** What to do with a path on a business subdomain. */
export function tenantPath(slug: string, pathname: string): TenantAction {
  const prefix = `/${slug}`;
  // Old path-based links (/demo-barbiere/prenota) -> clean URL
  if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
    return { type: "redirect", path: pathname.slice(prefix.length) || "/" };
  }
  const clean = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  if (TENANT_PAGES.includes(clean)) {
    return { type: "rewrite", path: clean === "/" ? prefix : `${prefix}${clean}` };
  }
  // /admin, /api, /gestisci, static files: same as on any host
  if (SHARED_PREFIXES.some((p) => clean === p || clean.startsWith(`${p}/`)) || /\.[a-z0-9]+$/i.test(clean)) {
    return { type: "pass" };
  }
  // Anything else stays inside this business (so another slug is never reachable here): usually a 404
  return { type: "rewrite", path: `${prefix}${clean}` };
}
