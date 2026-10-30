# Night log

Newest first. Each entry: what got done, what broke, and anything that needs
Joey. The **NEEDS JOEY** list below the summary is the one to read first —
every item on it is something no amount of building can get past.

---

## Morning summary — 30 Oct 2026 (overnight run)

**Built and pushed, each with its own suite, test-rls after every
migration (now 53 checks), every new screen checked at 375px in both
themes:** G-02 the club's front door · R-11 program questions (builder,
four types, validated) · R-07 bulk approve on both queues · R-17 Settings →
My family · B-02/B-03 instalment and family-discount settings · R-14
PlayFootball status with weekly family reminders · R-12 season rollover ·
R-13 trials → offer → pay · B-05 finance CSVs · R-15 withdraw with refund
before a cut-off · X-06 the player card with a private photo · R-02 the
three-step register flow with a resumable draft. Plus the sweep's fixes
(critical Next RCE, two anon-callable write paths, the push-queue counter)
and `docs/DRIBL_PARITY.md`, the Connect parity tracker you asked for.
Migrations 0131 → 0146. Nothing in the plan was dropped.

**Still blocked on the Stripe test key** (the one thing that unblocks the
most): the card charge itself, instalment retry, several children in one
checkout, vouchers, bank transfer / pay later, the league–club fee split,
and actually *issuing* a refund (everything up to the Stripe call is
built and tested).

**Needs you, in order of what it unblocks:** #1 Stripe test key · #7 a
Netlify token (production is at least three days stale and on the
vulnerable Next; I cannot deploy without one) · #6 file-upload questions
(a decision) · #8 may I delete the stray "NRIFA" organisation (its screen
bug is fixed).

**Broke:** nothing that stayed broken. Eleven of the suites' first runs
caught a bug in what they tested — each fixed the same hour and noted in
its commit.

### Morning summary — 29 Oct 2026

**Done:** the tidy-up (Step 0), the Step 1 plan (M9 and C-10 written into
the docs, two decisions recorded in CLAUDE.md), and the **project sweep Joey
asked for before building** — which paid for itself: a critical RCE in the
share-card renderer, two database write paths open to strangers (one could
un-cancel a called-off game), a null reason, and a push-queue counter that
never moved. All fixed, all asserted, audit at 0. Details under "Project
sweep". Tests no longer depend on a healthy dev server, and
`docs/SQUADROOM_SPEC.md` now matches the code — five statuses in it were
wrong, two of them saying work was blocked that has in fact been applied
for days.

**Broke:** nothing — no feature code was touched. But the tidy-up turned up a
**real pre-existing defect in the push queue** (the retry counter never
increments through the RPC path, so the retry cap never engages), written up
below. And a full `npm run test:all` can no longer be trusted on demand:
**34 of 58 suites could not sign anybody in**, which is the Supabase project's
**auth rate limit**, not a failure. Running the whole suite twice in an hour
is what exhausts it — I did exactly that tonight. The suites that need no
sign-in all passed: outbox 31, recurring 22, join-codes 16, league-draw 9,
project-guard 9, reminders 8, minor-dms 3, navigation 2.

**The one thing that would unblock the most work:** a Stripe **test** key.
It is free, it takes about three minutes, and it is currently the only thing
standing between us and eight of the registration and billing items Joey
asked for — one checkout for several children, the sibling discount,
instalments, promo codes, refunds, overdue reminders and the finance export.
Exact steps are in NEEDS JOEY below.

---

## Build log — 29 Oct 2026, overnight (M1 + M6, non-Stripe parts first)

