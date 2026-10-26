-- 0104: what needs this person, in one call.
--
-- Found by auditing the navigation rather than the code: `/programs` and
-- `/payments` were linked from NOWHERE. A parent could not find their bills
-- and could not find anything to sign up to. Two whole features — the
-- registration flow and the billing layer — were invisible to the only people
-- who use them, reachable only by typing a URL.
--
-- The tab bar is five destinations and must stay five: every one added past
-- that makes the other four harder to hit. And the home screen is
-- deliberately two things, what is coming up and the rooms you are in. So
-- neither of those is where the fix goes.
--
-- The answer the spec already had is a NEEDS YOU strip: not navigation, but
-- the specific things waiting on this person right now, each one a link to
-- the place it is dealt with. A parent with nothing outstanding sees nothing
-- and the home screen is unchanged; a parent who owes $540 and has a consent
-- to sign sees exactly those two.
--
-- One function, because the home screen is the most-opened screen in the
-- product and 0066 exists to make it a single round trip. Adding four queries
-- to it would undo that.

/**
 * Everything waiting on the person asking, as a list of prompts.
 *
 * Ordered by what matters: money and safeguarding before convenience. Each
 * row carries a `href` so the screen does not need to know where anything
 * lives, and a `count` so it can say "3 children" rather than repeating a
 * row three times.
 *
 * Deliberately returns an empty array rather than nulls or zeroes. A strip
 * that renders "0 outstanding" is a strip that is always there, and the home
 * screen is worth more when most people see nothing.
 */
