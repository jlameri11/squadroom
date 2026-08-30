-- 0017_lock_public_schema.sql
-- Repoint the four public API functions at app_private, drop the now-unused
-- helper copies from `public`, and close EXECUTE on everything else.
--
-- Both loops skip extension-owned functions. citext and pg_trgm install into
-- `public`, and a naive sweep tries to drop regexp_split_to_table(citext,...)
-- out from under the extension - or, worse, silently revokes EXECUTE on the
-- operators the app depends on.
-- ---------------------------------------------------------------------------
-- 4. Repoint the public API functions, then remove the public helpers
-- ---------------------------------------------------------------------------
create or replace function public.member_directory(p_academy uuid)
returns table (
  profile_id uuid, full_name text, avatar_url text,
  role public.academy_role, phone text, teams text[]
)
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_can_see boolean;
begin
  if not app_private.is_academy_member(p_academy) then
    raise exception 'not a member of this academy' using errcode = '42501';
  end if;

  v_can_see := app_private.can_see_contact_details(p_academy);

  return query
    select p.id, p.full_name, p.avatar_url, am.role,
      case when v_can_see or am.role in ('owner','admin','coach')
           then p.phone::text else null end,
      coalesce(array_agg(t.name order by t.name) filter (where t.id is not null), '{}')
    from public.academy_members am
    join public.profiles p on p.id = am.profile_id
    left join public.team_members tm on tm.profile_id = p.id and tm.academy_id = p_academy
    left join public.teams t on t.id = tm.team_id and t.status = 'active'
   where am.academy_id = p_academy and am.status = 'active'
   group by p.id, p.full_name, p.avatar_url, am.role, p.phone;
end;
$fn$;

create or replace function public.get_reaction_voters(p_message uuid, p_emoji text)
returns table (profile_id uuid, full_name text, avatar_url text)
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_channel uuid;
begin
  select m.channel_id into v_channel from public.messages m where m.id = p_message;
  if v_channel is null or not app_private.is_channel_host(v_channel) then
    raise exception 'not authorised to see who reacted' using errcode = '42501';
  end if;
  return query
    select p.id, p.full_name, p.avatar_url
      from public.message_reactions r
      join public.profiles p on p.id = r.profile_id
     where r.message_id = p_message and r.emoji = p_emoji
     order by r.created_at;
end;
$fn$;

create or replace function public.reaction_counts(p_message_ids uuid[])
returns table (message_id uuid, emoji text, reaction_count integer, reacted_by_me boolean)
language sql stable security definer set search_path = public as $fn$
  select r.message_id, r.emoji, count(*)::integer,
         bool_or(r.profile_id = auth.uid())
    from public.message_reactions r
   where r.message_id = any (p_message_ids)
     and app_private.is_channel_member(app_private.message_channel(r.message_id))
   group by r.message_id, r.emoji;
$fn$;

create or replace function public.poll_counts(p_poll uuid)
returns table (option_id text, votes integer)
language sql stable security definer set search_path = public as $fn$
  select o.option_id, count(*)::integer
    from public.poll_votes v
    cross join lateral unnest(v.option_ids) as o(option_id)
   where v.poll_id = p_poll
     and app_private.is_channel_member(app_private.poll_channel(p_poll))
   group by o.option_id;
$fn$;

-- The old copies in `public` are now unreferenced.
do $cleanup$
declare
  r record;
  keep text[] := array['member_directory','get_reaction_voters','reaction_counts','poll_counts',
                       'set_updated_at','normalise_phone','handle_new_user','handle_user_phone_change',
                       'ensure_system_channel','add_to_channel','on_academy_created','on_team_created',
                       'on_team_member_added','on_team_member_removed','on_academy_member_added',
                       'on_academy_member_removed','on_team_ended','touch_channel_on_message',
                       'on_profile_created','archive_deleted_message','purge_expired_message_archive'];
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f' and not (p.proname = any (keep))
       and not exists (select 1 from pg_depend dep
                        where dep.objid = p.oid and dep.deptype = 'e')
  loop
    execute format('drop function if exists %s', r.sig);
  end loop;
end;
$cleanup$;

-- ---------------------------------------------------------------------------
-- 5. Lock down what is left in public
-- ---------------------------------------------------------------------------
do $grants$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
       and not exists (select 1 from pg_depend dep
                        where dep.objid = p.oid and dep.deptype = 'e')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;

  for r in select p.oid::regprocedure as sig from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app_private' and p.prokind = 'f'
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end;
$grants$;

grant execute on function public.member_directory(uuid) to authenticated;
grant execute on function public.get_reaction_voters(uuid, text) to authenticated;
grant execute on function public.reaction_counts(uuid[]) to authenticated;
grant execute on function public.poll_counts(uuid) to authenticated;
