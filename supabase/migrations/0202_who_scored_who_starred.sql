-- 0202: who scored, who starred.
--
-- X-02 junior stats and X-03 Player of the Match. What a seven-year-old
-- asks on the way home — did I score, was I the best — and what a family
-- keeps: games played, goals, assists, the Player of the Match count, a
-- season at a time.
--
--   stats     one row per child per game: goals, assists, minutes, a word.
--             Entered by the coach on the game; read by the squad's people;
--             totalled on the player card and the squad's page.
--   the star  one Player of the Match per game, picked by the coach, posted
--             to the squad's chat as an announcement (so it is pushed, and
--             pinned-style visible). Optionally the families vote first —
--             one vote per adult, from kick-off until a day after the final
--             whistle — and the coach sees the tally before picking. The
--             tally is never a popularity contest in public: families see
--             it only once the vote has closed.
--
-- No photo on the card. A child's photo is the family's and lives behind
-- consent (0146); the chat line names the child, which the whole squad
-- already knows.

create table if not exists public.event_player_stats (
  academy_id  uuid not null references public.academies(id) on delete cascade,
  event_id    uuid not null,
  player_id   uuid not null,
  goals       integer not null default 0 check (goals between 0 and 50),
  assists     integer not null default 0 check (assists between 0 and 50),
  minutes     integer check (minutes is null or minutes between 0 and 150),
  potm        boolean not null default false,
  note        text,
  entered_by  uuid references public.profiles(id) on delete set null,
  updated_at  timestamptz not null default now(),
  primary key (event_id, player_id),
  foreign key (event_id, academy_id) references public.events(id, academy_id) on delete cascade,
  foreign key (player_id, academy_id) references public.players(id, academy_id) on delete cascade
);
create unique index if not exists event_player_stats_one_star on public.event_player_stats (event_id) where potm;
create index if not exists event_player_stats_player_idx on public.event_player_stats (player_id);

create table if not exists public.potm_votes (
  academy_id  uuid not null references public.academies(id) on delete cascade,
  event_id    uuid not null,
  voter_id    uuid not null references public.profiles(id) on delete cascade,
  player_id   uuid not null,
  created_at  timestamptz not null default now(),
  primary key (event_id, voter_id),
  foreign key (event_id, academy_id) references public.events(id, academy_id) on delete cascade,
  foreign key (player_id, academy_id) references public.players(id, academy_id) on delete cascade
);

alter table public.events add column if not exists potm_vote_open boolean not null default false;

