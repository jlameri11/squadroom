-- 0175: how was the game.
--
-- W-01. After a game, the opposition's manager and the referee each mark
-- the other team — players, coaches, spectators, 1 to 5 — with a note if
-- they want. A league sees every team's averages and how many marks are
-- behind them; a club sees its own; a parent sees nothing, and nothing is
-- ever public. Neither Squadi nor Dribl holds this, and it is the thing
-- that lets a league see a sideline problem before it is an incident.
--
-- One mark per marker per team per game. Never edited by anyone else,
-- never deleted; a marker can change their own mark the same day.

create table if not exists public.respect_marks (
  id              uuid primary key default gen_random_uuid(),
  competition_id  uuid not null references public.competitions(id) on delete cascade,
  fixture_id      uuid not null references public.fixtures(id) on delete cascade,
  about_entry_id  uuid not null references public.competition_entries(id) on delete cascade,
  marker_id       uuid not null references public.profiles(id) on delete cascade,
  marker_role     text not null check (marker_role in ('opposition', 'referee')),
  by_entry_id     uuid references public.competition_entries(id) on delete set null,
  players         smallint not null check (players between 1 and 5),
  coaches         smallint not null check (coaches between 1 and 5),
  spectators      smallint not null check (spectators between 1 and 5),
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint respect_marks_once unique (fixture_id, about_entry_id, marker_id)
);
alter table public.respect_marks enable row level security;
-- Read through the dashboard function only: a club must not see who
-- marked it, and the function decides what each person gets.
create index if not exists respect_marks_entry_idx on public.respect_marks (competition_id, about_entry_id);

create or replace function public.give_respect_marks(
  p_fixture uuid, p_about_entry uuid, p_players integer, p_coaches integer, p_spectators integer, p_note text default null
)
returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  v_fx public.fixtures;
  v_role text;
  v_by uuid;
  v_id uuid;
begin
  select * into v_fx from public.fixtures where id = p_fixture;
  if v_fx.id is null or p_about_entry not in (v_fx.home_entry_id, v_fx.away_entry_id) then
    raise exception 'that team was not in that game' using errcode = '22023';
  end if;
  if v_fx.status not in ('final', 'forfeit') then
    raise exception 'marks come after the game' using errcode = '22023';
  end if;
  -- The other side's manager, or the referee who was on it.
  v_by := case when p_about_entry = v_fx.home_entry_id then v_fx.away_entry_id else v_fx.home_entry_id end;
  if coalesce(app_private.can_manage_entry(v_by), false) and not coalesce(app_private.can_manage_entry(p_about_entry), false) then
    v_role := 'opposition';
  elsif exists (select 1 from public.referee_appointments ap
                 where ap.fixture_id = p_fixture and ap.status = 'accepted' and app_private.is_this_referee(ap.referee_id)) then
    v_role := 'referee';
    v_by := null;
  else
    raise exception 'only the other team''s manager or the referee marks a team' using errcode = '42501';
  end if;
  if least(p_players, p_coaches, p_spectators) < 1 or greatest(p_players, p_coaches, p_spectators) > 5 then
    raise exception 'marks are 1 to 5' using errcode = '22023';
  end if;
  insert into public.respect_marks (competition_id, fixture_id, about_entry_id, marker_id, marker_role, by_entry_id, players, coaches, spectators, note)
  values (v_fx.competition_id, p_fixture, p_about_entry, auth.uid(), v_role, v_by, p_players, p_coaches, p_spectators, nullif(btrim(coalesce(p_note, '')), ''))
  on conflict (fixture_id, about_entry_id, marker_id) do update
    set players = excluded.players, coaches = excluded.coaches, spectators = excluded.spectators,
        note = excluded.note, updated_at = now()
    where public.respect_marks.created_at > now() - interval '1 day'
  returning id into v_id;
  if v_id is null then
    raise exception 'a mark can be changed on the day it was given, not after' using errcode = '22023';
  end if;
  return v_id;
end;
$fn$;

-- What this person already gave for this game, so the form shows it.
create or replace function public.my_respect_marks(p_fixture uuid)
returns jsonb
language sql stable security definer set search_path = public as $fn$
  select coalesce(jsonb_agg(jsonb_build_object('about_entry_id', m.about_entry_id, 'players', m.players, 'coaches', m.coaches, 'spectators', m.spectators, 'note', m.note)),
                  '[]'::jsonb)
    from public.respect_marks m
   where m.fixture_id = p_fixture and m.marker_id = auth.uid();
$fn$;

