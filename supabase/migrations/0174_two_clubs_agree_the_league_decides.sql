-- 0174: two clubs agree, the league decides.
--
-- W-07 (and the request half of L-23). A game needs moving — a bus, a
-- clash, a ground closed — and today that is a phone call to the other
-- club and an email to the league. Now the club proposes a new time or
-- ground on the fixture, the other club agrees or declines, and only then
-- does the league approve (the game moves, through reschedule_fixture, so
-- every family hears) or reject. A notes thread sits on the request so the
-- two managers talk there, not in a channel full of children. The league
-- sees every request; a club sees its own; a parent sees none.
--
-- And the overdue-fee block, where a club turns it on: a family with a
-- fee past due cannot say YES to a game or training until it is paid.
-- 'No' and 'maybe' are always allowed — the club wants to know either
-- way — and a coach marking attendance for a family is never blocked.

do $$ begin
  create type public.change_request_status as enum ('proposed', 'agreed', 'declined', 'approved', 'rejected', 'withdrawn');
exception when duplicate_object then null; end $$;

create table if not exists public.fixture_change_requests (
  id                  uuid primary key default gen_random_uuid(),
  competition_id      uuid not null references public.competitions(id) on delete cascade,
  fixture_id          uuid not null references public.fixtures(id) on delete cascade,
  by_entry_id         uuid not null references public.competition_entries(id) on delete cascade,
  other_entry_id      uuid references public.competition_entries(id) on delete cascade,
  proposed_starts_at  timestamptz,
  proposed_venue      text,
  proposed_field      text,
  reason              text not null check (length(btrim(reason)) > 0),
  status              public.change_request_status not null default 'proposed',
  proposed_by         uuid references public.profiles(id) on delete set null,
  answered_by         uuid references public.profiles(id) on delete set null,
  answered_at         timestamptz,
  answer_note         text,
  decided_by          uuid references public.profiles(id) on delete set null,
  decided_at          timestamptz,
  decision_note       text,
  created_at          timestamptz not null default now(),
  constraint fixture_change_requests_something check (proposed_starts_at is not null or proposed_venue is not null or proposed_field is not null)
);
alter table public.fixture_change_requests enable row level security;
create policy fixture_change_requests_select on public.fixture_change_requests for select to authenticated
  using ((select app_private.may_run(fixture_change_requests.competition_id, 'grounds'))
         or (select app_private.can_manage_entry(fixture_change_requests.by_entry_id))
         or (other_entry_id is not null and (select app_private.can_manage_entry(fixture_change_requests.other_entry_id))));
create index if not exists fixture_change_requests_fixture_idx on public.fixture_change_requests (fixture_id, status);

create table if not exists public.fixture_change_notes (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.fixture_change_requests(id) on delete cascade,
  author_id   uuid not null references public.profiles(id) on delete cascade,
  body        text not null check (length(btrim(body)) > 0),
  created_at  timestamptz not null default now()
);
alter table public.fixture_change_notes enable row level security;
create policy fixture_change_notes_select on public.fixture_change_notes for select to authenticated
  using (exists (select 1 from public.fixture_change_requests r where r.id = fixture_change_notes.request_id));

-- Who to tell at a club: its staff and the entered team's coaches.
create or replace function app_private.entry_managers(p_entry uuid)
returns setof uuid language sql stable security definer set search_path = public as $fn$
  select m.profile_id from public.competition_entries e
    join public.academy_members m on m.academy_id = e.academy_id and m.status = 'active' and m.role in ('owner', 'admin')
   where e.id = p_entry
  union
  select tm.profile_id from public.competition_entries e
    join public.team_members tm on tm.team_id = e.team_id and tm.role = 'coach'
   where e.id = p_entry and e.team_id is not null;
$fn$;

create or replace function app_private.change_request_push(p_request uuid, p_to uuid, p_kind text, p_title text, p_body text)
returns void language plpgsql security definer set search_path = public as $fn$
declare
  v_req public.fixture_change_requests;
  v_org uuid;
begin
  select * into v_req from public.fixture_change_requests where id = p_request;
  select organiser_id into v_org from public.competitions where id = v_req.competition_id;
  insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload, dedupe_key)
  values (v_org, p_to, p_kind, p_title, p_body, '/competitions/' || v_req.competition_id,
          jsonb_build_object('request_id', p_request, 'fixture_id', v_req.fixture_id),
          'fxchg-' || p_request || '-' || p_to || '-' || p_kind || '-' || extract(epoch from now())::bigint);
