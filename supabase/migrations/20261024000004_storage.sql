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
