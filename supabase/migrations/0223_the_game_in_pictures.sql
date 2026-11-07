-- 0223: the game in pictures.
--
-- M5's last piece — X-05's "Live/Result … photos". The squad's coach adds a
-- game's photos; the squad's people see them on its Match sheet, under the
-- video (0206). Nothing about them is public — not the public match centre,
-- not a share card — and the families get one push, not one per photo.
--
-- They are photographs of children, so:
--
--   THE COACH IS TOLD WHO MUST NOT BE IN THEM, where they add them
--   (photo_consent_check, 0128, through the squad's chat). A refusal is a
--   hard no. We do not pretend to recognise faces: the person who was there
--   does the looking.
--
--   ANYONE IN THE SQUAD CAN TAKE ONE DOWN, AT ONCE. "Take it down" hides it
--   from everyone but the coaches, who are told and who put it back or
--   delete it. A family should never have to argue for a picture of their
--   child to come down; a coach can argue for it to go back up.
--
--   HIDDEN MEANS HIDDEN to the database: the table's policy and the file's
--   read the same rule (may_see_match_photo), so no new link to a hidden
--   photo can be made. A link already made expires within the hour, as every
--   private file's does.
--
-- Small first: the phone uploads each photo twice, at 1600px and as a 400px
-- thumbnail (lib/adapters/images.ts), so sixty photos are a grid of a couple
-- of megabytes on a parent's data plan, and the full one only when tapped.

create table if not exists public.event_photos (
  id           uuid primary key default gen_random_uuid(),
  academy_id   uuid not null references public.academies(id) on delete cascade,
  event_id     uuid not null,
  storage_path text not null unique,
  thumb_path   text unique,
  width        integer check (width is null or width > 0),
  height       integer check (height is null or height > 0),
  added_by     uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  -- Taken down by someone in the squad; only the coaches see it until they
  -- put it back or delete it.
  hidden_at    timestamptz,
  hidden_by    uuid references public.profiles(id) on delete set null,
  foreign key (event_id, academy_id) references public.events(id, academy_id) on delete cascade
);
create index if not exists event_photos_event_idx on public.event_photos (event_id, created_at);

/**
 * Whether the person asking may see this photo, or its thumbnail: the
 * squad's coaches always, the squad's people while it is not taken down.
 * The table's policy and the bucket's both ask this.
 */
create or replace function app_private.may_see_match_photo(p_path text)
returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.event_photos p
     where (p.storage_path = p_path or p.thumb_path = p_path)
       and (coalesce(app_private.is_team_coach(app_private.event_team(p.event_id)), false)
            or (p.hidden_at is null
                and coalesce(app_private.is_team_member(app_private.event_team(p.event_id)), false))));
$fn$;

alter table public.event_photos enable row level security;
drop policy if exists event_photos_read on public.event_photos;
create policy event_photos_read on public.event_photos for select to authenticated
  using ((select app_private.is_team_coach(app_private.event_team(event_id)))
         or (hidden_at is null and (select app_private.is_team_member(app_private.event_team(event_id)))));
-- Written only through the functions below.
grant select on public.event_photos to authenticated;

-- The files: private, under <academy>/<event>/. The coach of the squad
-- writes and deletes them, and reads the folder (an upload is read back
-- before its row exists); everyone else reads a photo that is up.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('match-photos', 'match-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do nothing;
drop policy if exists match_photos_read on storage.objects;
create policy match_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'match-photos'
         and (app_private.is_team_coach(app_private.event_team(((storage.foldername(name))[2])::uuid))
              or app_private.may_see_match_photo(name)));
drop policy if exists match_photos_coach_insert on storage.objects;
create policy match_photos_coach_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'match-photos'
              and app_private.is_team_coach(app_private.event_team(((storage.foldername(name))[2])::uuid)));
drop policy if exists match_photos_coach_delete on storage.objects;
create policy match_photos_coach_delete on storage.objects for delete to authenticated
  using (bucket_id = 'match-photos'
         and app_private.is_team_coach(app_private.event_team(((storage.foldername(name))[2])::uuid)));

-- ------------------------------------------------------------- notification kinds
do $$
declare
  v_name text;
