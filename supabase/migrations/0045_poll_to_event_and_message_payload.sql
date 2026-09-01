-- 0045_poll_to_event_and_message_payload.sql
--
-- Turning a closed availability poll into a fixture, and getting polls onto
-- the chat screen without a second round trip per card.

-- The whole point of asking who is available: the answers become the RSVPs,
-- so nobody is asked the same question twice. A coach who has to re-collect
-- fourteen answers after the poll closes would have been better off with the
-- WhatsApp group.
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
         (v.option_ids[1])::public.rsvp_status, v.note
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

revoke execute on function public.convert_poll_to_event(uuid, text, timestamptz, text, public.event_type) from public, anon;
grant execute on function public.convert_poll_to_event(uuid, text, timestamptz, text, public.event_type) to authenticated;

-- channel_messages gains the poll, the way it already carries the event.
drop function if exists public.channel_messages(uuid, timestamptz, integer);

create function public.channel_messages(
  p_channel uuid,
  p_before  timestamptz default null,
  p_limit   integer default 50
)
returns table (
  id           uuid,
  body         text,
  attachments  jsonb,
  sender_id    uuid,
  sender_name  text,
  sender_role  public.academy_role,
  reply_to_id  uuid,
  reply_to_body text,
  reply_to_name text,
  is_announcement boolean,
  pinned_at    timestamptz,
  created_at   timestamptz,
  edited_at    timestamptz,
  deleted_at   timestamptz,
  event_id     uuid,
  event        jsonb,
  poll_id      uuid,
  poll         jsonb
)
language sql stable security definer set search_path = public as $$
  select
    m.id,
    case when m.deleted_at is not null then null else m.body end,
    case when m.deleted_at is not null then '[]'::jsonb else m.attachments end,
    m.sender_id, p.full_name, am.role,
    m.reply_to_id,
    case when r.deleted_at is not null then null else r.body end,
    rp.full_name,
    m.is_announcement, m.pinned_at, m.created_at, m.edited_at, m.deleted_at,
    m.event_id,
    case when e.id is null then null else jsonb_build_object(
      'id', e.id, 'type', e.type, 'title', e.title,
      'starts_at', e.starts_at, 'arrive_at', e.arrive_at,
      'venue', e.venue, 'address', e.address, 'opponent', e.opponent,
      'kit_colour', e.kit_colour, 'round', e.round, 'cancelled_at', e.cancelled_at
    ) end,
    m.poll_id,
    case when pl.id is null then null else jsonb_build_object(
      'id', pl.id, 'type', pl.type, 'question', pl.question,
      'multi', pl.multi, 'anonymous', pl.anonymous,
      'closes_at', pl.closes_at, 'closed_at', pl.closed_at,
      'linked_event_id', pl.linked_event_id,
      -- Closed is a state the card needs, and working it out from two
      -- nullable columns in three different components invites drift.
      'is_open', (pl.closed_at is null and (pl.closes_at is null or pl.closes_at > now()))
    ) end
  from public.messages m
  join public.channels c on c.id = m.channel_id
  left join public.profiles p on p.id = m.sender_id
  left join public.academy_members am on am.profile_id = m.sender_id and am.academy_id = c.academy_id
  left join public.messages r on r.id = m.reply_to_id
  left join public.profiles rp on rp.id = r.sender_id
  left join public.events e on e.id = m.event_id
  left join public.polls pl on pl.id = m.poll_id
  where m.channel_id = p_channel
    and app_private.is_channel_member(p_channel)
    and m.status = 'published'
    and (p_before is null or m.created_at < p_before)
  order by m.created_at desc
  limit least(coalesce(p_limit, 50), 100);
$$;

grant execute on function public.channel_messages(uuid, timestamptz, integer) to authenticated;

-- Casting a vote. A function because "one answer per person per child" and
-- "the poll is still open" are rules, not client conventions, and because an
-- availability answer must replace rather than accumulate.
create or replace function public.cast_poll_vote(
  p_poll    uuid,
  p_options text[],
  p_player  uuid default null,
  p_note    text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  p public.polls%rowtype;
begin
  select * into p from public.polls where id = p_poll;
  if p.id is null then
    raise exception 'no such poll' using errcode = '22023';
  end if;
  if not app_private.is_channel_member(p.channel_id) then
    raise exception 'not in this channel' using errcode = '42501';
  end if;
  if p.closed_at is not null or (p.closes_at is not null and p.closes_at <= now()) then
    raise exception 'this poll has closed' using errcode = '22023';
  end if;
  if array_length(p_options, 1) is null then
    raise exception 'pick an option' using errcode = '22023';
  end if;
  if not p.multi and array_length(p_options, 1) > 1 then
    raise exception 'this poll takes one answer' using errcode = '22023';
  end if;
  if p_player is not null and not app_private.is_guardian_of(p_player) then
    raise exception 'not your child' using errcode = '42501';
  end if;
  if p.type = 'availability' and p_player is null then
    raise exception 'an availability poll is answered per child' using errcode = '22023';
  end if;

  insert into public.poll_votes (academy_id, poll_id, profile_id, player_id, option_ids, note)
  values (p.academy_id, p_poll, auth.uid(), p_player, p_options, p_note)
  on conflict (poll_id, profile_id, player_id) do update
    set option_ids = excluded.option_ids,
        note       = excluded.note,
        updated_at = now();
end;
$$;

revoke execute on function public.cast_poll_vote(uuid, text[], uuid, text) from public, anon;
grant execute on function public.cast_poll_vote(uuid, text[], uuid, text) to authenticated;
