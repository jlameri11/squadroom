-- 0157: a league talks to club staff, not to their families.
--
-- L-11. broadcast_to_competition (0048) posted the organiser's message into
-- each entered club's ACADEMY-WIDE channel — every parent at every club.
-- The brief is the other way round, and so is the rule CLAUDE.md puts
-- above everything in competitions: being in a competition together lets
-- you see the DRAW, not each other's PEOPLE. A league secretary's "sheets
-- are due by Monday 9am" is for the club's admins, managers and coaches;
-- the families of forty squads are not the league's to address, and the
-- club decides what to pass on.
--
-- The message now goes to each club's coaches channel, which 0027 keeps in
-- step with owner / admin / coach roles. Nothing else about the function
-- changes; the announcements table still records it once.

create or replace function public.broadcast_to_competition(
  p_competition uuid,
  p_body        text,
  p_urgent      boolean default false
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_org_name text;
  v_comp     text;
  v_ann      uuid;
  v_clubs    integer := 0;
  club       record;
  v_channel  uuid;
begin
  if not app_private.is_competition_organiser(p_competition) then
    raise exception 'only the organiser can send to the whole competition'
      using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_body, ''))) = 0 then
    raise exception 'nothing to send' using errcode = '22023';
  end if;

  select c.name, o.name into v_comp, v_org_name
    from public.competitions c
    join public.academies o on o.id = c.organiser_id
   where c.id = p_competition;

  insert into public.competition_announcements (competition_id, body, urgent, sent_by)
  values (p_competition, btrim(p_body), p_urgent, auth.uid())
  returning id into v_ann;

  for club in
    select cc.academy_id
      from public.competition_clubs cc
     where cc.competition_id = p_competition and cc.status = 'active'
  loop
    -- Staff only. A club's families hear from their club, not from the league.
    v_channel := public.ensure_system_channel(club.academy_id, 'coaches');

    insert into public.messages (
      academy_id, channel_id, sender_id, body, is_announcement, status
    )
    values (
      club.academy_id, v_channel, auth.uid(),
      coalesce(v_comp, 'Competition') || ' — ' || btrim(p_body),
      true, 'published'
    );

    v_clubs := v_clubs + 1;
  end loop;

  return v_clubs;
end;
$$;
