-- 0221: last season's players are offered their places.
--
-- R-20, the Notice of Offer (SQUADI_INTEL §6B.18; extends R-12 and R-13).
-- After a rollover every returning child is already in next season's squad
-- (0197), and "re-registered" means an approved registration in its program.
-- The only way there was the form: the family found the program, filled it
-- in, and waited in the queue for the club to approve a child the club had
-- itself just put in the squad. Clubs on Squadi send a Notice of Offer.
--
-- AN OFFER, NOT A FORM. The club sends every returning child not yet
-- registered a dated offer of their place (offer_returning_places). The
-- family accepts in two taps — the registration is made approved, as a trial
-- offer's is (0140), and the fee follows through the one checkout — or says
-- no. 0140's table takes it with one change: an offer comes out of a trial OR
-- is for a returning player (kind), so trial_registration_id is no longer
-- required.
--
-- AN OPEN OFFER HOLDS ITS PLACE. Rollover opens next season's programs at
-- once, and a returning child has no registration until the family answers,
-- so a newcomer could fill the squad while a family was still reading the
-- offer. An open offer now counts against the places left for anyone else
-- (program_spots_left, and the 0083 guard), trial offers included — "a
-- dated, pre-approved place" (0140) was the promise all along. Among offers
-- it is first to answer, first in: an offer holds a place against newcomers,
-- never against another offer, or a club that offers fourteen children
-- twelve places would find that nobody could accept.
--
-- THE CLUB'S PLACING STANDS. The plan puts children where the club wants
-- them — kept down a year, moved up one — while the program's birth years
-- are worked out from the age group. So an offered place bends the birth
-- years and the program's dates (returning families are asked before the
-- program opens to the public; that is the point), as staff adding a child
-- always could. Gender does not bend.
--
-- PLAYFOOTBALL FIRST STILL HOLDS (0162). Where the program requires it and
-- the club has not confirmed the child's official registration, accepting
-- holds the place as a PENDING registration, the club approves it once
-- PlayFootball has, and no fee is taken before then.
--
-- SAYING NO MEANS LEAVING. A returning family that declines is telling the
-- club the child will not be back: they come off the squad, so the place is
-- free and nobody picks them for a game. The chat is left as the move tool
-- leaves it (0098: a parent may have another child there). The club can ask
-- again by name, and accepting puts the child back.

alter table public.offers
  add column if not exists kind text not null default 'trial';
alter table public.offers
  alter column trial_registration_id drop not null;
alter table public.offers drop constraint if exists offers_kind_check;
alter table public.offers
  add constraint offers_kind_check check (
    (kind = 'trial' and trial_registration_id is not null)
    or (kind = 'returning' and trial_registration_id is null)
  );

-- One offer per returning child per program: offering it again re-dates it.
create unique index if not exists offers_returning_once
  on public.offers (player_id, squad_program_id) where kind = 'returning';
create index if not exists offers_program_open_idx
  on public.offers (squad_program_id) where status = 'open';

/**
 * The places open offers hold in a program, as seen by a child who does not
 * hold one: offers not yet answered and not past their date, for children
 * not already registered in it (a registration holds the place itself). A
 * child with an open offer of their own is kept out by nobody's offer.
 */
create or replace function app_private.places_held_by_offers(p_program uuid, p_player uuid default null)
returns integer
language sql stable security definer set search_path = public as $fn$
  select case
    when p_player is not null and exists (
      select 1 from public.offers o
       where o.squad_program_id = p_program and o.player_id = p_player
         and o.status = 'open' and o.expires_at >= now()) then 0
    else (
      select count(distinct o.player_id)::integer
        from public.offers o
       where o.squad_program_id = p_program
         and o.status = 'open' and o.expires_at >= now()
         and not exists (
           select 1 from public.program_registrations r
            where r.program_id = o.squad_program_id and r.player_id = o.player_id
              and r.status in ('approved', 'pending')))
  end;
$fn$;

-- 0122's count of free places, less the ones open offers hold.
create or replace function app_private.program_spots_left(p_program uuid)
returns integer
language sql stable security definer set search_path = public as $fn$
  select case
    when p.capacity is null then null
    else greatest(
      p.capacity
      - (select count(*) from public.program_registrations r
          where r.program_id = p.id and r.status in ('approved', 'pending'))
      - (select count(*) from public.registration_requests q
          where q.program_id = p.id and q.status = 'pending')
      - app_private.places_held_by_offers(p.id),
      0
    )::integer
  end
  from public.programs p
 where p.id = p_program;
