-- Puts the real clock back after clock.sql (LOCAL ONLY). The functions that
-- were rewritten to read sim_date() are left reading it — sim_date() with
-- no sim.now set is today — and a rebuild of the local database
-- (scripts/local-db/run.mjs) restores every original body.
create or replace function pg_catalog.now() returns timestamptz language internal stable parallel safe as 'now';
create or replace function pg_catalog.transaction_timestamp() returns timestamptz language internal stable parallel safe as 'now';
create or replace function pg_catalog.clock_timestamp() returns timestamptz language internal volatile parallel safe as 'clock_timestamp';
create or replace function pg_catalog.statement_timestamp() returns timestamptz language internal stable parallel safe as 'statement_timestamp';
drop function if exists pg_catalog.real_now();
drop function if exists pg_catalog.real_clock();
drop function if exists pg_catalog.real_statement();
