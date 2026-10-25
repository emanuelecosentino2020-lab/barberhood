-- Barberhood: schema completo + dati iniziali. Incolla tutto nello SQL Editor di Supabase ed esegui UNA volta su un progetto nuovo.

-- ===== supabase/migrations/20261024000001_core_schema.sql =====
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

-- ===== supabase/migrations/20261024000002_security.sql =====
-- =============================================================================
-- Row Level Security
-- Model:
--   * anon (browser without login): NO direct access to any table. Public pages
--     are served by the Next.js server, which reads only public columns.
--   * authenticated: access limited to businesses the user is a member of.
--   * service_role: server-only key, bypasses RLS (used for public booking flow,
--     notification worker and admin scripts). Never shipped to the browser.
-- =============================================================================

-- Membership helpers. SECURITY DEFINER so they can read business_members
-- without recursive RLS evaluation; they only ever answer for auth.uid().
create or replace function private.is_member(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.business_members m
    where m.business_id = p_business_id and m.user_id = (select auth.uid())
  );
$$;

create or replace function private.has_role(p_business_id uuid, p_roles public.member_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.business_members m
    where m.business_id = p_business_id
      and m.user_id = (select auth.uid())
      and m.role = any (p_roles)
  );
$$;

grant usage on schema private to authenticated, service_role;
revoke all on all functions in schema private from public, anon;
grant execute on function private.is_member(uuid) to authenticated, service_role;
grant execute on function private.has_role(uuid, public.member_role[]) to authenticated, service_role;

-- Enable RLS everywhere
alter table public.businesses enable row level security;
alter table public.business_members enable row level security;
alter table public.staff enable row level security;
alter table public.services enable row level security;
alter table public.staff_services enable row level security;
alter table public.working_hours enable row level security;
alter table public.date_overrides enable row level security;
alter table public.time_blocks enable row level security;
alter table public.customers enable row level security;
alter table public.appointments enable row level security;
alter table public.appointment_events enable row level security;
alter table public.notifications enable row level security;
alter table private.rate_limits enable row level security;

-- Defense in depth: anon gets no table privileges at all.
revoke all on all tables in schema public from anon;
revoke all on all tables in schema private from anon, authenticated;

-- businesses -----------------------------------------------------------------
create policy businesses_select on public.businesses
  for select to authenticated using ((select private.is_member(id)));
create policy businesses_update on public.businesses
  for update to authenticated
  using ((select private.has_role(id, array['owner', 'admin']::public.member_role[])))
  with check ((select private.has_role(id, array['owner', 'admin']::public.member_role[])));

-- business_members: a user sees their own memberships, owners see their team.
-- Membership changes go through server-side admin scripts (service role).
create policy members_select on public.business_members
  for select to authenticated
  using (user_id = (select auth.uid()) or (select private.has_role(business_id, array['owner']::public.member_role[])));

-- Configuration tables: members read, owner/admin write ----------------------
do $$
declare
  t text;
begin
  foreach t in array array['staff', 'services', 'staff_services', 'working_hours', 'date_overrides']
  loop
    execute format(
      'create policy %1$s_select on public.%1$s for select to authenticated using ((select private.is_member(business_id)))', t);
    execute format(
      'create policy %1$s_insert on public.%1$s for insert to authenticated with check ((select private.has_role(business_id, array[''owner'',''admin'']::public.member_role[])))', t);
    execute format(
      'create policy %1$s_update on public.%1$s for update to authenticated using ((select private.has_role(business_id, array[''owner'',''admin'']::public.member_role[]))) with check ((select private.has_role(business_id, array[''owner'',''admin'']::public.member_role[])))', t);
    execute format(
      'create policy %1$s_delete on public.%1$s for delete to authenticated using ((select private.has_role(business_id, array[''owner'',''admin'']::public.member_role[])))', t);
  end loop;
end;
$$;

-- Operational tables: every member (incl. staff role) can work with them ------
create policy time_blocks_select on public.time_blocks
  for select to authenticated using ((select private.is_member(business_id)));
create policy time_blocks_insert on public.time_blocks
  for insert to authenticated with check ((select private.is_member(business_id)));
