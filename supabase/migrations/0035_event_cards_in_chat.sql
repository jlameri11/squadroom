-- 0035_event_cards_in_chat.sql
--
-- An event shared into a channel renders as a card with RSVP buttons, rather
-- than as someone typing "9am Saturday at ELS Hall" and thirty replies saying
-- "yes". That is the whole difference from the WhatsApp group.
--
-- The message references the event rather than copying it, so moving the
-- fixture updates every card ever posted about it. A copy would leave the old
-- time sitting in the thread being read.

alter table public.messages add column event_id uuid;
alter table public.messages
  add constraint messages_event_fkey foreign key (event_id, academy_id)
  references public.events (id, academy_id) on delete set null (event_id);

create index messages_event_idx on public.messages (event_id) where event_id is not null;

-- Adding a column to the returned row means replacing the function, not
-- replacing its body.
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
  event        jsonb
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
      'id', e.id,
      'type', e.type,
      'title', e.title,
      'starts_at', e.starts_at,
      'arrive_at', e.arrive_at,
      'venue', e.venue,
      'address', e.address,
      'opponent', e.opponent,
      'kit_colour', e.kit_colour,
      'round', e.round,
      'cancelled_at', e.cancelled_at
    ) end
  from public.messages m
  join public.channels c on c.id = m.channel_id
  left join public.profiles p on p.id = m.sender_id
  left join public.academy_members am on am.profile_id = m.sender_id and am.academy_id = c.academy_id
  left join public.messages r on r.id = m.reply_to_id
  left join public.profiles rp on rp.id = r.sender_id
  left join public.events e on e.id = m.event_id
  where m.channel_id = p_channel
    and app_private.is_channel_member(p_channel)
    and m.status = 'published'
    and (p_before is null or m.created_at < p_before)
  order by m.created_at desc
  limit least(coalesce(p_limit, 50), 100);
$$;

grant execute on function public.channel_messages(uuid, timestamptz, integer) to authenticated;

-- What a parent needs to answer from the card: their own children in the
-- relevant team, and what they have already said for each.
--
-- A parent with two kids in the same team gets two rows and answers twice.
-- Anything that collapses them into one answer is wrong: one child can be at
-- a birthday party while the other plays.
create or replace function public.my_rsvps_for_event(p_event uuid)
returns table (
  player_id   uuid,
  player_name text,
  status      public.rsvp_status,
  note        text
)
language sql stable security definer set search_path = public as $$
  select pl.id, pl.full_name, er.status, er.note
    from public.events e
    join public.players pl
      on pl.academy_id = e.academy_id
     and (e.team_id is null or pl.team_id = e.team_id)
    join public.player_guardians pg
      on pg.player_id = pl.id and pg.profile_id = auth.uid()
    left join public.event_rsvps er
      on er.event_id = e.id and er.player_id = pl.id and er.profile_id = auth.uid()
   where e.id = p_event
     and app_private.can_read_event(p_event)
   order by pl.full_name;
$$;

grant execute on function public.my_rsvps_for_event(uuid) to authenticated;

-- The coach's tally. Superseded by 0037, which makes it return no rows at all
-- for a parent rather than a row of zeros.
create or replace function public.event_rsvp_summary(p_event uuid)
returns table (going integer, maybe integer, out_count integer, no_reply integer)
language sql stable security definer set search_path = public as $$
  with roster as (
    select pl.id
      from public.events e
      join public.players pl
        on pl.academy_id = e.academy_id
       and (e.team_id is null or pl.team_id = e.team_id)
     where e.id = p_event
  ),
  answers as (
    select player_id, status from public.event_rsvps
     where event_id = p_event and player_id is not null
  )
  select
    count(*) filter (where a.status = 'yes')::integer,
    count(*) filter (where a.status = 'maybe')::integer,
    count(*) filter (where a.status = 'no')::integer,
    count(*) filter (where a.status is null)::integer
  from roster r
  left join answers a on a.player_id = r.id
  where app_private.is_event_coach(p_event);
$$;

grant execute on function public.event_rsvp_summary(uuid) to authenticated;
