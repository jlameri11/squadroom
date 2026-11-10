-- 0245: the club's layers of talk.
--
-- Big Club Mode item 4 (Joey, 9 Nov 2026): "Communication layers (each
-- automatic by role/team — nobody adds people by hand). Club Notices
-- (read-only, everyone). Stream / age-group notices (read-only, by team
-- membership). Team chats (exist). Staff rooms: Committee, Coaches, Team
-- managers. DMs with existing safeguarding." Messages reach the right
-- people only; no reply-all storms.
--
-- What this adds, in club mode (0236) and only there:
--   * Club Notices — the club-wide channel becomes hosts-only (owners,
--     admins, the President and Secretary post; everyone reads).
--   * Age-group notices — the age-group channels become hosts-only; the
--     coordinator over an age group hosts its channel.
--   * Stream notices — one channel per stream, hosts-only, whose members
--     follow the teams in the stream through team_members (as the age-group
--     channels do); the stream's coordinator hosts it.
--   * The Committee room — computed, like the Clubs room (0235): owners,
--     admins, the President and Secretary host; the Registrar, Treasurer,
--     Welfare officer and Volunteer coordinator are in it.
--   * The Team managers' room — computed: the managers, with owners,
--     admins, President and Secretary hosting.
-- An academy that never switches club mode on keeps its open channels.

-- ================================================================ shape

alter table public.channels add column if not exists stream_id uuid;
do $$ begin
  alter table public.channels add constraint channels_stream_fkey
    foreign key (stream_id, academy_id) references public.streams (id, academy_id) on delete cascade;
exception when duplicate_object then null; end $$;
create unique index if not exists channels_one_stream on public.channels (academy_id, stream_id) where type = 'stream';
create unique index if not exists channels_one_committee on public.channels (academy_id) where type = 'committee';
create unique index if not exists channels_one_managers on public.channels (academy_id) where type = 'managers';
alter table public.channels drop constraint if exists channels_stream_needs_stream;
alter table public.channels add constraint channels_stream_needs_stream
  check ((type = 'stream') = (stream_id is not null));

-- ===================================================== the stream channel

create or replace function app_private.ensure_stream_channel(p_stream uuid)
returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  s public.streams;
  v_id uuid;
begin
  select * into s from public.streams where id = p_stream;
  if s.id is null then return null; end if;
  select id into v_id from public.channels where type = 'stream' and stream_id = p_stream;
  if v_id is not null then return v_id; end if;
  insert into public.channels (academy_id, type, stream_id, name, description, posting_mode, status)
  values (s.academy_id, 'stream', s.id, btrim(s.name), 'Notices for everyone in ' || btrim(s.name) || '. The stream''s coordinators and the club post here.', 'hosts_only', 'active')
  on conflict (academy_id, stream_id) where type = 'stream' do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.channels where type = 'stream' and stream_id = p_stream;
  end if;
  return v_id;
end;
$fn$;

create or replace function app_private.on_stream_channel()
returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if tg_op = 'INSERT' then
    perform app_private.ensure_stream_channel(new.id);
  elsif new.name is distinct from old.name then
    update public.channels set name = btrim(new.name) where type = 'stream' and stream_id = new.id;
  end if;
  return new;
end;
$fn$;
drop trigger if exists streams_channel on public.streams;
create trigger streams_channel
  after insert or update of name on public.streams
  for each row execute function app_private.on_stream_channel();
select app_private.ensure_stream_channel(s.id) from public.streams s;

