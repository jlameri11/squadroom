-- 0125: X-05's Lineup. The team sheet.
--
-- The last tab of the match centre that carries information nobody else in
-- the product holds. Overview, Availability, the register and the Result all
-- exist; who is actually starting does not, so a coach writes it on paper and
-- the one question every parent asks on the drive over has no answer here.
--
-- A DRAFT AND A PUBLISHED VERSION, and this is the decision the rest follows
-- from. A coach picks a side over two days, changing their mind: a team sheet
-- that parents could watch being edited is a team sheet that produces
-- arguments about a decision nobody has made yet, and the coach's answer to
-- that is to go back to paper. So a lineup is private to the coaching staff
-- until it is published, and publishing is a deliberate act.
--
-- NOT ON THE PUBLIC PAGE, ever. `public_match_centre` publishes teams and
-- scores and no children (R-16), and a team sheet is a list of children's
-- names with their positions. Nothing here is reachable by `anon`.
--
-- REPLACED WHOLESALE, not edited row by row. A lineup is one decision — "this
-- is the side" — and a partial update is how a product ends up with twelve
-- starters because a delete failed and an insert did not.

do $$ begin
  create type public.lineup_role as enum (
    'starting',
    'bench',
    -- Named rather than left out, because "not in the squad this week" is a
    -- thing a coach decides and a parent is owed. A child missing from a
    -- published sheet with no explanation is the worst version of this
    -- feature.
    'out'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.event_lineups (
  id         uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id) on delete cascade,
  event_id   uuid not null,

  -- Free text. "4-3-3", "2-3-1", "rolling subs" — a formation is a thing a
  -- coach says, and a lookup table of formations would be a lookup table
  -- somebody's actual shape is missing from.
  formation  text,
  note       text,

  published_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One sheet per game.
  constraint event_lineups_once unique (event_id),
  constraint event_lineups_event_fk
    foreign key (event_id, academy_id)
    references public.events(id, academy_id) on delete cascade,
  constraint event_lineups_id_academy_key unique (id, academy_id)
);

create table if not exists public.event_lineup_players (
  id         uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id) on delete cascade,
  lineup_id  uuid not null,
  player_id  uuid not null,

  role       public.lineup_role not null default 'bench',
  -- Also free text, and for the same reason: "GK", "left back", "7" and
  -- "anywhere" are all things a coach writes on a team sheet.
  position   text,
  -- The order a coach put them in, which is how a team sheet reads.
  sort_order integer not null default 0,

  constraint event_lineup_players_once unique (lineup_id, player_id),
  constraint event_lineup_players_lineup_fk
    foreign key (lineup_id, academy_id)
    references public.event_lineups(id, academy_id) on delete cascade,
  constraint event_lineup_players_player_fk
    foreign key (player_id, academy_id)
    references public.players(id, academy_id) on delete cascade
);

create index if not exists event_lineup_players_lineup_idx
  on public.event_lineup_players (lineup_id, sort_order);

alter table public.event_lineups enable row level security;
alter table public.event_lineup_players enable row level security;

-- Read through `event_lineup()` only, which is what applies the draft rule.
-- A policy that let the table be read directly would let a parent read an
-- unpublished sheet, which is the one thing this feature must not do.
create policy event_lineups_select on public.event_lineups
  for select to authenticated
  using ((select app_private.is_academy_coach(academy_id)));
create policy event_lineups_write on public.event_lineups
  for all to authenticated using (false) with check (false);

create policy event_lineup_players_select on public.event_lineup_players
  for select to authenticated
  using ((select app_private.is_academy_coach(academy_id)));
create policy event_lineup_players_write on public.event_lineup_players
  for all to authenticated using (false) with check (false);

/**
 * May this person pick the side for this game?
 *
 * A coach of the team, or academy staff. Not any academy coach: the U8s'
 * coach has no business naming the U12s' side, and `is_academy_coach` would
 * have let them.
 */
create or replace function app_private.can_pick_lineup(p_event uuid)
returns boolean
language sql stable security definer set search_path = public as $fn$
  select coalesce((
    select app_private.is_academy_staff(e.academy_id)
        or (e.team_id is not null and app_private.is_team_coach(e.team_id))
      from public.events e where e.id = p_event
  ), false);
$fn$;

/**
 * Write the team sheet.
 *
 * Replaces it wholesale. `p_players` is the sheet: an array of
 * {player_id, role, position}, in the order they should read. Anything not in
 * the array is not in the squad this week — which is why 'out' exists as a
 * role, so a coach can say so explicitly rather than by omission.
 *
 * Every player is checked against the event's own team. Without that a coach
 * could name a child from another squad — or another academy — and the sheet
 * would quietly contain somebody who cannot play.
 */
create or replace function public.set_lineup(
  p_event     uuid,
  p_players   jsonb,
  p_formation text default null,
  p_note      text default null
)
returns uuid
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_event  public.events;
  v_lineup uuid;
  v_item   jsonb;
  v_player uuid;
  v_i      integer := 0;
