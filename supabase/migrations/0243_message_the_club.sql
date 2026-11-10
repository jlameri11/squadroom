-- 0243: Message the club.
--
-- Big Club Mode item 4 (Joey, 9 Nov 2026): "Admin → 'Message the club':
-- write once; audience = Whole club · Stream(s) · Age group(s) · Team(s) ·
-- Staff only · Unpaid · Not yet re-registered · PlayFootball not done. Shows
-- 'This will reach 1,240 people' before sending. Push + in-app + email.
-- Pin, 'until' date. 'Seen by X of Y' + one-tap re-ping of unseen. Who can
-- send: President/Secretary (anyone), Registrar/Treasurer (their filters),
-- coordinators (their groups), managers (their team). Fan-out queued in
-- batches; never blocks the sender. Quiet hours and digest respected;
-- 'urgent' only for safety and call-offs." Core — no switch.
--
-- Shape: a club_messages row is the message; its recipients are worked out
-- ONCE, when it is sent, from the audience (a cheap insert, two thousand
-- rows in milliseconds) — and the pushes are made by a worker a minute at a
-- time, five hundred a pass, so the sender's tap returns at once and the
-- queue never sees a two-thousand-row transaction. Seen is per recipient;
-- the re-ping goes to the unseen, once a day.

create table if not exists public.club_messages (
  id              uuid primary key default gen_random_uuid(),
  academy_id      uuid not null references public.academies(id) on delete cascade,
  sender_id       uuid references public.profiles(id) on delete set null,
  body            text not null check (length(btrim(body)) between 1 and 4000),
  audience        jsonb not null default '{"kind":"club"}'::jsonb,
  recipient_count integer not null default 0,
  pinned          boolean not null default false,
  relevant_until  timestamptz,
  urgent          boolean not null default false,
  attachments     jsonb not null default '[]'::jsonb,
  status          text not null default 'queued' check (status in ('queued', 'sending', 'sent')),
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);
create index if not exists club_messages_academy_idx on public.club_messages (academy_id, created_at desc);
alter table public.club_messages enable row level security;
grant select on public.club_messages to authenticated;