-- Everyone on a team is in its stream's channel; leaving the last team in a
-- stream leaves the channel (0005's age-group shape).
create or replace function app_private.join_stream_channel(p_academy uuid, p_team uuid, p_profile uuid)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_stream uuid;
begin
  select t.stream_id into v_stream from public.teams t where t.id = p_team;
  if v_stream is null then return; end if;
  perform public.add_to_channel(app_private.ensure_stream_channel(v_stream), p_profile);
end;
$fn$;

create or replace function app_private.leave_stream_channel_if_last(p_academy uuid, p_stream uuid, p_profile uuid)
returns void
language plpgsql security definer set search_path = public as $fn$
begin
  if p_stream is null then return; end if;
  if not exists (
    select 1 from public.team_members tm join public.teams t on t.id = tm.team_id
     where tm.profile_id = p_profile and t.academy_id = p_academy and t.stream_id = p_stream) then
    delete from public.channel_members cm using public.channels c
     where cm.channel_id = c.id and c.type = 'stream' and c.stream_id = p_stream and cm.profile_id = p_profile;
  end if;
end;
$fn$;

create or replace function public.on_team_member_added()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_age_group text;
  v_channel   uuid;
begin
  select age_group into v_age_group from public.teams where id = new.team_id;

  for v_channel in
    select id from public.channels
     where team_id = new.team_id and status = 'active'
  loop
    perform public.add_to_channel(
      v_channel, new.profile_id,
      case when new.role = 'coach' then 'host'::public.channel_member_role
           else 'member'::public.channel_member_role end);
  end loop;

  perform public.add_to_channel(
    public.ensure_system_channel(new.academy_id, 'age_group', v_age_group),
    new.profile_id);

  -- 0245: and the team's stream, if it has one.
  perform app_private.join_stream_channel(new.academy_id, new.team_id, new.profile_id);

  if new.role = 'coach' then
    perform public.add_to_channel(
      public.ensure_system_channel(new.academy_id, 'coaches'), new.profile_id);
  end if;

  return new;
end;
$$;

create or replace function public.on_team_member_removed()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_age_group text;
  v_stream    uuid;
  v_still_in  integer;
begin
  select age_group, stream_id into v_age_group, v_stream from public.teams where id = old.team_id;

  delete from public.channel_members cm
   using public.channels c
   where cm.channel_id = c.id
     and c.team_id = old.team_id
     and cm.profile_id = old.profile_id;

  select count(*) into v_still_in
    from public.team_members tm
    join public.teams t on t.id = tm.team_id
   where tm.profile_id = old.profile_id
     and t.academy_id = old.academy_id
     and t.age_group = v_age_group;

  if v_still_in = 0 then
    delete from public.channel_members cm
     using public.channels c
     where cm.channel_id = c.id
       and c.academy_id = old.academy_id
       and c.type = 'age_group'
       and c.age_group = v_age_group
       and cm.profile_id = old.profile_id;
  end if;

  -- 0245: the stream's channel, when this was their last team in it.
  perform app_private.leave_stream_channel_if_last(old.academy_id, v_stream, old.profile_id);

  return old;
end;
$$;

-- A team moved to another stream takes its people with it.
create or replace function app_private.on_team_stream_changed()
returns trigger
language plpgsql security definer set search_path = public as $fn$
declare r record;
begin
  if new.stream_id is not distinct from old.stream_id then return new; end if;
  for r in select tm.profile_id from public.team_members tm where tm.team_id = new.id loop
    perform app_private.leave_stream_channel_if_last(new.academy_id, old.stream_id, r.profile_id);
    perform app_private.join_stream_channel(new.academy_id, new.id, r.profile_id);
  end loop;
  return new;
end;
$fn$;
drop trigger if exists teams_stream_channel on public.teams;
create trigger teams_stream_channel
  after update of stream_id on public.teams
  for each row execute function app_private.on_team_stream_changed();

-- Teams already in a stream: their people join now.
do $$
declare r record;
begin
  for r in select tm.academy_id, tm.team_id, tm.profile_id from public.team_members tm join public.teams t on t.id = tm.team_id where t.stream_id is not null loop
    perform app_private.join_stream_channel(r.academy_id, r.team_id, r.profile_id);
  end loop;
end $$;

-- ===================================== the Committee and the managers' room

create or replace function app_private.ensure_committee_channel(p_academy uuid)
returns uuid
language plpgsql security definer set search_path = public as $fn$
declare v_id uuid;
begin
  select id into v_id from public.channels where type = 'committee' and academy_id = p_academy;
  if v_id is not null then return v_id; end if;
  insert into public.channels (academy_id, type, name, description, posting_mode, status)
  values (p_academy, 'committee', 'Committee', 'The club''s committee: President, Secretary, Registrar, Treasurer, Welfare officer, Volunteer coordinator, with the owners and admins. Two-way.', 'open', 'active')
  on conflict (academy_id) where type = 'committee' do nothing
  returning id into v_id;
  if v_id is null then select id into v_id from public.channels where type = 'committee' and academy_id = p_academy; end if;
  return v_id;
end;
$fn$;

create or replace function app_private.ensure_managers_channel(p_academy uuid)
returns uuid
language plpgsql security definer set search_path = public as $fn$
declare v_id uuid;
begin
  select id into v_id from public.channels where type = 'managers' and academy_id = p_academy;
  if v_id is not null then return v_id; end if;
  insert into public.channels (academy_id, type, name, description, posting_mode, status)
  values (p_academy, 'managers', 'Team managers', 'Every team manager, with the owners, admins, President and Secretary. Two-way.', 'open', 'active')
  on conflict (academy_id) where type = 'managers' do nothing
  returning id into v_id;
  if v_id is null then select id into v_id from public.channels where type = 'managers' and academy_id = p_academy; end if;
  return v_id;
end;
$fn$;

-- Standing in the two rooms: 'league' hosts (the word 0235's is_channel_host
-- reads), 'member' otherwise, null when not in it. For the caller, the role
-- helpers (two-step and lapse aware); for anyone else, the rows.
create or replace function app_private.committee_standing(p_academy uuid, p_profile uuid)
returns text
language plpgsql stable security definer set search_path = public as $fn$
declare v public.club_role[];
begin
  if p_profile is null then return null; end if;
  if p_profile = auth.uid() then
    if coalesce(app_private.is_academy_staff(p_academy), false) then return 'league'; end if;
    v := app_private.club_roles_of(p_academy);
  else
    if exists (select 1 from public.academy_members m where m.academy_id = p_academy and m.profile_id = p_profile and m.status = 'active' and m.roles && array['owner','admin']::public.academy_role[]) then return 'league'; end if;
    select coalesce(array_agg(distinct r.role), '{}') into v from public.club_roles r where r.academy_id = p_academy and r.profile_id = p_profile;
  end if;
  if v && array['president','secretary']::public.club_role[] then return 'league'; end if;
  if v && array['registrar','treasurer','welfare_officer','volunteer_coordinator']::public.club_role[] then return 'member'; end if;
  return null;
end;
$fn$;

create or replace function app_private.managers_standing(p_academy uuid, p_profile uuid)
returns text
language plpgsql stable security definer set search_path = public as $fn$
declare v public.club_role[];
begin
  if p_profile is null then return null; end if;
  if p_profile = auth.uid() then
    if coalesce(app_private.is_academy_staff(p_academy), false) then return 'league'; end if;
    v := app_private.club_roles_of(p_academy);
  else
    if exists (select 1 from public.academy_members m where m.academy_id = p_academy and m.profile_id = p_profile and m.status = 'active' and m.roles && array['owner','admin']::public.academy_role[]) then return 'league'; end if;
    select coalesce(array_agg(distinct r.role), '{}') into v from public.club_roles r where r.academy_id = p_academy and r.profile_id = p_profile;
  end if;
  if v && array['president','secretary']::public.club_role[] then return 'league'; end if;
  if v && array['team_manager','coordinator']::public.club_role[] then return 'member'; end if;
  return null;
end;
$fn$;

-- 0235's computed-room helpers, with the two rooms added.
create or replace function app_private.group_standing(p_channel uuid)
returns text
language sql stable security definer set search_path = public as $fn$
  select case c.type
    when 'clubs' then app_private.clubs_standing(c.competition_id, auth.uid())
    when 'referees' then app_private.referees_standing(c.academy_id, auth.uid())
    when 'committee' then app_private.committee_standing(c.academy_id, auth.uid())
    when 'managers' then app_private.managers_standing(c.academy_id, auth.uid())
  end
  from public.channels c where c.id = p_channel;
$fn$;

create or replace function app_private.group_people(p_channel uuid)
returns table (profile_id uuid, standing text)
language sql stable security definer set search_path = public as $fn$
  with ch as (
    select id, type, academy_id, competition_id from public.channels
     where id = p_channel and type in ('clubs', 'referees', 'committee', 'managers')
  ),
  everyone as (
    select am.profile_id, 'league'::text as standing, 1 as rank
      from public.academy_members am join ch on am.academy_id = ch.academy_id
     where am.status = 'active' and am.roles && array['owner', 'admin']::public.academy_role[]
    union all
    select lr.profile_id, 'league', 1
      from public.league_roles lr join ch on lr.academy_id = ch.academy_id
     where ch.type in ('clubs', 'referees')
    union all
    select r.profile_id, 'league', 1
      from public.club_roles r join ch on r.academy_id = ch.academy_id
     where ch.type in ('committee', 'managers') and r.role in ('president', 'secretary')
    union all
    select am.profile_id, 'head', 2
      from ch
      join public.competition_clubs cc on cc.competition_id = ch.competition_id and cc.status = 'active'
      join public.academy_members am on am.academy_id = cc.academy_id
     where ch.type = 'clubs' and am.status = 'active' and am.roles && array['owner', 'admin']::public.academy_role[]
    union all
    select r.profile_id, 'referee', 3
      from ch join public.referees r on r.academy_id = ch.academy_id
     where ch.type = 'referees' and r.profile_id is not null and r.status = 'active'
    union all
    select r.profile_id, 'member', 3
      from public.club_roles r join ch on r.academy_id = ch.academy_id
     where ch.type = 'committee' and r.role in ('registrar', 'treasurer', 'welfare_officer', 'volunteer_coordinator')
    union all
    select r.profile_id, 'member', 3
      from public.club_roles r join ch on r.academy_id = ch.academy_id
     where ch.type = 'managers' and r.role in ('team_manager', 'coordinator')
  )
  select distinct on (e.profile_id) e.profile_id, e.standing
    from everyone e
   order by e.profile_id, e.rank;
$fn$;

create or replace function app_private.my_groups()
returns table (channel_id uuid, standing text)
language sql stable security definer set search_path = public as $fn$
  with heads as (
    select am.academy_id from public.academy_members am
     where am.profile_id = auth.uid() and am.status = 'active' and am.roles && array['owner', 'admin']::public.academy_role[]
  ),
  league_at as (
    select academy_id from heads
    union
    select lr.academy_id from public.league_roles lr where lr.profile_id = auth.uid()
  ),
  club_role_at as (
    select r.academy_id from public.club_roles r where r.profile_id = auth.uid()
  ),
  candidates as (
    select ch.id from public.channels ch
     where ch.type = 'clubs'
       and (ch.academy_id in (select academy_id from league_at)
            or ch.competition_id in (select cc.competition_id from public.competition_clubs cc
                                      where cc.status = 'active' and cc.academy_id in (select academy_id from heads)))
    union
    select ch.id from public.channels ch
     where ch.type = 'referees'
       and (ch.academy_id in (select academy_id from league_at)
            or ch.academy_id in (select r.academy_id from public.referees r
                                  where r.profile_id = auth.uid() and r.status = 'active'))
    union
    select ch.id from public.channels ch
     where ch.type in ('committee', 'managers')
       and (ch.academy_id in (select academy_id from heads) or ch.academy_id in (select academy_id from club_role_at))
  )
  select k.id, s.standing
    from candidates k
    cross join lateral (select app_private.group_standing(k.id) as standing) s
   where s.standing is not null;
$fn$;

create or replace function public.group_channel_info(p_channel uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_me       uuid := auth.uid();
  c          public.channels%rowtype;
  v_standing text;
  v_people   jsonb;
begin
  if v_me is null then
    return null;
  end if;
  select * into c from public.channels where id = p_channel and type in ('clubs', 'referees', 'committee', 'managers');
  if c.id is null then
    return null;
  end if;
  v_standing := app_private.group_standing(p_channel);
  if v_standing is null then
    return null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('profile_id', z.profile_id, 'name', z.name, 'standing', z.standing, 'club', z.club)
                            order by (z.standing <> 'league'), z.club nulls first, z.name), '[]'::jsonb)
    into v_people
    from (
      select gp.profile_id, p.full_name as name, gp.standing,
             case
               when gp.standing = 'league' then (select a.name from public.academies a where a.id = c.academy_id)
               when gp.standing = 'head' then (
                 select a.name from public.competition_clubs cc
                   join public.academy_members am on am.academy_id = cc.academy_id
                   join public.academies a on a.id = cc.academy_id
                  where cc.competition_id = c.competition_id and cc.status = 'active'
                    and am.profile_id = gp.profile_id and am.status = 'active' and am.roles && array['owner', 'admin']::public.academy_role[]
                  order by a.name limit 1)
               when gp.standing = 'member' then (
                 select string_agg(distinct replace(initcap(r.role::text), '_', ' '), ', ')
                   from public.club_roles r where r.academy_id = c.academy_id and r.profile_id = gp.profile_id)
               else null
             end as club
        from app_private.group_people(p_channel) gp
        join public.profiles p on p.id = gp.profile_id
    ) z;

  return jsonb_build_object(
    'kind', c.type,
    'standing', v_standing,
    'is_host', v_standing = 'league',
    'league', (select a.name from public.academies a where a.id = c.academy_id),
    'competition', (select k.name from public.competitions k where k.id = c.competition_id),
    'people', v_people);
