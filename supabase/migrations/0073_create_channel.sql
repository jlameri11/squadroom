-- 0073: starting a new chat.
--
-- Channels have only ever appeared automatically — one per team, one per age
-- group, one for the academy. Everything else a club talks about (a carnival
-- squad, the committee, the parents organising the end-of-season BBQ) had
-- nowhere to go, which sends exactly those conversations back to WhatsApp.
--
-- One function rather than an insert plus a loop of member inserts, because
-- the half-done state is genuinely bad: a channel with a name, no members and
-- no host is invisible to everyone including the person who just made it, and
-- there is no screen from which to fix it.
--
-- Coaches and staff only. A product where any parent can spin up a channel
-- and add other people's families is a product that fragments in a fortnight
-- and has no-one accountable for what is in each room.

create or replace function public.create_channel(
  p_academy  uuid,
  p_name     text,
  p_team     uuid default null,
  p_members  uuid[] default '{}',
  p_mode     public.posting_mode default 'open'
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public as $fn$
declare
  v_me      uuid := auth.uid();
  v_channel uuid;
  v_name    text := btrim(coalesce(p_name, ''));
begin
  if v_me is null then
    raise exception 'must be signed in' using errcode = '42501';
  end if;

  if not app_private.is_academy_coach(p_academy) then
    raise exception 'only coaches and club admins can start a chat'
      using errcode = '42501';
  end if;

  if length(v_name) = 0 then
    raise exception 'a chat needs a name' using errcode = '22023';
  end if;

  if p_team is not null and not exists (
    select 1 from public.teams t where t.id = p_team and t.academy_id = p_academy
  ) then
    raise exception 'that team is not in this academy' using errcode = '42501';
  end if;

  insert into public.channels (academy_id, name, type, team_id, posting_mode, created_by)
  values (p_academy, v_name,
          case when p_team is not null then 'team' else 'custom' end,
          p_team, p_mode, v_me)
  returning id into v_channel;

  -- The creator hosts it. A channel whose only member cannot change its
  -- settings is a channel nobody can fix.
  insert into public.channel_members (channel_id, academy_id, profile_id, role)
  values (v_channel, p_academy, v_me, 'host');

  -- Everyone asked for, filtered to this academy. An id in an array from a
  -- browser is a request, not a fact.
  insert into public.channel_members (channel_id, academy_id, profile_id, role)
  select v_channel, p_academy, am.profile_id, 'member'
    from public.academy_members am
   where am.academy_id = p_academy
     and am.status = 'active'
     and am.profile_id = any(p_members)
     and am.profile_id <> v_me
  on conflict (channel_id, profile_id) do nothing;

  return v_channel;
end;
$fn$;

revoke execute on function public.create_channel(uuid, text, uuid, uuid[], public.posting_mode)
  from public, anon;
grant execute on function public.create_channel(uuid, text, uuid, uuid[], public.posting_mode)
  to authenticated;