begin
  select conname into v_name from pg_constraint
   where conrelid = 'public.notification_queue'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) like '%kind = ANY%';
  if v_name is not null then
    execute format('alter table public.notification_queue drop constraint %I', v_name);
  end if;
  alter table public.notification_queue add constraint notification_queue_kind_check check (kind = any (array[
    'message', 'announcement', 'event_reminder', 'poll_opened', 'poll_closing', 'rsvp_change', 'invite',
    'event_cancelled', 'event_changed', 'event_back_on', 'rsvp_nudge', 'announcement_repeat', 'wwcc_expiring',
    'guardian_erased', 'official_rego_pending', 'reregister_nudge', 'offer', 'referee_appointment',
    'referee_response', 'referee_withdrawn', 'fixture_change_proposed', 'fixture_change_answered',
    'fixture_change_decided', 'mention', 'match_correction_requested', 'match_correction_decided',
    'fixture_flowing_open', 'discipline_warning', 'discipline_suspension', 'forfeit_request', 'forfeit_decided',
    'nomination', 'fee_due', 'fee_overdue', 'player_report', 'player_clip', 'selected', 'not_selected',
    'match_day', 'support_reply', 'match_video', 'match_photos', 'photo_hidden']));
end $$;

-- ----------------------------------------------------------------- reading
create or replace function public.match_photos(p_event uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare
  e       public.events;
  v_coach boolean;
  v_chan  uuid;
begin
  select * into e from public.events where id = p_event;
  if e.id is null then return null; end if;
  v_coach := coalesce(app_private.is_team_coach(e.team_id), false);
  if not (v_coach or coalesce(app_private.is_team_member(e.team_id), false)) then
    raise exception 'that game is another squad''s' using errcode = '42501';
  end if;
  if v_coach then
    select c.id into v_chan from public.channels c
     where c.team_id = e.team_id and c.type = 'team'
     order by c.created_at
     limit 1;
  end if;
  return jsonb_build_object(
    'can_add', v_coach,
    'played', e.type in ('match', 'tournament') and e.starts_at <= now() and e.cancelled_at is null,
    'limit', 60,
    -- Who must not be in them, for the coach about to add them (0128).
    'consent', case when v_chan is not null then public.photo_consent_check(v_chan) end,
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'path', p.storage_path, 'thumb', coalesce(p.thumb_path, p.storage_path),
               'width', p.width, 'height', p.height, 'at', p.created_at,
               'by', (select pr.full_name from public.profiles pr where pr.id = p.added_by),
               'hidden', p.hidden_at is not null,
               'hidden_by', case when v_coach then (select pr.full_name from public.profiles pr where pr.id = p.hidden_by) end)
             order by p.created_at)
        from public.event_photos p
       where p.event_id = p_event and (v_coach or p.hidden_at is null)), '[]'::jsonb));
end;
$fn$;

-- ------------------------------------------------------------------ adding
/**
 * The coach's photos of a game, already uploaded: [{path, thumb, width,
 * height}]. Sixty a game at most. One push to the squad per game in six
 * hours, however many batches — "U9 Navy v Hornsby — photos are up".
 */
