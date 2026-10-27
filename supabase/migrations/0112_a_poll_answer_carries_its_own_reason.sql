-- 0112: the poll conversion has to satisfy 0111's rule honestly.
--
-- 0111 requires a reason when an RSVP is 'no', and `convert_poll_to_event`
-- (0045) carries poll answers across — including a 'no' whose vote carried no
-- note. So the previous migration broke converting a poll the moment anybody
-- had voted no without explaining, which is most of the time.
--
-- Found by looking for every write path before changing the UI rather than
-- after: three screens and two functions write an RSVP, and one of the
-- functions would have started failing silently in a feature nobody was
-- testing today.
--
-- TWO WAYS TO FIX IT, and the choice matters. Weakening the rule to "only
-- when a human is answering" needs the trigger to know who is calling, which
-- is fragile and a rule with an exception is a rule people route around. So
-- the conversion supplies a note instead, saying where the answer came from —
-- which is true, useful to the coach, and more than they had before.

create or replace function public.convert_poll_to_event(
  p_poll      uuid,
  p_title     text,
  p_starts_at timestamptz,
  p_venue     text default null,
  p_type      public.event_type default 'tournament'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  p        public.polls%rowtype;
  v_team   uuid;
  v_event  uuid;
  v_moved  integer;
begin
  select * into p from public.polls where id = p_poll;
  if p.id is null then
    raise exception 'no such poll' using errcode = '22023';
  end if;
  if not app_private.is_channel_host(p.channel_id) then
    raise exception 'only a host can turn a poll into an event' using errcode = '42501';
  end if;
  if p.type <> 'availability' then
    raise exception 'only an availability poll carries answers an event can use'
      using errcode = '22023';
  end if;
  if p.linked_event_id is not null then
    raise exception 'this poll has already been turned into an event' using errcode = '22023';
  end if;

  select team_id into v_team from public.channels where id = p.channel_id;

  insert into public.events (academy_id, team_id, type, title, starts_at, venue, created_by)
  values (p.academy_id, v_team, p_type, p_title, p_starts_at, p_venue, auth.uid())
  returning id into v_event;

  -- Carry the answers across. A 'maybe' stays a 'maybe': turning it into a
  -- yes would put a child on a team sheet their parent never confirmed.
  insert into public.event_rsvps (academy_id, event_id, profile_id, player_id, status, note)
  select p.academy_id, v_event, v.profile_id, v.player_id,
         (v.option_ids[1])::public.rsvp_status,
         -- 0111 requires a reason on 'no'. A poll vote may not carry one, and
         -- breaking a conversion that is importing answers somebody already
         -- gave would be the wrong way to enforce that — so where the vote
         -- said no and said nothing else, the note records WHERE the answer
         -- came from. That is honest, and it is more than the coach had
         -- before.
         case
           when v.option_ids[1] = 'no'
            and nullif(btrim(coalesce(v.note, '')), '') is null
             then 'Answered “no” in the poll, with no reason given'
           else v.note
         end
    from public.poll_votes v
   where v.poll_id = p_poll
     and v.player_id is not null
     and v.option_ids[1] in ('yes','no','maybe')
  on conflict (event_id, profile_id, player_id) do nothing;

  get diagnostics v_moved = row_count;

  update public.polls
     set linked_event_id = v_event,
         closed_at = coalesce(closed_at, now())
   where id = p_poll;

  return v_event;
end;
$$;
