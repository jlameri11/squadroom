-- 0015_harden_function_exposure.sql
-- Hardening pass, driven by Supabase's own database linter.
--
-- Postgres grants EXECUTE on new functions to PUBLIC by default, and Supabase
-- publishes every public-schema function as a REST endpoint. So all 38 RLS
-- helpers were callable by anyone as /rest/v1/rpc/<name> — including by the
-- anon role, before login. message_channel(uuid) would hand back the channel
-- behind any message id; is_academy_member(uuid) would confirm a tenant exists.
--
-- Verified on dev before writing this: revoking EXECUTE does NOT break the
-- policies. Postgres evaluates an RLS policy expression without checking the
-- calling role's EXECUTE privilege on functions inside it. So the helpers can
-- be made completely unreachable from the API while every policy keeps working.

-- ---------------------------------------------------------------------------
-- 1. Close the RPC surface
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Re-open only the deliberate API
-- ---------------------------------------------------------------------------
grant execute on function public.member_directory(uuid) to authenticated;
grant execute on function public.get_reaction_voters(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Replace the two count views with functions
--
-- The views had to run with owner rights (a member must see the whole tally,
-- not just their own row), which the linter flags as SECURITY DEFINER VIEW —
-- correctly, since that pattern is easy to get wrong. Functions make the
-- privilege boundary explicit and let the membership check sit in one obvious
-- place. They also take a batch of ids, so rendering a page of messages is one
-- round trip rather than fifty.
-- ---------------------------------------------------------------------------
drop view if exists public.message_reaction_counts;
drop view if exists public.poll_vote_counts;

create or replace function public.reaction_counts(p_message_ids uuid[])
returns table (message_id uuid, emoji text, reaction_count integer, reacted_by_me boolean)
language sql stable security definer set search_path = public as $$
  select r.message_id,
         r.emoji,
         count(*)::integer,
         bool_or(r.profile_id = auth.uid())
    from public.message_reactions r
   where r.message_id = any (p_message_ids)
     and public.is_channel_member(public.message_channel(r.message_id))
   group by r.message_id, r.emoji;
$$;

create or replace function public.poll_counts(p_poll uuid)
returns table (option_id text, votes integer)
language sql stable security definer set search_path = public as $$
  select o.option_id, count(*)::integer
    from public.poll_votes v
    cross join lateral unnest(v.option_ids) as o(option_id)
   where v.poll_id = p_poll
     and public.is_channel_member(public.poll_channel(p_poll))
   group by o.option_id;
$$;

grant execute on function public.reaction_counts(uuid[]) to authenticated;
grant execute on function public.poll_counts(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Pin the search_path on the two functions that were missing it
-- ---------------------------------------------------------------------------
alter function public.set_updated_at() set search_path = public;
alter function public.normalise_phone(text) set search_path = public;