end;
$fn$;

alter table public.notification_queue
  drop constraint if exists notification_queue_kind_check;
alter table public.notification_queue
  add constraint notification_queue_kind_check
  check (kind = any (array[
    'message', 'announcement', 'event_reminder', 'poll_opened', 'poll_closing',
    'rsvp_change', 'invite', 'event_cancelled', 'event_changed', 'event_back_on',
    'rsvp_nudge', 'announcement_repeat', 'wwcc_expiring', 'guardian_erased',
    'official_rego_pending', 'reregister_nudge', 'offer',
    'referee_appointment', 'referee_response', 'referee_withdrawn',
    'fixture_change_proposed', 'fixture_change_answered', 'fixture_change_decided'
  ]));

create or replace function public.propose_fixture_change(
  p_fixture uuid, p_reason text, p_starts_at timestamptz default null, p_venue text default null, p_field text default null
)
returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  v_fx public.fixtures;
  v_mine uuid;
  v_other uuid;
  v_id uuid;
  v_who uuid;
  v_home text; v_away text;
begin
  select * into v_fx from public.fixtures where id = p_fixture;
  if v_fx.id is null then raise exception 'no such game' using errcode = '22023'; end if;
  if coalesce(app_private.can_manage_entry(v_fx.home_entry_id), false) then
    v_mine := v_fx.home_entry_id; v_other := v_fx.away_entry_id;
  elsif coalesce(app_private.can_manage_entry(v_fx.away_entry_id), false) then
    v_mine := v_fx.away_entry_id; v_other := v_fx.home_entry_id;
  else
    raise exception 'only a manager of one of the teams proposes a change' using errcode = '42501';
  end if;
  if v_fx.status not in ('scheduled', 'postponed') then
    raise exception 'that game is %', v_fx.status using errcode = '22023';
  end if;
  if exists (select 1 from public.fixture_change_requests r where r.fixture_id = p_fixture and r.status in ('proposed', 'agreed')) then
    raise exception 'there is already a change proposed for this game' using errcode = '23505';
  end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'say why' using errcode = '22023';
  end if;
  insert into public.fixture_change_requests (competition_id, fixture_id, by_entry_id, other_entry_id, proposed_starts_at, proposed_venue, proposed_field, reason, proposed_by)
  values (v_fx.competition_id, p_fixture, v_mine, v_other, p_starts_at, nullif(btrim(coalesce(p_venue, '')), ''), nullif(btrim(coalesce(p_field, '')), ''), btrim(p_reason), auth.uid())
  returning id into v_id;

  select h.display_name, a.display_name into v_home, v_away
    from public.fixtures f left join public.competition_entries h on h.id = f.home_entry_id left join public.competition_entries a on a.id = f.away_entry_id
   where f.id = p_fixture;
  if v_other is not null then
    for v_who in select * from app_private.entry_managers(v_other) loop
      perform app_private.change_request_push(v_id, v_who, 'fixture_change_proposed',
        (select display_name from public.competition_entries where id = v_mine) || ' want to move ' || coalesce(v_home, '?') || ' v ' || coalesce(v_away, '?'),
        coalesce(to_char(p_starts_at at time zone 'Australia/Sydney', 'FMDay FMDD Mon, FMHH12:MIam'), 'same time') || coalesce(' · ' || p_venue, '') || ' — ' || btrim(p_reason));
    end loop;
  end if;
  return v_id;
end;
$fn$;

