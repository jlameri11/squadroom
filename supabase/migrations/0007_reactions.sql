-- 0007_reactions.sql
-- Reactions, and the split visibility they need: hosts see who reacted,
-- everyone else sees counts only.
--
-- RLS cannot express "this row, but not its profile_id" — a policy either
-- returns the row or it doesn't. So the base table is host-readable, everyone
-- reads the counts view, and names come from an explicit host-gated function.

create table public.message_reactions (
  id         uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id) on delete cascade,
  message_id uuid not null,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  emoji      text not null check (length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),

  constraint message_reactions_unique unique (message_id, profile_id, emoji),
  constraint message_reactions_message_fkey foreign key (message_id, academy_id)
    references public.messages (id, academy_id) on delete cascade
);
alter table public.message_reactions enable row level security;

-- The host-only name list behind a reaction chip.
create or replace function public.get_reaction_voters(p_message uuid, p_emoji text)
returns table (profile_id uuid, full_name text, avatar_url text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_channel uuid;
begin
  select m.channel_id into v_channel from public.messages m where m.id = p_message;

  if v_channel is null or not public.is_channel_host(v_channel) then
    raise exception 'not authorised to see who reacted'
      using errcode = '42501';
  end if;

  return query
    select p.id, p.full_name, p.avatar_url
      from public.message_reactions r
      join public.profiles p on p.id = r.profile_id
     where r.message_id = p_message
       and r.emoji = p_emoji
     order by r.created_at;
end;
$$;