create policy time_blocks_update on public.time_blocks
  for update to authenticated using ((select private.is_member(business_id))) with check ((select private.is_member(business_id)));
create policy time_blocks_delete on public.time_blocks
  for delete to authenticated using ((select private.is_member(business_id)));

create policy customers_select on public.customers
  for select to authenticated using ((select private.is_member(business_id)));
create policy customers_insert on public.customers
  for insert to authenticated with check ((select private.is_member(business_id)));
create policy customers_update on public.customers
  for update to authenticated using ((select private.is_member(business_id))) with check ((select private.is_member(business_id)));
create policy customers_delete on public.customers
  for delete to authenticated using ((select private.has_role(business_id, array['owner', 'admin']::public.member_role[])));

-- Appointments are never deleted from the client: they are cancelled.
create policy appointments_select on public.appointments
  for select to authenticated using ((select private.is_member(business_id)));
create policy appointments_insert on public.appointments
  for insert to authenticated with check ((select private.is_member(business_id)));
create policy appointments_update on public.appointments
  for update to authenticated using ((select private.is_member(business_id))) with check ((select private.is_member(business_id)));

-- Audit log: append-only for members
create policy appointment_events_select on public.appointment_events
  for select to authenticated using ((select private.is_member(business_id)));
create policy appointment_events_insert on public.appointment_events
  for insert to authenticated with check ((select private.is_member(business_id)));

-- Notifications: members can read and enqueue/cancel through the RPC functions
create policy notifications_select on public.notifications
  for select to authenticated using ((select private.is_member(business_id)));
create policy notifications_insert on public.notifications
  for insert to authenticated with check ((select private.is_member(business_id)));
create policy notifications_update on public.notifications
  for update to authenticated using ((select private.is_member(business_id))) with check ((select private.is_member(business_id)));

-- Members must not be able to forge history: no update/delete on events,
-- no delete on appointments/notifications (no policy = denied).
revoke delete on public.appointments, public.appointment_events, public.notifications from authenticated;
revoke update on public.appointment_events from authenticated;
revoke insert, update, delete on public.businesses, public.business_members from authenticated;
-- Owners/admins can edit their profile and rules, but not slug, plan or activation
-- (those are platform-level fields managed with the service role).
grant update (
  name, vertical, tagline, description, address_line, city, postal_code, country_code, phone, email,
  website_url, instagram_url, facebook_url, google_maps_url, reviews_url, logo_url, cover_image_url,
  gallery, theme, staff_label, timezone, slot_interval_minutes, min_notice_minutes, max_advance_days,
  cancellation_cutoff_hours, reminder_hours_before, require_phone, allow_staff_choice,
  notification_email, notify_owner_on_booking, notify_owner_on_cancellation,
  privacy_controller_name, privacy_controller_email, data_retention_months
) on public.businesses to authenticated;

-- ===== supabase/migrations/20261024000003_booking_functions.sql =====
-- =============================================================================
-- Booking operations as transactional database functions.
--
-- They run as SECURITY INVOKER: when called by a logged-in member, every read
-- and write is filtered by RLS, so a member can only touch their own business.
-- When called by the server with the service role (public booking flow), the
-- Next.js server has already validated the request and recomputed availability.
--
-- Double booking is prevented by the appointments_no_overlap exclusion
-- constraint (SQLSTATE 23P01), which PostgreSQL enforces atomically even for
-- concurrent transactions.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Notification helpers
-- ---------------------------------------------------------------------------
create or replace function private.enqueue_notification(
  p_business_id uuid,
  p_appointment_id uuid,
  p_kind public.notification_kind,
  p_recipient public.notification_recipient,
  p_scheduled_for timestamptz,
  p_key text,
  p_payload jsonb default '{}'::jsonb
)
returns void
language sql
set search_path = ''
as $$
  insert into public.notifications (business_id, appointment_id, kind, recipient, scheduled_for, idempotency_key, payload)
  values (p_business_id, p_appointment_id, p_kind, p_recipient, p_scheduled_for, p_key, p_payload)
  on conflict (idempotency_key) do update
    set status = 'pending',
        scheduled_for = excluded.scheduled_for,
        payload = excluded.payload,
        attempts = 0,
        last_error = null,
        locked_until = null
    -- Only a previously cancelled job is revived (e.g. moved A -> B -> A).
    -- A sent/pending job with the same key is left untouched: idempotent.
    where public.notifications.status = 'cancelled';