create table if not exists public.club_message_recipients (
  message_id  uuid not null references public.club_messages(id) on delete cascade,
  academy_id  uuid not null references public.academies(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  notified_at timestamptz,
  seen_at     timestamptz,
  primary key (message_id, profile_id)
);
create index if not exists club_message_recipients_profile_idx on public.club_message_recipients (profile_id, message_id);
create index if not exists club_message_recipients_pending_idx on public.club_message_recipients (message_id) where notified_at is null;
alter table public.club_message_recipients enable row level security;
grant select on public.club_message_recipients to authenticated;

drop policy if exists club_messages_select on public.club_messages;
create policy club_messages_select on public.club_messages for select to authenticated
  using (
    exists (select 1 from public.club_message_recipients r where r.message_id = club_messages.id and r.profile_id = (select auth.uid()))
    or (select app_private.may_run_club(academy_id, 'comms'))
  );
drop policy if exists club_message_recipients_select on public.club_message_recipients;
create policy club_message_recipients_select on public.club_message_recipients for select to authenticated
  using (profile_id = (select auth.uid()) or (select app_private.may_run_club(academy_id, 'comms')));
-- Written by send_club_message, the worker and mark_club_message_seen only.

-- ============================================================= the audience

-- Who a message to this audience reaches. The kinds:
--   club          every active member
--   streams       everyone on the teams in these streams (ids)
--   age_groups    everyone on the teams in these age groups (age_groups)
--   teams         everyone on these teams (ids)
--   staff         owners, admins, coaches, and every club-role holder
--   unpaid        the families (and adult players) who owe a fee
--   unregistered  the families of last season's players not yet back
--   playfootball  the families of players whose PlayFootball is not done
-- "Everyone on a team" is its team_members (coaches and families) plus the
-- guardians of its players and the adult players themselves (0239).
create or replace function app_private.club_message_people(p_academy uuid, p_audience jsonb)
returns table (profile_id uuid)
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_kind text := coalesce(p_audience->>'kind', 'club');
begin
  return query
  with ids as (
    select nullif(x, '')::uuid as id from jsonb_array_elements_text(coalesce(p_audience->'ids', '[]'::jsonb)) x
  ),
  groups as (
    select x as age_group from jsonb_array_elements_text(coalesce(p_audience->'age_groups', '[]'::jsonb)) x
  ),
  teams_in as (
    select t.id from public.teams t
     where t.academy_id = p_academy and t.status = 'active'
       and ((v_kind = 'teams' and t.id in (select id from ids))
            or (v_kind = 'streams' and t.stream_id in (select id from ids))
            or (v_kind = 'age_groups' and t.age_group in (select age_group from groups)))
  ),
  team_people as (
    select tm.profile_id from public.team_members tm where tm.team_id in (select id from teams_in)
    union
    select pg.profile_id from public.player_guardians pg join public.players p on p.id = pg.player_id where p.team_id in (select id from teams_in)
    union
    select p.profile_id from public.players p where p.team_id in (select id from teams_in) and p.profile_id is not null
  ),
  players_in as (
    select p.id from public.players p
      join public.teams t on t.id = p.team_id and t.status = 'active'
     where p.academy_id = p_academy
       and (
         (v_kind = 'playfootball' and p.official_status = 'pending')
         or (v_kind = 'unregistered' and (
               exists (select 1 from public.offers o where o.player_id = p.id and o.kind = 'returning' and o.status = 'open' and o.expires_at > now())
               or not exists (select 1 from public.program_registrations pr
                               join public.programs pg2 on pg2.id = pr.program_id
                              where pr.player_id = p.id and pr.status in ('pending', 'approved') and pg2.season = t.season)))
       )
  ),
  owing as (
    select o.player_id from public.outstanding_fees(p_academy) o where v_kind = 'unpaid' and o.outstanding_cents > 0
  ),
  family as (
    select pg.profile_id from public.player_guardians pg where pg.player_id in (select id from players_in union select player_id from owing)
    union
    select p.profile_id from public.players p where p.id in (select id from players_in union select player_id from owing) and p.profile_id is not null
  ),
  everyone as (
    select am.profile_id from public.academy_members am where am.academy_id = p_academy and am.status = 'active' and v_kind = 'club'
    union
    select tp.profile_id from team_people tp where v_kind in ('teams', 'streams', 'age_groups')
    union
    select am.profile_id from public.academy_members am
     where am.academy_id = p_academy and am.status = 'active' and v_kind = 'staff' and am.roles && array['owner', 'admin', 'coach']::public.academy_role[]
    union
    select r.profile_id from public.club_roles r where r.academy_id = p_academy and v_kind = 'staff'
    union
    select f.profile_id from family f where v_kind in ('unpaid', 'unregistered', 'playfootball')
  )
  select distinct e.profile_id from everyone e
   where e.profile_id is not null
     and exists (select 1 from public.academy_members m where m.academy_id = p_academy and m.profile_id = e.profile_id and m.status = 'active');
end;
$fn$;
revoke execute on function app_private.club_message_people(uuid, jsonb) from public, anon, authenticated;

-- May this person send to this audience here? The brief's rule.
create or replace function app_private.may_message_audience(p_academy uuid, p_audience jsonb)
returns boolean
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_kind text := coalesce(p_audience->>'kind', 'club');
  v_roles public.club_role[];
begin
  if auth.uid() is null then return false; end if;
  if coalesce(app_private.is_academy_staff(p_academy), false) then return true; end if;
  v_roles := app_private.club_roles_of(p_academy);
  if v_roles && array['president', 'secretary']::public.club_role[] then return true; end if;
  if v_kind = 'unpaid' and 'treasurer' = any (v_roles) then return true; end if;
  if v_kind in ('unregistered', 'playfootball') and 'registrar' = any (v_roles) then return true; end if;
  if v_kind = 'teams' and v_roles && array['coordinator', 'team_manager']::public.club_role[] then
    return not exists (
      select 1 from jsonb_array_elements_text(coalesce(p_audience->'ids', '[]'::jsonb)) x
       where not app_private.runs_team(nullif(x, '')::uuid, true));
  end if;
  if v_kind = 'streams' and 'coordinator' = any (v_roles) then
    return not exists (
      select 1 from jsonb_array_elements_text(coalesce(p_audience->'ids', '[]'::jsonb)) x
       where not exists (select 1 from public.club_roles r where r.academy_id = p_academy and r.profile_id = auth.uid()
                           and r.role = 'coordinator' and r.scope_kind = 'stream' and r.stream_id = nullif(x, '')::uuid));
  end if;
  if v_kind = 'age_groups' and 'coordinator' = any (v_roles) then
    return not exists (
      select 1 from jsonb_array_elements_text(coalesce(p_audience->'age_groups', '[]'::jsonb)) x
       where not exists (select 1 from public.club_roles r where r.academy_id = p_academy and r.profile_id = auth.uid()
                           and r.role = 'coordinator' and r.scope_kind = 'age_group' and r.age_group = x));
  end if;
  return false;
end;
$fn$;
revoke execute on function app_private.may_message_audience(uuid, jsonb) from public, anon, authenticated;

-- "This will reach 1,240 people" — before sending.
create or replace function public.preview_club_message(p_academy uuid, p_audience jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_count integer;
begin
  if not app_private.may_message_audience(p_academy, p_audience) then
    return jsonb_build_object('allowed', false, 'count', 0);
  end if;
  select count(*) into v_count from app_private.club_message_people(p_academy, p_audience) p where p.profile_id <> auth.uid();
  return jsonb_build_object('allowed', true, 'count', coalesce(v_count, 0));
end;
$fn$;

-- Send: the message row and its recipients, at once; the pushes by the
-- worker. Urgent (quiet hours ignored) is the owners', the President's and
-- the Secretary's — for safety and call-offs.
create or replace function public.send_club_message(
  p_academy  uuid,
  p_body     text,
  p_audience jsonb default '{"kind":"club"}'::jsonb,
  p_pinned   boolean default false,
  p_until    timestamptz default null,
  p_urgent   boolean default false
) returns uuid
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_id uuid;
  v_count integer;
begin
  if auth.uid() is null or not app_private.may_message_audience(p_academy, p_audience) then
    raise exception 'that audience is not yours to message' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_body, ''))) = 0 then
    raise exception 'nothing to send' using errcode = '22023';
  end if;
  if p_urgent and not (coalesce(app_private.is_academy_staff(p_academy), false) or app_private.may_run_club(p_academy, 'club')) then
    raise exception 'urgent is for safety and call-offs, sent by those who run the club' using errcode = '42501';
  end if;

  insert into public.club_messages (academy_id, sender_id, body, audience, pinned, relevant_until, urgent)
  values (p_academy, auth.uid(), btrim(p_body), coalesce(p_audience, '{"kind":"club"}'::jsonb), coalesce(p_pinned, false), p_until, coalesce(p_urgent, false))
  returning id into v_id;

  insert into public.club_message_recipients (message_id, academy_id, profile_id)
  select v_id, p_academy, p.profile_id from app_private.club_message_people(p_academy, p_audience) p
   where p.profile_id <> auth.uid()
  on conflict do nothing;
  get diagnostics v_count = row_count;
  update public.club_messages set recipient_count = v_count, status = case when v_count = 0 then 'sent' else 'queued' end,
         sent_at = case when v_count = 0 then now() end
   where id = v_id;

  perform app_private.log_activity(p_academy, 'message.sent', 'message', v_id, left(btrim(p_body), 80),
    jsonb_build_object('audience', p_audience->>'kind', 'recipients', v_count, 'urgent', coalesce(p_urgent, false)));
  return v_id;
