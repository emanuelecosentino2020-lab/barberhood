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