| Item | Status | Proof |
|---|---|---|
| **G-02** `/{slug}` front door | **Done.** Crest, colour, open programs with price and places left, Register, the public draw. Cached, cookie-less, indexable; unknown slug is a 200 "not found". The app's tab bar was painting under it — fixed in the shell with one `isPublicPage` rule | test-public-academy 18, screens, navigation, a look at both themes |
| **R-11** program questions | **Done, four types.** Builder on the program screen; text / yes-no / pick-one / date; validated and normalised by a trigger; answers checked in the route; queue shows labels | test-program-questions 21 |
| R-11 file upload | **Not built — needs Joey** (below) | — |
| **R-07** bulk approve + assign | **Done, both queues.** Select → tick → one squad for all → Accept N; progress shown, failures named | test-bulk-approve 11, in a real browser at 375px |
| **R-17** Settings → My family | **Done.** Each child: about, squad and number, kit sizes (editable), medical and emergency (editable), agreements (view, withdraw, re-agree). A withdrawal by either parent registers at once | test-my-family 22, test-rls 46–47, screens both themes |
| **B-02 / B-03** admin UI | **Done, the non-Stripe half.** Club settings → Family discounts (the 0102 ladder, as percent); "Ask for a payment" → paid in 1–12 instalments, fortnightly to termly. Retry/dunning and the actual card charge still need the Stripe key | test-fee-settings 11, screens both themes |
| **R-14** PlayFootball status | **Done.** Status + FFA number on the roster; count per squad; parent's view; weekly reminder to the family a fortnight before the next match — for 'pending' only, after the first version queued 30 against the seed | test-official-rego 14 |
| **Parity tracker** | `docs/DRIBL_PARITY.md` — 20 rows against Dribl Connect, each with a spec ID and an honest status. Three new IDs: B-07 vouchers, B-08 bank transfer / pay later, B-09 fee split | — |