end;
$fn$;

-- The coordinator over an age group or a stream hosts its channel; the
-- membership of a computed room is 0235's rule.
create or replace function app_private.is_channel_member(p_channel uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.channel_members
     where channel_id = p_channel and profile_id = auth.uid()
  ) or exists (
    select 1 from public.channels c
     where c.id = p_channel and c.type = 'notices'
       and app_private.notices_standing(c.competition_id, auth.uid()) is not null
  ) or exists (
    select 1 from public.channels c
     where c.id = p_channel and c.type in ('clubs', 'referees', 'committee', 'managers')
       and app_private.group_standing(p_channel) is not null
  );
$$;

create or replace function app_private.is_channel_host(p_channel uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.channel_members
     where channel_id = p_channel
       and profile_id = auth.uid()
       and role in ('host', 'co_host')
  ) or exists (
    select 1 from public.channels c
     where c.id = p_channel
       and c.type <> 'direct'
       and app_private.is_academy_staff(c.academy_id)
  ) or exists (
    select 1 from public.channels c
     where c.id = p_channel and c.type = 'notices'
       and app_private.notices_standing(c.competition_id, auth.uid()) = 'league'
  ) or exists (
    select 1 from public.channels c
     where c.id = p_channel and c.type in ('clubs', 'referees', 'committee', 'managers')
       and app_private.group_standing(p_channel) = 'league'
  ) or exists (
    -- The President and Secretary host every channel of the club that is
    -- not a direct message; a coordinator hosts the channels of their
    -- age group or stream.
    select 1 from public.channels c
     where c.id = p_channel and c.type <> 'direct'
       and (
         app_private.club_roles_of(c.academy_id) && array['president', 'secretary']::public.club_role[]
         or (c.type in ('age_group', 'stream') and 'coordinator' = any (app_private.club_roles_of(c.academy_id))
             and exists (select 1 from public.club_roles r
                          where r.academy_id = c.academy_id and r.profile_id = auth.uid() and r.role = 'coordinator'
                            and ((r.scope_kind = 'age_group' and r.age_group = c.age_group)
                                 or (r.scope_kind = 'stream' and r.stream_id = c.stream_id))))
       )
  );
