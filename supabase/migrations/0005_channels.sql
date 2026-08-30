-- 0005_channels.sql
-- Channels, their membership, and the cascade that keeps them in step with
-- teams. Creating a team creates its channel; joining a team joins you to it;
-- leaving removes you; ending a season archives it rather than deleting it.

create table public.channels (
  id           uuid primary key default gen_random_uuid(),
  academy_id   uuid not null references public.academies(id) on delete cascade,
  type         public.channel_type not null,
  team_id      uuid,
  age_group    text check (age_group is null or age_group ~ '^U([5-9]|1[0-8])$'),
  name         text,
  description  text,
  icon_url     text,

  posting_mode public.posting_mode not null default 'open',
  -- Recognised keys: no_images, no_links, no_forwarding, approval_required.
  -- Anything else is ignored by the app; kept loose on purpose.
  restrictions jsonb not null default '{}'::jsonb
                 check (jsonb_typeof(restrictions) = 'object'),

  status       public.channel_status not null default 'active',
  -- Direct channels only: the two profile ids sorted and joined, so a pair
  -- can never end up with two conversations.
  dm_key       text,

  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  archived_at  timestamptz,

  constraint channels_id_academy_key unique (id, academy_id),
  constraint channels_team_fkey foreign key (team_id, academy_id)
    references public.teams (id, academy_id) on delete cascade,

  constraint channels_team_needs_team    check (type <> 'team'      or team_id is not null),
  constraint channels_age_needs_group    check (type <> 'age_group' or age_group is not null),
  constraint channels_direct_needs_key   check (type <> 'direct'    or dm_key is not null),
  constraint channels_named_unless_direct check (type = 'direct' or length(btrim(coalesce(name, ''))) > 0)
);
alter table public.channels enable row level security;

create trigger channels_set_updated_at
  before update on public.channels
  for each row execute function public.set_updated_at();

-- One of each system channel per academy; one conversation per DM pair.
create unique index channels_one_age_group  on public.channels (academy_id, age_group) where type = 'age_group';
create unique index channels_one_coaches    on public.channels (academy_id)            where type = 'coaches';
create unique index channels_one_wide       on public.channels (academy_id)            where type = 'academy_wide';
create unique index channels_one_dm         on public.channels (academy_id, dm_key)    where type = 'direct';

-- ---------------------------------------------------------------------------
-- channel_members — membership plus the host bit. Hosts rename the channel,
-- pin, set posting mode, and add or remove people.
-- ---------------------------------------------------------------------------
create table public.channel_members (
  id           uuid primary key default gen_random_uuid(),
  academy_id   uuid not null references public.academies(id) on delete cascade,
  channel_id   uuid not null,
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  role         public.channel_member_role not null default 'member',
  muted        boolean not null default false,
  last_read_at timestamptz not null default now(),
  joined_at    timestamptz not null default now(),

  constraint channel_members_unique unique (channel_id, profile_id),
  constraint channel_members_id_academy_key unique (id, academy_id),
  constraint channel_members_channel_fkey foreign key (channel_id, academy_id)
    references public.channels (id, academy_id) on delete cascade
);
alter table public.channel_members enable row level security;

-- ===========================================================================
-- Cascade
-- ===========================================================================

-- Find or create one of the per-academy system channels.
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
              when 'age_group'    then p_age_group || 's Age Group'
              else 'Channel'
            end))
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.add_to_channel(
  p_channel uuid,
  p_profile uuid,
  p_role    public.channel_member_role default 'member'
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.channel_members (academy_id, channel_id, profile_id, role)
  select c.academy_id, c.id, p_profile, p_role
    from public.channels c
   where c.id = p_channel
  on conflict (channel_id, profile_id) do update
    -- Never demote an existing host by re-adding them as a member.
    set role = case when public.channel_members.role = 'member'
                    then excluded.role
                    else public.channel_members.role end;
end;
$$;

-- A new academy gets its announcements and coaches channels immediately.
create or replace function public.on_academy_created()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.ensure_system_channel(new.id, 'academy_wide');
  perform public.ensure_system_channel(new.id, 'coaches');
  return new;
end;
$$;

create trigger academies_bootstrap_channels
  after insert on public.academies
  for each row execute function public.on_academy_created();

-- A new team gets its own channel, and its age-group channel is ensured.
create or replace function public.on_team_created()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.channels (academy_id, type, team_id, age_group, name, created_by)
  values (new.academy_id, 'team', new.id, new.age_group, new.name, new.created_by);

  perform public.ensure_system_channel(new.academy_id, 'age_group', new.age_group);
  return new;
end;
$$;

create trigger teams_bootstrap_channel
  after insert on public.teams
  for each row execute function public.on_team_created();

-- Joining a team joins you to its channels and its age-group channel.
-- Coaches join as host, and also land in the academy's coaches channel.
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

  if new.role = 'coach' then
    perform public.add_to_channel(
      public.ensure_system_channel(new.academy_id, 'coaches'), new.profile_id);
  end if;

  return new;
end;
$$;

create trigger team_members_join_channels
  after insert on public.team_members
  for each row execute function public.on_team_member_added();

-- Leaving a team removes you from its channels, and from the age-group
-- channel if you have no other team in that age group.
create or replace function public.on_team_member_removed()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_age_group text;
  v_still_in  integer;
begin
  select age_group into v_age_group from public.teams where id = old.team_id;

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

  return old;
end;
$$;

create trigger team_members_leave_channels
  after delete on public.team_members
  for each row execute function public.on_team_member_removed();

-- Staff land in the academy-wide and coaches channels on joining.
create or replace function public.on_academy_member_added()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status <> 'active' then
    return new;
  end if;

  perform public.add_to_channel(
    public.ensure_system_channel(new.academy_id, 'academy_wide'),
    new.profile_id,
    case when new.role in ('owner', 'admin') then 'host'::public.channel_member_role
         else 'member'::public.channel_member_role end);

  if new.role in ('owner', 'admin', 'coach') then
    perform public.add_to_channel(
      public.ensure_system_channel(new.academy_id, 'coaches'), new.profile_id);
  end if;

  return new;
end;
$$;

create trigger academy_members_join_channels
  after insert on public.academy_members
  for each row execute function public.on_academy_member_added();

-- Removing someone from the academy removes them from all of its channels.
create or replace function public.on_academy_member_removed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'removed' and old.status <> 'removed' then
    delete from public.channel_members
     where academy_id = new.academy_id
       and profile_id = new.profile_id;
  end if;
  return new;
end;
$$;

create trigger academy_members_leave_channels
  after update of status on public.academy_members
  for each row execute function public.on_academy_member_removed();

-- Season archive: ending a team makes its channels read-only, never deleted.
create or replace function public.on_team_ended()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'ended' and old.status <> 'ended' then
    update public.channels
       set status = 'archived', archived_at = now()
     where team_id = new.id and status = 'active';
  elsif new.status = 'active' and old.status = 'ended' then
    update public.channels
       set status = 'active', archived_at = null
     where team_id = new.id and status = 'archived';
  end if;
  return new;
end;
$$;

create trigger teams_archive_channels
  after update of status on public.teams
  for each row execute function public.on_team_ended();
