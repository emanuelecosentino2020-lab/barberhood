import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { LANDING_PATH, resolveHost, TENANT_HEADER, tenantPath } from "@/lib/hosts";

/**
 * 1. Host-based routing on the agency domain (see src/lib/hosts.ts).
 * 2. On admin routes, refreshes the Supabase session cookie and performs an
 *    optimistic redirect to the login page. Real authorisation happens on the
 *    server (requireMember) and in the database (RLS).
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return adminSession(request);

  // Never trust this header from the client
  const headers = new Headers(request.headers);
  headers.delete(TENANT_HEADER);

  const route = resolveHost(request.headers.get("host"), process.env.ROOT_DOMAIN);
  if (route.kind === "landing" && pathname === "/") {
    return NextResponse.rewrite(new URL(LANDING_PATH, request.url));
  }
  if (route.kind === "admin" && pathname === "/") {
    return NextResponse.redirect(new URL("/admin", request.url));
  }
  if (route.kind === "tenant") {
    const action = tenantPath(route.slug, pathname);
    if (action.type === "redirect") {
      const to = request.nextUrl.clone();
      to.pathname = action.path;
      return NextResponse.redirect(to, 308);
    }
    if (action.type === "rewrite") {
      const to = request.nextUrl.clone();
      to.pathname = action.path;
      headers.set(TENANT_HEADER, route.slug);
      return NextResponse.rewrite(to, { request: { headers } });
    }
  }
  return NextResponse.next({ request: { headers } });
}

async function adminSession(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers ?? {}).forEach(([k, v]) => response.headers.set(k, v));
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const isLogin = request.nextUrl.pathname.startsWith("/admin/login");
  if (!data?.claims && !isLogin) {
    const login = request.nextUrl.clone();
    login.pathname = "/admin/login";
    login.search = "";
    return NextResponse.redirect(login);
  }
  return response;
}

export const config = {
  // Everything except build assets and files with an extension
  matcher: ["/((?!_next/static|_next/image|.*\\.[a-zA-Z0-9]+$).*)"],
};
