@AGENTS.md

# Squadroom

Multi-tenant group chat, fixtures and RSVPs for youth football academies.
NRIFA (Sydney) is the first customer; the product is multi-academy from day
one and is meant to reach hundreds of academies.

## Rules

- **Squadroom is separate from Fixturefeed. Never use Fixturefeed's code,
  Dribl's API/match centre, Dribl ids or any Dribl data in Squadroom. All
  fixtures, teams, players and results come from leagues, academies and
  coaches entering them in Squadroom, or from a league exporting its own data
  to us. Squadroom must be able to run a whole competition (starting with the
  SPL) without Dribl.**
  - How this squares with the importer, which must not be read as a loophole:
    the importer only ever reads **a file a club or league exports from its
    own account and hands to us**. Squadroom never reaches into Dribl — no
    API, no scraping the public Match Centre, no Fixturefeed code. A league
    that switches to us stops producing those files and nothing downstream
    cares.
  - `events.external_ref` and `teams.external_ref` hold **whatever a league
    calls a game or a squad in the file it gave us**, which is what makes a
    re-import update a moved game instead of duplicating a season. They are
    not a dependency on Dribl: a league running in Squadroom populates them
    itself, and a league that never exports anything leaves them null.
  - **DECIDED 29 Oct 2026, by Joey, and not to be relitigated:** the importer
    and the `external_ref` columns **stay**. Importing a file that a club or
    league exports **from its own account** and gives us is allowed.
    **Never fetch anything from Dribl directly** — no API, no Match Centre,
    no scraping, no Fixturefeed code. The line is the handover: a human
    exports their own data and hands it over. We never reach across.

- **Pricing, Joey's rule (30 Oct 2026, refined 3 Nov 2026): core Squadroom
  is paid by clubs, academies and leagues, and is never charged to
  parents.** Optional paid extras — Analysis Pro is the first — can be
  bought by any individual account (a coach, a parent), on their own
  behalf, through the website first (Stripe); pricing is Joey's. Do not
  build Squadroom billing or plans for the core yet (`SQUADI_INTEL.md` §6E
  is open); B-06 stays unbuilt until Joey prices it. A parent's payment to
  their club goes to the club in full; there is no code path that could
  add our fee to it (see 0065, below). An extra's purchase is a separate
  product on a separate code path, never a line on a club's invoice to a
  family.

- **PlayFootball and Circular 26-02 (FA, 1 Oct 2026).** For any affiliated
  club, program or competition the order is **PlayFootball first, Squadroom
  second**: a program can require official registration, and Squadroom
  blocks approval until a human at the club has confirmed it. We capture
  the FFA number and FIFA ID, import the club's own PlayFootball **export**
  to tick statuses off, and remind the club to disclose every fee in
  PlayFootball. **Never log in to PlayFootball and never scrape it** — the
  only thing that crosses is a file a club admin downloads from their own
  account. R-18 is the build; R-14 is the status.

- **Design rules** (from what users say they hate about Squadi and Dribl,
  `SQUADI_INTEL.md` §6D; check each on every new screen):
  - Everything works on the phone. No "do it on the website". No screen is
    desktop-only, and nothing is hidden behind a hover.
  - One flow for families. A profile is clearly the **child's**, not the
    parent's; a parent edits their own child's photo and details.
  - A notification opens the exact item, never a home screen.
  - Ladder audit: tap a ladder row to see how every point was earned,
    adjustments included, with reasons.
  - A sanity check before publishing a generated draw: empty slots,
    travel, same-club clashes.
  - Ask for selected photos only, never "all photos".
  - Support: fast human replies, a match-day hotline, staged rollouts
    (pilot one division first), and never blaming an organiser publicly.
  - Transparent, published pricing. A family sees one clear total, never
    stacked fees.

- **Deployment, Joey's rule (replaced 2 Nov 2026; the weekly Sunday slot
  is gone).** Production deploys **only when a major milestone is complete
  and the full tests pass**, and **never on a Saturday or Sunday** (match
  days). **Exception: an urgent security fix deploys immediately.** Every
  deploy is noted in `docs/NIGHT_LOG.md` (Deploys table) with the date and
  what it includes; a deploy that could not happen is logged there too with
  why. If `NETLIFY_AUTH_TOKEN` is missing from `.env.local`, it goes under
  NEEDS JOEY and the milestone's deploy waits.
  - Pushing to GitHub is not deploying. The remote is a backup; production
    moves only by the rule above.

- **Session logging (Joey, 2 Nov 2026).** Whenever a session stops, record
  in `docs/NIGHT_LOG.md` **when it stopped and why**: finished, waiting on
  Joey, an error, or the usage limit. An overnight run also leaves a morning
  summary at the top of the file.

## Product direction (Joey, 2 Nov 2026)

1. **Customers: academies, clubs AND leagues.** Academies and clubs are the
   main business. Leagues (starting with the SPL) are the shop window that
   brings academies in. Parents never pay.
2. **Navigation is easy for four roles:** parent, coach, owner / club admin,
   league organiser.
   - **The same 5 tabs for everyone.** Each role's Home shows only its
     priorities:
     - **parent:** the kids' next games · "needs you" (RSVP / payment / form)
       · the latest announcement
     - **coach:** the next event · non-responders · unread chat
     - **owner:** registrations waiting · who owes · today across all teams
     - **league organiser:** this weekend · missing team sheets · unfilled
       referees · disputes
   - **Hide, don't grey out,** what a role doesn't need.
   - **One-tap switch** for people with several roles.
   - **Each role's top 3 jobs are reachable in 2 taps or fewer** from Home,
     and an automated test per role proves it (`scripts/test-role-nav.mjs`):
     - **parent:** RSVP · team chat · pay
     - **coach:** post · availability / squad · attendance
     - **owner:** approve registrations · chase payments · message everyone
     - **league organiser:** change the draw / call off a day · appoint
       referees · resolve results
   - Every role gets a 375px light/dark walkthrough when its Home changes.