create or replace function public.needs_you(p_academy uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_me       uuid := auth.uid();
  v_academy  uuid;
  v_items    jsonb := '[]'::jsonb;
  v_is_staff boolean;
  v_count    integer;
  v_cents    bigint;
  v_next     text;
begin
  if v_me is null then return null; end if;
  v_academy := app_private.my_academy(p_academy);
  if v_academy is null then return '[]'::jsonb; end if;

  v_is_staff := app_private.is_academy_coach(v_academy);

  -- ---------------------------------------------------------------- a parent

  -- Money first. It is the thing with a deadline attached and the thing a
  -- club is least comfortable chasing.
  select count(*), coalesce(sum(outstanding), 0)
    into v_count, v_cents
    from (
      select greatest(
               0,
               (r.amount_cents - round(
                  r.amount_cents::numeric
                  * coalesce(
                      case
                        when coalesce(array_length(a.sibling_discount_bps, 1), 0) = 0
                          or app_private.sibling_rank(r.id, pl.id, v_me) <= 1 then 0
                        else a.sibling_discount_bps[
                          least(app_private.sibling_rank(r.id, pl.id, v_me) - 1,
                                array_length(a.sibling_discount_bps, 1))]
                      end, 0) / 10000)::integer)
               - coalesce((
                   select sum(pay.amount_cents) from public.payments pay
                    where pay.request_id = r.id and pay.player_id = pl.id
                      and pay.status = 'paid'
                 ), 0)
             ) as outstanding
        from public.payment_requests r
        join public.academies a on a.id = r.academy_id
        join public.players pl
          on pl.academy_id = r.academy_id
         and (r.team_id is null or pl.team_id = r.team_id)
        join public.player_guardians pg
          on pg.player_id = pl.id and pg.profile_id = v_me
       where r.academy_id = v_academy
         and r.archived_at is null
         and r.per_player
    ) owed
   where outstanding > 0;

  if v_count > 0 then
    v_items := v_items || jsonb_build_object(
      'kind', 'fees',
      'title', case when v_count = 1 then 'A fee to pay' else v_count || ' fees to pay' end,
      'detail', '$' || to_char(v_cents / 100.0, 'FM999999990.00') || ' outstanding',
      'href', '/payments',
      'count', v_count,
      'urgent', true
    );
  end if;

  -- Consents, which are the other thing with a legal edge to it.
  select count(*) into v_count
    from public.players pl
    join public.player_guardians pg
      on pg.player_id = pl.id and pg.profile_id = v_me
   where pl.academy_id = v_academy
     and exists (
       select 1 from public.outstanding_consents(pl.id) c where c.required
     );

  if v_count > 0 then
    v_items := v_items || jsonb_build_object(
      'kind', 'consents',
      'title', 'Something to agree to',
      'detail', case when v_count = 1 then 'For one child' else 'For ' || v_count || ' children' end,
      'href', '/settings',
      'count', v_count,
      'urgent', true
    );
  end if;

  -- An unanswered fixture in the next week. Not every unanswered one ever:
  -- a coach wants Saturday's answer, and a list of forty is a list nobody
  -- acts on.
  select count(*), min(e.title)
    into v_count, v_next
    from public.players pl
    join public.player_guardians pg
      on pg.player_id = pl.id and pg.profile_id = v_me
    join public.events e
      on e.academy_id = pl.academy_id
     and (e.team_id is null or pl.team_id = e.team_id)
   where pl.academy_id = v_academy
     and e.cancelled_at is null
     and e.starts_at between now() and now() + interval '7 days'
     and (e.private_to is null or e.private_to = v_me)
     and not exists (
       select 1 from public.event_rsvps r
        where r.event_id = e.id and r.player_id = pl.id
     );

  if v_count > 0 then
    v_items := v_items || jsonb_build_object(
      'kind', 'rsvps',
      'title', case
                 when v_count = 1 then 'One game to answer'
                 else v_count || ' games to answer'
               end,
      'detail', v_next,
      'href', '/calendar',
      'count', v_count,
      'urgent', false
    );
  end if;

  -- Something open to sign up to, but only if a child is actually eligible
  -- and not already in it. An invitation to something they cannot join is
  -- noise.
  select count(distinct p.id) into v_count
    from public.programs p
    join public.players pl
      on pl.academy_id = p.academy_id
    join public.player_guardians pg
      on pg.player_id = pl.id and pg.profile_id = v_me
   where p.academy_id = v_academy
     and p.status = 'open'
     and (p.closes_at is null or p.closes_at > now())
     and (p.born_from_year is null
          or extract(year from pl.dob)::integer >= p.born_from_year)
     and (p.born_to_year is null
          or extract(year from pl.dob)::integer <= p.born_to_year)
     and not exists (
       select 1 from public.program_registrations pr
        where pr.program_id = p.id and pr.player_id = pl.id
     );

  if v_count > 0 then
    v_items := v_items || jsonb_build_object(
      'kind', 'programs',
      'title', case when v_count = 1 then 'Something to sign up to' else v_count || ' things to sign up to' end,
      'detail', 'Camps, trials and squads',
      'href', '/programs',
      'count', v_count,
      'urgent', false
    );
  end if;

  -- ----------------------------------------------------------------- a coach

  if v_is_staff then
    select count(*) into v_count
      from public.join_requests jr
     where jr.academy_id = v_academy and jr.status = 'pending';
    if v_count > 0 then
      v_items := v_items || jsonb_build_object(
        'kind', 'join_requests',
        'title', case when v_count = 1 then 'A family is waiting' else v_count || ' families are waiting' end,
        'detail', 'They see nothing until you approve them',
        'href', '/admin/requests',
        'count', v_count,
        'urgent', true
      );
    end if;

    select count(*) into v_count
      from public.program_registrations pr
     where pr.academy_id = v_academy and pr.status = 'pending';
    if v_count > 0 then
      v_items := v_items || jsonb_build_object(
        'kind', 'registrations',
        'title', case when v_count = 1 then 'A registration to decide' else v_count || ' registrations to decide' end,
        'detail', 'Families see “pending” until you do',
        'href', '/admin/programs',
        'count', v_count,
        'urgent', false
      );
    end if;

    -- A register nobody took. Only sessions that have FINISHED, and only in
    -- the last fortnight — chasing a coach about a session from August is
    -- noise, and one that is still running is not late yet.
    select count(*) into v_count
      from public.events e
     where e.academy_id = v_academy
       and e.team_id is not null
       and e.cancelled_at is null
       and e.ends_at < now()
       and e.starts_at > now() - interval '14 days'
       and app_private.is_team_coach(e.team_id)
       and not exists (
         select 1 from public.event_attendance a where a.event_id = e.id
       );
    if v_count > 0 then
      v_items := v_items || jsonb_build_object(
        'kind', 'registers',
        'title', case when v_count = 1 then 'A register to take' else v_count || ' registers to take' end,
        'detail', 'Sessions that have finished with nobody marked',
        'href', '/calendar',
        'count', v_count,
        'urgent', false
      );
    end if;
  end if;

  return v_items;
end;
$fn$;

revoke execute on function public.needs_you(uuid) from public, anon;
grant execute on function public.needs_you(uuid) to authenticated;