create or replace function public.add_match_photos(p_event uuid, p_photos jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $fn$
declare
  e        public.events;
  v_have   integer;
  v_new    integer := 0;
  v_item   jsonb;
  v_path   text;
  v_thumb  text;
  v_folder text;
  v_team   text;
begin
  select * into e from public.events where id = p_event;
  if e.id is null or not coalesce(app_private.is_team_coach(e.team_id), false) then
    raise exception 'only the squad''s coach adds the game''s photos' using errcode = '42501';
  end if;
  if e.type not in ('match', 'tournament') then
    raise exception 'only a game has photos' using errcode = '22023';
  end if;
  if e.starts_at > now() then
    raise exception 'photos come after kick-off' using errcode = '22023';
  end if;
  if jsonb_typeof(p_photos) is distinct from 'array' or jsonb_array_length(p_photos) = 0 then
    raise exception 'no photos to add' using errcode = '22023';
  end if;
  select count(*) into v_have from public.event_photos where event_id = p_event;
  if v_have + jsonb_array_length(p_photos) > 60 then
    raise exception 'a game keeps sixty photos at most — % more fit', greatest(60 - v_have, 0) using errcode = '22023';
  end if;

  v_folder := e.academy_id::text || '/' || e.id::text || '/';
  for v_item in select * from jsonb_array_elements(p_photos) loop
    v_path := v_item ->> 'path';
    v_thumb := nullif(v_item ->> 'thumb', '');
    if coalesce(v_path, '') !~ ('^' || v_folder || '[^/]+$')
       or (v_thumb is not null and v_thumb !~ ('^' || v_folder || '[^/]+$')) then
      raise exception 'a photo lives under this game''s folder' using errcode = '22023';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'match-photos' and o.name = v_path) then
      raise exception 'a photo did not finish uploading — try it again' using errcode = '22023';
    end if;
    insert into public.event_photos (academy_id, event_id, storage_path, thumb_path, width, height, added_by)
    values (e.academy_id, p_event, v_path, v_thumb,
            nullif(nullif(v_item ->> 'width', '')::integer, 0), nullif(nullif(v_item ->> 'height', '')::integer, 0),
            auth.uid())
    on conflict (storage_path) do nothing;
    if found then
      v_new := v_new + 1;
    end if;
  end loop;

  if v_new > 0 then
    select t.name into v_team from public.teams t where t.id = e.team_id;
    insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload)
    select e.academy_id, tm.profile_id, 'match_photos',
           coalesce(v_team, 'Your squad') || coalesce(' v ' || e.opponent, '') || ' — photos are up',
           'From the coach; only this squad can see them.',
           '/calendar/' || p_event || '#sheet',
           jsonb_build_object('event_id', p_event)
      from (select distinct m.profile_id from public.team_members m
             where m.team_id = e.team_id and m.profile_id <> auth.uid()) tm
     where not exists (select 1 from public.notification_queue q
                        where q.kind = 'match_photos' and q.profile_id = tm.profile_id
                          and q.payload->>'event_id' = p_event::text
                          and q.created_at > now() - interval '6 hours');
  end if;

  return public.match_photos(p_event);
end;
$fn$;

-- ---------------------------------------------- taking down, putting back
/** Anyone in the squad: hidden at once from everyone but the coaches, who are told. */
create or replace function public.take_down_match_photo(p_photo uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $fn$
declare
  v      public.event_photos;
  e      public.events;
  v_team text;
begin
  select * into v from public.event_photos where id = p_photo;
  if v.id is null
     or not (coalesce(app_private.is_team_member(app_private.event_team(v.event_id)), false)
             or coalesce(app_private.is_team_coach(app_private.event_team(v.event_id)), false)) then
    raise exception 'that photo is another squad''s' using errcode = '42501';
  end if;
  if v.hidden_at is null then
    update public.event_photos set hidden_at = now(), hidden_by = auth.uid() where id = p_photo;
    select * into e from public.events where id = v.event_id;
    select t.name into v_team from public.teams t where t.id = e.team_id;
    -- The squad's coaches; a squad without one, the club's owners and admins.
    insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload)
    select e.academy_id, c.profile_id, 'photo_hidden',
           coalesce(v_team, 'A squad') || coalesce(' v ' || e.opponent, '') || ' — a photo was taken down',
           'Someone in the squad asked for it to come down. Put it back or delete it.',
           '/calendar/' || e.id || '#sheet',
           jsonb_build_object('event_id', e.id, 'photo_id', p_photo)
      from (
        select m.profile_id from public.team_members m where m.team_id = e.team_id and m.role = 'coach'
        union
        select am.profile_id from public.academy_members am
         where am.academy_id = e.academy_id and am.status = 'active' and am.role in ('owner', 'admin')
           and not exists (select 1 from public.team_members m where m.team_id = e.team_id and m.role = 'coach')
      ) c
     where c.profile_id <> auth.uid();
  end if;
  return public.match_photos(v.event_id);
end;
$fn$;