3. **Deploys:** see the Deployment rule above — milestone complete + full
   tests green, never Sat/Sun, security fixes at once, every deploy logged.
4. **Session logging:** see the Session logging rule above.

## Decisions already made — do not relitigate

- **Client-first architecture.** All authorisation lives in the database, not
  in server components or route handlers. This is what keeps a Capacitor
  native build viable later: the same API, subject to the same rules.
  - **Discipline that makes the Capacitor build cheap: pages stay THIN.** A
    `page.tsx` fetches and passes props; every piece of UI lives in a
    client component that takes those props. Capacitor cannot run server
    components, so anything rendered directly inside one has to be rewritten
    for native. Keep that surface to a handful of thin wrappers.
  - The service-role routes can NEVER ship inside a Capacitor bundle - that
    is a file on someone's phone, and the key bypasses every policy. There
    will always be a server: Netlify now, or Supabase Edge Functions later.
- **Shared schema, isolated by RLS.** Never schema-per-tenant. Every table
  carries `academy_id`; child tables use composite foreign keys against
  `(id, academy_id)` so a cross-tenant row cannot be written.
- **RLS helpers live in `app_private`**, which PostgREST does not expose.
  Never define one in `public` — that publishes it as a REST endpoint.
  Policies call them as `(select fn(...))` for per-statement evaluation.
- **Region is ap-southeast-2 (Sydney), permanently.** Australian children's
  data. A Supabase project's region cannot be changed after creation.
- **One deployment serves every academy.** Branding is data
  (`academies.primary_colour`, `logo_url`), never a per-tenant build.
- **Squadroom does academy registration and runs its own competitions. Only
  OFFICIAL registration is Dribl's.** A player must be registered in
  PlayFootball to be eligible, and that is governance, not software — the
  failure mode is a child being ineligible on a Saturday. So Squadroom never
  does official registration; R-14 tracks its status and no more. Everything
  else is ours: enrolment, details, consents, fees, squads, draws, results,
  discipline. And **Squadroom must be able to run a whole competition without
  Dribl** (M9), starting with the SPL.
  - Replaced the old wording on 29 Oct 2026. It used to read "Dribl is the
    source of truth for registration and fixtures; Squadroom is the
    communication layer", which is no longer true of either half and was
    leading a bullet whose own sub-points contradicted it.
  - What still stands from it, unchanged: don't replace Dribl where Football
    NSW mandates it, don't ask a coach to type a draw twice, build an
    importer rather than an integration, and never scrape the Match Centre.
  - Dribl has no public API. **Corrected 29 Oct 2026:** the old note here said
    "no ICS feed (checked Aug 2026; calendar sync moved behind a paid tier)",
    which is out of date — **Dribl shipped Google/Outlook calendar sync on 19
    Oct 2026** (v4.1.7, matches only). It changes nothing about our approach,
    because sync out of Dribl into a parent's calendar is not a way to get
    data into Squadroom, and we do not fetch from Dribl anyway. Our own feed
    still wins on merit: it carries training, socials and tournaments, per
    family, not just matches.
  - The only way data comes in is unchanged: the club-admin export, which a
    human runs on their own account — Events → filter → Export → Events →
    download a spreadsheet.
  - So: build an importer, not an integration. Do NOT scrape the public Match
    Centre - fragile and almost certainly against their terms.
  - **Built at `/admin/import`, with no fixed column mapping at all.** It
    reads whatever headers are in the file, SUGGESTS a mapping, and a human
    confirms it before a row is written. That honours "never guess the
    mapping" without needing a sample file, and survives Dribl renaming a
    column — or a league secretary's own spreadsheet.
  - Suggestion scoring is GLOBAL, not field-by-field in list order. The first
    version walked fields in order, so `title` (matching "match") claimed a
    column called "Match Id" on a prefix before `external_ref` could claim it
    on an exact match — and that column is what stops a re-import duplicating
    a season.
  - `events.external_ref` is unique per academy and makes re-import safe: a
    moved game moves, it does not appear twice. With no id column in the file
    it falls back to team + kick-off, because one team cannot play twice at
    the same moment.
  - Dates are read DAY first. Australian d/m/y and American m/d/y are
    indistinguishable for the first twelve days of every month, so the
    preview shows the reading and a human can catch it.
  - Never `toISOString()` a spreadsheet date. A local midnight in Sydney
    becomes the previous day in UTC, which moves every Saturday game to
    Friday.
  - **The other clubs' games in a file are the division table, never
    events** (F-05, 0228). A row where neither side is ours is kept in
    `imported_games` for `division_table`, and is not imported into any
    calendar. The division is the connected set of teams around our
    squad's league name (`teams.external_ref`), not a guess from names.
  - Do NOT try to replace Dribl for association competition. Football NSW
    mandates registration there for eligibility, insurance and age
    verification - that is governance, not software, and the failure mode is
    a child being ineligible on a Saturday.
- **Self-run competitions are entirely ours, and that is the second product.**
  Tournaments, gala days, trials and camps are in nobody's mandate. NRIFA
  already runs a full one in Excel: 21 teams, 3 groups, 63 games across 4
  fields, ladders on 3/1/0 with GD then GF, cross-group finals seeding.
  Tournament Mode replaces that spreadsheet.
  - The 21 team names are other academies. Running a tournament in Squadroom
    puts ~20 academies' coaches and parents in the product in one day, which
    is the acquisition channel - visiting coaches get real access to their
    own team's fixtures and results.
  - Schema gap to close before there is data: `competition_teams` points at
    OUR teams, but a tournament is mostly teams that are not ours. Entries
    need to accept an external named club too.
  - The hard parts are not the UI: round-robin generation constrained by
    fields and slots, clash avoidance, byes for odd groups, who may enter a
    score, and head-to-head tie-breaks (the spreadsheet punts those to a
    human on the day).
