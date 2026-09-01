-- 0054_calendar_feed.sql
--
-- "Add to calendar" one fixture at a time is the wrong shape of help. A
-- parent wants the season in their phone once, and every change after that to
-- arrive on its own - which is exactly what a subscribed calendar does and a
-- downloaded file does not.
--
-- A calendar app cannot log in. It fetches a URL, unauthenticated, every few
-- hours. So the URL has to carry its own proof, which makes it a bearer
-- token, with all the care that implies:
--
--   * random and long, never guessable from a user id
--   * revocable, and regenerating invalidates the old one immediately
--   * scoped to ONE person's own fixtures, so a leaked link exposes that
--     family's schedule and nobody else's
--   * no names of other children, ever - a leaked calendar should read as
--     "my kid's games", not as a roster
--
-- See 0055: this function was declared STABLE and then wrote to a row, which
-- made every fetch fail.

create table public.calendar_feeds (
  profile_id  uuid primary key references public.profiles(id) on delete cascade,
  token       text not null unique default encode(gen_random_bytes(24), 'hex'),
  created_at  timestamptz not null default now(),
  last_read_at timestamptz,
  read_count  integer not null default 0
);
alter table public.calendar_feeds enable row level security;

create policy calendar_feeds_own on public.calendar_feeds for all to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

-- Mint on demand, and rotate on request. Rotating replaces the token, so a
-- link already in somebody else's calendar app stops working on its next
-- refresh.
create or replace function public.my_calendar_token(p_rotate boolean default false)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_token text;
begin
  if auth.uid() is null then
    raise exception 'must be signed in' using errcode = '42501';
  end if;

  if p_rotate then
    update public.calendar_feeds
       set token = encode(gen_random_bytes(24), 'hex'), created_at = now(),
           last_read_at = null, read_count = 0
     where profile_id = auth.uid()
    returning token into v_token;
  else
    select token into v_token from public.calendar_feeds where profile_id = auth.uid();
  end if;

  if v_token is null then
    insert into public.calendar_feeds (profile_id)
    values (auth.uid())
    on conflict (profile_id) do update set token = public.calendar_feeds.token
    returning token into v_token;
  end if;

  return v_token;
end;
$$;

revoke execute on function public.my_calendar_token(boolean) from public, anon;
grant execute on function public.my_calendar_token(boolean) to authenticated;
