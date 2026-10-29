-- 0140: a trial ends in an offer.
--
-- R-13. A trial existed only as a value of program_kind, treated exactly
-- like a camp: register, approve, done. What a trial actually produces is a
-- decision per child — a squad place, the waitlist, or no — and the one
-- that matters, the offer, had nowhere to live. Clubs made it by text
-- message and chased the fee by text message.
--
-- AN OFFER IS A DATED, PRE-APPROVED PLACE. The coach offers a trialist a
-- place in a specific squad program; the family accepts and pays, or
-- declines, or lets it lapse. Accepting creates the squad registration
-- already APPROVED — the coach decided when they offered, and making the
-- family wait in a queue they have already been through is the thing
-- offers exist to skip — and puts the child in the squad, so the chat and
-- the fixtures follow at once (0098). The fee is then the squad program's
-- own (0126), through the one checkout.
--
-- IT EXPIRES. A place offered and never answered is a place nobody else can
-- be offered, and "we never heard back" is how a club loses the next child
-- on the list. Lapsed is computed from the date, not swept by a cron.
--
-- Only the coach can make one, only the family can answer it, and nobody
-- writes the table directly.

do $$ begin
  create type public.offer_status as enum ('open', 'accepted', 'declined');
exception when duplicate_object then null; end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'program_registrations_id_academy_key') then
    alter table public.program_registrations
      add constraint program_registrations_id_academy_key unique (id, academy_id);
  end if;
end $$;

create table if not exists public.offers (
  id                    uuid primary key default gen_random_uuid(),
  academy_id            uuid not null references public.academies(id) on delete cascade,
  trial_registration_id uuid not null,
  player_id             uuid not null,
  squad_program_id      uuid not null,
  expires_at            timestamptz not null,
  status                public.offer_status not null default 'open',
  decided_at            timestamptz,
  -- The squad registration made when it was accepted.
  registration_id       uuid,
  created_by            uuid references public.profiles(id) on delete set null,
  created_at            timestamptz not null default now(),

  constraint offers_id_academy_key unique (id, academy_id),
  constraint offers_trial_registration_fkey foreign key (trial_registration_id, academy_id)
    references public.program_registrations (id, academy_id) on delete cascade,
  constraint offers_player_fkey foreign key (player_id, academy_id)
    references public.players (id, academy_id) on delete cascade,
  constraint offers_squad_program_fkey foreign key (squad_program_id, academy_id)
    references public.programs (id, academy_id) on delete cascade,
  -- One offer per trialist per squad program. Making it again extends it.
  constraint offers_once unique (trial_registration_id, squad_program_id)
);

alter table public.offers enable row level security;

-- Read: the family, and the club's coaches. Write: nobody directly.
create policy offers_select on public.offers for select to authenticated
  using (
    (select app_private.is_guardian_of(offers.player_id))
    or (select app_private.is_academy_coach(offers.academy_id))
  );

create index if not exists offers_player_idx on public.offers (player_id);
create index if not exists offers_trial_idx on public.offers (trial_registration_id);

/** 'open' until the date, then 'lapsed'; accepted and declined stay what they are. */
create or replace function app_private.offer_state(p_status public.offer_status, p_expires timestamptz)
returns text
language sql immutable as $fn$
  select case when p_status = 'open' and p_expires < now() then 'lapsed' else p_status::text end;
$fn$;

alter table public.notification_queue
  drop constraint if exists notification_queue_kind_check;
alter table public.notification_queue
  add constraint notification_queue_kind_check
  check (kind = any (array[
    'message', 'announcement', 'event_reminder', 'poll_opened', 'poll_closing',
    'rsvp_change', 'invite', 'event_cancelled', 'event_changed', 'event_back_on',
    'rsvp_nudge', 'announcement_repeat', 'wwcc_expiring', 'guardian_erased',
    'official_rego_pending', 'reregister_nudge', 'offer'
  ]));

create or replace function public.make_offer(p_registration uuid, p_squad_program uuid, p_days integer default 7)
returns uuid
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_me    uuid := auth.uid();
  v_reg   public.program_registrations;
  v_trial public.programs;
  v_squad public.programs;
  v_id    uuid;
  v_days  integer := coalesce(p_days, 7);
