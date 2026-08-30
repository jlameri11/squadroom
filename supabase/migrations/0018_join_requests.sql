-- 0018_join_requests.sql
-- The no-signup join flow: a parent taps a team link, says who they are, and
-- waits for the coach to vouch for them.
--
-- No auth user exists at request time, so rows are written by the server with
-- the service role. Coaches read and decide through RLS as themselves.

create type public.join_request_status as enum ('pending', 'approved', 'declined', 'expired');

create table public.join_requests (
  id             uuid primary key default gen_random_uuid(),
  academy_id     uuid not null references public.academies(id) on delete cascade,
  team_id        uuid,
  join_link_id   uuid,

  -- What the person typed. Unverified by definition — the coach is the check.
  full_name      text not null check (length(btrim(full_name)) > 0),
  phone          text check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  children_names text[] not null default '{}',
  message        text,

  -- Only the hash is stored. The device keeps the secret; a database leak
  -- must not hand anyone a session.
  secret_hash    text not null,

  status         public.join_request_status not null default 'pending',
  profile_id     uuid references public.profiles(id) on delete set null,
  decided_by     uuid references public.profiles(id) on delete set null,
  decided_at     timestamptz,
  -- Set when the requesting device exchanges its secret for a session. One
  -- claim only: a request cannot mint two sessions.
  claimed_at     timestamptz,

  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null default now() + interval '14 days',

  constraint join_requests_id_academy_key unique (id, academy_id),
  constraint join_requests_team_fkey foreign key (team_id, academy_id)
    references public.teams (id, academy_id) on delete cascade,
  constraint join_requests_link_fkey foreign key (join_link_id, academy_id)
    references public.join_links (id, academy_id) on delete set null (join_link_id),
  constraint join_requests_decided_together
    check ((status in ('pending','expired')) = (decided_at is null))
);
alter table public.join_requests enable row level security;

create index join_requests_pending_idx
  on public.join_requests (academy_id, created_at desc) where status = 'pending';
create index join_requests_team_idx on public.join_requests (team_id) where status = 'pending';

create policy join_requests_select on public.join_requests for select to authenticated
  using (
    (select app_private.is_academy_staff(academy_id))
    or (team_id is not null and (select app_private.is_team_coach(team_id)))
  );

create policy join_requests_update on public.join_requests for update to authenticated
  using (
    (select app_private.is_academy_staff(academy_id))
    or (team_id is not null and (select app_private.is_team_coach(team_id)))
  )
  with check (
    (select app_private.is_academy_staff(academy_id))
    or (team_id is not null and (select app_private.is_team_coach(team_id)))
  );

-- No insert policy: requests come only from the server, which holds the
-- service role. A client cannot forge one on someone else's behalf.

create or replace function public.expire_stale_join_requests()
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  update public.join_requests
     set status = 'expired'
   where status = 'pending' and expires_at < now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.expire_stale_join_requests() from public, anon, authenticated;
grant execute on function public.expire_stale_join_requests() to service_role;
