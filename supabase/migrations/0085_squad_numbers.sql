-- 0085: shirt numbers, and why the pool is per SEASON and not per TEAM.
--
-- The obvious design is a number column on `players`, unique per team. It is
-- wrong, and the reason is a Saturday morning: players play up and down an age
-- group all season. A U10 who fills in for the U11s wearing 7, against an
-- U11 squad that already has a 7, is two number sevens on the same pitch —
-- and the referee's match sheet cannot record who scored.
--
-- So the pool is `(academy_id, season)`. One 7 in the club per season. It is
-- stricter than a governing body requires and it is what the kit order needs
-- anyway, because the numbers get printed once.
--
-- A separate table rather than a column because a number belongs to a player
-- IN A SEASON, and `players` has no season. A child keeps their row across
-- years and their number changes; last year's squad list should still say
-- what they wore last year.

create table if not exists public.squad_numbers (
  id         uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id) on delete cascade,
  player_id  uuid not null,
  season     text not null check (btrim(season) <> ''),
  number     integer not null check (number between 1 and 99),

  assigned_by uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),

  -- The rule. One holder of each number per season, across every age group.
  constraint squad_numbers_unique unique (academy_id, season, number),
  -- And one number per player per season, so nobody has two.
  constraint squad_numbers_one_each unique (academy_id, season, player_id),

  constraint squad_numbers_id_academy_key unique (id, academy_id),
  constraint squad_numbers_player_fkey foreign key (player_id, academy_id)
    references public.players (id, academy_id) on delete cascade
);

create index if not exists squad_numbers_season_idx
  on public.squad_numbers (academy_id, season);

alter table public.squad_numbers enable row level security;

-- Everyone in the academy can see who wears what. It is printed on a shirt.
create policy squad_numbers_select on public.squad_numbers
  for select to authenticated
  using ((select app_private.is_academy_member(academy_id)));

-- Coaches assign them, because the coach is who the parent asks.
create policy squad_numbers_insert on public.squad_numbers
  for insert to authenticated
  with check ((select app_private.is_academy_coach(academy_id)));

create policy squad_numbers_update on public.squad_numbers
  for update to authenticated
  using ((select app_private.is_academy_coach(academy_id)))
  with check ((select app_private.is_academy_coach(academy_id)));

create policy squad_numbers_delete on public.squad_numbers
  for delete to authenticated
  using ((select app_private.is_academy_coach(academy_id)));

/**
 * The lowest free number, so nobody has to look it up.
 *
 * A coach assigning numbers to seventeen children should not be checking a
 * list seventeen times, and "what is free" is a question the database can
 * answer instantly and a human cannot.
 *
 * p_preferred is tried first — children ask for a number, and the answer is
 * usually yes. If it is taken, the next free one comes back rather than an
 * error, because the useful reply to "can I have 10?" is "10 is taken, 11 is
 * free" and not "no".
 */
create or replace function public.next_squad_number(
  p_academy   uuid,
  p_season    text,
  p_preferred integer default null
)
returns integer
language sql stable security definer set search_path = public as $fn$
  with taken as (
    select number from public.squad_numbers
     where academy_id = p_academy and season = p_season
  )
  select coalesce(
    -- What they asked for, if it is going.
    (select p_preferred
       where p_preferred between 1 and 99
         and not exists (select 1 from taken where number = p_preferred)),
    -- Otherwise the lowest free one.
    (select n from generate_series(1, 99) n
      where not exists (select 1 from taken where number = n)
      order by n limit 1)
  )
  where (select app_private.is_academy_member(p_academy));
$fn$;

revoke execute on function public.next_squad_number(uuid, text, integer) from public, anon;
grant execute on function public.next_squad_number(uuid, text, integer) to authenticated;
