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
| 17 | **Digital player card** (photo, name, squad, number — match-day ID) | Nothing; the pieces exist (photo_url, number, squad) | **MISSING** | X-06, L-04 |
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

## Not parity, on purpose

- **Official registration.** PlayFootball's, never ours (CLAUDE.md Rules).
  We track its status (R-14); we do not do it.
- **Dribl's double approval** where the second approver is Dribl itself.
  The second approver here, when there is one, is the league (M9).
- **Any fee to the parent from us.** Squadroom charges clubs. Where Dribl
  adds a service fee to the family's bill, we do not and will not.
