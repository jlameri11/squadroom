-- 0240: a team has a category, a gender and a label of the club's own.
--
-- Joey, 10 Nov 2026, Part A fix 3: "replace U5–U18-only age_group with
-- Junior (U5–U18), Open/Seniors, Over-35, Over-45, Over-55, plus a separate
-- gender field (Boys / Girls / Mixed / Men / Women). Clubs can add their own
-- label (e.g. 'Women's Premier League'). Existing teams keep their values."
--
-- `teams.age_group` already takes the adult groups since 0236 (U5–U99, Open,
-- Over-NN); the CATEGORY is read from it — junior (U5–U18), youth (U19–U23),
-- open, over — so the screens can offer Joey's list and the rules to come
-- (MiniRoos, adult chat rules) can ask one question. Gender is its own
-- field with the brief's five words; 0236's `gender` (a player's
-- female/male/other) goes, unused. A club's own label sits beside the name.
-- Every existing team keeps its age group, name and season untouched.

do $$ begin
  create type public.team_gender as enum ('boys', 'girls', 'mixed', 'men', 'women');
exception when duplicate_object then null; end $$;

-- 0236 added `gender player_gender`; nothing has written it. Replaced. The
-- team logger's trigger names the column, so it goes first and is made
-- again below.
drop trigger if exists teams_log on public.teams;
alter table public.teams drop column if exists gender;
alter table public.teams add column if not exists gender public.team_gender;
alter table public.teams add column if not exists label text
  check (label is null or length(btrim(label)) between 1 and 60);

-- The category an age group falls in.
create or replace function app_private.age_category(p_age_group text)
returns text
language sql immutable as $fn$
  select case
    when p_age_group ~ '^U([5-9]|1[0-8])$' then 'junior'
    when p_age_group ~ '^U(19|2[0-9])$' then 'youth'
    when p_age_group = 'Open' then 'open'
    when p_age_group ~ '^Over-\d{2}$' then 'over'
  end;
$fn$;
grant execute on function app_private.age_category(text) to authenticated;

-- An adult age group's chat reads naturally: "Open Age Group", "Over-35s
-- Age Group" (the junior "U9s Age Group" is as it was).
create or replace function public.ensure_system_channel(
  p_academy   uuid,
  p_type      public.channel_type,
  p_age_group text default null,
  p_name      text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select id into v_id
    from public.channels
   where academy_id = p_academy
     and type = p_type
     and (p_type <> 'age_group' or age_group is not distinct from p_age_group);

  if v_id is not null then
    return v_id;
  end if;

  insert into public.channels (academy_id, type, age_group, name)
  values (p_academy, p_type, p_age_group,
          coalesce(p_name,
            case p_type
              when 'coaches'      then 'Coaches'
              when 'academy_wide' then 'Announcements'
              when 'age_group'    then case when p_age_group = 'Open' then 'Open Age Group' else p_age_group || 's Age Group' end
              else 'Channel'
            end))
  returning id into v_id;

  return v_id;
end;
$$;

-- The team logger (0236) follows the new columns.
create or replace function app_private.log_team_change()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if tg_op = 'INSERT' then
    perform app_private.log_activity(new.academy_id, 'team.created', 'team', new.id, new.name, jsonb_build_object('age_group', new.age_group, 'season', new.season, 'gender', new.gender, 'label', new.label));
  elsif tg_op = 'DELETE' then
    perform app_private.log_activity(old.academy_id, 'team.deleted', 'team', old.id, old.name, '{}'::jsonb);
  elsif new.status is distinct from old.status then
    perform app_private.log_activity(new.academy_id, 'team.' || new.status::text, 'team', new.id, new.name, '{}'::jsonb);
  else
    perform app_private.log_activity(new.academy_id, 'team.changed', 'team', new.id, new.name,
      jsonb_strip_nulls(jsonb_build_object(
        'name', case when new.name is distinct from old.name then jsonb_build_object('from', old.name, 'to', new.name) end,
        'age_group', case when new.age_group is distinct from old.age_group then jsonb_build_object('from', old.age_group, 'to', new.age_group) end,
        'stream_id', case when new.stream_id is distinct from old.stream_id then jsonb_build_object('from', old.stream_id, 'to', new.stream_id) end,
        'gender', case when new.gender is distinct from old.gender then jsonb_build_object('from', old.gender, 'to', new.gender) end,
        'label', case when new.label is distinct from old.label then jsonb_build_object('from', old.label, 'to', new.label) end,
        'home_venue_id', case when new.home_venue_id is distinct from old.home_venue_id then jsonb_build_object('from', old.home_venue_id, 'to', new.home_venue_id) end)));
  end if;
  return null;
end;
$fn$;
drop trigger if exists teams_log on public.teams;
create trigger teams_log
  after insert or update of name, age_group, stream_id, gender, label, home_venue_id, status or delete on public.teams
  for each row execute function app_private.log_team_change();