end;
$fn$;

-- The worker: every minute, up to five hundred pushes per message, until
-- every recipient has one. Quiet hours hold an ordinary message until the
-- morning in the club's time zone; an urgent one goes now.
create or replace function public.fan_out_club_messages()
returns integer
language plpgsql volatile security definer set search_path = public as $fn$
declare
  m record;
  v_done integer := 0;
  v_batch integer;
begin
  for m in
    select cm.*, a.name as club, a.timezone, coalesce(p.full_name, 'The club') as sender
      from public.club_messages cm
      join public.academies a on a.id = cm.academy_id
      left join public.profiles p on p.id = cm.sender_id
     where cm.status in ('queued', 'sending')
     order by cm.urgent desc, cm.created_at
     limit 20
  loop
    with batch as (
      select r.profile_id from public.club_message_recipients r
       where r.message_id = m.id and r.notified_at is null
       order by r.profile_id
       limit 500
    ),
    queued as (
      insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload, scheduled_for, dedupe_key)
      select m.academy_id, b.profile_id, 'announcement',
             m.club,
             left(m.body, 140),
             '/messages/' || m.id::text,
             jsonb_build_object('club_message_id', m.id, 'urgent', m.urgent),
             case
               when m.urgent then now()
               when coalesce(us.quiet_hours_enabled, false)
                and (public.zone_time(coalesce(m.timezone, 'Australia/Sydney')) >= us.quiet_hours_start
                     or public.zone_time(coalesce(m.timezone, 'Australia/Sydney')) < us.quiet_hours_end)
                 then ((current_date + 1) + us.quiet_hours_end) at time zone coalesce(m.timezone, 'Australia/Sydney')
               else now()
             end,
             'club:' || m.id::text || ':' || b.profile_id::text
        from batch b
        left join public.user_settings us on us.profile_id = b.profile_id
      on conflict (dedupe_key) do nothing
      returning profile_id
    )
    update public.club_message_recipients r
       set notified_at = now()
      from batch b
     where r.message_id = m.id and r.profile_id = b.profile_id;
    get diagnostics v_batch = row_count;
    v_done := v_done + v_batch;
    if not exists (select 1 from public.club_message_recipients r where r.message_id = m.id and r.notified_at is null) then
      update public.club_messages set status = 'sent', sent_at = coalesce(sent_at, now()) where id = m.id;
    else
      update public.club_messages set status = 'sending' where id = m.id and status = 'queued';
    end if;
  end loop;
  return v_done;