- **NRIFA brand**, taken from the crest SVG, not eyeballed:
  navy `#202842`, mid navy `#3D4A6D`, gold `#EFBD5B`, white.
  Crest lives at `public/brand/nrifa-crest.svg`.
- **A competition SPANS tenants; an academy does not own it.** SPL Season 3
  is run by a league, entered by many clubs, each bringing their own coaches
  and parents. `competitions.organiser_id` is the running organisation;
  `competition_clubs` are the entered organisations; `competition_entries`
  are teams in a division, and `team_id` is NULLABLE so a club that has not
  signed up is just a name on the draw.
  - **The rule that must never be blurred: being in a competition together
    lets you see the DRAW, not each other's PEOPLE.** No policy on members,
    players or the directory mentions competitions, and none ever should.
    Proven by the cross-club isolation test.
  - **One exception, at Joey's word (5 Nov 2026): a competition's Notices**
    (0212–0213). The league speaks to everyone in its competition — the
    entered clubs' owners, admins and coaches, the families of the entered
    teams, its referees — in one read-only channel, to Everyone or to Club
    staff only. What the rule protected is kept, and must stay kept:
    membership is worked out from the competition (`notices_standing`),
    never stored as channel_members rows, so nobody in it can list, mention,
    react to or see "typing" from anybody else; no replies; the league gets
    "Seen by N of M", a count, never names; club-staff notices, their
    pushes and their files are invisible to families by policy. Anything
    new that reads messages as its definer must apply `audience` itself
    (channel_messages had to, test-rls 116). A league never sees another
    club's families' email addresses (0214).
  - `fixtures` belong to the competition, so a moved game moves once for
    everyone. A trigger mirrors each fixture into an ordinary `events` row
    per involved club, so RSVPs, reminders and channel cards work unchanged.
  - `events.competition_id` is the ONE relationship that crosses the tenant
    boundary, and so it is the one plain (non-composite) foreign key in the
    schema. The composite pattern asserts same-tenant, which is false here.
  - Ladders are computed, not stored: 3/1/0, GD then GF. Head-to-head is
    deliberately NOT applied - it needs a mini-league between tied teams, and
    guessing is worse than showing them level for the organiser to rule on,
    which is what the spreadsheet does today.
- **`academies` means ORGANISATION.** Academy, one-team club, school or
  league, separated by `type`. The name was kept because renaming would touch
  every policy, helper and FK for no behavioural gain.
- **A competition is the container above events**, not a parent event.
  `competitions` (SPL Season 3, Spring Gala Day) + `competition_teams`
  (which of our teams is in which division) + `events.competition_id`.
  A container has no kick-off time, no venue and nobody RSVPs to it, so
  making one row serve both meanings would put a nullable starts_at on every
  fixture. The same shape covers a months-long season and a one-day gala.
  - Division names ("U8s Championship", "Premier") belong to the organiser,
    not to us. Free text on purpose - do not build a divisions table.
- **Safeguarding defaults are the restrictive ones.** Parent-to-parent DMs
  off, parent phone numbers staff-only. Both are per-academy settings.
- **Every account has an email, and a child's login needs a parent's yes**
  (Joey, 5 Nov 2026; 0214–0215).
  - The email lives in `account_emails`, beside the sign-in address, never in
    it: a phone-joined parent signs in through a placeholder made from their
    number, the claim routes find them by it, and replacing it mints an empty
    account. Asked when joining (beside the mobile), at registration, and once
    on the next open of an account without one (`EmailGate`: no skipping).
    Any address; never matched to PlayFootball. Confirmed by a one-tap link.
    Readable by its person and their own organisation's owners and admins
    (`member_emails`), nobody else; a league never sees another club's.
  - "Send me news and offers from Squadroom" is separate, unticked, never
    required, stored with its time, every change kept (`news_consents`).
    Club and league notices never need it.
  - Children: under 13, never an account — the parent manages them. 13 and
    over: their own email AND a guardian's approval (`player_logins`:
    invited → waiting → approved), and no other route; the database refuses a
    player membership, link or squad place without it. This replaces S-06's
    "nobody under 18 has an account" (0078). 0076 still brings guardians into
    any private chat with a child.
- **Parents never see a signup screen, and onboarding sends no SMS.**
  The coach pastes the team link or QR into the group parents already use.
  A parent taps it, enters name and phone, and lands in a PENDING state.
  The coach approves, and the session binds to that device permanently.
  - Coach approval REPLACES the OTP as the identity gate, and is stronger
    for this product: an OTP proves someone holds a phone number, approval
    proves they belong in a channel full of children's names. The coach
    already knows every family.
  - New-device recovery is the same flow: tap, re-approve. Also free.
  - Consequence, accepted deliberately: without OTP a phone number is a
    contact detail, not a verified credential. Fine while a coach vouches
    for every member. Revisit before opening self-serve signup.
  - Never let a bearer token post messages before approval binds it to an
    identity. In a product about children, "who sent this" must have a real
    answer.
  - Token validation and session minting are server-side with the service
    role. This is the one sanctioned exception to client-first, and needs
    its own tests - it is the most likely place in the system to leak.