$$;

-- Nobody is added to a computed room by hand; a computed room and a stream's
-- channel keep their kind and their owner (0213's guards, widened again).
create or replace function app_private.refuse_notices_members()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.channels c where c.id = new.channel_id and c.type in ('notices', 'clubs', 'referees', 'committee', 'managers')) then
    raise exception 'nobody is added to this channel by hand: who is in it follows the club''s roles'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function app_private.guard_notices_channel()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.type in ('notices', 'clubs', 'referees', 'committee', 'managers', 'stream') or new.type in ('notices', 'clubs', 'referees', 'committee', 'managers', 'stream') then
    if new.type is distinct from old.type
       or new.competition_id is distinct from old.competition_id
       or new.academy_id is distinct from old.academy_id
       or new.stream_id is distinct from old.stream_id then
      raise exception 'a competition''s or a club''s computed channels stay what they are' using errcode = '42501';
    end if;
    if new.type = 'notices' and new.posting_mode is distinct from 'hosts_only' then
      raise exception 'only the league posts in a competition''s Notices' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop policy if exists channels_insert on public.channels;
create policy channels_insert on public.channels for insert to authenticated
  with check ((select app_private.is_academy_coach(academy_id)) and type not in ('notices', 'clubs', 'referees', 'committee', 'managers', 'stream'));