end;
$fn$;
revoke execute on function public.fan_out_club_messages() from public, anon, authenticated;

select cron.unschedule('fan-out-club-messages') where exists (select 1 from cron.job where jobname = 'fan-out-club-messages');
select cron.schedule(
  'fan-out-club-messages',
  '* * * * *',
  $cron$select public.fan_out_club_messages()$cron$
);

-- ============================================================== reading

-- What has been sent to me here: pinned first, then newest; a message with
-- an "until" that has passed drops away.
create or replace function public.my_club_messages(p_academy uuid)
returns jsonb
language sql stable security definer set search_path = public as $fn$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'body', m.body, 'pinned', m.pinned, 'relevant_until', m.relevant_until,
           'urgent', m.urgent, 'created_at', m.created_at, 'sender_name', coalesce(p.full_name, 'The club'),
           'seen_at', r.seen_at, 'attachments', m.attachments)
         order by m.pinned desc, m.created_at desc), '[]'::jsonb)
    from public.club_message_recipients r
    join public.club_messages m on m.id = r.message_id
    left join public.profiles p on p.id = m.sender_id
   where r.profile_id = auth.uid() and r.academy_id = p_academy
     and (m.relevant_until is null or m.relevant_until > now());
$fn$;

create or replace function public.mark_club_message_seen(p_message uuid)
returns void
language sql volatile security definer set search_path = public as $fn$
  update public.club_message_recipients set seen_at = coalesce(seen_at, now())
   where message_id = p_message and profile_id = auth.uid();
$fn$;

-- The sender's side: what went, to whom, and how many have seen it.
create or replace function public.club_messages_sent(p_academy uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
begin
  if auth.uid() is null or not app_private.may_run_club(p_academy, 'comms') then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', m.id, 'body', m.body, 'audience', m.audience, 'pinned', m.pinned, 'relevant_until', m.relevant_until,
             'urgent', m.urgent, 'status', m.status, 'created_at', m.created_at, 'sent_at', m.sent_at,
             'sender_name', coalesce(p.full_name, 'The club'),
             'recipients', m.recipient_count,
             'seen', (select count(*) from public.club_message_recipients r where r.message_id = m.id and r.seen_at is not null),
             'notified', (select count(*) from public.club_message_recipients r where r.message_id = m.id and r.notified_at is not null))
           order by m.created_at desc)
      from public.club_messages m
      left join public.profiles p on p.id = m.sender_id
     where m.academy_id = p_academy), '[]'::jsonb);
end;
$fn$;

-- One tap: the unseen hear it again — once a day per message.
create or replace function public.reping_club_message(p_message uuid)
returns integer
language plpgsql volatile security definer set search_path = public as $fn$
declare
  m public.club_messages;
  v_club text;
  n integer;
begin
  select * into m from public.club_messages where id = p_message;
  if m.id is null or auth.uid() is null or not app_private.may_run_club(m.academy_id, 'comms') then
    raise exception 'not yours to send again' using errcode = '42501';
  end if;
  select name into v_club from public.academies where id = m.academy_id;
  insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload, scheduled_for, dedupe_key)
  select m.academy_id, r.profile_id, 'announcement_repeat', v_club || ' · still unread', left(m.body, 140),
         '/messages/' || m.id::text, jsonb_build_object('club_message_id', m.id), now(),
         'clubreping:' || m.id::text || ':' || r.profile_id::text || ':' || current_date::text
    from public.club_message_recipients r
   where r.message_id = m.id and r.seen_at is null and r.notified_at is not null
  on conflict (dedupe_key) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$fn$;

-- ================================================================= grants

revoke execute on function public.preview_club_message(uuid, jsonb) from public, anon;
grant execute on function public.preview_club_message(uuid, jsonb) to authenticated;
revoke execute on function public.send_club_message(uuid, text, jsonb, boolean, timestamptz, boolean) from public, anon;
grant execute on function public.send_club_message(uuid, text, jsonb, boolean, timestamptz, boolean) to authenticated;
revoke execute on function public.my_club_messages(uuid) from public, anon;
grant execute on function public.my_club_messages(uuid) to authenticated;
revoke execute on function public.mark_club_message_seen(uuid) from public, anon;
grant execute on function public.mark_club_message_seen(uuid) to authenticated;
revoke execute on function public.club_messages_sent(uuid) from public, anon;
grant execute on function public.club_messages_sent(uuid) to authenticated;
revoke execute on function public.reping_club_message(uuid) from public, anon;
grant execute on function public.reping_club_message(uuid) to authenticated;
