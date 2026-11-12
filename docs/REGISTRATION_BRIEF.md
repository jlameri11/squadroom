# Registration — as close to Dribl as possible (Joey, 10 Nov 2026)

**Status: done (12 Nov 2026).** All ten gaps are built, applied to dev and
proven (0262–0270); the brief's test list is covered below. Next in the
queue: Joey's sign-up and account creation brief (`BUILD_PLAN.md` item 17),
then the "Feels instant" pass, then the SPL Season 4 simulation. Commit and
push hourly; Joey says when the next deploy is.

| Gap | State |
|---|---|
| 1. Pay timing per program | **Done** — 0262, `/api/register/pay`, `lib/stripe/refund.ts`; test-rls 214, `test-pay-now` (Stripe test mode) |
| 2. Photo step | **Done** — 0263, `/api/register/photo`, `academies.photo_required` (Settings → Club); test-rls 215, `test-registration-photo` |
| 3. Active & Creative Kids voucher | **Done** — 0264, `apply_active_kids_voucher`, `active_kids_to_redeem`, `academies.active_kids_provider` (Settings → Club), the Pay now card; test-rls 216, `test-active-kids`, `test-pay-now` §5 |
| 4. Family dashboard | **Done** — 0265, `/settings/registrations` (`my_registrations`), `/receipts/{payment}` (`payment_receipt`); test-rls 217, `test-my-registrations` |
| 5. Find a club | **Done** — 0266, `/clubs` (`public_find_clubs`), `academies.suburb` (Settings → Club), the Clubs strip on `/c/{slug}` (`public_competition_clubs`); test-rls 218, `test-find-a-club` |
| 6. Register as | **Done** — 0267, `register_as` on the form and the queue, `confirm_wwcc_check`, the approval branch in `/api/register/approve`; test-rls 219, `test-register-as` |
| 7. Club review | **Done** — 0268, filters + Needs info (`request_registration_info`, `/api/register/reply`) + the jersey with the squad + Deregister (`withdraw_registration`); test-rls 220, `test-club-review` |
| 8. Save and resume | **Done** — 0269, `registration_drafts` (the account), `/api/register/draft` (the code); test-rls 221, `test-save-resume` |
| 9. Receipts | **Done** — on screen (0265), the push on landing and on a refund (0270, trigger), the email once Resend exists (`lib/mail/receipt.ts`); test-rls 222, `test-card-fee`, `test-pay-now` §6 |
| 10. Card fee pass-through | **Done** — 0270, `academies.card_fee_passthrough` (Settings → Club, off), `app_private.card_fee_cents`, its own line on the quote, the Payments row, the Pay now card, Checkout and the receipt; test-rls 222, `test-card-fee`, `test-pay-now` §6 |

## The brief's tests, and where each is proven

| Test | Suite |
|---|---|
| a family registers two kids + a parent as coach in one checkout | `test-pay-now` §7 — `/api/register/pay` takes several registrations from one phone into one Checkout; the coach's registration has nothing to pay and is approved after the WWCC tick, the parent hat kept |
| pay-now reject auto-refunds | `test-pay-now` §3 and §5 |
| voucher deducted and listed for redemption | `test-active-kids`; `test-pay-now` §5 |
| photo private until approved | `test-registration-photo`; test-rls 215 |
| approve → team + jersey in one step | `test-club-review` §3; test-rls 220 |
| draft resumes on another device | `test-save-resume`; test-rls 221 |
| under-13 never gets an account | unchanged: a child's registration makes the parent's account, never the child's (0214; `test-adults-only`, `player_logins`) |

## The brief, verbatim

> Registration — as close to Dribl as possible, no PlayFootball link (Joey, 10 Nov). Reuse what exists (R-01/R-02/R-04/R-05/R-11/R-15, B-01–B-08); only fill gaps. Keep it simple.
>
> FAMILY FLOW (mirror Dribl's order): Find club → season → sign in/create account → who (pick a saved family member to prefill, or add) → details (match existing record on name + gender + DOB) → emergency contacts → PHOTO → choose product → extra questions → optional extras (kit add-on, team link) → vouchers + terms → "Register someone else?" (all into one checkout) → pay → confirmation + receipt.
>
> GAPS TO BUILD:
> 1. PAY TIMING per program: "Pay now" (default for season registrations — charge on submit, automatic full refund if the club rejects) or "Pay after approval" (trials, selective squads — current behaviour).
> 2. PHOTO step: passport-style rules shown (face visible, no hat/sunglasses, recent); in-app crop + resize; private bucket; staff-only until approved; then on the player card and match-sheet ID. Club can make it required.
> 3. ACTIVE & CREATIVE KIDS VOUCHER (NSW, $50, twice a year): club setting "We're a provider"; family enters voucher number + child's details at checkout; amount taken off; Treasurer gets a "Vouchers to redeem in Service NSW" list with a "Redeemed" tick. Never call Service NSW.
> 4. FAMILY DASHBOARD (Settings → My registrations): each registration with status (Submitted · Approved · Waitlisted · Rejected · Withdrawn), saved People (reuse/edit), Payments & receipts (download).
> 5. FIND A CLUB: public page /clubs — search by name or suburb; each club card → its open programs. A league's public page also lists its clubs.
> 6. REGISTER AS: Player · Coach · Manager · Volunteer · Referee. Adults (staff/referees) give WWCC number + expiry (feeds S-03) and photo; approval gives them the right role automatically.
> 7. CLUB REVIEW: list with filters; Approve / Reject / "Needs info" (sends a note back to the family); bulk approve; on approve, pick team and jersey number in the same step (existing pool); after approval it's Deregister (R-15), not Reject.
> 8. SAVE AND RESUME: drafts saved to the account (not just the browser) — finish on another device.
> 9. RECEIPTS: on-screen + push now; emailed receipts once Resend is set.
> 10. Optional club setting, default OFF: pass the card processing fee to families, shown clearly before paying.
>
> TESTS: a family registers two kids + a parent as coach in one checkout; pay-now reject auto-refunds; voucher deducted and listed for redemption; photo private until approved; approve → team + jersey in one step; draft resumes on another device; under-13 never gets an account.
> Do after Part C (Dribl gaps); fold the registration-photo item from Part C into this. Commit and push hourly.

## Notes taken while queued

- What already exists to reuse (from the Big Club audit, `BIG_CLUB_MODE.md`
  §B): programs and registrations (0083+), `registration_requests` and the
  public register form (0122), one family checkout (0207), the sibling
  ladder, instalments, vouchers with named types (`government` among them,
  0193), refunds and `withdraw_registration` (0145), consents (0084),
  `program_registrations.answers` (R-11), `squad_numbers` (the jersey pool),
  the registration dashboard, PlayFootball status (R-14, kept as status only
  — "no PlayFootball link" here means no step in the flow, not the end of
  the status).
- The Active & Creative Kids voucher is a `vouchers` kind `government` with a
  number and the child's details, and a Treasurer list; nothing is ever sent
  to Service NSW.
- "Pay now, refund on reject" needs the webhook's existing refund path
  (`/api/payments/refund`, `refunds`) and a program flag `pay_timing`.
- The card-fee pass-through is a per-club setting, default off, and the
  quote must show it as its own line before paying (the "one clear total"
  rule in CLAUDE.md still holds: one total, with the fee shown inside it).