-- The league: every team. A club: its own teams. Nobody else: nothing.
-- Averages and counts, never who marked.
create or replace function public.respect_dashboard(p_competition uuid)
returns jsonb
language sql stable security definer set search_path = public as $fn$
  select coalesce((
    select jsonb_agg(jsonb_build_object(
             'entry_id', s.entry_id, 'team', s.team, 'division', s.division, 'club', s.club,
             'marks', s.marks, 'players', s.players, 'coaches', s.coaches, 'spectators', s.spectators,
             'overall', s.overall, 'low', s.low,
             'notes', case when app_private.may_run(p_competition, 'competition')
                           then coalesce((select jsonb_agg(jsonb_build_object('note', x.note, 'role', x.marker_role, 'at', x.created_at) order by x.created_at desc)
                                            from public.respect_marks x where x.about_entry_id = s.entry_id and x.note is not null), '[]'::jsonb)
                           else '[]'::jsonb end
           ) order by s.overall nulls last, s.division, s.team)
      from (
        -- Grouped first: an aggregate cannot sit inside another.
        select e.id as entry_id, e.display_name as team, e.division, a.name as club,
               count(m.id) as marks,
               round(avg(m.players)::numeric, 1) as players,
               round(avg(m.coaches)::numeric, 1) as coaches,
               round(avg(m.spectators)::numeric, 1) as spectators,
               round(avg((m.players + m.coaches + m.spectators) / 3.0)::numeric, 1) as overall,
               count(m.id) filter (where least(m.players, m.coaches, m.spectators) <= 2) as low
          from public.competition_entries e
          left join public.academies a on a.id = e.academy_id
          left join public.respect_marks m on m.about_entry_id = e.id
         where e.competition_id = p_competition
           and (app_private.may_run(p_competition, 'competition') or coalesce(app_private.can_manage_entry(e.id), false))
           and (app_private.may_run(p_competition, 'competition') or app_private.is_competition_participant(p_competition))
         group by e.id, e.display_name, e.division, a.name
      ) s
  ), '[]'::jsonb);
$fn$;

grant execute on function public.give_respect_marks(uuid, uuid, integer, integer, integer, text) to authenticated;
grant execute on function public.my_respect_marks(uuid) to authenticated;
grant execute on function public.respect_dashboard(uuid) to authenticated;

-- The referee's page needs each side's entry to mark it: 0163's
-- my_appointments with the two ids added.
create or replace function public.my_appointments()
returns jsonb
language sql stable security definer set search_path = public as $fn$
  select jsonb_build_object(
    'pools', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'league', a.name, 'grade', r.grade, 'status', r.status, 'bank_details', r.bank_details) order by a.name)
        from public.referees r join public.academies a on a.id = r.academy_id
       where r.profile_id = auth.uid()
    ), '[]'::jsonb),
    'appointments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', ap.id,
               'role', ap.role,
               'status', ap.status,
               'offered_at', ap.offered_at,
               'checked_in_at', ap.checked_in_at,
               'reported_at', ap.reported_at,
               'report', ap.report,
               'withdrawn_note', ap.withdrawn_note,
               'fixture_id', f.id,
               'home_entry_id', f.home_entry_id,
               'away_entry_id', f.away_entry_id,
               'starts_at', f.starts_at,
               'fixture_status', f.status,
               'competition', c.name,
               'competition_id', c.id,
               'league', a.name,
               'division', f.division,
               'round', f.round,
               'venue', coalesce(v.name, f.venue_label),
               'address', v.address,
               'field', f.field_label,
               'home', h.display_name,
               'away', aw.display_name,
               'home_score', f.home_score,
               'away_score', f.away_score,
               'fee_cents', coalesce(ap.fee_cents, (select x.fee_cents from public.competition_referee_fees x where x.competition_id = c.id and x.role = ap.role)),
               'paid_at', (select i.paid_at from public.referee_payment_items i where i.appointment_id = ap.id and i.status = 'paid')
             ) order by f.starts_at desc nulls last)
        from public.referee_appointments ap
        join public.referees r on r.id = ap.referee_id
        join public.fixtures f on f.id = ap.fixture_id
        join public.competitions c on c.id = f.competition_id
        join public.academies a on a.id = ap.academy_id
        left join public.venues v on v.id = f.venue_id
        left join public.competition_entries h on h.id = f.home_entry_id
        left join public.competition_entries aw on aw.id = f.away_entry_id
       where r.profile_id = auth.uid()
    ), '[]'::jsonb),
    'blockouts', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'referee_id', b.referee_id, 'starts_at', b.starts_at, 'ends_at', b.ends_at, 'reason', b.reason) order by b.starts_at)
        from public.referee_blockouts b
        join public.referees r on r.id = b.referee_id
       where r.profile_id = auth.uid() and b.ends_at >= now() - interval '30 days'
    ), '[]'::jsonb)
  );
$fn$;
grant execute on function public.my_appointments() to authenticated;
