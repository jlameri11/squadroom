-- 0026_create_academy_and_invite_tree.sql
--
-- Two things Phase 1 needs that plain RLS cannot express.

-- ---------------------------------------------------------------------------
-- 1. Creating an organisation
--
-- A chicken and egg: academy_members_insert requires is_academy_staff of the
-- academy, and the founder is not staff of an academy that does not exist
-- yet. Rather than loosening that policy - which would let anyone add
-- themselves to any academy - creation is one atomic function.
-- ---------------------------------------------------------------------------
create or replace function public.create_academy(
  p_name     text,
  p_type     public.org_type default 'academy',
  p_timezone text default 'Australia/Sydney',
  p_colour   text default '#202842'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_base    text;
  v_slug    text;
  v_n       integer := 0;
  v_academy uuid;
begin
  if v_uid is null then
    raise exception 'must be signed in' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_name, ''))) = 0 then
    raise exception 'name is required' using errcode = '22023';
  end if;

  v_base := btrim(regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g'), '-');
  v_base := left(coalesce(nullif(v_base, ''), 'academy'), 40);
  if length(v_base) < 3 then
    v_base := v_base || '-club';
  end if;

  v_slug := v_base;
  while exists (select 1 from public.academies where slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;

  insert into public.academies (name, slug, type, timezone, primary_colour, created_by)
  values (btrim(p_name), v_slug, p_type, p_timezone, p_colour, v_uid)
  returning id into v_academy;

  -- invited_by is null: this person was not brought in by anyone, they
  -- founded it. That is the root of the invite tree.
  insert into public.academy_members (academy_id, profile_id, role, status, invited_by)
  values (v_academy, v_uid, 'owner', 'active', null);

  return v_academy;
end;
$$;

revoke execute on function public.create_academy(text, public.org_type, text, text) from public, anon;
grant execute on function public.create_academy(text, public.org_type, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The invite tree
--
-- academy_members.invited_by records who brought whom. Walking it answers
-- "who let this person in", and lets an owner remove a coach along with
-- everyone that coach brought - which is the point of recording it.
-- ---------------------------------------------------------------------------
create or replace function public.academy_invite_tree(p_academy uuid)
returns table (
  profile_id uuid,
  full_name  text,
  role       public.academy_role,
  status     public.member_status,
  invited_by uuid,
  inviter_name text,
  depth      integer,
  path       uuid[]
)
language sql stable security definer set search_path = public as $$
  with recursive tree as (
    select am.profile_id, am.invited_by, 0 as depth, array[am.profile_id] as path
      from public.academy_members am
     where am.academy_id = p_academy and am.invited_by is null
    union all
    select am.profile_id, am.invited_by, t.depth + 1, t.path || am.profile_id
      from public.academy_members am
      join tree t on t.profile_id = am.invited_by
     where am.academy_id = p_academy
       -- Stops a cycle from a bad data fix looping forever.
       and not am.profile_id = any (t.path)
  )
  select t.profile_id, p.full_name, am.role, am.status, t.invited_by,
         ip.full_name, t.depth, t.path
    from tree t
    join public.academy_members am on am.academy_id = p_academy and am.profile_id = t.profile_id
    join public.profiles p on p.id = t.profile_id
    left join public.profiles ip on ip.id = t.invited_by
   where app_private.is_academy_staff(p_academy)
   order by t.path;
$$;

grant execute on function public.academy_invite_tree(uuid) to authenticated;

-- Remove someone and everyone below them. The status change fires the
-- existing trigger that strips channel membership, so a revoked coach's
-- parents lose access to every channel in the same transaction.
create or replace function public.revoke_member_tree(p_academy uuid, p_profile uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_target public.academy_role;
  v_actor  public.academy_role;
  v_count  integer;
begin
  if not app_private.is_academy_staff(p_academy) then
    raise exception 'only owners and admins can remove members' using errcode = '42501';
  end if;
  if p_profile = v_uid then
    raise exception 'you cannot remove yourself' using errcode = '22023';
  end if;

  select role into v_target from public.academy_members
   where academy_id = p_academy and profile_id = p_profile;
  select role into v_actor from public.academy_members
   where academy_id = p_academy and profile_id = v_uid;

  if v_target is null then
    raise exception 'not a member of this academy' using errcode = '22023';
  end if;
  -- An admin cannot remove an owner. Otherwise an admin could take the club.
  if v_target = 'owner' and v_actor <> 'owner' then
    raise exception 'only an owner can remove an owner' using errcode = '42501';
  end if;
  -- Never leave an academy with nobody in charge.
  if v_target = 'owner' and (
       select count(*) from public.academy_members
        where academy_id = p_academy and role = 'owner' and status = 'active') <= 1 then
    raise exception 'this is the last owner' using errcode = '22023';
  end if;

  with recursive tree as (
    select profile_id from public.academy_members
     where academy_id = p_academy and profile_id = p_profile
    union
    select am.profile_id from public.academy_members am
      join tree t on am.invited_by = t.profile_id
     where am.academy_id = p_academy
  )
  update public.academy_members am
     set status = 'removed', removed_at = now()
    from tree
   where am.academy_id = p_academy
     and am.profile_id = tree.profile_id
     and am.status <> 'removed';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.revoke_member_tree(uuid, uuid) from public, anon;
grant execute on function public.revoke_member_tree(uuid, uuid) to authenticated;
