-- 0065_squadroom_never_charges_parents.sql
--
-- Squadroom's money comes from clubs, on a plan. It never takes a slice of
-- what a parent pays.
--
-- 0060 left `platform_fee_bps` in place, defaulting to 0, on the reasoning
-- that a per-transaction cut was "a pricing decision rather than a code one".
-- That was the wrong shape for a decision this firm. A dormant mechanism for
-- skimming a parent's payment is a thing somebody switches on later — in a
-- hurry, without reading this comment — and the first anyone hears of it is a
-- parent seeing $45.90 where the coach wrote $45.
--
-- So the mechanism goes. If the model ever changes, that is a migration and
-- a deliberate conversation, which is exactly the friction it deserves.
--
-- To be clear about what this does NOT remove: an academy charging its own
-- families for a gala day is untouched. That is the club's money moving from
-- a parent to the club, with Squadroom never in the flow of funds. What is
-- gone is any way for US to take a cut of it.

alter table public.academy_billing drop column platform_fee_bps;

comment on table public.academy_billing is
  'Stripe Connect state for one academy. Squadroom charges academies a plan
   (academies.plan) and takes NOTHING from what a parent pays their club —
   there is deliberately no application-fee column here to switch on.';
