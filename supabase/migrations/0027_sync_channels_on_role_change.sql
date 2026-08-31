-- 0027_sync_channels_on_role_change.sql
--
-- Promoting a parent to coach did nothing.
--
-- on_academy_member_added fires AFTER INSERT, so the coaches channel is
-- joined when a member is created and never again. A parent promoted to
-- coach kept exactly the access they had, and the promotion looked like it
-- had worked - the role badge changed, the channel did not. Demotion was
-- worse: an ex-coach stayed in the coaches channel indefinitely.

create or replace function public.on_academy_role_changed()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_coaches uuid;
  v_wide    uuid;
begin
  if new.role is not distinct from old.role or new.status <> 'active' then
    return new;
  end if;

  v_coaches := public.ensure_system_channel(new.academy_id, 'coaches');
  v_wide    := public.ensure_system_channel(new.academy_id, 'academy_wide');

  if new.role in ('owner', 'admin', 'coach') then
    perform public.add_to_channel(v_coaches, new.profile_id);
  else
    -- Demoted. Losing the coaches channel is the point of demoting someone.
    delete from public.channel_members
     where channel_id = v_coaches and profile_id = new.profile_id;
  end if;

  -- Staff host the academy-wide channel; everyone else is a member of it.
  update public.channel_members
     set role = case when new.role in ('owner', 'admin') then 'host'::public.channel_member_role
                     else 'member'::public.channel_member_role end
   where channel_id = v_wide and profile_id = new.profile_id;

  return new;
end;
$$;

create trigger academy_members_role_changed
  after update of role on public.academy_members
  for each row execute function public.on_academy_role_changed();
