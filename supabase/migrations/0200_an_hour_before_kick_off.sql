-- 0200: an hour before kick-off.
--
-- F-07. The manager's Saturday has five things in it that are easy to
-- forget and expensive to miss: the team sheet (a late one is fined at the
-- league), the side published, the kit and the first-aid bag, the register
-- at kick-off, the score afterwards. A push an hour before kick-off names
-- what is still to do, and the game's page carries the list — the ones the
-- database can see for itself tick themselves (a sheet submitted, a side
-- published, a register taken, a score entered); the rest the coach ticks.
--
-- A game in one of our own competitions links to our sheet. A game that
-- came from a league export is somebody else's sheet: the item says so and
-- the coach ticks it when it is done there. We never link into Dribl.

create table if not exists public.event_checklist_ticks (
  academy_id  uuid not null references public.academies(id) on delete cascade,
  event_id    uuid not null,
  item        text not null check (item in ('sheet', 'lineup', 'kit', 'register', 'score')),
  ticked_by   uuid references public.profiles(id) on delete set null,
  ticked_at   timestamptz not null default now(),
  primary key (event_id, item),
  foreign key (event_id, academy_id) references public.events(id, academy_id) on delete cascade
);
alter table public.event_checklist_ticks enable row level security;
drop policy if exists event_checklist_ticks_coach on public.event_checklist_ticks;
create policy event_checklist_ticks_coach on public.event_checklist_ticks for all to authenticated
  using ((select app_private.is_team_coach((select e.team_id from public.events e where e.id = event_id))))
  with check ((select app_private.is_team_coach((select e.team_id from public.events e where e.id = event_id))));
grant select, insert, update, delete on public.event_checklist_ticks to authenticated;

-- ------------------------------------------------------------- notification kinds
do $$
declare
  v_name text;
begin
  select conname into v_name from pg_constraint
   where conrelid = 'public.notification_queue'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) like '%kind = ANY%';
  if v_name is not null then
    execute format('alter table public.notification_queue drop constraint %I', v_name);
  end if;
  alter table public.notification_queue add constraint notification_queue_kind_check check (kind = any (array[
    'message','announcement','event_reminder','poll_opened','poll_closing','rsvp_change','invite',
    'event_cancelled','event_changed','event_back_on','rsvp_nudge','announcement_repeat','wwcc_expiring',
    'guardian_erased','official_rego_pending','reregister_nudge','offer','referee_appointment',
    'referee_response','referee_withdrawn','fixture_change_proposed','fixture_change_answered',
    'fixture_change_decided','mention','match_correction_requested','match_correction_decided',
    'fixture_flowing_open','discipline_warning','discipline_suspension','forfeit_request','forfeit_decided',
    'nomination','fee_due','fee_overdue','player_report','player_clip','selected','not_selected','match_day']));
end $$;

