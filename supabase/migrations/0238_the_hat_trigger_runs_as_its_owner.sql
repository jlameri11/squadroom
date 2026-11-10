-- 0238: the trigger that keeps a member's hats in step runs as its owner.
--
-- 0237's sync_member_roles was not SECURITY DEFINER, so it ran as whoever
-- wrote the row — the app's service role, or a signed-in person — and that
-- role may not execute app_private.strongest_role. Every write to a
-- membership from the app was refused with "permission denied for function
-- strongest_role" (found by the first dev run of test-many-hats and by
-- test-org-follows, whose throwaway owner never got their membership). The
-- same function, as its owner, like every other trigger function here.
create or replace function app_private.sync_member_roles()
returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if tg_op = 'INSERT' then
    if new.roles is null or new.roles = '{}' then
      new.roles := array[new.role];
    elsif not (new.role = any (new.roles)) then
      new.roles := new.roles || new.role;
    end if;
  else
    if new.roles is distinct from old.roles then
      if new.roles is null or new.roles = '{}' then
        raise exception 'a member holds at least one role — remove the membership instead' using errcode = '22023';
      end if;
    elsif new.role is distinct from old.role then
      new.roles := array_remove(old.roles, old.role);
      if not (new.role = any (new.roles)) then
        new.roles := new.roles || new.role;
      end if;
    end if;
  end if;
  select coalesce(array_agg(distinct r), '{}') into new.roles from unnest(new.roles) r;
  new.role := app_private.strongest_role(new.roles);
  return new;
end;
$fn$;
revoke execute on function app_private.sync_member_roles() from public, anon, authenticated;
