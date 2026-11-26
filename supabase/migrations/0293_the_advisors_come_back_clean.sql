-- 0293 — the security advisors' warnings, closed (security pass, 26 Nov 2026).
--
-- 1. Every function of ours gets a fixed search_path. The 31 that had none are
--    plain helpers (no definer rights), so nothing could be hijacked through
--    them today; the fix is so the next one written cannot be either. Done as
--    a loop over the catalog so a replay from empty and the dev project end in
--    the same place.
-- 2. A trigger function is run by its trigger, never by a person. The ones
--    with definer rights were still callable through the API by name (they
--    fail without a trigger context, but there is no reason to offer them).
--    Execute is taken from everybody; a trigger does not need it.
-- 3. The nine tables only the server writes (codes, passes, attempt counters)
--    had RLS on and no policy: correct, and closed to the API. They now say so
--    with an explicit policy, so "no policy" is never mistaken for "forgotten".

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app_private') and p.prokind = 'f'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
  loop
    execute format('alter function %s set search_path = public, app_private, extensions, pg_temp', f.sig);
  end loop;

  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app_private') and p.prokind = 'f'
      and p.prorettype = 'trigger'::regtype
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array['email_codes', 'email_confirmations', 'join_attempts', 'notice_emails',
    'registration_attempts', 'respect_marks', 'translation_takes', 'two_step_codes', 'two_step_passes']
  loop
    if to_regclass('public.' || t) is not null
       and not exists (select 1 from pg_policy where polrelid = ('public.' || t)::regclass) then
      execute format('create policy %I on public.%I as restrictive for all to anon, authenticated using (false) with check (false)', t || '_server_only', t);
    end if;
  end loop;
end $$;