$$;

create or replace function private.cancel_pending_reminders(p_appointment_id uuid)
returns void
language sql
set search_path = ''
as $$
  update public.notifications
     set status = 'cancelled', locked_until = null
   where appointment_id = p_appointment_id
     and kind = 'reminder'
     and status = 'pending';
$$;

create or replace function private.schedule_reminder(p_appt public.appointments)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_hours int;
  v_at timestamptz;
begin
  select b.reminder_hours_before into v_hours from public.businesses b where b.id = p_appt.business_id;
  if coalesce(v_hours, 0) = 0 or p_appt.status <> 'confirmed' then
    return;
  end if;
  v_at := p_appt.starts_at - make_interval(hours => v_hours);
  -- If the appointment is already inside the reminder window the
  -- confirmation email is enough.
  if v_at <= now() then
    return;
  end if;
  perform private.enqueue_notification(
    p_appt.business_id, p_appt.id, 'reminder', 'customer', v_at,
    p_appt.id::text || ':reminder:' || extract(epoch from p_appt.starts_at)::bigint::text,
    jsonb_build_object('starts_at', p_appt.starts_at)
  );
end;
$$;

-- Resolve who is acting. A logged-in member is always recorded as a member,
-- whatever the caller passes, so the audit trail cannot be spoofed.
create or replace function private.resolve_actor(p_requested public.actor_type)
returns public.actor_type
language sql
stable
set search_path = ''
as $$
  select case when (select auth.uid()) is not null then 'member'::public.actor_type
              else coalesce(p_requested, 'system'::public.actor_type) end;
$$;

create or replace function private.assert_no_time_block(
  p_business_id uuid, p_staff_id uuid, p_starts_at timestamptz, p_until timestamptz
)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.time_blocks tb
    where tb.business_id = p_business_id
      and (tb.staff_id is null or tb.staff_id = p_staff_id)
      and tstzrange(tb.starts_at, tb.ends_at, '[)') && tstzrange(p_starts_at, p_until, '[)')
  ) then
    raise exception 'slot_unavailable' using errcode = 'P0001', detail = 'time_block';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_appointment
-- ---------------------------------------------------------------------------
create or replace function public.create_appointment(
  p_business_id uuid,
  p_service_id uuid,
  p_staff_id uuid,
  p_starts_at timestamptz,
  p_customer_name text default null,
  p_customer_email text default null,
  p_customer_phone text default null,
  p_customer_id uuid default null,
  p_customer_note text default null,
  p_source public.appointment_source default 'online',
  p_manage_token_hash text default null,
  p_allow_override boolean default false,
  p_manage_token_nonce text default null
)
returns public.appointments
language plpgsql
set search_path = ''
as $$
declare
  v_actor public.actor_type := private.resolve_actor('customer');
  v_service public.services;
  v_business public.businesses;
  v_customer_id uuid;
  v_appt public.appointments;
  v_event_id uuid;
  v_email text := nullif(lower(trim(p_customer_email)), '');
