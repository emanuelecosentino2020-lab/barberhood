import { describe, expect, it } from "vitest";
import { resolveHost, tenantPath } from "./hosts";

const ROOT = "agendafacile.it";

describe("resolveHost", () => {
  it("does nothing without a root domain or on other hosts", () => {
    expect(resolveHost("demo.agendafacile.it", undefined)).toEqual({ kind: "other" });
    expect(resolveHost("barberhood-1p8l.vercel.app", ROOT)).toEqual({ kind: "other" });
    expect(resolveHost("localhost:3000", ROOT)).toEqual({ kind: "other" });
    expect(resolveHost("notagendafacile.it", ROOT)).toEqual({ kind: "other" });
  });

  it("serves the landing on the apex, www and reserved names", () => {
    expect(resolveHost("agendafacile.it", ROOT)).toEqual({ kind: "landing" });
    expect(resolveHost("WWW.AgendaFacile.it:443", ROOT)).toEqual({ kind: "landing" });
    expect(resolveHost("api.agendafacile.it", ROOT)).toEqual({ kind: "landing" });
  });

  it("recognises the dashboard and businesses", () => {
    expect(resolveHost("admin.agendafacile.it", ROOT)).toEqual({ kind: "admin" });
    expect(resolveHost("demo.agendafacile.it", ROOT)).toEqual({ kind: "tenant", slug: "demo-barbiere" });
    expect(resolveHost("salone-aurora.agendafacile.it", ROOT)).toEqual({ kind: "tenant", slug: "salone-aurora" });
  });

  it("ignores nested or malformed subdomains", () => {
    expect(resolveHost("a.b.agendafacile.it", ROOT)).toEqual({ kind: "other" });
    expect(resolveHost("-x.agendafacile.it", ROOT)).toEqual({ kind: "other" });
  });
});

describe("tenantPath", () => {
  it("maps clean URLs to the business routes", () => {
    expect(tenantPath("demo-barbiere", "/")).toEqual({ type: "rewrite", path: "/demo-barbiere" });
    expect(tenantPath("demo-barbiere", "/prenota")).toEqual({ type: "rewrite", path: "/demo-barbiere/prenota" });
    expect(tenantPath("demo-barbiere", "/privacy/")).toEqual({ type: "rewrite", path: "/demo-barbiere/privacy" });
  });

  it("redirects old slug links to clean URLs", () => {
    expect(tenantPath("demo-barbiere", "/demo-barbiere")).toEqual({ type: "redirect", path: "/" });
    expect(tenantPath("demo-barbiere", "/demo-barbiere/prenota")).toEqual({ type: "redirect", path: "/prenota" });
  });

  it("leaves shared routes alone", () => {
    for (const p of ["/admin", "/admin/calendario", "/api/public/demo-barbiere/availability", "/gestisci/abc", "/icon.svg"]) {
      expect(tenantPath("demo-barbiere", p)).toEqual({ type: "pass" });
    }
  });

  it("keeps other businesses out of a subdomain", () => {
    expect(tenantPath("demo-barbiere", "/barberhood")).toEqual({ type: "rewrite", path: "/demo-barbiere/barberhood" });
  });
});