create or replace function public.answer_fixture_change(p_request uuid, p_agree boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_req public.fixture_change_requests;
  v_who uuid;
begin
  select * into v_req from public.fixture_change_requests where id = p_request;
  if v_req.id is null or v_req.other_entry_id is null or not coalesce(app_private.can_manage_entry(v_req.other_entry_id), false) then
    raise exception 'only the other team answers a change' using errcode = '42501';
  end if;
  if v_req.status <> 'proposed' then
    raise exception 'already %', v_req.status using errcode = '22023';
  end if;
  update public.fixture_change_requests
     set status = case when p_agree then 'agreed' else 'declined' end::public.change_request_status,
         answered_by = auth.uid(), answered_at = now(), answer_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_request;
  for v_who in select * from app_private.entry_managers(v_req.by_entry_id) loop
    perform app_private.change_request_push(p_request, v_who, 'fixture_change_answered',
      (select display_name from public.competition_entries where id = v_req.other_entry_id) || case when p_agree then ' agree to the move' else ' can''t do that time' end,
      coalesce(nullif(btrim(coalesce(p_note, '')), ''), case when p_agree then 'The league decides next.' else 'Propose another.' end));
  end loop;
end;
$fn$;

create or replace function public.decide_fixture_change(p_request uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_req public.fixture_change_requests;
  v_who uuid;
  v_fx public.fixtures;
begin
  select * into v_req from public.fixture_change_requests where id = p_request;
  if v_req.id is null or not app_private.may_run(v_req.competition_id, 'grounds') then
    raise exception 'only the league decides a change' using errcode = '42501';
  end if;
  if v_req.status not in ('proposed', 'agreed') then
    raise exception 'already %', v_req.status using errcode = '22023';
  end if;
  if p_approve and v_req.status <> 'agreed' and v_req.other_entry_id is not null then
    raise exception 'the other team has not agreed yet' using errcode = '22023';
  end if;
  if p_approve then
    select * into v_fx from public.fixtures where id = v_req.fixture_id;
    -- The ordinary reschedule, so the mirror and every family's push happen.
    perform public.reschedule_fixture(v_req.fixture_id, coalesce(v_req.proposed_starts_at, v_fx.starts_at),
                                      coalesce(v_req.proposed_venue, v_fx.venue_label), coalesce(v_req.proposed_field, v_fx.field_label));
  end if;
  update public.fixture_change_requests
     set status = case when p_approve then 'approved' else 'rejected' end::public.change_request_status,
         decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_request;
  for v_who in select * from app_private.entry_managers(v_req.by_entry_id) union select * from app_private.entry_managers(v_req.other_entry_id) loop
    perform app_private.change_request_push(p_request, v_who, 'fixture_change_decided',
      case when p_approve then 'The league moved the game' else 'The league kept the game as drawn' end,
      coalesce(nullif(btrim(coalesce(p_note, '')), ''), ''));
  end loop;
end;
$fn$;

create or replace function public.withdraw_fixture_change(p_request uuid)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_req public.fixture_change_requests;
begin
  select * into v_req from public.fixture_change_requests where id = p_request;
  if v_req.id is null or not coalesce(app_private.can_manage_entry(v_req.by_entry_id), false) then
    raise exception 'only the team that proposed it withdraws it' using errcode = '42501';
  end if;
  if v_req.status not in ('proposed', 'agreed') then
    raise exception 'already %', v_req.status using errcode = '22023';
  end if;
  update public.fixture_change_requests set status = 'withdrawn' where id = p_request;
end;
$fn$;

create or replace function public.add_fixture_change_note(p_request uuid, p_body text)
returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  v_req public.fixture_change_requests;
  v_id uuid;
begin
  select * into v_req from public.fixture_change_requests where id = p_request;
  if v_req.id is null or not (app_private.may_run(v_req.competition_id, 'grounds')
      or coalesce(app_private.can_manage_entry(v_req.by_entry_id), false)
      or (v_req.other_entry_id is not null and coalesce(app_private.can_manage_entry(v_req.other_entry_id), false))) then
    raise exception 'not your conversation' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_body, ''))) = 0 then
    raise exception 'say something' using errcode = '22023';
  end if;
  insert into public.fixture_change_notes (request_id, author_id, body) values (p_request, auth.uid(), btrim(p_body)) returning id into v_id;
  return v_id;
end;
$fn$;

