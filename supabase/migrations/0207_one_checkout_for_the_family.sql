-- 0207: one checkout for the family, and the league paid online.
--
-- The Stripe halves, now that there is a test key (3 Nov 2026).
--
--   siblings   A parent with two children on the same request pays once:
--              one Checkout Session, a line per child, a payments row per
--              child sharing the session. The old uniqueness — one row per
--              session, one per payment intent — assumed one child per
--              checkout; it becomes one row per (session, request, child,
--              instalment), and the intent is indexed, not unique.
--   the league A club pays a competition's entry fee online: the session is
--              on the league's connected account, and the entry_fees row
--              remembers it so the webhook can mark it paid by Stripe.

alter table public.payments drop constraint if exists payments_stripe_session_id_key;
alter table public.payments drop constraint if exists payments_stripe_payment_intent_key;
alter table public.payments drop constraint if exists payments_one_per_session_child;
alter table public.payments
  add constraint payments_one_per_session_child unique nulls not distinct (stripe_session_id, request_id, player_id, instalment_seq);
create index if not exists payments_intent_idx on public.payments (stripe_payment_intent) where stripe_payment_intent is not null;

alter table public.entry_fees
  add column if not exists stripe_session_id text,
  add column if not exists stripe_payment_intent text;
create index if not exists entry_fees_session_idx on public.entry_fees (stripe_session_id) where stripe_session_id is not null;
