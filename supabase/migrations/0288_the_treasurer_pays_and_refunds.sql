-- 0288 — the Treasurer pays and refunds (found by the simulation's Stripe
-- test-mode scenarios, 19 Nov 2026).
--
-- A club's Treasurer — the money role of 0236, whose Home says "1 refund to
-- issue" and who sees what the club owes the league — could do neither: the
-- refund and entry-fee routes took owner/admin only, and the entry fee row
-- itself was hidden from them (entry_fees_select knew "staff" but not the
-- money role). Two things:
--
-- 1. A public wrapper, i_may_run_club(p_academy, p_area), so the app's routes
--    can ask the same question the policies ask (app_private is not reachable
--    from the app). It says only what the caller may do.
-- 2. entry_fees are readable by whoever runs the entering club's money.

create or replace function public.i_may_run_club(p_academy uuid, p_area text)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(app_private.may_run_club(p_academy, p_area), false);
$$;
revoke execute on function public.i_may_run_club(uuid, text) from public, anon;
grant execute on function public.i_may_run_club(uuid, text) to authenticated;

drop policy if exists entry_fees_select on public.entry_fees;
create policy entry_fees_select on public.entry_fees for select to authenticated using (
  (select app_private.may_run(entry_fees.competition_id, 'competition'))
  or (club_academy_id is not null and (
    (select app_private.is_academy_staff(entry_fees.club_academy_id))
    or (select app_private.may_run_club(entry_fees.club_academy_id, 'money'))))
);
