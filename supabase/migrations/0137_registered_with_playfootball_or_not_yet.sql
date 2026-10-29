-- 0137: registered with PlayFootball, or not yet.
--
-- R-14. Squadroom never does official registration — that is PlayFootball's
-- (CLAUDE.md Rules) — and the failure mode of nobody tracking it is a child
-- who is ineligible on a Saturday. `players.ff_number` has existed since
-- 0082 and appeared in no screen, and there was no status at all, so a club
-- learnt a child was unregistered the way it always has: from the league,
-- after the game.
--
-- A STATUS, SET BY A HUMAN. There is no API to ask (PlayFootball syncs into
-- Dribl, not into us, and we fetch nothing from Dribl), so this is a club
-- marking what it has checked. 'unknown' is the honest default for every
-- existing row: nobody has said.
--
-- A REMINDER BEFORE ROUND ONE, to the family, not the club. The club sees
-- the count on the roster every time they open it; the family is the one
-- who has to go and do it. Fourteen days before the squad's first upcoming
-- match, once a week until it is done, through the queue every other
-- notification uses. Daily, like the clearance sweep, because a kick-off
-- date is a date.

do $$ begin
  create type public.official_rego_status as enum ('unknown', 'pending', 'registered', 'not_required');
exception when duplicate_object then null; end $$;

alter table public.players
  add column if not exists official_status public.official_rego_status not null default 'unknown',
  add column if not exists official_status_at timestamptz,
  add column if not exists official_status_by uuid references public.profiles(id) on delete set null;

create or replace function public.set_official_status(
  p_player    uuid,
  p_status    public.official_rego_status,
  p_ff_number text default null
)
returns void
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_player public.players;
begin
  select * into v_player from public.players where id = p_player;
  if v_player.id is null then
    raise exception 'no such player' using errcode = '22023';
  end if;
  if not (coalesce(app_private.is_academy_staff(v_player.academy_id), false)
          or (v_player.team_id is not null
              and coalesce(app_private.is_team_coach(v_player.team_id), false))) then
    raise exception 'only a coach can record official registration' using errcode = '42501';
  end if;

  update public.players
     set official_status    = p_status,
         official_status_at = now(),
         official_status_by = auth.uid(),
         -- Only replaced when one is given; blank leaves the number alone.
         ff_number          = coalesce(nullif(btrim(p_ff_number), ''), ff_number),
         updated_at         = now()
   where id = p_player;
end;
$fn$;

revoke execute on function public.set_official_status(uuid, public.official_rego_status, text) from public, anon;
grant execute on function public.set_official_status(uuid, public.official_rego_status, text) to authenticated;

-- The kind. The whole list, as 0120 did, because a check constraint cannot
-- be extended in place.
alter table public.notification_queue
  drop constraint if exists notification_queue_kind_check;
alter table public.notification_queue
  add constraint notification_queue_kind_check
  check (kind = any (array[
    'message', 'announcement', 'event_reminder', 'poll_opened', 'poll_closing',
    'rsvp_change', 'invite', 'event_cancelled', 'event_changed', 'event_back_on',
    'rsvp_nudge', 'announcement_repeat', 'wwcc_expiring', 'guardian_erased',
    'official_rego_pending'
  ]));

create or replace function public.queue_official_rego_reminders()
returns integer
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_sent integer := 0;
begin
  with first_match as (
    -- The squad's next game that has not been called off. "Round 1" is
    -- that, from wherever the season currently stands.
    select e.team_id, min(e.starts_at) as kick_off
      from public.events e
     where e.type = 'match'
       and e.cancelled_at is null
       and e.team_id is not null
       and e.starts_at > now()
     group by e.team_id
  ),
  due as (
    select pl.id as player_id, pl.academy_id, pl.full_name, fm.kick_off,
           greatest(0, (fm.kick_off::date - current_date)) as days_left
      from public.players pl
      join first_match fm on fm.team_id = pl.team_id
     where pl.official_status in ('unknown', 'pending')
       and fm.kick_off <= now() + interval '14 days'
  ),
  recipients as (
    select d.*, pg.profile_id as tell
      from due d
      join public.player_guardians pg on pg.player_id = d.player_id
  ),
  fresh as (
    -- Once a week per child per parent. Nagging daily trains people to
    -- swipe it away, and the thing takes a day to do.
    select r.* from recipients r
     where not exists (
       select 1 from public.notification_queue n
        where n.kind = 'official_rego_pending'
          and n.profile_id = r.tell
          and n.payload->>'player_id' = r.player_id::text
          and n.created_at > now() - interval '7 days'
     )
  ),
  queued as (
    insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload)
    select
      f.academy_id,
      f.tell,
      'official_rego_pending',
      'Not yet registered with PlayFootball',
      f.full_name || ' plays ' ||
      case when f.days_left = 0 then 'today'
           when f.days_left = 1 then 'tomorrow'
           else 'in ' || f.days_left || ' days' end ||
      ' and the club has no PlayFootball registration for them. Without one they cannot take the field.',
      '/settings/family',
      jsonb_build_object('player_id', f.player_id, 'kick_off', f.kick_off)
    from fresh f
    returning 1
  )
  select count(*)::integer into v_sent from queued;

  return v_sent;
