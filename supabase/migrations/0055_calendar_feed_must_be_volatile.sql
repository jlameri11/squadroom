-- 0055_calendar_feed_must_be_volatile.sql
--
-- calendar_feed_events was declared STABLE and then updated a row to record
-- that the feed had been read. Postgres refuses that at runtime, so every
-- fetch raised - and the route ignored the error and returned an empty
-- calendar, which looks exactly like "you have no games".
--
-- Two faults with one symptom. This is the database half; the route now
-- surfaces the error instead of swallowing it.
--
-- Kept the read counter, because a subscription that nobody's phone has ever
-- fetched is the difference between "they ignored it" and "it never worked",
-- and that is worth knowing when a parent says they never got the fixtures.

create or replace function public.calendar_feed_events(p_token text)
returns table (
  event_id   uuid,
  title      text,
  starts_at  timestamptz,
  ends_at    timestamptz,
  arrive_at  timestamptz,
  venue      text,
  address    text,
  opponent   text,
  kit_colour text,
  cancelled_at timestamptz,
  updated_at timestamptz,
  timezone   text
)
language plpgsql
volatile               -- it writes; saying otherwise made every read fail
security definer set search_path = public as $$
declare
  v_profile uuid;
begin
  select profile_id into v_profile from public.calendar_feeds where token = p_token;
  if v_profile is null then
    return;
  end if;

  update public.calendar_feeds
     set last_read_at = now(), read_count = read_count + 1
   where token = p_token;

  return query
    select distinct on (e.id)
      e.id, e.title, e.starts_at, e.ends_at, e.arrive_at,
      e.venue, e.address, e.opponent, e.kit_colour, e.cancelled_at, e.updated_at,
      a.timezone
    from public.events e
    join public.academies a on a.id = e.academy_id
    join public.academy_members am
      on am.academy_id = e.academy_id and am.profile_id = v_profile and am.status = 'active'
    left join public.team_members tm
      on tm.team_id = e.team_id and tm.profile_id = v_profile
   where e.starts_at > now() - interval '30 days'
     and (e.team_id is null or tm.profile_id is not null)
   order by e.id, e.starts_at;
end;
$$;

revoke execute on function public.calendar_feed_events(text) from public, anon, authenticated;
grant execute on function public.calendar_feed_events(text) to service_role;
