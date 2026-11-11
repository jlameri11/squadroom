-- 0254: a club in club mode gets its new age-group channels as notices
--
-- 0245 made the age-group channels hosts-only when club mode is turned on
-- (apply_club_mode_channels) — but 0240's ensure_system_channel, which
-- makes a channel the first time a squad of that age group appears, never
-- set a posting mode, so an age group added after the switch came out open:
-- parents chatting in "U7s Age Group" while every other age group's channel
-- is notices. Found by Big Club Mode's definition of done on Inner West FC,
-- whose forty squads were made after club mode was on — all fourteen of its
-- age-group channels were open.
--
-- Now: in club mode a new age-group channel is hosts-only from birth, and a
-- club-wide channel made in club mode is "Club Notices", hosts-only — what
-- apply_club_mode_channels would have made of it. Out of club mode nothing
-- changes: "Announcements" and the age groups stay open, as 0005 made them.
-- Clubs already in club mode have their open age-group channels closed to
-- notices here, once.

create or replace function public.ensure_system_channel(
  p_academy   uuid,
  p_type      public.channel_type,
  p_age_group text default null,
  p_name      text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id        uuid;
  v_club_mode boolean;
begin
  select id into v_id
    from public.channels
   where academy_id = p_academy
     and type = p_type
     and (p_type <> 'age_group' or age_group is not distinct from p_age_group);

  if v_id is not null then
    return v_id;
  end if;

  select coalesce(a.club_mode, false) into v_club_mode from public.academies a where a.id = p_academy;

  insert into public.channels (academy_id, type, age_group, name, posting_mode)
  values (p_academy, p_type, p_age_group,
          coalesce(p_name,
            case p_type
              when 'coaches'      then 'Coaches'
              when 'academy_wide' then case when v_club_mode then 'Club Notices' else 'Announcements' end
              when 'age_group'    then case when p_age_group = 'Open' then 'Open Age Group' else p_age_group || 's Age Group' end
              else 'Channel'
            end),
          case when v_club_mode and p_type in ('academy_wide', 'age_group') then 'hosts_only'::public.posting_mode
               else 'open'::public.posting_mode end)
  returning id into v_id;

  return v_id;
end;
$$;

-- Once, for the clubs already in club mode: an age-group channel made after
-- the switch was open; it is notices now, as its siblings are.
update public.channels c
   set posting_mode = 'hosts_only'
  from public.academies a
 where a.id = c.academy_id
   and a.club_mode
   and c.type = 'age_group'
   and c.posting_mode = 'open';
