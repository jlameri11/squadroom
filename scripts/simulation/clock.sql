-- The simulation's clock (docs/SIMULATION.md). LOCAL ONLY — this edits
-- pg_catalog and rewrites function bodies, which only a superuser on the
-- embedded Postgres can do; clock-restore.sql (or a rebuild of the local
-- database) undoes it. Never run against a Supabase project.
--
-- Why: a season is played week by week, and the product's rules are written
-- against the clock — a team sheet locks thirty minutes before kick-off, a
-- late decline is one inside the league's hours, a reminder goes a day
-- before, a check expires on a date, a scheduled message goes when its time
-- comes. To play February to June 2027 in one evening, the database's idea
-- of "now" has to be ours. Every transaction the simulation runs sets
-- `sim.now`; with it unset, the real clock is used, so nothing else notices.
--
-- now(), transaction_timestamp(), clock_timestamp() and statement_timestamp()
-- are ordinary catalog functions and are replaced. CURRENT_DATE is not: on
-- Postgres 17 it is evaluated inside the server from the transaction's
-- start time, so every function in public and app_private that says
-- current_date is re-created, locally, saying pg_catalog.sim_date() instead
-- (63 places; no policy, view or default does). The originals are kept under
-- real_* names and put back by clock-restore.sql.
create or replace function pg_catalog.real_now() returns timestamptz language internal stable parallel safe as 'now';
create or replace function pg_catalog.real_clock() returns timestamptz language internal volatile parallel safe as 'clock_timestamp';
create or replace function pg_catalog.real_statement() returns timestamptz language internal stable parallel safe as 'statement_timestamp';

-- now() and transaction_timestamp(): the simulated moment.
create or replace function pg_catalog.now() returns timestamptz language sql stable parallel safe as $$
  select coalesce(nullif(current_setting('sim.now', true), '')::timestamptz, pg_catalog.real_now())
$$;
create or replace function pg_catalog.transaction_timestamp() returns timestamptz language sql stable parallel safe as $$
  select pg_catalog.now()
$$;
-- The clock keeps moving inside a transaction, from the simulated moment.
create or replace function pg_catalog.clock_timestamp() returns timestamptz language sql volatile parallel safe as $$
  select pg_catalog.now() + (pg_catalog.real_clock() - pg_catalog.real_now())
$$;
create or replace function pg_catalog.statement_timestamp() returns timestamptz language sql stable parallel safe as $$
  select pg_catalog.now() + (pg_catalog.real_statement() - pg_catalog.real_now())
$$;
-- The date in the session's zone, as CURRENT_DATE is.
create or replace function pg_catalog.sim_date() returns date language sql stable parallel safe as $$
  select (pg_catalog.now() at time zone current_setting('TimeZone'))::date
$$;

-- Every function that reads current_date reads sim_date() instead. CREATE OR
-- REPLACE keeps the function's oid, owner and grants.
do $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select p.oid, n.nspname, p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'app_private')
       and p.prokind = 'f'
       and p.prosrc ~* '\mcurrent_date\M'
  loop
    execute regexp_replace(pg_get_functiondef(r.oid), '\mcurrent_date\M', 'pg_catalog.sim_date()', 'gi');
    n := n + 1;
  end loop;
  raise notice 'simulation clock: % functions now read sim_date()', n;
end $$;

select 'functions still reading current_date: ' || count(*) as check
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('public', 'app_private') and p.prosrc ~* '\mcurrent_date\M';

-- What PostgREST's connections think the time is: the local stack
-- (stack.mjs) reads it on start and refuses a server whose clock is not the
-- season's (a PostgREST left over from an earlier run answers with the clock
-- its connections were opened at). Simulation only, never a migration.
create or replace function public.sim_now() returns timestamptz language sql stable as $$ select now() $$;
revoke all on function public.sim_now() from public;
grant execute on function public.sim_now() to anon, authenticated, service_role;
