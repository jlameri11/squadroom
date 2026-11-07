-- 0220: referee payouts through Stripe are gone (Joey, 3 Nov 2026: parked —
-- tracking only).
--
-- 0163 built referee payouts with Stripe in mind: a connected account per
-- referee, a transfer id per item, and 'stripe' as a way a run is paid.
-- Stripe refuses transfers between connected accounts, Joey parked payouts
-- the same evening, and the button and routes came out then; these three
-- were left "until a migration day" (NIGHT_LOG, NEEDS JOEY #13). Nothing
-- uses them, and squadroom-dev holds no value in any of them (checked
-- 7 Nov). A run is paid by bank or in cash, and the treasurer says which.

alter table public.referees drop column if exists stripe_account_id;
alter table public.referee_payment_items drop column if exists stripe_transfer_id;

alter table public.referee_payment_runs drop constraint if exists referee_payment_runs_paid_method_check;
alter table public.referee_payment_runs add constraint referee_payment_runs_paid_method_check
  check (paid_method is null or paid_method in ('bank', 'cash'));

create or replace function public.mark_referee_run_paid(p_run uuid, p_method text default 'bank')
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_run public.referee_payment_runs;
begin
  select * into v_run from public.referee_payment_runs where id = p_run;
  if v_run.id is null or not app_private.is_competition_organiser(v_run.competition_id) then
    raise exception 'only the organiser marks a run paid' using errcode = '42501';
  end if;
  if p_method not in ('bank', 'cash') then
    raise exception 'paid how? bank or cash' using errcode = '22023';
  end if;
  update public.referee_payment_items set status = 'paid', paid_at = now()
   where run_id = p_run and status = 'pending';
  update public.referee_payment_runs set status = 'paid', paid_at = now(), paid_method = p_method where id = p_run;
end;
$fn$;
