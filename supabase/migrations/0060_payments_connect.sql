-- 0060_payments_connect.sql
--
-- Money goes from a parent to their academy. Squadroom never holds it, never
-- touches a card number, and never sees a bank detail.
--
-- That is Stripe Connect Express with DIRECT charges: the charge is created
-- on the academy's own connected account, so the money lands in their balance
-- and they are the merchant of record. The alternative - destination charges -
-- would route it through us first, which would make Squadroom liable for
-- every dispute about a kit order in a suburb we have never been to.
--
-- Four rules this schema exists to enforce:
--
-- 1. WE STORE NO CARD DATA AND NO BANK DETAILS. Not a masked pan, not a last
--    four. Stripe holds all of it; we hold an account id and a status. Any
--    future column that smells like a payment instrument is a mistake.
--
-- 2. AMOUNTS ARE INTEGER CENTS. Never a float. $49.90 is 4990, and a numeric
--    that can hold 49.900000001 will eventually charge somebody it.
--
-- 3. STRIPE IS THE SOURCE OF TRUTH FOR WHETHER MONEY MOVED. Our `status` is
--    a cache of what the webhook told us. A parent's browser saying "success"
--    is a claim, not a fact - it can be closed, faked, or replayed.
--
-- 4. PLATFORM BILLING IS NOT THIS. `academies.plan` is what an academy pays
--    Squadroom; this is what a parent pays an academy. They must never share
--    a code path, because a bug that crosses them charges the wrong party.

create table public.academy_billing (
  academy_id        uuid primary key references public.academies(id) on delete cascade,
  stripe_account_id text unique,
  -- Mirrored from Stripe's account.updated webhook. An academy can complete
  -- onboarding and still not be able to take money - identity verification
  -- can take days - so "connected" and "can charge" are separate questions.
  charges_enabled   boolean not null default false,
  payouts_enabled   boolean not null default false,
  details_submitted boolean not null default false,
  -- What Stripe is still waiting for, verbatim, so the settings screen can
  -- say "they need a photo of your licence" instead of "pending".
  requirements      jsonb,
  country           text not null default 'AU',
  currency          text not null default 'aud',
  -- Squadroom's cut, in basis points, taken as an application fee. Zero for
  -- now: the platform charges academies a plan, not a slice of a parent's
  -- payment, and changing that is a pricing decision rather than a code one.
  platform_fee_bps  integer not null default 0 check (platform_fee_bps between 0 and 2000),
  connected_at      timestamptz,
  updated_at        timestamptz not null default now()
);
alter table public.academy_billing enable row level security;

create trigger academy_billing_set_updated_at
  before update on public.academy_billing
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- payment_requests - "the U10 gala day is $45 a player"
--
-- A request is a thing to be paid, not a payment. It can be aimed at a whole
-- academy, one team, or the entrants of a competition, and it is answered per
-- player so a parent with three children pays three times and can see which
-- child is still outstanding.
-- ---------------------------------------------------------------------------
create table public.payment_requests (
  id             uuid primary key default gen_random_uuid(),
  academy_id     uuid not null references public.academies(id) on delete cascade,
  team_id        uuid,
  competition_id uuid references public.competitions(id) on delete set null,
  title          text not null check (length(btrim(title)) > 0),
  description    text,
  amount_cents   integer not null check (amount_cents between 100 and 500000),
  currency       text not null default 'aud',
  -- Per player rather than per family. A club charging per child must not
  -- have to create one request per child.
  per_player     boolean not null default true,
  due_on         date,
  closes_at      timestamptz,
  archived_at    timestamptz,
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint payment_requests_id_academy_key unique (id, academy_id),
  constraint payment_requests_team_fkey foreign key (team_id, academy_id)
    references public.teams (id, academy_id) on delete cascade
);
alter table public.payment_requests enable row level security;

create trigger payment_requests_set_updated_at
  before update on public.payment_requests
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- payments - one attempt to pay one request, for one player
-- ---------------------------------------------------------------------------
create table public.payments (
  id                  uuid primary key default gen_random_uuid(),
  academy_id          uuid not null references public.academies(id) on delete cascade,
  request_id          uuid not null,
  profile_id          uuid not null references public.profiles(id) on delete cascade,
  player_id           uuid,
  -- Stripe's ids. The session is how we find it again when the browser comes
  -- back; the payment intent is what the webhook talks about.
  stripe_session_id   text unique,
  stripe_payment_intent text unique,
  amount_cents        integer not null check (amount_cents >= 0),
  currency            text not null default 'aud',
  status              text not null default 'pending'
    check (status in ('pending','paid','failed','refunded','cancelled')),
  paid_at             timestamptz,
  refunded_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- One live attempt per player per request. A parent who taps Pay twice
  -- gets the same row, not two charges.
  constraint payments_one_per_player unique nulls not distinct (request_id, player_id),
  constraint payments_request_fkey foreign key (request_id, academy_id)
    references public.payment_requests (id, academy_id) on delete cascade,
  constraint payments_player_fkey foreign key (player_id, academy_id)
    references public.players (id, academy_id) on delete cascade
);
alter table public.payments enable row level security;

create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();

create index payments_request_idx on public.payments (request_id, status);
create index payments_profile_idx on public.payments (profile_id, created_at desc);
create index payment_requests_academy_idx on public.payment_requests (academy_id, created_at desc)
  where archived_at is null;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

-- Billing configuration is staff business. A parent needs to know whether
-- they CAN pay, which is what payment_requests being visible already tells
-- them - they never need the account id.
create policy academy_billing_staff on public.academy_billing for all to authenticated
  using ((select app_private.is_academy_staff(academy_id)))
  with check ((select app_private.is_academy_staff(academy_id)));

-- A request aimed at a team is only visible to that team. Aimed at nobody in
-- particular, everyone in the academy sees it.
create policy payment_requests_select on public.payment_requests for select to authenticated
  using (
    (select app_private.is_academy_member(academy_id))
    and (
      team_id is null
      or (select app_private.is_team_member(team_id))
      or (select app_private.is_academy_coach(academy_id))
    )
  );

create policy payment_requests_insert on public.payment_requests for insert to authenticated
  with check ((select app_private.is_academy_staff(academy_id)));
create policy payment_requests_update on public.payment_requests for update to authenticated
  using ((select app_private.is_academy_staff(academy_id)))
  with check ((select app_private.is_academy_staff(academy_id)));
create policy payment_requests_delete on public.payment_requests for delete to authenticated
  using ((select app_private.is_academy_staff(academy_id)));

-- A parent sees their own payments. Staff see the whole register, because
-- chasing who has not paid is the entire job.
create policy payments_select on public.payments for select to authenticated
  using (
    profile_id = (select auth.uid())
    or (select app_private.is_academy_staff(academy_id))
  );

-- Deliberately NO insert or update policy for anyone.
--
-- Every row here is written by the server with the service role, after Stripe
-- says so. If a parent could insert into this table they could mark
-- themselves paid, and the only thing standing between a club and an unpaid
-- season would be nobody having thought of it.
