-- 0258: blue cards — the sin bin, where the league uses it
--
-- Part C (Joey, 10 Nov 2026), item 4: blue cards per league, on the match
-- sheet with minutes. The kind has been in match_event_kind since the sheet
-- was built and the discipline report has counted blues; what was missing
-- is the league's say-so and the clock. Now a competition's discipline
-- rules carry `blue_cards` (off unless the league turns it on) and
-- `blue_minutes` (the sin bin's length, ten by default); a blue is refused
-- where the league does not use them, and refused without the minute it
-- was shown, because the sheet shows when the player comes back on. The
-- organiser's `blue_cards` switch (Settings → Features) hides the whole
-- thing from every sheet when off.

alter table public.competition_discipline_rules
  add column if not exists blue_cards boolean not null default false,
  add column if not exists blue_minutes integer not null default 10 check (blue_minutes between 2 and 30);

-- The rules reader carries the two more (the return type grows, so drop and
-- make again; its callers look it up by name at run time).
drop function if exists app_private.discipline_rules(uuid);
create function app_private.discipline_rules(p_competition uuid)
returns table (yellows_per_suspension integer, games_per_yellow_suspension integer, games_per_red integer, blue_cards boolean, blue_minutes integer)
language sql stable as $fn$
  select coalesce(r.yellows_per_suspension, 5), coalesce(r.games_per_yellow_suspension, 1), coalesce(r.games_per_red, 1),
         coalesce(r.blue_cards, false), coalesce(r.blue_minutes, 10)
    from (select 1) one
    left join public.competition_discipline_rules r on r.competition_id = p_competition;
$fn$;
revoke execute on function app_private.discipline_rules(uuid) from public, anon, authenticated;

-- Does this league use blue cards today: the rule on, and the switch on.
create or replace function app_private.blue_cards_on(p_competition uuid)
returns boolean
language sql stable security definer set search_path = public as $fn$
  select coalesce((
    select r.blue_cards and app_private.feature_on(c.organiser_id, 'blue_cards')
      from public.competitions c
      cross join app_private.discipline_rules(c.id) r
     where c.id = p_competition
  ), false);
$fn$;
revoke execute on function app_private.blue_cards_on(uuid) from public, anon, authenticated;

-- 0190's recorder, with the blue card's two refusals and its return minute
-- in the log.
create or replace function public.record_match_event(p_fixture uuid, p_entry uuid, p_kind public.match_event_kind, p_player uuid default null, p_minute integer default null, p_note text default null, p_code text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  f       public.fixtures;
  v_id    uuid;
  v_other uuid;
  v_code  text := nullif(upper(btrim(coalesce(p_code, ''))), '');
  v_back  integer;
begin
  select * into f from public.fixtures where id = p_fixture;
  perform app_private.fixture_side(p_fixture, p_entry);
  v_other := case when f.home_entry_id = p_entry then f.away_entry_id else f.home_entry_id end;
  if not (coalesce(app_private.can_manage_entry(p_entry), false)
          or coalesce(app_private.can_manage_entry(v_other), false)
          or coalesce(app_private.is_fixture_referee(p_fixture), false)
          or coalesce(app_private.is_competition_organiser(f.competition_id), false)) then
    raise exception 'only the teams in this game, the referee or the organiser can record events' using errcode = '42501';
  end if;
  if f.ended_at is not null then
    raise exception 'this game has ended; ask the league for a correction' using errcode = '22023';
  end if;
  if p_player is not null and not exists (
       select 1 from public.match_sheet_players sp
         join public.match_sheets s on s.id = sp.sheet_id
        where s.fixture_id = p_fixture and s.entry_id = p_entry and sp.player_id = p_player) then
    raise exception 'that player is not on this team''s sheet for this game' using errcode = '22023';
  end if;
  if v_code is not null then
    if p_kind = 'yellow' and v_code !~ '^Y[1-6]$' then
      raise exception 'a caution takes a Y code, Y1 to Y6' using errcode = '22023';
    elsif p_kind = 'red' and v_code !~ '^R[1-8]$' then
      raise exception 'a sending-off takes an R code, R1 to R8' using errcode = '22023';
    elsif p_kind not in ('yellow', 'red') then
      raise exception 'only a card takes a sanction code' using errcode = '22023';
    end if;
  end if;
  -- 0258: a blue card where the league uses them, with the minute it was shown.
  if p_kind = 'blue' then
    if not app_private.blue_cards_on(f.competition_id) then
      raise exception 'this league does not use blue cards' using errcode = '22023';
    end if;
    if p_minute is null then
      raise exception 'a blue card needs the minute it was shown — the sin bin runs from it' using errcode = '22023';
    end if;
    select p_minute + r.blue_minutes into v_back from app_private.discipline_rules(f.competition_id) r;
  end if;
  insert into public.match_events (competition_id, fixture_id, entry_id, player_id, kind, minute, note, created_by, sanction_code)
  values (f.competition_id, p_fixture, p_entry, p_player, p_kind, p_minute, nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), v_code)
  returning id into v_id;
  perform app_private.log_sheet(f.competition_id, p_fixture, p_entry, 'event_' || p_kind::text,
    jsonb_build_object('player_id', p_player, 'minute', p_minute, 'code', v_code, 'back_at', v_back));
  return v_id;
end;
$$;
