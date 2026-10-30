# Dribl Connect parity — player registration

Joey's rule, 29 Oct 2026: **registration must match everything Dribl Connect
does for player registration.** This file is the checklist. Each row maps to
a spec ID (`SQUADROOM_SPEC.md`) or a build-plan item, and its status is kept
in step with the code. What Dribl does is taken from `DRIBL_INTEL.md` §
"Registration (Connect)" — evidence-rated there — not from memory.

Statuses: **DONE** · **PARTIAL** (what is missing is named) · **MISSING** ·
**BLOCKED** (on what).

| # | Dribl Connect does | Squadroom | Status | Where |
|---|---|---|---|---|
| 1 | Products: squad, social/summer comp, holiday program, add-ons; price, capacity, dates, waitlist | Programs by `kind`, price, capacity, birth-year eligibility, open/close, waitlist enforced by trigger | **DONE** | R-01 |
| 2 | Public registration form, no account needed | `/{slug}` front door → `/{slug}/register`, coach approval as the identity gate | **DONE** | G-02, R-02 |
| 3 | Emergency contacts | On `player_medical`; family edits them in Settings → My family | **DONE** | R-05, R-17 |
| 4 | Registration photo | `players.photo_url` exists; **no upload at registration** | **PARTIAL** — upload needs the same anon-upload decision as file questions | R-05, NEEDS JOEY #6 |
| 5 | Custom questions per product | Builder, four types, validated, answers checked | **PARTIAL** — file-upload type not built (decision) | R-11 |
| 6 | **Government vouchers (Active Kids) and club vouchers** — a code with a value, applied at checkout | Nothing | **MISSING** → new **B-07**: voucher code + value per registration; Active Kids is a $-value code the club redeems with Service NSW, so we record code, value, and the net; club vouchers are our own promo codes | B-03, **B-07** |
| 7 | **Fee split per product** — e.g. $100 to the association + $165 to the club | Fees go to one connected account (the academy's). No split | **MISSING** → **B-09** (academy side) and **L-02** (league side): one checkout, two transfers, each party's share landing in its own Stripe account; Squadroom still takes nothing | **B-09**, L-02 |
| 8 | **Payment: card, bank transfer, or pay later** via Stripe Connect Express | Card only (and untested — no Stripe key). `payment_required=false` is the nearest thing to pay later | **PARTIAL** → **B-08**: bank transfer (Stripe `au_becs_debit`) and an explicit "pay later by [date]" with a reminder | B-01, **B-08**, NEEDS JOEY #1 |
| 9 | Instalments | Built in 0102; **no UI turns it on**; no retry on failure | **PARTIAL** | B-02 |
| 10 | Sibling / family discounts | Built in 0102/0103; **no UI turns it on** | **PARTIAL** | B-03 |
| 11 | Several children in one checkout | One child per checkout | **MISSING** | R-04 |
| 12 | Optional merch step at checkout | Nothing purchasable | **MISSING** | M1 merch add-ons |
| 13 | Team nomination step | Nothing | **MISSING** | L-02 (league mode) |
| 14 | **Team Creator / Team Link** — a captain registers a team, teammates join with a code | Join codes exist for a squad (X-21): six characters, said at training, coach approval. **No "captain creates the team" flow**, and the code joins a chat/squad, not a registration | **PARTIAL** → **L-16** tournament/team entry: a team registers and pays as one, and members join it by code | X-21, L-16 |
| 15 | Double approval (club, then Dribl) | Single club approval; bulk approve | **DONE, by design** — there is no second organisation to approve unless a league runs the competition (M9), where the league's acceptance of a club's entry is the second step | R-07, L-02 |
| 16 | **Deregistration with full or partial refund, cut-off dates** | Per-program cut-off and after-share; family or club withdraws; refund computed and recorded; treasurer issues on the connected account | **DONE** (the Stripe call itself untested until the key) | R-15, B-04 |
| 17 | **Digital player card** (photo, name, squad, number — match-day ID) | `/card/[playerId]` with a private photo (signed links), squad, number, DOB, FFA number, PlayFootball status. Opens for the family and the club's coaches; for the league's officials while the child is on a season squad; and for the opposition's manager on match day, from a name on the sheet | **DONE** | X-06, L-04 |
| 18 | Consents / terms per product, versioned | Versioned documents; the answer recorded; withdraw from My family | **DONE** | R-06, R-17 |
| 19 | Official registration status (PlayFootball) shown per player | Status + FFA number on the roster and on My family; weekly reminder to the family before round one | **DONE** | R-14 |
| 20 | Registration data export | Finance CSVs (every fee per child; totals by program, squad, family). A registrations-only export (who registered for what, with answers) is still to do | **PARTIAL** | B-05 |

## What this changes in the build order

Nothing is reordered. These land inside **M1 + M6** as already agreed:
**B-07** vouchers, **B-08** bank transfer / pay later and **B-09** the fee
split are the three new IDs, and all three sit on the Stripe test key
(NEEDS JOEY #1), as do 9–11 and 16. The non-Stripe ones — 4, 5, 12 (merch
*catalogue* is a table; the charge needs the key), 14, 17, 19, 20 — are
buildable now and are being built now, in that order after R-17.

## Squadi parity (added 30 Oct 2026 from `SQUADI_INTEL.md` §6A–B)

Squadi runs Football Queensland, Northern NSW, Football West and (from Dec
2025) Football NT. What it does that Dribl does not, and that the SPL will
expect. Same statuses as above.

| # | Squadi does | Squadroom | Status | Where |
|---|---|---|---|---|
| S1 | PlayFootball first, then "Competition Access" (Circular 26-02) | Per-program requirement; FFA/FIFA ID captured; approval blocked until confirmed (route and trigger); export import; fee-disclosure tick per season | **DONE** (0162, 30 Oct) | R-18 |
| S2 | Team-sheet lock at T-30/T-15, referee-only edits after | — | MISSING | L-17 |
| S3 | Scorer handoff, referee verifies, typed Confirm | Both sides enter; a mismatch is a dispute (L-05) | PARTIAL — no handoff or typed confirm | L-18 |
| S4 | Match lifecycle Editable → Ended → correction request | Final is final; organiser rules on disputes | PARTIAL — no correction request | L-19 |
| S5 | Card accumulation, auto-suspension, sheet block, sanction codes, "one card away" push | Accumulation, auto-suspension, sheet block (L-08) | PARTIAL — no warning push, no sanction codes | L-20 |
| S6 | Attendance-driven finals eligibility; borrowing caps | Playing up by rank (L-03) | MISSING | L-21 |
| S7 | Forfeit request coach → club → league | Organiser forfeits (L-09) | PARTIAL — no request chain | L-22 |
| S8 | Fixture Flowing with club-to-club chat on a fixture | — | MISSING | L-23 |
| S9 | Draw quality summary; field-impact pop-up; one source of truth | Draw generation with clash avoidance | PARTIAL — no quality view | L-24 |
| S10 | Referees: accept/decline with reason, late-decline block, self-appointment, club-allocated refs, Connect payouts (parent for U18), payments in app | Pool, block-outs, offer/accept/decline with a note, withdraw, check-in, report (L-06) | PARTIAL — payouts and the rest are L-07/L-25 | L-06, L-07, L-25 |
| S11 | Live match-day ops dashboard | — | MISSING | L-26 |
| S12 | Nominations: drag into teams, propose division, lock on submit, DOB override | Entries per division | PARTIAL | L-27 |
| S13 | Bulk score upload, bulk reschedule, move a competition | Call off a day / ground (L-09) | PARTIAL | L-28 |
| S14 | Multi-level fee split, each level refunds its share; finance per org | Fee split B-09 (Stripe-blocked) | MISSING | B-10 |
| S15 | De-registration approval chain with automatic refunds; voucher carve-outs | Withdraw with refund (R-15) | PARTIAL | B-11 |
| S16 | Named voucher types with limits and expiry | Vouchers B-07 (Stripe-blocked) | MISSING | B-12 |
| S17 | Direct debit, Afterpay | Card and bank transfer (B-08) | MISSING — and we add **pay instalments early**, which Squadi cannot | B-13 |
| S18 | Notice of Offer to returning players | Rollover (R-12) + offers (R-13) | PARTIAL | R-19 |
| S19 | Shop at checkout and standalone, inventory, variants, shipping, partial refunds | Kit add-ons at checkout (catalogue) | PARTIAL | B-14 |
| S20 | Mandatory 2FA for admins | Magic link / password | MISSING | S-07 |
| S21 | Registration dashboard: new vs returning, age, gender, targets | Queue counts | MISSING | R-20 |

## Beyond both (added 30 Oct 2026 from `SQUADI_INTEL.md` §6C–D)

What neither Squadi nor Dribl does, and what their users say they hate.
The first table is M10; the second is a set of design rules now in
CLAUDE.md, each checked on every screen rather than built once.

| # | Neither has it | Squadroom | Status | Where |
|---|---|---|---|---|
| X1 | Respect / behaviour marks with a league dashboard | — | MISSING | W-01 |
| X2 | Concussion register with sheet lockout and clearance upload | — | MISSING | W-02 |
| X3 | Safeguarding gate (WWCC / training lapse blocks rosters, chat, sheets); reportable-conduct register | WWCC gate on coaching (0120) | PARTIAL | W-03 |
| X4 | Children's privacy consent centre | Versioned consents, withdrawable (R-06, R-17) | PARTIAL | W-04 |
| X5 | Auto referee assignment with preview and undo | Manual with availability (L-06) | MISSING | W-05 |
| X6 | Match QR check-in for referees | Tap check-in in a window (L-06) | PARTIAL | W-06 |
| X7 | Club-to-club change requests; attendance blocked on overdue fees | — | MISSING | W-07 |
| X8 | Auto-translated chat | — | MISSING | W-08 |
| X9 | Video, development plans, pitch booking, casual sessions, insurance, streaming, lotto | — | LATER | W-09 |

| # | Users hate this in both | Squadroom's rule (CLAUDE.md "Design rules") | Status |
|---|---|---|---|
| D1 | "Do it on the website" | Everything works on the phone; no screen is desktop-only | Held so far: every screen checked at 375px |
| D2 | Confusing family/child profiles | Profiles are the child's; parents edit their own child's photo | DONE (X-06, R-17) |
| D3 | Notifications that open the home screen | Every push carries the exact item's URL | DONE (every kind has a `url`) |
| D4 | Ladders nobody can audit | Tap a ladder row to see how every point was earned | PARTIAL — adjustments listed (L-10); per-row breakdown not yet |
| D5 | Draws published with holes | A sanity check before publishing (empty slots, travel, same-club clashes) | MISSING (L-24) |
| D6 | "All photos" permission | Ask for selected photos only, never the whole library | DONE (the card asks for one file) |
| D7 | Support that blames organisers | Fast human replies, a match-day hotline, staged rollouts, never blaming publicly | Operational — G-03 |
| D8 | Stacked fees | One clear total to a family; Squadroom never charges parents | DONE by rule (CLAUDE.md) |

## Not parity, on purpose

- **Official registration.** PlayFootball's, never ours (CLAUDE.md Rules).
  We track its status (R-14); we do not do it.
- **Dribl's double approval** where the second approver is Dribl itself.
  The second approver here, when there is one, is the league (M9).
- **Any fee to the parent from us.** Squadroom charges clubs. Where Dribl
  adds a service fee to the family's bill, we do not and will not.
