-- 0077_restore_dm_names_in_channel_list.sql
--
-- A regression I introduced in 0071, found by test-dms-and-approval step 7.
--
-- A direct channel has no name of its own — 0038 resolved one at read time
-- from "the other person in this conversation", so Sam's chat list showed
-- "Joey Lameri". 0071 rewrote my_channels to fix blank previews for fixture
-- cards and photos, and in rewriting it dropped the lateral join that did
-- that. Since then every DM in the list has read "Direct message", or
-- nothing.
--
-- Worth naming the mistake precisely: 0071 replaced a function rather than
-- amending it, and nothing compared the new column list against the old one.
-- A test caught it, three weeks later, while looking for something else.
--
-- This keeps everything 0071 added — the card, poll and photo previews — and
-- puts the DM name back.

create or replace function public.my_channels(p_academy uuid)
returns table (
  channel_id     uuid,
  name           text,
  type           public.channel_type,
  team_id        uuid,
  posting_mode   public.posting_mode,
  status         public.channel_status,
  my_role        public.channel_member_role,
  muted          boolean,
  unread_count   integer,
  last_message_at   timestamptz,
  last_message_body text,
  last_sender_name  text
)
language sql stable security definer set search_path = public as $fn$
  select
    c.id,
    -- A named channel keeps its name; a DM borrows the other person's.
    coalesce(c.name, dm.full_name, 'Direct message'),
    c.type, c.team_id, c.posting_mode, c.status,
    cm.role, cm.muted,
    (
      select count(*)::integer
        from public.messages m
       where m.channel_id = c.id
         and m.created_at > cm.last_read_at
         and m.sender_id is distinct from auth.uid()
         and m.deleted_at is null
         and m.status = 'published'
    ),
    last.created_at,
    -- From 0071: a card carries its meaning somewhere other than the body,
    -- so say what it is rather than showing a blank line.
    case
      when last.id is null then null
      when last.deleted_at is not null then 'Message deleted'
      when nullif(btrim(coalesce(last.body, '')), '') is not null then last.body
      when last.event_id is not null then
        '📅 ' || coalesce((select e.title from public.events e where e.id = last.event_id), 'Fixture')
      when exists (select 1 from public.polls p where p.message_id = last.id) then
        '📊 ' || coalesce((select p.question from public.polls p where p.message_id = last.id), 'Poll')
      when jsonb_array_length(coalesce(last.attachments, '[]'::jsonb)) > 0 then
        case when jsonb_array_length(last.attachments) = 1 then '📷 Photo'
             else '📷 ' || jsonb_array_length(last.attachments)::text || ' photos' end
      else null
    end,
    (select p.full_name from public.profiles p where p.id = last.sender_id)
  from public.channels c
  join public.channel_members cm
    on cm.channel_id = c.id and cm.profile_id = auth.uid()
  left join lateral (
    select m.id, m.body, m.created_at, m.sender_id, m.event_id, m.attachments, m.deleted_at
      from public.messages m
     where m.channel_id = c.id and m.status = 'published'
     order by m.created_at desc
     limit 1
  ) last on true
  -- The other person in a DM, for its name. Restored from 0038.
  left join lateral (
    select pr.full_name
      from public.channel_members other
      join public.profiles pr on pr.id = other.profile_id
     where c.type = 'direct'
       and other.channel_id = c.id
       and other.profile_id <> auth.uid()
     limit 1
  ) dm on true
 where c.academy_id = p_academy
 order by (c.status = 'archived'), last.created_at desc nulls last, coalesce(c.name, dm.full_name);
$fn$;

revoke execute on function public.my_channels(uuid) from public, anon;
grant execute on function public.my_channels(uuid) to authenticated;