| **L-06** referees | **Done.** A league's pool with claim links (a referee is never a member of anything), block-outs, availability per game with the reason, offer → accept/decline → withdraw each with a push, check-in three hours either side of kick-off, the referee's report (organiser reads it; clubs see that it exists). "Refs" is the sixth tab on a competition; `/referee` is the referee's own page, linked from Settings only for referees. First run of the suite found the seed's NRIFA owner also owns the SPL, so the club in the checks is Ravens | test-referees 40 (an official, two referees, a club owner, a parent), test-rls 64–65, screens both themes |
| **L-04 / L-12** card at the ground, top scorers | **Done (L-12 bar the share link and widget).** The player card opens for the league's officials (any child on a season squad in their competition) and for the opposition's manager on match day, from a name on the sheet — ±1 day of kick-off, nothing before or after; neither can edit it. Top scorers on the public page from the sheets, final games only, named by each club's own rule with a family's opt-out winning | test-league-public 13 (an official, a visiting manager, a stranger), test-player-card 16 still green, screens both themes |
| **L-10 / L-11** adjustments, league comms | **Done.** Point adjustments with a reason, shown by every ladder including the public one. League broadcasts moved from each club's academy-wide channel to its coaches channel — the old behaviour sent a league secretary's message to every family at every club, against the "draw, not people" rule | test-ladder-adjustments 9, test-league-comms 6, test-rls 62–63 |
| **L-09** match-day ops | **Done.** Call off a day or a ground, postpone/cancel, reschedule, forfeit, bye; every change reaches each club's squad chat with the reason through the existing fixture → event → push chain | test-match-day 20 |
| **L-08** discipline | **Done.** Rules per competition; red or Nth yellow → suspension automatically; served by missing games; refused on the sheet by name; tribunal, appeal, overturn with a reason; the Cards tab and report. Two first-run bugs fixed (0154, 0155) | test-discipline 24, test-rls 60–61 |
| Nav badges never loaded | **Fixed** — `app-shell` called `rpc` detached from its client (`this.rest` undefined), caught by capturing the browser console during a screenshot | — |
| **L-03 / L-05** squads, eligibility, match sheets | **Done.** Season squads from the roster; playing up by division rank; a sheet with an ineligible child refused by name; both sides submit and confirm each other; goals/cards/subs; both scores — agreed is final, disagreed is disputed until the organiser rules; full log. Also fixed a 0132 regression that had stopped club managers scoring | test-match-sheets 36 across two clubs, test-rls 56–59 |
| **L-01** division rules (M9 begins) | **Done.** Per-division points, tie-break, scores public/hidden, ladder on/off, match length, squad size; the ladder and the public page honour them. 0150 fixed a regression 0148 introduced on the public page for a few minutes | test-league-divisions 12, test-rls 54–55 |
| Push-queue open question | **Decided** (0147, 0149): a claim counts whether or not there is a device — test-notifications had encoded that months ago and its reasoning is better; deliverable rows are claimed first | test-push-wake 9, test-notifications |
| **R-02** three-step register + draft | **Done.** Who's playing → details → review & send; the draft survives a reload and reopens on the step; the fee is shown, not taken | test-register-flow 16, in a real browser |
| Club settings org bug (#8) | **Fixed** — resolves the organisation the browser is showing. Deleting the stray org is still your call | screens both themes |
| **X-06** player card | **Done.** `/card/[id]` — photo in a private bucket under the child's own path, family and coaches only; squad, number, DOB, FFA number, PlayFootball status. Linked from My family and the roster | test-player-card 16, test-rls 52–53 |
| **R-15** withdraw + refund | **Done bar the Stripe call.** Program policy (full until a date, X% after); Withdraw on Sign up with the money said first; refund computed and recorded; Refunds panel on Collect payments issues it on the connected account, or says plainly that Stripe isn't set up | test-withdrawals 17, test-rls 50–51 |
| **B-05** finance export | **Done.** Two CSVs from Collect payments — every fee per child with Stripe ids, and totals by program / squad / family. Money from the one price function | test-finance-export 14 |
| **R-13** trials → offer → pay | **Done.** Offer control on the trial's list (squad program + days); guardians notified; `/offer/[id]` to accept (pre-approved, into the squad, then the fee) or decline; lapses by date. Two of its own bugs caught by the suite and fixed (0141, 0142) | test-trial-offers 26, test-rls 48–49 |
| **R-12** season rollover | **Done.** Admin → New season: preview, then clone / move / keep numbers / open next season's squad program / end the old squad; "not yet re-registered" report with a weekly nudge | test-season-rollover 20, screens both themes |

### Deploys

| Date | What | Outcome |
|---|---|---|
| 30 Oct 2026 | One-off deploy Joey authorised: the live site is missing the Next.js security fix (16.3.3 → 16.4.3) | **BLOCKED — no Netlify credentials on this machine.** See NEEDS JOEY #7. Probing `squadroom-dev.netlify.app` showed it is **at least three days stale** (`age: 255224`): `/nrifa/register` and `/api/share/weekend`, which have existed for days, answer 404 there. So nothing auto-deploys from GitHub, and production is on the vulnerable Next. |

### NEEDS JOEY (added overnight)

**7. A Netlify token, so I can deploy — ~2 minutes, free.** The site is
linked (`.netlify/state.json` has the id) but there is no login or token
here, and `netlify login` needs a browser. Steps:
1. Netlify → your avatar → **User settings → Applications → Personal
   access tokens → New access token**. Name it "squadroom laptop".
2. Put it in `.env.local` on its own line: `NETLIFY_AUTH_TOKEN=nfp_…`
3. Tell me. I will run the full tests, deploy with
   `npx netlify-cli deploy --prod --build`, verify `/nrifa` and the share
   cards answer on the live site, and note it here.
Until then the live site stays on Next 16.3.3 with the `next/og` RCE. The
cards are signed-in only, so the exposure is to a signed-in parent, not
the open internet — but that is the one thing the rule says deploys at
once.

**8. Club settings picks the wrong organisation for an owner of several.**
`app/settings/academy` takes "the first academy by name", and for you that
is a stray organisation called **"NRIFA"** (slug `nrifa-1`) with no
squads — probably made with `/start` during a demo — not NRIFA Football
Academy. Two questions: may I delete `nrifa-1`? And I will fix the page to
use the organisation the browser is showing, as the season page now does
(a small change; not done tonight only because it is outside the feature).

**6. File-upload questions on the public form — a decision, not a build.**
The brief lists "file upload" among the question types. The register page
is public, so this is an upload from somebody with no account: it needs a
size cap, a type allow-list (PDF, JPEG, PNG?), a private bucket with a
policy, a rate limit per IP, and a decision about retention — a stranger's
file we never approved is still a file we hold. Say yes and pick the caps
and I will build it; or say "after approval only" and families upload
from inside the app once they are in, which needs none of the above.

---

## Project sweep — 29 Oct 2026, before building (Joey asked for one)

Asked the **database** rather than the files wherever that was possible,
and then **called** what it reported. A grep tells you what a migration
said; the catalog tells you what is true.

### Fixed tonight

| | What | Where |
|---|---|---|
| **Critical** | `next` 16.3.3 — remote code execution in `next/og ImageResponse`, the path the share cards render through, reachable by any signed-in parent | → 16.4.3. Share cards 15/15 on the new build, still 401 to strangers |
| **High** | `mirror_fixture` — security definer, no guard, **executable by anon**. Its upsert sets `cancelled_at` from the fixture's status, so a stranger with a fixture id could **un-cancel a called-off game** and fire "back on" pushes to every family | 0132 revokes it from every client role. test-rls 45 |
| **High** | `resolve_finals` — writes finals seedings from the ladder, callable by any signed-in user or anon, and first caller's seeding sticks | 0132 requires the organiser. test-rls 44 |
| Medium | `call_off_day` null reason: `null not in (…)` is null, no raise, families get a cancellation with no reason | 0132 checks null by name |
| Medium | **Why the above were open:** Supabase's default ACL grants EXECUTE on every new `public` function to anon and authenticated | 0132 flips the default to closed for everything created from now on |
| Medium | `claim_notifications` never incremented `attempts` through the RPC (the only way the app calls it), so the retry cap never engaged | 0131, found during the tidy-up. test-push-wake 8/8 |
| Low | `xlsx` 0.18.5: prototype pollution + ReDoS, no npm fix (SheetJS left npm) | → their 0.20.3 tarball. Parsing holds. **Audit: 0 vulnerabilities** |
| Low | `npm run lint` reported **23,988** problems — 24,000 of them in `.next-test/` and `.netlify/` build output, and 900 in the test scripts' `cond ? ok() : bad()` idiom | Ignored both; 54 now, and the 20 real ones are visible |
| Low | `test-rls.sql` was run by hand, which is how "after every migration" gets skipped | `scripts/test-rls.mjs` wraps it, so `test:all` runs it |

### Checked and clean

- **Typecheck** clean, before and after the upgrade.
- **Secrets:** nothing in git history on any branch — the token pasted into chat never reached the repo. `.env.local` never committed.
- **Every table** in `public` has RLS enabled. **Every** security-definer function sets `search_path`. **No** RLS helper lives in `public`.
- **FOR ALL policies:** ten tables carry one beside a SELECT policy, the shape that leaked private events in 0056. Compared every pair's predicate: each write rule is a subset of its read rule (staff ⊆ member, team coach ⊆ team member), so none widens reads today. Fragile — a future edit to a write policy silently widens reads — but not a bug now. Listed below.
- **Anon-callable functions:** called every one with no session. All refuse or return nothing except the two fixed above and the ones meant to be public (`public_match_centre`, `public_programs`, `peek_competition_invite`).
- **API routes:** every handler either checks a session, verifies a secret or signature, or is token-credentialed by design (`calendar/[token]`). The two contacts routes 401 and go through `member_directory`, so `directory_visibility` still decides who sees a number. `ics/[eventId]` uses the cookie client, so RLS and `private_to` decide, with a 404 for a stranger.
- No `console.log` in app code. No TODO/FIXME anywhere.

### Improvements seen, NOT done (the plan does not change)

1. **The 20 lint errors** are all React Compiler rules from eslint-config-next 16: 17× "setState synchronously in an effect" (the sync-prop-to-state pattern, in a dozen client components) and 3× "impure call during render" (`Date.now()` deciding whether a game is inside 24 hours, in `event-detail.tsx`, and in `composer.tsx`). Benign today; the `Date.now()` ones are the hydration-mismatch class. Worth a pass when M3 touches those screens.
2. **Split the ten FOR ALL policies** into insert/update/delete, as 0056 did for events, so the read rule cannot be widened by accident.
3. **Revoke anon from the rest of `public`** in one sweep, re-granting only the intentionally public set. 0132 closes the default for *new* functions; this would close the old ones that happen to be safe only because their bodies check `auth.uid()`. Needs a full `test:all` run to prove nothing public broke — do it the hour the rate limit is clear.
4. **A rate-limit-aware `test:all`.** 34 suites each mint a magic link; two full runs in an hour exhaust the project's auth limit and the second run reads as 34 failures. Either a shared sign-in cached across suites, or the runner pausing when it sees the limit.
5. `home` on :3100 answers **200** to a stranger (it renders the sign-in page in place) where the spec implies a redirect. Not a leak — nothing is fetched — but worth deciding.

---

## Found while tidying: the push queue never counts an attempt

**Real, reproducible, and nothing to do with tonight's changes.** Logged here
rather than fixed, because the fix is a migration and I am stopping for the
go-ahead first.

`claim_notifications` is meant to increment `attempts` in the same statement
it claims a row, so "a crash mid-send cannot leave a row to be retried
forever" — its own comment says so. It does that when called as **plain
SQL**. It does **not** when called through **PostgREST** (`supabase.rpc`),
which is the only way the product ever calls it: `lib/push/drain.ts` uses
`supabase.rpc('claim_notifications')`.

Measured, same row, same database, 0 push subscriptions in the project:

| How it was called | Rows returned | `attempts` after |
|---|---|---|
| `select * from claim_notifications(200)` as SQL | 0 | **incremented** |
| `supabase.rpc('claim_notifications', …)` | 0 | **still 0** |

Ruled out on the way: clock skew (the row was scheduled a minute in the
past), a stale deployed function (the live definition was read back with
`pg_get_functiondef` and matches), and a wrong project.

**Why it matters.** The retry cap is `attempts < 5`. A counter that never
increments is a cap that never engages, so a row that cannot be delivered is
re-claimed every five minutes for ever. Today the queue is small and there
are **0 registered devices**, so nothing is visibly wrong; at 300 academies
this is the queue silting up, which CLAUDE.md already names as the thing to
avoid.

**Likely shape of the fix**, to confirm before building: make the function
`plpgsql` with the claim as its own statement and the select as a second,
rather than relying on a data-modifying CTE surviving however PostgREST
plans the call. Then assert it with a test that calls it **the way the
product does** — through the RPC — because a test that ran the SQL directly
would have passed throughout.

**`test-push-wake` was right to fail** and gets a second, smaller fix: its
check 1 ("the database called out") fails during a full run and passes
alone, because the wake trigger is debounced to one call per 15s and another
suite's notification had already spent the window. Same family of mistake as
the global-count rule in CLAUDE.md — scope it to this probe's own call.

---

## NEEDS JOEY

### 1. Stripe test key — blocks 8 items, free, ~3 minutes

`STRIPE_SECRET_KEY` exists in `.env.local` but is **empty**, so every money
path is written and untestable. A *test* key costs nothing and charges
nobody; this does not go against "don't spend money on API keys".

1. Go to <https://dashboard.stripe.com/register> and make an account (no
   business details or bank account needed for test mode).