begin
  -- Online bookings can only come from the server (no auth.uid()) and can never override rules.
  if v_actor = 'member' then
    p_source := 'admin';
  else
    p_source := 'online';
    p_allow_override := false;
  end if;

  select * into v_business from public.businesses where id = p_business_id and is_active;
  if not found then
    raise exception 'business_not_found' using errcode = 'P0002';
  end if;

  select * into v_service from public.services where id = p_service_id and business_id = p_business_id;
  if not found or (not v_service.is_active and p_source = 'online') then
    raise exception 'service_not_found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.staff_services ss
    join public.staff s on s.id = ss.staff_id
    where ss.staff_id = p_staff_id and ss.service_id = p_service_id
      and s.business_id = p_business_id and s.is_active
  ) then
    raise exception 'staff_not_available_for_service' using errcode = 'P0001';
  end if;

  if p_source = 'online' and p_starts_at <= now() then
    raise exception 'slot_unavailable' using errcode = 'P0001', detail = 'past';
  end if;

  if not p_allow_override then
    perform private.assert_no_time_block(
      p_business_id, p_staff_id, p_starts_at,
      p_starts_at + make_interval(mins => v_service.duration_minutes + v_service.buffer_after_minutes)
    );
  end if;

  -- Customer: reuse by id (admin) or by email within the same business.
  if p_customer_id is not null then
    select id into v_customer_id from public.customers where id = p_customer_id and business_id = p_business_id;
    if not found then
      raise exception 'customer_not_found' using errcode = 'P0002';
    end if;
  else
    if coalesce(trim(p_customer_name), '') = '' then
      raise exception 'customer_name_required' using errcode = '22023';
    end if;
    if v_email is not null then
      select id into v_customer_id from public.customers
       where business_id = p_business_id and lower(email) = v_email;
    end if;
    if v_customer_id is null then
      insert into public.customers (business_id, full_name, email, phone)
      values (p_business_id, trim(p_customer_name), v_email, nullif(trim(p_customer_phone), ''))
      on conflict (business_id, lower(email)) where email is not null
        do update set updated_at = now()
      returning id into v_customer_id;
    elsif p_source = 'admin' or p_customer_phone is not null then
      -- Fill a missing phone, never overwrite existing data from an anonymous request
      update public.customers
         set phone = coalesce(phone, nullif(trim(p_customer_phone), ''))
       where id = v_customer_id;
    end if;
  end if;

  insert into public.appointments (
    business_id, customer_id, service_id, staff_id, starts_at, ends_at, blocked_until,
    status, source, service_name, price_cents, customer_note, manage_token_hash, manage_token_nonce, manage_token_expires_at
  ) values (
    p_business_id, v_customer_id, p_service_id, p_staff_id, p_starts_at,
    p_starts_at + make_interval(mins => v_service.duration_minutes),
    p_starts_at + make_interval(mins => v_service.duration_minutes + v_service.buffer_after_minutes),
    'confirmed', p_source, v_service.name, v_service.price_cents,
    nullif(trim(p_customer_note), ''), p_manage_token_hash, p_manage_token_nonce,
    case when p_manage_token_hash is null then null else p_starts_at end
  )
  returning * into v_appt;

  insert into public.appointment_events (business_id, appointment_id, event_type, actor_type, actor_user_id, data)
  values (p_business_id, v_appt.id, 'created', v_actor, (select auth.uid()),
          jsonb_build_object('starts_at', v_appt.starts_at, 'staff_id', v_appt.staff_id, 'source', p_source))
  returning id into v_event_id;

  perform private.enqueue_notification(p_business_id, v_appt.id, 'booking_confirmed', 'customer', now(),
                                       v_appt.id::text || ':booking_confirmed');
  perform private.schedule_reminder(v_appt);
  if p_source = 'online' and v_business.notify_owner_on_booking then
    perform private.enqueue_notification(p_business_id, v_appt.id, 'owner_new_booking', 'business', now(),
                                         v_appt.id::text || ':owner_new_booking');
  end if;

  return v_appt;
end;
$$;

-- ---------------------------------------------------------------------------
-- reschedule_appointment
-- ---------------------------------------------------------------------------
create or replace function public.reschedule_appointment(
  p_appointment_id uuid,
  p_starts_at timestamptz,
  p_staff_id uuid default null,
  p_allow_override boolean default false
)
returns public.appointments
language plpgsql
set search_path = ''
as $$
declare
  v_actor public.actor_type := private.resolve_actor('customer');
  v_old public.appointments;
  v_new public.appointments;
  v_staff uuid;
  v_duration interval;
  v_buffer interval;
  v_event_id uuid;
