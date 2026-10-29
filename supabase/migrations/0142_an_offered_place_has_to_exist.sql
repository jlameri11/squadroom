-- 0142: an offered place has to exist.
--
-- 0140's accept_offer inserted the squad registration as 'approved' and
-- then checked whether 0083's trigger had waitlisted it. The trigger did
-- not: it decides pending-versus-waitlist for a registration that ARRIVES
-- pending, and one that arrives approved is a staff decision it does not
-- second-guess. So a family could accept a place in a squad that was
-- already full, and the suite's first run put a third child in a squad of
-- two.
--
-- The question is asked outright now, with the product's own definition
-- of a free place (app_private.program_spots_left, 0122 — approved and
-- pending registrations and pending public requests all hold one). A full
-- squad is the club's mistake, said in those words, and nothing is written.

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
  if coalesce(app_private.program_spots_left(v_squad.id), 1) <= 0 then
    raise exception 'the squad is full — the club offered a place it no longer has' using errcode = '22023';
  end if;

  -- Pre-approved: the coach decided when they offered.
  insert into public.program_registrations (academy_id, program_id, player_id, submitted_by, status, note)
  values (v_offer.academy_id, v_squad.id, v_offer.player_id, v_me, 'approved', 'From an offer after trials')
  returning id into v_reg;

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
