-- 0053_platform_overview.sql
--
-- The platform owner's view: every organisation on Squadroom, how big it is,
-- and whether it is actually being used.
--
-- A security-definer function rather than a policy exemption. RLS says you
-- see the academies you belong to, and that rule should stay simple and true.
-- Punching a hole in it for one person would mean every future policy has to
-- remember the exception; a function that checks platform_admins once does
-- not.
--
-- Note what it does NOT return: no message bodies, no children, no contact
-- details. Being able to see that an academy exists and is quiet is what
-- running a platform requires. Reading its chat is not.

create or replace function public.platform_overview()
returns table (
  academy_id     uuid,
  name           text,
  slug           text,
  type           public.org_type,
  plan           text,
  created_at     timestamptz,
  members        integer,
  teams          integer,
  players        integer,
  channels       integer,
  messages       integer,
  last_activity  timestamptz
)
language sql stable security definer set search_path = public as $$
  select
    a.id, a.name, a.slug::text, a.type, a.plan, a.created_at,
    (select count(*)::integer from public.academy_members m
      where m.academy_id = a.id and m.status = 'active'),
    (select count(*)::integer from public.teams t
      where t.academy_id = a.id and t.status = 'active'),
    (select count(*)::integer from public.players p where p.academy_id = a.id),
    (select count(*)::integer from public.channels c where c.academy_id = a.id),
    (select count(*)::integer from public.messages msg where msg.academy_id = a.id),
    greatest(
      (select max(msg.created_at) from public.messages msg where msg.academy_id = a.id),
      (select max(m.joined_at)   from public.academy_members m where m.academy_id = a.id),
      a.created_at
    )
  from public.academies a
  where app_private.is_platform_admin()
  order by greatest(
    (select max(msg.created_at) from public.messages msg where msg.academy_id = a.id),
    a.created_at
  ) desc nulls last;
$$;

grant execute on function public.platform_overview() to authenticated;

-- Totals, so the page opens with the number that matters rather than making
-- someone add up a list.
create or replace function public.platform_totals()
returns table (
  organisations integer,
  people        integer,
  teams         integer,
  players       integer,
  messages      integer,
  competitions  integer,
  active_7d     integer
)
language sql stable security definer set search_path = public as $$
  select
    (select count(*)::integer from public.academies),
    (select count(*)::integer from public.profiles),
    (select count(*)::integer from public.teams where status = 'active'),
    (select count(*)::integer from public.players),
    (select count(*)::integer from public.messages),
    (select count(*)::integer from public.competitions),
    -- An academy that has said something this week. The only honest measure
    -- of whether this is being used.
    (select count(distinct academy_id)::integer from public.messages
      where created_at > now() - interval '7 days')
  where app_private.is_platform_admin();
$$;

grant execute on function public.platform_totals() to authenticated;