-- ------------------------------------------------------------------ the list
-- The five items with what the database already knows. Coaches of the
-- squad only; nothing for a parent, and nothing for training.
create or replace function app_private.event_checklist_items(p_event uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare
  e        public.events;
  v_entry  uuid;
  v_sheet  public.match_sheets;
  v_ours   boolean;
  v_lineup timestamptz;
  v_reg    boolean;
  v_score  boolean;
  tick     record;
  v_items  jsonb := '[]'::jsonb;
  v_done   boolean;
  v_label  text;
  v_href   text;
  v_hint   text;
begin
  select * into e from public.events where id = p_event;
  if e.id is null or e.type <> 'match' then return '[]'::jsonb; end if;
  v_ours := e.fixture_id is not null;
  if v_ours then
    select ce.id into v_entry from public.competition_entries ce
     where ce.competition_id = e.competition_id and ce.team_id = e.team_id limit 1;
    select * into v_sheet from public.match_sheets s where s.fixture_id = e.fixture_id and s.entry_id = v_entry;
  end if;
  select l.published_at into v_lineup from public.event_lineups l where l.event_id = p_event;
  v_reg := exists (select 1 from public.event_attendance a where a.event_id = p_event);
  v_score := e.our_score is not null or (v_sheet.id is not null and v_sheet.our_score is not null);

  for tick in
    select * from (values
      ('sheet', 1), ('lineup', 2), ('kit', 3), ('register', 4), ('score', 5)
    ) as t(item, ord) order by ord
  loop
    v_href := null; v_hint := null;
    case tick.item
      when 'sheet' then
        if v_ours then
          v_label := 'Submit the team sheet';
          v_done := v_sheet.submitted_at is not null;
          v_href := '/competitions/' || e.competition_id || '/match/' || e.fixture_id;
          v_hint := case when v_done then 'Submitted ' || to_char(v_sheet.submitted_at at time zone 'Australia/Sydney', 'FMHH12:MI am') else 'Before the sheet locks' end;
        else
          v_label := 'Submit the team sheet at the league';
          v_done := null;   -- the coach ticks it; we never reach into Dribl
          v_hint := 'A late sheet is fined. Tick it here once it is in.';
        end if;
      when 'lineup' then
        v_label := 'Publish the side';
        v_done := v_lineup is not null;
        v_hint := case when v_done then 'The families have been told' else 'Tells each selected family their spot, meet time and kit' end;
      when 'kit' then
        v_label := 'Kit, balls, bibs, first-aid bag';
        v_done := null;
      when 'register' then
        v_label := 'Take the register at kick-off';
        v_done := v_reg;
        v_hint := case when v_done then 'Taken' else 'Who actually came — the register opens at kick-off' end;
      when 'score' then
        v_label := 'Enter the score';
        v_done := v_score;
        v_href := case when v_ours then '/competitions/' || e.competition_id || '/match/' || e.fixture_id end;
    end case;
    v_items := v_items || jsonb_build_object(
      'item', tick.item, 'label', v_label, 'hint', v_hint, 'href', v_href,
      'auto', v_done is not null,
      'done', coalesce(v_done, exists (select 1 from public.event_checklist_ticks t where t.event_id = p_event and t.item = tick.item)),
      'ticked_by', (select pr.full_name from public.event_checklist_ticks t join public.profiles pr on pr.id = t.ticked_by where t.event_id = p_event and t.item = tick.item),
      'ticked_at', (select t.ticked_at from public.event_checklist_ticks t where t.event_id = p_event and t.item = tick.item));
  end loop;
  return v_items;
end;
$fn$;

drop function if exists public.event_checklist(uuid);
create or replace function public.event_checklist(p_event uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare
  v_team uuid;
begin
  select e.team_id into v_team from public.events e where e.id = p_event;
  if v_team is null or not coalesce(app_private.is_team_coach(v_team), false) then
    raise exception 'only the squad''s coach has a match-day list' using errcode = '42501';
  end if;
  return app_private.event_checklist_items(p_event);
end;
$fn$;
revoke execute on function public.event_checklist(uuid) from public, anon;
grant execute on function public.event_checklist(uuid) to authenticated;

drop function if exists public.tick_checklist(uuid, text, boolean);
create or replace function public.tick_checklist(p_event uuid, p_item text, p_done boolean default true)
returns jsonb language plpgsql volatile security definer set search_path = public as $fn$
declare
  e public.events;
begin
  select * into e from public.events where id = p_event;
  if e.id is null or not coalesce(app_private.is_team_coach(e.team_id), false) then
    raise exception 'only the squad''s coach has a match-day list' using errcode = '42501';
  end if;
  if p_item not in ('sheet', 'lineup', 'kit', 'register', 'score') then
    raise exception 'that is not on the list' using errcode = '22023';
  end if;
  if p_done then
    insert into public.event_checklist_ticks (academy_id, event_id, item, ticked_by)
    values (e.academy_id, p_event, p_item, auth.uid())
    on conflict (event_id, item) do update set ticked_by = excluded.ticked_by, ticked_at = now();
  else
    delete from public.event_checklist_ticks where event_id = p_event and item = p_item;
  end if;
  return app_private.event_checklist_items(p_event);
end;
$fn$;
revoke execute on function public.tick_checklist(uuid, text, boolean) from public, anon;
grant execute on function public.tick_checklist(uuid, text, boolean) to authenticated;

-- ------------------------------------------------------------------ the push
-- Every ten minutes: games kicking off in the next 50–70 minutes, each
-- coach of the squad told once what is still to do. Nothing for a
-- cancelled game, nothing for training, nothing for a parent.
create or replace function public.queue_match_day_pushes()
returns integer language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_n integer := 0;
  r   record;
  v_items jsonb;
  v_todo  text[];
  v_tz    text;
begin
  for r in
    select e.*, t.name as team_name
      from public.events e
      join public.teams t on t.id = e.team_id
     where e.type = 'match' and e.cancelled_at is null and e.private_to is null
       and e.starts_at > now() + interval '50 minutes' and e.starts_at <= now() + interval '70 minutes'
  loop
    v_items := app_private.event_checklist_items(r.id);
    select coalesce(array_agg(i ->> 'label' order by ord), '{}') into v_todo
      from jsonb_array_elements(v_items) with ordinality as x(i, ord)
     where not (i ->> 'done')::boolean and (i ->> 'item') <> 'score';
    select coalesce(a.timezone, 'Australia/Sydney') into v_tz from public.academies a where a.id = r.academy_id;
    insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload, dedupe_key)
    select r.academy_id, tm.profile_id, 'match_day',
           r.team_name || coalesce(' v ' || r.opponent, '') || ' kicks off at ' || to_char(r.starts_at at time zone v_tz, 'FMHH12:MI am'),
           case when coalesce(array_length(v_todo, 1), 0) = 0 then 'Everything on the match-day list is done. Good luck.'
                else 'Still to do: ' || array_to_string(v_todo, ' · ') end,
           '/calendar/' || r.id,
           jsonb_build_object('event_id', r.id, 'todo', to_jsonb(v_todo)),
           'matchday:' || r.id || ':' || tm.profile_id
      from public.team_members tm
     where tm.team_id = r.team_id and tm.role = 'coach'
    on conflict (dedupe_key) do nothing;
    get diagnostics v_n = row_count;
  end loop;
  return v_n;
end;
$fn$;
revoke execute on function public.queue_match_day_pushes() from public, anon, authenticated;

select cron.unschedule('queue-match-day')
 where exists (select 1 from cron.job where jobname = 'queue-match-day');
select cron.schedule(
  'queue-match-day',
  '*/10 * * * *',
  $cron$select public.queue_match_day_pushes()$cron$
);
