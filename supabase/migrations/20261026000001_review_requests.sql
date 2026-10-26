-- =============================================================================
-- Review request: a few hours after the appointment the customer receives an
-- email with a direct link to leave a review (e.g. Google).
--
-- Scheduling is done by a trigger on appointments, so every path that creates,
-- moves, completes or cancels an appointment keeps the job in sync. The worker
-- re-checks everything at send time (status, time, link, one per customer in
-- a while), so a stale job can never go out.
--
-- Functions are plpgsql on purpose: the new enum value cannot be used in the
-- transaction that adds it, and plpgsql bodies are only resolved when run.
-- =============================================================================

alter type public.notification_kind add value if not exists 'review_request';

alter table public.businesses
  add column review_request_hours_after int not null default 2
  check (review_request_hours_after between 0 and 72);

comment on column public.businesses.review_request_hours_after is
  'Hours after the end of the appointment to email the review link (reviews_url). 0 = disabled.';

grant update (review_request_hours_after) on public.businesses to authenticated;

create or replace function private.sync_review_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hours int;
  v_url text;
  v_key text;
begin
  v_key := new.id::text || ':review:' || extract(epoch from new.ends_at)::bigint::text;

  -- Drop any pending request that no longer matches (moved, cancelled, no-show)
  update public.notifications
     set status = 'cancelled', locked_until = null
   where appointment_id = new.id
     and kind::text = 'review_request'
     and status = 'pending'
     and (new.status not in ('confirmed', 'completed') or idempotency_key <> v_key);

  if new.status not in ('confirmed', 'completed') then
    return null;
  end if;

  select b.review_request_hours_after, nullif(trim(b.reviews_url), '')
    into v_hours, v_url
    from public.businesses b where b.id = new.business_id;
  if coalesce(v_hours, 0) = 0 or v_url is null then
    return null;
  end if;

  perform private.enqueue_notification(
    new.business_id, new.id, 'review_request'::text::public.notification_kind, 'customer',
    greatest(new.ends_at + make_interval(hours => v_hours), now()),
    v_key,
    jsonb_build_object('ends_at', new.ends_at)
  );
  return null;
end;
$$;

revoke all on function private.sync_review_request() from public, anon, authenticated;

create trigger appointments_review_request
  after insert or update of status, starts_at, ends_at on public.appointments
  for each row execute function private.sync_review_request();