-- ------------------------------------------------------------------- RLS
create or replace function app_private.event_team(p_event uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select e.team_id from public.events e where e.id = p_event;
$$;
grant execute on function app_private.event_team(uuid) to authenticated;

alter table public.event_player_stats enable row level security;
alter table public.potm_votes enable row level security;

drop policy if exists event_player_stats_read on public.event_player_stats;
create policy event_player_stats_read on public.event_player_stats for select to authenticated
  using ((select app_private.is_team_member(app_private.event_team(event_id)))
         or (select app_private.is_team_coach(app_private.event_team(event_id))));
drop policy if exists event_player_stats_write on public.event_player_stats;
create policy event_player_stats_write on public.event_player_stats for all to authenticated
  using ((select app_private.is_team_coach(app_private.event_team(event_id))))
  with check ((select app_private.is_team_coach(app_private.event_team(event_id))));

drop policy if exists potm_votes_mine on public.potm_votes;
create policy potm_votes_mine on public.potm_votes for select to authenticated
  using (voter_id = auth.uid() or (select app_private.is_team_coach(app_private.event_team(event_id))));
-- Votes are cast through vote_player_of_match, which checks the window.
grant select on public.event_player_stats, public.potm_votes to authenticated;
grant insert, update, delete on public.event_player_stats to authenticated;

-- ------------------------------------------------------------- notification kinds
-- (none new: the celebration is an announcement in the squad's chat, which
-- 0088's trigger already pushes)

-- ----------------------------------------------------------------- reading
-- A game's stats for the squad's people: every player, their numbers, the
-- star, and the vote — open or not, mine, and the tally once it may be seen.
drop function if exists public.event_stats(uuid);
create or replace function public.event_stats(p_event uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare
  e        public.events;
  v_coach  boolean;
  v_member boolean;
  v_closes timestamptz;
  v_open   boolean;
begin
  select * into e from public.events where id = p_event;
  if e.id is null then return null; end if;
  v_coach := coalesce(app_private.is_team_coach(e.team_id), false);
  v_member := coalesce(app_private.is_team_member(e.team_id), false);
  if not (v_coach or v_member) then
    raise exception 'that game is another squad''s' using errcode = '42501';
  end if;
  v_closes := coalesce(e.ends_at, e.starts_at + interval '2 hours') + interval '24 hours';
  v_open := e.potm_vote_open and now() >= e.starts_at and now() < v_closes;
  return jsonb_build_object(
    'event_id', e.id, 'can_edit', v_coach, 'played', e.starts_at <= now(),
    'vote_open', v_open, 'vote_enabled', e.potm_vote_open, 'vote_closes_at', v_closes,
    'vote_closed', e.potm_vote_open and now() >= v_closes,
    'my_vote', (select v.player_id from public.potm_votes v where v.event_id = p_event and v.voter_id = auth.uid()),
    'votes_cast', (select count(*) from public.potm_votes v where v.event_id = p_event),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', pl.id, 'name', pl.full_name, 'preferred_name', pl.preferred_name,
               'number', (select sn.number from public.squad_numbers sn join public.teams t on t.id = e.team_id where sn.player_id = pl.id and sn.season = t.season limit 1),
               'goals', coalesce(s.goals, 0), 'assists', coalesce(s.assists, 0), 'minutes', s.minutes,
               'potm', coalesce(s.potm, false), 'note', s.note,
               'votes', case when v_coach or (e.potm_vote_open and now() >= v_closes)
                             then (select count(*) from public.potm_votes v where v.event_id = p_event and v.player_id = pl.id) end)
             order by coalesce(s.potm, false) desc, coalesce(s.goals, 0) desc, pl.full_name)
        from public.players pl
        left join public.event_player_stats s on s.event_id = p_event and s.player_id = pl.id
       where pl.team_id = e.team_id or s.player_id is not null), '[]'::jsonb)
  );
end;
$fn$;
revoke execute on function public.event_stats(uuid) from public, anon;
grant execute on function public.event_stats(uuid) to authenticated;

