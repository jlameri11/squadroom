-- 0059_scan_rate_limit.sql
--
-- Every scan spends real money at Anthropic, which makes /scan the first
-- feature in this product where an ordinary user can cost the owner
-- something just by tapping a button repeatedly.
--
-- There is a hard spend cap at the provider, and that is the real budget
-- protection. But a cap that trips is a terrible way to discover somebody was
-- looping: it fails for EVERYONE at once, including the coach trying to post
-- Saturday's draw. So the per-person limit exists to make sure the hard cap
-- is never the thing that stops us.
--
-- Twenty a day, against a batch limit of ten per upload in the interface. A
-- parent scans their draw once a season and a coach maybe once a round, so
-- this is nowhere near anybody's real use - it is only ever reached by a
-- stuck retry loop or someone playing.
--
-- Enforced in the database rather than the route, because the route is not
-- the only way in: the client holds an authenticated Supabase session and can
-- insert into event_scans directly. A limit that lives in a route handler is
-- a limit that a determined person walks around, and scripts/test-scan-limits
-- checks exactly that path.

create or replace function app_private.enforce_scan_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public as $fn$
declare
  v_today integer;
  v_limit constant integer := 20;
begin
  select count(*) into v_today
    from public.event_scans
   where profile_id = new.profile_id
     and created_at > now() - interval '24 hours';

  if v_today >= v_limit then
    -- A rolling window rather than midnight, so it clears gradually instead
    -- of latching until the next calendar day.
    raise exception 'You have read % screenshots today. Try again tomorrow, or add the game by hand.', v_limit
      using errcode = '53400';   -- configuration_limit_exceeded
  end if;

  return new;
end;
$fn$;

drop trigger if exists event_scans_rate_limit on public.event_scans;
create trigger event_scans_rate_limit
  before insert on public.event_scans
  for each row execute function app_private.enforce_scan_rate_limit();

-- The count above is per person over a recent window, so it wants an index
-- shaped that way rather than the purge index, which is ordered by expiry.
create index if not exists event_scans_profile_recent_idx
  on public.event_scans (profile_id, created_at desc);