2. Make sure the **Test mode** toggle, top right, is ON.
3. Go to Developers → API keys.
4. Copy the **Secret key** — it starts `sk_test_`.
5. Open `/Users/j.lameri/Projects/squadroom/.env.local` and put it on the
   existing line, so it reads `STRIPE_SECRET_KEY=sk_test_...`
6. Tell me it's in. Don't paste the key into chat.

Blocks: B-01's card step, B-02 instalments and term fees, B-03 sibling
discount and promo codes, B-04 refunds and overdue reminders, B-05 finance
export, R-04 several children in one checkout, R-13 trials pay link, R-15
withdraw with partial refund, and league fees in M9.

Test card once it's in: `4242 4242 4242 4242`, any future expiry, any CVC.

### 2. Dribl club-admin export access — blocks F-04

Until your NRIFA login can reach Events → Export, the weekly routine stays
on fixturefeed. Everything on our side is built and tested against a real
export. Ask whoever administers the NRIFA Dribl account for club-admin
rights, then drop one export into `/admin/import` and we can retire
fixturefeed the same day.

### 3. A demo on a real phone — nothing else can prove this

Especially **chat**. Every message now arrives by a different path than it
did a week ago (broadcast rather than `postgres_changes`, X-18). It measures
40 of 40 delivered in a script, which is not the same as working in your
hand on patchy reception at a ground. Send a few messages between two
phones.