begin
  if v_actor <> 'member' then
    p_allow_override := false;
  end if;

  select * into v_old from public.appointments where id = p_appointment_id for update;
  if not found then
    raise exception 'appointment_not_found' using errcode = 'P0002';
  end if;
  if v_old.status <> 'confirmed' then
    raise exception 'appointment_not_modifiable' using errcode = 'P0001';
  end if;
  if v_actor <> 'member' and p_starts_at <= now() then
    raise exception 'slot_unavailable' using errcode = 'P0001', detail = 'past';
  end if;

  v_staff := coalesce(p_staff_id, v_old.staff_id);
  if v_staff <> v_old.staff_id and not exists (
    select 1 from public.staff_services ss join public.staff s on s.id = ss.staff_id
    where ss.staff_id = v_staff and ss.service_id = v_old.service_id
      and s.business_id = v_old.business_id and s.is_active
  ) then
    raise exception 'staff_not_available_for_service' using errcode = 'P0001';
  end if;

  v_duration := v_old.ends_at - v_old.starts_at;
  v_buffer := v_old.blocked_until - v_old.ends_at;

  if not p_allow_override then
    perform private.assert_no_time_block(v_old.business_id, v_staff, p_starts_at, p_starts_at + v_duration + v_buffer);
  end if;

  if p_starts_at = v_old.starts_at and v_staff = v_old.staff_id then
    return v_old;
  end if;

  update public.appointments
     set starts_at = p_starts_at,
         ends_at = p_starts_at + v_duration,
         blocked_until = p_starts_at + v_duration + v_buffer,
         staff_id = v_staff,
         manage_token_expires_at = case when manage_token_hash is null then null else p_starts_at end
   where id = p_appointment_id
  returning * into v_new;

  insert into public.appointment_events (business_id, appointment_id, event_type, actor_type, actor_user_id, data)
  values (v_new.business_id, v_new.id, 'rescheduled', v_actor, (select auth.uid()),
          jsonb_build_object('from', v_old.starts_at, 'to', v_new.starts_at,
                             'staff_from', v_old.staff_id, 'staff_to', v_new.staff_id))
  returning id into v_event_id;

  perform private.cancel_pending_reminders(v_new.id);
  perform private.enqueue_notification(v_new.business_id, v_new.id, 'booking_rescheduled', 'customer', now(),
                                       v_new.id::text || ':booking_rescheduled:' || v_event_id::text,
                                       jsonb_build_object('previous_starts_at', v_old.starts_at));
  perform private.schedule_reminder(v_new);

  return v_new;
end;
$$;

-- ---------------------------------------------------------------------------
-- cancel_appointment
-- ---------------------------------------------------------------------------
create or replace function public.cancel_appointment(
  p_appointment_id uuid,
  p_reason text default null,
  p_notify_customer boolean default true
)
returns public.appointments
language plpgsql
set search_path = ''
as $$
declare
  v_actor public.actor_type := private.resolve_actor('customer');
  v_old public.appointments;
  v_new public.appointments;
  v_notify_owner boolean;
begin
  select * into v_old from public.appointments where id = p_appointment_id for update;
  if not found then
    raise exception 'appointment_not_found' using errcode = 'P0002';
  end if;
  if v_old.status = 'cancelled' then
    return v_old; -- idempotent
  end if;
  if v_old.status <> 'confirmed' then
    raise exception 'appointment_not_modifiable' using errcode = 'P0001';
  end if;

  update public.appointments
     set status = 'cancelled',
         cancelled_at = now(),
         cancelled_by = v_actor,
         cancellation_reason = nullif(trim(p_reason), ''),
         manage_token_expires_at = least(manage_token_expires_at, now())
   where id = p_appointment_id
  returning * into v_new;

  insert into public.appointment_events (business_id, appointment_id, event_type, actor_type, actor_user_id, data)
  values (v_new.business_id, v_new.id, 'cancelled', v_actor, (select auth.uid()),
          jsonb_build_object('starts_at', v_new.starts_at));

  perform private.cancel_pending_reminders(v_new.id);

  if p_notify_customer or v_actor <> 'member' then
    perform private.enqueue_notification(v_new.business_id, v_new.id, 'booking_cancelled', 'customer', now(),
                                         v_new.id::text || ':booking_cancelled');
  end if;

  select notify_owner_on_cancellation into v_notify_owner from public.businesses where id = v_new.business_id;
  if v_actor = 'customer' and v_notify_owner then
    perform private.enqueue_notification(v_new.business_id, v_new.id, 'owner_booking_cancelled', 'business', now(),
                                         v_new.id::text || ':owner_booking_cancelled');
  end if;

  return v_new;
end;
$$;