-- ----------------------------------------------------------------- writing
drop function if exists public.set_player_stats(uuid, jsonb);
create or replace function public.set_player_stats(p_event uuid, p_rows jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $fn$
declare
  e public.events;
  r jsonb;
begin
  select * into e from public.events where id = p_event;
  if e.id is null or not coalesce(app_private.is_team_coach(e.team_id), false) then
    raise exception 'only the squad''s coach enters stats' using errcode = '42501';
  end if;
  if e.type not in ('match', 'tournament') then
    raise exception 'only a game has stats' using errcode = '22023';
  end if;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    if not exists (select 1 from public.players pl where pl.id = (r ->> 'player_id')::uuid and pl.academy_id = e.academy_id) then
      raise exception 'that player is not this club''s' using errcode = '22023';
    end if;
    insert into public.event_player_stats (academy_id, event_id, player_id, goals, assists, minutes, note, entered_by)
    values (e.academy_id, p_event, (r ->> 'player_id')::uuid,
            coalesce((r ->> 'goals')::integer, 0), coalesce((r ->> 'assists')::integer, 0),
            nullif(r ->> 'minutes', '')::integer, nullif(btrim(coalesce(r ->> 'note', '')), ''), auth.uid())
    on conflict (event_id, player_id) do update
      set goals = excluded.goals, assists = excluded.assists, minutes = excluded.minutes,
          note = excluded.note, entered_by = excluded.entered_by, updated_at = now();
  end loop;
  return public.event_stats(p_event);
end;
$fn$;
revoke execute on function public.set_player_stats(uuid, jsonb) from public, anon;
grant execute on function public.set_player_stats(uuid, jsonb) to authenticated;

-- The star: one per game, posted once to the squad's chat.
drop function if exists public.set_player_of_match(uuid, uuid, text);
create or replace function public.set_player_of_match(p_event uuid, p_player uuid default null, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $fn$
declare
  e        public.events;
  v_name   text;
  v_chan   uuid;
  v_body   text;
begin
  select * into e from public.events where id = p_event;
  if e.id is null or not coalesce(app_private.is_team_coach(e.team_id), false) then
    raise exception 'only the squad''s coach picks the player of the match' using errcode = '42501';
  end if;
  update public.event_player_stats set potm = false, updated_at = now() where event_id = p_event and potm;
  if p_player is null then
    return public.event_stats(p_event);
  end if;
  select pl.full_name into v_name from public.players pl where pl.id = p_player and pl.academy_id = e.academy_id;
  if v_name is null then
    raise exception 'that player is not this club''s' using errcode = '22023';
  end if;
  insert into public.event_player_stats (academy_id, event_id, player_id, potm, note, entered_by)
  values (e.academy_id, p_event, p_player, true, nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  on conflict (event_id, player_id) do update
    set potm = true, note = coalesce(excluded.note, public.event_player_stats.note), entered_by = excluded.entered_by, updated_at = now();

  -- The celebration, once per game: an announcement in the squad's chat.
  select c.id into v_chan from public.channels c
   where c.team_id = e.team_id and c.type = 'team' and c.status = 'active' limit 1;
  if v_chan is not null and not exists (
    select 1 from public.messages m where m.event_id = p_event and m.channel_id = v_chan and m.body like '🏆%' and m.deleted_at is null
  ) then
    v_body := '🏆 Player of the Match: ' || v_name
              || coalesce(' — ' || nullif(btrim(coalesce(p_note, '')), ''), '')
              || coalesce(chr(10) || e.title, '');
    insert into public.messages (academy_id, channel_id, sender_id, body, is_announcement, event_id)
    values (e.academy_id, v_chan, auth.uid(), v_body, true, p_event);
  end if;
  return public.event_stats(p_event);
end;
$fn$;
revoke execute on function public.set_player_of_match(uuid, uuid, text) from public, anon;
grant execute on function public.set_player_of_match(uuid, uuid, text) to authenticated;

drop function if exists public.open_potm_vote(uuid, boolean);
create or replace function public.open_potm_vote(p_event uuid, p_open boolean default true)
returns jsonb language plpgsql volatile security definer set search_path = public as $fn$
declare
  e public.events;
begin
  select * into e from public.events where id = p_event;
  if e.id is null or not coalesce(app_private.is_team_coach(e.team_id), false) then
    raise exception 'only the squad''s coach opens the vote' using errcode = '42501';
  end if;
  update public.events set potm_vote_open = p_open, updated_at = now() where id = p_event;
  return public.event_stats(p_event);
end;
$fn$;
revoke execute on function public.open_potm_vote(uuid, boolean) from public, anon;
grant execute on function public.open_potm_vote(uuid, boolean) to authenticated;

-- One vote per adult in the squad, from kick-off until a day after the final whistle.
drop function if exists public.vote_player_of_match(uuid, uuid);
create or replace function public.vote_player_of_match(p_event uuid, p_player uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $fn$
declare
  e        public.events;
  v_closes timestamptz;
begin
  select * into e from public.events where id = p_event;
  if e.id is null or not (coalesce(app_private.is_team_member(e.team_id), false) or coalesce(app_private.is_team_coach(e.team_id), false)) then
    raise exception 'that game is another squad''s' using errcode = '42501';
  end if;
  v_closes := coalesce(e.ends_at, e.starts_at + interval '2 hours') + interval '24 hours';
  if not e.potm_vote_open then
    raise exception 'the coach has not opened a vote for this game' using errcode = '22023';
  end if;
  if now() < e.starts_at then
    raise exception 'the vote opens at kick-off' using errcode = '22023';
  end if;
  if now() >= v_closes then
    raise exception 'the vote closed a day after the game' using errcode = '22023';
  end if;
  if not exists (select 1 from public.players pl where pl.id = p_player and pl.team_id = e.team_id) then
    raise exception 'that player is not on this squad' using errcode = '22023';
  end if;
  insert into public.potm_votes (academy_id, event_id, voter_id, player_id)
  values (e.academy_id, p_event, auth.uid(), p_player)
  on conflict (event_id, voter_id) do update set player_id = excluded.player_id, created_at = now();
  return public.event_stats(p_event);
end;
$fn$;
revoke execute on function public.vote_player_of_match(uuid, uuid) from public, anon;
grant execute on function public.vote_player_of_match(uuid, uuid) to authenticated;

-- ------------------------------------------------------------ the season
-- A child's season: games (the register, a published side, or a stats row
-- with something in it), goals, assists, minutes, stars. Who may see the
-- card may see this.
drop function if exists public.player_season_stats(uuid);
create or replace function public.player_season_stats(p_player uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
begin
  if not coalesce(app_private.may_see_card(p_player), false) then
    raise exception 'that player''s stats are not yours to see' using errcode = '42501';
  end if;
  return (
    with games as (
      select e.id, e.starts_at, e.opponent, e.our_score, e.their_score, e.title,
             coalesce(s.goals, 0) as goals, coalesce(s.assists, 0) as assists, s.minutes, coalesce(s.potm, false) as potm
        from public.events e
        left join public.event_player_stats s on s.event_id = e.id and s.player_id = p_player
       where e.type in ('match', 'tournament') and e.cancelled_at is null and e.starts_at <= now()
         and (
           exists (select 1 from public.event_attendance a where a.event_id = e.id and a.player_id = p_player and a.status in ('present', 'late'))
           or exists (select 1 from public.event_lineups l join public.event_lineup_players lp on lp.lineup_id = l.id
                       where l.event_id = e.id and l.published_at is not null and lp.player_id = p_player and lp.role in ('starting', 'bench'))
           or (s.player_id is not null and (s.goals > 0 or s.assists > 0 or coalesce(s.minutes, 0) > 0 or s.potm))
         )
    )
    select jsonb_build_object(
      'appearances', count(*), 'goals', coalesce(sum(goals), 0), 'assists', coalesce(sum(assists), 0),
      'minutes', coalesce(sum(minutes), 0), 'potm', count(*) filter (where potm),
      'games', coalesce((select jsonb_agg(jsonb_build_object('event_id', g.id, 'starts_at', g.starts_at, 'opponent', g.opponent, 'title', g.title,
                                                               'goals', g.goals, 'assists', g.assists, 'minutes', g.minutes, 'potm', g.potm,
                                                               'ours', g.our_score, 'theirs', g.their_score)
                                             order by g.starts_at desc)
                          from games g), '[]'::jsonb))
      from games
  );
end;
$fn$;
revoke execute on function public.player_season_stats(uuid) from public, anon;
grant execute on function public.player_season_stats(uuid) to authenticated;

drop function if exists public.team_season_stats(uuid);
create or replace function public.team_season_stats(p_team uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
begin
  if not (coalesce(app_private.is_team_member(p_team), false) or coalesce(app_private.is_team_coach(p_team), false)) then
    raise exception 'that squad''s stats are its own people''s' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(row order by (row ->> 'goals')::integer desc, (row ->> 'assists')::integer desc, (row ->> 'appearances')::integer desc, row ->> 'name')
      from (
        select jsonb_build_object(
                 'id', pl.id, 'name', pl.full_name, 'preferred_name', pl.preferred_name,
                 'appearances', (select count(distinct e.id) from public.events e
                                  where e.team_id = p_team and e.type in ('match', 'tournament') and e.cancelled_at is null and e.starts_at <= now()
                                    and (exists (select 1 from public.event_attendance a where a.event_id = e.id and a.player_id = pl.id and a.status in ('present', 'late'))
                                         or exists (select 1 from public.event_lineups l join public.event_lineup_players lp on lp.lineup_id = l.id
                                                     where l.event_id = e.id and l.published_at is not null and lp.player_id = pl.id and lp.role in ('starting', 'bench'))
                                         or exists (select 1 from public.event_player_stats s where s.event_id = e.id and s.player_id = pl.id and (s.goals > 0 or s.assists > 0 or coalesce(s.minutes, 0) > 0 or s.potm)))),
                 'goals', coalesce((select sum(s.goals) from public.event_player_stats s join public.events e on e.id = s.event_id where s.player_id = pl.id and e.team_id = p_team), 0),
                 'assists', coalesce((select sum(s.assists) from public.event_player_stats s join public.events e on e.id = s.event_id where s.player_id = pl.id and e.team_id = p_team), 0),
                 'potm', (select count(*) from public.event_player_stats s join public.events e on e.id = s.event_id where s.player_id = pl.id and e.team_id = p_team and s.potm)
               ) as row
          from public.players pl where pl.team_id = p_team
      ) rows), '[]'::jsonb);
end;
$fn$;
revoke execute on function public.team_season_stats(uuid) from public, anon;
grant execute on function public.team_season_stats(uuid) to authenticated;
