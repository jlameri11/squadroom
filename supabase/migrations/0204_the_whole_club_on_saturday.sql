-- 0204: the whole club on Saturday, and how it felt.
--
-- X-07 and X-11.
--
--   the table  Every squad's season on one screen — played, won, drawn,
--              lost, goals, the last five as letters — the club
--              championship Dribl buries, read by anyone in the club.
--   the pulse  After the game, one tap from each family: how was today?
--              😀 😐 🙁 and a word if they want. Only the coaches see it,
--              with the family's name, because a sad face is the start of
--              a phone call, not a statistic.

create table if not exists public.event_pulse (
  academy_id  uuid not null references public.academies(id) on delete cascade,
  event_id    uuid not null,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  mood        smallint not null check (mood between 1 and 3),   -- 3 happy, 2 so-so, 1 not great
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (event_id, profile_id),
  foreign key (event_id, academy_id) references public.events(id, academy_id) on delete cascade
);
alter table public.event_pulse enable row level security;
drop policy if exists event_pulse_mine on public.event_pulse;
create policy event_pulse_mine on public.event_pulse for select to authenticated
  using (profile_id = auth.uid() or (select app_private.is_team_coach(app_private.event_team(event_id))));
-- Written only through pulse_in.
grant select on public.event_pulse to authenticated;

drop function if exists public.pulse_in(uuid, integer, text);
create or replace function public.pulse_in(p_event uuid, p_mood integer, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $fn$
declare
  e public.events;
begin
  select * into e from public.events where id = p_event;
  if e.id is null or not (coalesce(app_private.is_team_member(e.team_id), false) or coalesce(app_private.is_team_coach(e.team_id), false)) then
    raise exception 'that game is another squad''s' using errcode = '42501';
  end if;
  if p_mood not in (1, 2, 3) then
    raise exception 'a pulse is 1, 2 or 3' using errcode = '22023';
  end if;
  if e.type not in ('match', 'tournament') or e.starts_at > now() then
    raise exception 'how was today — after the game' using errcode = '22023';
  end if;
  insert into public.event_pulse (academy_id, event_id, profile_id, mood, note)
  values (e.academy_id, p_event, auth.uid(), p_mood, nullif(btrim(coalesce(p_note, '')), ''))
  on conflict (event_id, profile_id) do update
    set mood = excluded.mood, note = excluded.note, updated_at = now();
  return jsonb_build_object('mood', p_mood, 'note', nullif(btrim(coalesce(p_note, '')), ''));
end;
$fn$;
revoke execute on function public.pulse_in(uuid, integer, text) from public, anon;
grant execute on function public.pulse_in(uuid, integer, text) to authenticated;

-- Mine, for the family; everyone's, with names, for the coaches.
drop function if exists public.event_pulse_view(uuid);
create or replace function public.event_pulse_view(p_event uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare
  e       public.events;
  v_coach boolean;
begin
  select * into e from public.events where id = p_event;
  if e.id is null then return null; end if;
  v_coach := coalesce(app_private.is_team_coach(e.team_id), false);
  if not (v_coach or coalesce(app_private.is_team_member(e.team_id), false)) then
    raise exception 'that game is another squad''s' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'can_answer', e.type in ('match', 'tournament') and e.starts_at <= now() and e.cancelled_at is null,
    'is_coach', v_coach,
    'mine', (select jsonb_build_object('mood', p.mood, 'note', p.note) from public.event_pulse p where p.event_id = p_event and p.profile_id = auth.uid()),
    'summary', case when v_coach then jsonb_build_object(
      'happy', (select count(*) from public.event_pulse p where p.event_id = p_event and p.mood = 3),
      'so_so', (select count(*) from public.event_pulse p where p.event_id = p_event and p.mood = 2),
      'not_great', (select count(*) from public.event_pulse p where p.event_id = p_event and p.mood = 1),
      'answers', coalesce((select jsonb_agg(jsonb_build_object('name', pr.full_name, 'mood', p.mood, 'note', p.note, 'at', p.updated_at) order by p.mood, p.updated_at desc)
                            from public.event_pulse p join public.profiles pr on pr.id = p.profile_id where p.event_id = p_event), '[]'::jsonb)) end
  );
end;
$fn$;
revoke execute on function public.event_pulse_view(uuid) from public, anon;
grant execute on function public.event_pulse_view(uuid) to authenticated;

-- ------------------------------------------------------------- the table
drop function if exists public.academy_results(uuid);
create or replace function public.academy_results(p_academy uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
begin
  if not coalesce(app_private.is_academy_member(p_academy), false) then
    raise exception 'that club''s results are its own people''s' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(row order by (row ->> 'age_group'), row ->> 'name')
      from (
        select jsonb_build_object(
                 'team_id', t.id, 'name', t.name, 'age_group', t.age_group, 'season', t.season,
                 'played', count(e.id), 'won', count(*) filter (where e.our_score > e.their_score),
                 'drawn', count(*) filter (where e.our_score = e.their_score),
                 'lost', count(*) filter (where e.our_score < e.their_score),
                 'gf', coalesce(sum(e.our_score), 0), 'ga', coalesce(sum(e.their_score), 0),
                 'last', coalesce((select jsonb_agg(x.o order by x.starts_at desc) from (
                            select e2.starts_at, case when e2.our_score > e2.their_score then 'W' when e2.our_score < e2.their_score then 'L' else 'D' end as o
                              from public.events e2
                             where e2.team_id = t.id and e2.type in ('match', 'tournament') and e2.cancelled_at is null
                               and e2.our_score is not null and e2.their_score is not null
                             order by e2.starts_at desc limit 5) x), '[]'::jsonb),
                 'latest', (select jsonb_build_object('event_id', e3.id, 'opponent', e3.opponent, 'ours', e3.our_score, 'theirs', e3.their_score, 'starts_at', e3.starts_at)
                              from public.events e3
                             where e3.team_id = t.id and e3.type in ('match', 'tournament') and e3.cancelled_at is null
                               and e3.our_score is not null and e3.their_score is not null
                             order by e3.starts_at desc limit 1)
               ) as row
          from public.teams t
          left join public.events e on e.team_id = t.id and e.type in ('match', 'tournament') and e.cancelled_at is null
                                    and e.our_score is not null and e.their_score is not null
         where t.academy_id = p_academy and t.status = 'active'
         group by t.id
      ) rows), '[]'::jsonb);
end;
$fn$;
revoke execute on function public.academy_results(uuid) from public, anon;
grant execute on function public.academy_results(uuid) to authenticated;
