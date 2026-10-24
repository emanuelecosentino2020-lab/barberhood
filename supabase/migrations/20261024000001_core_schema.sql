-- =============================================================================
-- Core schema: multi-tenant booking platform
-- Every operational row belongs to a business (tenant). Composite foreign keys
-- (business_id, id) guarantee that rows can never reference another tenant's data.
-- =============================================================================

create extension if not exists btree_gist with schema extensions;

create schema if not exists private;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.member_role as enum ('owner', 'admin', 'staff');
create type public.appointment_status as enum ('confirmed', 'completed', 'cancelled', 'no_show');
create type public.appointment_source as enum ('online', 'admin');
create type public.actor_type as enum ('customer', 'member', 'system');
create type public.notification_channel as enum ('email', 'whatsapp');
create type public.notification_kind as enum (
  'booking_confirmed',
  'booking_rescheduled',
  'booking_cancelled',
  'reminder',
  'owner_new_booking',
  'owner_booking_cancelled'
);
create type public.notification_recipient as enum ('customer', 'business');
create type public.notification_status as enum ('pending', 'processing', 'sent', 'failed', 'cancelled');

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Businesses (tenants)
-- ---------------------------------------------------------------------------
create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 2 and 60),
  name text not null check (length(name) between 1 and 120),
  -- Vertical drives default copy and theme presets (barber, hair, beauty, tattoo, wellness, other)
  vertical text not null default 'barber',
  tagline text,
  description text,
  address_line text,
  city text,
  postal_code text,
  country_code text not null default 'IT',
  phone text,
  email text,
  website_url text,
  instagram_url text,
  facebook_url text,
  google_maps_url text,
  reviews_url text,
  logo_url text,
  cover_image_url text,
  gallery jsonb not null default '[]'::jsonb check (jsonb_typeof(gallery) = 'array'),
  -- { "accent": "#c6a15b", "background": "#0e0d0c", ... } validated by the app
  theme jsonb not null default '{}'::jsonb check (jsonb_typeof(theme) = 'object'),
  staff_label text not null default 'Professionista',
  timezone text not null default 'Europe/Rome',
  currency text not null default 'EUR',
  -- Booking rules
  slot_interval_minutes int not null default 15 check (slot_interval_minutes between 5 and 120),
  min_notice_minutes int not null default 60 check (min_notice_minutes between 0 and 10080),
  max_advance_days int not null default 60 check (max_advance_days between 1 and 365),
  cancellation_cutoff_hours int not null default 2 check (cancellation_cutoff_hours between 0 and 168),
  reminder_hours_before int not null default 24 check (reminder_hours_before between 0 and 168),
  require_phone boolean not null default true,
  allow_staff_choice boolean not null default true,
  -- Notifications
  notification_email text,
  notify_owner_on_booking boolean not null default true,
  notify_owner_on_cancellation boolean not null default true,
  -- Privacy
  privacy_controller_name text,
  privacy_controller_email text,
  data_retention_months int not null default 24 check (data_retention_months between 1 and 120),
  is_active boolean not null default true,
  plan text not null default 'pilot',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger businesses_updated_at before update on public.businesses
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Memberships (who can manage which business)
-- ---------------------------------------------------------------------------
create table public.business_members (
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null default 'staff',
  created_at timestamptz not null default now(),
  primary key (business_id, user_id)
);
create index business_members_user_idx on public.business_members (user_id);

-- ---------------------------------------------------------------------------
-- Staff (professionals). A business always has at least one staff member;
-- single-person shops simply have one.
-- ---------------------------------------------------------------------------
create table public.staff (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  display_name text not null check (length(display_name) between 1 and 80),
  bio text,
  avatar_url text,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id)
);
create index staff_business_idx on public.staff (business_id);
create trigger staff_updated_at before update on public.staff
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Services
-- ---------------------------------------------------------------------------
create table public.services (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  description text,
  price_cents int not null check (price_cents >= 0),
  duration_minutes int not null check (duration_minutes between 5 and 600),
  buffer_after_minutes int not null default 0 check (buffer_after_minutes between 0 and 240),
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id)
);
create index services_business_idx on public.services (business_id);
create trigger services_updated_at before update on public.services
  for each row execute function private.set_updated_at();

-- Which staff member performs which service
create table public.staff_services (
  business_id uuid not null,
  staff_id uuid not null,
  service_id uuid not null,
  primary key (staff_id, service_id),
  foreign key (business_id, staff_id) references public.staff (business_id, id) on delete cascade,
  foreign key (business_id, service_id) references public.services (business_id, id) on delete cascade
);
create index staff_services_service_idx on public.staff_services (service_id);

-- ---------------------------------------------------------------------------
-- Availability
-- working_hours: weekly recurring intervals. staff_id null = business opening
-- hours. Several rows on the same weekday = intervals with breaks between them.
-- A staff member without own rows inherits the business hours. Staff hours are
-- always clipped to the business hours.
-- ---------------------------------------------------------------------------
create table public.working_hours (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  staff_id uuid,
  weekday smallint not null check (weekday between 1 and 7), -- ISO: 1 = Monday
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  -- end_time may be '24:00' to mean midnight
  check (end_time > start_time),
  foreign key (business_id, staff_id) references public.staff (business_id, id) on delete cascade
);
create index working_hours_lookup_idx on public.working_hours (business_id, staff_id, weekday);

