-- 0086: a registration waiting on you counts as something waiting on you.
--
-- `nav_badges.pending` has meant "join requests" since 0072, and the Admin tab
-- shows it as a dot. 0083 added a second queue in the same tab — program
-- registrations — and nothing told anybody it had anything in it. A coach
-- would have had to open Admin, then Programs, then a program, to find out
-- that four families were waiting.
--
-- The dot means "there is something for you to decide in Admin", and both
-- queues are exactly that, so they add. Splitting them into two numbers would
-- put two dots on one tab, which tells a coach less rather than more.
--
-- Also returns the two separately so a screen can say WHICH queue without a
-- second round trip. The tab adds them; the Admin hub lists them.

create or replace function public.nav_badges(p_academy uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public as $fn$
declare
  v_me        uuid := auth.uid();
  v_academy   uuid;
  v_is_staff  boolean;
  v_joins     integer;
  v_regs      integer;
begin
  if v_me is null then return null; end if;
  v_academy := app_private.my_academy(p_academy);
  if v_academy is null then return null; end if;

  -- Worked out once. It gated three separate subqueries before, which meant
  -- three evaluations of the same question on the most frequently called
  -- function in the product.
  v_is_staff := app_private.is_academy_coach(v_academy);

  if v_is_staff then
    select count(*) into v_joins
      from public.join_requests jr
     where jr.academy_id = v_academy and jr.status = 'pending';

    select count(*) into v_regs
      from public.program_registrations pr
     where pr.academy_id = v_academy and pr.status = 'pending';
  else
    v_joins := 0;
    v_regs := 0;
  end if;

  return jsonb_build_object(
    'academy_id', v_academy,
    'unread', (
      -- Muted channels are excluded. Muting says "do not buzz me", and a
      -- number on a tab is a quieter form of the same thing — but it is still
      -- the app asking for attention, which is what was declined.
      select coalesce(sum(c.unread_count), 0)::integer
        from public.my_channels(v_academy) c
       where not c.muted
    ),
    -- What the tab shows: one dot for one tab.
    'pending', v_joins + v_regs,
    -- And the breakdown, so the Admin hub can name the queue without asking
    -- again.
    'pending_joins', v_joins,
    'pending_registrations', v_regs,
    'is_staff', v_is_staff,
    'brand', (select a.primary_colour from public.academies a where a.id = v_academy),
    'org_count', (
      select count(*)::integer from public.academy_members am
       where am.profile_id = v_me and am.status = 'active'
    )
  );
end;
$fn$;

revoke execute on function public.nav_badges(uuid) from public, anon;
grant execute on function public.nav_badges(uuid) to authenticated;
