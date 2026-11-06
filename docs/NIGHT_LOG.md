# Night log

Newest first. Each entry: what got done, what broke, and anything that needs
Joey. The **NEEDS JOEY** list below the summary is the one to read first —
every item on it is something no amount of building can get past.

---

## Day summary — 4 Nov 2026 (after the deploy; migrations blocked all day)

The Supabase access token died on the afternoon of 3 Nov and Joey will
replace it "tonight or tomorrow", so everything below is **code only**.
Nothing was deployed after the 3/4 Nov milestone deploy (Joey: "don't
deploy for this alone"); it all waits for the next milestone or his word.

- **Every screen follows the organisation the browser is showing.** Seven
  pages still took "the first academy by name"; the Admin hub, Admin →
  Payments, Members, Invites, the roster importer, Scan and the family's
  Payments became thin pages with browser-side loaders. `test-org-follows`
  21.
- **Home simplicity pass** (Joey's nine points): parent Home 2.4 → 1.4
  screens, coach 1.7 → 1.3; one Needs-you list (the parent's jobs are rows
  in it), one orange card, one number for "to answer", no Channels on Home,
  the next two fixtures (three for a coach), fortnight-old announcements
  hidden, signed-out → /signin, training rows padded, "not answered", an
  Edit button. "COACHES SPL" was a custom chat with two parents (now out);
  a coach's Admin hub no longer offers what the database refuses.
  `test-coaches-channel` 5, `test-coach-scope` 15, 0208 written (unapplied).
- **Referee payouts parked** (Joey): tracking only; the Stripe routes and
  button removed.
- **Tidy:** the stray `nrifa-1` organisation deleted; no test leftovers in
  the database; F-06 (Squadi) will not be built — Dribl only; spec rows
  R-17, X-02, B-08, B-09 corrected, R-21 renumbered.
- **X-10, the labels half:** a 21-screen accessibility audit
  (`test-a11y`), 93 things fixed (placeholder-only fields, 16–22px text
  buttons via `.tap`), the light accent deepened to 5.2:1 and orange
  surfaces on `--accent-ink`.
- **R-21 Registration dashboard** on Admin → Programs, staff only,
  computed in the browser. `test-registration-dashboard` 8.
- **S-07 Two-step sign-in, the app's half:** enrol in Settings, a gate
  above every page, a nag for staff. `test-two-step` 16. The database's
  half is a migration.
- **B-08, the safe half:** new club accounts ask Stripe for BECS.

**Full runs:** #14 (122 suites, 2402), #15 (124, 2423), #16 (125, 2444;
caught the orange contrast), #17 (126, 2446; two timing failures that pass
alone — my browser tests were competing with it), #18 (127, 2469, after
S-07, run on a quiet machine: clean). All green bar `test-rls`, which
cannot run without the token.

**Needs Joey:** #12 the Supabase token (then: 0208, test-rls, photos, the
division table, BECS "processing", pay-later, the fee split, the 2FA
policies); #14 Stripe on the live site + NRIFA's Express click-through;
#4 the privacy notice; #5 Xcode.

**Late evening, 4 → 5 Nov (four briefs from Joey, in the order sent):**
- **X-10 Dynamic Type:** every text size in rem; Android follows the phone
  (the `text-scale` tag), the iPhone through a pre-paint script; three rows
  that broke at 200% now wrap. `test-text-size` 17, `test-a11y` at 200%.
- **G-09 the Squadroom brand:** white on near-black `#101012`, colour only
  for needs-you / going / out; the SR icon, the logo, every app icon and a
  manifest from `brand/`. Before/after at 375px. `test-brand` 29.
- **G-10 club & league branding + Appearance:** logo upload with colours
  suggested from it and a phone preview before Save; the logo replaces the
  initials everywhere; club colours on the bar, buttons and tabs with
  black-or-white text by contrast; Appearance per person (Club colours /
  Black & white × Match my phone / Light / Dark). **0209 written,
  unapplied.** `test-branding` 42 (+2 waiting for 0209).
- **X-05 the game page as a match preview:** the hero, Preview | Match
  sheet | Ladder, availability first, both sides' form and ladder rows —
  and every game time in the venue's timezone (a 2:20 pm kick-off had been
  able to read 3:20 am). **0210 written, unapplied.** `test-game-page` 26.
- **The scale test** is queued for after the weekend (NEEDS JOEY #18: two
  questions — branching costs money, and a branch is its own project).
- Nothing deployed (Joey: no deploy). New NEEDS JOEY: #16 SPL's real logo,
  #17 one reading of "4 designs" to confirm, #18 the scale test.
