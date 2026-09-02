-- 0071: a channel whose last message is a card should not look empty.
--
-- my_channels returned messages.body straight through. A fixture card, a poll
-- and a photo all have a null body — the content lives in the joined event,
-- poll or attachments — so the chat list showed a blank line under the
-- channel name and looked broken.
--
-- Only visible once there was enough data to hit it, which is the argument
-- for seeding a realistic season rather than three messages.

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
    c.id, c.name, c.type, c.team_id, c.posting_mode, c.status,
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
    -- What the line under the channel name says. A card carries its meaning
    -- somewhere other than the body, so say what it is rather than nothing.
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
 where c.academy_id = p_academy
 order by last.created_at desc nulls last, c.name;
$fn$;

revoke execute on function public.my_channels(uuid) from public, anon;
grant execute on function public.my_channels(uuid) to authenticated;