begin
  select * into v_event from public.events where id = p_event;
  if v_event.id is null then
    raise exception 'no such game' using errcode = '22023';
  end if;

  if not coalesce(app_private.can_pick_lineup(p_event), false) then
    raise exception 'only this squad''s coach can pick the side' using errcode = '42501';
  end if;

  if v_event.type not in ('match', 'tournament') then
    raise exception 'only a match has a team sheet' using errcode = '22023';
  end if;

  if jsonb_typeof(coalesce(p_players, 'null'::jsonb)) <> 'array' then
    raise exception 'the sheet must be a list of players' using errcode = '22023';
  end if;

  insert into public.event_lineups (academy_id, event_id, formation, note, created_by)
  values (
    v_event.academy_id, p_event,
    nullif(btrim(coalesce(p_formation, '')), ''),
    nullif(btrim(coalesce(p_note, '')), ''),
    auth.uid()
  )
  on conflict (event_id) do update
    set formation = excluded.formation,
        note = excluded.note,
        updated_at = now()
  returning id into v_lineup;

  -- Wholesale: see the note at the top. A partial update is how a sheet ends
  -- up with twelve starters.
  delete from public.event_lineup_players where lineup_id = v_lineup;

  for v_item in select * from jsonb_array_elements(p_players)
  loop
    v_i := v_i + 1;
    v_player := (v_item->>'player_id')::uuid;

    -- The event's own team. An academy-wide event (no team) accepts any of
    -- this academy's players, because there is no squad to check against.
    if not exists (
      select 1 from public.players pl
       where pl.id = v_player
         and pl.academy_id = v_event.academy_id
         and (v_event.team_id is null or pl.team_id = v_event.team_id)
    ) then
      raise exception 'one of those players is not in this squad' using errcode = '22023';
    end if;

    insert into public.event_lineup_players
      (academy_id, lineup_id, player_id, role, position, sort_order)
    values (
      v_event.academy_id, v_lineup, v_player,
      coalesce(nullif(v_item->>'role', ''), 'bench')::public.lineup_role,
      nullif(btrim(coalesce(v_item->>'position', '')), ''),
      coalesce((v_item->>'sort_order')::integer, v_i)
    );
  end loop;

  return v_lineup;
end;
$fn$;

revoke execute on function public.set_lineup(uuid, jsonb, text, text) from public, anon;
grant execute on function public.set_lineup(uuid, jsonb, text, text) to authenticated;

/**
 * Release it, or take it back.
 *
 * Publishing is deliberate because unpublished is the useful default: a coach
 * changes their mind twice on a Thursday, and a sheet parents can watch being
 * edited is a sheet that gets argued about before it is a decision.
 *
 * Unpublishing is allowed. A side named by mistake — the wrong game, the
 * wrong week — has to be retractable, and the alternative is a coach deleting
 * the whole sheet to hide it.
 */
create or replace function public.publish_lineup(p_event uuid, p_published boolean default true)
returns void
language plpgsql volatile security definer set search_path = public as $fn$
begin
  if not coalesce(app_private.can_pick_lineup(p_event), false) then
    raise exception 'only this squad''s coach can publish the side' using errcode = '42501';
  end if;

  update public.event_lineups
     set published_at = case when p_published then coalesce(published_at, now()) else null end,
         updated_at = now()
   where event_id = p_event;

  if not found then
    raise exception 'there is no team sheet for that game yet' using errcode = '22023';
  end if;
end;
$fn$;

revoke execute on function public.publish_lineup(uuid, boolean) from public, anon;
grant execute on function public.publish_lineup(uuid, boolean) to authenticated;

/**
 * Read the team sheet.
 *
 * The one place the draft rule lives. A coach sees it whether or not it is
 * published; everybody else sees it only once it is, and sees nothing at all
 * before that — not an empty sheet, which would look like a decision to play
 * nobody.
 *
 * `can_pick` comes back with it so a screen does not have to work out
 * separately whether to show the editing controls, and cannot disagree with
 * the function about who may.
 *
 * The RSVP travels with each player, because the clash a coach needs to see
 * is a starter whose parent said they cannot play. It is NOT enforced —
 * a coach may know something the form does not — but it must not be hidden.
 */
create or replace function public.event_lineup(p_event uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_event   public.events;
  v_lineup  public.event_lineups;
  v_can     boolean;
begin
  select * into v_event from public.events where id = p_event;
  if v_event.id is null then
    return null;
  end if;

  -- Answers to the same rule as the event itself, private_to included — the
  -- fourth visibility rule, which every reader has to honour.
  if not coalesce(app_private.can_read_event(p_event), false) then
    return null;
  end if;

  v_can := coalesce(app_private.can_pick_lineup(p_event), false);

  select * into v_lineup from public.event_lineups where event_id = p_event;

  if v_lineup.id is null then
    -- No sheet yet. A coach is told so it can offer to make one; everybody
    -- else gets the same answer as an unpublished sheet, so the absence of
    -- one is not information either.
    return case when v_can then jsonb_build_object('can_pick', true, 'lineup', null) else null end;
  end if;

  if v_lineup.published_at is null and not v_can then
    return null;
  end if;

  return jsonb_build_object(
    'can_pick', v_can,
    'lineup', jsonb_build_object(
      'id', v_lineup.id,
      'formation', v_lineup.formation,
      'note', v_lineup.note,
      'published_at', v_lineup.published_at,
      'updated_at', v_lineup.updated_at,
      'players', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'player_id', pl.id,
                 'name', coalesce(nullif(btrim(pl.preferred_name), ''), pl.full_name),
                 'full_name', pl.full_name,
                 'role', lp.role,
                 'position', lp.position,
                 'sort_order', lp.sort_order,
                 'squad_number', (
                   select sn.number from public.squad_numbers sn
                    where sn.player_id = pl.id
                    order by sn.created_at desc limit 1
                 ),
                 -- The clash worth seeing: a starter whose family said no.
                 'rsvp', (
                   select r.status::text from public.event_rsvps r
                    where r.event_id = p_event and r.player_id = pl.id
                    limit 1
                 )
               ) order by lp.role, lp.sort_order)
          from public.event_lineup_players lp
          join public.players pl on pl.id = lp.player_id
         where lp.lineup_id = v_lineup.id
      ), '[]'::jsonb)
    )
  );
end;
$fn$;

revoke execute on function public.event_lineup(uuid) from public, anon;
grant execute on function public.event_lineup(uuid) to authenticated;
