-- 0006_messages.sql
-- The chat table. Everything else in the app is scaffolding around this one.
--
-- Note on scale: the primary key is a plain id, which means this table cannot
-- be partitioned later without a rebuild. That is a deliberate trade for a
-- simple reply_to_id self-reference; at academy scale, archiving old seasons
-- is the likelier answer than partitioning.

create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  academy_id      uuid not null references public.academies(id) on delete cascade,
  channel_id      uuid not null,
  sender_id       uuid references public.profiles(id) on delete set null,

  body            text,
  -- [{ path, mime, width, height, size, blurhash }]
  attachments     jsonb not null default '[]'::jsonb
                    check (jsonb_typeof(attachments) = 'array'),
  reply_to_id     uuid references public.messages(id) on delete set null,

  -- 'pending' is the coach-approval queue on channels with
  -- restrictions->>'approval_required'.
  status          public.message_status not null default 'published',
  approved_by     uuid references public.profiles(id) on delete set null,
  approved_at     timestamptz,

  is_announcement boolean not null default false,
  pinned_at       timestamptz,
  pinned_by       uuid references public.profiles(id) on delete set null,

  created_at      timestamptz not null default now(),
  edited_at       timestamptz,
  -- Soft delete. Owners and admins can still read the body for 90 days
  -- (see the policies in 0012); everyone else sees a tombstone.
  deleted_at      timestamptz,
  deleted_by      uuid references public.profiles(id) on delete set null,

  constraint messages_id_academy_key unique (id, academy_id),
  constraint messages_channel_fkey foreign key (channel_id, academy_id)
    references public.channels (id, academy_id) on delete cascade,
  constraint messages_not_empty check (
    length(btrim(coalesce(body, ''))) > 0 or jsonb_array_length(attachments) > 0
  )
);
alter table public.messages enable row level security;

-- One pinned announcement bar per channel is a UI concern, not a constraint:
-- hosts can pin several and the app shows the most recent.

-- Bump the channel so list ordering and unread counts stay cheap.
create or replace function public.touch_channel_on_message()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.channels set updated_at = now() where id = new.channel_id;
  return new;
end;
$$;

create trigger messages_touch_channel
  after insert on public.messages
  for each row execute function public.touch_channel_on_message();