drop policy if exists channels_delete on public.channels;
create policy channels_delete on public.channels for delete to authenticated
  using (type not in ('direct', 'notices', 'clubs', 'referees', 'committee', 'managers', 'stream') and (select app_private.is_academy_staff(academy_id)));

-- ============================================================ club mode

-- Club mode on: Club Notices (the club-wide channel, hosts only), the
-- age-group channels hosts only, the Committee and Team managers' rooms.
create or replace function app_private.apply_club_mode_channels(p_academy uuid)
returns void
language plpgsql security definer set search_path = public as $fn$
declare v_wide uuid;
begin
  v_wide := public.ensure_system_channel(p_academy, 'academy_wide');
  update public.channels set posting_mode = 'hosts_only', name = case when name = 'Announcements' then 'Club Notices' else name end
   where id = v_wide;
  update public.channels set posting_mode = 'hosts_only'
   where academy_id = p_academy and type = 'age_group' and posting_mode = 'open';
  perform app_private.ensure_committee_channel(p_academy);
  perform app_private.ensure_managers_channel(p_academy);
end;
$fn$;

create or replace function public.enable_club_mode(p_academy uuid)
returns boolean
language plpgsql volatile security definer set search_path = public as $fn$
begin
  if not (app_private.academy_role_of(p_academy) = 'owner' or app_private.has_club_role(p_academy, 'president')) then
    raise exception 'only an owner switches club mode on' using errcode = '42501';
  end if;
  update public.academies set club_mode = true where id = p_academy;
  insert into public.streams (academy_id, name, sort_order)
  select p_academy, s.name, s.n
    from (values ('MiniRoos', 1), ('Juniors', 2), ('Girls', 3), ('Women', 4), ('NPL', 5), ('Community', 6), ('Seniors', 7), ('Over-35s', 8)) s (name, n)
   where not exists (select 1 from public.streams x where x.academy_id = p_academy)
  on conflict do nothing;
  perform app_private.apply_club_mode_channels(p_academy);
  perform app_private.log_activity(p_academy, 'club_mode.on', 'club', p_academy, null, '{}'::jsonb);
  return true;
