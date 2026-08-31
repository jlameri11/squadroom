-- 0028_join_link_abuse_controls.sql
--
-- A join link is a public URL. Once it is on a club's Instagram rather than
-- in one WhatsApp group, anyone can POST to it as often as they like.
--
-- Coach approval means spam cannot get IN - which is the important half. But
-- an unthrottled link can still bury a coach's queue under a thousand fake
-- requests, and a queue nobody can face is a queue nobody reads.

-- 1. max_uses was decorative. The request route compared use_count to it, and
--    nothing ever incremented use_count, so a capped link was uncapped.
--    A "use" is someone actually joining, not someone asking.
create or replace function public.count_join_link_use()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved' and old.status <> 'approved' and new.join_link_id is not null then
    update public.join_links
       set use_count = use_count + 1
     where id = new.join_link_id;
  end if;
  return new;
end;
$$;

create trigger join_requests_count_use
  after update of status on public.join_requests
  for each row execute function public.count_join_link_use();

-- 2. Throttling. Only a hash of the address is kept: this is a spam control,
--    not a log of who looked at a football club.
create table public.join_attempts (
  id         bigserial primary key,
  ip_hash    text not null,
  link_id    uuid references public.join_links(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.join_attempts enable row level security;
-- No policies at all: written and read only by the server's service role.

create index join_attempts_recent_idx on public.join_attempts (ip_hash, created_at desc);
create index join_attempts_link_idx   on public.join_attempts (link_id, created_at desc);

create or replace function public.check_join_rate(p_ip_hash text, p_link uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_by_ip   integer;
  v_by_link integer;
begin
  delete from public.join_attempts where created_at < now() - interval '24 hours';

  select count(*) into v_by_ip
    from public.join_attempts
   where ip_hash = p_ip_hash and created_at > now() - interval '1 hour';

  select count(*) into v_by_link
    from public.join_attempts
   where link_id = p_link and created_at > now() - interval '1 hour';

  insert into public.join_attempts (ip_hash, link_id) values (p_ip_hash, p_link);

  -- A family with three children signing up on one phone is normal. Thirty
  -- in an hour from one address is not. A whole team joining at training is
  -- normal; two hundred in an hour through one link is not.
  return v_by_ip >= 10 or v_by_link >= 60;
end;
$$;

revoke execute on function public.check_join_rate(text, uuid) from public, anon, authenticated;
grant execute on function public.check_join_rate(text, uuid) to service_role;
