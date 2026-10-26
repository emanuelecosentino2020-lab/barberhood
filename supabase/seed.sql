-- =============================================================================
-- Pilot business: Barberhood di Luigi Merlini (Siracusa).
-- Services, prices and staff are REAL (provided by the client).
-- Logo and photos: provided by the client. Address, phone and opening hours are PLACEHOLDERS marked "(da confermare)".
-- Safe to run more than once (fixed ids + on conflict do nothing).
-- =============================================================================

insert into public.businesses (
  id, slug, name, vertical, tagline, description, address_line, city, postal_code,
  phone, email, instagram_url, logo_url, cover_image_url, gallery, staff_label, notification_email,
  privacy_controller_name, privacy_controller_email, theme
) values (
  '00000000-0000-4000-8000-000000000001',
  'barberhood',
  'Barberhood',
  'barber',
  'di Luigi Merlini',
  'Barberia a Siracusa. Taglio, barba e rasatura all''italiana.',
  'Indirizzo da confermare',
  'Siracusa',
  null,
  null,
  null,
  'https://www.instagram.com/barberhood.sr/',
  '/brand/barberhood/logo-mark.svg',
  '/brand/barberhood/cover.webp',
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
