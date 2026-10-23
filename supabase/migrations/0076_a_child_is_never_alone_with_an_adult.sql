-- 0076_a_child_is_never_alone_with_an_adult.sql
--
-- A coach could open a private chat with a child.
--
-- open_direct_channel enforced dm_policy, but staff_only means "at least one
-- end is staff", so a coach and a player account passed it. create_channel
-- had the same hole: a custom chat of one coach and one child is a DM with a
-- name. Nothing had used the player role yet, which is the only reason this
-- had not happened.
--
-- The rule is Sport Integrity Australia's: an adult must not communicate
-- one-to-one with a child unless a parent/carer or club representative is
-- included. So the fix is not "refuse" - a coach does need to talk to a
-- player about Saturday - it is "never without their parents".
--
-- 1. WHEREVER A CHILD JOINS A PRIVATE CHAT, THEIR GUARDIANS JOIN TOO.
--    It is a trigger on channel_members, not a check in open_direct_channel,
--    because there are three ways in (open_direct_channel, create_channel,
--    a host adding a member) and a fourth will be written by someone who has
--    not read this file. Team, age-group and academy-wide channels are
--    exempt: they already carry the parents, by the roster.
--
-- 2. A CHILD WITH NO GUARDIAN ON FILE CANNOT BE ADDED AT ALL. The message
--    says what to do instead. Silently creating the one-to-one chat would be
--    the exact failure this exists to prevent.
--
-- 3. WHEN THE LAST GUARDIAN LEAVES, THE CHILD LEAVES WITH THEM. This is
--    deliberately not a refusal to let the parent leave: a refusal would also
--    block deleting a parent's account, and would fire during cascades.
--
-- 4. WHO COUNTS AS A CHILD: a linked player under 18, a linked player with
--    no date of birth (unknown is treated as a child), or anyone with the
--    player role unless a linked record proves they are 18 or over.

create or replace function app_private.is_minor_profile(p_academy uuid, p_profile uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select
    exists (
      select 1 from public.players pl
       where pl.academy_id = p_academy
         and pl.profile_id = p_profile
         and (pl.dob is null or pl.dob > current_date - interval '18 years')
    )
    or (
      exists (
        select 1 from public.academy_members am
         where am.academy_id = p_academy
           and am.profile_id = p_profile
           and am.role = 'player'
      )
      and not exists (
        select 1 from public.players pl
         where pl.academy_id = p_academy
           and pl.profile_id = p_profile
           and pl.dob is not null
           and pl.dob <= current_date - interval '18 years'
      )
    );
$$;

create or replace function app_private.guardians_of(p_academy uuid, p_profile uuid)
returns setof uuid
language sql stable security definer set search_path = public as $$
  select distinct pg.profile_id
    from public.players pl
    join public.player_guardians pg
      on pg.player_id = pl.id and pg.academy_id = pl.academy_id
    join public.academy_members am
      on am.academy_id = pl.academy_id and am.profile_id = pg.profile_id
     and am.status = 'active'
   where pl.academy_id = p_academy
     and pl.profile_id = p_profile
     and pg.profile_id <> p_profile;
$$;

revoke all on function app_private.is_minor_profile(uuid, uuid) from public;
revoke all on function app_private.guardians_of(uuid, uuid) from public;

-- ---------------------------------------------------------------------------
-- 1 + 2. A child joins a private chat -> their guardians join it too
-- ---------------------------------------------------------------------------
create or replace function public.on_channel_member_minor_added()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_type      public.channel_type;
  v_guardians uuid[];
  v_name      text;
begin
  select type into v_type from public.channels where id = new.channel_id;
  if v_type is null or v_type::text not in ('direct', 'custom') then
    return new;
  end if;

  if not app_private.is_minor_profile(new.academy_id, new.profile_id) then
    return new;
  end if;

  select array_agg(g) into v_guardians
    from app_private.guardians_of(new.academy_id, new.profile_id) as g;

  select coalesce(nullif(btrim(p.full_name), ''), pl.full_name, 'This player')
    into v_name
    from public.profiles p
    left join public.players pl
      on pl.profile_id = p.id and pl.academy_id = new.academy_id
   where p.id = new.profile_id
   limit 1;

  if v_guardians is null then
    raise exception '% has no parent or guardian in Squadroom, so they can''t be added to a private chat. Message them in the team channel instead, or add a guardian first.', v_name
      using errcode = '42501';
  end if;

  insert into public.channel_members (academy_id, channel_id, profile_id, role)
  select new.academy_id, new.channel_id, g, 'member'
    from unnest(v_guardians) as g
  on conflict (channel_id, profile_id) do nothing;

  -- A DM is named after "the other person", which in a three-way chat would
  -- be whichever member the list happened to find first. Name it for the
  -- child instead, so everyone in it can tell what it is.
  if v_type::text = 'direct' then
    update public.channels
       set name = coalesce(name, v_name || ' + parents')
     where id = new.channel_id;
  end if;

  return new;
end;
$$;

revoke all on function public.on_channel_member_minor_added() from public, anon, authenticated;

drop trigger if exists channel_members_minor_brings_guardians on public.channel_members;
create trigger channel_members_minor_brings_guardians
  after insert on public.channel_members
  for each row execute function public.on_channel_member_minor_added();

-- ---------------------------------------------------------------------------
-- 3. The last guardian leaves -> the child leaves with them
-- ---------------------------------------------------------------------------
create or replace function public.on_channel_member_guardian_removed()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_type public.channel_type;
begin
  -- During a cascade the channel is already gone. Nothing to protect.
  select type into v_type from public.channels where id = old.channel_id;
  if v_type is null or v_type::text not in ('direct', 'custom') then
    return old;
  end if;

  delete from public.channel_members cm
   where cm.channel_id = old.channel_id
     and cm.profile_id <> old.profile_id
     and app_private.is_minor_profile(cm.academy_id, cm.profile_id)
     and not exists (
       select 1 from public.channel_members g
        where g.channel_id = cm.channel_id
          and g.profile_id in (select app_private.guardians_of(cm.academy_id, cm.profile_id))
     );

  return old;
end;
$$;

revoke all on function public.on_channel_member_guardian_removed() from public, anon, authenticated;

drop trigger if exists channel_members_guardian_leaves on public.channel_members;
create trigger channel_members_guardian_leaves
  after delete on public.channel_members
  for each row execute function public.on_channel_member_guardian_removed();

-- ---------------------------------------------------------------------------
-- Backfill: any child already in a private chat gets their guardians added.
-- (None exist at the time of writing - no player has an account yet - but a
-- migration that is only correct on today's data is a migration that waits.)
-- ---------------------------------------------------------------------------
insert into public.channel_members (academy_id, channel_id, profile_id, role)
select cm.academy_id, cm.channel_id, g, 'member'
  from public.channel_members cm
  join public.channels c on c.id = cm.channel_id
  cross join lateral app_private.guardians_of(cm.academy_id, cm.profile_id) as g
 where c.type::text in ('direct', 'custom')
   and app_private.is_minor_profile(cm.academy_id, cm.profile_id)
on conflict (channel_id, profile_id) do nothing;
