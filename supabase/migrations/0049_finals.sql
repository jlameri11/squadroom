-- 0049_finals.sql
--
-- Finals are printed before they are known. NRIFA's own sheet says
-- "SEMI-FINAL 1 — Best winner v Best runner-up, 3:00 PM, Field 1" hours
-- before anyone knows who that is, and that is correct: parents need to know
-- when and where to be, long before they know who they are playing.
--
-- So a finals fixture carries a DESCRIPTION of its participant rather than a
-- participant, and gets filled in when the group stage finishes.
--
--   P:1:1   the best of the teams that won their group
--   P:1:2   the second-best group winner
--   P:2:1   the best runner-up
--   W:<id>  the winner of that fixture
--   L:<id>  the loser of it
--
-- Ranking across groups uses the same rules as within one: points, then goal
-- difference, then goals for. Where that still cannot separate two teams, the
-- slot is left empty rather than guessed - the same refusal the ladder makes.
--
-- See 0051 (the calculation must not depend on who is asking) and 0052 (the
-- bracket must fit the number of groups) for the two faults this had.

alter table public.fixtures add column home_source text;
alter table public.fixtures add column away_source text;
alter table public.fixtures add column stage text not null default 'group'
  check (stage in ('group', 'final'));

comment on column public.fixtures.home_source is
  'How this slot is filled once results exist: P:<group position>:<rank>,
   W:<fixture id> or L:<fixture id>. Null for a group game, where the teams
   are known from the start.';

create index fixtures_stage_idx on public.fixtures (competition_id, stage);

-- One source descriptor to one entry, or null if it is not knowable yet.
create or replace function public.resolve_source(
  p_competition uuid,
  p_division    text,
  p_source      text
) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  parts text[] := string_to_array(p_source, ':');
  v_id  uuid;
  v_fx  public.fixtures%rowtype;
begin
  if parts[1] = 'P' then
    -- Every group game must be finished, or "best runner-up" is a guess.
    if exists (
      select 1 from public.fixtures
       where competition_id = p_competition and division = p_division
         and stage = 'group' and status not in ('final','forfeit','bye','cancelled')
    ) then
      return null;
    end if;

    select entry_id into v_id
      from public.cross_group_standings(p_competition, p_division, parts[2]::integer)
     order by points desc, goal_difference desc, goals_for desc
     offset (parts[3]::integer - 1) limit 1;
    return v_id;

  elsif parts[1] in ('W', 'L') then
    select * into v_fx from public.fixtures where id = parts[2]::uuid;
    if v_fx.id is null or v_fx.home_score is null or v_fx.away_score is null then
      return null;
    end if;
    -- A drawn knockout has no winner to promote. Left empty on purpose:
    -- penalties happen off the app, and the organiser records the result.
    if v_fx.home_score = v_fx.away_score then
      return null;
    end if;
    if parts[1] = 'W' then
      return case when v_fx.home_score > v_fx.away_score then v_fx.home_entry_id else v_fx.away_entry_id end;
    else
      return case when v_fx.home_score < v_fx.away_score then v_fx.home_entry_id else v_fx.away_entry_id end;
    end if;
  end if;

  return null;
end;
$$;

grant execute on function public.resolve_source(uuid, text, text) to authenticated;

-- A finished result may complete a semi-final, so try to fill the next round.
create or replace function public.on_fixture_scored()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('final','forfeit') and new.home_score is not null
     and (old.home_score is distinct from new.home_score
          or old.status is distinct from new.status) then
    perform public.resolve_finals(new.competition_id, new.division);
  end if;
  return new;
end;
$$;

create trigger fixtures_resolve_finals
  after update of home_score, away_score, status on public.fixtures
  for each row execute function public.on_fixture_scored();
