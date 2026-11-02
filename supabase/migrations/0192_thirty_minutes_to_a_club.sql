-- 0192: thirty minutes to a club.
--
-- G-01. A new academy or club should be running — crest and colours, squads,
-- a roster, a program, coaches invited, training in the calendar — inside
-- half an hour of founding it, with nobody from Squadroom on the phone.
--
-- `setup_progress` is the checklist: which of the six steps are done, read
-- from the data itself rather than from ticks a person might make without
-- doing the thing; how long since the club was founded; and when every core
-- step was first seen done, so "under 30 minutes" is a number we can look
-- at across every club that signs up, not a claim.
--
-- Crests get their own PUBLIC bucket: a crest is the one picture a club
-- wants everywhere, including the public page, and nothing about a child
-- is in it.

alter table public.academies
  add column if not exists setup_started_at timestamptz not null default now(),
  add column if not exists setup_completed_at timestamptz;
update public.academies set setup_started_at = created_at where setup_started_at > created_at;
-- Clubs that were set up before the checklist existed are not "still setting
-- up": they are marked done at founding, and the clock says so rather than
-- showing ninety thousand minutes.
update public.academies set setup_completed_at = created_at
 where setup_completed_at is null and created_at < now() - interval '1 day';

-- ---------------------------------------------------------------- crests
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('club-logos', 'club-logos', true, 2097152, array['image/jpeg','image/png','image/webp','image/svg+xml'])
on conflict (id) do update
  set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "crests are public" on storage.objects;
create policy "crests are public"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'club-logos');

drop policy if exists "a club's staff upload its crest" on storage.objects;
create policy "a club's staff upload its crest"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'club-logos' and app_private.is_academy_staff(((storage.foldername(name))[1])::uuid));

drop policy if exists "a club's staff replace its crest" on storage.objects;
create policy "a club's staff replace its crest"
  on storage.objects for update to authenticated
  using (bucket_id = 'club-logos' and app_private.is_academy_staff(((storage.foldername(name))[1])::uuid));

drop policy if exists "a club's staff remove its crest" on storage.objects;
create policy "a club's staff remove its crest"
  on storage.objects for delete to authenticated
  using (bucket_id = 'club-logos' and app_private.is_academy_staff(((storage.foldername(name))[1])::uuid));

create or replace function public.set_academy_logo(p_academy uuid, p_url text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(app_private.is_academy_staff(p_academy), false) then
    raise exception 'only the club''s staff set its crest' using errcode = '42501';
  end if;
  -- Only a crest in this club's own folder of the crests bucket, or none.
  if p_url is not null and p_url not like '%/object/public/club-logos/' || p_academy::text || '/%' then
    raise exception 'that is not a crest uploaded for this club' using errcode = '22023';
  end if;
  update public.academies set logo_url = p_url, updated_at = now() where id = p_academy;
end;
$$;

-- ------------------------------------------------------------- the checklist
create or replace function public.setup_progress(p_academy uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_academy   uuid;
  a           public.academies;
  v_brand     boolean;
  v_squads    boolean;
  v_roster    boolean;
  v_programs  boolean;
  v_coaches   boolean;
  v_session   boolean;
  v_core_done boolean;
  v_steps     jsonb;
  v_done      integer;
begin
  v_academy := app_private.my_academy(p_academy);
  if v_academy is null or not coalesce(app_private.is_academy_staff(v_academy), false) then
    return null;
  end if;
  select * into a from public.academies where id = v_academy;

  v_brand    := a.logo_url is not null or lower(coalesce(a.primary_colour, '')) <> '#202842';
  v_squads   := exists (select 1 from public.teams t where t.academy_id = v_academy and t.status = 'active');
  v_roster   := exists (select 1 from public.players p where p.academy_id = v_academy);
  v_programs := exists (select 1 from public.programs p where p.academy_id = v_academy);
  v_coaches  := exists (select 1 from public.academy_members m where m.academy_id = v_academy and m.role in ('coach', 'admin') and m.status = 'active')
             or exists (select 1 from public.invites i where i.academy_id = v_academy and i.role in ('coach', 'admin'))
             or exists (select 1 from public.join_links j where j.academy_id = v_academy and j.role in ('coach', 'admin'));
  v_session  := exists (select 1 from public.events e where e.academy_id = v_academy);

  v_core_done := v_brand and v_squads and v_roster and v_programs and v_coaches;
  if v_core_done and a.setup_completed_at is null then
    update public.academies set setup_completed_at = now() where id = v_academy;
    a.setup_completed_at := now();
  end if;

  v_steps := jsonb_build_array(
    jsonb_build_object('id', 'brand', 'label', 'Crest and colours', 'done', v_brand, 'href', '/start/setup#brand',
      'detail', case when v_brand then coalesce(nullif(a.primary_colour, ''), '') || case when a.logo_url is not null then ' · crest' else ' · no crest yet' end else 'Pick your colour; add the crest' end),
    jsonb_build_object('id', 'squads', 'label', 'Squads', 'done', v_squads, 'href', '/admin/teams',
      'detail', (select count(*) from public.teams t where t.academy_id = v_academy and t.status = 'active') || ' active'),
    jsonb_build_object('id', 'roster', 'label', 'Roster', 'done', v_roster, 'href', '/admin/import/players',
      'detail', (select count(*) from public.players p where p.academy_id = v_academy) || ' players — import a spreadsheet, or add them by hand'),
    jsonb_build_object('id', 'programs', 'label', 'Programs', 'done', v_programs, 'href', '/admin/programs',
      'detail', case when v_programs then (select count(*) from public.programs p where p.academy_id = v_academy) || ' set up' else 'The squad season, a camp, trials — what families register for' end),
    jsonb_build_object('id', 'coaches', 'label', 'Coaches', 'done', v_coaches, 'href', '/admin/invites',
      'detail', case when v_coaches then 'Invited' else 'A link or a code for each coach; they need a WWCC on file to be given a squad' end),
    jsonb_build_object('id', 'session', 'label', 'First training', 'done', v_session, 'href', '/calendar',
      'detail', case when v_session then 'In the calendar' else 'Weekly training, set once' end)
  );
  select count(*) into v_done from jsonb_array_elements(v_steps) s where (s->>'done')::boolean;

  return jsonb_build_object(
    'academy_id', v_academy,
    'name', a.name,
    'slug', a.slug,
    'primary_colour', a.primary_colour,
    'logo_url', a.logo_url,
    'started_at', a.setup_started_at,
    'completed_at', a.setup_completed_at,
    'minutes', round(extract(epoch from (coalesce(a.setup_completed_at, now()) - a.setup_started_at)) / 60),
    'grandfathered', a.setup_completed_at is not null and a.setup_completed_at <= a.setup_started_at + interval '1 minute',
    'steps', v_steps,
    'done', v_done,
    'total', jsonb_array_length(v_steps),
    'complete', v_core_done);
end;
$$;

revoke execute on function public.set_academy_logo(uuid, text) from public, anon;
grant execute on function public.set_academy_logo(uuid, text) to authenticated;
revoke execute on function public.setup_progress(uuid) from public, anon;
grant execute on function public.setup_progress(uuid) to authenticated;
