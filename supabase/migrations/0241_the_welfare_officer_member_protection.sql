-- 0241: the Welfare officer (Member Protection).
--
-- Joey, 10 Nov 2026, Part A fix 4: "Admin → People → Roles → 'Welfare
-- officer (Member Protection)' — appoint in one tap; shown on every family's
-- Settings as the club's safeguarding contact; reports go to them and the
-- President only."
--
-- The appointment is the club role (0236) and the safeguarding_officers row
-- it writes (0108), so every existing screen and policy follows. What
-- changes here: who reads a report — the officers and the President; the
-- owner only while nobody is appointed, so a report is never unread (0108's
-- reason) — and that a report, when filed, is TOLD to them (a push, kind
-- 'report_filed'); the family's Settings get the officer's name and a
-- message button, and a parent may message the officer whatever the club's
-- direct-message setting says about parents.

-- Who reads reports: the appointed officers, the President; the owner only
-- while nobody is appointed.
create or replace function app_private.is_safeguarding_officer(p_academy uuid)
returns boolean
language sql stable security definer set search_path = public as $fn$
  select coalesce(
    exists (
      select 1 from public.safeguarding_officers o
       where o.academy_id = p_academy and o.profile_id = auth.uid()
    )
    or app_private.has_club_role(p_academy, 'welfare_officer')
    or app_private.has_club_role(p_academy, 'president')
    or (app_private.academy_role_of(p_academy) = 'owner'
        and not exists (select 1 from public.safeguarding_officers o where o.academy_id = p_academy)),
    false
  );
$fn$;

