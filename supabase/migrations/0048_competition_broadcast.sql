-- 0048_competition_broadcast.sql
--
-- A league that keeps Dribl for its draw still has a communication problem:
-- how does one person tell forty clubs that Saturday is washed out?
--
-- The obvious answer - a channel spanning every club - is the wrong one. It
-- would put members of forty academies in one room, so every club could see
-- every other club's people, which is the exact boundary this schema exists
-- to hold. A wet-weather notice is not worth that.
--
-- Instead the announcement is MIRRORED into each participating club's own
-- announcements channel, attributed to the organiser. The same pattern as
-- fixtures becoming events: one authoritative thing, copied into each
-- tenant's own space, with nothing shared between them.

create table public.competition_announcements (
  id             uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete cascade,
  body           text not null check (length(btrim(body)) > 0),
  urgent         boolean not null default false,
  sent_by        uuid not null references public.profiles(id) on delete cascade,
  sent_at        timestamptz not null default now(),
  club_count     integer not null default 0
);
alter table public.competition_announcements enable row level security;

create index competition_announcements_idx
  on public.competition_announcements (competition_id, sent_at desc);

create policy competition_announcements_select on public.competition_announcements
  for select to authenticated
  using ((select app_private.is_competition_participant(competition_id)));

create policy competition_announcements_insert on public.competition_announcements
  for insert to authenticated
  with check ((select app_private.is_competition_organiser(competition_id)));

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
    -- Each club's own announcements channel. Nobody joins anybody else's.
    v_channel := public.ensure_system_channel(club.academy_id, 'academy_wide');

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

  update public.competition_announcements set club_count = v_clubs where id = v_ann;
  return v_clubs;
end;
$$;

revoke execute on function public.broadcast_to_competition(uuid, text, boolean) from public, anon;
grant execute on function public.broadcast_to_competition(uuid, text, boolean) to authenticated;

-- Who the organiser can actually reach.
--
-- Deliberately NOT the clubs' member lists. It returns the contact each club
-- gave when it was invited, plus whoever accepted - information the club
-- handed over directly. A competition entry is not consent to hand over a
-- club's whole address book.
create or replace function public.competition_contacts(p_competition uuid)
returns table (
  club_name     text,
  status        text,
  contact_name  text,
  contact_email text,
  contact_phone text,
  accepted_by   text,
  academy_id    uuid
)
language sql stable security definer set search_path = public as $$
  select
    ci.club_name, ci.status, ci.contact_name, ci.contact_email::text,
    ci.contact_phone, p.full_name, ci.redeemed_academy
  from public.competition_invites ci
  left join public.profiles p on p.id = ci.redeemed_by
  where ci.competition_id = p_competition
    and app_private.is_competition_organiser(p_competition)
  order by ci.club_name;
$$;

grant execute on function public.competition_contacts(uuid) to authenticated;
