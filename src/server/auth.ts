import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createUserClient } from "@/lib/supabase/server";
import type { Business, MemberRole } from "@/lib/types";

export const ACTIVE_BUSINESS_COOKIE = "bp_business";

export interface MemberContext {
  db: SupabaseClient;
  user: Pick<User, "id" | "email">;
  role: MemberRole;
  business: Business;
  memberships: { business_id: string; role: MemberRole; name: string; slug: string }[];
}

const ROLE_RANK: Record<MemberRole, number> = { staff: 1, admin: 2, owner: 3 };

/**
 * Resolves the logged-in user and the business they are working on.
 * Verified against Supabase Auth (getUser hits the auth server, it does not
 * trust the cookie blindly). Cached per request.
 */
export const getMemberContext = cache(async (): Promise<MemberContext | null> => {
  // Admin pages are always per-request: never prerender anything below this point
  await connection();
  const db = await createUserClient();
  const { data, error } = await db.auth.getUser();
  if (error || !data.user) return null;

  const { data: rows } = await db
    .from("business_members")
    .select("business_id, role, businesses(name, slug)")
    .eq("user_id", data.user.id);
  type Row = { business_id: string; role: MemberRole; businesses: { name: string; slug: string } | null };
  const memberships = ((rows ?? []) as unknown as Row[])
    .filter((r) => r.businesses)
    .map((r) => ({ business_id: r.business_id, role: r.role, name: r.businesses!.name, slug: r.businesses!.slug }));
  if (memberships.length === 0) return null;

  const preferred = (await cookies()).get(ACTIVE_BUSINESS_COOKIE)?.value;
  const active = memberships.find((m) => m.business_id === preferred) ?? memberships[0]!;
  const { data: business } = await db.from("businesses").select("*").eq("id", active.business_id).single();
  if (!business) return null;

  return {
    db,
    user: { id: data.user.id, email: data.user.email },
    role: active.role,
    business: business as Business,
    memberships,
  };
});

/** For pages: redirects to login when the visitor isn't an authorised member. */
export async function requireMember(minRole: MemberRole = "staff"): Promise<MemberContext> {
  const ctx = await getMemberContext();
  if (!ctx) redirect("/admin/login");
  if (ROLE_RANK[ctx.role] < ROLE_RANK[minRole]) redirect("/admin?errore=permessi");
  return ctx;
}

export class ForbiddenError extends Error {}

/** For server actions: throws instead of redirecting. */
export async function memberForAction(minRole: MemberRole = "staff"): Promise<MemberContext> {
  const ctx = await getMemberContext();
  if (!ctx || ROLE_RANK[ctx.role] < ROLE_RANK[minRole]) throw new ForbiddenError("forbidden");
  return ctx;
}

export function canManage(role: MemberRole) {
  return ROLE_RANK[role] >= ROLE_RANK.admin;
}
