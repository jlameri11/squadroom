-- 0185: the front door is the only door.
--
-- Joey's security sweep (2 Nov 2026). The catalog said 166 of the 295
-- functions in `public` were executable by anon — most of them security
-- definer. Each one checks auth.uid() in its body, so a stranger was being
-- refused by the function rather than by the grant; but a grant is a wall and
-- a body check is a guard who might be asleep. 0132 closed the DEFAULT for
-- new functions, and `create or replace` keeps the old ACL, so every function
-- that predates it or was regenerated kept its anon grant.
--
-- This revokes EXECUTE from anon (and from PUBLIC) on every non-extension
-- function in `public`, then grants it back to exactly the ones a person
-- with no account is meant to call:
--
--   public_academy             a club's front door, /{slug}
--   public_programs            the programs on it
--   public_match_centre        the public draw, /c/{slug}
--   public_competition_entry   the team-entry form on it
--   peek_competition_invite    what a competition invite link is for, before
--                              signing in
--
-- Join, register and team-entry WRITES already go through service-role routes
-- (request_competition_entry, check_registration and friends have no client
-- grant at all), so nothing a stranger can do changes except the error they
-- get: "permission denied" at the door instead of a refusal from inside.
--
-- Two internal helpers lose their authenticated grant as well:
-- `resolve_source` and `generate_fixtures` are only ever called by other
-- functions (resolve_finals, the draw builder) which check the organiser
-- themselves. test-rls 92 keeps the allow-list honest from now on.

do $$
declare
  r record;
begin
  for r in
    select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function public.%I(%s) from public, anon', r.proname, r.args);
  end loop;
end $$;

grant execute on function public.public_academy(text) to anon;
grant execute on function public.public_programs(text) to anon;
grant execute on function public.public_match_centre(text) to anon;
grant execute on function public.public_competition_entry(text) to anon;
grant execute on function public.peek_competition_invite(text) to anon;

revoke execute on function public.resolve_source(uuid, text, text) from authenticated;
revoke execute on function public.generate_fixtures(uuid, text, timestamptz, integer, integer, text[], text, boolean, integer) from authenticated;

-- Close the default for anything supabase_admin creates too (extensions,
-- dashboard). Harmless if it already is.
alter default privileges for role postgres in schema public revoke execute on functions from public, anon;

-- The allow-list, kept in the database so test-rls can read it rather than
-- repeat it.
create table if not exists app_private.anon_callable (
  proname text primary key,
  why     text not null
);
insert into app_private.anon_callable (proname, why) values
  ('public_academy', 'a club''s front door, /{slug}'),
  ('public_programs', 'the programs on the front door'),
  ('public_match_centre', 'the public draw, /c/{slug}'),
  ('public_competition_entry', 'the team-entry form on the public draw'),
  ('peek_competition_invite', 'what an invite link is for, before signing in')
on conflict (proname) do update set why = excluded.why;