end;
$fn$;

create or replace function app_private.on_academy_club_mode()
returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if new.type = 'club' then
    update public.academies set club_mode = true where id = new.id and not club_mode;
    insert into public.streams (academy_id, name, sort_order)
    select new.id, s.name, s.n
      from (values ('MiniRoos', 1), ('Juniors', 2), ('Girls', 3), ('Women', 4), ('NPL', 5), ('Community', 6), ('Seniors', 7), ('Over-35s', 8)) s (name, n)
    on conflict do nothing;
    perform app_private.apply_club_mode_channels(new.id);
  end if;
  return new;
end;
$fn$;

-- Clubs already in club mode (0236 switched every new club on): their layers now.
select app_private.apply_club_mode_channels(a.id) from public.academies a where a.club_mode;

-- ================================================================= grants

revoke execute on function app_private.ensure_stream_channel(uuid) from public, anon, authenticated;
revoke execute on function app_private.on_stream_channel() from public, anon, authenticated;
revoke execute on function app_private.join_stream_channel(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function app_private.leave_stream_channel_if_last(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function app_private.on_team_stream_changed() from public, anon, authenticated;
revoke execute on function app_private.ensure_committee_channel(uuid) from public, anon, authenticated;
revoke execute on function app_private.ensure_managers_channel(uuid) from public, anon, authenticated;
revoke execute on function app_private.committee_standing(uuid, uuid) from public, anon, authenticated;
revoke execute on function app_private.managers_standing(uuid, uuid) from public, anon, authenticated;
revoke execute on function app_private.apply_club_mode_channels(uuid) from public, anon, authenticated;
