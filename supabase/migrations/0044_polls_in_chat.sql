-- 0044_polls_in_chat.sql
--
-- Two kinds of poll, sharing one table because they differ in what an answer
-- MEANS rather than in shape:
--
--   simple       — a question with options. One answer per person.
--   availability — yes/no/maybe per CHILD. A parent with two kids answers
--                  twice, because one can be at a party while the other plays.
--
-- Like event cards, a poll is referenced by a message rather than copied into
-- it, so closing a poll or its results changing updates the card in place.

alter table public.messages add column poll_id uuid;
alter table public.messages
  add constraint messages_poll_fkey foreign key (poll_id, academy_id)
  references public.polls (id, academy_id) on delete cascade;

create index messages_poll_idx on public.messages (poll_id) where poll_id is not null;

alter table public.messages drop constraint messages_not_empty;
alter table public.messages add constraint messages_not_empty check (
  deleted_at is not null
  or length(btrim(coalesce(body, ''))) > 0
  or jsonb_array_length(attachments) > 0
  or event_id is not null
  or poll_id is not null
);

-- Counts are public to the channel. Who voted is not, unless the poll is
-- named AND you are a host. An anonymous poll is anonymous to the host too -
-- otherwise the word means nothing.
create or replace function public.poll_results(p_poll uuid)
returns table (option_id text, label text, votes integer, voted_by_me boolean)
language sql stable security definer set search_path = public as $$
  with p as (select * from public.polls where id = p_poll),
  opts as (
    select 'yes' as id, 'Yes' as label, 1 as ord from p where p.type = 'availability'
    union all select 'maybe', 'Maybe', 2 from p where p.type = 'availability'
    union all select 'no', 'No', 3 from p where p.type = 'availability'
    union all
    select o ->> 'id', o ->> 'label', (row_number() over ())::int
      from p, jsonb_array_elements(p.options) o
     where p.type <> 'availability'
  ),
  tally as (
    select unnest(v.option_ids) as option_id,
           count(*)::integer as n,
           bool_or(v.profile_id = auth.uid()) as mine
      from public.poll_votes v
     where v.poll_id = p_poll
     group by 1
  )
  select o.id, o.label, coalesce(t.n, 0), coalesce(t.mine, false)
    from opts o
    left join tally t on t.option_id = o.id
   where exists (select 1 from p where app_private.is_channel_member(p.channel_id))
   order by o.ord;
$$;

grant execute on function public.poll_results(uuid) to authenticated;

-- My own answers. One row per child for an availability poll; a single row
-- with a null player for a simple one.
create or replace function public.my_poll_votes(p_poll uuid)
returns table (player_id uuid, player_name text, option_ids text[], note text)
language sql stable security definer set search_path = public as $$
  with p as (select * from public.polls where id = p_poll)
  select pl.id, pl.full_name, v.option_ids, v.note
    from p
    join public.channels c on c.id = p.channel_id
    join public.players pl
      on pl.academy_id = p.academy_id
     and (c.team_id is null or pl.team_id = c.team_id)
    join public.player_guardians pg on pg.player_id = pl.id and pg.profile_id = auth.uid()
    left join public.poll_votes v
      on v.poll_id = p_poll and v.player_id = pl.id and v.profile_id = auth.uid()
   where p.type = 'availability'
     and app_private.is_channel_member(p.channel_id)
  union all
  select null, null, v.option_ids, v.note
    from p
    left join public.poll_votes v
      on v.poll_id = p_poll and v.profile_id = auth.uid() and v.player_id is null
   where p.type <> 'availability'
     and app_private.is_channel_member(p.channel_id);
$$;

grant execute on function public.my_poll_votes(uuid) to authenticated;

-- Who has not answered. Hosts only, and the point of the whole feature: a
-- coach needs the four families still missing, not the twenty who replied.
create or replace function public.poll_non_responders(p_poll uuid)
returns table (profile_id uuid, full_name text, player_id uuid, player_name text)
language plpgsql stable security definer set search_path = public as $$
declare
  p public.polls%rowtype;
  v_team uuid;
begin
  select * into p from public.polls where id = p_poll;
  if p.id is null or not app_private.is_channel_host(p.channel_id) then
    return;
  end if;
  select team_id into v_team from public.channels where id = p.channel_id;

  if p.type = 'availability' then
    return query
      select pg.profile_id, pr.full_name, pl.id, pl.full_name
        from public.players pl
        join public.player_guardians pg on pg.player_id = pl.id
        join public.profiles pr on pr.id = pg.profile_id
       where pl.academy_id = p.academy_id
         and (v_team is null or pl.team_id = v_team)
         and not exists (
           select 1 from public.poll_votes v where v.poll_id = p_poll and v.player_id = pl.id
         )
       order by pl.full_name;
  else
    return query
      select cm.profile_id, pr.full_name, null::uuid, null::text
        from public.channel_members cm
        join public.profiles pr on pr.id = cm.profile_id
       where cm.channel_id = p.channel_id
         and not exists (
           select 1 from public.poll_votes v
            where v.poll_id = p_poll and v.profile_id = cm.profile_id
         )
       order by pr.full_name;
  end if;
end;
$$;

grant execute on function public.poll_non_responders(uuid) to authenticated;
