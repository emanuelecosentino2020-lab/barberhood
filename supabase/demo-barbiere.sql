-- =============================================================================
-- Demo: "Lama & Pettine", barberia di fantasia per mostrare il sistema ai clienti.
-- Pagina pubblica: /demo-barbiere
--
-- Incolla tutto nello SQL Editor di Supabase e premi Run.
-- Prima crea l'utente admin in Authentication > Users (email qui sotto).
--
-- Si può rieseguire quando vuoi: riporta la demo allo stato iniziale, con
-- appuntamenti sempre centrati su "oggi" (ultime 6 settimane + prossime 3).
-- Tocca SOLO l'attività demo: Barberhood e gli altri dati non vengono toccati.
-- Il logo testuale è incorporato nel tema (sorgente: public/brand/demo/wordmark.svg).
-- Persone, numeri e clienti sono inventati; le email usano example.com, un
-- dominio riservato che non riceve posta.
-- =============================================================================

begin;

do $$
declare
  -- Utente che vedrà la demo nella dashboard (diventa titolare della demo)
  v_admin_email constant text := 'testagendafacile@gmail.com';

  v_biz constant uuid := '00000000-0000-4000-8000-000000000002';
  v_admin uuid;
  v_tz constant text := 'Europe/Rome';
  v_today date := (now() at time zone 'Europe/Rome')::date;

  -- Staff
  s_marco constant uuid := '00000000-0000-4000-8000-0000000002a1';
  s_andrea constant uuid := '00000000-0000-4000-8000-0000000002a2';
  s_luca constant uuid := '00000000-0000-4000-8000-0000000002a3';
  s_giulia constant uuid := '00000000-0000-4000-8000-0000000002a4';

  v_first text[] := array[
    'Alessandro','Matteo','Lorenzo','Francesco','Andrea','Gabriele','Riccardo','Tommaso','Edoardo','Giuseppe',
    'Antonio','Salvatore','Davide','Federico','Simone','Marco','Christian','Daniele','Emanuele','Giovanni',
    'Nicolò','Pietro','Samuele','Vincenzo','Luca','Stefano','Paolo','Fabio','Roberto','Massimo',
    'Claudio','Sergio','Corrado','Sebastiano','Gaetano','Carmelo','Mario','Filippo','Leonardo','Diego',
    'Michele','Alberto','Enrico','Giorgio','Valerio'];
  v_last text[] := array[
    'Russo','Romano','Greco','Bruno','Gallo','Conti','Costa','Giordano','Mancini','Rizzo',
    'Lombardo','Moretti','Barbieri','Fontana','Caruso','Marino','Ferri','Santoro','Messina','Leone',
    'Longo','Gentile','Martinelli','Vitale','Serra','Coppola','Amato','Parisi','Marchetti','Ferrara',
    'Bianco','Sorrentino','La Rosa','Di Stefano','Calabrese','Arena','Puglisi','Grasso','Spina','Privitera'];
  v_notes text[] := array[
    'Sfumatura alta, 1 ai lati. Sopra solo forbice.',
    'Preferisce forbice, niente macchinetta.',
    'Barba: lascia il pizzetto più lungo.',
    'Pelle sensibile: dopobarba senza alcol.',
    'Viene sempre il sabato mattina con il figlio.',
    'Riga a sinistra, cera opaca.',
    'Camouflage grigi ogni 4 settimane.',
    'Allergico al profumo del balsamo classico.',
    'Arriva spesso 5 minuti prima, puntualissimo.',
    'Ama chiacchierare di calcio.'];

  v_customers uuid[];
  v_cid uuid;
  v_n int := 0;
  v_i int;
  v_day date;
  v_wd int;
  v_staff uuid;
  v_t timestamptz;
  v_end timestamptz;
  v_iv record;
  v_svc record;
  v_appt public.appointments;
  v_p float;
  v_r float;
  v_created int := 0;
  v_skipped int := 0;