-- The people a report goes to (for the push and the family's Settings card).
create or replace function app_private.welfare_people(p_academy uuid)
returns table (profile_id uuid, standing text)
language sql stable security definer set search_path = public as $fn$
  with officers as (
    select o.profile_id, 'officer'::text as standing from public.safeguarding_officers o where o.academy_id = p_academy
  ),
  presidents as (
    select r.profile_id, 'president'::text from public.club_roles r where r.academy_id = p_academy and r.role = 'president'
  ),
  owners as (
    select m.profile_id, 'owner'::text from public.academy_members m
     where m.academy_id = p_academy and m.status = 'active' and 'owner' = any (m.roles)
       and not exists (select 1 from officers)
  )
  select distinct on (x.profile_id) x.profile_id, x.standing
    from (select * from officers union all select * from presidents union all select * from owners) x
   order by x.profile_id, case x.standing when 'officer' then 1 when 'president' then 2 else 3 end;
$fn$;
revoke execute on function app_private.welfare_people(uuid) from public, anon, authenticated;

-- Every family's Settings: who the club's welfare contact is, by name.
create or replace function public.welfare_contacts(p_academy uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
begin
  if auth.uid() is null or not app_private.is_academy_member(p_academy) then
    return null;
  end if;
  return jsonb_build_object(
    'officers', coalesce((
      select jsonb_agg(jsonb_build_object('profile_id', w.profile_id, 'name', coalesce(p.full_name, 'Unnamed'), 'role', 'Welfare officer (Member Protection)') order by p.full_name)
        from app_private.welfare_people(p_academy) w join public.profiles p on p.id = w.profile_id
       where w.standing = 'officer'), '[]'::jsonb),
    'president', coalesce((
      select jsonb_agg(jsonb_build_object('profile_id', w.profile_id, 'name', coalesce(p.full_name, 'Unnamed'),
                                          'role', case w.standing when 'president' then 'President' else 'Owner' end) order by p.full_name)
        from app_private.welfare_people(p_academy) w join public.profiles p on p.id = w.profile_id
       where w.standing <> 'officer'), '[]'::jsonb),
    'can_message', true);
end;
$fn$;
revoke execute on function public.welfare_contacts(uuid) from public, anon;
grant execute on function public.welfare_contacts(uuid) to authenticated;

-- A report, filed, is told to the people it is for.
do $$ begin
  alter table public.notification_queue drop constraint if exists notification_queue_kind_check;
  alter table public.notification_queue add constraint notification_queue_kind_check check (kind = any (array[
    'message', 'announcement', 'event_reminder', 'poll_opened', 'poll_closing', 'rsvp_change', 'invite',
    'event_cancelled', 'event_changed', 'event_back_on', 'rsvp_nudge', 'announcement_repeat', 'wwcc_expiring',
    'guardian_erased', 'official_rego_pending', 'reregister_nudge', 'offer', 'referee_appointment',
    'referee_response', 'referee_withdrawn', 'fixture_change_proposed', 'fixture_change_answered',
    'fixture_change_decided', 'mention', 'match_correction_requested', 'match_correction_decided',
    'fixture_flowing_open', 'discipline_warning', 'discipline_suspension', 'forfeit_request', 'forfeit_decided',
    'nomination', 'fee_due', 'fee_overdue', 'player_report', 'player_clip', 'selected', 'not_selected',
    'match_day', 'support_reply', 'match_video', 'match_photos', 'photo_hidden', 'helpers_wanted',
    'helper_reminder', 'helper_changed', 'report_filed']));
end $$;

create or replace function app_private.tell_welfare_of_report()
returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  v_title text := case tg_table_name when 'conduct_reports' then 'A concern was reported' else 'A message was reported' end;
  v_url text := '/admin/safeguarding';
begin
  insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload, scheduled_for, dedupe_key)
  select new.academy_id, w.profile_id, 'report_filed', v_title,
         'For the Welfare officer and the President. Open it when you can; it is seen by nobody else.',
         v_url,
         jsonb_build_object('report', tg_table_name, 'id', new.id),
         now(),
         'report:' || tg_table_name || ':' || new.id::text || ':' || w.profile_id::text
    from app_private.welfare_people(new.academy_id) w
   where w.profile_id is distinct from new.reported_by
  on conflict (dedupe_key) do nothing;
  return null;
end;
$fn$;
revoke execute on function app_private.tell_welfare_of_report() from public, anon, authenticated;
drop trigger if exists message_reports_tell_welfare on public.message_reports;
create trigger message_reports_tell_welfare
  after insert on public.message_reports
  for each row execute function app_private.tell_welfare_of_report();
drop trigger if exists conduct_reports_tell_welfare on public.conduct_reports;
create trigger conduct_reports_tell_welfare
  after insert on public.conduct_reports
  for each row execute function app_private.tell_welfare_of_report();

-- A parent may message the Welfare officer whatever the club's setting
-- about parents messaging: the officer is reachable like staff (from 0038_direct_messages.sql).
create or replace function public.open_direct_channel(
  p_academy uuid,
  p_other   uuid
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me     uuid := auth.uid();
  v_key    text;
  v_id     uuid;
  v_policy public.dm_policy;
  v_me_staff    boolean;
  v_other_staff boolean;
begin
  if v_me is null then
    raise exception 'must be signed in' using errcode = '42501';
  end if;
  if p_other = v_me then
    raise exception 'you cannot message yourself' using errcode = '22023';
  end if;

  if not app_private.is_academy_member(p_academy) then
    raise exception 'not a member of this academy' using errcode = '42501';
  end if;

  -- The other person must be in the same academy. Otherwise this becomes a
  -- way to message anyone whose id you happen to learn.
  if not exists (
    select 1 from public.academy_members
     where academy_id = p_academy and profile_id = p_other and status = 'active'
  ) then
    raise exception 'that person is not in this academy' using errcode = '22023';
  end if;

  select dm_policy into v_policy from public.academies where id = p_academy;

  -- 0241: the Welfare officer is reachable like staff, whatever the setting.
  select role in ('owner','admin','coach')
         or exists (select 1 from public.safeguarding_officers o where o.academy_id = p_academy and o.profile_id = v_me)
    into v_me_staff
    from public.academy_members where academy_id = p_academy and profile_id = v_me;
  select role in ('owner','admin','coach')
         or exists (select 1 from public.safeguarding_officers o where o.academy_id = p_academy and o.profile_id = p_other)
    into v_other_staff
    from public.academy_members where academy_id = p_academy and profile_id = p_other;

  -- staff_only means at least one end of the conversation is staff. Two
  -- parents cannot open one; a parent and their coach can.
  if v_policy = 'staff_only' and not (coalesce(v_me_staff,false) or coalesce(v_other_staff,false)) then
    raise exception 'this academy does not allow parents to message each other directly'
      using errcode = '42501';
  end if;

  v_key := least(v_me::text, p_other::text) || ':' || greatest(v_me::text, p_other::text);

  select id into v_id from public.channels
   where academy_id = p_academy and type = 'direct' and dm_key = v_key;

  if v_id is null then
    insert into public.channels (academy_id, type, dm_key, name, created_by)
    values (p_academy, 'direct', v_key, null, v_me)
    returning id into v_id;

    insert into public.channel_members (academy_id, channel_id, profile_id, role)
    values (p_academy, v_id, v_me, 'member'), (p_academy, v_id, p_other, 'member');
  end if;

  return v_id;
end;
$$;