$fn$;

-- 0083's guard, with an offered place: the club's dates and birth years
-- bend for it, and the places other children's offers hold count against
-- everybody else. Otherwise exactly as it was.
create or replace function public.guard_program_registration()
returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  v_program  public.programs;
  v_player   public.players;
  v_taken    integer;
  v_queue    integer;
  v_year     integer;
  v_offered  boolean;
begin
  select * into v_program from public.programs where id = new.program_id;
  select * into v_player  from public.players  where id = new.player_id;

  -- academy_id is carried on the row rather than derived, and the composite
  -- foreign keys above already make a cross-tenant pairing impossible. This
  -- catches the row being inserted with the wrong one of two academies the
  -- submitter does belong to.
  if v_program.academy_id <> new.academy_id or v_player.academy_id <> new.academy_id then
    raise exception 'that program and that player are not in the same academy'
      using errcode = '42501';
  end if;

  -- 0221: a place the club has offered this child, still open. The club
  -- decided when it offered.
  v_offered := exists (
    select 1 from public.offers o
     where o.squad_program_id = new.program_id and o.player_id = new.player_id
       and o.status = 'open' and o.expires_at >= now());

  -- Staff may add anybody at any time: a late entry agreed on the phone is a
  -- normal part of running an academy, and refusing it would just push the
  -- academy back into a spreadsheet.
  if not app_private.is_academy_staff(new.academy_id) and not v_offered then
    if v_program.status <> 'open' then
      raise exception 'registrations for % are not open', v_program.name
        using errcode = '22023';
    end if;
    if v_program.opens_at is not null and now() < v_program.opens_at then
      raise exception 'registrations for % open %', v_program.name,
        to_char(v_program.opens_at, 'FMDay FMDD FMMonth')
        using errcode = '22023';
    end if;
    if v_program.closes_at is not null and now() > v_program.closes_at then
      raise exception 'registrations for % closed on %', v_program.name,
        to_char(v_program.closes_at, 'FMDD FMMonth')
        using errcode = '22023';
    end if;
  end if;

  -- Birth year, never age — unless the club has placed the child itself.
  if not v_offered then
    v_year := extract(year from v_player.dob)::integer;
    if v_program.born_from_year is not null and v_year < v_program.born_from_year then
      raise exception '% is for players born % to %, and % was born in %',
        v_program.name, v_program.born_from_year,
        coalesce(v_program.born_to_year::text, 'later'),
        v_player.full_name, v_year
        using errcode = '22023';
    end if;
    if v_program.born_to_year is not null and v_year > v_program.born_to_year then
      raise exception '% is for players born % to %, and % was born in %',
        v_program.name, coalesce(v_program.born_from_year::text, 'earlier'),
        v_program.born_to_year, v_player.full_name, v_year
        using errcode = '22023';
    end if;
  end if;

  if v_program.gender is not null and v_player.gender is not null
     and v_program.gender <> v_player.gender then
    raise exception '% is a % program', v_program.name, v_program.gender
      using errcode = '22023';
  end if;

  -- The race. SERIALIZABLE is not in play here, so take the program row's
  -- lock: whoever gets it counts and decides, and the next transaction counts
  -- again afterwards rather than against a stale number.
  if v_program.capacity is not null and new.status = 'pending' then
    perform 1 from public.programs where id = new.program_id for update;

    select count(*) into v_taken
      from public.program_registrations
     where program_id = new.program_id
       and status in ('pending', 'approved');
    -- 0221: and the places held by other children's open offers.
    v_taken := v_taken + app_private.places_held_by_offers(new.program_id, new.player_id);

    if v_taken >= v_program.capacity then
      if not v_program.waitlist_enabled then
        raise exception '% is full', v_program.name using errcode = '22023';
      end if;
      select coalesce(max(waitlist_position), 0) + 1 into v_queue
        from public.program_registrations
       where program_id = new.program_id and status = 'waitlisted';
      new.status := 'waitlisted';
      new.waitlist_position := v_queue;
    end if;
  end if;

  return new;
end;
$fn$;

-- ------------------------------------------------------------ the offering
/**
 * Every returning child of p_season not yet registered is offered their
 * place, to accept by the end of p_until where the club is. Staff only. The
 * same offer sent twice is sent once; a new date re-dates it and says so; a
 * lapsed one is offered again. A child already registered (or waiting for
 * the club to approve them), one whose family said no, and one the club
 * turned down or who withdrew are left alone — unless the club names them
 * in p_players, which is how a "no" is asked again.
 */
