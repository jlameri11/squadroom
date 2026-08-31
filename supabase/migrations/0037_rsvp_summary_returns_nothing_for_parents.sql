-- 0037_rsvp_summary_returns_nothing_for_parents.sql
--
-- event_rsvp_summary put its permission check in the WHERE clause of an
-- aggregate query with no GROUP BY. Postgres still returns one row for that -
-- the aggregate over an empty set - so a parent got { going: 0, maybe: 0,
-- out: 0, no_reply: 0 } instead of nothing at all.
--
-- No real data leaked, but a UI would read that as "nobody is going", which
-- is a confident lie. A refusal has to look like a refusal.

create or replace function public.event_rsvp_summary(p_event uuid)
returns table (going integer, maybe integer, out_count integer, no_reply integer)
language plpgsql stable security definer set search_path = public as $$
begin
  -- Return zero rows, not a row of zeros.
  if not app_private.is_event_coach(p_event) then
    return;
  end if;

  return query
    with roster as (
      select pl.id
        from public.events e
        join public.players pl
          on pl.academy_id = e.academy_id
         and (e.team_id is null or pl.team_id = e.team_id)
       where e.id = p_event
    ),
    answers as (
      select er.player_id, er.status from public.event_rsvps er
       where er.event_id = p_event and er.player_id is not null
    )
    select
      count(*) filter (where a.status = 'yes')::integer,
      count(*) filter (where a.status = 'maybe')::integer,
      count(*) filter (where a.status = 'no')::integer,
      count(*) filter (where a.status is null)::integer
    from roster r
    left join answers a on a.player_id = r.id;
end;
$$;

grant execute on function public.event_rsvp_summary(uuid) to authenticated;
