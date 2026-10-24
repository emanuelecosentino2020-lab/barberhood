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