end;
$fn$;

revoke execute on function public.queue_official_rego_reminders() from public, anon, authenticated;
grant execute on function public.queue_official_rego_reminders() to service_role;

select cron.unschedule('queue-official-rego-reminders')
 where exists (select 1 from cron.job where jobname = 'queue-official-rego-reminders');

select cron.schedule(
  'queue-official-rego-reminders',
  '20 19 * * *',  -- 19:20 UTC is 06:20 in Sydney, after the clearance sweep
  $cron$select public.queue_official_rego_reminders()$cron$
);

-- my_family carries the status, so the family sees what the club has
-- recorded and the reminder's link lands somewhere that explains itself.
create or replace function public.my_family()
returns jsonb
language sql stable security definer set search_path = public as $fn$
  select coalesce(jsonb_agg(child order by child->>'full_name'), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'id',              pl.id,
               'academy_id',      pl.academy_id,
               'club',            a.name,
               'full_name',       pl.full_name,
               'preferred_name',  pl.preferred_name,
               'dob',             pl.dob,
               'gender',          pl.gender,
               'school',          pl.school,
               'ff_number',       pl.ff_number,
               'official_status', pl.official_status,
               'relationship',    pg.relationship,
               'kit', jsonb_build_object(
                 'shirt',  pl.shirt_size,
                 'shorts', pl.shorts_size,
                 'socks',  pl.socks_size
               ),
               'squad', (
                 select jsonb_build_object('id', t.id, 'name', t.name, 'season', t.season)
                   from public.teams t where t.id = pl.team_id
               ),
               'number', (
                 select sn.number
                   from public.squad_numbers sn
                  where sn.player_id = pl.id
                  order by (sn.season = (select t.season from public.teams t where t.id = pl.team_id)) desc,
                           sn.created_at desc
                  limit 1
               ),
               'medical', (
                 select jsonb_build_object(
                          'conditions',         m.conditions,
                          'allergies',          m.allergies,
                          'medications',        m.medications,
                          'dietary',            m.dietary,
                          'emergency_name',     m.emergency_name,
                          'emergency_phone',    m.emergency_phone,
                          'emergency_relation', m.emergency_relation,
                          'doctor_name',        m.doctor_name,
                          'doctor_phone',       m.doctor_phone,
                          'first_aid_consent',  m.first_aid_consent
                        )
                   from public.player_medical m where m.player_id = pl.id
               ),
               'consents', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'document_id', d.id,
                          'title',       d.title,
                          'kind',        d.kind,
                          'version',     d.version,
                          'required',    d.required,
                          'accepted',    ans.accepted,
                          'accepted_at', ans.accepted_at,
                          'mine',        ans.profile_id = auth.uid()
                        ) order by d.required desc, d.title)
                   from public.consent_documents d
                   left join lateral (
                     select ca.accepted, ca.accepted_at, ca.profile_id
                       from public.consent_acceptances ca
                      where ca.document_id = d.id and ca.player_id = pl.id
                      order by (ca.accepted = false) desc, ca.accepted_at desc
                      limit 1
                   ) ans on true
                  where d.academy_id = pl.academy_id
                    and d.published_at is not null
                    and d.retired_at is null
               ), '[]'::jsonb)
             ) as child
        from public.player_guardians pg
        join public.players pl on pl.id = pg.player_id
        join public.academies a on a.id = pl.academy_id
       where pg.profile_id = auth.uid()
    ) s;
$fn$;