### 4. Child-friendly privacy notice + legal review — S-05, due 10 Dec 2026

Export and erase are built and return a manifest. What is outstanding is a
privacy notice written for children and a lawyer's read of it. This has a
real deadline (the Children's Online Privacy Code) and I cannot write the
legal review.

### 5. Apple Developer account + Xcode — blocks M7, and M7 blocks contacts

The Capacitor shell has never been compiled. Both on-device contact matching
(C-10) and reliable iPhone push need a native build, so this gates more than
it looks like it does. Apple Developer is US$99/year — flagging the cost
rather than assuming it, given the standing rule about spending.

---

## 29 Oct 2026 — Step 0: tidy up

### Tests no longer depend on a healthy `next dev`

**The problem, measured rather than assumed.** `next dev` does not fail
cleanly. It compiles a route on first request, and when something wedges it
the port stays **open** while the server stops answering — so `fetch`
connects and waits. A suite does not fail, it *stalls*, and a run left going
overnight is still sitting on the first screen in the morning with nothing
written down. A dead port is a good failure; a listening port that never
replies is the bad one, and it is the one `next dev` actually produces.

- **`scripts/_base-url.mjs`** resolves the target once: `BASE_URL` (or the
  older `SITE`) wins outright and is never probed — a deploy preview is not
  ours to second-guess; otherwise :3000 if it answers a HEAD request inside
  **10 seconds**; otherwise :3100. Any status counts as alive, including 404
  and 500: we are asking whether a server is answering, not whether a page is
  right, and refusing to run against a 500 on `/` would hide the twelve URLs
  the suite actually wants behind one.
- It never throws. "Could not work out which port" is not a product failure,
  so when neither port answers it returns the test port anyway and lets the
  suite's own first request report it — with the URL in the message, which is
  what somebody reading the log needs.
- **`npm run serve:test`** builds and serves on :3100. A build either
  succeeds or fails; it does not half-compile a route at request time, so
  :3100 cannot wedge the way :3000 does.
- It builds into **`.next-test`** (`DIST_DIR` in `next.config.ts`), not
  `.next`. They would otherwise share a directory, and building into a wedged
  dev server's own state mid-request turns a stalled test run into a broken
  checkout as well. Now the fallback never has to ask whether dev is healthy
  first. `.next-test/` is gitignored.
- Seven suites rewired: `shots`, `test-screens`, `test-join-flow`,
  `test-join-codes`, `test-contacts`, `test-public-registration`,
  `test-share-cards`.

Verified: with a dev server up, resolution costs 0.17s and picks :3000; an
explicit `BASE_URL` short-circuits the probe and has its trailing slash
stripped, so `${BASE}/calendar` cannot become `//calendar`.

### Spec corrected against the code

`docs/SQUADROOM_SPEC.md` was audited on 23 Oct against migrations 0001–0075
and 69 commits. It is now 0001–**0130** and **137** commits, and five
statuses were wrong:

| Was | Is |
|---|---|
| S-01 "WRITTEN, NOT APPLIED — the Supabase connection is down" | **DONE.** `db:migrate --dry` reports all 130 applied, 0076 among them |
| Risk 1 "the repo has no git remote, CONFIRMED" | Resolved — private `origin`, 137 commits pushed |
| Risk 4 "Supabase and Netlify MCP are down, migrations cannot be applied" | Resolved — `npm run db:migrate` goes through the management API, restricted to squadroom-dev by `scripts/_project.mjs` |
| R-05 "Kit sizes still to do" | Contradicted the same row's own text, which said done in 0123/0124. Removed |
| S-06 "Player accounts (13+) — MISSING" | **Superseded, will not be built.** Nobody under 18 gets an account; enforced by 0078's two triggers and `test-adults-only.mjs` |
| `test-rls.sql` "23 assertions" | 43 |

Also recorded: an **ID collision**. The 29 Oct brief calls on-device contact
matching "C-09", but C-09 is already *one search for the whole club* (0130,
built). Contacts is filed as **C-10** so every ID points at one thing.

### What this did not touch

No feature code, no migrations, no schema. `.next-test` is a new build
directory and `next.config.ts` gained one line reading an env var that
defaults to the old behaviour.