-- date_overrides: replace the weekly schedule on a specific local date.
-- is_closed = true -> closed all day; otherwise the listed intervals apply.
create table public.date_overrides (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  staff_id uuid,
  date date not null,
  is_closed boolean not null default false,
  start_time time,
  end_time time,
  note text,
  created_at timestamptz not null default now(),
  check (
    (is_closed and start_time is null and end_time is null)
    or (not is_closed and start_time is not null and end_time is not null and end_time > start_time)
  ),
  foreign key (business_id, staff_id) references public.staff (business_id, id) on delete cascade
);
create index date_overrides_lookup_idx on public.date_overrides (business_id, date);

-- time_blocks: absolute time ranges that are unavailable (holidays, extraordinary
-- closures, one-off breaks). staff_id null = whole business.
create table public.time_blocks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  staff_id uuid,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  foreign key (business_id, staff_id) references public.staff (business_id, id) on delete cascade
);
create index time_blocks_range_idx on public.time_blocks using gist (business_id, tstzrange(starts_at, ends_at, '[)'));

-- ---------------------------------------------------------------------------
-- Customers (only the data needed to manage an appointment)
-- ---------------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  full_name text not null check (length(full_name) between 1 and 120),
  email text check (email is null or (length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  phone text check (phone is null or length(phone) <= 32),
  -- Operational, non-sensitive notes written by the business (e.g. "prefers scissors")
  notes text check (notes is null or length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id)
);
create unique index customers_business_email_uidx on public.customers (business_id, lower(email)) where email is not null;
create index customers_business_name_idx on public.customers (business_id, lower(full_name));
create trigger customers_updated_at before update on public.customers
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Appointments
-- ---------------------------------------------------------------------------
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  customer_id uuid not null,
  service_id uuid not null,
  staff_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- ends_at + service buffer: the range the staff member is actually busy
  blocked_until timestamptz not null,
  status public.appointment_status not null default 'confirmed',
  source public.appointment_source not null default 'online',
  -- Snapshots taken at booking time, so later price/name changes don't rewrite history
  service_name text not null,
  price_cents int not null check (price_cents >= 0),
  customer_note text check (customer_note is null or length(customer_note) <= 500),
  cancelled_at timestamptz,
  cancelled_by public.actor_type,
  cancellation_reason text,
  -- Self-service link: token = HMAC(server secret, nonce). The DB stores only the
  -- nonce and SHA-256(token), so a database leak alone cannot forge links.
  manage_token_hash text unique,
  manage_token_nonce text,
  manage_token_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  check (ends_at > starts_at),
  check (blocked_until >= ends_at),
  check ((status = 'cancelled') = (cancelled_at is not null)),
  foreign key (business_id, customer_id) references public.customers (business_id, id) on delete cascade,
  foreign key (business_id, service_id) references public.services (business_id, id),
  foreign key (business_id, staff_id) references public.staff (business_id, id),
  -- The core guarantee: one staff member can never have two overlapping
  -- active appointments, even under concurrent inserts/updates.
  constraint appointments_no_overlap exclude using gist (
    staff_id with =,
    tstzrange(starts_at, blocked_until, '[)') with &&
  ) where (status <> 'cancelled')
);
create index appointments_business_start_idx on public.appointments (business_id, starts_at);
create index appointments_customer_idx on public.appointments (customer_id, starts_at desc);
create trigger appointments_updated_at before update on public.appointments
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Audit trail of relevant appointment changes (no personal data in `data`)
-- ---------------------------------------------------------------------------
create table public.appointment_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  appointment_id uuid not null,
  event_type text not null check (event_type in ('created', 'rescheduled', 'cancelled', 'status_changed', 'updated')),
  actor_type public.actor_type not null,
  actor_user_id uuid references auth.users (id) on delete set null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (business_id, appointment_id) references public.appointments (business_id, id) on delete cascade
);
create index appointment_events_appt_idx on public.appointment_events (appointment_id, created_at);

-- ---------------------------------------------------------------------------
-- Notification outbox: durable queue processed by a cron-triggered worker.
-- idempotency_key makes enqueueing idempotent and is forwarded to the email
-- provider so a retried request can never deliver twice.
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  appointment_id uuid,
  channel public.notification_channel not null default 'email',
  kind public.notification_kind not null,
  recipient public.notification_recipient not null,
  scheduled_for timestamptz not null default now(),
  status public.notification_status not null default 'pending',
  attempts int not null default 0,
  max_attempts int not null default 5,
  locked_until timestamptz,
  last_error text,
  provider_message_id text,
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (business_id, appointment_id) references public.appointments (business_id, id) on delete cascade
);
create index notifications_due_idx on public.notifications (scheduled_for) where status in ('pending', 'processing');
create index notifications_appt_idx on public.notifications (appointment_id);
create trigger notifications_updated_at before update on public.notifications
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Fixed-window rate limiting for public endpoints (service role only)
-- ---------------------------------------------------------------------------
create table private.rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (key, window_start)
);
