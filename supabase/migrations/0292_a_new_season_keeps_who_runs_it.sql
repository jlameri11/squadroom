-- 0292 — a new season keeps who runs it (found after the demo's Season 4 was
-- seeded, 26 Nov 2026). new_season_from copied the organising organisation's
-- id but not the league's name on the competition (competitions.organiser),
-- which is what another club's people are shown as "Run by …" — they cannot
-- read the organiser's own row. Season 4 read as run by nobody to every
-- entered club. Copied now, and filled in for seasons already made.

create or replace function public.new_season_from(p_competition uuid, p_name text, p_season text, p_starts_on date, p_ends_on date default null, p_slug text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c      public.competitions;
  v_new  uuid;
  v_entries integer := 0;
begin
  select * into c from public.competitions where id = p_competition;
  if c.id is null or not coalesce(app_private.may_run(p_competition, 'competition'), false) then
    raise exception 'only the league starts a new season' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_name, ''))) = 0 then
    raise exception 'the new season needs a name' using errcode = '22023';
  end if;
  insert into public.competitions (organiser_id, organiser, name, type, season, status, starts_on, ends_on, created_by, mode, visibility, public_slug, published_at, entries_open, previous_competition_id,
                                   late_decline_hours, self_appoint, self_appoint_grades, club_allocate_hours)
  values (c.organiser_id, c.organiser, btrim(p_name), c.type, p_season, 'active', p_starts_on, p_ends_on, auth.uid(), c.mode, c.visibility,
          nullif(btrim(coalesce(p_slug, '')), ''), case when nullif(btrim(coalesce(p_slug, '')), '') is not null then now() end, true, c.id,
          c.late_decline_hours, c.self_appoint, c.self_appoint_grades, c.club_allocate_hours)
  returning id into v_new;
  insert into public.competition_divisions (competition_id, division, age_group, scores_public, ladder_enabled, points_win, points_draw, points_loss, tie_break, match_length_mins, squad_size_max, grading_note, rank, allow_playing_up, forfeit_score, sheet_lock_mins, finals_min_games, borrow_cap, pitch_size, squad_size_min)
  select v_new, d.division, d.age_group, d.scores_public, d.ladder_enabled, d.points_win, d.points_draw, d.points_loss, d.tie_break, d.match_length_mins, d.squad_size_max, d.grading_note, d.rank, d.allow_playing_up, d.forfeit_score, d.sheet_lock_mins, d.finals_min_games, d.borrow_cap, d.pitch_size, d.squad_size_min
    from public.competition_divisions d where d.competition_id = c.id;
  insert into public.competition_fees (competition_id, division, fee_cents, instructions)
  select v_new, f.division, f.fee_cents, f.instructions from public.competition_fees f where f.competition_id = c.id;
  insert into public.competition_referee_fees (competition_id, role, fee_cents)
  select v_new, r.role, r.fee_cents from public.competition_referee_fees r where r.competition_id = c.id;
  insert into public.competition_discipline_rules (competition_id, yellows_per_suspension, games_per_yellow_suspension, games_per_red, blue_cards, blue_minutes)
  select v_new, r.yellows_per_suspension, r.games_per_yellow_suspension, r.games_per_red, r.blue_cards, r.blue_minutes
    from public.competition_discipline_rules r where r.competition_id = c.id;
  insert into public.competition_clubs (competition_id, academy_id, status, invited_by, joined_at)
  select v_new, cc.academy_id, cc.status, auth.uid(), now() from public.competition_clubs cc where cc.competition_id = c.id and cc.status = 'active';
  -- The teams that rolled over keep their place, under their new name.
  insert into public.competition_entries (competition_id, academy_id, team_id, display_name, division, nominated_at)
  select v_new, e.academy_id, nt.id,
         (select a.name from public.academies a where a.id = e.academy_id) || ' ' || nt.name,
         e.division, now()
    from public.competition_entries e
    join public.teams nt on nt.rolled_from = e.team_id and nt.status = 'active'
   where e.competition_id = c.id and e.team_id is not null and e.withdrawn_at is null;
  get diagnostics v_entries = row_count;
  perform app_private.log_activity(c.organiser_id, 'season.started', 'competition', v_new, btrim(p_name), jsonb_build_object('from', c.id, 'entries', v_entries));
  return jsonb_build_object('competition_id', v_new, 'entries', v_entries);
end;
$$;

update public.competitions n
   set organiser = p.organiser
  from public.competitions p
 where n.previous_competition_id = p.id and n.organiser is null and p.organiser is not null;
