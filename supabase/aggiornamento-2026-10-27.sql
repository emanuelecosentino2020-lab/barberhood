-- Barberhood: aggiornamento del 27/10/2026 per il database GIÀ online (dati reali, foto, comunicazioni).
-- Incolla tutto nello SQL Editor di Supabase e premi Run.
-- Si può eseguire anche più di una volta senza problemi
-- (include anche l'aggiornamento del 26/10, nel caso non fosse stato eseguito).

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
  add column if not exists review_request_hours_after int not null default 2
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

drop trigger if exists appointments_review_request on public.appointments;
create trigger appointments_review_request
  after insert or update of status, starts_at, ends_at on public.appointments
  for each row execute function private.sync_review_request();


-- =============================================================================
-- Dati reali di Barberhood, foto nuove e copertina
-- =============================================================================
update public.businesses
   set address_line = 'Via Polibio 9',
       city = 'Siracusa',
       postal_code = '96100',
       phone = '351 362 0214',
       cover_image_url = '/brand/barberhood/cover.webp',
       gallery = '["/brand/barberhood/diego.webp?v=2", "/brand/barberhood/luigi.webp"]'::jsonb
 where slug = 'barberhood';

update public.staff
   set avatar_url = '/brand/barberhood/diego.webp?v=2'
 where id = '00000000-0000-4000-8000-0000000000a2';

-- Orari del negozio: da martedì a sabato 9:00-19:00 continuato; domenica e lunedì chiuso
delete from public.working_hours
 where business_id = '00000000-0000-4000-8000-000000000001' and staff_id is null;
insert into public.working_hours (business_id, staff_id, weekday, start_time, end_time)
select '00000000-0000-4000-8000-000000000001', null, d, '09:00'::time, '19:00'::time
from generate_series(2, 6) d;


-- =============================================================================
-- Comunicazioni ai clienti (annunci con video)
-- =============================================================================
-- Announcements: short news from the shop (closures, new services, promos),
-- optionally with a video. Shown on the public page while published and not
-- expired; the owner shares the link on WhatsApp/Instagram from the dashboard.
--
-- Videos are uploaded straight from the browser to the "business-videos"
-- bucket with a signed upload URL issued by the server (files are too big to
-- pass through a server function). Written to run more than once.
-- =============================================================================

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  body text check (char_length(body) <= 2000),
  video_url text check (video_url ~ '^https://'),
  is_published boolean not null default true,
  expires_on date,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists announcements_business_idx on public.announcements (business_id, created_at desc);

alter table public.announcements enable row level security;
revoke all on public.announcements from anon;

drop policy if exists announcements_select on public.announcements;
drop policy if exists announcements_insert on public.announcements;
drop policy if exists announcements_update on public.announcements;
drop policy if exists announcements_delete on public.announcements;
create policy announcements_select on public.announcements
  for select to authenticated using ((select private.is_member(business_id)));
create policy announcements_insert on public.announcements
  for insert to authenticated with check ((select private.has_role(business_id, array['owner', 'admin']::public.member_role[])));
create policy announcements_update on public.announcements
  for update to authenticated
  using ((select private.has_role(business_id, array['owner', 'admin']::public.member_role[])))
  with check ((select private.has_role(business_id, array['owner', 'admin']::public.member_role[])));
create policy announcements_delete on public.announcements
  for delete to authenticated using ((select private.has_role(business_id, array['owner', 'admin']::public.member_role[])));

-- Video bucket (public read, 50 MB per file). Skipped on plain PostgreSQL.
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    raise notice 'storage schema not found, skipping video bucket';
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('business-videos', 'business-videos', true, 52428800,
          array['video/mp4', 'video/quicktime', 'video/webm'])
  on conflict (id) do nothing;
end;
$$;