create or replace function public.offer_returning_places(
  p_academy uuid, p_season text, p_until date, p_players uuid[] default null)
returns jsonb
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_me      uuid := auth.uid();
  v_tz      text;
  v_today   date;
  v_expires timestamptz;
  v_offered integer := 0;
  v_same    integer := 0;
  v_skipped integer := 0;
  v_nobody  integer := 0;
  v_closed  jsonb := '[]'::jsonb;
  v_old     public.offers;
  v_id      uuid;
  n         integer;
  r         record;
begin
  if not coalesce(app_private.is_academy_staff(p_academy), false) then
    raise exception 'only an admin can offer next season''s places' using errcode = '42501';
  end if;
  select a.timezone into v_tz from public.academies a where a.id = p_academy;
  v_tz := coalesce(v_tz, 'Australia/Sydney');
  v_today := (now() at time zone v_tz)::date;
  if p_until is null or p_until < v_today then
    raise exception 'the day to accept by has to be today or later' using errcode = '22023';
  end if;
  if p_until > v_today + 60 then
    raise exception 'an offer lasts at most sixty days' using errcode = '22023';
  end if;
  -- The end of that day, at the club.
  v_expires := ((p_until + 1)::timestamp at time zone v_tz) - interval '1 second';

  for r in
    select t.name as team, sp.id as program_id, pl.id as player_id, pl.full_name
      from public.teams t
      join public.players pl on pl.team_id = t.id
      left join lateral (
        select p.id from public.programs p
         where p.team_id = t.id and p.kind = 'squad' and p.season = t.season and p.status = 'open'
         order by p.created_at
         limit 1
      ) sp on true
     where t.academy_id = p_academy and t.season = p_season and t.status = 'active'
       and t.rolled_from is not null
       and (p_players is null or pl.id = any(p_players))
    union all
    -- Asked again: a child whose family said no is off the squad, so they
    -- are found through the offer they declined.
    select t.name, o.squad_program_id, pl.id, pl.full_name
      from public.offers o
      join public.programs sp on sp.id = o.squad_program_id
      join public.teams t on t.id = sp.team_id
      join public.players pl on pl.id = o.player_id
     where p_players is not null and o.player_id = any(p_players)
       and o.academy_id = p_academy and o.kind = 'returning' and o.status = 'declined'
       and t.season = p_season and t.status = 'active' and sp.status = 'open'
       and pl.team_id is distinct from t.id
  loop
    if r.program_id is null then
      -- No open program for the squad: nothing to accept into.
      if not (v_closed ? r.team) then
        v_closed := v_closed || to_jsonb(r.team);
      end if;
      continue;
    end if;
    if exists (select 1 from public.program_registrations pr
                where pr.program_id = r.program_id and pr.player_id = r.player_id
                  and (pr.status in ('approved', 'pending') or p_players is null)) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    select * into v_old from public.offers o
     where o.player_id = r.player_id and o.squad_program_id = r.program_id and o.kind = 'returning';
    if v_old.id is not null then
      if v_old.status = 'accepted' or (v_old.status = 'declined' and p_players is null) then
        v_skipped := v_skipped + 1;
        continue;
      end if;
      if v_old.status = 'open' and v_old.expires_at = v_expires then
        v_same := v_same + 1;
        continue;
      end if;
      update public.offers
         set expires_at = v_expires, status = 'open', decided_at = null, created_by = v_me
       where id = v_old.id;
      v_id := v_old.id;
    else
      insert into public.offers (academy_id, kind, player_id, squad_program_id, expires_at, created_by)
      values (p_academy, 'returning', r.player_id, r.program_id, v_expires, v_me)
      returning id into v_id;
    end if;

    -- Every guardian, through the queue. The link is the offer.
    insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload)
    select p_academy, pg.profile_id, 'offer',
           split_part(r.full_name, ' ', 1) || '''s place for ' || p_season,
           r.team || ' — accept by ' || to_char(v_expires at time zone v_tz, 'FMDay FMDD Mon'),
           '/offer/' || v_id,
           jsonb_build_object('offer_id', v_id, 'player_id', r.player_id)
      from public.player_guardians pg
     where pg.player_id = r.player_id;
    get diagnostics n = row_count;
    if n = 0 then
      v_nobody := v_nobody + 1;
    end if;
    v_offered := v_offered + 1;
  end loop;

  return jsonb_build_object(
    'offered', v_offered, 'unchanged', v_same, 'skipped', v_skipped,
    'no_family', v_nobody, 'closed', v_closed, 'expires_at', v_expires);
end;
$fn$;

-- ----------------------------------------------------------- the answering
create or replace function public.my_offers()
returns jsonb
language sql stable security definer set search_path = public as $fn$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',               o.id,
           'kind',             o.kind,
           'player_id',        o.player_id,
           'player',           pl.full_name,
           'squad_program',    sp.name,
           'squad_program_id', sp.id,
           'squad',            (select t.name from public.teams t where t.id = sp.team_id),
           'season',           sp.season,
           'trial',            tp.name,
           'fee_cents',        (select pr.amount_cents from public.payment_requests pr where pr.program_id = sp.id and pr.archived_at is null limit 1),
           'expires_at',       o.expires_at,
           'state',            app_private.offer_state(o.status, o.expires_at),
           'decided_at',       o.decided_at,
           'registration_id',  o.registration_id,
           'registration_status', (select r.status from public.program_registrations r where r.id = o.registration_id)
         ) order by o.expires_at), '[]'::jsonb)
    from public.offers o
    join public.players pl on pl.id = o.player_id
    join public.programs sp on sp.id = o.squad_program_id
    left join public.program_registrations tr on tr.id = o.trial_registration_id
    left join public.programs tp on tp.id = tr.program_id
   where exists (select 1 from public.player_guardians pg where pg.player_id = o.player_id and pg.profile_id = auth.uid());
$fn$;

create or replace function public.accept_offer(p_offer uuid)
returns jsonb
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_me      uuid := auth.uid();
  v_offer   public.offers;
  v_squad   public.programs;
  v_player  public.players;
  v_reg     public.program_registrations;
  v_state   text;
  v_fee     uuid;
  v_status  public.registration_status;
  v_taken   integer;
  v_changed boolean := false;
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
  -- The program's row lock, as 0083's guard takes it: two families answering
  -- for the last place count one after the other, never both against the
  -- same number.
  select * into v_squad from public.programs where id = v_offer.squad_program_id for update;
  if v_squad.status <> 'open' then
    raise exception '% has closed', v_squad.name using errcode = '22023';
  end if;
  select * into v_reg from public.program_registrations
   where program_id = v_squad.id and player_id = v_offer.player_id;

  -- A free place, not counting the ones other offers hold (first to answer,
  -- first in). A child whose registration already holds one needs no other.
  if v_squad.capacity is not null and coalesce(v_reg.status::text, '') not in ('approved', 'pending') then
    select count(*) into v_taken from public.program_registrations r
     where r.program_id = v_squad.id and r.status in ('approved', 'pending');
    select v_taken + count(*) into v_taken from public.registration_requests q
     where q.program_id = v_squad.id and q.status = 'pending';
    if v_taken >= v_squad.capacity then
      raise exception 'the squad is full — the club offered a place it no longer has' using errcode = '22023';
    end if;
  end if;

  -- PlayFootball first (0162): held as pending until the club has confirmed
  -- the child's official registration.
  select * into v_player from public.players where id = v_offer.player_id;
  v_status := case when v_squad.requires_official_rego
                     and v_player.official_status not in ('registered', 'not_required')
                   then 'pending' else 'approved' end;

  if v_reg.id is null then
    insert into public.program_registrations (academy_id, program_id, player_id, submitted_by, status, note)
    values (v_offer.academy_id, v_squad.id, v_offer.player_id, v_me, v_status,
            case when v_offer.kind = 'returning'
                 then 'Accepted the offer of a place for ' || coalesce(v_squad.season, 'next season')
                 else 'From an offer after trials' end)
    returning * into v_reg;
    v_changed := true;
  elsif v_reg.status <> 'approved' and v_reg.status <> v_status then
    -- On the form already, waitlisted, or withdrawn: the offer settles it.
    update public.program_registrations
       set status = v_status,
           note = coalesce(note || ' · ', '') || 'Accepted the club''s offer'
     where id = v_reg.id
    returning * into v_reg;
    v_changed := true;
  end if;

  if v_changed and v_reg.status = 'approved' then
    -- Who approved this child: the club, when it offered. (0083's stamp
    -- would name the parent who tapped Accept.)
    update public.program_registrations
       set decided_by = v_offer.created_by, decided_at = now()
     where id = v_reg.id;
  end if;

  -- Into the squad, so the chat and fixtures follow (0098). A place waiting
  -- on PlayFootball goes in when the club approves it.
  if v_reg.status = 'approved' and v_squad.team_id is not null then
    update public.players set team_id = v_squad.team_id, updated_at = now()
     where id = v_offer.player_id and team_id is distinct from v_squad.team_id;
  end if;

  update public.offers
     set status = 'accepted', decided_at = now(), registration_id = v_reg.id
   where id = p_offer;

  -- The fee next — but no money before the club can confirm the child may play.
  if v_reg.status = 'approved' then
    select pr.id into v_fee from public.payment_requests pr
     where pr.program_id = v_squad.id and pr.archived_at is null
     limit 1;
  end if;

  return jsonb_build_object(
    'registration_id', v_reg.id, 'payment_request_id', v_fee, 'player_id', v_offer.player_id,
    'waiting_for', case when v_reg.status = 'pending' then 'playfootball' end);
end;
$fn$;

create or replace function public.decline_offer(p_offer uuid)
returns void
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_offer public.offers;
  v_team  uuid;
begin
  select * into v_offer from public.offers where id = p_offer;
  if v_offer.id is null or not coalesce(app_private.is_guardian_of(v_offer.player_id), false) then
    raise exception 'that offer is not yours to answer' using errcode = '42501';
  end if;
  if app_private.offer_state(v_offer.status, v_offer.expires_at) <> 'open' then
    raise exception 'this offer is no longer open' using errcode = '22023';
  end if;
  update public.offers set status = 'declined', decided_at = now() where id = p_offer;

  -- A returning child whose family says no is leaving: off the squad, so
  -- the place is free and nobody picks them for a game.
  if v_offer.kind = 'returning' then
    select team_id into v_team from public.programs where id = v_offer.squad_program_id;
    update public.players set team_id = null, updated_at = now()
     where id = v_offer.player_id and team_id = v_team;
  end if;
end;
$fn$;

-- ------------------------------------------------------------- the chasing
-- 0139's report, with each child's offer and registration, the squad's
-- open program, and the children whose families said no.
create or replace function public.rollover_report(p_academy uuid, p_season text)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
begin
  if not coalesce(app_private.is_academy_staff(p_academy), false) then
    raise exception 'only an admin can see this' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'team_id',    t.id,
             'team',       t.name,
             'program_id', sp.id,
             'total',      (select count(*) from public.players pl where pl.team_id = t.id),
             'registered', (select count(*) from public.players pl where pl.team_id = t.id
                             and exists (select 1 from public.program_registrations pr
                                           join public.programs p on p.id = pr.program_id
                                          where pr.player_id = pl.id and p.team_id = t.id
                                            and p.season = p_season and pr.status = 'approved')),
             'not_yet', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'player_id', pl.id,
                        'name',      pl.full_name,
                        'guardians', coalesce((
                          select jsonb_agg(jsonb_build_object('name', pr.full_name, 'phone', pr.phone::text))
                            from public.player_guardians pg
                            join public.profiles pr on pr.id = pg.profile_id
                           where pg.player_id = pl.id
                        ), '[]'::jsonb),
                        'registration', (
                          select pr.status from public.program_registrations pr
                            join public.programs p on p.id = pr.program_id
                           where pr.player_id = pl.id and p.team_id = t.id and p.season = p_season
                           order by pr.created_at desc
                           limit 1),
                        'offer', (
                          select jsonb_build_object('id', o.id, 'state', app_private.offer_state(o.status, o.expires_at),
                                                    'expires_at', o.expires_at)
                            from public.offers o
                            join public.programs p on p.id = o.squad_program_id
                           where o.player_id = pl.id and p.team_id = t.id and o.kind = 'returning'
                           order by o.created_at desc
                           limit 1)
                      ) order by pl.full_name)
                 from public.players pl
                where pl.team_id = t.id
                  and not exists (select 1 from public.program_registrations pr
                                    join public.programs p on p.id = pr.program_id
                                   where pr.player_id = pl.id and p.team_id = t.id
                                     and p.season = p_season and pr.status = 'approved')
             ), '[]'::jsonb),
             'declined', coalesce((
               select jsonb_agg(jsonb_build_object('player_id', pl.id, 'name', pl.full_name, 'decided_at', o.decided_at)
                                order by pl.full_name)
                 from public.offers o
                 join public.programs p on p.id = o.squad_program_id
                 join public.players pl on pl.id = o.player_id
                where p.team_id = t.id and o.kind = 'returning' and o.status = 'declined'
                  and pl.team_id is distinct from t.id
             ), '[]'::jsonb)
           ) order by t.age_group, t.name)
      from public.teams t
      left join lateral (
        select p.id from public.programs p
         where p.team_id = t.id and p.kind = 'squad' and p.season = t.season and p.status = 'open'
         order by p.created_at
         limit 1
      ) sp on true
     where t.academy_id = p_academy and t.season = p_season and t.rolled_from is not null
  ), '[]'::jsonb);
end;
$fn$;

-- 0139's nudge. A child with an open offer is reminded of the offer, with
-- its date, and the link opens it. A family waiting on the club to approve
-- their form is no longer told to register.
create or replace function public.nudge_unregistered(p_academy uuid, p_season text)
returns integer
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_sent integer := 0;
  v_tz   text;
begin
  if not coalesce(app_private.is_academy_staff(p_academy), false) then
    raise exception 'only an admin can send this' using errcode = '42501';
  end if;
  select coalesce(a.timezone, 'Australia/Sydney') into v_tz from public.academies a where a.id = p_academy;
  with not_yet as (
    select pl.id as player_id, pl.full_name, t.name as team, o.id as offer_id, o.expires_at
      from public.teams t
      join public.players pl on pl.team_id = t.id
      left join lateral (
        select o.id, o.expires_at from public.offers o
          join public.programs p on p.id = o.squad_program_id
         where o.player_id = pl.id and p.team_id = t.id and o.kind = 'returning'
           and o.status = 'open' and o.expires_at >= now()
         order by o.created_at desc
         limit 1
      ) o on true
     where t.academy_id = p_academy and t.season = p_season and t.rolled_from is not null
       and not exists (select 1 from public.program_registrations pr
                         join public.programs p on p.id = pr.program_id
                        where pr.player_id = pl.id and p.team_id = t.id
                          and p.season = p_season and pr.status in ('approved', 'pending'))
  ),
  recipients as (
    select n.*, pg.profile_id as tell
      from not_yet n join public.player_guardians pg on pg.player_id = n.player_id
  ),
  fresh as (
    -- Once a week per child per parent, however often the button is pressed.
    select r.* from recipients r
     where not exists (select 1 from public.notification_queue q
                        where q.kind = 'reregister_nudge' and q.profile_id = r.tell
                          and q.payload->>'player_id' = r.player_id::text
                          and q.created_at > now() - interval '7 days')
  ),
  queued as (
    insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload)
    select p_academy, f.tell, 'reregister_nudge',
           case when f.offer_id is not null
                then split_part(f.full_name, ' ', 1) || '''s place for ' || p_season || ' is waiting'
                else 'Re-register ' || split_part(f.full_name, ' ', 1) || ' for ' || p_season end,
           case when f.offer_id is not null
                then f.full_name || ' has a place in ' || f.team || '. Accept it by '
                     || to_char(f.expires_at at time zone v_tz, 'FMDay FMDD Mon') || ' to keep it.'
                else f.full_name || ' has a place in ' || f.team || ' this season. Register them to keep it.' end,
           case when f.offer_id is not null then '/offer/' || f.offer_id else '/programs' end,
           jsonb_build_object('player_id', f.player_id, 'season', p_season)
             || case when f.offer_id is not null then jsonb_build_object('offer_id', f.offer_id) else '{}'::jsonb end
      from fresh f
    returning 1
  )
  select count(*)::integer into v_sent from queued;
  return v_sent;
end;
$fn$;

revoke execute on function public.offer_returning_places(uuid, text, date, uuid[]) from public, anon;
grant execute on function public.offer_returning_places(uuid, text, date, uuid[]) to authenticated;
revoke execute on function public.my_offers() from public, anon;
revoke execute on function public.accept_offer(uuid) from public, anon;
revoke execute on function public.decline_offer(uuid) from public, anon;
revoke execute on function public.rollover_report(uuid, text) from public, anon;
revoke execute on function public.nudge_unregistered(uuid, text) from public, anon;
grant execute on function public.my_offers() to authenticated;
grant execute on function public.accept_offer(uuid) to authenticated;
grant execute on function public.decline_offer(uuid) to authenticated;
grant execute on function public.rollover_report(uuid, text) to authenticated;
grant execute on function public.nudge_unregistered(uuid, text) to authenticated;
