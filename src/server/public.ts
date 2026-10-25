import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { isServerSupabaseConfigured } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { PUBLIC_BUSINESS_COLUMNS, type PublicBusiness } from "@/lib/types";

export interface PublicService {
  id: string;
  name: string;
  description: string | null;
  price_cents: number;
  duration_minutes: number;
  staffIds: string[];
}

export interface PublicStaff {
  id: string;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
}

export interface PublicHours {
  weekday: number;
  start: string;
  end: string;
}

export interface PublicCatalog {
  business: PublicBusiness;
  services: PublicService[];
  staff: PublicStaff[];
  hours: PublicHours[];
}

export const businessTag = (slug: string) => `business:${slug}`;

/**
 * Everything an anonymous visitor may see about a business. Cached and
 * invalidated with businessTag(slug) whenever the owner edits settings.
 * Selected columns are explicit: no notification emails, no plan, no
 * customer data.
 */
export async function getPublicCatalog(slug: string): Promise<PublicCatalog | null> {
  "use cache";
  cacheTag(businessTag(slug));
  cacheLife("minutes");

  // A deploy without Supabase keys must still build: pages show "not found" until configured
  if (!isServerSupabaseConfigured()) {
    console.error("[config] Supabase keys missing: set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY");
    return null;
  }
  const db = createAdminClient();
  const { data: business, error } = await db
    .from("businesses")
    .select(PUBLIC_BUSINESS_COLUMNS)
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();
  if (error) {
    console.error("[catalog] load failed", error.code, error.message);
    throw new Error("catalog_load_failed");
  }
  if (!business) {
    console.warn(`[catalog] no active business with slug "${slug}"`);
    return null;
  }
  const biz = business as unknown as PublicBusiness;

  const [services, staff, links, hours] = await Promise.all([
    db
      .from("services")
      .select("id, name, description, price_cents, duration_minutes")
      .eq("business_id", biz.id)
      .eq("is_active", true)
      .order("sort_order")
      .order("name"),
    db
      .from("staff")
      .select("id, display_name, bio, avatar_url")
      .eq("business_id", biz.id)
      .eq("is_active", true)
      .order("sort_order")
      .order("display_name"),
    db.from("staff_services").select("staff_id, service_id").eq("business_id", biz.id),
    db
      .from("working_hours")
      .select("weekday, start_time, end_time")
      .eq("business_id", biz.id)
      .is("staff_id", null)
      .order("weekday")
      .order("start_time"),
  ]);
  if (services.error || staff.error || links.error || hours.error) throw new Error("catalog_load_failed");

  const activeStaff = new Set((staff.data as PublicStaff[]).map((s) => s.id));
  const linkRows = links.data as { staff_id: string; service_id: string }[];

  return {
    business: biz,
    services: (services.data as Omit<PublicService, "staffIds">[])
      .map((s) => ({
        ...s,
        staffIds: linkRows.filter((l) => l.service_id === s.id && activeStaff.has(l.staff_id)).map((l) => l.staff_id),
      }))
      .filter((s) => s.staffIds.length > 0),
    staff: staff.data as PublicStaff[],
    hours: (hours.data as { weekday: number; start_time: string; end_time: string }[]).map((h) => ({
      weekday: h.weekday,
      start: h.start_time.slice(0, 5),
      end: h.end_time.slice(0, 5),
    })),
  };
}
