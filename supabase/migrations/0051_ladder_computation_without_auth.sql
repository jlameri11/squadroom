-- 0051_ladder_computation_without_auth.sql
--
-- Finals never filled in, and the reason is worth stating plainly:
-- competition_ladder checks that the CALLER is in the competition, and
-- resolve_finals runs from a trigger when a score is saved. A score saved by
-- a background job, an import, or the service role has no auth.uid() - so the
-- ladder came back empty, "best runner-up" was unknowable, and the bracket
-- silently stayed blank.
--
-- The mistake was putting an authorisation check inside a CALCULATION. Who
-- may SEE a ladder is a question for the boundary; what the ladder IS does
-- not depend on who is asking. Splitting them fixes the bug and stops the
-- same trap being set again.

create or replace function app_private.ladder(p_competition uuid, p_division text)
returns table (
  entry_id uuid, team_name text, group_label text,
  played integer, won integer, drawn integer, lost integer,
  goals_for integer, goals_against integer, goal_difference integer, points integer
)
language sql stable security definer set search_path = public as $$
  with played as (
    select f.home_entry_id as entry_id, f.home_score as gf, f.away_score as ga
      from public.fixtures f
     where f.competition_id = p_competition and f.division = p_division
       and f.status in ('final','forfeit') and f.home_score is not null
    union all
    select f.away_entry_id, f.away_score, f.home_score
      from public.fixtures f
     where f.competition_id = p_competition and f.division = p_division
       and f.status in ('final','forfeit') and f.away_score is not null
  )
  select
    e.id, e.display_name, e.group_label,
    count(p.entry_id)::integer,
    count(*) filter (where p.gf > p.ga)::integer,
    count(*) filter (where p.gf = p.ga)::integer,
    count(*) filter (where p.gf < p.ga)::integer,
    coalesce(sum(p.gf), 0)::integer,
    coalesce(sum(p.ga), 0)::integer,
    coalesce(sum(p.gf) - sum(p.ga), 0)::integer,
    (count(*) filter (where p.gf > p.ga) * 3 + count(*) filter (where p.gf = p.ga))::integer
  from public.competition_entries e
  left join played p on p.entry_id = e.id
  where e.competition_id = p_competition and e.division = p_division
  group by e.id, e.display_name, e.group_label
  order by 11 desc, 10 desc, 8 desc, e.display_name;
$$;

revoke execute on function app_private.ladder(uuid, text) from public, anon;
grant execute on function app_private.ladder(uuid, text) to authenticated, service_role;

-- The public one keeps the gate, and now only the gate.
create or replace function public.competition_ladder(p_competition uuid, p_division text)
returns table (
  entry_id uuid, team_name text, group_label text,
  played integer, won integer, drawn integer, lost integer,
  goals_for integer, goals_against integer, goal_difference integer, points integer
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not app_private.is_competition_participant(p_competition) then
    return;
  end if;
  return query select * from app_private.ladder(p_competition, p_division);
end;
$$;

grant execute on function public.competition_ladder(uuid, text) to authenticated;

create or replace function public.cross_group_standings(
  p_competition uuid, p_division text, p_position integer
)
returns table (entry_id uuid, team_name text, group_label text,
               points integer, goal_difference integer, goals_for integer)
language sql stable security definer set search_path = public as $$
  with ranked as (
    select l.*, row_number() over (
             partition by coalesce(l.group_label, '')
             order by l.points desc, l.goal_difference desc, l.goals_for desc, l.team_name
           ) as pos
      from app_private.ladder(p_competition, p_division) l
  )
  select r.entry_id, r.team_name, r.group_label, r.points, r.goal_difference, r.goals_for
    from ranked r
   where r.pos = p_position
   order by r.points desc, r.goal_difference desc, r.goals_for desc, r.team_name;
$$;

grant execute on function public.cross_group_standings(uuid, text, integer) to authenticated;

-- Resolving is machinery, not a user action: a trigger must be able to run it
-- with no session at all.
create or replace function public.resolve_finals(p_competition uuid, p_division text)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  f        record;
  v_filled integer := 0;
begin
  for f in
    select * from public.fixtures
     where competition_id = p_competition and division = p_division and stage = 'final'
     order by starts_at
  loop
    if f.home_entry_id is null and f.home_source is not null then
      update public.fixtures
         set home_entry_id = public.resolve_source(p_competition, p_division, f.home_source)
       where id = f.id and home_entry_id is null;
    end if;
    if f.away_entry_id is null and f.away_source is not null then
      update public.fixtures
         set away_entry_id = public.resolve_source(p_competition, p_division, f.away_source)
       where id = f.id and away_entry_id is null;
    end if;
  end loop;

  select count(*) into v_filled
    from public.fixtures
   where competition_id = p_competition and division = p_division and stage = 'final'
     and home_entry_id is not null and away_entry_id is not null;

  return v_filled;
end;
$$;

grant execute on function public.resolve_finals(uuid, text) to authenticated;
