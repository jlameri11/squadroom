-- 0285 — what the simulation's admin-mistakes, switches and family-data
-- scenarios found (16 Nov 2026).
--
-- 1. A switched-off feature is off through its functions, not only hidden on
--    its screens: scheduling a message, asking for a role, adding game photos
--    or a video, making a poll — each refuses with a sentence when the club
--    has turned it off (Settings → Features).
-- 2. A wrong draw import can be undone: undo_event_import removes the games
--    an import made, by their references, while none has started.
-- 3. Re-publishing a draw mid-season keeps every game already played, moved
--    or called off, and never draws a pair that has already met: the pair
--    skip looks at every kept game in the division, not only a pinned one in
--    the same round. Eight pairs met three times in the simulation.
-- 4. A squad with players, games or money on record cannot be deleted — the
--    club ends its season instead and loses nothing (a delete took 15
--    players, 52 games and 27 memberships with it). The two composite
--    "set null" keys without a column list (programs, incident reports) are
--    given one, so a legitimate delete no longer fails on a not-null column.
-- 5. A family's erasure keeps the money records, as its manifest promises:
--    payments.profile_id is set null when the account goes, not cascaded.

-- ------------------------------------------- 1. off means off

create or replace function public.schedule_message(p_channel uuid, p_body text, p_at timestamptz, p_announcement boolean default false)
returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  v_academy uuid;
  v_id uuid;
begin
  -- 0285: switched off for this club?
  if not app_private.feature_on((select c.academy_id from public.channels c where c.id = p_channel), 'scheduled_messages') then
    raise exception 'Scheduled messages are switched off for this club (Settings → Features)' using errcode = '42501';
  end if;
  if auth.uid() is null then raise exception 'sign in first' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_body, ''))) = 0 then raise exception 'nothing to send' using errcode = '22023'; end if;
  if p_at is null or p_at <= now() then raise exception 'pick a time that has not happened yet' using errcode = '22023'; end if;
  if p_at > now() + interval '90 days' then raise exception 'ninety days is far enough ahead' using errcode = '22023'; end if;
  -- The same rules as sending now.
  if not app_private.can_post_in_channel(p_channel, null) then
    raise exception 'you cannot post in this channel' using errcode = '42501';
  end if;
  if p_announcement and not app_private.is_channel_host(p_channel) then
    raise exception 'only a host sends an announcement' using errcode = '42501';
  end if;
  select academy_id into v_academy from public.channels where id = p_channel;
  insert into public.messages (academy_id, channel_id, sender_id, body, status, is_announcement, scheduled_for)
  values (v_academy, p_channel, auth.uid(), btrim(p_body), 'scheduled', p_announcement, p_at)
  returning id into v_id;
  return v_id;
end;
$fn$;

create or replace function public.request_role(
  p_academy uuid,
  p_kind    public.role_request_kind,
  p_teams   uuid[] default '{}',
  p_area    text default null,
  p_note    text default null
) returns uuid
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_id    uuid;
  v_teams uuid[] := coalesce(p_teams, '{}');
begin
  -- 0285: switched off for this club?
  if not app_private.feature_on(p_academy, 'role_requests') then
    raise exception 'Role requests are switched off at this club (Settings → Features)' using errcode = '42501';
  end if;
  if auth.uid() is null or not app_private.is_academy_member(p_academy) then
    raise exception 'join the club first' using errcode = '42501';
  end if;
  if p_kind not in ('coach', 'team_manager', 'volunteer') then
    v_teams := '{}';
  end if;
  if p_kind in ('coach', 'team_manager') and coalesce(array_length(v_teams, 1), 0) = 0 then
    raise exception 'say which squad' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_teams) t(id)
              where not exists (select 1 from public.teams tm where tm.id = t.id and tm.academy_id = p_academy and tm.status = 'active')) then
    raise exception 'that squad is not this club''s' using errcode = '22023';
  end if;
  -- Already theirs: nothing to ask for.
  if (p_kind = 'coach' and not exists (select 1 from unnest(v_teams) t(id) where not app_private.is_team_coach(t.id)))
     or (p_kind = 'team_manager' and not exists (
           select 1 from unnest(v_teams) t(id)
            where not exists (select 1 from public.club_roles r where r.academy_id = p_academy and r.profile_id = auth.uid()
                                                                   and r.role = 'team_manager' and r.team_id = t.id)))
     or exists (select 1 from public.club_roles r
                 where r.academy_id = p_academy and r.profile_id = auth.uid() and r.scope_kind = 'club'
                   and r.role::text = p_kind::text)
     or (p_kind = 'referee' and exists (select 1 from public.referees rf where rf.academy_id = p_academy and rf.profile_id = auth.uid())) then
    raise exception 'that is already yours' using errcode = '22023';
  end if;
  insert into public.role_requests (academy_id, profile_id, kind, team_ids, area, note)
  values (p_academy, auth.uid(), p_kind, v_teams, nullif(btrim(p_area), ''), nullif(btrim(p_note), ''))
  on conflict (academy_id, profile_id, kind) where status = 'pending' do nothing
  returning id into v_id;
  if v_id is null then
    raise exception 'you have already asked — it is waiting on the committee' using errcode = '23505';
  end if;
  return v_id;
