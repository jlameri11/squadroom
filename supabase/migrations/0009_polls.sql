-- 0009_polls.sql
-- Two kinds of poll: a simple question, and an availability poll answered
-- per player that a host can convert straight into an event.

create table public.polls (
  id              uuid primary key default gen_random_uuid(),
  academy_id      uuid not null references public.academies(id) on delete cascade,
  channel_id      uuid not null,
  -- The card that renders it in the thread.
  message_id      uuid,
  type            public.poll_type not null default 'simple',
  question        text not null check (length(btrim(question)) > 0),
  -- Simple polls: [{ id, label }]. Availability polls use fixed yes/no/maybe
  -- and leave this empty.
  options         jsonb not null default '[]'::jsonb
                    check (jsonb_typeof(options) = 'array'),
  multi           boolean not null default false,
  anonymous       boolean not null default false,
  closes_at       timestamptz,
  closed_at       timestamptz,
  linked_event_id uuid,
  created_by      uuid not null references public.profiles(id) on delete cascade,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint polls_id_academy_key unique (id, academy_id),
  constraint polls_channel_fkey foreign key (channel_id, academy_id)
    references public.channels (id, academy_id) on delete cascade,
  constraint polls_message_fkey foreign key (message_id, academy_id)
    references public.messages (id, academy_id) on delete set null (message_id),
  constraint polls_event_fkey foreign key (linked_event_id, academy_id)
    references public.events (id, academy_id) on delete set null (linked_event_id),
  constraint polls_simple_needs_options
    check (type <> 'simple' or jsonb_array_length(options) >= 2)
);
alter table public.polls enable row level security;

create trigger polls_set_updated_at
  before update on public.polls
  for each row execute function public.set_updated_at();

-- One vote per responder per player. Availability polls store the chosen
-- status in option_ids as a single element: 'yes' | 'no' | 'maybe'.
create table public.poll_votes (
  id         uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id) on delete cascade,
  poll_id    uuid not null,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  player_id  uuid,
  option_ids text[] not null check (array_length(option_ids, 1) >= 1),
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint poll_votes_unique unique nulls not distinct (poll_id, profile_id, player_id),
  constraint poll_votes_poll_fkey foreign key (poll_id, academy_id)
    references public.polls (id, academy_id) on delete cascade,
  constraint poll_votes_player_fkey foreign key (player_id, academy_id)
    references public.players (id, academy_id) on delete cascade
);
alter table public.poll_votes enable row level security;

create trigger poll_votes_set_updated_at
  before update on public.poll_votes
  for each row execute function public.set_updated_at();

-- Tallies every channel member may see, including on an anonymous poll.
-- Owner-rights for the same reason as message_reaction_counts: the caller's
-- RLS would otherwise reduce every count to their own vote.
create view public.poll_vote_counts as
select
  v.poll_id,
  v.academy_id,
  o.option_id,
  count(*)::integer as votes
from public.poll_votes v
cross join lateral unnest(v.option_ids) as o(option_id)
where public.is_channel_member(public.poll_channel(v.poll_id))
group by v.poll_id, v.academy_id, o.option_id;