-- What this person may see: the league everything; a club its own games.
create or replace function public.fixture_change_requests(p_competition uuid)
returns jsonb
language sql stable security definer set search_path = public as $fn$
  select coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', r.id, 'fixture_id', r.fixture_id, 'status', r.status, 'reason', r.reason,
             'home', h.display_name, 'away', a.display_name, 'division', f.division, 'round', f.round,
             'starts_at', f.starts_at, 'venue', coalesce(v.name, f.venue_label), 'field', f.field_label,
             'proposed_starts_at', r.proposed_starts_at, 'proposed_venue', r.proposed_venue, 'proposed_field', r.proposed_field,
             'by', b.display_name, 'other', o.display_name,
             'mine', coalesce(app_private.can_manage_entry(r.by_entry_id), false),
             'theirs', r.other_entry_id is not null and coalesce(app_private.can_manage_entry(r.other_entry_id), false),
             'league', app_private.may_run(r.competition_id, 'grounds'),
             'answer_note', r.answer_note, 'answered_at', r.answered_at, 'decision_note', r.decision_note, 'decided_at', r.decided_at,
             'created_at', r.created_at,
             'notes', coalesce((select jsonb_agg(jsonb_build_object('body', n.body, 'author', p.full_name, 'at', n.created_at) order by n.created_at)
                                  from public.fixture_change_notes n join public.profiles p on p.id = n.author_id where n.request_id = r.id), '[]'::jsonb)
           ) order by (r.status in ('proposed', 'agreed')) desc, r.created_at desc)
      from public.fixture_change_requests r
      join public.fixtures f on f.id = r.fixture_id
      left join public.venues v on v.id = f.venue_id
      left join public.competition_entries h on h.id = f.home_entry_id
      left join public.competition_entries a on a.id = f.away_entry_id
      left join public.competition_entries b on b.id = r.by_entry_id
      left join public.competition_entries o on o.id = r.other_entry_id
     where r.competition_id = p_competition
       and (app_private.may_run(r.competition_id, 'grounds')
            or coalesce(app_private.can_manage_entry(r.by_entry_id), false)
            or (r.other_entry_id is not null and coalesce(app_private.can_manage_entry(r.other_entry_id), false)))
  ), '[]'::jsonb);
$fn$;

-- ---------------------------------------------------------------------
-- The overdue-fee block
-- ---------------------------------------------------------------------
alter table public.academies
  add column if not exists block_rsvp_when_overdue boolean not null default false,
  add column if not exists overdue_grace_days integer not null default 14 check (overdue_grace_days between 0 and 365);

-- Any instalment this person's children owe this club that fell due more
-- than the grace period ago and is not paid. Asked as the person.
create or replace function app_private.family_overdue(p_academy uuid, p_profile uuid)
returns boolean
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_grace integer;
  r record;
  v_quote jsonb;
  s jsonb;
begin
  select overdue_grace_days into v_grace from public.academies where id = p_academy;
  for r in
    select pr.id as request_id, pl.id as player_id
      from public.payment_requests pr
      join public.players pl on pl.academy_id = pr.academy_id and (pr.team_id is null or pl.team_id = pr.team_id)
      join public.player_guardians pg on pg.player_id = pl.id and pg.profile_id = p_profile
     where pr.academy_id = p_academy and pr.archived_at is null and pr.per_player
       and coalesce(pr.due_on, pr.created_at::date) < current_date - coalesce(v_grace, 14)
  loop
    v_quote := public.quote_payment(r.request_id, r.player_id);
    if v_quote is null then continue; end if;
    for s in select * from jsonb_array_elements(v_quote->'schedule') loop
      if (s->>'due_on')::date < current_date - coalesce(v_grace, 14) and coalesce(s->>'status', 'unpaid') <> 'paid' then
        return true;
      end if;
    end loop;
  end loop;
  return false;
end;
$fn$;

create or replace function public.rsvp_overdue_gate()
returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  v_on boolean;
begin
  if new.status <> 'yes' or new.profile_id <> auth.uid() then
    return new;
  end if;
  select block_rsvp_when_overdue into v_on from public.academies where id = new.academy_id;
  if coalesce(v_on, false) and app_private.family_overdue(new.academy_id, new.profile_id) then
    raise exception 'A fee for your family is overdue. Pay it under Payments, then say yes.' using errcode = '23514';
  end if;
  return new;
end;
$fn$;
drop trigger if exists event_rsvps_overdue_gate on public.event_rsvps;
create trigger event_rsvps_overdue_gate
  before insert or update of status on public.event_rsvps
  for each row execute function public.rsvp_overdue_gate();

grant execute on function public.propose_fixture_change(uuid, text, timestamptz, text, text) to authenticated;
grant execute on function public.answer_fixture_change(uuid, boolean, text) to authenticated;
grant execute on function public.decide_fixture_change(uuid, boolean, text) to authenticated;
grant execute on function public.withdraw_fixture_change(uuid) to authenticated;
grant execute on function public.add_fixture_change_note(uuid, text) to authenticated;
grant execute on function public.fixture_change_requests(uuid) to authenticated;
