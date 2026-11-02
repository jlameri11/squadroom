-- 0194: the small things that make it feel like WhatsApp.
--
-- M3's last row — the polish parents notice without being able to name:
--
--   "typing…"       The private broadcast topic each channel already has
--                   (0088) carries a typing nudge from the composer. Members
--                   may SEND on their own channel's topic now, not only
--                   listen; the payload is a name and nothing else.
--   ticks           A sender's own message shows one tick when sent and two
--                   when every other member has opened the channel since —
--                   read from channel_members.last_read_at, the same fact
--                   the announcement "seen by" uses. A host may ask about
--                   anyone's message; a parent only about their own.
--   link previews   The first link in a message gets a title and a picture,
--                   fetched once by the server, cached here, and never
--                   fetched by a browser — a parent's phone must not reach
--                   out to a URL somebody else typed.

-- ------------------------------------------------------------ typing
-- 0088 let a channel's members LISTEN on its topic. This lets them send.
drop policy if exists channel_members_may_say_they_are_typing on realtime.messages;
create policy channel_members_may_say_they_are_typing
  on realtime.messages for insert to authenticated
  with check (
    topic like 'channel:%'
    and (select app_private.is_channel_member((substring(topic from 9))::uuid))
  );

-- ------------------------------------------------------------- ticks
create or replace function public.read_receipts(p_channel uuid, p_message_ids uuid[])
returns table (message_id uuid, read_count integer, member_count integer)
language sql stable security definer set search_path = public as $$
  select m.id,
         (select count(*)::integer from public.channel_members cm
           where cm.channel_id = m.channel_id and cm.profile_id <> m.sender_id
             and cm.last_read_at is not null and cm.last_read_at >= m.created_at),
         (select count(*)::integer from public.channel_members cm
           where cm.channel_id = m.channel_id and cm.profile_id <> m.sender_id)
    from public.messages m
   where m.channel_id = p_channel
     and m.id = any (p_message_ids)
     and app_private.is_channel_member(p_channel)
     and (m.sender_id = auth.uid() or app_private.is_channel_host(p_channel));
$$;
revoke execute on function public.read_receipts(uuid, uuid[]) from public, anon;
grant execute on function public.read_receipts(uuid, uuid[]) to authenticated;

-- ----------------------------------------------------- link previews
create table if not exists public.link_previews (
  url          text primary key,
  ok           boolean not null default false,
  title        text,
  description  text,
  image_url    text,
  site_name    text,
  fetched_at   timestamptz not null default now()
);
alter table public.link_previews enable row level security;
-- Anybody signed in may read a preview (a title and a picture of a public
-- page); only the server writes one.
drop policy if exists link_previews_read on public.link_previews;
create policy link_previews_read on public.link_previews for select to authenticated using (true);
grant select on public.link_previews to authenticated;
