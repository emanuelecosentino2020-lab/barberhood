// Row types mirroring supabase/migrations. Keep in sync with the SQL schema
// (or replace with `supabase gen types` once the project is linked).

export type MemberRole = "owner" | "admin" | "staff";
export type AppointmentStatus = "confirmed" | "completed" | "cancelled" | "no_show";
export type AppointmentSource = "online" | "admin";
export type ActorType = "customer" | "member" | "system";
export type NotificationKind =
  | "booking_confirmed"
  | "booking_rescheduled"
  | "booking_cancelled"
  | "reminder"
  | "owner_new_booking"
  | "owner_booking_cancelled";
export type NotificationStatus = "pending" | "processing" | "sent" | "failed" | "cancelled";

export interface Business {
  id: string;
  slug: string;
  name: string;
  vertical: string;
  tagline: string | null;
  description: string | null;
  address_line: string | null;
  city: string | null;
  postal_code: string | null;
  country_code: string;
  phone: string | null;
  email: string | null;
  website_url: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  google_maps_url: string | null;
  reviews_url: string | null;
  logo_url: string | null;
  cover_image_url: string | null;
  gallery: string[];
  theme: Record<string, unknown>;
  staff_label: string;
  timezone: string;
  currency: string;
  slot_interval_minutes: number;
  min_notice_minutes: number;
  max_advance_days: number;
  cancellation_cutoff_hours: number;
  reminder_hours_before: number;
  require_phone: boolean;
  allow_staff_choice: boolean;
  notification_email: string | null;
  notify_owner_on_booking: boolean;
  notify_owner_on_cancellation: boolean;
  privacy_controller_name: string | null;
  privacy_controller_email: string | null;
  data_retention_months: number;
  is_active: boolean;
  plan: string;
  created_at: string;
  updated_at: string;
}

/** Columns safe to send to anonymous visitors */
export const PUBLIC_BUSINESS_COLUMNS =
  "id, slug, name, vertical, tagline, description, address_line, city, postal_code, country_code, phone, email, website_url, instagram_url, facebook_url, google_maps_url, reviews_url, logo_url, cover_image_url, gallery, theme, staff_label, timezone, currency, slot_interval_minutes, min_notice_minutes, max_advance_days, cancellation_cutoff_hours, require_phone, allow_staff_choice, privacy_controller_name, privacy_controller_email, data_retention_months" as const;

export type PublicBusiness = Pick<
  Business,
  | "id"
  | "slug"
  | "name"
  | "vertical"
  | "tagline"
  | "description"
  | "address_line"
  | "city"
  | "postal_code"
  | "country_code"
  | "phone"
  | "email"
  | "website_url"
  | "instagram_url"
  | "facebook_url"
  | "google_maps_url"
  | "reviews_url"
  | "logo_url"
  | "cover_image_url"
  | "gallery"
  | "theme"
  | "staff_label"
  | "timezone"
  | "currency"
  | "slot_interval_minutes"
  | "min_notice_minutes"
  | "max_advance_days"
  | "cancellation_cutoff_hours"
  | "require_phone"
  | "allow_staff_choice"
  | "privacy_controller_name"
  | "privacy_controller_email"
  | "data_retention_months"
>;

export interface Staff {
  id: string;
  business_id: string;
  user_id: string | null;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
  is_active: boolean;
  sort_order: number;
}

export interface Service {
  id: string;
  business_id: string;
  name: string;
  description: string | null;
  price_cents: number;
  duration_minutes: number;
  buffer_after_minutes: number;
  is_active: boolean;
  sort_order: number;
}

export interface WorkingHoursRow {
  id: string;
  business_id: string;
  staff_id: string | null;
  weekday: number;
  start_time: string;
  end_time: string;
}

export interface DateOverrideRow {
  id: string;
  business_id: string;
  staff_id: string | null;
  date: string;
  is_closed: boolean;
  start_time: string | null;
  end_time: string | null;
  note: string | null;
}

export interface TimeBlock {
  id: string;
  business_id: string;
  staff_id: string | null;
  starts_at: string;
  ends_at: string;
  reason: string | null;
}

export interface Customer {
  id: string;
  business_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  created_at: string;
}

export interface Appointment {
  id: string;
  business_id: string;
  customer_id: string;
  service_id: string;
  staff_id: string;
  starts_at: string;
  ends_at: string;
  blocked_until: string;
  status: AppointmentStatus;
  source: AppointmentSource;
  service_name: string;
  price_cents: number;
  customer_note: string | null;
  cancelled_at: string | null;
  cancelled_by: ActorType | null;
  cancellation_reason: string | null;
  manage_token_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AppointmentEvent {
  id: string;
  appointment_id: string;
  event_type: "created" | "rescheduled" | "cancelled" | "status_changed" | "updated";
  actor_type: ActorType;
  actor_user_id: string | null;
  data: Record<string, unknown>;
  created_at: string;
}

export interface NotificationRow {
  id: string;
  business_id: string;
  appointment_id: string | null;
  channel: "email" | "whatsapp";
  kind: NotificationKind;
  recipient: "customer" | "business";
  scheduled_for: string;
  status: NotificationStatus;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  payload: Record<string, unknown>;
  idempotency_key: string;
  sent_at: string | null;
}