- **5 Nov afternoon:** full run **#19** (131 suites, 2,620 assertions) —
  green bar `rls` (the token) and two suites that turned out to be
  colliding with the demo data; both fixed (build-log row "The suites were
  damaging the demo"), the demo's games, trainings and U8 chat restored.
- **5 Nov evening → 6 Nov (Joey: "keep going", then the league notices
  brief):**
  - **X-09, score taps with no signal** — and the first browser test of the
    outbox found it had never kept anything offline (it asked the auth
    server who was signed in). Fixed with seven related faults; RSVPs, the
    register and score taps now all work with no signal. `test-no-signal` 33.
  - **League notices** (0212–0213), **every account has an email** (0214)
    and **a teenager's login with a parent's yes** (0215): the app halves
    done and tolerant; the migrations wait for the token (#12). Two recorded
    decisions reversed at Joey's word and written into CLAUDE.md and the
    spec (D-5, D-6).
  - New NEEDS JOEY: **#19** Resend + a sending domain for December, **#20**
    three questions the 13+ logins reopen (the under-16 rules first).
  - Full run **#21**: 135 suites, 2,690 assertions — not passing: `rls`
    (the token), and two the evening's changes caused, fixed and re-run
    green: `register-flow` 16 (registration now needs an email) and
    `text-size` 17 (email HTML is exempt like the sign-in email: mail
    clients read px). No suite left the demo changed. 0208–0215 parse with
    PostgreSQL's own parser (pglast), every function and trigger body too.
  - Nothing deployed (the brief: no deploy).

## Evening summary — 3 Nov 2026: the money moves (Stripe test mode), and the first deploy

Joey pasted the Stripe **test** key and, an hour later, a Netlify token.
Both are in `.env.local` only (gitignored; the file was checked). Stripe
confirms `livemode: false` before anything runs; the test card is
4242 4242 4242 4242 and nobody is charged.

**Proven end to end on Stripe test mode** — `scripts/test-stripe-e2e.mjs`,
run by hand with `STRIPE_E2E=1`, the dev server and `stripe listen`
forwarding platform and Connect events to the webhook (migration 0207):

| | What Stripe and the webhook did |
|---|---|
| Connect | `POST /api/payments/connect` makes the club's **Accounts v2 Express** account and an onboarding link; status read back on demand and on every `capability.updated`. |
| Registration fee | Leo's $45 paid on Checkout; charged on the club's own account, **no application fee**; the webhook marks the row paid; the family's list shows it. |
| Several kids, one checkout | One session, a line per child, a payments row per child; $30 + $27 (the seed's 10% second-child ladder); both rows paid by one event. |
| Voucher + instalments | $20 off an $80 camp in four parts; the first checkout charges exactly part 1 ($15); the schedule then shows part 1 paid, part 2 next, and the next checkout is part 2. |
| Refund | The club issues $15 of the $45 on its own account; Stripe says succeeded; the webhook marks the one row the refund named; a parent cannot issue one; twice is refused. |
| League entry fee | The Ravens' owner pays the SPL's $120 on the **league's** account; a parent cannot; the webhook marks it paid; the league's fees view shows it; the league's balance is $120. |
| Referee payout | **Stripe refuses:** *"Cannot create transfers between connected accounts."* The route marked nothing; the run stayed draft for the treasurer. **Joey, the same evening: parked** — tracking only, no Stripe payouts, no bank files; the referee's "Connect Stripe", the league's "Pay through Stripe" and both routes removed. |

**Three things found and fixed on the way:**
- Stripe's AU defaults put **Klarna, Zip and Link** on a junior club's fee
  page; Checkout is now **cards only** (one line in each checkout route;
  reversible if a club asks). Checkout also pre-ticks "Save my information
  with Link", which adds a required phone number.
- The webhook matched refunds through `charge.refunds`, which current API
  versions no longer send; it now listens to `refund.created/updated`.
- `test-payments` deleted the club's real billing row at the end of every
  run — it now puts back what it found.

**What a script cannot do:** finish an Express account's onboarding. Stripe
owns requirement collection for Express — the API refuses to write its
identity, people or terms acceptance once the link exists, and the hosted
test-mode pages (with their "Use test phone number" shortcuts) sit behind
an hCaptcha that answers "Challenge closed" to any automated browser,
headless or not. So the suite proves the route and then moves the money on
a test-mode account the API *can* activate (`scripts/_stripe-test-accounts.mjs`:
no dashboard, platform collecting fees and losses, Stripe's test values),
and closes everything it made at the end. Clicking through NRIFA's real
Express onboarding in test mode is a two-minute job for a person (NEEDS
JOEY #14).

**Also today:** the Supabase personal access token in `.env.local` began
answering `401 Invalid access token` mid-afternoon (NEEDS JOEY #12). It was
valid an hour earlier; nothing here changed it. It blocks `npm run
db:migrate`, `scripts/_sql.mjs` and `test-rls` until a new one exists; 0207
was applied before it died.

**Deploy:** see the Deploys table.

**Session log:** see the line under the Deploys table.

## Morning summary — 3 Nov 2026 (the 2–3 Nov run; Joey sent two more items during the day)

**Done, in the order asked (STEP 0–3, then Joey's two daytime messages):**

- **STEP 1 Product direction** → CLAUDE.md (customers, the four-role
  navigation rule, the new deploy rule, session logging).
- **STEP 2** security sweep (0185: five anon-callable functions and an
  allow-list test), test reliability (sessions cached, dev auth limits
  raised, retry), role navigation (0186 `home_jobs` + a browser test per
  role proving the two-tap rule).
- **M9 League mode complete** bar the three Stripe halves (L-17…L-28 in
  0187–0191); `test-league-season` passes.
- **G-01** self-onboarding checklist (0192), **money polish** without the
  key (vouchers, overdue chase, 0193), **G-08** `/for-clubs` with the free
  trial, **M7** prepared as far as this machine allows (NEEDS JOEY #5).
- **M3 complete:** C-05 voice/video, C-06 threads, then **C-11** (0194:
  typing, ticks, link previews, swipe to reply). 0195 fixed two polls from
  before 0044 that drew blank.
- **G-05** development (0196): coach notes, termly reports with ratings,
  clips as links — on the player card; the family sees what is shared.
- **R-19 New season, graded** (0197, Joey's first daytime message): the
  rollover preview is a plan — re-grade, split, merge, leave out, the
  oldest group kept or released, a new intake — and a mid-season "move
  players" tool. (Notice of Offer renumbered R-20.)
- **L-29 Venue & pitch layout designer** (0198, Joey's second daytime
  message, asked for as "L-27" — which is Nominations): venues with a pin
  and amenities, pitches drawn and cut up, hours, sizes per age group, the
  clash rule in a trigger, the draw on pitches, call-off by pitch, the
  family's map with directions.

**Afternoon and evening, 3 Nov (Joey: "Stripe key next couple of days;
continue the next phase"):** the rest of **M4** — E-05 availability grid,
E-06 the team sheet that tells the families, F-07 the match-day list and
the hour-before push, F-05 results from a league export and the squad's
form (E-07 and E-08 were already done by X-19 and L-29) — then **M5** —
X-02 goals and assists, X-03 Player of the Match with the family vote,
X-01/G-06 the live ticker into the chat, X-07 the club table, X-11 the
parent pulse, X-04's Player of the Match card (nameless, like every card).
**M4 is complete; M5 is complete bar photos on the match centre and X-08
sponsor slots (M8).** Migrations 0199–0204.

**Full runs:** #3 green (pushed), #6 green bar my own premature RLS check,
#7 green (108 suites, 2,170), #8 green bar test-search's speed check under
load (460 ms vs 205 ms alone — a flake), #9 green (111, 2,301), #10 green
(115, 2,387); pushed after each green run. **105 → 117 suites, ~2,450
assertions.**

**Deploys:** M9 (and now M3) are complete milestones, so a production
deploy is due under the new rule — **blocked: no `NETLIFY_AUTH_TOKEN` on
this machine** (NEEDS JOEY #7; it is a Tuesday, so the day is allowed).

**Two ID collisions, both decided and logged:** Joey's "R-19" collided with
the plan-only Notice of Offer → that became R-20. Joey's "L-27" collided
with Nominations (built) → the venue designer is **L-29**. If either
should be the other way round, say so and the docs change; nothing in the
code carries the numbers.

**Still needs Joey:** #1 Stripe test key (eight money items) — **Joey, 3 Nov
afternoon: "next couple of days"**, so the Stripe halves are queued right
behind it; #5 Xcode and CocoaPods (free) then the Apple account; #7 the
Netlify token (two milestones waiting to deploy); #9–#11 unchanged.

**Session log:** stopped 3 Nov 2026 at the end of L-29 — see the line under
the Deploys table.

## Morning summary — 1 Nov 2026 (overnight run)

**M9 League mode is complete bar the three Stripe halves, and its
acceptance test passes:** `test-league-season` runs a simulated SPL season
as five people — 6 divisions, 8 clubs, 168 games drawn weekly on two
grounds and mirrored into families' calendars; a referee appointed,
accepting, checking in, reporting and paid; sheets from both sides,
confirmed by the other; a red card that suspends a child and is refused by
name on next week's sheet; a washout that postpones a round and tells the
U8 parent why, then a reschedule that tells them it is back on; ladder,
then a final seeded first v second; the public page with the lot and not
one phone number; the parent seeing the draw and nothing else.

**Built since the last summary:** L-06 referees (pool, block-outs,
appointments with a push, check-in, report) · L-07 referee payments (fees,
runs, bank/cash, CSV; Stripe transfer waits on the key) · L-12 share link
and embeddable widget · L-13 league roles (competition manager, referee
coordinator, discipline officer, ground manager — writes scoped by area)
· L-15 reports (results, ladders, discipline, entries, referee payments as
CSV) · L-14 a league imports its own draw from a file · L-02/L-16 entry
fees and public tournament entry (online payment waits on the key) ·
**R-18 Circular 26-02** from your message, with `SQUADI_INTEL.md` §6
folded into the plan docs and your pricing rule in CLAUDE.md. Migrations
0161 → 0167; test-rls now 74; every new screen checked at 375px in both
themes. `smoke-demo` has a four-role league section.

**Deploy:** Sunday 1 Nov 8pm Sydney was the weekly slot. **Not deployed —
no Netlify token on this machine** (NEEDS JOEY #7). The full suite was not
run for it either, for the same reason; next slot Sunday 8 Nov.

**Next, in the agreed order:** M10 Differentiators (W-02 concussion
register and W-03 safeguarding gate first, both P1) unless you move it
(NEEDS JOEY #10); M7 native is blocked on the Apple account (#5); then M3.

**Needs you:** #1 Stripe test key (now blocks the league's online fees and
the referee transfers as well as everything in M1/M6) · #7 Netlify token ·
#9 is the SPL sanctioned / is NRIFA a Club (decides which programs get the
PlayFootball switch) · #10 M10's slot · #11 pricing.

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

**Then M9 League mode, through the day (30 Oct):** L-01 division rules ·
L-03/L-05 season squads, eligibility and match sheets from both sides ·
L-08 discipline (cards → suspensions → blocked from the sheet) · L-09
match-day ops (call off a day, postpone, reschedule, forfeit, bye — every
change pushed with its reason) · L-10 ladder adjustments with reasons ·
L-11 league comms to club staff only · L-04 the card at the ground (league
officials, and the opposition on match day) · L-12 top scorers on the public
page · **L-06 referees** (pool, block-outs, offer/accept/decline with a
push, check-in, report, the Refs tab and `/referee`) · and, from your
message, **R-18 Circular 26-02** (PlayFootball first — per program,
Accept refused until confirmed, the club's own export imported, fees
tick) with the whole of `SQUADI_INTEL.md` §6 folded into the plan docs and
your pricing rule in CLAUDE.md. Also fixed: nav badges never loaded (an
unbound `rpc`), and a React 19 hydration warning on every page (the theme
script sat outside `<head>`). Migrations 0147 → 0162; test-rls now 67.

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

| **C-11** the small things that make chat feel like WhatsApp — "typing…", ticks, link previews, swipe to reply (STEP 3 item 6; the last M3 row) | **Done** (0194). The composer says "typing" on the channel's private broadcast topic — a second policy on `realtime.messages` lets members SEND on their own topic, a stranger still cannot even listen; the line forgets a nudge after four seconds. Ticks on a sender's own messages from `channel_members.last_read_at` (✓ sent · ✓✓ some · ✓✓ blue all), the same fact as the announcement "seen by"; a parent may ask about their own, a host about anyone's. Link previews fetched ONCE by the server (`/api/link-preview`: signed in, http(s) to a public host only, the private ranges and the metadata address refused, 5 s, 512 KB, cached a week, 60 an hour per person) — a phone never reaches out to a URL somebody else typed. Swipe right on a bubble to reply; links in a body are tappable. **M3 is complete.** | test-chat-polish 32 (rules, the route's refusals, a real typing nudge between two browsers at 375px, the swipe, the card), test-rls 101; chat both themes |
| **G-05** development — coach notes, termly reports, clips on the player card (STEP 3 item 6, second half; the first of W-09) | **Done** (0196). A coach's note is private by constraint and policy; a termly report (text + four optional 1–5 ratings) is private until shared, and sharing tells the family once with a push that opens the card; a clip is a link to video that lives elsewhere (http(s) only, the club's own games only as the source), shared by default, never public. Writers: owner/admin or the squad's cleared coach; readers: writers, and the family for what is shared; a teammate's parent or another club is told no. Also 0195: two hand-made polls from before 0044 kept string options and drew blank — backfilled, test-rls 102 guards it. | test-development 40, test-rls 103; card as coach and as parent, both themes |
| **R-19** New season, graded — Joey's 3 Nov message, slotted after G-05 | **Done** (0197, Admin → New season). The preview is now a plan the owner edits before confirming: a select per player sends them to any of the new squads or leaves them out (a select, not a drag — a drag is a desktop gesture and this screen is used on a phone); "Split into two" and "Merge into…" per squad; players on the club's oldest age group listed on their own with move up / keep (a same-age squad made on demand) / leaving — nobody dropped by default; "Add a new intake squad" opens a squad with nobody on it and its registration program open. The plan is checked whole before anything moves (a child with no destination is an error by name; a foreign or already-rolled squad is refused). Split and kept squads descend from the old one so the re-registration report chases them; the intake is not chased. Mid-season, "Move players between squads": pick a squad, tick players, pick where, preview (who joins the chat, the number staying, games landing on the calendar), confirm. Chats follow via 0098's trigger, numbers via the per-season pool, calendars because events belong to the squad. **Renumbered:** the plan-only "Notice of Offer" was R-19; Joey filed this as R-19, so Notice of Offer is now R-20 in SPEC, PARITY and BUILD_PLAN. | test-regrading 42, test-season-rollover re-run green; season screen both themes |
| **X-12 Matchdays** — Joey's 3 Nov evening list, item 1 (core, free) | **Done** (0206). Fixtures tab: Upcoming · Matchdays. Matchdays is the played games — the score (from the game or its fixture), the scorers, the video — and no Player of the Match. A coach adds the video by pasting a link or uploading a file (a private bucket, 50 MB — the project's file limit — bigger goes by link); one push per member of the squad, "U8 SPL v Hornsby Heat — video is up"; only the squad's people and the club's staff see any of it; the coach is told that a link follows that service's privacy settings and can be forwarded while an upload stays private. **Item 2 (R-19 extras) was already built in 0197** — verified, nothing to add. **Item 3 (Analysis Pro) is planned, not built** — BUILD_PLAN "M7b" and SPEC X-13. **Item 4** — CLAUDE.md's pricing rule now reads: core never charged to parents; optional extras may be bought by any individual account. | test-matchdays 27, test-rls 110; Matchdays and the video on a game shot both themes |
| **G-03 / X-08** help inside the app, and a thank-you to the sponsor (M8, the two pieces that need no account from Joey) | **Done** (0205). Settings → Help and support: write to Squadroom, see your threads, get a push when a person replies; the platform admins' inbox and status notices on /platform; a public /status page. Admin → Sponsors: the club's own sponsors (logo, link, slots, pause, views in 30 days), a strip under the public match centre's header counted once per load by the server, and "with thanks to" in the footer of every share card. Squadroom takes nothing. | test-support 19, test-sponsors 18, test-rls 109; help, status, sponsors and the strip shot both themes |
| **X-07 / X-11 / X-04** the whole club on Saturday, how it felt, and the star as a card (M5) | **Done** (0204). "Results across the club" folded above the draw on the Fixtures tab: every squad's P W D L GF–GA, last five, latest score. After a game, one tap per family — 😀 😐 🙁 and a word — seen only by the coaches, with the family's name. The Player of the Match share card keeps the rule every card has: **no child's name on it** — the trophy, the squad, the coach's word, the score. With this, **M5 is complete bar photos on the match centre and X-08 sponsor slots (M8)**. | test-club-results 16, test-rls 108; table, pulse (parent and coach) shot both themes |
| **X-01 / G-06** the whistle and the roar — live score taps (M5) | **Done** (0203). From half an hour before kick-off the coach taps kick-off, +1 us (scorer, optional assist), +1 them, half time, full time, a card, a word; each tap is a chat line from the coach that 0088 pushes to every family, and a timeline row; a slip is undone within a minute and its line comes down. Full time writes the result and the goals into the stats; a game in our own competition keeps its official score on the sheet. | test-live 22, test-rls 107; the game live as coach and parent, both themes |
| **X-02 / X-03** who scored, who starred (M5) | **Done** (0202). Goals, assists and minutes per child per game, entered by the coach after the whistle; the season on the card and as a table on the squad's page. One Player of the Match per game, picked with a word and posted once to the squad's chat as a 🏆 announcement; an optional family vote (one per adult, kick-off to a day after; the coach sees the tally live, the families once it closes). | test-stats 25, test-rls 106; game (parent and coach), card and team page shot |
| **F-05** results from a league export, and the squad's form (M4) | **Done for results and form** (0201). The importer gained score columns (home/away, for/against, or one "2 - 1" column) turned into ours and theirs by which side was ours; `apply_imported_results` puts them on the games the file imported, matched by reference or by day and opponent; a scoreless row leaves a result alone, a corrected score corrects it, a score for a game we lack is counted. `team_form` and a form strip (last five as W/D/L, season totals) on the team page. **Not built:** a division table from the export — every club's games would have to be stored; our own competitions already have a ladder. | test-results-import 16; form strip both themes |
| **F-07** the match-day list and the hour-before push (M4) | **Done** (0200). Five items on every game for the coaches: team sheet (ours links to our sheet and ticks itself when submitted; a league export's says "submit it at the league — a late sheet is fined" and is ticked by hand; we never link into Dribl), publish the side, kit and first aid, the register, the score — the ones the database can see tick themselves. A pg_cron sweep every ten minutes pushes each coach of a squad with a game 50–70 minutes out what is still to do, once; nothing for training, a called-off game or a parent. Note: I briefly overwrote `scripts/test-match-day.mjs` (L-09's suite) with the new one — caught it in the same minute, restored it from git, and the new suite is `test-match-day-list.mjs`. | test-match-day-list 22, test-rls 105; the list on a game, both themes |
| **E-05 / E-06** the coach's availability grid, and the team sheet that tells the families (STEP 3 item 8: the rest of M4) | **Done** (0199). The grid on the squad's team page: players × the next four games and sessions, the last two registers alongside, a tap for the reason and who gave it. Publishing a team sheet (0125) now pushes each selected family their spot, meet time, ground and kit — once per player per role — and the left-out families only when the coach ticks it, gently. E-07 was already done by X-19 + the attendance panel; E-08 by L-29; both rows updated. | test-availability 21; grid both themes |
| **L-29** Venue & pitch layout designer — Joey's 3 Nov message (asked for as "L-27"; that is Nominations, built 2 Nov, so filed as **L-29**) | **Done** (0198). Venues get a map pin and amenities; pitches are drawn on a canvas — a full pitch, cut into halves, thirds or quarters, dragged with a finger, named, with hours per day; sizes per age group with MiniRoos-style defaults and a per-division override. The clash rule lives in a trigger on fixtures (a pitch, its parent and its sub-pitches never double-booked; outside the hours refused) and keeps the old text labels true, so nothing downstream changed. The draw builder draws a division on the right-sized pitches inside their hours around what is booked and says what did not fit; the call-off takes one pitch; the referee's list is as before; a family's game page shows the ground drawn with their pitch marked and Directions. Admin → Venues and pitches is new; the draw builder, division settings and call-off gained a choice each. Also: full run #8 flagged only test-search's speed check (460 ms under full-run load vs 205 ms alone) — a timing flake, not a failure. | test-pitches 48, test-rls 104; venues, layout, game page, call-off at 375px both themes |
| **G-08** the public "for academies, clubs and leagues" page with the free trial (STEP 3 item 7) | **Done** (`/for-clubs`). Static and cookie-less, no tab bar; what Squadroom does for a club and for a league, how the trial works, the club-pays rule said plainly, no price. "Start free" → sign up by email → found the club → the half-hour checklist | test-for-clubs 10, navigation and screens suites re-run, screens both themes |
| **M7** native app — what can be done without the Apple account (STEP 3 item 5) | **Blocked on tools, not on the account.** The shell, the adapters and the push server side were done in an earlier phase. This machine has no Xcode, CocoaPods or JDK, so `npx cap add ios` cannot run — and a simulator build, which needs no paid account, cannot either. `native/README.md` gains the App Store review notes and the deep-link steps. NEEDS JOEY #5 reworded: install the free tools first | — |
| **B-07 / B-12 / B-04** vouchers and the overdue chase — the money polish that needs no key (STEP 3 item 4) | **Done** (0193). Vouchers per club: a code with a dollar value or a percentage, a kind (Active Kids-style government, club, coach, volunteer, scholarship, sibling), uses, an expiry; a family types it on one child's fee and the redemption is recorded for the books; the one price function takes it off after the family discount, so who-owes, the family's list, Needs you and the checkout agree. The chase: a daily sweep tells the family three days before a fee is due and at 3, 7 and 14 days overdue, then fortnightly, once each; a club can switch it off. What still needs the key — the charge itself, instalment retry, several children in one checkout, bank transfer, the league–club split, issuing a refund — stays under NEEDS JOEY #1 | test-vouchers, test-rls 100, payments / fees / program-fees / finance-export / withdrawals / fee-settings / trial-offers suites re-run, screens both themes |
| **G-01** self-onboarding in under 30 minutes (STEP 3 item 3) | **Done** (0192, `/start/setup`). Founding a club lands on a six-step checklist with a clock: crest and colours inline (swatches, any colour, the crest into a public crests bucket in the club's folder — the one picture that belongs on the public page), then squads, roster, programs, coaches and first training, each one tap to the page that already does it and each tick read from the data, never from the list. The moment the five core steps are first all done is recorded on the club, so the half hour is measured on every club that signs up. The owner's Home shows "Finish setting up — n of 6 · m min" until then | test-self-onboarding, test-rls 99, first-run / role-nav / organisations suites re-run, screens both themes |
| **L-25 / L-27 / L-28** referee extras, nominations, bulk tools — **M9 complete bar the Stripe halves** | **Done** (0191). Referees: a decline needs a reason, a late pull-out is refused, referees of the allowed grades take open games from their own page, a club puts up its own referee inside the window (unpaid, marked as the club's), an under-18 names who is paid; rules per competition on the Refs tab. Nominations: a club proposes a division with a comment and the squad locks; the league sets the division and unlocks; a date-of-birth band per division enforced on the sheet with an exemption. Bulk: scores for many games, a round moved by days (every family told, games pinned), a round called off; on the run sheet | test-league-tools, test-rls 98, referees / referee-auto / referee-payments / match-sheets / sheet-rules / league-season / draw-and-ops / chain suites re-run, screens both themes |
| **L-18 / L-20 / L-22** scorer handoff, sanction codes and one-card-away, forfeit chain (M9 remainder, P2) | **Done** (0190). Cards take the federation's codes (Y1–Y6, R1–R8); a suspension carries the code of the card that tipped it; the club is pushed when a player is one yellow out and again when it lands or a red is shown; the discipline tab shows the codes and the warning. A forfeit is asked for by the coach, approved by the club, decided by the league — only then the forfeit score — with each step pushed, club staff skipping the club step, and the league seeing waiting forfeits on the match-day list. The scorer hands their phone to the referee, who types the mobile the league holds (any format) and Confirm: verified and ended in the referee's name, failed tries on the record, no referee account needed; a referee ending from their own phone verifies too | test-match-day-chain, test-rls 97, discipline / match-sheets / sheet-rules suites re-run, screens both themes |
| **L-23 / L-24 / L-26** fixture flowing, draw quality, match-day ops (M9 remainder, P1) | **Done** (0189). Fixture flowing: the league opens a window (until when, days either side); inside it a home club's move that the other club agrees to is done on the spot and everyone is told; an away club's, a far-off, or an after-the-window move waits for the league as 0174 had it. Draw quality: pairs, home/away and slot balance per team, two teams of one club on at once, double headers, travel, empty slots; a closed field's impact before it is closed. One source of truth: a game moved by hand is pinned and a rebuild draws around it. Match-day ops: the league's live list on the run sheet — sheets missing, scores to resolve, not ended, referee reports due, no referee this week, suspended, corrections, change requests. The existing `match-day-ops.tsx` was briefly overwritten by a file of the same name and restored from git within the minute; the dashboard lives in `match-day-dashboard.tsx` | test-draw-and-ops 30, test-rls 96, fixture-changes / league-draw / fixture-generation / match-day / finals suites re-run, screens both themes |
| **L-17 / L-19 / L-21** sheet lock, match lifecycle, finals eligibility (M9 remainder, P1) | **Done** (0187). Per division: sheets lock N minutes before kick-off (30; 15 for youth), finals need N games on a sheet, playing up is capped. After the lock a manager is refused with the time; the accepted referee or the league can still put a sheet in, logged as changed after the lock. A game is ended by the referee or the league once it has kicked off and is locked from then on; what is wrong becomes a correction request (score / event / sheet / other) pushed to the competition's runners, applied (a score is set; anything else reopens the game for the fix) or declined with a note, the requester told, all in the match log. Finals eligibility and the borrowing cap are counted from the sheets and refused on the sheet by name. The full run also caught 0185 revoking `generate_fixtures` from the organiser's screen — 0188 puts the organiser check in the function itself and the grant back | test-sheet-rules 25, test-rls 95, match-sheets / discipline / league-season re-run (the season test now submits sheets an hour out, as a match day goes), screens both themes |
| **Full `test:all`, first in weeks** | First run: 100 suites, 1,775 assertions, 16 not passing. Second: 102 suites, 4 not passing (one more hygiene offender, `test-registration`). **Third, 21:47: 103 suites, 2,026 assertions, all passing** — the first fully green run, and the one the night's commits were pushed on. The failures, all traced: three to 0185's `generate_fixtures` grant (0188); one to a season-test step that still expected a parent to see a league broadcast (0157 moved those to coaches channels — expectation fixed); three to `test-navigation` not seeing links built as `${origin}/ref/…` (paths written out); the rest to **suite hygiene** — `test-clearances` wiped NRIFA's clearances and put nothing back, and `test-import-diff` deleted Marcus's seed U8 coaching in its teardown, so every later suite found the U8s with a lapsed or missing coach and failed on his behalf. Both now snapshot and restore. The seed was repaired by hand | the reruns below |
| **Role navigation** (Joey's STEP 2c, 2 Nov) | **Done.** `home_jobs` (0186) works out which of the four people is looking — parent, coach, owner / club admin, league organiser (a league's staff or anyone holding a league role) — and Home opens with that person's three jobs as tiles, each a link to the exact page: parent *Answer · Team chat · Pay* (+ the latest announcement); coach *Post · Squad · Attendance* (the register's session if one is open, else the next); owner *Registrations · Who owes · Message everyone* (+ "today across all teams"); league *The draw · Referees · Results* (+ "this weekend"; the counts are L-26's missing sheets, unfilled referees and disputes). Chips above the tiles switch organisation in one tap, each labelled with the persona there. `?tab=` deep links on the competition page. Nothing is greyed out: a parent has no Admin tab, no "Run the club"; a league's footer says "Run the league" | test-role-nav 36 in a real browser (four people, every job in two taps, the one-tap switch), test-rls 94, Home as all four roles at 375px in both themes |
| **Security sweep** (STEP 2a) | **Done.** The catalog said 166 of 295 public functions were executable by anon — `create or replace` keeps the old ACL, so 0132's closed default never reached them. 0185 revokes EXECUTE from anon and PUBLIC on every non-extension function, re-grants exactly five (`public_academy`, `public_programs`, `public_match_centre`, `public_competition_entry`, `peek_competition_invite`), recorded with a reason in `app_private.anon_callable`; two internal helpers (`resolve_source`, `generate_fixtures`) lose their authenticated grant too. Every other security-definer function a member can call names its caller in its body (asked of the catalog, not the files). `scripts/_sql.mjs` is the read-only catalog query used for the sweep | test-rls 92 (fails the day an off-list anon function appears) and 93 (every secdef function checks its caller); public-academy, public-registration, league-public, league-entry, join-flow, join-codes re-run green |
| **Test reliability** (STEP 2b) | **Done.** Three things: `scripts/_auth.mjs` signs a person in once and caches the session in `.cache/` (gitignored) for every later suite, refreshing rather than re-verifying — 24 suites with the stock sign-in rewired to it; `scripts/configure-auth-limits.mjs` raised the DEV project's verify / OTP / refresh limits from 30 to 1000 per five minutes (through `endpoint()`, so only squadroom-dev; production keeps the defaults); `test-all` waits a minute and retries a suite that still trips the limit instead of recording a failure | a full `npm run test:all` after the night's changes (below) |
| **Product direction** (STEP 1) | **Done** in CLAUDE.md: customers, the four-role navigation rule with each role's top three jobs, the new deploy rule (milestone complete + full tests green, never Sat/Sun, security fixes at once, every deploy logged, missing `NETLIFY_AUTH_TOKEN` → NEEDS JOEY), and session logging | — |
| **C-05** voice notes + short video | **Done.** Same private `attachments` bucket, same path rule and the three 0034 policies, now accepting audio and video up to 25 MB (about thirty seconds of phone video; the picker refuses bigger before uploading). The send button becomes a mic when nothing is typed; tap to record (up to 60 s), Done adds it as a pending chip, send as usual. Voice notes play inline; video plays inline, capped at 60vh, `playsInline`. Chat list says "🎙 Voice note" / "🎬 Video", the push says "sent a voice note". The photo-consent prompt also fires for video. Safari records AAC/MP4, Chrome Opus/WebM — the adapter labels whichever it got | test-media 15, test-rls 91, chat / threads / mentions / digest suites re-run, screens both themes |
| **C-06** threads on announcements | **Done.** Replies to an announcement fold under it in the feed ("8 replies ›", tap to open); a reply notifies only the announcement's author and the people already in the thread, never the channel; a reply to an ordinary message is unchanged; a mention inside a thread still reaches whom it names. `channel_messages` carries `reply_count` and `reply_to_announcement` | test-threads 10, test-rls 90, chat / mentions / digest suites re-run, screens both themes |
| **C-07** notification digest | **Done.** Off by default; grouped every 10 / 30 / 60 minutes per channel ("5 new messages in U8 SPL"), timed for the end of the window, counted up in the queue row itself; announcements, mentions, DMs and everything urgent still go at once. Settings → Message pushes | test-digest 12, chat / mentions / notifications suites re-run, screens both themes |
| **C-04** scheduled messages | **Done.** "Send later…" → a message only the sender can see until a minute-by-minute publisher sends it as an ordinary one at its time, through the same triggers; strip above the composer to move or cancel. Two migrations because Postgres will not use a new enum value in the transaction that added it | test-scheduled 19, test-rls 89, chat suite re-run, screens both themes |
| **C-03** @mentions (M3 begins; M10 complete bar W-09's "later" list) | **Done.** `@` autocompletes from the channel (names and labels, no phones); a mention is its own push through a mute and quiet hours; `@everyone` for hosts only; bold in the bubble | test-mentions 11, test-rls 88, chat suite re-run, screens both themes |
| **W-08** chat in your own language | **Done.** A per-person language (off by default); messages render translated with "original" one tap away; translated once per message per language (Haiku) and cached; read only by the channel's members; capped in the database per person and per club per day. **The suite never calls the model unless `TRANSLATE_TEST_LIVE=1`** — your no-spend rule. 0178: a new profiles column needs its own column grant (0012's pattern), found by the suite | test-translate 14, test-rls 86–87, chat suite re-run, screens both themes |
| **W-06** QR check-in | **Done.** A per-game QR on the match page for the manager or the league; the referee scans and lands checked in — only the appointed referee, only inside the window | test-qr-checkin 10, test-rls 85, screens both themes |
| **W-01** respect marks | **Done.** Opposition manager and referee mark players / coaches / spectators 1–5 after a game with a note; league dashboard lowest first with the notes; a club sees its own averages; a parent nothing; never public (the table has no read policy at all). The referee's report form carries the marks for both sides | test-respect 21, test-rls 83–84, screens both themes |
| **W-07** game changes + overdue block | **Done.** A club proposes a move with a reason, the other club agrees or declines (pushed, with a note), the league approves — through the ordinary reschedule, so families hear — or rejects; a notes thread for the managers; a parent sees none of it. The overdue-fee block is a club setting (off by default) with a grace period; it only ever stops a *yes*. The suite needed NRIFA's U8 coach as the club's manager (the owner also owns the SPL) and had to park the seed's old unpaid fees | test-fixture-changes 28, test-rls 81–82, screens both themes |
| **W-05** auto referee assignment | **Done.** Preview a day (who is free, lightest load first, keep a referee at the ground for back-to-back games), Ask them all as one batch of ordinary offers, Undo the ones not yet accepted. The suite's first run exposed a real flaw in 0161's clash rule — the 30-minute travel buffer applied between two fields at the same ground, so nobody could ever do 9:00 and 10:00 at one venue — fixed in 0173 | test-referee-auto 24, test-rls 80, test-referees re-run, screens both themes |
| **W-04** privacy centre + the notice | **Done.** One section per child on My family — who sees what, from the code that decides it; the parent's public-name switch wins at once on the public page; links to the card, export and erase. `/privacy` is the notice written for a nine-year-old first, with the parents' version under it, cookie-less, linked from every public competition page; every sentence in it is checked against a migration | test-privacy-centre 15 (public page re-checked after the switch), test-rls 79, screens both themes |
| **W-03** safeguarding gate + conduct register | **Done.** A lapsed WWCC (expired, barred, not found) removes coaching rights on the spot — roster, sheets, posting to children's channels — and the board says so; renewal gives them back; nothing recorded stays the 0120 backlog. A reportable-conduct register any member can file into from Settings, read only by safeguarding officers, with referred-to and outcome. First run found the roster still readable through team membership (0170); the live policies use `app_private` helpers, not 0013's public ones | test-safeguarding-gate 24, test-rls 77–78, chat / sheets / card / family suites re-run green, screens both themes |
| **W-02** concussion register (M10 begins) | **Done.** A parent or coach records it; the child is refused on every sheet by name until the club accepts a medical clearance uploaded into a private bucket (family + club coaches only); the referee's card says "No play". Neither Squadi nor Dribl holds this | test-concussion 19, test-rls 75–76, screens both themes |
| **M9 acceptance** `test-league-season` | **Passes.** Six divisions, eight clubs, 168 games drawn weekly on two grounds and mirrored into families' calendars; a referee appointed, accepting, checking in, reporting and paid; both sheets, confirmed by the other side; a red card that suspends a child and is refused by name on next week's sheet; a washout that postpones 24 games and tells the U8 parent why, then a reschedule that tells them it is back on; the ladder, then a final seeded first v second; the public page with 169 fixtures, the ladder and top scorers and not one phone number; the parent seeing the draw and nothing else. 44 assertions as five people. `smoke-demo` gained a four-role league section | test-league-season 44 |
| **L-02 / L-16** entries and fees | **Done bar the Stripe charge.** Entry fees per division with the league's own "how to pay"; owed the moment an entry exists, owned by the club that claims it, ticked off by the treasurer (bank / cash / waive); the club sees what it owes. Teams enter from the public page with no account, rate-limited, and an accepted request becomes an entry plus the same join link an invited club gets. Online payment to the league waits on the key (B-09) | test-league-entry 31 through the real route, test-rls 73–74, screens both themes |
| **L-14** a league brings its draw | **Done.** `/competitions/[id]/import`: a file the league exported itself, mapped column by column with a human, previewed day-first, written once — entries per division (linked to entered clubs by name), fixtures at local time with the file's match id kept so a re-import moves a game instead of doubling it and leaves a played one alone. Squads stay with each club's roster import. Hit the regex-after-a-statement ASI trap for the sixth time; named the value | test-league-import 18, test-rls 72, screens both themes |
| **L-15** reports | **Done.** Results, ladders, discipline and entries as CSV from one route (referee payments from L-07's); each through the caller's own session, so a club gets its competition and the organiser the contacts; a Reports card on the Clubs tab. No migration — every report reads what was already built | test-league-reports 9 through the real route |
| **L-13** league roles | **Done.** Competition manager, referee coordinator, discipline officer, ground manager — held at the league, given to its members by staff. Writes are scoped by area (`may_run`), so the referee secretary cannot touch a ladder and the ground manager cannot overturn a suspension; every official still sees the draw and never a club's people. The twenty area functions were regenerated from the live database with one guard swapped rather than retyped. First run caught `v_areas \|\| 'staff'` being read as array-concat (0165) | test-league-roles 35, test-rls 70–71, four earlier suites re-run green, screens both themes |
| **L-12** share link + widget | **Done** (L-12 complete). A Share button on the public page; `/c/[slug]/embed` is the widget — no header, a link back, the one path the site allows to be framed (`frame-ancestors *` on that path only; DENY everywhere else) — and the organiser copies an iframe snippet from the publish control, choosing ladder / fixtures / scorers. The dev server needed a restart for the header change | test-league-public 19, screens both themes |
| **L-07** referee payments | **Done bar the Stripe transfer.** Fees per role; a run from the games referees checked in to (never twice, amounts locked at build time); paid by bank transfer / cash in one tap or by Stripe transfers when the key and both accounts exist (the route says which is missing); void a draft; the treasurer's CSV with bank details; the referee's page shows fee, owed and paid, and takes bank details that only the league's staff can read | test-referee-payments 23, test-rls 68–69, screens both themes |
| **R-18** Circular 26-02 (Joey's ask, 30 Oct) | **Done.** Per-program "requires PlayFootball registration"; FFA number + FIFA ID on the public form, the request and the roster; Accept refused in the route *and* by a trigger until the club confirms (one tap on the request) or the export says so; `/admin/import/playfootball` reads the club's own export — never a login, never a scrape; a per-season "fees are in PlayFootball" tick in club settings. Plan docs for the rest of SQUADI_INTEL §6 landed in the same hour (BUILD_PLAN, DRIBL_PARITY, SPEC, CLAUDE.md) | test-circular-26-02 21, test-rls 66–67, screens both themes |
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
| **S-07 Two-step sign-in, the app's half** (4 Nov; migration-free; TOTP is enabled on the project) | **Done.** Settings → Two-step sign-in (QR / key, six digits, on; confirm to turn off); a full-screen gate above every page for a password-only session once a factor is verified; the Admin hub asks owners and admins without it. The database's half — refusing AAL1 for staff writes, and the gate being undismissable for staff — is migration-day work. A code is good once per thirty seconds, which the test had to learn | test-two-step 16, gate and settings at 375px light and dark |
| **R-21 Registration dashboard** (4 Nov; migration-free) | **Done.** One card at the top of Admin → Programs: this season's registrations by status, children, new vs back, age groups (U9, U11, …), gender where recorded, places filled against capacity. Computed in the browser from what RLS lets the person read; a parent gets no card. "Against targets" beyond capacity needs a column — migration day | test-registration-dashboard 8, 375px light and dark |
| **X-10, the labels half** (4 Nov; migration-free, picked because the token is dead) | **Done.** A browser audit of 21 screens (parent, coach, owner, stranger; 375px): every control named, every field labelled, every image described, nothing under 24px to tap, the current tab says so. Found and fixed: the chat search, the composer, the message editor, the poll fields and two settings menus had only a placeholder; thirty-odd text-styled buttons were 16–22px tall ("Have a voucher code?", "Withdraw", "Remove", "Add a reaction", the sender's name, "Email me a link instead", "Reply", "Report", "Send later…") — a `.tap` class gives them 32px of hit area in place. B-08's safe half went in the same hour: a new club account asks Stripe for BECS so its review starts; Checkout stays cards-only until BECS is active on the account and `payments` can say *processing* (migration day) Full run #16 then caught the orange cards: white on `#DD5620` is 3.9:1, and once the Admin hub rendered fast enough to be measured the screens suite failed it. The light accent is `#C2410C` (5.2:1 with white) and every orange surface now takes its text colour from `--accent-ink` instead of hard-coded white, which also fixes dark mode's light-orange cards | test-a11y 22 (21 screens + the tab bar), screens 36, tsc clean |
| **X-10, Dynamic Type** (4 Nov; migration-free) | **Done.** Every text size in rem (12 px sizes in 58 files and the stylesheet; the badge, two selects, an attachment chip and a Home tile sized in rem too), no font size on `html`; Android opts in with the `text-scale` meta tag (Chrome 146+ scales the root itself), the iPhone through `lib/text-size.ts` (Dynamic Type via `-apple-system-body`, 16–32px, before the first paint). Two screens broke at 200% — the game page's Going/Maybe/Out and the public match centre's tabs — and now wrap; the chat card's row got the same rule. Unchanged at the default size (screenshots of the rows at 100% and 200%, light and dark). Also: a training session's call-off button said "Call this game off" — the word now follows the event; the five Create Next App SVGs in `public/` deleted | test-text-size 17 (new), test-a11y 64 (21 screens × labels, 125%, 200% + the tab bar), tsc clean, lint clean on the changed files |
| **The Squadroom brand** (Joey, 4 Nov evening, `brand/`; migration-free) | **Done.** White on near-black `#101012`, monochrome greys (no blue tint), colour only where it means something: orange needs you, green going, red out/called off — no navy, no gold, "maybe" grey. `--bar` (the app bar, sign-in, join, the public heroes, the player card) is `#101012` in both themes; `--brand` (primary actions) flips, near-black on light and white on dark, so every surface's text takes that surface's ink — a codemod moved 194 tags from `text-white`/`#fff` to `text-brand-ink`/`yes-ink`/`no-ink`/`maybe-ink`, and 30-odd more by hand (W/D/L tiles, the event chip, respect marks, bar buttons, headers). The "SQ" tile is the SR icon on `/join` (the small variant at 48px) and the logo on sign-in and `/for-clubs`; favicon (16/32/48), apple-icon, PWA 192/512 + maskable, the notification badge and a web manifest rendered from the kit by `scripts/brand-icons.mjs`. The academy colour no longer paints the in-app bar or buttons (the club pages keep it, with black-or-white text by contrast — `lib/brand/colour.ts`; the next brief brings club colours back as a choice). Before/after at 375px, parent, coach and signed out, light and dark (`.shots/brand/compare/`; the coach's before re-taken from the previous commit after the first pass caught a transient redirect) | test-brand 29 (new: every token pair AA in both themes, lowest 4.95:1; the dark blocks identical; no white on a flipping surface; no SQ/gold/navy; icon sizes, colours and the badge's transparency; manifest and head links; the logo and icon placed; the bar and sign-in measured in a browser), test-screens 36 (every screen reads in light and dark), test-a11y 64, test-text-size 17, role-nav 33, org-follows 20, for-clubs 10, join-codes 16, two-step 15, public-academy 17, tsc and lint clean |
| **G-10 Club & league branding + Appearance** (Joey, 4 Nov, late; 0209 written, unapplied) | **Done in the app.** Settings → Club settings (owner/admin): logo upload (PNG/SVG/JPG) with its colours read in the browser and suggested, main and second colour, a phone previewed in light and dark before Save, and in words wherever a colour had to be deepened or lightened to read. The logo replaces the initials in the app bar, the organisation switcher, the front door, the registration form and the share cards (the second colour is the card's rule). Club colours drive the bar, primary buttons, the active tab and highlights for everyone on Club colours (the default); black-or-white text on any colour; orange, green and red never change. A league the same: its colours and logo on its public match centre once 0209's `public_brand` exists. Settings → Appearance (per person): Club colours / Black & white × Match my phone / Light / Dark, applied at once, on this phone now and in the profile after 0209; a cached stylesheet paints the club's colours before the first frame, only on the app's own screens — sign-in, Squadroom's pages and every club's public pages are never the reader's club. Sign-out clears both. The sign-in email moved to Squadroom's black and white. Demo: NRIFA's crest and an SPL stand-in logo (NEEDS JOEY #16) set by `refresh-demo` when a club has none. Screenshots at 375px: `.shots/club-brand/` (NRIFA with its crest, SPL with its logo, a parent in each of the four designs, Appearance, the owner's editor) | test-branding 42 (new) + 2 waiting for 0209; test-rls 112–113 written; test-brand 29, test-screens 36, test-a11y 64 (the front door's header now wraps under the crest at 200%), test-text-size 17, share-cards 14, league-public 18, public-registration 47, public-academy 17, player-card 15, role-nav 33, org-follows 20, for-clubs 10; tsc and lint clean |
| **The game page, as a match preview** (Joey, 4 Nov; X-05; 0210 written, unapplied) | **Done.** A hero at the top of every game: both crests (the other side's when Squadroom knows it — 0210 `fixture_sides`; initials until applied), both names with home on the left, and in the middle the countdown ("In 9 days"), on the day the kick-off time, then the live score, then "Full time 1–3" — on the club's colour. Tabs **Preview \| Match sheet \| Ladder** (Ladder only in a competition; Preview before kick-off, the sheet once it has started; `#sheet`/`#ladder`). Preview: availability first (family and coach), the details, the ground and map, both sides' last five (a league game's results live on the fixture, so in a competition both come from its results), the two sides' ladder rows with the full table a tap away. **Times:** the page formatted every time with the machine's clock — the server's UTC for the first frame on Netlify, the phone's after — so a 2:20 pm kick-off could read 3:20 am. `lib/time.ts` names the venue's timezone (the club's) on every game time, swept across 20 screens (Home, Fixtures, the chat card, match sheets, the public match centre, the importer…); the dates that are not game times (birthdays, due dates, message times) stay the reader's. Training keeps the plain layout. Screenshots: `.shots/game/` (parent and coach, light and dark: Preview, Match sheet, Ladder, a played game, a friendly) | test-game-page 26 (new), availability 21, a11y 64, navigation, matchdays 27, match-day-list 21, nudge 24, live 22, results 21, event-cards 11, role-nav 33, screens 36; tsc and lint clean |
| **The suites were damaging the demo** (5 Nov, found by full run #19) | **Fixed.** Three ways the test suites had been quietly wrecking the data Joey demos with, each now stopped and the damage put back: (1) `test-event-cards` moved the real next U8 game nine days out and restored only its venue, so the game drifted from its fixture; on a Thursday nine days out is the Saturday `test-call-off-day` calls off, which **called off real SPL games** (30 Oct and again today) — it now restores the time too, and the call-off suite picks a Saturday with no real event at all. (2) The call-off suite's "never touches a session under way" check called off **today** at ELS Hall, which took the real U8, U10 and U12 trainings tonight — it now uses a ground only the test has. (3) Five suites deleted their messages the way a person would and cleaned up by matching text a deleted message no longer has, so the U8 SPL chat was **113 "Message deleted" bubbles out of 161** — `scripts/_purge-test-messages.mjs` now removes a suite's own messages and their archive rows, at the end of each. Restored: 5 games and 3 trainings back on (only events carrying the test's own cancellation notes), Rounds 9 and 10 re-timed to 9 am on 14 and 21 Nov on fixture and event alike, 227 test messages purged (the one real archived message kept), `refresh-demo` run | call-off-day 18 (0 real events touched, counted before and after), event-cards 11, game-page 26, chat 14, message-edit 9, privacy 35, reporting 27, search 10, live 22; U8 SPL chat: 0 placeholders after all six message suites ran |
| **E-01b Edit one occurrence** (5 Nov; migration-free; the last BUILD_PLAN item buildable without the token) | **Done.** "Change time or place" on a session's page for its coaches and the club's admins: date, start, finish, arrive-by, ground, address, in the ground's timezone (a coach whose phone says UTC still types 17:30 and gets 5:30 pm in Sydney); the finish and arrive-by move with the start unless changed; only that row of the series moves; the squad gets the existing change alert. A league game says the league sets its time instead. 375px light and dark: `.shots/edit-occurrence/` | test-edit-occurrence 12 (new) |
| **A guard for the demo, in every full run** (5 Nov) | **Done.** `npm run test:all` now snapshots the demo between suites (`scripts/_demo-snapshot.mjs`: clubs, games, fixtures, squads, players, programs, memberships, competitions, clearances, and each chat's message and deleted-message counts — ½ s) and fails any suite that leaves it changed, naming the row. Its first full run (#20) named one more: `test-dms-and-approval` deleted **every direct message in the club** at its start — a demo's real conversations included — and left its own two behind; it now removes only the conversations it opened. Also from #20: `test-availability` compared the grid with every answer row, but a child with two guardians has two (one said yes, one maybe) and the grid rightly shows the latest — the check now compares with the latest. That found a real bug: the coach's who's-coming tally and the grid's "going" count ROWS, so one child answered by both parents is "2 in" — **0211 written, unapplied** (each child once, by their latest answer; test-rls check 114) | full run #20: 132 suites, 2,634 assertions — four not passing: rls (the token), and three fixed and re-run green (dms-and-approval 18 with nothing left behind, availability 21, a11y) |
| **X-10, the 24px floor again, and the brand's radios** (5 Nov) | **Done.** With the demo's real messages visible again the audit met controls it had never seen: the reaction chips (22px tall → 24px), the coach's match-day ticks (20px → a 32px target around the same 20px box), "1 reply ›" (16px → `.tap`). The audit no longer counts a visually hidden heading as "cut off", and it now counts controls under 44px (353 on its 21 screens, for the record — the 24px floor is what fails). Native radios and checkboxes take the brand's colour (`accent-color`), not the browser's blue | test-a11y green, test-brand 29 |
| **X-10, 44px where the thumb goes most** (5 Nov) | **Done** for the app bar. Every link and button in an app bar (Back, the crest, the header's action, the chat's Back and settings) carries a transparent 44px layer centred on it — nothing looks bigger; a tap 3px outside the visible 36px Back still goes back. The audit counts it (342 controls under 44px left, from 353, almost all repeated per-message chat controls and filter chips that already clear the 24px floor). Making those 44px would change how the chat looks; not done without Joey | test-a11y, screens 36, role-nav 33, navigation, org-follows 20 |
| **X-09 Score taps with no signal — and the outbox, which had never worked offline** (5 Nov; migration-free) | **Done.** The live score's taps now go through the outbox like the register and the RSVPs: with no signal the score, the hero and the timeline move at once, marked "waiting for signal", each tap keeps the minute it was tapped, and they arrive once, in order, when the signal is back; Undo on a tap still waiting takes it off the phone, so a slip never reaches the families' chat. **The first time the outbox was driven in a real browser with the signal cut, nothing was kept at all:** it asked the auth server who was signed in, so every write was refused as "Not signed in" — and the home RSVP dropped the answer silently while still showing it chosen, and the game page's and chat card's RSVP threw. It now reads the person from the phone's own session (`lib/offline/owner.ts`). Also found and fixed: a failed fifteen-second refresh blanked the coach's live panel, buttons and all, and stopped the hero refreshing for the rest of the game; a write made as the signal returned overtook the queue ("out" then "in" could arrive as "in" then "out"); every try with no answer counted towards the five-attempt cap, so a goal tapped in a dead spot was thrown away after five glances at the phone; a phone showing bars that carry nothing left a tap spinning for as long as the browser cared to wait (now kept after 6 s); the drain asked the auth server while holding Supabase's lock, so one stalled request could freeze every write after it; a kept write refused later was never mentioned (the bar now says so); the bar sat at the very end of long screens (now stuck above the tab bar, on an opaque ground). **Two known limits, each a migration for token day:** a tap whose answer was lost after reaching the database is sent twice (needs a client id on `live_tick`), and other phones count minutes from when a queued kick-off arrived (needs `live_tick` to take the kick-off's own time; this phone keeps its own). 375px light and dark: `.shots/no-signal-*` | test-outbox 46 (was 31), test-no-signal 33 (new: a browser offline, and with bars that carry nothing), tsc clean |
| **League notices** (Joey, 5 Nov, late; extends L-11; 0212–0213 written, unapplied) | **Done in the app.** Each competition has a read-only Notices channel everyone in it is in (league, entered clubs' owners/admins/coaches, families of entered teams, referees), worked out from the competition and never stored as member rows. The league posts to Everyone or Club staff only; push follows; "Seen by N of M" for the league, a count; no replies, reactions, mentions or typing; club-staff notices, pushes and files invisible to families by policy. **Reverses CLAUDE.md's "see the draw, not each other's people" at Joey's word** — recorded there and as spec D-5, with what it protected kept. Found on the way: `channel_messages` reads as its definer and would have handed a family a staff notice; 0213 re-makes it. Email through Resend when there is a key (silent without; NEEDS JOEY #19). The competition's "Send" tab is "Notices"; the old broadcast runs until 0213. Tidy: an empty "SHOT:: Sydney Premier League" competition, left in the SPL by a screenshot script on 3 Nov, deleted. 375px light and dark: `.shots/notices-*` | test-notices 4 (+8 waiting for 0213), test-league-comms 6 (holds before and after), test-rls 115–123 written; chat, message-edit, reporting, search, dms, screens, a11y, nudge re-run green |
| **Every account has an email** (Joey, 5 Nov, late; S-08; 0214 written, unapplied) | **Done in the app.** Joining asks for it beside the mobile (refused without), registration requires it, and an account without one is asked once on its next open with no skip; approval copies it to the account. Kept beside the sign-in address, not in it (a phone-joined parent's placeholder is what the claim routes find them by). Settings → Your email; one-tap confirmation links (Resend; silent without). The news-and-offers box is unticked everywhere, stored with its time, every change kept. Only the person and their own organisation's owners and admins see it. A phone-joined parent is no longer shown their placeholder address in Settings. 375px: `.shots/email-*` | test-required-email 10 (+ the screen once applied), test-rls 124–129 written; join-flow, join-codes, program-questions, public-registration, circular-26-02 now send an email, all green |
| **A teenager's login, with a parent's yes** (Joey, 5 Nov, late; S-06 reversed in part, D-6; 0215 written, unapplied) | **Done in the app.** Under 13 never; from 13, My family → Their own login (the child's own email) → the teenager signs in and waits → the parent approves or says "not them". The database refuses any other route (player membership, player link, squad place). An account already in a club is never claimed as a child's. Regulatory questions in NEEDS JOEY #20 | test-rls 130–133 written (the probes roll themselves back) |
| **The scale test, first half: every key screen under a second** (6 Nov; migration-free bar one grant added to unapplied 0209) | **Done on the dev data.** `scripts/time-screens.mjs` times parent Home, Chat, the U8 chat, Fixtures, a game, coach Home, Admin (coach and owner), the SPL ladder and a public match centre in a production build — cold and warm, requests counted, repeats named. It found: the chat asked for reactions once per bubble (61 requests → 14, `lib/batch.ts`), file links re-signed on every visit (kept per tab, cleared at sign-out: warm chat 788 → 420 ms), the tab bar's badges fetched twice per page, Home a chain of two round trips (now one, `lib/early.ts`), the new email/teen checks on every page (now once per session) — and **a real bug: a person's Appearance had never loaded**, because the theme asked for `*` on profiles and the withheld phone column made the database refuse it; it now asks for its two columns and 0209 grants them. All ten screens under 1 s cold. Write-up and the plan for the big run: `docs/SCALE.md`. The big run itself waits for #12 and #18 | time-screens (a tool, not a suite), test-request-sharing 9 (new); chat, attachments, media, role-nav, self-onboarding, vouchers, brand, branding, first-run, organisations, required-email, screens, a11y, text-size re-run green |
| **A local Postgres for the migrations: all 216 apply, all 133 RLS checks pass** (6 Nov; tooling, one new no-op migration, one fixed) | **Done.** `scripts/local-db/run.mjs` replays every migration into an embedded Postgres 17 on this laptop (opt-in, `npm i --no-save embedded-postgres`; stand-ins for Supabase's auth, storage, realtime, pg_cron and pg_net in `supabase-stubs.sql`); `copy-dev.mjs` copies the demo's rows from squadroom-dev, read-only, so the pending migrations run on top of real data as they will on token day. **0208–0215 all apply on the demo's data, and test-rls passes all 133 checks, 111–133 included** — the eight migrations waiting for the token are no longer untested. Found and fixed: `'tournament'` was never added to `event_type` by a migration (added on the database by hand), so a replay from empty — which is how a Supabase branch is built — failed at 0045 (new 0044a, a no-op on dev); 0121 had an unescaped apostrophe and could never have run as written. Mirrored: Supabase owns the extensions, so 0015's sweep could not revoke citext's EXECUTE there; locally it could, so the runner restores it | test-rls 133/133 locally |
| **Simplicity pass on Home** (Joey, 4 Nov; parent and coach, 375px) | **Done**, no migration. (1) Parent Home **2.4 → 1.4 screens**: the "Your jobs" strip is folded into Needs you (the three jobs are rows there, still `data-job` for the two-tap rule), the Channels list is gone from Home for everyone (the Chat tab carries it), a parent sees the next two fixtures and a coach three with "All N in the next 3 weeks". Coach Home 1.7 → 1.3. (2) One number: "to answer" everywhere is games and sessions in the next three weeks a child has not been answered for (`home_jobs`'s count) — Needs you says it, the training block's total counts sessions, the Fixtures list's per-game pills say "To answer" without a number so one game never reads as two. (3) One orange card, the most urgent; the rest plain rows. (4) An announcement older than 14 days is not shown (the "event date passed" half needs a column — migration day). (5) A signed-out visit to / goes to /signin: the screen hook now checks the session when a fetch fails. (6) Training rows sat on the card's edge — the block lacked the event card's padding class. (7) "17 quiet" → "17 not answered" (Home and Fixtures). (8) ☰ → "✎ Edit". (9) **Sam in COACHES SPL:** a *custom* chat Joey made by hand with two parents in it, not the coaches channel; the parents are out of it, and `test-coaches-channel` proves no parent sits in any channel named or typed for coaches and that RLS hides the real one from Sam. **Marcus's Admin:** the hub offered a coach New season, Venues and Start a competition, which the database refuses (`only an admin…`) — hidden now; `test-coach-scope` proves the refusals and the hub. One gap: the database still lets a coach *insert* a competition (0022's policy says coach) — **0208 written, unapplied until NEEDS JOEY #12**. Before/after: `.shots/home/{parent,coach}-{before,after}-*.png` (gitignored; on the laptop) | test-coaches-channel 5, test-coach-scope 15 (+1 note), role-nav 33, screens 36, tsc clean; Home as parent and coach at 375px light and dark |
| **Every screen follows the organisation the browser is showing** (4 Nov, found by the 375px pass: Admin → Payments showed the stray "NRIFA" for Joey) | **Done**, no migration. `lib/use-current-org.ts` resolves the remembered organisation against the person's active memberships (else their first, and corrects the memory); the Admin hub, Admin → Payments, Members, Invites, the roster importer, Scan and the family's Payments became thin pages with browser-side loaders (RLS does the reading); Teams and Directory prefer the remembered organisation. NEEDS JOEY #8 closed bar the `nrifa-1` question | test-org-follows 21 (a throwaway "AAA" organisation that sorts first; nine pages; switch; fallback; nothing remembered), role-nav 33 and screens 36 re-run against the new code, tsc + eslint clean, Admin → Payments and the family's list at 375px both themes |
| **The Stripe half** (3 Nov, Joey's key): B-01 card step, R-04 one checkout for the family, B-02 instalments, B-03 siblings, B-07 vouchers, B-04 refunds, L-02/L-16 entry fees; L-07 referee payouts tried and **parked** | **Done** (0207: one payments row per child per session; `entry_fees` remember their session). Routes: connect (Express, v2) · checkout (many children) · entry-fee · refund (named refunds) · webhook (`capability.updated`, `refund.*`). Screens: Admin → Payments reads the status back on return; the family's list gets "Pay … for X and Y in one go". Checkout cards only. Referee payouts: Stripe refuses connected-to-connected transfers; Joey parked them (tracking only) and the referee Stripe button, the league's "Pay through Stripe" and both routes came out. See the evening summary | test-stripe-e2e (by hand, 36 checks, every money path green), payments / fees / program-fees / fee-settings / league-entry / referee-payments / vouchers suites green, tsc + eslint clean |

### Deploys

| Date | What | Outcome |
|---|---|---|
| 3 Nov 2026 (Tue), deployed in the first minutes of Wed 4 Nov Sydney time | Everything since the last deploy (27 Oct): 0147 → 0207 — M9 league mode, M3, M4, M5 (bar photos), G-01/G-03/G-05/G-08, R-18/R-19, L-29, X-12 Matchdays, the sponsor slots, the Stripe half, referee payouts parked. Joey asked for it with the Netlify token on 3 Nov | **DEPLOYED** — `npx netlify-cli deploy --prod --build` with the token from `.env.local` and `NEXT_PUBLIC_SITE_URL` forced to the live address (a local build would otherwise bake `localhost:3000` from `.env.local`). Build 51 s; 104 files, 4 functions, 3 edge functions. Before it: full run **#12** (121 suites, 2362 assertions; failures were the dead Supabase token (rls), the by-hand Stripe suite mis-read as a crash, and withdrawals expecting the no-key answer — the last two fixed) and **#13** (121 suites, **2382 assertions, green bar test-rls, which cannot run without a working `SUPABASE_ACCESS_TOKEN`** — NEEDS JOEY #12; RLS last ran green in run #11 and 0207 adds no policy); `test-stripe-e2e` green by hand. After it: `/`, `/signin`, `/nrifa`, `/c/nrifa-spring-gala`, `/for-clubs`, `/join`, `/nrifa/register`, `/status` all 200; the new payment routes answer; the removed referee route is 404; no `localhost` in the HTML; `smoke-demo` against the live site: **0 blocking, 8 worth knowing** (no referees in the SPL pool for the demo; Stripe not connected on the live site — NEEDS JOEY #14; no push devices). Demo data refreshed around today first (`refresh-demo`, `demo-passwords`). |
| 3 Nov 2026 (Tue) | Milestones complete under the new rule: **M9 League mode** (bar Stripe), **M3 WhatsApp feel**, **M4 the Dribl side**, **M5 match centre and stats** (bar photos and sponsor slots), plus G-01, G-05, R-19, L-29 and the money polish (0168 → 0204); full runs #7, #9, #10 green | **NOT DEPLOYED — no `NETLIFY_AUTH_TOKEN` in `.env.local`** (NEEDS JOEY #7). Deploys the first weekday the token exists and the full run is green. |
| 1 Nov 2026 (Sun, weekly slot) | Everything from 0147 to 0167: M9 league mode, R-18, the two fixes | **NOT DEPLOYED — no Netlify token** (NEEDS JOEY #7). Next slot Sunday 8 Nov. |
| 30 Oct 2026 | One-off deploy Joey authorised: the live site is missing the Next.js security fix (16.3.3 → 16.4.3) | **BLOCKED — no Netlify credentials on this machine.** See NEEDS JOEY #7. Probing `squadroom-dev.netlify.app` showed it is **at least three days stale** (`age: 255224`): `/nrifa/register` and `/api/share/weekend`, which have existed for days, answer 404 there. So nothing auto-deploys from GitHub, and production is on the vulnerable Next. **Resolved by the 3/4 Nov deploy above (Next 16.4.3 is live).** |

**Session log.** 3 Nov 2026, evening → 4 Nov just after midnight: stopped
after the deploy and its checks, with the build order's next items either
needing Joey (a Supabase access token for any migration, NEEDS JOEY #12)
or done. Carrying on with what needs no migration (the 375px pass on the
changed payment screens) in the same session.

### NEEDS JOEY (added overnight)

**9. Is the SPL sanctioned by Football NSW, and is NRIFA a "Club" under
the FA regulations?** `SQUADI_INTEL.md` §1 says Circular 26-02 binds FA,
member federations, districts, clubs and registered players, and is
silent on independent academies and unsanctioned competitions. R-18 is
built so it works either way — "requires PlayFootball registration" is a
per-program switch — but which programs you switch it on for is your call,
and the answer to this question decides it.

**10. Where M10 Differentiators sits.** Added from `SQUADI_INTEL.md` §6C
straight after M9's core, as the intel recommends. Say if you want it
after M7 or M8 instead; nothing else moves.

**11. Pricing (§6E) is left for you,** as asked. Your rule — paid by clubs,
academies and leagues, never parents; no billing or plans built yet — is in
CLAUDE.md.

**12. (3 Nov, afternoon) The Supabase personal access token has stopped
working.** `SUPABASE_ACCESS_TOKEN` in `.env.local` (an `sbp_…` token) now
gets `401 Invalid access token` from the management API — from
`scripts/_sql.mjs`, `npx supabase projects list` and a plain
`GET /v1/profile`. It worked at 20:30; the file is intact (checked line by
line, nothing printed). Until a new one exists: no migrations can be
applied, `test-rls` cannot run (it exits 1), and `test-match-day-list`
skips its cron check. To fix (free, ~1 minute): Supabase dashboard → your
avatar → **Account → Access tokens → Generate new token**, name it
"squadroom laptop", and replace the `SUPABASE_ACCESS_TOKEN=` line in
`.env.local`. Then tell me; `npm run test:all` re-runs the RLS suite.
Waiting on it (4 Nov): **0208** (a coach cannot start a competition) and
**0209** (a club's second colour, a person's Appearance in their profile,
`public_brand` for league colours on the public match centre) — test-rls
checks 111–113 are written for them. And **0210** (`fixture_sides`: the other
side's crest on a game's hero). And **0211** (a child with two guardians
counted once in the coach's tally and the availability grid). And (5 Nov,
late) **0212–0213** (a competition's Notices; test-rls 115–123), **0214**
(every account has an email; 124–129) and **0215** (a teenager's login with
a parent's yes; 130–133). **6 Nov: all of them are tested** — applied to a
local Postgres on top of a read-only copy of the demo, every RLS check
passes (`scripts/local-db/`). Token day is a `npm run db:migrate` (which
will also apply 0044a, a no-op on dev) and a full run, not a gamble.

**13. — decided.** Referee payouts through Stripe are **parked** (Joey, 3
Nov, evening): no Stripe payouts and no bank files for referees; tracking
only — who refereed, the fee owed, the treasurer marks the run paid. The
"Pay through Stripe" button, the referee's "Connect Stripe" and both routes
were removed the same evening; `referees.stripe_account_id`,
`referee_payment_items.stripe_transfer_id` and `paid_method = 'stripe'`
stay in the database until a migration day (NEEDS JOEY #12 first). Noted
as parked in BUILD_PLAN under L-07.

**14. Stripe on the live site, and NRIFA's real onboarding — two small
things only you can do.**
- The test key and webhook secret are on the laptop only. If you want the
  live demo to take test payments, say so and I will add
  `STRIPE_SECRET_KEY` to Netlify and register the live webhook endpoint
  with Stripe (it gives the secret). Nothing is charged in test mode.
- NRIFA's Stripe account is an Express one and only a person can finish
  its onboarding (see the evening summary). Admin → Payments → **Set up
  payments** opens Stripe's test-mode pages: "Use test phone number" →
  Submit → "Use test code", then test data through the rest. Two minutes.
  Until then the suite stands in with a test-mode account it makes and
  closes itself.

**15. — decided.** No Squadi export is possible; Dribl only (Joey, 4
Nov). F-06 will not be built; the spec says so.

**16. The Sydney Premier League's real logo.** The demo's SPL logo is a
stand-in I drew (a green shield with a gold rim and a ball,
`scripts/fixtures/spl-demo-logo.svg`) so the league's branding could be
shown and tested. If the league has a logo file, upload it in the app as
SPL's owner: switch to the league → Settings → Club settings → **Change
logo**. `refresh-demo` only fills a club with no logo, so it will not put
the stand-in back.

**17. Appearance — one reading to confirm.** "4 basic designs: Club
colours, Black & white, Light, Dark, plus Match my phone" is built as two
choices: *Club colours* or *Black & white*, and *Match my phone*, *Light*
or *Dark* — so the four designs are the two colour choices in light and in
dark, and Match my phone is the default for the second choice. If you meant
four separate looks in one list (with Light and Dark being something other
than those), say how they should differ and I will change the screen.

**18. The scale test (your 5 Nov brief) — queued for after the weekend,
with two questions first.** It needs the token (#12) anyway. Before I
start: (a) **Supabase branching is a paid feature** — it needs the Pro plan
(about $25 a month) and each branch is billed for as long as it exists:
$0.01344 an hour on the smallest compute (about $10 a month if left
running), not covered by the plan's compute credit, plus its disk and
egress. A timing test worth trusting wants a bigger compute size than the
smallest, which costs more an hour — a day's test is a few dollars, a
forgotten branch is a monthly bill (Supabase's "Manage Branching usage"
page, checked 5 Nov). Your standing rule is no spending without your
say-so. (b) A
branch is its own database with its own project ref, and CLAUDE.md says
*only ever touch squadroom-dev* — I read the brief as you allowing a branch
OF squadroom-dev for this, and nothing else; say if that is wrong. The free
alternative is the same dataset in a local Supabase (`supabase start`,
Docker) on this laptop: the query plans, indexes and RLS fixes carry over
exactly, but the timings are a laptop's, not Sydney's, so the plan
recommendation would lean on Supabase's published numbers instead. Which
do you want? **(6 Nov) A third way, free and already working:** an
embedded Postgres on this laptop, no Docker (`scripts/local-db/`, all 216
migrations apply). It can hold the big dataset and give real query plans
and RLS costs — what the EXPLAIN-and-index half needs — but not Sydney's
network timings. I will start the dataset and the plans there; the hosted
branch is only needed for the timings, if you want them.

**19. A Resend account and a sending domain — for December (league
notices and required email, 5 Nov).** League notices are also emailed, and
every account's email is confirmed with a one-tap link — both through
Resend, and both do nothing, quietly, until there is a key: notices still
arrive in the app and by push, and an email is saved, just not confirmed.
To turn it on (Resend's free tier, no money): make a Resend account, add
the domain you will send from and put the DNS records it gives you on it
(SPF/DKIM), make an API key, and put `RESEND_API_KEY=` and
`MAIL_FROM="Squadroom <notices@your-domain>"` in `.env.local` and on
Netlify. Each league should also fill in its contact email (Club settings
→ Contact email): it becomes the reply-to. Then, once: everyone with an
unconfirmed address needs a link sent — I will do that the day the key
lands. Separately, Supabase's own mailer (used by /signup) only reaches a
few addresses an hour; pointing Supabase Auth's SMTP at Resend fixes that
too.

**20. Accounts for players aged 13 and over — your 5 Nov brief reverses
"nobody under 18 gets an account"; three things to confirm.** Built as you
wrote it (0215, unapplied): under 13 never; from 13 only with their own
email and a guardian's approval, and the database refuses every other
route. But the old rule was also a regulatory decision, and these are now
open: (a) **Australia's under-16 social media minimum age** (in force since
10 Dec 2025) — whether a team app with group chat is an "age-restricted
social media platform" or falls under the messaging/education exemptions
is a legal question; until it is answered I would keep player logins 16+
or chat-off for 13–15 (one line in `app_private.is_thirteen` and a
channel rule; say the word). (b) **The privacy notice** (#4) must now speak
to a 13-year-old, and the Children's Online Privacy Code applies to child
users, which there were none of. (c) **Junior referees** can already claim
a login (0161) and declare themselves under 18, with no parent involved —
should that route need a guardian's approval too? Also: anyone can make an
account at /signup and nothing asks their age; that was true before and is
unchanged.

**1. Stripe test key — DONE 3 Nov.** Joey pasted the key into chat rather
than the file; it is in `.env.local` now and nowhere else, but a key that
has been in a chat window is a key worth rolling one day (Developers → API
keys → Roll key, then replace the line). Everything it blocked is proven —
see the evening summary.

**7. Netlify token — DONE 3 Nov.** In `.env.local`; the deploy is in the
Deploys table. The old steps, for the record:
The site is
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
Academy. **Fixed everywhere on 4 Nov:** the club settings page first, then
the seven other pages that still took the first organisation by name (the
Admin hub, Admin → Payments, Members, Invites, the roster importer, Scan,
the family's Payments) and the two client screens that fell back to it
(Teams, Directory) — all follow the organisation the browser is showing,
proven by `test-org-follows` (21). One question stays: may I delete
`nrifa-1`? It is harmless now, just clutter in your switcher.

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

### 5. Xcode and CocoaPods first (free), then the Apple Developer account — blocks M7, and M7 blocks contacts

The Capacitor shell has never been compiled, and on 2 Nov I checked why it
cannot be here: this Mac has only the Command Line Tools — no Xcode, no
CocoaPods, no JDK. A **simulator build needs no paid account**, so the free
tools alone would let me generate the iOS project, build it and run it in a
simulator in one session:

1. Install Xcode from the Mac App Store (~7 GB), open it once, then
   `sudo xcode-select -s /Applications/Xcode.app`.
2. `brew install cocoapods`.
3. Tell me. I will run `npx cap add ios`, sync, build for the simulator and
   write up what works.

The Apple Developer Program (US$99/year — flagged rather than assumed, per
the spending rule) is needed only after that, for a real phone, APNs and
TestFlight. Both on-device contact matching (C-10) and reliable iPhone push
wait on the build, so this gates more than it looks like it does.
`native/README.md` has the review notes and deep-link steps ready.

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
