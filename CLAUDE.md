@AGENTS.md

# Squadroom

Multi-tenant group chat, fixtures and RSVPs for youth football academies.
NRIFA (Sydney) is the first customer; the product is multi-academy from day
one and is meant to reach hundreds of academies.

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
- **Dribl is the source of truth for registration and fixtures; Squadroom is
  the communication layer.** Players must be registered in Dribl to play, so
  do not rebuild registration and do not ask a coach to type a draw twice.
  - Dribl has no public API and no ICS feed (checked Aug 2026; calendar sync
    moved behind a paid tier). The supported path is the club-admin export:
    Events → filter → Export → Events → download a spreadsheet.
  - So: build an importer, not an integration. Do NOT scrape the public Match
    Centre - fragile and almost certainly against their terms.
  - Column mapping must be built against a real export file, never guessed.
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
    lets you see the DRAW, not each other's PEOPLE.** No policy on messages,
    members, players, channels or the directory mentions competitions, and
    none ever should. Proven by the cross-club isolation test.
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
- **Payments use Stripe Connect Express** — money goes from parent straight
  to the academy. Squadroom never holds it. Card data never touches our
  servers. Platform billing (`academies.plan`) is a separate concern from
  academy collections; do not share a code path between them.

## Phases

0. Foundations — schema, RLS, seed, isolation tests **(done)**
1. Auth + onboarding: phone OTP, invite chain, `/join/<token>`
2. Admin console: teams, members, bulk invite
3. Chat: channels, realtime, hosts, posting modes, reactions
4. Events, RSVPs, event cards in chat, reminders
5. Polls (simple + availability), directory
6. PWA + push + super-admin console **(push done)**
7. Tournament Mode — self-run competitions, ladders, run sheets, visiting clubs
8. Payments — Stripe Connect Express; tournament entry fees are its first
   real use case, which is why it follows tournaments rather than leading
9. Capacitor native wrap

## Working notes

- Migrations are SQL files in `supabase/migrations`, never dashboard changes.
- Run `scripts/test-rls.sql` after every migration. It is idempotent.
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
