-- 0148: a division has its own rules.
--
-- L-01, the first piece of league mode. Divisions have been free text on
-- entries and fixtures since 0023 — right, because their names belong to
-- the organiser — but a league is not one set of rules. The U8s play
-- 20-minute halves with no scores published and no ladder; Premier plays
-- 45s with everything public; a division in grading uses 2/1/0 for a
-- fortnight. The ladder hard-coded 3/1/0 and GD-then-GF, and the public
-- page published every score of every division.
--
-- This is the settings row for a division: scores public or hidden, ladder
-- on or off, points for a win / draw / loss, the tie-break order, match
-- length and squad size, a grading note. A division with no row keeps the
-- rules the product has always applied, so nothing already running changes.
--
-- The ladder reads it (app_private.ladder), so a 2/1/0 division's table is
-- 2/1/0 everywhere it is shown. The public page reads it: a hidden division
-- shows who played whom and whether it is finished, with no scores and no
-- table — which is what a junior league means by "no scores": the fixtures
-- are still public, the result is not.
--
-- Written by the organiser only, as separate insert / update / delete
-- policies rather than FOR ALL, so the read rule (every participant) can
-- never be widened by an edit to a write rule.

create table if not exists public.competition_divisions (
  id               uuid primary key default gen_random_uuid(),
  competition_id   uuid not null references public.competitions(id) on delete cascade,
  division         text not null check (btrim(division) <> ''),
  age_group        text,
  scores_public    boolean not null default true,
  ladder_enabled   boolean not null default true,
  points_win       integer not null default 3 check (points_win between 0 and 10),
  points_draw      integer not null default 1 check (points_draw between 0 and 10),
  points_loss      integer not null default 0 check (points_loss between 0 and 10),
  -- Points first, always. Then goal difference or goals for, in this order.
  tie_break        text not null default 'gd_then_gf' check (tie_break in ('gd_then_gf', 'gf_then_gd')),
  match_length_mins integer check (match_length_mins between 10 and 120),
  squad_size_max   integer check (squad_size_max between 5 and 30),
  grading_note     text,
  updated_at       timestamptz not null default now(),
  constraint competition_divisions_once unique (competition_id, division)
);

alter table public.competition_divisions enable row level security;

create policy competition_divisions_select on public.competition_divisions for select to authenticated
  using ((select app_private.is_competition_participant(competition_divisions.competition_id)));
create policy competition_divisions_insert on public.competition_divisions for insert to authenticated
  with check ((select app_private.is_competition_organiser(competition_divisions.competition_id)));
create policy competition_divisions_update on public.competition_divisions for update to authenticated
  using ((select app_private.is_competition_organiser(competition_divisions.competition_id)));
create policy competition_divisions_delete on public.competition_divisions for delete to authenticated
  using ((select app_private.is_competition_organiser(competition_divisions.competition_id)));

create index if not exists competition_divisions_competition_idx on public.competition_divisions (competition_id);

/** The rules for a division, with the defaults where no row exists. */
create or replace function app_private.division_rules(p_competition uuid, p_division text)
returns table (
  scores_public boolean, ladder_enabled boolean,
  points_win integer, points_draw integer, points_loss integer,
  tie_break text, match_length_mins integer, squad_size_max integer
)
language sql stable as $fn$
  select coalesce(d.scores_public, true), coalesce(d.ladder_enabled, true),
         coalesce(d.points_win, 3), coalesce(d.points_draw, 1), coalesce(d.points_loss, 0),
         coalesce(d.tie_break, 'gd_then_gf'), d.match_length_mins, d.squad_size_max
    from (select 1) one
    left join public.competition_divisions d
      on d.competition_id = p_competition and d.division = p_division;
$fn$;

-- The ladder, by the division's rules. Same shape as 0051 so every caller
-- and the public page keep working; the arithmetic now comes from the row.
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
       + count(*) filter (where p.gf < p.ga) * r.points_loss)::integer as points,
      r.tie_break
    from public.competition_entries e
    cross join rules r
    left join played p on p.entry_id = e.id
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

-- The public page, honouring a hidden division: fixtures still listed, the
-- score and the table withheld. 0096's body otherwise.
create or replace function public.public_match_centre(p_slug text)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_comp public.competitions;
begin
  select * into v_comp
    from public.competitions
   where public_slug = p_slug
     and published_at is not null
     and public_slug is not null;
  if v_comp.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'competition', jsonb_build_object(
      'name', v_comp.name,
      'season', v_comp.season,
      'organiser', (select a.name from public.academies a where a.id = v_comp.organiser_id)
    ),

    'fixtures', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', f.id,
               'starts_at', f.starts_at,
               'round', f.round,
               'division', f.division,
               'group_label', f.group_label,
               'venue', coalesce(v.name, f.venue_label),
               'field', f.field_label,
               'home', home.display_name,
               'away', away.display_name,
               'home_entry_id', f.home_entry_id,
               'away_entry_id', f.away_entry_id,
               'home_score', case when r.scores_public then f.home_score end,
               'away_score', case when r.scores_public then f.away_score end,
               'scores_hidden', not r.scores_public,
               'status', f.status
             ) order by f.starts_at nulls last, f.field_label)
        from public.fixtures f
        left join public.venues v on v.id = f.venue_id
        left join public.competition_entries home on home.id = f.home_entry_id
        left join public.competition_entries away on away.id = f.away_entry_id
        cross join lateral app_private.division_rules(v_comp.id, f.division) r
       where f.competition_id = v_comp.id
    ), '[]'::jsonb),

    'ladder', coalesce((
      select jsonb_object_agg(d.division, d.table)
        from (
          select e.division,
                 coalesce((
                   select jsonb_agg(to_jsonb(l))
                     from app_private.ladder(v_comp.id, e.division) l
                 ), '[]'::jsonb) as table
            from (select distinct division from public.competition_entries
                   where competition_id = v_comp.id and division is not null) e
            cross join lateral app_private.division_rules(v_comp.id, e.division) r
           where r.ladder_enabled and r.scores_public
        ) d
    ), '{}'::jsonb),

    'divisions', coalesce((
      select jsonb_agg(distinct e.division order by e.division)
        from public.competition_entries e
       where e.competition_id = v_comp.id and e.division is not null
    ), '[]'::jsonb),

    'squads', coalesce((
      select jsonb_object_agg(s.entry_id, s.players)
        from (
          select e.id as entry_id,
                 jsonb_agg(
                   jsonb_build_object('name', pub.name, 'number', pub.number)
                   order by pub.number nulls last, pub.name
                 ) as players
            from public.competition_entries e
            join lateral app_private.public_squad(e.id) pub on true
           where e.competition_id = v_comp.id
           group by e.id
        ) s
    ), '{}'::jsonb)
  );
end;
$fn$;

revoke execute on function public.public_match_centre(text) from public;
grant execute on function public.public_match_centre(text) to anon, authenticated;
