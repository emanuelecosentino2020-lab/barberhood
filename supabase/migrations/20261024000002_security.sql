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