begin
  select * into v_reg from public.program_registrations where id = p_registration;
  if v_reg.id is null then
    raise exception 'no such registration' using errcode = '22023';
  end if;
  if not coalesce(app_private.is_academy_coach(v_reg.academy_id), false) then
    raise exception 'only a coach can offer a place' using errcode = '42501';
  end if;
  select * into v_trial from public.programs where id = v_reg.program_id;
  if v_trial.kind <> 'trial' then
    raise exception 'offers come out of a trial, and % is a %', v_trial.name, v_trial.kind using errcode = '22023';
  end if;
  if v_reg.status <> 'approved' then
    raise exception 'they have to have been in the trial first' using errcode = '22023';
  end if;
  select * into v_squad from public.programs
   where id = p_squad_program and academy_id = v_reg.academy_id;
  if v_squad.id is null or v_squad.kind <> 'squad' then
    raise exception 'a place has to be in a squad program' using errcode = '22023';
  end if;
  if v_squad.status <> 'open' then
    raise exception '% is not open', v_squad.name using errcode = '22023';
  end if;
  if v_days < 1 or v_days > 60 then
    raise exception 'an offer lasts between one and sixty days' using errcode = '22023';
  end if;

  insert into public.offers (academy_id, trial_registration_id, player_id, squad_program_id, expires_at, created_by)
  values (v_reg.academy_id, v_reg.id, v_reg.player_id, v_squad.id, now() + make_interval(days => v_days), v_me)
  on conflict (trial_registration_id, squad_program_id)
  do update set expires_at = excluded.expires_at,
                status = case when public.offers.status = 'accepted' then 'accepted' else 'open' end,
                decided_at = case when public.offers.status = 'accepted' then public.offers.decided_at else null end,
                created_by = excluded.created_by
  returning id into v_id;

  -- Every guardian, through the queue. The link is the offer page.
  insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload)
  select v_reg.academy_id, pg.profile_id, 'offer',
         (select split_part(pl.full_name, ' ', 1) from public.players pl where pl.id = v_reg.player_id)
           || ' has been offered a place',
         v_squad.name || ' — accept by ' ||
           to_char((now() + make_interval(days => v_days)) at time zone 'Australia/Sydney', 'FMDay FMDD Mon'),
         '/offer/' || v_id,
         jsonb_build_object('offer_id', v_id, 'player_id', v_reg.player_id)
    from public.player_guardians pg
   where pg.player_id = v_reg.player_id;

  return v_id;
end;
$fn$;

create or replace function public.my_offers()
returns jsonb
language sql stable security definer set search_path = public as $fn$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',             o.id,
           'player_id',      o.player_id,
           'player',         pl.full_name,
           'squad_program',  sp.name,
           'squad_program_id', sp.id,
           'squad',          (select t.name from public.teams t where t.id = sp.team_id),
           'trial',          tp.name,
           'fee_cents',      (select pr.amount_cents from public.payment_requests pr where pr.program_id = sp.id and pr.archived_at is null limit 1),
           'expires_at',     o.expires_at,
           'state',          app_private.offer_state(o.status, o.expires_at),
           'decided_at',     o.decided_at,
           'registration_id', o.registration_id
         ) order by o.expires_at), '[]'::jsonb)
    from public.offers o
    join public.players pl on pl.id = o.player_id
    join public.programs sp on sp.id = o.squad_program_id
    join public.program_registrations tr on tr.id = o.trial_registration_id
    join public.programs tp on tp.id = tr.program_id
   where exists (select 1 from public.player_guardians pg where pg.player_id = o.player_id and pg.profile_id = auth.uid());
$fn$;

create or replace function public.accept_offer(p_offer uuid)
returns jsonb
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_me    uuid := auth.uid();
  v_offer public.offers;
  v_squad public.programs;
  v_reg   uuid;
  v_state text;
  v_fee   uuid;