begin
  perform setseed(0.4242);

  select id into v_admin from auth.users where lower(email) = lower(v_admin_email);
  if v_admin is null then
    raise exception 'Prima crea l''utente % in Authentication > Users, poi riesegui lo script.', v_admin_email;
  end if;

  -- ---------------------------------------------------------------------------
  -- Attività
  -- ---------------------------------------------------------------------------
  insert into public.businesses (id, slug, name) values (v_biz, 'demo-barbiere', 'Lama & Pettine')
  on conflict (id) do nothing;

  update public.businesses set
    slug = 'demo-barbiere',
    name = 'Lama & Pettine',
    vertical = 'barber',
    tagline = 'Barberia contemporanea',
    description = 'Taglio, barba e rasatura con panno caldo, in un ambiente curato dove il tempo rallenta. '
                  || 'Scegli servizio, barbiere e orario: prenoti in meno di un minuto, senza telefonate.',
    address_line = null, city = 'Siracusa', postal_code = null,
    phone = null, email = null, website_url = null,
    instagram_url = null, facebook_url = null, google_maps_url = null, reviews_url = null,
    logo_url = null, cover_image_url = null, gallery = '[]'::jsonb,
    theme = jsonb_build_object('accent', '#e8e4dc', 'preset', 'mono', 'wordmark_url', 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NzIgMTYxIj48cGF0aCBmaWxsPSIjMDAwIiBkPSJNMzcuODAgMTI1LjUyTDYuNzUgMTI1LjUyTDYuNzUgMzUuNDhMMjAuNDYgMzUuNDhMMjAuNDYgMTEzLjg1TDM3LjgwIDExMy44NUwzNy44MCAxMjUuNTJaTTU5LjM5IDEyNS41Mkw0Ni4xOSAxMjUuNTJMNTkuMDMgMzUuNDhMNzcuMTQgMzUuNDhMOTAuNzkgMTI1LjUyTDc4LjAxIDEyNS41Mkw3NS44NiAxMDkuNDVMNjEuMzMgMTA5LjQ1TDU5LjM5IDEyNS41MlpNNjguMTggNTMuMjNMNjIuNjYgOTguNDZMNzQuNDIgOTguNDZMNjguMzkgNTMuMjNMNjguMTggNTMuMjNaTTExNy4zNCAxMjUuNTJMMTA1LjIxIDEyNS41MkwxMDUuMjEgMzUuNDhMMTIyLjI1IDM1LjQ4TDEzNS4wNCAxMDEuMjdMMTQ3LjA2IDM1LjQ4TDE2NC4yMCAzNS40OEwxNjQuMjAgMTI1LjUyTDE1MS45NyAxMjUuNTJMMTUxLjk3IDkxLjk2TDE1Mi40OCA2MS4xNkwxNDAuMzYgMTI1LjExTDEyOS40NiAxMjUuMTFMMTE2LjgzIDYxLjE2TDExNy4zNCA5MS45NkwxMTcuMzQgMTI1LjUyWk0xOTEuOTIgMTI1LjUyTDE3OC43MiAxMjUuNTJMMTkxLjU2IDM1LjQ4TDIwOS42NyAzNS40OEwyMjMuMzMgMTI1LjUyTDIxMC41NCAxMjUuNTJMMjA4LjM5IDEwOS40NUwxOTMuODYgMTA5LjQ1TDE5MS45MiAxMjUuNTJaTTIwMC43MiA1My4yM0wxOTUuMTkgOTguNDZMMjA2Ljk2IDk4LjQ2TDIwMC45MiA1My4yM0wyMDAuNzIgNTMuMjNaTTI4MS42MyAxMjYuNTRMMjgxLjYzIDEyNi41NFEyNzUuMTMgMTI2LjU0IDI3MC42MSAxMjIuMDRRMjY2LjA4IDExNy41NCAyNjYuMDggMTA4LjI4TDI2Ni4wOCAxMDguMjhRMjY2LjA4IDEwMS42OCAyNjguMDIgOTYuMzNRMjY5Ljk3IDkwLjk5IDI3My4wNiA4Ni40MVEyNzYuMTYgODEuODMgMjc5LjU4IDc3LjU4TDI3OS41OCA3Ny41OFEyNzYuNDEgNjkuNDUgMjc0LjI5IDYyLjYyUTI3Mi4xNyA1NS43OSAyNzIuMTcgNTIuMTZMMjcyLjE3IDUyLjE2UTI3Mi4xNyA0My40NiAyNzYuMjMgMzguOTFRMjgwLjMwIDM0LjM2IDI4Ny4xNiAzNC4zNkwyODcuMTYgMzQuMzZRMjkyLjQyIDM0LjM2IDI5NS41NyAzNi40OFEyOTguNzIgMzguNjAgMzAwLjEyIDQyLjYyUTMwMS41MyA0Ni42NCAzMDEuNTMgNTIuMzFMMzAxLjUzIDUyLjMxUTMwMS41MyA1Ny4yOCAyOTkuODIgNjIuMDNRMjk4LjEwIDY2Ljc5IDI5NS40NCA3MS4xOVEyOTIuNzggNzUuNTkgMjg5LjgyIDc5LjU4TDI4OS44MiA3OS41OEwyOTcuOTAgOTkuMDdRMjk5LjY0IDk1LjU5IDMwMS43OSA5MS45NlEzMDMuOTMgODguMzMgMzA2LjcwIDg0Ljc1TDMwNi43MCA4NC43NUwzMTEuMTUgOTIuMjFRMzA4LjE4IDk2LjA1IDMwNS45NiAxMDAuMzBRMzAzLjczIDEwNC41NCAzMDEuOTQgMTA4Ljc0TDMwMS45NCAxMDguNzRMMzA5Ljc3IDEyNS41MkwzMDAuNDYgMTI1LjUyTDI5Ni4zMSAxMTYuODJRMjk0LjY4IDExOS42OSAyOTIuNzEgMTIxLjg4UTI5MC43NCAxMjQuMDggMjg4LjA4IDEyNS4zMVEyODUuNDIgMTI2LjU0IDI4MS42MyAxMjYuNTRaTTI4My4wNiAxMTcuNDNMMjgzLjA2IDExNy40M1EyODUuMTYgMTE3LjQzIDI4Ni42NCAxMTYuMjFRMjg4LjEzIDExNC45OCAyODkuNDMgMTEyLjczUTI5MC43NCAxMTAuNDggMjkyLjE3IDEwNy40MUwyOTIuMTcgMTA3LjQxTDI4My40MiA4Ni4xM1EyODEuMzIgODkuMTUgMjc5LjY5IDkyLjM3UTI3OC4wNSA5NS41OSAyNzcuMDUgOTguOTdRMjc2LjA2IDEwMi4zNCAyNzUuODUgMTA1LjgyTDI3NS44NSAxMDUuODJRMjc1LjU5IDExMS4yNCAyNzcuMjEgMTE0LjM0UTI3OC44MiAxMTcuNDMgMjgzLjA2IDExNy40M1pNMjg2LjI5IDcwLjY4TDI4Ni4yOSA3MC42OFEyODkuMzAgNjYuNTkgMjkxLjI1IDYxLjgwUTI5My4xOSA1Ny4wMiAyOTMuMTkgNTIuMDZMMjkzLjE5IDUyLjA2UTI5My4xOSA0Ny4yMCAyOTIuMTIgNDQuOTdRMjkxLjA0IDQyLjc1IDI4Ny41NyA0Mi43NUwyODcuNTcgNDIuNzVRMjg1LjMxIDQyLjc1IDI4NC4wOSA0My42OVEyODIuODYgNDQuNjQgMjgyLjM1IDQ2LjEwUTI4MS44NCA0Ny41NiAyODEuNzMgNDkuMTlRMjgxLjYzIDUwLjgzIDI4MS42MyA1Mi4yNkwyODEuNjMgNTIuMjZRMjgxLjYzIDU0Ljc3IDI4Mi45NCA1OS44M1EyODQuMjQgNjQuOTAgMjg2LjI5IDcwLjY4Wk0zNjkuODYgMTI1LjUyTDM1Ni4xNSAxMjUuNTJMMzU2LjE1IDM1LjQ4TDM3Ni44MiAzNS40OFEzODIuMTkgMzUuNDggMzg1Ljc1IDM3LjEyUTM4OS4zMCAzOC43NiAzOTEuMzUgNDEuOThRMzkzLjM5IDQ1LjIwIDM5NC4yNiA0OS45M1EzOTUuMTMgNTQuNjcgMzk1LjEzIDYwLjg2TDM5NS4xMyA2MC44NkwzOTUuMTMgNjIuNzVRMzk1LjEzIDcxLjQ1IDM5My42MiA3Ny41NlEzOTIuMTEgODMuNjcgMzg4LjIzIDg2Ljg0UTM4NC4zNCA5MC4wMSAzNzcuMjggOTAuMDFMMzc3LjI4IDkwLjAxTDM2OS44NiA5MC4wMUwzNjkuODYgMTI1LjUyWk0zNjkuODYgNDYuMDJMMzY5Ljg2IDc4LjcxTDM3NC41NyA3OC43MVEzNzcuNTkgNzguNzEgMzc5LjA3IDc3LjE3UTM4MC41NSA3NS42NCAzODEuMDQgNzIuMDhRMzgxLjUzIDY4LjUzIDM4MS41MyA2Mi42MEwzODEuNTMgNjIuNjBMMzgxLjUzIDYwLjg2UTM4MS40NyA1My41NCAzODAuMjUgNDkuNzhRMzc5LjAyIDQ2LjAyIDM3NC42NyA0Ni4wMkwzNzQuNjcgNDYuMDJMMzY5Ljg2IDQ2LjAyWk00NDEuNDcgMTI1LjUyTDQxMC42OCAxMjUuNTJMNDEwLjY4IDM1LjQ4TDQ0MC44NiAzNS40OEw0NDAuODYgNDcuMzBMNDI0LjM5IDQ3LjMwTDQyNC4zOSA3My40OUw0NDAuMDQgNzMuNDlMNDQwLjA0IDg1LjA1TDQyNC4zOSA4NS4wNUw0MjQuMzkgMTEzLjcwTDQ0MS40NyAxMTMuNzBMNDQxLjQ3IDEyNS41MlpNNDc2LjI1IDEyNS41Mkw0NjIuNTkgMTI1LjUyTDQ2Mi41OSA0Ny4zNUw0NTIuMDYgNDcuMzVMNDUyLjA2IDM1LjQ4TDQ4Ni4zOCAzNS40OEw0ODYuMzggNDcuMzVMNDc2LjI1IDQ3LjM1TDQ3Ni4yNSAxMjUuNTJaTTUxOC43MSAxMjUuNTJMNTA1LjA1IDEyNS41Mkw1MDUuMDUgNDcuMzVMNDk0LjUxIDQ3LjM1TDQ5NC41MSAzNS40OEw1MjguODMgMzUuNDhMNTI4LjgzIDQ3LjM1TDUxOC43MSA0Ny4zNUw1MTguNzEgMTI1LjUyWk01NTYuODEgMTI1LjUyTDU0My4xMCAxMjUuNTJMNTQzLjEwIDM1LjQ4TDU1Ni44MSAzNS40OEw1NTYuODEgMTI1LjUyWk01ODkuNDkgMTI1LjUyTDU3Ni44NiAxMjUuNTJMNTc2Ljg2IDM1LjQ4TDU4Ny42MCAzNS40OEw2MDYuNjggODkuNTBMNjA1LjcxIDY0Ljk1TDYwNS43MSAzNS40OEw2MTguMDQgMzUuNDhMNjE4LjA0IDEyNS41Mkw2MDguMzIgMTI1LjUyTDU4OC43MyA2OS42MEw1ODkuNDkgOTMuMjRMNTg5LjQ5IDEyNS41MlpNNjY4LjYyIDEyNS41Mkw2MzcuODMgMTI1LjUyTDYzNy44MyAzNS40OEw2NjguMDEgMzUuNDhMNjY4LjAxIDQ3LjMwTDY1MS41NCA0Ny4zMEw2NTEuNTQgNzMuNDlMNjY3LjE5IDczLjQ5TDY2Ny4xOSA4NS4wNUw2NTEuNTQgODUuMDVMNjUxLjU0IDExMy43MEw2NjguNjIgMTEzLjcwTDY2OC42MiAxMjUuNTJaIi8+PC9zdmc+'),
    staff_label = 'Barbiere',
    timezone = v_tz, currency = 'EUR',
    slot_interval_minutes = 15, min_notice_minutes = 60, max_advance_days = 60,
    cancellation_cutoff_hours = 2, reminder_hours_before = 24, review_request_hours_after = 2,
    require_phone = true, allow_staff_choice = true,
    notification_email = null,
    privacy_controller_name = 'Lama & Pettine (attività dimostrativa)',
    privacy_controller_email = null,
    is_active = true, plan = 'demo'
  where id = v_biz;

  insert into public.business_members (business_id, user_id, role)
  values (v_biz, v_admin, 'owner')
  on conflict (business_id, user_id) do update set role = 'owner';

  -- Ripartenza pulita: solo righe della demo
  delete from public.appointments where business_id = v_biz;   -- eventi e notifiche a cascata
  delete from public.notifications where business_id = v_biz;
  delete from public.customers where business_id = v_biz;
  delete from public.time_blocks where business_id = v_biz;
  delete from public.date_overrides where business_id = v_biz;
  delete from public.working_hours where business_id = v_biz;
  delete from public.announcements where business_id = v_biz;
  delete from public.staff_services where business_id = v_biz;

  -- ---------------------------------------------------------------------------
  -- Team
  -- ---------------------------------------------------------------------------
  insert into public.staff (id, business_id, display_name, bio, sort_order, avatar_url, is_active) values
    (s_marco,  v_biz, 'Marco Rinaldi',  'Titolare · forbice e classici', 1, null, true),
    (s_andrea, v_biz, 'Andrea Greco',   'Sfumature e tagli moderni',     2, null, true),
    (s_luca,   v_biz, 'Luca Ferraro',   'Barba e rasatura tradizionale', 3, null, true),
    (s_giulia, v_biz, 'Giulia Conti',   'Colore e trattamenti',          4, null, true)
  on conflict (id) do update set
    display_name = excluded.display_name, bio = excluded.bio, sort_order = excluded.sort_order,
    avatar_url = excluded.avatar_url, is_active = true;

  -- ---------------------------------------------------------------------------
  -- Servizi
  -- ---------------------------------------------------------------------------
  insert into public.services (id, business_id, name, description, price_cents, duration_minutes, buffer_after_minutes, sort_order, is_active) values
    ('00000000-0000-4000-8000-0000000002b1', v_biz, 'Taglio uomo',              'Shampoo, taglio e styling',                    2200, 30, 0,  1, true),
    ('00000000-0000-4000-8000-0000000002b2', v_biz, 'Taglio + barba',           'Il nostro servizio più richiesto',             3200, 45, 0,  2, true),
    ('00000000-0000-4000-8000-0000000002b3', v_biz, 'Sfumatura',                'Skin fade o sfumatura classica',               2500, 40, 0,  3, true),
    ('00000000-0000-4000-8000-0000000002b4', v_biz, 'Rasatura con panno caldo', 'Lama, panno caldo e oli essenziali',           2000, 30, 0,  4, true),
    ('00000000-0000-4000-8000-0000000002b5', v_biz, 'Rifinitura barba',         'Contorni e sagomatura',                        1200, 15, 0,  5, true),
    ('00000000-0000-4000-8000-0000000002b6', v_biz, 'Taglio bambino',           'Fino a 12 anni',                               1500, 20, 0,  6, true),
    ('00000000-0000-4000-8000-0000000002b7', v_biz, 'Camouflage grigi',         'Colore naturale, effetto non tinto',           2500, 30, 5,  7, true),
    ('00000000-0000-4000-8000-0000000002b8', v_biz, 'Trattamento cute',         'Scrub e lozione rinforzante',                  1800, 20, 0,  8, true),
    ('00000000-0000-4000-8000-0000000002b9', v_biz, 'Pulizia viso uomo',        'Detersione profonda e maschera',               2500, 30, 5,  9, true),
    ('00000000-0000-4000-8000-0000000002c0', v_biz, 'Pacchetto sposo',          'Taglio, rasatura, viso e styling. Su misura',  8000, 90, 0, 10, true)
  on conflict (id) do update set
    name = excluded.name, description = excluded.description, price_cents = excluded.price_cents,
    duration_minutes = excluded.duration_minutes, buffer_after_minutes = excluded.buffer_after_minutes,
    sort_order = excluded.sort_order, is_active = true;

  -- Chi fa cosa: Giulia colore, cute, viso e tagli; i barbieri tutto tranne il colore (Marco fa anche quello)
  insert into public.staff_services (business_id, staff_id, service_id)
  select v_biz, st.id, sv.id
  from public.staff st cross join public.services sv
  where st.business_id = v_biz and sv.business_id = v_biz
    and case st.id
          when s_giulia then sv.id in ('00000000-0000-4000-8000-0000000002b1', '00000000-0000-4000-8000-0000000002b6',
                                       '00000000-0000-4000-8000-0000000002b7', '00000000-0000-4000-8000-0000000002b8',
                                       '00000000-0000-4000-8000-0000000002b9')
          when s_marco then true
          else sv.id <> '00000000-0000-4000-8000-0000000002b7'
        end;

  -- ---------------------------------------------------------------------------
  -- Orari: mar-ven 9-13 e 15-20, sabato 8:30-18:30 continuato; chiuso dom e lun.
  -- Giulia lavora mar-ven solo il pomeriggio e il sabato fino alle 14.
  -- ---------------------------------------------------------------------------
  insert into public.working_hours (business_id, staff_id, weekday, start_time, end_time)
  select v_biz, null::uuid, d, t.s, t.e
  from generate_series(2, 5) d, (values ('09:00'::time, '13:00'::time), ('15:00'::time, '20:00'::time)) t(s, e)
  union all
  select v_biz, null::uuid, 6, '08:30'::time, '18:30'::time
  union all
  select v_biz, s_giulia, d, '15:00'::time, '20:00'::time from generate_series(2, 5) d
  union all
  select v_biz, s_giulia, 6, '08:30'::time, '14:00'::time;

  -- Chiusura per l'Immacolata e una giornata di ferie di Luca tra 9 giorni
  insert into public.date_overrides (business_id, staff_id, date, is_closed, note)
  select v_biz, null, make_date(extract(year from v_today)::int, 12, 8), true, 'Immacolata'
  where make_date(extract(year from v_today)::int, 12, 8) >= v_today;
  insert into public.time_blocks (business_id, staff_id, starts_at, ends_at, reason, created_by)
  values (v_biz, s_luca,
          ((v_today + 9)::timestamp) at time zone v_tz,
          ((v_today + 10)::timestamp) at time zone v_tz,
          'Ferie', v_admin);

  -- ---------------------------------------------------------------------------
  -- Comunicazioni (sezione «Novità» della pagina pubblica)
  -- ---------------------------------------------------------------------------
  insert into public.announcements (business_id, title, body, is_published, expires_on, created_by, created_at) values
    (v_biz, 'Benvenuto nella demo',
     'Lama & Pettine è una barberia di fantasia, creata per mostrarti come funziona il sistema. '
     || 'Prova pure a prenotare: è tutto vero, tranne la barberia.',
     true, null, v_admin, now()),
    (v_biz, 'Arriva il Pacchetto sposo',
     'Taglio, rasatura con panno caldo, pulizia viso e styling il giorno prima delle nozze. '
     || 'Prenotalo online scegliendo il servizio «Pacchetto sposo».',
     true, null, v_admin, now() - interval '3 days'),
    (v_biz, 'Gift card in negozio',
     'Regala un taglio o una rasatura: chiedi la gift card alla cassa, vale 6 mesi.',
     true, null, v_admin, now() - interval '9 days');

  -- ---------------------------------------------------------------------------
  -- Clienti (inventati)
  -- ---------------------------------------------------------------------------
  v_customers := array[]::uuid[];
  for v_i in 1..420 loop
    insert into public.customers (business_id, full_name, email, notes, created_at)
    values (
      v_biz,
      v_first[1 + v_i % array_length(v_first, 1)] || ' ' || v_last[1 + (v_i / array_length(v_first, 1) + 3 * (v_i % array_length(v_first, 1))) % array_length(v_last, 1)],
      lower(translate(v_first[1 + v_i % array_length(v_first, 1)] || '.'
            || replace(v_last[1 + (v_i / array_length(v_first, 1) + 3 * (v_i % array_length(v_first, 1))) % array_length(v_last, 1)], ' ', ''), 'òàèéìù', 'oaeeiu'))
        || v_i || '@example.com',
      case when v_i % 9 = 0 then v_notes[1 + (v_i / 9) % array_length(v_notes, 1)] end,
      now() - make_interval(days => 45 + floor(random() * 400)::int)
    )
    returning id into v_cid;
    v_customers := v_customers || v_cid;
  end loop;

  -- ---------------------------------------------------------------------------
  -- Appuntamenti: passati (completati, qualche annullato o assente) e futuri.
  -- Creati con create_appointment come il titolare, così valgono le stesse
  -- regole della dashboard (niente sovrapposizioni, eventi registrati).
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  for v_day in select generate_series(v_today - 42, v_today + 21, interval '1 day')::date loop
    v_wd := extract(isodow from v_day);
    continue when v_wd in (1, 7);
    continue when exists (select 1 from public.date_overrides o where o.business_id = v_biz and o.date = v_day and o.is_closed);

    -- Quanto è piena l'agenda: alta nel passato, cala andando avanti (lascia posto per provare a prenotare)
    v_p := case
      when v_day < v_today then 0.78
      when v_day = v_today then 0.65
      when v_day <= v_today + 3 then 0.55
      when v_day <= v_today + 7 then 0.4
      when v_day <= v_today + 14 then 0.22
      else 0.1 end;
    if v_wd = 6 then v_p := least(0.92, v_p + 0.12); end if;

    foreach v_staff in array array[s_marco, s_andrea, s_luca, s_giulia] loop
      continue when v_staff = s_luca and v_day = v_today + 9;

      for v_iv in
        -- Orari del barbiere dentro quelli del negozio (senza orari propri: quelli del negozio)
        select greatest(bh.start_time, coalesce(sh.start_time, bh.start_time)) as s,
               least(bh.end_time, coalesce(sh.end_time, bh.end_time)) as e
        from public.working_hours bh
        left join public.working_hours sh
          on sh.business_id = v_biz and sh.staff_id = v_staff and sh.weekday = v_wd
        where bh.business_id = v_biz and bh.staff_id is null and bh.weekday = v_wd
          and (sh.id is not null or not exists (
                select 1 from public.working_hours x
                where x.business_id = v_biz and x.staff_id = v_staff and x.weekday = v_wd))
          and greatest(bh.start_time, coalesce(sh.start_time, bh.start_time))
              < least(bh.end_time, coalesce(sh.end_time, bh.end_time))
        order by 1
      loop
        v_t := (v_day + v_iv.s) at time zone v_tz;
        v_end := (v_day + v_iv.e) at time zone v_tz;

        while v_t < v_end loop
          if random() < v_p then
            -- Servizio pesato: tagli e taglio+barba sono i più frequenti
            v_r := random();
            select sv.id, sv.duration_minutes, sv.buffer_after_minutes into v_svc
            from public.services sv
            join public.staff_services ss on ss.service_id = sv.id and ss.staff_id = v_staff
            where sv.business_id = v_biz
            order by case
              when v_r < 0.30 then (sv.sort_order = 1)::int
              when v_r < 0.58 then (sv.sort_order = 2)::int
              when v_r < 0.72 then (sv.sort_order = 3)::int
              else 0 end desc, random()
            limit 1;

            if v_t + make_interval(mins => v_svc.duration_minutes + v_svc.buffer_after_minutes) <= v_end then
              -- Clienti abituali più frequenti
              v_cid := v_customers[1 + floor(power(random(), 1.25) * array_length(v_customers, 1))::int];
              begin
                v_appt := public.create_appointment(
                  p_business_id => v_biz, p_service_id => v_svc.id, p_staff_id => v_staff, p_starts_at => v_t,
                  p_customer_id => v_cid, p_source => 'admin', p_allow_override => false
                );
                v_created := v_created + 1;
                if v_appt.ends_at < now() then
                  v_r := random();
                  if v_r < 0.05 then
                    perform public.set_appointment_status(v_appt.id, 'no_show');
                  elsif v_r < 0.10 then
                    perform public.cancel_appointment(v_appt.id, 'Spostato dal cliente', false);
                  else
                    perform public.set_appointment_status(v_appt.id, 'completed');
                  end if;
                elsif random() < 0.05 then
                  perform public.cancel_appointment(v_appt.id, 'Imprevisto del cliente', false);
                end if;
                -- Alcuni arrivano dalla pagina online, come nella realtà
                if random() < 0.6 then
                  update public.appointments set source = 'online' where id = v_appt.id;
                end if;
                -- Data di prenotazione realistica (qualche giorno prima)
                update public.appointments
                   set created_at = least(now(), v_t - make_interval(hours => 2 + floor(random() * 240)::int))
                 where id = v_appt.id;
              exception when others then
                v_skipped := v_skipped + 1; -- orario non disponibile: si salta
              end;
              v_t := v_t + make_interval(mins => v_svc.duration_minutes + v_svc.buffer_after_minutes);
            else
              v_t := v_t + interval '15 minutes';
            end if;
          else
            v_t := v_t + interval '15 minutes';
          end if;
        end loop;
      end loop;
    end loop;
  end loop;

  perform set_config('request.jwt.claims', '', true);

  -- Nessuna email per i dati di esempio
  delete from public.notifications where business_id = v_biz;

  raise notice 'Demo pronta: % appuntamenti, % clienti (% orari saltati)', v_created, array_length(v_customers, 1), v_skipped;
end;
$$;

commit;
