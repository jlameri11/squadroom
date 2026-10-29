-- 0141: an offer made again is still an offer.
--
-- 0140's make_offer re-opened an existing offer with
--   status = case when … then 'accepted' else 'open' end
-- which is a TEXT expression, and the column is the enum offer_status.
-- Postgres refuses the assignment rather than guessing. Caught by the
-- suite's first run; the function is replaced whole with the cast.

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
                -- Accepted stays accepted; anything else (open, declined,
                -- lapsed) becomes a fresh open offer.
                status = (case when public.offers.status = 'accepted' then 'accepted' else 'open' end)::public.offer_status,
                decided_at = case when public.offers.status = 'accepted' then public.offers.decided_at else null end,
                created_by = excluded.created_by
  returning id into v_id;

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