begin
  select * into v_offer from public.offers where id = p_offer;
  if v_offer.id is null or not coalesce(app_private.is_guardian_of(v_offer.player_id), false) then
    raise exception 'that offer is not yours to answer' using errcode = '42501';
  end if;
  v_state := app_private.offer_state(v_offer.status, v_offer.expires_at);
  if v_state = 'lapsed' then
    raise exception 'this offer has lapsed — ask the club whether the place is still there' using errcode = '22023';
  end if;
  if v_state <> 'open' then
    raise exception 'this offer was already %', v_state using errcode = '22023';
  end if;
  select * into v_squad from public.programs where id = v_offer.squad_program_id;
  if v_squad.status <> 'open' then
    raise exception '% has closed', v_squad.name using errcode = '22023';
  end if;

  -- Pre-approved: the coach decided when they offered.
  insert into public.program_registrations (academy_id, program_id, player_id, submitted_by, status, note)
  values (v_offer.academy_id, v_squad.id, v_offer.player_id, v_me, 'approved', 'From an offer after trials')
  returning id into v_reg;
  -- 0083's capacity trigger may have waitlisted it. An offered place that
  -- turns out not to exist is the club's mistake, and the family should not
  -- be told "accepted" for a seat on the bench. Raising rolls everything back.
  if (select status from public.program_registrations where id = v_reg) <> 'approved' then
    raise exception 'the squad is full — the club offered a place it no longer has' using errcode = '22023';
  end if;

  -- Into the squad, so the chat and fixtures follow.
  if v_squad.team_id is not null then
    update public.players set team_id = v_squad.team_id, updated_at = now() where id = v_offer.player_id;
  end if;

  update public.offers
     set status = 'accepted', decided_at = now(), registration_id = v_reg
   where id = p_offer;

  select pr.id into v_fee from public.payment_requests pr
   where pr.program_id = v_squad.id and pr.archived_at is null
   limit 1;

  return jsonb_build_object('registration_id', v_reg, 'payment_request_id', v_fee, 'player_id', v_offer.player_id);
end;
$fn$;

create or replace function public.decline_offer(p_offer uuid)
returns void
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_offer public.offers;
begin
  select * into v_offer from public.offers where id = p_offer;
  if v_offer.id is null or not coalesce(app_private.is_guardian_of(v_offer.player_id), false) then
    raise exception 'that offer is not yours to answer' using errcode = '42501';
  end if;
  if app_private.offer_state(v_offer.status, v_offer.expires_at) <> 'open' then
    raise exception 'this offer is no longer open' using errcode = '22023';
  end if;
  update public.offers set status = 'declined', decided_at = now() where id = p_offer;
end;
$fn$;

/** The coach's view of a trial: every offer made from it, with its state. */
create or replace function public.trial_offers(p_program uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_academy uuid;
begin
  select academy_id into v_academy from public.programs where id = p_program;
  if v_academy is null or not coalesce(app_private.is_academy_coach(v_academy), false) then
    raise exception 'only a coach can see this' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id',                    o.id,
             'trial_registration_id', o.trial_registration_id,
             'player_id',             o.player_id,
             'squad_program',         sp.name,
             'squad_program_id',      sp.id,
             'expires_at',            o.expires_at,
             'state',                 app_private.offer_state(o.status, o.expires_at)
           ) order by o.created_at)
      from public.offers o
      join public.program_registrations tr on tr.id = o.trial_registration_id
      join public.programs sp on sp.id = o.squad_program_id
     where tr.program_id = p_program
  ), '[]'::jsonb);
end;
$fn$;

revoke execute on function public.make_offer(uuid, uuid, integer) from public, anon;
revoke execute on function public.my_offers() from public, anon;
revoke execute on function public.accept_offer(uuid) from public, anon;
revoke execute on function public.decline_offer(uuid) from public, anon;
revoke execute on function public.trial_offers(uuid) from public, anon;
grant execute on function public.make_offer(uuid, uuid, integer) to authenticated;
grant execute on function public.my_offers() to authenticated;
grant execute on function public.accept_offer(uuid) to authenticated;
grant execute on function public.decline_offer(uuid) to authenticated;
grant execute on function public.trial_offers(uuid) to authenticated;