end;
$fn$;

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
  -- 0285: switched off for this club?
  if not app_private.feature_on((select ev.academy_id from public.events ev where ev.id = p_event), 'match_photos') then
    raise exception 'Game photos are switched off for this club (Settings → Features)' using errcode = '42501';
  end if;
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

create or replace function public.add_match_video(p_event uuid, p_kind text, p_url text default null, p_path text default null, p_title text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $fn$
declare
  e      public.events;
  v_id   uuid;
  v_team text;
begin
  -- 0285: switched off for this club?
  if not app_private.feature_on((select ev.academy_id from public.events ev where ev.id = p_event), 'match_video') then
    raise exception 'Game video is switched off for this club (Settings → Features)' using errcode = '42501';
  end if;
  select * into e from public.events where id = p_event;
  if e.id is null or not coalesce(app_private.is_team_coach(e.team_id), false) then
    raise exception 'only the squad''s coach adds the game video' using errcode = '42501';
  end if;
  if e.type not in ('match', 'tournament') then
    raise exception 'only a game has a video' using errcode = '22023';
  end if;
  if p_kind = 'link' then
    if coalesce(p_url, '') !~* '^https?://[^[:space:]]+$' then
      raise exception 'a video link is a web address (https://…)' using errcode = '22023';
    end if;
  elsif p_kind = 'upload' then
    if coalesce(p_path, '') !~ ('^' || e.academy_id::text || '/' || e.id::text || '/') then
      raise exception 'an upload lives under this game''s folder' using errcode = '22023';
    end if;
  else
    raise exception 'a video is a link or an upload' using errcode = '22023';
  end if;

  insert into public.event_videos (academy_id, event_id, kind, url, storage_path, title, added_by)
  values (e.academy_id, p_event, p_kind, case when p_kind = 'link' then btrim(p_url) end, case when p_kind = 'upload' then p_path end,
          nullif(btrim(coalesce(p_title, '')), ''), auth.uid())
  returning id into v_id;

  -- One push to the squad's families: the game, and that the video is up.
  select t.name into v_team from public.teams t where t.id = e.team_id;
  insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload, dedupe_key)
  select e.academy_id, tm.profile_id, 'match_video',
         coalesce(v_team, 'Your squad') || coalesce(' v ' || e.opponent, '') || ' — video is up',
         case when p_kind = 'upload' then 'Uploaded by the coach; only this squad can see it.' else 'A link from the coach. Open the game to watch it.' end,
         '/calendar/' || p_event,
         jsonb_build_object('event_id', p_event, 'video_id', v_id),
         'video:' || v_id || ':' || tm.profile_id
    from public.team_members tm
   where tm.team_id = e.team_id and tm.profile_id <> auth.uid()
  on conflict (dedupe_key) do nothing;

  return public.matchday_videos(p_event);
end;
$fn$;


-- A poll is made by an insert from the composer, so the switch is a trigger.
create or replace function public.polls_require_feature()
returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if not app_private.feature_on(new.academy_id, 'polls') then
    raise exception 'Polls are switched off for this club (Settings → Features)' using errcode = '42501';
  end if;
  return new;
end;
$fn$;
revoke execute on function public.polls_require_feature() from public, anon, authenticated;
drop trigger if exists polls_require_feature on public.polls;
create trigger polls_require_feature before insert on public.polls for each row execute function public.polls_require_feature();

