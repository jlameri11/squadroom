# Registration — as close to Dribl as possible (Joey, 10 Nov 2026)

**Status: in progress (11 Nov 2026).** Part C is done; this is the queue
now, then the SPL Season 4 simulation (`SIMULATION.md`). Commit and push
hourly; Joey says when the next deploy is.

| Gap | State |
|---|---|
| 1. Pay timing per program | **Done** — 0262, `/api/register/pay`, `lib/stripe/refund.ts`; test-rls 214, `test-pay-now` (Stripe test mode) |
| 2. Photo step | **Done** — 0263, `/api/register/photo`, `academies.photo_required` (Settings → Club); test-rls 215, `test-registration-photo` |
| 3. Active & Creative Kids voucher | **Done** — 0264, `apply_active_kids_voucher`, `active_kids_to_redeem`, `academies.active_kids_provider` (Settings → Club), the Pay now card; test-rls 216, `test-active-kids`, `test-pay-now` §5 |
| 4. Family dashboard | next |
| 5. Find a club | queued |
| 6. Register as | queued |
| 7. Club review | queued |
| 8. Save and resume | queued |
| 9. Receipts | queued |
| 10. Card fee pass-through | queued |

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