-- ---------------------------------------------------------------------------
-- set_appointment_status: completed / no_show / back to confirmed (members only)
-- ---------------------------------------------------------------------------
create or replace function public.set_appointment_status(
  p_appointment_id uuid,
  p_status public.appointment_status
)
returns public.appointments
language plpgsql
set search_path = ''
as $$
declare
  v_old public.appointments;
  v_new public.appointments;
begin
  if (select auth.uid()) is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_status = 'cancelled' then
    raise exception 'use_cancel_appointment' using errcode = '22023';
  end if;

  select * into v_old from public.appointments where id = p_appointment_id for update;
  if not found then
    raise exception 'appointment_not_found' using errcode = 'P0002';
  end if;
  if v_old.status = 'cancelled' then
    raise exception 'appointment_not_modifiable' using errcode = 'P0001';
  end if;
  if v_old.status = p_status then
    return v_old;
  end if;

  update public.appointments set status = p_status where id = p_appointment_id returning * into v_new;

  insert into public.appointment_events (business_id, appointment_id, event_type, actor_type, actor_user_id, data)
  values (v_new.business_id, v_new.id, 'status_changed', 'member', (select auth.uid()),
          jsonb_build_object('from', v_old.status, 'to', v_new.status));

  if p_status <> 'confirmed' then
    perform private.cancel_pending_reminders(v_new.id);
  end if;

  return v_new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Notification worker API (service role only)
-- ---------------------------------------------------------------------------
create or replace function public.claim_notifications(
  p_limit int default 20,
  p_lock_seconds int default 300,
  p_appointment_id uuid default null -- fast path right after a booking
)
returns setof public.notifications
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Jobs whose worker died after the last allowed attempt are given up.
  update public.notifications
     set status = 'failed', locked_until = null, last_error = coalesce(last_error, 'worker_timeout')
   where status = 'processing' and locked_until < now() and attempts >= max_attempts;

  return query
  with due as (
    select n.id from public.notifications n
     where ((n.status = 'pending' and n.scheduled_for <= now())
         or (n.status = 'processing' and n.locked_until < now()))
       and n.attempts < n.max_attempts
       and (p_appointment_id is null or n.appointment_id = p_appointment_id)
     order by n.scheduled_for
     limit greatest(1, least(p_limit, 100))
     for update skip locked
  )
  update public.notifications n
     set status = 'processing',
         attempts = n.attempts + 1,
         locked_until = now() + make_interval(secs => p_lock_seconds)
    from due
   where n.id = due.id
  returning n.*;
end;
$$;