- **Contacts are picked, never synced.** There is no bulk address-book
  upload and there must never be one. A coach's phone holds people with no
  relationship to the academy; putting them on our servers is a Privacy Act
  problem and exactly the kind of thing that ends a product built around
  other people's children. The OS picker returns only what the coach chose,
  and nothing is sent until they confirm on a review screen.
  - `lib/adapters/contacts.ts` — web uses the Contact Picker API, which is
    **Chrome-on-Android only**. Safari has no equivalent. `isSupported()`
    must be checked before the button is rendered; iPhone falls back to
    pasting numbers until the Capacitor plugin lands in phase 8.
  - `normalisePhone` returns '' rather than guessing. A half-parsed number
    silently invites a stranger into a channel full of children.
- **SMS is reserved for one case: a match cancelled or moved inside 24
  hours.** Everything routine - announcements, new messages, RSVP nudges,
  24h reminders - is in-app and web push. Recurring SMS fallback was costed
  at roughly $4k/week at 300 academies and cut for that reason.
  - Because of this, the iOS web-push hole matters more: notifications only
    work once a parent installs the PWA. That is an argument for bringing
    the Capacitor phase forward if the NRIFA pilot shows poor reach.
- **Push is sent by a Netlify function, woken by the database.** The sending
  needs the service-role key, which can never ship inside a Capacitor bundle,
  so it stays server-side permanently. What changed is who starts it.
  - `netlify/functions/push-now.mts` is called by a pg_net trigger the moment
    something is enqueued, authorised by `PUSH_WAKE_SECRET`. A parent gets a
    message in about a second.
  - `netlify/functions/send-push.mts` runs every five minutes as a SAFETY
    NET, for the times the wake-up never lands. Both share `lib/push/drain.ts`
    — Netlify will not let a scheduled function be invoked over HTTP, which
    is why they cannot be one file.
  - It used to be one function on `* * * * *`: 43,200 invocations a month,
    almost all finding an empty queue, and it had eaten roughly half the
    Netlify allowance before the product had a single real user. Measure
    what a cron costs before choosing its interval.
  - The trigger is statement-level and debounced to one call per 15s, so an
    announcement to 300 parents wakes it once. It skips notifications
    scheduled for later, or a nightly reminder sweep would wake it for
    nothing.
  - After changing the site URL or rotating the secret, run
    `node scripts/configure-push-wake.mjs`. The database stores the endpoint
    in `app_private.config`, which nothing but the service role can reach.
  - Notifications are ENQUEUED by a database trigger, never by the client. A
    client that forgets - or a native app, or a script - would silently stop
    notifying anyone.
  - A 404 or 410 from a push endpoint means the browser discarded the
    subscription. Retire it rather than retrying, or the queue silts up.
  - Quiet hours DELAY a message rather than dropping it. They do not apply to
    announcements or event reminders - those are what the exception is for.
- **Calling a game off notifies everyone who can see it, and cannot be muted.**
  `cancelled_at` used to be set with nothing sent at all — the fixture went
  grey and a family who did not open the app drove to the ground. The trigger
  is `events_notify_change`.
  - It goes to the whole team, NOT to those who RSVP'd. Reminders follow the
    register, which is right for "your kid has a game tomorrow"; the family
    least likely to have answered is the one most likely to turn up anyway.
  - Quiet hours do not apply, and there is deliberately **no setting to turn
    it off**. Everything else in the product can be muted because everything
    else is someone else's business. An opt-out here would only ever be
    discovered on a wet Saturday.
  - Inside 24 hours it sets `escalate_sms`, which is the one case Twilio was
    kept for. The flag is set by the trigger and never by a client — a text
    costs money and arrives whether or not anyone wanted it.
  - The reason is part of the message. "Wet weather" and "forfeit" are
    different things to somebody already loading the car.
- **Never assert on a global count of `notification_queue`.** pg_cron queues
  reminders for other events every five minutes, so a test that counts every
  `event_reminder` row is measuring the whole database. `test-reminders`
  passed for months that way and then failed the day another test created a
  fixture twelve hours out. Scope to `payload->event_id`.
- **Twilio is not needed to build or pilot.** Add it for late-change alerts,
  or when onboarding an academy whose owner does not know every family.
- **Screenshots are read by a model; nothing else about them is.** `/scan`
  sends a fixture screenshot to Anthropic and gets back local date and clock
  time strings exactly as printed. It is never asked for a UTC timestamp - it
  would produce one, confidently, an hour out across a daylight-saving
  boundary. `create_scanned_events` applies the academy's timezone in
  Postgres, resolves a missing year, and fixes a finish time that crosses
  midnight.
  - **`events.private_to` is a fourth visibility rule** on a table that had
    three. A parent's scan is theirs alone. It must be honoured in all four
    readers: the `events_select` policy, `app_private.can_read_event`,
    `my_upcoming_events`, and `calendar_feed_events`. Miss one and a family's
    schedule appears in someone else's list.
  - **A FOR ALL policy is also a SELECT policy.** `events_write` was FOR ALL,
    and permissive policies OR together, so its "staff may touch any event"
    clause silently beat the private_to filter and a coach read every private
    event. Split into events_insert / events_update / events_delete. Never
    write FOR ALL on a table whose read rule is narrower than its write rule.
  - Asking to share with a team is a request, not a grant: the function
    re-checks coaching rights and quietly makes it private otherwise.
  - Images live in a private `scans` bucket for seven days, then
    `netlify/functions/purge-scans.mts` deletes the file and blanks the path.
    The scan row and its `raw` response outlive the picture, because when a
    parent says the time came out wrong that is the only way to tell whether
    the model misread it or our own date handling did.
  - The consent line is on the upload screen, above the button. Buried
    honesty is not honesty.
  - Needs `ANTHROPIC_API_KEY`. Without it the page says the feature is off
    rather than failing halfway through an upload.
  - **This is the first feature where a user can spend the owner's money.**
    Ten images per upload, twenty per person per rolling 24 hours, and a
    $20/month hard cap at Anthropic. The per-person limit is a trigger on
    `event_scans`, not a check in the route — the client holds a real
    session and can insert directly, so a limit in a route handler is one a
    determined person walks around.
  - The hard cap is the budget protection; the per-person cap exists so the
    hard cap is never what stops us. When a provider cap trips it fails for
    everyone at once, including the coach posting Saturday's draw.
  - About 2 US cents a screenshot (~3,000 image tokens at 2200px, plus
    instructions and the reply). Downsizing further would save money and
    cost accuracy, and a fixture read an hour wrong is worse than none.