-- ------------------------------------------- 2. a wrong draw import, undone
-- The games an import made, by the references the file gave them, gone
-- again — while none has kicked off and nobody has taken a register. The
-- same people who may import (a coach of the squad, the club's staff).
create or replace function public.undo_event_import(p_academy uuid, p_team uuid, p_refs text[])
returns integer
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_n integer;
  v_started integer;
begin
  if not (coalesce(app_private.is_academy_coach(p_academy), false) or coalesce(app_private.is_team_coach(p_team), false)) then
    raise exception 'only a coach can undo an import' using errcode = '42501';
  end if;
  if p_refs is null or cardinality(p_refs) = 0 then
    raise exception 'nothing to undo' using errcode = '22023';
  end if;
  select count(*) into v_started
    from public.events e
   where e.academy_id = p_academy and e.team_id = p_team and e.external_ref = any (p_refs)
     and (e.starts_at <= now() or exists (select 1 from public.event_attendance a where a.event_id = e.id));
  if v_started > 0 then
    raise exception '% of these games % already started or had a register taken — call those off instead', v_started, case when v_started = 1 then 'has' else 'have' end using errcode = '22023';
  end if;
  delete from public.events e
   where e.academy_id = p_academy and e.team_id = p_team and e.external_ref = any (p_refs)
     and coalesce(e.source, 'import') = 'import';
  get diagnostics v_n = row_count;
  perform app_private.log_activity(p_academy, 'import_undone', 'team', p_team, null, jsonb_build_object('kind', 'events', 'removed', v_n, 'refs', to_jsonb(p_refs)));
  return v_n;
end;
$fn$;
revoke execute on function public.undo_event_import(uuid, uuid, text[]) from public, anon;
grant execute on function public.undo_event_import(uuid, uuid, text[]) to authenticated;

-- ----------------------------- 3. a re-published draw never meets a pair twice

create or replace function public.generate_fixtures_managed(
  p_competition uuid, p_division text, p_start_at timestamptz,
  p_game_mins integer default 20, p_gap_mins integer default 5,
  p_fields text[] default array['Field 1'], p_venue_label text default null,
  p_replace boolean default false, p_round_every_days integer default 0,
  p_legs integer default 1, p_skip_dates date[] default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_groups     text[];
  v_group      text;
  v_ids        uuid[];
  v_n          integer;
  v_rounds     integer;
  v_r          integer;
  v_i          integer;
  v_home       uuid;
  v_away       uuid;
  v_rotated    uuid[];
  v_pair_home  uuid[] := '{}';
  v_pair_away  uuid[] := '{}';
  v_pair_group text[] := '{}';
  v_pair_round integer[] := '{}';
  v_done       boolean[] := '{}';
  v_total      integer;
  v_placed     integer := 0;
  v_slot       integer := 0;
  v_field      integer;
  v_busy       uuid[];
  v_k          integer;
  v_assigned   boolean;
  v_start      timestamptz;
  v_round_base timestamptz;
  v_max_round  integer;
  v_this_round integer;
  v_remaining  integer;
  v_leg        integer;
  v_leg_rounds integer;
  v_tz         text;
  v_local      timestamp;
  v_day        date;
  v_dates      date[] := '{}';
begin
  if not app_private.is_competition_organiser(p_competition) then
    raise exception 'only the organiser can build the draw' using errcode = '42501';
  end if;
  if coalesce(array_length(p_fields, 1), 0) = 0 then
    raise exception 'give me at least one field' using errcode = '22023';
  end if;
  if p_round_every_days < 0 then
    raise exception 'rounds cannot be spaced by a negative number of days'
      using errcode = '22023';
  end if;
  if p_legs not between 1 and 4 then
    raise exception 'a season is one to four legs' using errcode = '22023';
  end if;
  if coalesce(array_length(p_skip_dates, 1), 0) > 0 and p_round_every_days = 0 then
    raise exception 'a week can only be left out of a season drawn round by round' using errcode = '22023';
  end if;

  if p_replace then
    -- Only the unplayed, unpinned ones. Wiping results because someone
    -- regenerated a draw would be unforgivable on a tournament morning, and
    -- wiping a game the league moved by hand is Squadi's known flaw.
    delete from public.fixtures
     where competition_id = p_competition
       and division = p_division
       and status = 'scheduled'
       and home_score is null
       and not pinned;
  end if;

  -- A team that has withdrawn is not drawn (0276).
  select coalesce(array_agg(distinct coalesce(group_label, '')), '{}')
    into v_groups
    from public.competition_entries
   where competition_id = p_competition and division = p_division and withdrawn_at is null;

  -- pass 1: who plays who, once a leg; the second leg the other way round
  foreach v_group in array v_groups loop
    select array_agg(id order by coalesce(seed, 0), display_name)
      into v_ids
      from public.competition_entries
     where competition_id = p_competition
       and division = p_division
       and withdrawn_at is null
       and coalesce(group_label, '') = v_group;

    if coalesce(array_length(v_ids, 1), 0) < 2 then
      continue;
    end if;

    if array_length(v_ids, 1) % 2 = 1 then
      v_ids := v_ids || null::uuid;
    end if;

    v_n := array_length(v_ids, 1);
    v_rounds := v_n - 1;
    v_leg_rounds := v_rounds;

    for v_leg in 1..p_legs loop
      for v_r in 1..v_rounds loop
        for v_i in 1..(v_n / 2) loop
          v_home := v_ids[v_i];
          v_away := v_ids[v_n + 1 - v_i];
          if v_home is not null and v_away is not null then
            -- Alternate home and away through the leg; the next leg reverses it.
            if (v_r % 2 = 0) <> (v_leg % 2 = 0) then
              v_pair_home := v_pair_home || v_away;
              v_pair_away := v_pair_away || v_home;
            else
              v_pair_home := v_pair_home || v_home;
              v_pair_away := v_pair_away || v_away;
            end if;
            v_pair_group := v_pair_group || v_group;
            v_pair_round := v_pair_round || (v_r + (v_leg - 1) * v_leg_rounds);
            -- L-24 / 0285: a pairing the division already has — played, moved,
            -- called off, or pinned, whichever round it sits in — is drawn
            -- already. The home side names the leg, so a pair's second meeting
            -- is still drawn when only the first has happened.
            v_done := v_done || exists (
              select 1 from public.fixtures f
               where f.competition_id = p_competition and f.division = p_division
                 and f.home_entry_id = v_pair_home[array_length(v_pair_home, 1)]
                 and f.away_entry_id = v_pair_away[array_length(v_pair_away, 1)]);
          end if;
        end loop;

        v_rotated := array[v_ids[1]] || v_ids[v_n] || v_ids[2:v_n-1];
        v_ids := v_rotated;
      end loop;
    end loop;
  end loop;

  v_total := coalesce(array_length(v_pair_home, 1), 0);
  if v_total = 0 then
    return 0;
  end if;

  select max(r) into v_max_round from unnest(v_pair_round) r;

  -- The round dates, in the competition's zone: the start, then every
  -- p_round_every_days, skipping the dates the league leaves out (and every
  -- later round moves on a week with them). A calendar day, never 24 hours,
  -- so the clocks changing does not move a kick-off.
  v_tz := app_private.competition_tz(p_competition);
  v_local := p_start_at at time zone v_tz;
  if p_round_every_days > 0 then
    v_day := v_local::date;
    for v_r in 1..v_max_round loop
      while v_day = any (coalesce(p_skip_dates, '{}'::date[])) loop
        v_day := v_day + p_round_every_days;
      end loop;
      v_dates := v_dates || v_day;
      v_day := v_day + p_round_every_days;
    end loop;
  end if;

  -- pass 2: when and where
  for v_this_round in
    select r
      from generate_series(0, case when p_round_every_days = 0 then 0 else v_max_round end) r
     where p_round_every_days = 0 or r > 0
  loop
    v_round_base := case
      when p_round_every_days = 0 then p_start_at
      else (v_dates[v_this_round] + v_local::time) at time zone v_tz
    end;
    v_slot := 0;

    select count(*) into v_remaining
      from generate_subscripts(v_pair_home, 1) k
     where not v_done[k]
       and (v_this_round = 0 or v_pair_round[k] = v_this_round);

    while v_remaining > 0 loop
      v_busy := '{}';
      v_assigned := false;
      v_start := v_round_base + (v_slot * (p_game_mins + p_gap_mins) || ' minutes')::interval;

      for v_field in 1..array_length(p_fields, 1) loop
        if exists (
          select 1 from public.fixtures f
           where f.competition_id = p_competition
             and f.starts_at = v_start
             and f.field_label = p_fields[v_field]
             and coalesce(f.venue_label, '') = coalesce(p_venue_label, '')
        ) then
          continue;
        end if;

        for v_k in 1..v_total loop
          if v_done[v_k] then continue; end if;
          if v_this_round <> 0 and v_pair_round[v_k] <> v_this_round then continue; end if;
          if v_pair_home[v_k] = any(v_busy) or v_pair_away[v_k] = any(v_busy) then
            continue;
          end if;
          -- Nor playing elsewhere in this competition at this moment — a
          -- pinned game, or another division drawn earlier.
          if exists (
            select 1 from public.fixtures f
             where f.competition_id = p_competition
               and f.starts_at = v_start
               and (f.home_entry_id in (v_pair_home[v_k], v_pair_away[v_k])
                 or f.away_entry_id in (v_pair_home[v_k], v_pair_away[v_k]))
          ) then
            continue;
          end if;
          -- Nor a coach or manager of either side at another game then (0276).
          if app_private.staff_clash(p_competition, v_pair_home[v_k], v_pair_away[v_k], v_start,
                                     v_start + make_interval(mins => p_game_mins), p_venue_label, null) is not null then
            continue;
          end if;

          insert into public.fixtures (
            competition_id, division, group_label, round,
            home_entry_id, away_entry_id,
            starts_at, duration_mins, venue_label, field_label, status
          )
          values (
            p_competition, p_division, nullif(v_pair_group[v_k], ''),
            'Round ' || v_pair_round[v_k],
            v_pair_home[v_k], v_pair_away[v_k],
            v_start, p_game_mins, p_venue_label, p_fields[v_field], 'scheduled'
          );

          v_busy := v_busy || v_pair_home[v_k] || v_pair_away[v_k];
          v_done[v_k] := true;
          v_placed := v_placed + 1;
          v_remaining := v_remaining - 1;
          v_assigned := true;
          exit;
        end loop;
      end loop;

      if not v_assigned then
        if v_slot > v_total * 2 + 24 then
          raise exception 'could not schedule % remaining games in %',
            v_remaining, coalesce('round ' || nullif(v_this_round, 0)::text, 'the block');
        end if;
      end if;

      v_slot := v_slot + 1;
    end loop;
  end loop;

  return v_placed;
end;
$$;


-- ------------------------------ 4. a squad with a history cannot be deleted
create or replace function public.teams_refuse_delete_with_history()
returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  v_players integer; v_games integer; v_members integer; v_money integer; v_entries integer;
begin
  select count(*) into v_players from public.players where team_id = old.id;
  select count(*) into v_games from public.events where team_id = old.id;
  select count(*) into v_members from public.team_members where team_id = old.id;
  select count(*) into v_money from public.payments pm join public.payment_requests pr on pr.id = pm.request_id where pr.team_id = old.id;
  select count(*) into v_entries from public.competition_entries where team_id = old.id;
  if v_players + v_games + v_members + v_money + v_entries > 0 then
    raise exception 'This squad has % on record — end its season instead (Admin → Teams → End the season); nothing is lost. A squad can only be deleted while it is empty.',
      concat_ws(', ',
        case when v_players > 0 then v_players || ' players' end,
        case when v_games > 0 then v_games || ' games' end,
        case when v_members > 0 then v_members || ' members' end,
        case when v_money > 0 then v_money || ' payments' end,
        case when v_entries > 0 then v_entries || ' competition entries' end)
      using errcode = '23503';
  end if;
  return old;
end;
$fn$;
revoke execute on function public.teams_refuse_delete_with_history() from public, anon, authenticated;
drop trigger if exists teams_refuse_delete_with_history on public.teams;
create trigger teams_refuse_delete_with_history before delete on public.teams for each row execute function public.teams_refuse_delete_with_history();

-- The composite "set null" keys without a column list tried to null a
-- not-null academy_id and made a legitimate delete fail (PostgreSQL 15+
-- takes the list).
alter table public.programs drop constraint if exists programs_team_fkey;
alter table public.programs add constraint programs_team_fkey
  foreign key (team_id, academy_id) references public.teams(id, academy_id) on delete set null (team_id);
alter table public.incident_reports drop constraint if exists incident_reports_event_fkey;
alter table public.incident_reports add constraint incident_reports_event_fkey
  foreign key (event_id, academy_id) references public.events(id, academy_id) on delete set null (event_id);

-- ------------------------------------ 5. the money records outlive the person
alter table public.payments alter column profile_id drop not null;
alter table public.payments drop constraint if exists payments_profile_id_fkey;
alter table public.payments add constraint payments_profile_id_fkey
  foreign key (profile_id) references public.profiles(id) on delete set null;