create or replace function public.complete_notification(p_id uuid, p_provider_message_id text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notifications
     set status = 'sent', sent_at = now(), locked_until = null, last_error = null,
         provider_message_id = p_provider_message_id
   where id = p_id and status = 'processing';
$$;

create or replace function public.fail_notification(p_id uuid, p_error text, p_retryable boolean default true)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notifications
     set status = case when p_retryable and attempts < max_attempts then 'pending'::public.notification_status
                       else 'failed'::public.notification_status end,
         -- exponential backoff: 2, 4, 8, 16... minutes, capped at 2 hours
         scheduled_for = case when p_retryable and attempts < max_attempts
                              then now() + make_interval(mins => least(power(2, attempts)::int, 120))
                              else scheduled_for end,
         locked_until = null,
         last_error = left(p_error, 500)
   where id = p_id and status = 'processing';
$$;

create or replace function public.skip_notification(p_id uuid, p_reason text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notifications
     set status = 'cancelled', locked_until = null, last_error = left(p_reason, 500)
   where id = p_id and status = 'processing';
$$;

-- ---------------------------------------------------------------------------
-- Rate limiting (service role only). Returns true if the request is allowed.
-- ---------------------------------------------------------------------------
create or replace function public.rate_limit_hit(p_key text, p_limit int, p_window_seconds int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits int;
begin
  insert into private.rate_limits (key, window_start, hits)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set hits = private.rate_limits.hits + 1
  returning hits into v_hits;

  -- Opportunistic cleanup of old windows
  if random() < 0.01 then
    delete from private.rate_limits where window_start < now() - interval '1 day';
  end if;

  return v_hits <= p_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privacy: anonymise customers without appointments in the retention window.
-- Appointments are kept for statistics but lose any link to a person.
-- ---------------------------------------------------------------------------
create or replace function public.purge_inactive_customers()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  with stale as (
    select c.id from public.customers c
    join public.businesses b on b.id = c.business_id
    where c.full_name <> 'Cliente anonimizzato'
      and not exists (
        select 1 from public.appointments a
        where a.customer_id = c.id
          and a.starts_at > now() - make_interval(months => b.data_retention_months)
      )
      and c.created_at < now() - make_interval(months => b.data_retention_months)
  )
  update public.customers c
     set full_name = 'Cliente anonimizzato', email = null, phone = null, notes = null
    from stale where c.id = stale.id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: Supabase grants EXECUTE to anon by default, revoke it explicitly.
-- ---------------------------------------------------------------------------
revoke all on function public.create_appointment(uuid, uuid, uuid, timestamptz, text, text, text, uuid, text, public.appointment_source, text, boolean, text) from public, anon;
revoke all on function public.reschedule_appointment(uuid, timestamptz, uuid, boolean) from public, anon;
revoke all on function public.cancel_appointment(uuid, text, boolean) from public, anon;
revoke all on function public.set_appointment_status(uuid, public.appointment_status) from public, anon;
revoke all on function public.claim_notifications(int, int, uuid) from public, anon, authenticated;
revoke all on function public.complete_notification(uuid, text) from public, anon, authenticated;
revoke all on function public.fail_notification(uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.skip_notification(uuid, text) from public, anon, authenticated;
revoke all on function public.rate_limit_hit(text, int, int) from public, anon, authenticated;
revoke all on function public.purge_inactive_customers() from public, anon, authenticated;

grant execute on function public.create_appointment(uuid, uuid, uuid, timestamptz, text, text, text, uuid, text, public.appointment_source, text, boolean, text) to authenticated, service_role;
grant execute on function public.reschedule_appointment(uuid, timestamptz, uuid, boolean) to authenticated, service_role;
grant execute on function public.cancel_appointment(uuid, text, boolean) to authenticated, service_role;
grant execute on function public.set_appointment_status(uuid, public.appointment_status) to authenticated, service_role;
grant execute on function public.claim_notifications(int, int, uuid) to service_role;
grant execute on function public.complete_notification(uuid, text) to service_role;
grant execute on function public.fail_notification(uuid, text, boolean) to service_role;
grant execute on function public.skip_notification(uuid, text) to service_role;
grant execute on function public.rate_limit_hit(text, int, int) to service_role;
grant execute on function public.purge_inactive_customers() to service_role;

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;

-- ===== supabase/migrations/20261024000004_storage.sql =====
-- =============================================================================
-- Storage bucket for logos, cover and gallery images.
-- Files live under "<business_id>/..."; anyone can read (public website),
-- only owners/admins of that business can write.
-- Guarded so the migration is a no-op on plain PostgreSQL (local tests).
-- =============================================================================
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    raise notice 'storage schema not found, skipping bucket setup';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('business-assets', 'business-assets', true, 5242880,
          array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/svg+xml'])
  on conflict (id) do nothing;

  execute $p$
    create policy business_assets_insert on storage.objects for insert to authenticated
    with check (
      bucket_id = 'business-assets'
      and (select private.has_role(((storage.foldername(name))[1])::uuid, array['owner','admin']::public.member_role[]))
    )
  $p$;
  execute $p$
    create policy business_assets_update on storage.objects for update to authenticated
    using (
      bucket_id = 'business-assets'
      and (select private.has_role(((storage.foldername(name))[1])::uuid, array['owner','admin']::public.member_role[]))
    )
  $p$;
  execute $p$
    create policy business_assets_delete on storage.objects for delete to authenticated
    using (
      bucket_id = 'business-assets'
      and (select private.has_role(((storage.foldername(name))[1])::uuid, array['owner','admin']::public.member_role[]))
    )
  $p$;
end;
$$;

-- ===== supabase/seed.sql =====
-- =============================================================================
-- Pilot business: Barberhood di Luigi Merlini (Siracusa).
-- Services, prices and staff are REAL (provided by the client).
-- Logo and photos: provided by the client. Address, phone and opening hours are PLACEHOLDERS marked "(da confermare)".
-- Safe to run more than once (fixed ids + on conflict do nothing).
-- =============================================================================

insert into public.businesses (
  id, slug, name, vertical, tagline, description, address_line, city, postal_code,
  phone, email, instagram_url, logo_url, gallery, staff_label, notification_email,
  privacy_controller_name, privacy_controller_email, theme
) values (
  '00000000-0000-4000-8000-000000000001',
  'barberhood',
  'Barberhood',
  'barber',
  'di Luigi Merlini',
  'Barberia a Siracusa. Taglio, barba e rasatura all''italiana, fatti con calma e con le mani giuste.',
  'Indirizzo da confermare',
  'Siracusa',
  null,
  null,
  null,
  'https://www.instagram.com/barberhood.sr/',
  '/brand/barberhood/logo-mark.svg',
  '["/brand/barberhood/diego.webp", "/brand/barberhood/luigi.webp"]'::jsonb,
  'Barbiere',
  null,
  'Luigi Merlini (da confermare)',
  null,
  '{"accent": "#e8e4dc", "preset": "mono", "wordmark_url": "/brand/barberhood/wordmark.svg"}'::jsonb
) on conflict (id) do nothing;

insert into public.staff (id, business_id, display_name, bio, sort_order, avatar_url) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000001', 'Luigi Merlini', 'Titolare', 1, '/brand/barberhood/luigi.webp'),
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-000000000001', 'Diego D''Abarno', null, 2, '/brand/barberhood/diego.webp'),
  ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-000000000001', 'Gabriel Formisano', null, 3, null)
on conflict (id) do nothing;

insert into public.services (id, business_id, name, description, price_cents, duration_minutes, buffer_after_minutes, sort_order) values
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-000000000001', 'Taglio uomo', null, 1800, 40, 0, 1),
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-000000000001', 'Taglio uomo + barba sagomata', null, 2500, 60, 0, 2),
  ('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-000000000001', 'Barba rasatura all''italiana', null, 1500, 20, 0, 3),
  ('00000000-0000-4000-8000-0000000000b4', '00000000-0000-4000-8000-000000000001', 'Barba sagomata', null, 1000, 10, 0, 4),
  ('00000000-0000-4000-8000-0000000000b5', '00000000-0000-4000-8000-000000000001', 'Barba trimmer', null, 500, 5, 0, 5),
  ('00000000-0000-4000-8000-0000000000b6', '00000000-0000-4000-8000-000000000001', 'Punti luce', null, 1000, 10, 0, 6),
  ('00000000-0000-4000-8000-0000000000b7', '00000000-0000-4000-8000-000000000001', 'Trattamento cute', null, 800, 10, 0, 7),
  ('00000000-0000-4000-8000-0000000000b8', '00000000-0000-4000-8000-000000000001', 'Trattamento viso', null, 1500, 15, 0, 8)
on conflict (id) do nothing;

-- Every barber performs every service (change from the dashboard if needed)
insert into public.staff_services (business_id, staff_id, service_id)
select '00000000-0000-4000-8000-000000000001', st.id, sv.id
from public.staff st cross join public.services sv
where st.business_id = '00000000-0000-4000-8000-000000000001'
  and sv.business_id = '00000000-0000-4000-8000-000000000001'
on conflict do nothing;

-- PLACEHOLDER opening hours (da confermare): Tue-Sat 09:00-13:00 and 15:00-20:00
insert into public.working_hours (business_id, staff_id, weekday, start_time, end_time)
select '00000000-0000-4000-8000-000000000001', null, d, t.s, t.e
from generate_series(2, 6) d
cross join (values ('09:00'::time, '13:00'::time), ('15:00'::time, '20:00'::time)) as t(s, e)
where not exists (
  select 1 from public.working_hours where business_id = '00000000-0000-4000-8000-000000000001'
);

-- ===== Account del titolare =====
-- Dopo aver creato l'utente in Authentication > Users > Add user,
-- sostituisci l'email qui sotto ed esegui solo questo blocco:
-- insert into public.business_members (business_id, user_id, role)
-- select '00000000-0000-4000-8000-000000000001', id, 'owner' from auth.users where email = 'TUA-EMAIL@esempio.it';
