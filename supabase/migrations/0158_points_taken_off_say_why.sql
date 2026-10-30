-- 0158: points taken off say why.
--
-- L-10. A ladder was results and nothing else. Leagues deduct points — an
-- ineligible player, a forfeit beyond the score, a disciplinary ruling —
-- and award them, and every such change is the thing a club asks about
-- first. The adjustment is a row with a reason, never an edit to a score:
-- the results stay what they were, the ladder shows the arithmetic, and a
-- year later the record says who did what and why.
--
-- The ladder function adds them, so every reader — the organiser's tab, the
-- club's, the public page — shows the same table.

create table if not exists public.ladder_adjustments (
  id             uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete cascade,
  division       text not null,
  entry_id       uuid not null references public.competition_entries(id) on delete cascade,
  points         integer not null check (points between -50 and 50 and points <> 0),
  reason         text not null check (btrim(reason) <> ''),
  made_by        uuid references public.profiles(id) on delete set null,
  made_at        timestamptz not null default now()
);
alter table public.ladder_adjustments enable row level security;
create policy ladder_adjustments_select on public.ladder_adjustments for select to authenticated
  using ((select app_private.is_competition_participant(ladder_adjustments.competition_id)));
create policy ladder_adjustments_insert on public.ladder_adjustments for insert to authenticated
  with check ((select app_private.is_competition_organiser(ladder_adjustments.competition_id)));
create policy ladder_adjustments_delete on public.ladder_adjustments for delete to authenticated
  using ((select app_private.is_competition_organiser(ladder_adjustments.competition_id)));
create index if not exists ladder_adjustments_entry_idx on public.ladder_adjustments (competition_id, division, entry_id);

create or replace function app_private.ladder(p_competition uuid, p_division text)
returns table (
  entry_id uuid, team_name text, group_label text,
  played integer, won integer, drawn integer, lost integer,
  goals_for integer, goals_against integer, goal_difference integer, points integer
)
language sql stable security definer set search_path = public as $fn$
  with rules as (
    select * from app_private.division_rules(p_competition, p_division)
  ),
  played as (
    select f.home_entry_id as entry_id, f.home_score as gf, f.away_score as ga
      from public.fixtures f
     where f.competition_id = p_competition and f.division = p_division
       and f.status in ('final','forfeit') and f.home_score is not null
    union all
    select f.away_entry_id, f.away_score, f.home_score
      from public.fixtures f
     where f.competition_id = p_competition and f.division = p_division
       and f.status in ('final','forfeit') and f.away_score is not null
  ),
  adjusted as (
    select a.entry_id, sum(a.points)::integer as points
      from public.ladder_adjustments a
     where a.competition_id = p_competition and a.division = p_division
     group by a.entry_id
  ),
  table_ as (
    select
      e.id, e.display_name, e.group_label,
      count(p.entry_id)::integer as played,
      count(*) filter (where p.gf > p.ga)::integer as won,
      count(*) filter (where p.gf = p.ga)::integer as drawn,
      count(*) filter (where p.gf < p.ga)::integer as lost,
      coalesce(sum(p.gf), 0)::integer as gf,
      coalesce(sum(p.ga), 0)::integer as ga,
      coalesce(sum(p.gf) - sum(p.ga), 0)::integer as gd,
      (count(*) filter (where p.gf > p.ga) * r.points_win
       + count(*) filter (where p.gf = p.ga) * r.points_draw
       + count(*) filter (where p.gf < p.ga) * r.points_loss
       + coalesce(max(adj.points), 0))::integer as points,
      r.tie_break
    from public.competition_entries e
    cross join rules r
    left join played p on p.entry_id = e.id
    left join adjusted adj on adj.entry_id = e.id
    where e.competition_id = p_competition and e.division = p_division
    group by e.id, e.display_name, e.group_label, r.points_win, r.points_draw, r.points_loss, r.tie_break
  )
  select t.id, t.display_name, t.group_label, t.played, t.won, t.drawn, t.lost, t.gf, t.ga, t.gd, t.points
    from table_ t
   order by t.points desc,
            case when t.tie_break = 'gf_then_gd' then t.gf else t.gd end desc,
            case when t.tie_break = 'gf_then_gd' then t.gd else t.gf end desc,
            t.display_name;
$fn$;

revoke execute on function app_private.ladder(uuid, text) from public, anon;
grant execute on function app_private.ladder(uuid, text) to authenticated, service_role;
