-- 0278 — what the screen check saw (Season 4 simulation, 15 Nov 2026).
--
-- 1. A club president opened a squad chat they were not a member of. The
--    screen let them in and made them a host ("academy staff host every
--    channel", channel_screen), then showed "Nothing here yet. Say hello."
--    above a working composer: channel_messages hid every line from anyone
--    who was not a member. Staff read the club's channels — team, age group,
--    coaches, club-wide, custom. Not a direct chat: a conversation between
--    two people is theirs, and the screen now refuses staff there too
--    instead of opening an empty room.
-- 2. A team manager (a club role, not a hat) could not open the league's
--    Notices: "Not one of your chats". The league speaks to the entered
--    clubs' staff and the teams' families; the person who files the team
--    sheet and reads the league's rules is staff for this purpose.

create or replace function app_private.staff_reads_channel(p_channel uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.channels c
     where c.id = p_channel
       and c.type not in ('direct', 'notices', 'clubs', 'referees', 'committee', 'managers')
       and app_private.is_academy_staff(c.academy_id)
  );
$$;

create or replace function public.channel_messages(p_channel uuid, p_before timestamp with time zone default null, p_limit integer default 50)
returns table(id uuid, body text, attachments jsonb, sender_id uuid, sender_name text, sender_role academy_role, sender_label text, reply_to_id uuid, reply_to_body text, reply_to_name text, is_announcement boolean, pinned_at timestamp with time zone, created_at timestamp with time zone, edited_at timestamp with time zone, deleted_at timestamp with time zone, event_id uuid, event jsonb, poll_id uuid, poll jsonb, reply_count integer, reply_to_announcement boolean, audience text)
language sql stable security definer set search_path = public as $$
  select
    m.id,
    case when m.deleted_at is null then m.body else null end,
    case when m.deleted_at is null then m.attachments else '[]'::jsonb end,
    m.sender_id,
    p.full_name,
    am.role,
    app_private.channel_member_label(p_channel, m.sender_id),
    m.reply_to_id,
    case when r.deleted_at is null then r.body else null end,
    rp.full_name,
    m.is_announcement,
    m.pinned_at,
    m.created_at,
    m.edited_at,
    m.deleted_at,
    m.event_id,
    case when m.event_id is null then null else (
      select to_jsonb(e) from (
        select ev.id, ev.title, ev.type, ev.starts_at, ev.ends_at, ev.arrive_at,
               ev.venue, ev.address, ev.opponent, ev.kit_colour, ev.cancelled_at
          from public.events ev where ev.id = m.event_id
      ) e
    ) end,
    m.poll_id,
    case when m.poll_id is null then null else (
      select to_jsonb(q) from (
        select po.id, po.question, po.options, po.type, po.multi, po.anonymous,
               po.closes_at, po.closed_at
          from public.polls po where po.id = m.poll_id
      ) q
    ) end,
    (select count(*)::integer from public.messages x where x.reply_to_id = m.id and x.status = 'published' and x.deleted_at is null),
    coalesce(r.is_announcement, false),
    m.audience
  from public.messages m
  left join public.profiles p on p.id = m.sender_id
  left join public.academy_members am
    on am.academy_id = m.academy_id and am.profile_id = m.sender_id
  left join public.messages r on r.id = m.reply_to_id
  left join public.profiles rp on rp.id = r.sender_id
  where m.channel_id = p_channel
    and m.status = 'published'
    and (p_before is null or m.created_at < p_before)
    -- 0278: a member, or the club's staff in one of the club's own channels.
    and ((select app_private.is_channel_member(p_channel)) or (select app_private.staff_reads_channel(p_channel)))
    and (m.audience = 'everyone' or (select app_private.sees_staff_notices(p_channel)))
  order by m.created_at desc
  limit least(coalesce(p_limit, 50), 100);
$$;

-- The screen's door matches the list: staff may open the club's channels,
-- not a direct chat between two others.
do $$
declare
  v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'channel_screen';
  if position('if not (coalesce(app_private.is_channel_member(p_channel), false) or coalesce(app_private.is_academy_staff(c.academy_id), false)) then' in v_src) = 0 then
    raise exception 'channel_screen does not look as 0278 expects; edit it by hand';
  end if;
  v_src := replace(v_src,
    'if not (coalesce(app_private.is_channel_member(p_channel), false) or coalesce(app_private.is_academy_staff(c.academy_id), false)) then',
    'if not (coalesce(app_private.is_channel_member(p_channel), false) or coalesce(app_private.staff_reads_channel(p_channel), false)) then');
  execute v_src;
end $$;

-- 2. Team managers stand with the staff for a competition's Notices.
create or replace function app_private.notices_standing(p_competition uuid, p_profile uuid)
returns text
language sql stable security definer set search_path = public as $$
  with c as (
    select id, organiser_id from public.competitions where id = p_competition
  ),
  clubs as (
    select cc.academy_id from public.competition_clubs cc
     where cc.competition_id = p_competition and cc.status = 'active'
    union
    select organiser_id from c
  ),
  teams as (
    select ce.team_id from public.competition_entries ce
     where ce.competition_id = p_competition
       and ce.team_id is not null
       and ce.academy_id in (select academy_id from clubs)
  )
  select case
    when p_profile is null or not exists (select 1 from c) then null
    when (exists (select 1 from public.academy_members am join c on am.academy_id = c.organiser_id
                   where am.profile_id = p_profile and am.status = 'active' and am.role in ('owner', 'admin'))
          or exists (select 1 from public.league_roles lr join c on lr.academy_id = c.organiser_id
                      where lr.profile_id = p_profile and lr.role = 'competition_manager'))
         and (p_profile <> auth.uid() or app_private.two_step_ok_for((select organiser_id from c)))
      then 'league'
    when exists (select 1 from public.league_roles lr join c on lr.academy_id = c.organiser_id
                  where lr.profile_id = p_profile)
      or exists (select 1 from public.academy_members am
                  where am.profile_id = p_profile and am.status = 'active' and am.role in ('owner', 'admin', 'coach')
                    and am.academy_id in (select academy_id from clubs))
      or exists (select 1 from public.team_members tm
                  where tm.profile_id = p_profile and tm.role = 'coach'
                    and tm.team_id in (select team_id from teams))
      -- 0278: the team's manager (a club role) files the sheet and reads the rules.
      or exists (select 1 from public.club_roles cr
                  where cr.profile_id = p_profile and cr.role = 'team_manager'
                    and cr.team_id in (select team_id from teams))
      then 'staff'
    when exists (select 1 from public.team_members tm
                  where tm.profile_id = p_profile and tm.role in ('parent', 'player')
                    and tm.team_id in (select team_id from teams))
      then 'family'
    when exists (select 1 from public.referees r join c on r.academy_id = c.organiser_id
                  where r.profile_id = p_profile and r.status = 'active')
      then 'referee'
  end;
$$;

create or replace function app_private.notices_people(p_competition uuid)
returns table(profile_id uuid, standing text)
language sql stable security definer set search_path = public as $$
  with c as (
    select id, organiser_id from public.competitions where id = p_competition
  ),
  clubs as (
    select cc.academy_id from public.competition_clubs cc
     where cc.competition_id = p_competition and cc.status = 'active'
    union
    select organiser_id from c
  ),
  teams as (
    select ce.team_id from public.competition_entries ce
     where ce.competition_id = p_competition
       and ce.team_id is not null
       and ce.academy_id in (select academy_id from clubs)
  ),
  everyone as (
    select am.profile_id, 'league'::text as standing, 1 as rank
      from public.academy_members am join c on am.academy_id = c.organiser_id
     where am.status = 'active' and am.role in ('owner', 'admin')
    union all
    select lr.profile_id,
           case when lr.role = 'competition_manager' then 'league' else 'staff' end,
           case when lr.role = 'competition_manager' then 1 else 2 end
      from public.league_roles lr join c on lr.academy_id = c.organiser_id
    union all
    select am.profile_id, 'staff', 2
      from public.academy_members am
     where am.status = 'active' and am.role in ('owner', 'admin', 'coach')
       and am.academy_id in (select academy_id from clubs)
    union all
    select tm.profile_id, 'staff', 2
      from public.team_members tm
     where tm.role = 'coach' and tm.team_id in (select team_id from teams)
    union all
    -- 0278: team managers.
    select cr.profile_id, 'staff', 2
      from public.club_roles cr
     where cr.role = 'team_manager' and cr.team_id in (select team_id from teams)
    union all
    select tm.profile_id, 'family', 3
      from public.team_members tm
     where tm.role in ('parent', 'player') and tm.team_id in (select team_id from teams)
    union all
    select r.profile_id, 'referee', 4
      from public.referees r join c on r.academy_id = c.organiser_id
     where r.profile_id is not null and r.status = 'active'
  )
  select distinct on (e.profile_id) e.profile_id, e.standing
    from everyone e
   order by e.profile_id, e.rank;
$$;

-- 3. A forfeit decided before kick-off left the families' game on their
--    calendar as if it were still to be played (Season 4 simulation, R4).
--    A forfeit is a game that is off: called off with the reason, and the
--    families hear it the way they hear a washout.
create or replace function public.mirror_fixture(p_fixture uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  f         public.fixtures%rowtype;
  e         record;
  opponent_name text;
  comp_name text;
  v_venue   text;
begin
  select * into f from public.fixtures where id = p_fixture;
  if f.id is null then return; end if;

  select name into comp_name from public.competitions where id = f.competition_id;
  v_venue := coalesce(f.venue_label, (select name from public.venues where id = f.venue_id));
  if f.field_label is not null and v_venue is not null and position(f.field_label in v_venue) = 0 then
    v_venue := v_venue || ' · ' || f.field_label;
  end if;

  for e in
    select ce.*, (case when ce.id = f.home_entry_id then f.away_entry_id else f.home_entry_id end) as other_id
      from public.competition_entries ce
     where ce.id in (f.home_entry_id, f.away_entry_id)
       and ce.academy_id is not null
       and ce.team_id is not null
  loop
    select display_name into opponent_name from public.competition_entries where id = e.other_id;

    insert into public.events (
      academy_id, team_id, competition_id, fixture_id, type, title,
      starts_at, ends_at, venue, opponent, round
    )
    values (
      e.academy_id, e.team_id, f.competition_id, f.id, 'match',
      coalesce(comp_name, 'Fixture') || ' — vs ' || coalesce(opponent_name, 'TBC'),
      coalesce(f.starts_at, now()),
      case when f.starts_at is not null and f.duration_mins is not null
           then f.starts_at + (f.duration_mins || ' minutes')::interval end,
      v_venue,
      opponent_name, f.round
    )
    on conflict (fixture_id, academy_id) where fixture_id is not null do update
      set starts_at    = excluded.starts_at,
          ends_at      = excluded.ends_at,
          venue        = excluded.venue,
          opponent     = excluded.opponent,
          round        = excluded.round,
          title        = excluded.title,
          cancelled_at = case when f.status in ('cancelled','postponed','bye','forfeit')
                              then coalesce(public.events.cancelled_at, now()) end,
          cancellation_reason = case when f.status in ('cancelled','postponed') then f.cancel_reason
                                     when f.status = 'bye' then 'other'
                                     when f.status = 'forfeit' then 'forfeit' end,
          cancellation_note   = case when f.status in ('cancelled','postponed') then f.notes
                                     when f.status = 'bye' then coalesce(f.notes, 'Bye — no game this round')
                                     when f.status = 'forfeit' then coalesce(f.notes, 'Forfeit — ' || coalesce(f.home_score, 0) || '–' || coalesce(f.away_score, 0) || ' awarded') end;
  end loop;
end;
$$;

-- 4. A division whose ladder is off (MiniRoos) served its table to any
--    participant who asked the function; the screens hid the tab, the
--    database did not. Only the league sees it now.
create or replace function public.competition_ladder(p_competition uuid, p_division text)
returns table(entry_id uuid, team_name text, group_label text, played integer, won integer, drawn integer, lost integer, goals_for integer, goals_against integer, goal_difference integer, points integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not app_private.is_competition_participant(p_competition) then
    return;
  end if;
  if not coalesce((select d.ladder_enabled from public.competition_divisions d where d.competition_id = p_competition and d.division = p_division), true)
     and not coalesce(app_private.may_run(p_competition, 'competition'), false) then
    return;
  end if;
  return query select * from app_private.ladder(p_competition, p_division);
end;
$$;