/** The coach: a photo taken down goes back up. */
create or replace function public.restore_match_photo(p_photo uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $fn$
declare
  v public.event_photos;
begin
  select * into v from public.event_photos where id = p_photo;
  if v.id is null or not coalesce(app_private.is_team_coach(app_private.event_team(v.event_id)), false) then
    raise exception 'only the squad''s coach puts a photo back' using errcode = '42501';
  end if;
  update public.event_photos set hidden_at = null, hidden_by = null where id = p_photo;
  return public.match_photos(v.event_id);
end;
$fn$;

/** The coach: the photo's row goes; the phone then deletes its files. */
create or replace function public.remove_match_photo(p_photo uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $fn$
declare
  v public.event_photos;
begin
  select * into v from public.event_photos where id = p_photo;
  if v.id is null or not coalesce(app_private.is_team_coach(app_private.event_team(v.event_id)), false) then
    raise exception 'only the squad''s coach deletes a photo' using errcode = '42501';
  end if;
  delete from public.event_photos where id = p_photo;
  return jsonb_build_object(
    'files', to_jsonb(array_remove(array[v.storage_path, v.thumb_path], null)),
    'photos', public.match_photos(v.event_id));
end;
$fn$;

-- The Matchdays tab (0206), with how many photos are up.
create or replace function public.my_matchdays(p_academy uuid, p_limit integer default 40)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare
  v_staff boolean := coalesce(app_private.is_academy_coach(p_academy), false);
begin
  if not coalesce(app_private.is_academy_member(p_academy), false) then
    raise exception 'not a member of that club' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', e.id, 'title', e.title, 'starts_at', e.starts_at, 'opponent', e.opponent, 'venue', e.venue,
             'team_id', e.team_id, 'team', (select t.name from public.teams t where t.id = e.team_id),
             'ours', coalesce(e.our_score, case when e.fixture_id is not null then (select case when ce.id = f.home_entry_id then f.home_score else f.away_score end from public.fixtures f join public.competition_entries ce on ce.team_id = e.team_id and ce.competition_id = f.competition_id where f.id = e.fixture_id) end),
             'theirs', coalesce(e.their_score, case when e.fixture_id is not null then (select case when ce.id = f.home_entry_id then f.away_score else f.home_score end from public.fixtures f join public.competition_entries ce on ce.team_id = e.team_id and ce.competition_id = f.competition_id where f.id = e.fixture_id) end),
             'scorers', coalesce((select jsonb_agg(jsonb_build_object('name', pl.full_name, 'goals', s.goals) order by s.goals desc, pl.full_name)
                                    from public.event_player_stats s join public.players pl on pl.id = s.player_id
                                   where s.event_id = e.id and s.goals > 0), '[]'::jsonb),
             'videos', (select count(*) from public.event_videos v where v.event_id = e.id),
             -- 0223: and the photos still up.
             'photos', (select count(*) from public.event_photos p where p.event_id = e.id and p.hidden_at is null))
           order by e.starts_at desc)
      from (
        select e.* from public.events e
         where e.academy_id = p_academy and e.type in ('match', 'tournament') and e.cancelled_at is null
           and e.private_to is null and e.starts_at <= now()
           and (v_staff or exists (select 1 from public.team_members tm where tm.team_id = e.team_id and tm.profile_id = auth.uid()))
         order by e.starts_at desc limit greatest(coalesce(p_limit, 40), 1)
      ) e), '[]'::jsonb);
end;
$fn$;

revoke execute on function public.match_photos(uuid) from public, anon;
revoke execute on function public.add_match_photos(uuid, jsonb) from public, anon;
revoke execute on function public.take_down_match_photo(uuid) from public, anon;
revoke execute on function public.restore_match_photo(uuid) from public, anon;
revoke execute on function public.remove_match_photo(uuid) from public, anon;
revoke execute on function public.my_matchdays(uuid, integer) from public, anon;
grant execute on function public.match_photos(uuid) to authenticated;
grant execute on function public.add_match_photos(uuid, jsonb) to authenticated;
grant execute on function public.take_down_match_photo(uuid) to authenticated;
grant execute on function public.restore_match_photo(uuid) to authenticated;
grant execute on function public.remove_match_photo(uuid) to authenticated;
grant execute on function public.my_matchdays(uuid, integer) to authenticated;
