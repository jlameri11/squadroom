-- 0262: pay now, or pay once accepted — per program
--
-- The registration brief (Joey, 10 Nov 2026), gap 1: pay timing per
-- program. "Pay now" charges on submit — the family pays the fee on Stripe
-- Checkout straight after the public form, before the club has looked —
-- and a decline refunds in full without anyone tapping. "Pay after
-- approval" is what every program did until now (the fee is asked once the
-- club accepts), and stays the default: a trial or a selective squad should
-- never take money it may have to give back.
--
-- The payment is written against the REQUEST (payments.registration_request_id)
-- because the player does not exist until approval; approval attaches the
-- player (the route). A refund for a declined request has no player and no
-- program registration to point at, so those two columns on refunds become
-- nullable; the row carries the child's name in its note. A pay-now request
-- that lapses unpaid is nothing; one that lapses paid asks the Treasurer for
-- its refund the way a withdrawal does.

alter table public.programs
  add column if not exists pay_timing text not null default 'after_approval' check (pay_timing in ('now', 'after_approval'));

alter table public.payments
  add column if not exists registration_request_id uuid references public.registration_requests(id) on delete set null;
create index if not exists payments_registration_request on public.payments (registration_request_id) where registration_request_id is not null;

alter table public.refunds alter column player_id drop not null;
alter table public.refunds alter column registration_id drop not null;

-- The sweep: a lapsed pay-now request that was paid asks for its refund.
create or replace function public.expire_stale_registrations()
returns integer
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_n integer;
begin
  with gone as (
    update public.registration_requests
       set status = 'expired'
     where status = 'pending' and expires_at < now()
    returning id, academy_id, child_name
  ),
  owed as (
    insert into public.refunds (academy_id, amount_cents, payment_id, player_id, registration_id, reason, note, status)
    select p.academy_id, p.amount_cents, p.id, null, null, 'expired',
           'Pay-now registration for ' || g.child_name || ' lapsed before the club decided', 'requested'
      from gone g
      join public.payments p on p.registration_request_id = g.id and p.status = 'paid' and p.refunded_at is null
     where not exists (select 1 from public.refunds r where r.payment_id = p.id)
    returning 1
  )
  select count(*)::integer into v_n from gone;
  return v_n;
end;
$fn$;

-- The public page's programs carry their pay timing (0122's reader, one key more).
create or replace function public.public_programs(p_slug text)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_academy public.academies;
begin
  select * into v_academy from public.academies where slug = lower(btrim(p_slug));
  if v_academy.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'academy', jsonb_build_object(
      'name', v_academy.name,
      'slug', v_academy.slug,
      'primary_colour', v_academy.primary_colour,
      'logo_url', v_academy.logo_url,
      'timezone', v_academy.timezone
    ),
    'programs', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id,
               'name', p.name,
               'kind', p.kind,
               'description', p.description,
               'season', p.season,
               'born_from_year', p.born_from_year,
               'born_to_year', p.born_to_year,
               'gender', p.gender,
               'starts_on', p.starts_on,
               'ends_on', p.ends_on,
               'closes_at', p.closes_at,
               'questions', p.questions,
               'payment_required', p.payment_required,
               'pay_timing', p.pay_timing,
               'amount_cents', (
                 select pr.amount_cents from public.payment_requests pr
                  where pr.id = p.payment_request_id
               ),
               'spots_left', app_private.program_spots_left(p.id),
               'waitlist_enabled', p.waitlist_enabled,
               'requires_official_rego', p.requires_official_rego
             ) order by p.starts_on nulls last, p.name)
        from public.programs p
       where p.academy_id = v_academy.id
         and p.status = 'open'
         and (p.opens_at is null or p.opens_at <= now())
         and (p.closes_at is null or p.closes_at > now())
    ), '[]'::jsonb),
    'consents', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id,
               'kind', c.kind,
               'title', c.title,
               'version', c.version,
               'body', c.body,
               'required', c.required
             ) order by c.required desc, c.title)
        from public.consent_documents c
       where c.academy_id = v_academy.id
         and c.published_at is not null
         and c.retired_at is null
    ), '[]'::jsonb)
  );
end;
$fn$;