- **Payments use Stripe Connect Express with DIRECT charges** — the charge is
  created ON the academy's connected account, so money lands in their balance,
  their name is on the parent's statement, and Squadroom is never in the flow
  of funds. Destination charges would route it through us and make us liable
  for every dispute about a kit order in a suburb we have never been to.
  - **The webhook is the only thing that may mark a payment paid.** There is
    no insert or update policy on `payments` for anyone, including owners. A
    browser returning to `/payments?paid=1` is a claim; Stripe's signed event
    is a fact. Proven by test: neither a parent nor the owner can write a row.
  - Signature verification on the raw body is the whole security model of the
    webhook. Parsing first and re-serialising changes the bytes and it will
    never verify.
  - **The amount is read from the database, never the request body.** Taking
    a price from the client is how somebody pays 50c for a $50 gala day.
  - `checkout.session.completed` does NOT mean paid — check `payment_status`.
    BECS direct debit completes the session days before the money arrives.
  - **A bank debit clearing is `processing`** (B-08, 0226): completed with
    the payment unpaid sets it, `async_payment_succeeded` pays it,
    `async_payment_failed` fails it, an expiry cannot undo it. It is owed by
    nobody (Home, who-owes, reminders, the quote, the checkout, vouchers,
    withdrawals all treat it as settled) and paid by nobody (the family sees
    "Clearing", the club "bank payment clearing"). Anything new that reads
    `payments.status` treats it as neither — `status = 'paid'` alone is a
    bug. Checkout offers BECS only when `academy_billing.becs_enabled`,
    which is read back from Stripe's capability, never set by hand.
  - **A promise is not a payment** (B-08, 0227). "Pay later by a day" is a
    `payment_promises` row the family makes through `promise_to_pay`; it
    changes the chasing (the 0193 sweep holds until the day, nudges the day
    before, then resumes) and what the club sees beside the name — never
    what is owed. Nothing reads it as money.
  - Amounts are integer cents, never a float. Dollars typed in the UI are
    `Math.round(x * 100)`: 49.9 * 100 is 4989.999999999999.
  - **Squadroom charges CLUBS, never parents.** Revenue is `academies.plan`;
    a parent's payment goes to their club and we take nothing from it. There
    is deliberately no application-fee column and no code path that could add
    one — 0065 removed `platform_fee_bps` rather than leaving it at zero,
    because a dormant skimming mechanism is one somebody switches on later in
    a hurry, and the first anyone hears of it is a parent seeing $45.90 where
    the coach wrote $45. Changing this must be a migration and a conversation.
  - Platform billing and academy collections never share a code path — a bug
    that crosses them charges the wrong party.
  - **Proven on Stripe test mode, 3 Nov 2026** (`scripts/test-stripe-e2e.mjs`,
    run by hand with `STRIPE_E2E=1` and `stripe listen` up): a fee, a
    family of two in one checkout with the sibling ladder, a voucher and
    instalments, a refund, a league entry fee, a referee's account. What
    that taught:
    - A club's account is an **Accounts v2 Express** account (`dashboard:
      'express'`, `fees_collector: 'application_express'`, `losses_collector:
      'application'`): Stripe no longer lets a new platform make the old
      `type: 'express'`. **Stripe owns requirement collection for Express:**
      once the onboarding link exists the API refuses its identity, people
      and terms, and the hosted test-mode pages sit behind a captcha no
      script passes. Only a person finishes one. The suite proves the route,
      then moves money on a test-mode account the API can activate
      (`scripts/_stripe-test-accounts.mjs`), and closes what it made.
    - Accounts v2 raise no `account.updated`; status is read back on demand
      (`lib/stripe/billing.ts`) and on `capability.updated`.
    - **Checkout is cards only.** Stripe's AU defaults add Klarna, Zip and
      Link to a junior club's fee page; Checkout also pre-ticks "Save with
      Link", which demands a phone number. One line per checkout route.
    - **Refunds arrive as `refund.created/updated`.** The Charge no longer
      lists its refunds on current API versions, so matching through
      `charge.refunds` silently matched nothing. `charge.refunded` is kept
      only for a charge refunded in full from the club's own dashboard.
    - **Stripe will not transfer between two connected accounts** ("Cannot
      create transfers between connected accounts"), so a league cannot pay
      a referee's Stripe account from its own. **Referee payouts are PARKED
      (Joey, 3 Nov 2026): tracking only** — who refereed, the fee owed, the
      treasurer marks the run paid. No Stripe payouts, no bank files; the
      routes and the referee's "Connect Stripe" were removed. Do not
      rebuild them without Joey.
  - `profiles.phone` is a DOMAIN, not text. A set-returning function
    declaring `text` fails with "structure of query does not match function
    result type", which names neither the column nor the type.

## Phases

0. Foundations — schema, RLS, seed, isolation tests **(done)**
1. Auth + onboarding: phone OTP, invite chain, `/join/<token>`
2. Admin console: teams, members, bulk invite
3. Chat: channels, realtime, hosts, posting modes, reactions
4. Events, RSVPs, event cards in chat, reminders
5. Polls (simple + availability), directory
6. PWA + push + super-admin console **(push done)**
7. Tournament Mode — self-run competitions, ladders, run sheets, visiting clubs
8. Payments — Stripe Connect Express **(built; needs Stripe keys)**
9. Capacitor native wrap — shell + adapters + APNs/FCM done; the iOS build
   itself needs Xcode and an Apple Developer account. See `native/README.md`

- **The native shell loads the deployed site, it does not bundle it.** The
  product is server components reading cookies and cannot be statically
  exported without rewriting every page, and the point of the phase is
  notifications on iPhone, not a re-architecture. `capacitor.config.ts` reads
  `CAP_SERVER_URL`.
  - What makes it an app rather than a bookmark — and the answer if Apple
    asks under guideline 4.2 — is APNs push, the system contact picker and
    the camera. If review pushes back, the fallback is to bundle the shell
    and move pages to client-side fetching, which "pages stay THIN" already
    prepares for.
- **iOS push talks to APNs directly. No Firebase.** Google owns Android push
  so FCM is unavoidable there, but adding a Google project to solve an Apple
  problem would be paying twice — an iPhone-only pilot needs no Google
  account anywhere. `lib/push/apns.ts`, `lib/push/fcm.ts`.
  - APNs is HTTP/2 only (`fetch` will not do) and the ES256 JWT signature
    must be raw r||s, not DER: `dsaEncoding: 'ieee-p1363'`. The symptom
    otherwise is a 403 `InvalidProviderToken` that suggests nothing.
  - Sandbox and production have different device tokens as well as different
    hosts. A debug build from Xcode is sandbox; TestFlight is production.
  - A transport with no credentials configured is SKIPPED, never failed.
    Marking it failed would retire a parent's subscription for the sin of
    being on the other platform.

## Working notes

- Migrations are SQL files in `supabase/migrations`, never dashboard changes.
- Run `scripts/test-rls.sql` after every migration. It is idempotent.
- **A stranger can call exactly five functions** (0185): the ones in
  `app_private.anon_callable`, each with a reason. Everything else in
  `public` has no anon grant, and test-rls 92 fails the day one appears.
  A new public-facing function is added to that table in the same
  migration, or it is not public. `create or replace` keeps a function's
  old ACL — revoke explicitly. test-rls 93 also fails if a security-definer
  function a member can call never names its caller.
- **Tests sign in through `scripts/_auth.mjs`**, which caches sessions in
  `.cache/` across suites so a full `npm run test:all` does not trip the
  auth rate limit. The dev project's limits were raised to 1000 per five
  minutes by `scripts/configure-auth-limits.mjs` (dev only; production
  keeps Supabase's defaults). `scripts/_sql.mjs` runs a read-only query
  against the catalog, which is how the sweep asked what is TRUE rather
  than what a migration said.
- **Two-step sign-in (S-07).** The app's half: enrol in Settings, a gate
  in the root layout (`components/two-step-gate.tsx`) that shows nothing
  until an AAL1 session with a verified factor types its six digits, a nag
  card for staff without it. The database's half is 0224 (written 8 Nov,
  unapplied until the token): someone who has turned it on gets no staff,
  coaching, league or platform powers on a password alone — the rule is in
  `app_private.two_step_ok()`, called by `academy_role_of`, `is_team_coach`,
  `league_roles_of` and `is_platform_admin`, so any new role check that
  reads `academy_members.role` itself bypasses it: go through the helpers.
  **Compulsory where the organisation requires it** (0231, Joey 9 Nov
  2026): `academies.two_step_required` — true for every organisation made
  from then, false for the ones before until an owner turns it on (one
  way). There, owners, admins and league staff have their powers only at
  AAL2 (`two_step_ok_for`), and `two-step-wall.tsx` walks the unenrolled
  through enrolling before anything else. Coaches keep their own choice;
  families are untouched. A test that signs a NEW owner up must enrol them
  (`enrolTwoStep` in `_auth.mjs`); one that makes a club by hand marks it
  `two_step_required: false`; Joey's real account is never enrolled by a
  test. TOTP codes are accepted once per thirty-second period.
  The role helpers are PL/pgSQL on purpose (SQL ones are re-planned on
  every call; 0224 measured 44 µs vs 6 µs a staff check).
- **Every control can be read aloud and hit with a thumb** (X-10, 4 Nov
  2026): an icon button carries `aria-label`, a field has a `<label>` or
  `aria-label` (a placeholder is not a label), an image has `alt`, a
  text-styled button gets the `.tap` class (32px of hit area in place), and
  the tab bar marks the current tab. `scripts/test-a11y.mjs` walks the
  main screens as four people and fails on any of these.
- **Text follows the phone's text size** (X-10 Dynamic Type, 4 Nov 2026).
  Every text size is rem — Tailwind's sizes, or `text-[0.6875rem]`, never
  `text-[11px]` — and a box that holds text is sized in rem too. Nothing
  sets a font size on `html` or `:root`: Chrome on Android (the
  `text-scale` meta tag in the root layout) scales the root itself, and
  Chrome's rule is that any root size, even a clamp, undoes it. On an
  iPhone `lib/text-size.ts` sets the root from Dynamic Type (16–32px).
  A row of equal buttons gets `flex-wrap` on the row and `min-w-fit` on
  the buttons so it breaks onto two lines instead of off the screen.
  `scripts/test-text-size.mjs` fails on a px text size; `test-a11y` fails
  on anything that no longer fits at 125% or 200%.
- **Squadroom's brand (Joey, 4 Nov 2026; `brand/README.md`): white on
  near-black `#101012`, monochrome greys, colour only where it means
  something** — orange `--accent` = needs you, green `--yes` = going, red
  `--no` = out or called off. No navy, no gold, no yellow ("maybe" is
  grey). Two tokens, two jobs: `--bar` is the brand's surface (app bar,
  sign-in, join, the public heroes) and is `#101012` in light AND dark;
  `--brand` is the primary action and FLIPS (near-black on a light page,
  white on a dark one). Text on any painted surface takes that surface's
  ink — `text-brand-ink`, `--yes-ink`, `--no-ink`, `--maybe-ink`,
  `--accent-ink`, `--bar-ink` — never `text-white` or `#fff`, which is
  invisible on a white button in dark mode. A colour Squadroom did not pick
  (a club's) gets its text from `inkOn()` in `lib/brand/colour.ts`. Icons
  come from `brand/` via `scripts/brand-icons.mjs` (favicon, apple-icon,
  PWA 192/512 + maskable, the notification badge, `public/brand/*.svg`);
  the logo is on sign-in and `/for-clubs`, the icon (the `-small` variant
  at 48px and under) on `/join`. `scripts/test-brand.mjs` measures every
  token pair for AA in both themes, compares the two dark blocks, and fails
  on white text on a flipping surface, the old SQ tile, gold or navy.
- **A game's time is the venue's, everywhere** (Joey, 4 Nov 2026). Format
  a kick-off, an arrival or a fixture's date through `lib/time.ts`
  (`kickOff`, `gameDay`, `gameDayShort`, `countdown`, or `timeZone:
  DEFAULT_TZ` in an Intl call) — never a bare `toLocaleTimeString()`, which
  uses the clock of whatever runs it: Netlify's server is UTC, so the first
  frame said 3:20 am for a 2:20 pm kick-off, and a phone in another
  timezone moved every game. The venue's timezone is the club's
  (`academies.timezone`); a venue in another state would need its own
  column. Dates that are not game times (a birthday, a due date, when a
  message was sent) stay the reader's. `scripts/test-game-page.mjs` fails
  on a game-time format without a timezone in the 20 screens that show one.
- **The game page is a match preview** (X-05, Joey 4 Nov 2026): a hero
  (`app/calendar/[eventId]/game-hero.tsx` — both crests, the countdown, the
  kick-off, the live score, the result, on `--bar`) and tabs Preview |
  Match sheet | Ladder, the Ladder only in a competition. Preview starts
  with availability. New things for a game go in the tab where a parent
  would look for them, not at the bottom of one long page.
- **A club's colours are a layer over the brand, never paint by hand**
  (G-10, Joey 4 Nov 2026). `lib/brand/colour.ts` turns a club's main and
  second colour into the same tokens (`--bar`, `--brand`, `--brand-text`,
  `--highlight`, each with its ink) for light and dark — black or white
  text by contrast, the colour deepened or lightened only where it would
  not read, the header never adjusted — and `clubThemeCss()` writes them as
  a stylesheet. In the app it is switched on by `<html data-club>`, which
  `lib/brand/theme-script.ts` (before the first frame) and
  `components/theme-controller.tsx` set ONLY where `usesClubTheme()` in
  `lib/routes.ts` says so and the person's Appearance is Club colours.
  Sign-in, the join flow, `/for-clubs`, status, privacy and `/platform` are
  Squadroom's and stay black and white; a club's public pages (`/{slug}`,
  register, `/c/{slug}`) scope THAT club's colours with `[data-club-scope]`
  and are never the reader's club. So: never `style={{ background:
  club.primary_colour }}` — use the tokens, and a new Squadroom-only route
  goes in `lib/routes.ts`. Orange, green and red are not in the layer and
  never will be. Appearance (Club colours / Black & white × Match my phone
  / Light / Dark) is `lib/brand/appearance.ts`: the phone's copy paints the
  first frame, the profile's (0209) follows the person; sign-out clears
  both. `scripts/test-branding.mjs` covers six club colours incl. yellow and
  white, who may change branding, and all of the above in a browser.
  **The newest choice wins, whichever copy holds it** (9 Nov 2026): a
  choice saved on the phone is marked *pending* until its profile write
  lands, a pending choice is never overridden by the profile's older one,
  and the controller finishes a sync a closed tab left behind.
- **Grants, and development's double effect** (9 Nov 2026, full run #21).
  A new `public` wrapper function has no EXECUTE for `authenticated` until a
  migration grants it; `create or replace` keeps an old ACL, a new function
  starts with none, and a page that reads "permission denied" as "no"
  (`can_post_in_channel`, 0229) hides a feature without an error. And an
  effect guarded by a ref against running twice runs its real work in the
  closure React cancels in development: the email gate never showed in
  `next dev`. Guard with the thing you store (the sessionStorage memo), not
  with a ref.
- **A suite leaves the demo exactly as it found it** (5 Nov 2026). The
  dev data IS the demo Joey shows people, and suites that passed their own
  checks had been calling off real games and tonight's trainings, parking
  the next game nine days out, deleting every DM in the club and leaving
  113 "Message deleted" bubbles in the U8 chat. Rules: make your own rows
  (a `TAG` in the title or body) and remove exactly those; when you must
  touch a real row, read every field first and write every field back;
  call off and cancel only on a ground or day nobody real uses; remove
  messages with `scripts/_purge-test-messages.mjs` (a deleted message's
  text lives in `deleted_message_archive`, so matching `messages.body`
  misses it). `npm run test:all` snapshots the demo between suites
  (`scripts/_demo-snapshot.mjs`) and fails a suite that leaves a game,
  club, squad, program, membership, chat or clearance changed, naming the
  row; `DEMO_GUARD=0` turns it off.
- **A tap made at a ground goes through `sendOrQueue`, and never asks the
  server who you are** (X-09, 5 Nov 2026). The register, the three RSVP
  paths and the live score taps write through `lib/offline/use-outbox.ts`.
  The first browser run with the signal cut found NOTHING was being kept:
  the outbox, and each RSVP screen, called `auth.getUser()`, which asks
  the auth server, so every write with no signal was refused or dropped.
  In any write path that must work offline, the signed-in person comes
  from `signedInHere()` (the phone's session, `lib/offline/owner.ts`) —
  never `getUser()`. A write never overtakes one already waiting; a try
  with no answer costs a write nothing; a send waits 6 s, then keeps it;
  a refused kept write is said by the bar above the tab bar. A screen that
  shows queued writes reads them from the outbox (`useQueued`), not from
  its own state, so two parts of a screen cannot disagree and a reload
  keeps them. A refresh that fails keeps what is on screen. Prove offline
  behaviour in a browser (`scripts/test-no-signal.mjs`:
  `page.setOfflineMode`, and request interception for bars that carry
  nothing) — the pure test of the queue passed the whole time it was
  broken.
- **Every migration must replay from empty, and is tried locally before
  it is committed** (6 Nov 2026). A Supabase branch — and the scale test —
  is built by replaying the migrations folder; a change made on the database
  by hand ('tournament' in event_type) or a migration edited after it ran
  (0121's apostrophe) breaks that replay without breaking dev. So: never
  change the database except through a migration, and before committing
  one, `node scripts/local-db/run.mjs` (all migrations into a local
  Postgres; opt-in `npm i --no-save embedded-postgres@17.11.0-beta.19`).
  To test policies on real data: `run.mjs --until <last applied>`, then
  `node --env-file=.env.local scripts/local-db/copy-dev.mjs` (read-only on
  squadroom-dev), then `run.mjs --keep --from <next> --rls`. Locally the
  migration user owns the extensions, which Supabase does not — the runner
  restores their EXECUTE after each migration; keep that in mind before
  trusting a grant failure seen only locally.
- **A server page never picks the organisation.** "The first academy by
  name" was wrong for everyone in more than one organisation (a league
  secretary whose child plays; Joey) and was found on seven pages on 4 Nov
  2026. The organisation the browser is showing lives in `lib/org.ts`; a
  screen that needs it before fetching uses `lib/use-current-org.ts` from a
  client loader, and the `page.tsx` stays a sign-in gate (the thin-page
  rule). `scripts/test-org-follows.mjs` opens nine pages with a throwaway
  organisation that sorts first and fails if any of them shows it.
- **The four-role Home** is `home_jobs` (0186) + `app/home-jobs.tsx`;
  `scripts/test-role-nav.mjs` proves the two-tap rule in a real browser.
  A new job for a role is a change to `home_jobs` and a row in that test.
  **Simplicity rules (Joey, 4 Nov 2026):** a parent's Home is at most a
  screen and a half at 375px and has ONE list (their three jobs are rows in
  Needs you, never a strip as well); one orange card at a time; no Channels
  list on Home (the Chat tab); the next two fixtures for a parent, three
  for a coach; announcements older than 14 days are not shown; "to answer"
  is one number everywhere — games and sessions in the next three weeks a
  child has not been answered for; plain words ("17 not answered", never
  "quiet"); the home editor is a button that says Edit, not ☰. A coach who
  is not staff sees on the Admin hub only what the database lets them do
  (`scripts/test-coach-scope.mjs`).
- **A game's photos come down at a family's word** (M5, 0223). Only the
  squad's coach adds them, after being shown who must not be photographed
  (0128 — we never claim to have looked at a picture); only the squad sees
  them, never the public match centre or a share card. Anyone in the squad
  can take one down AT ONCE, without a reason, and only a coach puts it
  back: a family should never have to argue for a picture of their child to
  come down. The bucket's read rule is the row's (`may_see_match_photo`),
  so "hidden" holds for the file too.
- **An open offer holds its place** (R-20, 0221). A place offered after a
  trial, or to a returning player at rollover, is counted against everyone
  else until it is answered or lapses — but never against another offer
  (first to answer, first in). Free places are counted in one place,
  `app_private.program_spots_left` / `places_held_by_offers`, and the 0083
  guard uses the same; a new screen or route that counts registrations by
  itself will sell a returning child's place to a newcomer. An offered
  place bends the program's birth years and dates (the club placed the
  child), never gender, and PlayFootball-first still holds (accepted as
  pending). A returning family's "no" takes the child off the squad.
- **RLS costs are per row SCANNED, not per row returned.** Measured on
  60,000 messages: filtered by channel it is an index scan at ~1ms; an
  unfiltered `select from messages` is a seq scan at ~836ms, because the
  policy function runs 60,000 times (`Rows Removed by Filter: 56483`).
  - The `(select fn(...))` wrapping only caches when the ARGUMENT is
    constant. `is_channel_member(channel_id)` varies per row, so it cannot
    be hoisted. That is why every read goes through an RPC that takes the
    channel id and filters on the index FIRST.
  - Never write an unfiltered select against messages, events or reactions.
    It will look fine on seed data and fall over on a real season.
- Measured headroom at one large club (250 members, 28 channels, 60k
  messages, 23MB): chat list 1.5-5ms, opening a channel 5.6ms, paging 5.2ms.
  The database is not the constraint at hundreds of users; Realtime
  concurrent connections are.
- Supabase Realtime uses `postgres_changes` behind a single
  `useChannelMessages` hook. It does not scale — it re-evaluates RLS per
  subscriber per change. Swap it for broadcast-from-trigger before onboarding
  roughly the twentieth academy. Keep the hook the only place that knows.
- Dev SMS uses Supabase test phone numbers. Real Twilio is prod only.
