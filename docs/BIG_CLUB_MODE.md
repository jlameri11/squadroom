# Big Club Mode — build it like it's our own club (Joey, 9 Nov 2026)

Joey's brief, kept whole so it survives the sessions it will take. Status and
the audit are at the end; the brief itself is not edited.

> You are the product owner of this section. Picture yourself as the
> volunteer President of a big Sydney club like APIA Leichhardt: 1,500+
> members, 70+ teams, MiniRoos to NPL, girls and women, seniors and over-35s,
> a committee of volunteers with day jobs, and 2,000 parents who just want to
> know where to be on Saturday. Build the platform you'd want to run that
> club on. Simplicity beats features every time.

## Order and rules

- Start after the current queue (deploy → organiser groups → club-heads
  chat). Commit and push hourly. Migrations tested locally, then on dev. No
  deploy until Phase 1 is done.
- **AUDIT FIRST:** list what already exists and reuse it — consents incl.
  code of conduct (R-06), WWCC (S-03), safeguarding officer + reports (S-02),
  PlayFootball status (R-14), rollover + offers (R-19/R-20), selection +
  publish (E-06), helpers (G-07), notices (0212–0213), venues/pitches (L-29),
  match-day checklist (F-07), sponsors (X-08), importers, payments. Only
  build gaps. Never duplicate or break.
- "Club" and "Academy" are the same platform. Signing up as Club uses the
  big-club setup and turns on streams, committee roles and rosters by
  default; an Academy keeps its simpler setup but can switch any of these on
  in Settings. Nothing is club-only or academy-only.

## Principles (non-negotiable)

1. Everyone sees only their job. A parent never sees committee tools; a team
   manager never sees club money.
2. A parent's Home: my kids' next games, what needs me, club news. Two taps
   to anything.
3. One number everywhere, one orange card at a time, plain words.
4. Messages reach the right people only. Notices are read-only; chat is for
   teams. No reply-all storms.
5. Volunteers have 10 minutes a week: every admin task has a sensible
   default, a bulk action and an undo.
6. Phone-first for families and coaches, one-handed, bad signal. Admin
   screens ALSO work well on a laptop (wide tables, bulk select, search,
   filters).

## Phase 1 — build now

1. **Club structure.** Club → Streams (club-defined tags: MiniRoos, Juniors,
   Girls, Women, NPL, Community, Seniors, Over-35s) → Age groups → Teams.
   Team fields: stream, age group, gender, division, coach(es), team
   manager, home ground, training slots, season.
2. **Roles** (several per person; assigned by owner/President; reuse the
   league's may_run(area) pattern; one Admin → People → Roles screen with a
   plain description of each). President, Secretary — whole club. Registrar
   — registrations, offers, waitlists, player records, PlayFootball status;
   not money. Treasurer — payments, refunds, vouchers, reports; never
   medical. Age/stream coordinator — full staff rights for chosen age groups
   or streams only. Team manager — one team: availability, team sheet, team
   chat, duty roster; not coaching settings. Coach — their teams (as now).
   Welfare officer — the existing safeguarding officer role, renamed in the
   UI; also receives incident reports. Volunteer coordinator — club rosters
   and helpers. Parents; adult players; player accounts 13+ (with parent
   approval, as built).
3. **Adult players** (seniors, women, over-35s). An adult player is their
   own member: joins, pays, answers availability, chats in their team — no
   guardian. Adult teams' chats use normal adult rules; child-safeguarding
   rules still apply to any team with under-18s. One person can be a parent
   AND an adult player AND a coach — Home shows each clearly.
4. **Communication layers** (each automatic by role/team — nobody adds
   people by hand). Club Notices (read-only, everyone). Stream / age-group
   notices (read-only, by team membership). Team chats (exist). Staff rooms:
   Committee, Coaches, Team managers. DMs with existing safeguarding. Admin
   → "Message the club": write once; audience = Whole club · Stream(s) · Age
   group(s) · Team(s) · Staff only · Unpaid · Not yet re-registered ·
   PlayFootball not done. Shows "This will reach 1,240 people" before
   sending. Push + in-app + email (existing hook). Pin, "until" date,
   images/attachments. "Seen by X of Y" + one-tap re-ping of unseen. Who can
   send: President/Secretary (anyone), Registrar/Treasurer (their filters),
   coordinators (their groups), managers (their team). Fan-out queued in
   batches; never blocks the sender. Quiet hours and digest respected;
   "urgent" only for safety and call-offs.
5. **Getting a big club live in a day.** Imports: PlayFootball export, Dribl
   club export, spreadsheet → players, guardians, teams. Handle 1,500+ rows
   with a clear preview, error list and undo. Invite staff by role (link/code
   per role). Families per team: link + QR + printable sheet for training
   night; families claim their child. Big-club setup checklist: Crest &
   colours → Streams & age groups → Import players → Teams, coaches &
   managers → Committee roles → Grounds & training slots → Programs (extras)
   → Invite families. "Club health" card: % families joined per team, teams
   without a manager, staff with WWCC missing/expiring, PlayFootball not
   done.
6. **Registration — PlayFootball first (Circular 26-02).** Official
   registration and the main rego fee happen in PlayFootball. Squadroom never
   collects that fee. Squadroom shows each player's PlayFootball status
   (import or set by Registrar), chases "not done" with one targeted message,
   and blocks nothing on game day by itself. Squadroom collects the club's
   EXTRAS: NPL/academy program fees, camps, trials, kit, presentation day,
   fundraisers — with instalments, sibling discounts, vouchers, refunds
   (exist). Code of conduct accepted at joining (existing consents).
7. **Trials, grading, teams.** Trial sessions per age group; coaches rate
   players privately (1–5 + note); coordinator allocates to teams on a
   phone-friendly screen (and a laptop table). "Publish teams" → each family
   gets ONE message: team, coach, manager, training slot and ground. Team
   chats update automatically.
8. **Training grounds & slots.** Grounds (existing venues/pitches) with
   weeknight slots per pitch/half-pitch. Coordinator assigns teams to slots;
   clashes refused; families see their slot on the team page and calendar.
   Ground closure: "Close ground" for a date → every affected session and
   game called off and every affected family told in one action.
9. **Game day (honest about Dribl).** NPL and association comps run on Dribl
   (Football NSW mandates it). Squadroom works ALONGSIDE: refresh fixtures
   from the club's Dribl export; availability and selection in Squadroom;
   "Submit your Dribl team sheet" reminders to managers (F-07); results
   posted to the team chat. Club-run comps (gala days, internal comps,
   holiday tournaments) run fully in Squadroom. MiniRoos (U6–U11): no scores
   or ladders shown by default, per Football Australia. President/Secretary
   "Saturday" view: every game today across the club by ground, call-offs,
   missing managers/referees, roster gaps, results as they come in.
10. **Volunteers.** Club rosters: canteen, BBQ, ground official/field
    marshal, set-up/pack-up — per ground per Saturday (extend G-07 helpers).
    Team duty roster: oranges, linesperson, kit wash — fair rotation across
    families, swap requests, reminders. Volunteer coordinator sees this
    weekend's gaps and messages only the right people.
11. **Safety & compliance.** WWCC (exists) + coaching accreditation with
    expiry; reminders 30 days out; expired staff flagged and removed from
    coaching roles with children until renewed. Incident/injury report from
    the ground (who, what, when, first aid given) → Welfare officer and
    President; timestamped; nobody else sees it. Welfare officer contact
    shown in every family's Settings.
12. **Club HQ** (President/Secretary Home — max five tiles): Needs a
    decision · This weekend · Money · Messages · Club health. Treasurer
    Home: collected, outstanding, by stream/team, instalments due; "Remind
    unpaid" messages only the unpaid; CSV export for the accountant.
    Registrar, coordinator, manager Homes: their three jobs each.
13. **Activity log.** Every admin change (roles, teams, payments, refunds,
    notices, call-offs) recorded: who, what, when. Visible to
    President/Secretary. Survives committee turnover.
14. **Demo — "Inner West FC"** (fictional: no real club names, badges or
    colours). 40 teams across MiniRoos, Juniors, Girls, NPL, Seniors,
    Over-35s; 800 players (incl. adult players); 1,000 parents; full
    committee; two grounds with training slots; an extras program mid-way; a
    weekend of fixtures; a roster with gaps. Demo logins (password
    squadroom-demo, in docs/DEMO.md): President, Registrar, Treasurer,
    U9–U12 coordinator, team manager, coach, parent of two kids in different
    streams, adult over-35s player, welfare officer, volunteer coordinator.
    Write a one-page "Inner West FC — 10-minute demo" walkthrough in
    docs/DEMO.md.

## Definition of done (Phase 1)

- Every role's Home screenshotted at 375px (light/dark) and admin screens at
  laptop width.
- A parent with kids in two streams sees both clearly on one Home; an adult
  player sees their own team.
- "Message the club" to 2,000 people queues instantly and delivers in
  batches (tested on the local big dataset).
- Tests: each role can do its job and nothing more; coordinators can't touch
  other groups; managers can't touch other teams; treasurer never sees
  medical; incident reports reach only the welfare officer and President;
  parents can't send notices; MiniRoos scores hidden by default; activity
  log records every admin change.

## Phase 2 — plan only (write into BUILD_PLAN, don't build)

Kit loans (issued/returned, deposits), supporter view for grandparents
(fixtures/results only), club documents library (policies, by-laws),
presentation-day tickets, newsletter templates, notice translation,
AGM/committee papers.

---

## Status

- **9 Nov 2026:** received, after the migration-day deploy, the organiser
  groups and the "Academy vs league organiser" brief.
- **10 Nov 2026:** the queue ahead of it is done (two-step by text 0232–0233;
  the organiser groups 0234–0235). The audit (below) is done. **Step 1 built
  — 0236, on dev:** club mode and streams, team gender and home ground, age
  groups past U18, the eight club roles with a scope (`club_roles`,
  `may_run_club`, `runs_team`; the money policies accept a Treasurer, the
  registration policies a Registrar, a coordinator and a team manager run
  their teams through `is_team_coach`, the Welfare officer is the
  safeguarding officer), the activity log and its triggers, Admin → Roles
  and Admin → Activity, the new-team form, the club-mode switch in Club
  settings. test-rls 178–183; `test-club-roles` (23, on dev). Then Joey's
  10 Nov order (next section): Part A's four fixes first.
- **10 Nov 2026, Part A:** fix 1 **done** — 0237 (one membership, a set of
  hats: `academy_members.roles`, `role` the strongest for every older
  reader, `member_roles_of` / `holds_role` behind `academy_role_of`,
  `is_academy_staff` and `is_academy_coach`; `add_member_role` /
  `remove_member_role`; a team's manager is on the team and in its chat;
  `home_personas` and `home_jobs(p_academy, p_persona)` with Homes for the
  President, Treasurer, Registrar, coordinator, team manager, Welfare
  officer and Volunteer coordinator; hat chips on Home; the Roles screen's
  "Everyone's hats") and 0238 (the sync trigger as its owner — found by the
  first dev run); fix 2 **done** — 0239 (the hundred-year rule, the three
  0215 guards let an adult through, every reader finds the person's own
  record, a players' link for adult teams, "I'm registering myself" on the
  public form, `team_has_minors` for the rules to come). test-rls 184–188;
  `test-many-hats` (22), `test-adult-player` (end to end); fix 3 **done** —
  0240 (category, gender, label); fix 4 **done** — 0241 (the Welfare
  officer). Then the feature switches (0242, `SIMPLICITY.md`) and **Part B
  began: Message the club (0243)** — item 4's centrepiece — and **the
  layers (0244–0245)**: Club Notices, hosts-only age groups, a channel per
  stream following the teams, the Committee and Team managers' rooms. **The
  organiser group (0246) done, as read above:** `group_overview` (everything
  the group runs, with this week's numbers, for its staff and league roles),
  `my_organisations_with_competitions` (the switcher's list), the switcher
  with the group's competitions underneath, /competitions opening with the
  overview, "Run by <Group>" on the competition screen, the public match
  centre, the Notices room and the entry form's fee line. test-rls 200;
  `test-organiser-group`. **Getting live (0247) done:** `import_batches`
  with undo, a squad per row and chunked uploads in the roster importer;
  `setup_progress` with the brief's steps (a manager per squad, grounds,
  invite families; streams and committee roles in club mode);
  `club_health` and `/admin/health` (item 12's card), switchable. test-rls
  201; `test-getting-live`. **Claiming a child from the roster (0248)
  done:** the join form takes each child's name and birthday, approval
  matches them to the imported roster instead of adding them twice, and a
  printable sheet (`/join/sheet/<code>`) carries the code, the QR and the
  steps. `test-claim-child`. **Coach/staff join links by role are NOT
  built, on purpose:** the clearance gate (0120) refuses a coach without a
  current WWCC and a clearance needs a profile, which a join request has
  only once approved — a self-serve coach link needs a pending-coach state
  first (Phase 2). Coaches keep coming in through Invites. Item 5 is
  otherwise complete. **Item 7 done (0249):** trial sessions on the
  program, `trial_ratings` (coaches only), `trial_placements` as a private
  pencil, `publish_teams` (the pencil becomes the squads, a welcome in each
  squad's chat, one message per family; the Season screen publishes moves
  and rollover the same way), the Grading card with a laptop table;
  switch `trial_ratings`. test-rls 202; `test-trials`. **Item 8 done
  (0250):** a slot is a weekly series on a pitch (`create_training_series`,
  `set_training_slot`; clashes across a pitch, its parent and its halves,
  and the pitch's hours, refused before anything is made), `team_training`
  and `ground_slots`, the pitch picker on Add training, the team page's
  Training line, the ground's week on Venues, and `close_ground` (sessions
  called off and every family told; the club's own competitions postponed;
  another league's games named to pass on); switch `training_slots`.
  test-rls 203; `test-grounds`. **Item 9 done (0251):** MiniRoos keep no
  score in any reader (`scores_shown`, a club setting to turn them on), a
  result reaches the squad's chat, the team sheet is asked for the evening
  before (Squadroom's or Dribl's, honestly), and `saturday_view` with
  `/admin/saturday`; switch `game_day`. test-rls 204; `test-game-day`.
  **Item 10 done (0252):** a ground's Saturday is a club-wide event with the
  0225 jobs (`create_ground_day`, seen from every game there), squad duties
  by turns (`team_duties`, `event_duties`, `roster_team_duties`, swaps asked
  and taken in the chat, the reminder the evening before), and the
  coordinator's `volunteer_gaps` with `/admin/rosters`; switches `helpers`
  and `duty_roster`. test-rls 205; `test-volunteers`. Next: safety (11),
  the demo (14).

## Audit (10 Nov 2026) — what exists, what is a gap

Read-only, from the code and migrations as they stand after 0235. "NNNN"
means `supabase/migrations/NNNN_*.sql`; the latest definition of a function
is the one cited.

### A. Communication layers (brief item 4) and Homes (item 12)

**Exists**
- Channel kinds (`channel_type`): team, age_group, coaches, academy_wide,
  direct, custom (0073a), notices (0212), clubs and referees (0234).
  - Team channels: one per team (`on_team_created`, 0005); every
    `team_members` row is added by trigger (coach → host, parent/player →
    member), removed when they leave; guardians follow a child's team
    (0098); archived at season end.
  - Age-group channels: one per academy per age group, "U9s Age Group",
    created and filled by the same triggers; U5–U18 only (the `teams.age_group`
    check); never archived; **open for anyone to post** (default mode).
  - "Coaches": owners, admins and coaches (0005, 0027). "Announcements"
    (`academy_wide`): every active member, owners/admins as hosts — also
    **open by default**, so a parent can post in it.
  - Direct: `open_direct_channel` honours `dm_policy`; a minor's guardians
    are brought in (0076); `open_competition_direct` (0235).
  - Custom: `create_channel(...)` (0074), hand-picked members.
  - Computed rooms (never stored): notices (`notices_standing`,
    `notices_people`, `notice_reads`), clubs and referees (`clubs_standing`,
    `referees_standing`, `group_people`, `channel_recipients`, 0235).
  - Posting modes open/hosts_only/replies_only (`can_post_in_channel`);
    `is_announcement` for hosts; pinned messages (`pinned_at`, no UI to pin
    except the seed); scheduled messages (0180–0181, text only); attachments
    (0184); polls (hosts); an "until" date on announcements
    (`messages.relevant_until`, 0217) and Home drops announcements after 14
    days.
- "Message everyone" for an owner = the `everyone` Home job, which opens the
  Announcements channel (0217); the owner ticks "Send as an announcement".
- Targeted chases exist only as fixed-text pushes: `queue_fee_reminders`
  (unpaid, daily), `nudge_unregistered` (not re-registered, a button on the
  Season screen), `queue_official_rego_reminders` (PlayFootball pending with
  a game inside 14 days, daily), `nudge_non_responders` (a fixture's
  non-responders).
- "Seen by": `read_receipts` (0194, ticks on the sender's own messages),
  `notices_reach` (0213, the league's count), **`announcement_reach` and
  `reping_unread` (0109) exist in the database but no screen calls them**
  (only `scripts/test-nudge.mjs`); both read `channel_members` only.
- Email: only a competition notice is emailed (`/api/notices/email`, called
  by the notice composer after posting; `notice_email_recipients`,
  `notice_emails`; `lib/mail/resend.ts` in batches of 100; nothing without
  `RESEND_API_KEY`).
- Push: `enqueue_message_notification` writes one `notification_queue` row
  per recipient **inside the sender's transaction** (a notice to 3,602
  people measured 86 ms, `SCALE.md`); digest windows and quiet hours are
  applied there; announcements, mentions and DMs go at once and ignore
  mute and quiet hours. The wake (`wake_push_sender`, debounced to one per
  15 s) and the 5-minute sweep each drain **200 rows once**
  (`lib/push/drain.ts`, `claim_notifications`), so a 2,000-person send
  leaves ~1,800 to the sweep at ~200 per run; rows unsent 12 hours after
  due are dropped (0219). Call-offs (`notify_event_change`, 0064) never
  wait and cannot be muted.
- Homes: `home_persona` (0186) → parent | coach | owner | league, from the
  one `academy_members.role` a person may hold per organisation
  (`academy_members_unique`) and `league_roles`; `home_jobs` (0217) gives
  each persona three jobs; the switch (`lib/org.ts`) is between
  organisations, never between roles; `home_layout` per person;
  `needs_you`, `nav_badges`, `setup_progress`; the finance CSV exists
  (`/api/export/finance`).

**Gaps**
- No streams anywhere (no table, column, tag or channel).
- No Committee or Team-managers room, and no role to drive one:
  `team_members.role` is coach/parent/player; `academy_role` is
  owner/admin/coach/parent/player; `league_roles` is the league's four.
- Club-level read-only notices cannot be represented (notices need a
  `competition_id`; `audience = 'club_staff'` is refused outside notices);
  Announcements and age-group channels are open, not read-only.
- No "Message the club": no audience picker (whole club · stream · age
  group · team · staff · unpaid · not re-registered · PlayFootball not
  done), no "this will reach N" count, no role-scoped sending, no seen-by
  or re-ping on screen, no email for club announcements, no batching —
  the fan-out happens in the sender's transaction and delivery trickles
  through a 200-row drain.
- Homes: a closed set of four personas; no President/Secretary, Treasurer,
  Registrar, coordinator or manager Home; no Club HQ (needs a decision ·
  this weekend · money · messages · club health); the `safeguarding_officers`
  table (0108) is not read by `home_persona`; one academy role per person
  per organisation, so a coach who is also a parent gets the coach Home.
- Settings has no quiet-hours or notify_* controls (digest only); no
  message-level "urgent" (every announcement is time-sensitive).
- Small holes in stored membership: a member re-activated by upsert is not
  re-added to channels; leaving the last coached team does not leave
  "Coaches"; `create_channel` with a team does not back-fill its members.

### B. Getting live, registration, trials, grounds, game day, volunteers, the log, the demo (items 5–10, 13, 14)

**Exists**
- Roster importer (R-10): `import_players(p_academy, p_team, p_rows, p_season)`
  (0100, rewritten 0124) — name, DOB, gender, preferred name, FFA number,
  squad number, school, kit sizes; dedupes through `find_existing_player`;
  returns created/matched/problems by row; `suggestMapping` confirms the
  columns (`lib/import/columns.ts`); UI `app/admin/import/players/`.
  **500 rows per call, one squad per import, no team column, no undo;
  guardians refused on purpose** (the "contacts are picked, never synced"
  rule — the brief's "spreadsheet → guardians" meets it head on).
- PlayFootball export (R-18): `import_official_status(p_academy, p_rows)`
  (0162) matches by FFA number → FIFA ID → name + DOB, sets
  `players.official_status`, confirms pending requests; UI
  `app/admin/import/playfootball/`. No undo. **Likely bug:**
  `get diagnostics … row_count` sits inside the loop, so `confirmed_requests`
  reports only the last row.
- Dribl events export: `/admin/import` (`import_screen`,
  `preview_imported_events`, `create_imported_events`, `apply_imported_results`,
  `store_imported_games`); idempotent on `events.external_ref`. Only the
  events export — no members/players/teams export reader.
- Invite links: `join_links` (team or club-wide, role coach/parent/player,
  6-character code, max uses, expiry, revoke), QR on the team page
  (`join-link-panel.tsx`), phone invites (`bulk-invite.tsx`), Directory "Add
  contact". **The UI only ever makes parent links; the approve route
  hard-codes `'parent'` for both memberships (would demote a coach who is
  also a parent — risk, not yet seen); no club-wide link UI; no printable
  sheet; `setup_progress` counts `'admin'` links that cannot exist.**
- Families claiming a child: the join form's free-text children, matched by
  exact name on approval, else a new player; `player_guardians_join_team`
  (0098); public registration matches DOB + name. No pick-from-roster or
  code claim; no DOB check on the join-link path.
- Setup checklist: `setup_progress` (0192) — brand, squads, roster,
  programs, coaches, first session; the clock; `app/start/setup/`. No steps
  for streams, managers, committee roles, grounds and slots, invite families.
- Club health, in pieces: `clearance_board` (missing/expired/expiring/…),
  `queue_clearance_warnings` (60 days, every 14), per-squad kit and
  PlayFootball counts, the registration dashboard. No card, no % of
  families joined, no club-wide PlayFootball-not-done count.
- PlayFootball status (R-14): `official_rego_status` enum,
  `players.official_status/_at/_by`, `ff_number`, `fifa_id`,
  `set_official_status`, `queue_official_rego_reminders` (pending + a game
  inside 14 days, weekly), the approval gate (`requires_official_rego`,
  `guard_official_rego`, `confirm_official_rego`), `playfootball_fees_disclosed_season`;
  nothing blocks game day by status (matches the brief). No targeted
  message, no club-wide list, no bulk set bar the import.
- Programs and registrations (0083+, kinds squad/development/trial/camp/
  term_class/tournament/tour/other), `registration_requests`,
  `registration_queue`, `set_program_fee`; extras money complete:
  `payment_requests`/`payments`, instalments, sibling ladder, `quote_payment`,
  `outstanding_fees`, vouchers (club/government/coach/volunteer/scholarship/
  sibling), `queue_fee_reminders`, refunds via `withdraw_registration`,
  `finance_export`, one family checkout, bank clearing, promises.
  **`refunds.registration_id` is NOT NULL** — no refund for a fee that is
  not a registration.
- Consents (R-06): `consent_documents` (versioned, incl. code_of_conduct),
  `consent_acceptances`, `outstanding_consents`, `set_consent`; collected on
  the public register form and withdrawable in Settings. **Not asked on the
  team-link join; no admin screen writes a consent document (seed only).**
- Trials: a program of kind `trial`; `offers` (`make_offer`, `accept_offer`,
  `decline_offer`, held places 0221). **No trial sessions tied to an age
  group; no trial ratings** — the nearest is `player_reports` (0196: private
  note or four 1–5 ratings, by staff or the child's coach).
- Rollover and regrading (R-19, 0197): `preview_season_plan`,
  `roll_over_season` (keep/new/merge/leave out), `preview_player_moves`,
  `move_players`, `rollover_report`, `offer_returning_places`. **No
  "Publish teams" message** — rollover, moves and accepted offers tell
  nobody their team, coach, slot and ground.
- Selection (E-06): per game — `publish_lineup` (0199) with "selected" (and
  optionally "not selected") pushes; `availability_grid`.
- Team chats follow squads by trigger (0005, 0098); a mid-season move
  deliberately leaves guardians in the old chat (and its call-offs).
- Grounds (L-29, 0198): `venues` (pin, amenities), `pitches`,
  `pitch_availability`, `pitch_size_rules`, `fixtures.pitch_id`, the clash
  trigger `guard_pitch_booking`, `generate_fixtures_on_pitches`,
  `app/admin/venues/`. Training: weekly `event_series` (free-text venue).
  **No `venue_id`/`pitch_id` on events or series, so no weeknight slots, no
  team-to-slot assignment, no training clash check, no slot on the team
  page.**
- Close ground: `call_off_day(p_academy, p_date, p_reason, p_note, p_venue, p_team)`
  (0132; venue by ILIKE on text; events only, one date) and the league's
  `call_off_fixtures(…, p_pitch)`; told through `notify_event_change`
  (cannot be muted, SMS inside 24 h). No control on a venue.
- Game day: F-07 checklist (`event_checklist_ticks`, `tick_checklist`,
  `queue_match_day_pushes` an hour out to coaches), `live_tick` posts
  kick-off/goals/full time to the squad chat, `set_player_of_match`;
  `set_event_result` and imported results post nothing.
  MiniRoos: `competition_divisions.scores_public`/`ladder_enabled` (0148,
  default shown, Squadroom-run competitions only, honoured on the public
  match centre); **nothing hides a club event's scores by age** (`live_tick`
  lines, `academy_results`, `division_table`, `team_form`, share cards).
  Ops dashboard: `match_day_ops(p_competition)` (0189/0190) — league-only;
  no club-wide "today by ground" view (pieces: `whats_on`, the Fixtures
  filters, the owner's today count, `my_matchdays`, `academy_results`).
- Volunteers (G-07, 0225): `event_jobs`, `event_job_helpers`,
  `set_event_jobs`, `help_with`, `stop_helping`, `ask_for_helpers` (12 h),
  6 pm reminders, suggested jobs incl. Canteen, BBQ, Field marshal,
  Set-up, Pack-down. **Per event only: no roster per ground per Saturday,
  no team duty roster, rotation or swaps, no coordinator, no gaps view.**
- Activity log: **none.** Only scattered who/when columns (`match_sheet_log`
  for competitions, `*_by` columns on reports, clearances, registrations,
  refunds, official status, checklist ticks, vouchers; `join_link_redemptions`,
  `deleted_message_archive`). Role changes overwrite in place; call-offs
  have no `cancelled_by`.
- Demo: `supabase/seed.sql` + `scripts/seed-*.mjs`, `refresh-demo.mjs`
  (NRIFA ids hard-coded), `demo-passwords.mjs`, `demo-accounts.mjs`,
  `_demo-snapshot.mjs`, `smoke-demo.mjs`, `docs/DEMO.md`. Scale tooling:
  `scripts/scale/seed.sql` (pure SQL, 60 clubs, 400 squads, 6,000 players,
  10,000 parents, 1,140 fixtures, 9,600 trainings, ~500k messages, on the
  embedded Postgres), `measure.mjs`, `spike.mjs`, `docs/SCALE.md`.
  `seed-demo`/`refresh-demo` call `listUsers()` without paging (breaks past
  1,000 users); the scale seed's header names a runner that does not exist.

**Gaps that block the brief as written**
- `teams.age_group` and `channels.age_group` accept U5–U18 only (the
  `'^U([5-9]|1[0-8])$'` check) — Seniors, Women and Over-35s cannot be
  stored. `teams` has no stream, gender, division-as-such, home ground,
  training slot or manager.
- Roles: `academy_role` is owner/admin/coach/parent/player; `team_members.role`
  coach/parent/player; one academy role per person per organisation.
- Adult players: every player login, membership or squad place needs a
  guardian-approved `player_logins` row (0215 `refuse_player_logins`,
  `team_members_players_need_approval`) — an adult cannot be their own member.
- Suites to reuse: import-players, import-diff, join-codes, self-onboarding,
  official-rego, circular-26-02, vouchers, withdrawals, trial-offers,
  returning-offers, regrading, lineup, match-day-list, live, pitches,
  call-off-day, helpers, draw-and-ops.

### C. Club structure, roles, adult players, safety (items 1, 2, 3, 11)

**Exists**
- `teams`: id, academy_id, name, `age_group` (text, **check `'^U([5-9]|1[0-8])$'`**),
  season, status (active/ended), ended_at, + `external_ref`, `capacity`,
  `kit_home/away`, `skip_import` (0121), `rolled_from` (0139). Coaches are
  `team_members.role = 'coach'` rows; division lives on
  `competition_entries` / `competition_divisions` (the organiser's free
  text — "do not build a divisions table"); gender only on players and
  programs (`player_gender`). Age groups are plain `U<n>` text
  (`next_age_group`, `age_number`); `channels.age_group` and
  `pitch_size_rules.age_group` carry the same shape; the new-team picker
  hard-codes U5–U18. Training is `event_series` (days, time, duration,
  free-text venue) making real `events`. `org_type` has `'club'` but
  nothing behaves differently for it. Team screens: list, new (name, age
  group, season), league name, season control; no editor for a team after
  creation and no way to put a coach on it from its page.
- Roles: `academy_role` owner/admin/coach/parent/player (never altered);
  `academy_members` unique per (academy, profile) — **one role per person
  per club**; `team_members.role` and `join_links.role` check
  coach/parent/player. Helpers: `academy_role_of` (two-step aware),
  `is_academy_staff` (owner/admin), `is_academy_coach` (+coach, not
  lapsed), `is_team_coach` (coach of the team or staff, not lapsed),
  `is_guardian_of` (also a self-linked player). The league's pattern to
  copy: `league_role` enum, `league_roles` (several per person, `granted_by`),
  `may_run(p_competition, p_area)`, `grant_/revoke_league_role`,
  `league_officials`, and a UI with a plain description per role
  (`league-officials.tsx`) — keyed by competition, so not usable for a club
  as is. `safeguarding_officers` (0108) is a table, not a role;
  `is_safeguarding_officer` = appointed or the owner; **no screen appoints
  one** (the safeguarding screen tells people to be appointed "in Club
  settings", which has no such control; the hub row is staff-only).
  "Manager" in code means coach (`entry_managers`, the F-07 checklist,
  `may_manage_helpers`). Role UI: Directory "Add contact" (parent/coach),
  members tree (remove only), team links always parent. Making a coach or
  admin needs a current WWCC (0120). Staff rights are all or nothing: any
  admin reads `player_medical` and `payments`. ~44 places in 21 migrations
  compare `academy_members.role` directly; 10 app files read it.
- Adult players: `players` (team_id, profile_id, full_name, dob, …,
  official status, kit, fifa_id), `player_guardians`; teen logins
  `player_logins` (invite → claim → decide → end; 0215) with triggers
  `refuse_player_accounts`, `refuse_player_logins`,
  `refuse_squad_player_places` refusing every other route. A linked player
  may already RSVP and register for themselves (`is_guardian_of`) and joins
  the team chats. Child checks: **`players.dob` must be under 25 years
  ago** (0003, never relaxed — so no player over 25 can be stored, and the
  roster import's 100-year DOB passes the mapper then fails the insert);
  `is_thirteen`; `is_minor_profile` (under 18, no DOB, or a player role
  without a proven adult record — used only by the DM/custom-chat guardian
  triggers); the public register refuses a child over 25.
- Safety: `staff_clearances` (kinds `wwcc`/`exemption`; outcomes cleared/
  applied/barred/not_found; one current record per person per club, no
  history), `record_clearance`, `clearance_board`, `clearance_lapsed`
  (removes coaching rights and posting, not membership or staff powers),
  `queue_clearance_warnings` (60 days out, every 14, **to owners and admins
  only**, cron 19:15). Reports: `message_reports` (reasons incl.
  safeguarding; `report_message`, `safeguarding_queue`, `review_report`) and
  `conduct_reports` (disclosure/allegation/concern/boundary_breach/other;
  `file_conduct_report`, `conduct_register`, `review_conduct_report`), readable
  by officers, the owner and the reporter; `player_concussions` (readable by
  every coach; locks the sheet); `player_medical.first_aid_consent`; the
  checklist's first-aid-bag item; Settings "Report a concern".

**Gaps**
- No stream anywhere; no age-group entity; `teams` lacks stream, gender,
  home ground, training slot and manager; no team editor.
- None of President, Secretary, Registrar, Treasurer, coordinator, Team
  manager, Welfare officer (as a role name), Volunteer coordinator; no
  club-side `may_run`; no right scoped to an age group or stream; one role
  per person per club; no screen to promote, demote, make an admin or
  appoint an officer.
- An adult cannot be their own member: the 25-year DOB check, no self route
  (only a guardian's invitation), one role per club, and every reader finds
  a player only through `player_guardians` (`my_upcoming_events`,
  `my_rsvps_for_event`, `my_family`, checkout "That is not your child",
  fee quotes). No adult team can exist and nothing knows whether a team
  has under-18s.
- No coaching accreditation (W-03 "training lapses are not tracked"); no
  30-day reminder and nothing to the person whose check lapses; a lapsed
  check removes rights, not roles; no incident/injury report (who, what,
  when, first aid); nobody is told when a report or concussion is filed;
  the UI says "Safeguarding", never "Welfare"; no officer contact in a
  family's Settings (`member_contact` hides a non-staff officer's number;
  staff-only DMs stop a parent messaging a non-staff officer).

## Joey, 10 Nov 2026 — next steps, in this order (verbatim)

> Next steps (Joey, 10 Nov). Do in this order. Commit and push hourly. No deploy until I say.
>
> PART A — THE FOUR AUDIT FIXES (start now, before the rest of Big Club Phase 1)
> 1. ROLES: one membership per person per club, plus a set of roles on it (a person can be parent + coach + President + team manager at once). Update every RLS helper to ask "does this person hold role X here" instead of reading one role. Migrate existing rows without losing anything. Home shows each hat clearly.
> 2. ADULTS: remove the under-25 rule. Date of birth must be in the past and under 100 years ago. Adult players are their own member (no guardian). Fix the register form and the importer. Test a 40-year-old over-35s player end to end: join, register, pay, chat, play.
> 3. TEAM CATEGORIES: replace U5–U18-only age_group with Junior (U5–U18), Open/Seniors, Over-35, Over-45, Over-55, plus a separate gender field (Boys / Girls / Mixed / Men / Women). Clubs can add their own label (e.g. "Women's Premier League"). Existing teams keep their values.
> 4. WELFARE OFFICER: Admin → People → Roles → "Welfare officer (Member Protection)" — appoint in one tap; shown on every family's Settings as the club's safeguarding contact; reports go to them and the President only.
> Tests: a person with four roles sees each correctly and nothing extra; an adult player works with no guardian; an over-35s team can enter a league; only the welfare officer and President receive a report.
>
> PART B — CONTINUE BIG CLUB PHASE 1 (as briefed on 9 Nov), building on Part A.
>
> PART C — DRIBL GAPS (after Big Club Phase 1)
> 1. Registration photo: families upload a player photo when registering — private bucket, resized, staff-only until approved, then used on the player card and as match-sheet ID for referees. Clubs can make it required.
> 2. Bans: a club or league can ban a person (parent, spectator, coach or player) for a set period with a reason. While banned they can't RSVP, post, or be on a team sheet. Visible to staff only. Logged in the activity log.
> 3. Team Creator for social comps and tournaments: a captain registers a team, gets a join code/link, teammates join and either pay their share or the captain pays for all; the organiser approves the team.
> 4. Blue cards (sin bin): per-league on/off; recorded on the match sheet with minutes.
> 5. Registrations-only CSV export: who registered for what, with their answers.
> 6. Ladder breakdown: tap a ladder row to see how every point was earned (results, adjustments, forfeits).
> Tests for each.
>
> NOT NEEDED: best-and-fairest votes.
>
> After Part C: run the SPL Season 4 full simulation (as briefed on 9 Nov) on the local database.

> **Also in Part B (Joey, 10 Nov, a little later):** the organiser GROUP from 5 Nov is still missing — a "Tournament & league organiser" account that runs several leagues/tournaments (e.g. Magic Group → SPL + 3 tournaments): group staff get rights on all of them, "Run by <Group>" on public pages/notices/receipts, the org switcher shows the group with its competitions underneath, and a simple group overview. Keep it simple.

Reading of the group item: the organiser organisation IS the group
(`competitions.organiser_id`), and its owners, admins and league roles
already run every competition it organises (`may_run`). What is missing is
the presentation: the organisation type named "Tournament & league
organiser", "Run by <Group>" wherever a competition is shown publicly, on
notices and on receipts, the switcher listing the group's competitions
under it, and one overview screen of everything the group runs. No new
ownership model.

How Part A maps onto the work already under way: **0236** (streams, the
scoped club roles beside the membership, the money and registration
policies re-gated, the activity log, age groups past U18) is the base.
Then **0237** makes the membership carry a SET of base roles (owner, admin,
coach, parent, player — several at once) with the helpers asking "holds
role X here" and Home showing each hat; **0238** the adults; **0239** the
team categories as Joey named them (Junior U5–U18 · Open/Seniors · Over-35
· Over-45 · Over-55; gender Boys/Girls/Mixed/Men/Women; a club's own
label); **0240** the Welfare officer (Member Protection): one tap, the
family's Settings, reports to them and the President only. Scoped roles
(a team's manager, an age group's coordinator) stay in `club_roles`
because each names a team or an age group, which a flat set cannot.

## Phase 1 plan (10 Nov 2026) — reuse first, in dependency order

Each step is a migration proved locally on the demo copy, then on dev, with
test-rls checks and a suite; screens at 375px light/dark and admin tables
at laptop width (a new `--wide` pass in the screen suites). Nothing here is
club-only: a club gets it switched on by the big-club setup, an academy can
switch any of it on in Settings (`academies.club_mode`).

1. **0236 Structure, roles, the log (items 1, 2, 13).** `streams`
   (club-defined, ordered; `teams.stream_id`); `teams.gender`,
   `teams.home_venue_id`; the age-group checks widened everywhere to
   `U5…U99 | Open | Over-NN` (`age_number` learns the adult groups;
   rollover keeps them). `club_role` enum (president, secretary, registrar,
   treasurer, coordinator, team_manager, welfare_officer,
   volunteer_coordinator) and `club_roles` (several per person; a scope:
   the whole club, a stream, an age group, a team; `granted_by`;
   `grant_club_role` / `revoke_club_role` / `club_officials`, owner or
   President/Secretary grants; WWCC rule as for coaches). Rights through
   the existing helpers, not new comparisons: `may_run_club(p_academy,
   p_area)` with areas club · registrations · money · people · teams ·
   volunteers · welfare · comms; `is_team_coach` true for a team's manager
   and for a coordinator whose scope covers the team (so every team tool
   follows), `may_develop` stays coach/staff; the money policies accept a
   Treasurer and never show a Treasurer medical; the registration policies
   accept a Registrar and refuse them money; `welfare_officer` writes
   `safeguarding_officers` (kept as the store). `activity_log` (academy,
   actor, action, subject, detail, at) written by triggers on members,
   roles, teams, payments' status, refunds, club messages, call-offs; read
   by the owner, President and Secretary. Admin → People → **Roles** screen
   with a plain description of each role. Then `home_persona` /
   `home_jobs` grow personas for President/Secretary (Club HQ: needs a
   decision · this weekend · money · messages · club health), Treasurer,
   Registrar, coordinator, manager, with a role lens for people holding
   several (the switch gains roles within the organisation).
2. **0237 Adult players (item 3).** The DOB check becomes "after 1900"; the
   three 0215 guards let an adult (18+ by DOB) be their own member and
   player without a guardian; an adult-team join link (role player) and
   the approve route make the `players` row for the person; every reader
   that finds a child through `player_guardians` also finds the person's
   own record (`my_upcoming_events`, `my_rsvps_for_event`, `my_family`,
   checkout, quotes, helpers); `team_has_minors(team)` decides the chat
   and DM rules per team; Home shows parent, player and coach parts
   clearly.
3. **0238–0239 Communication layers (item 4).** In club mode:
   Announcements becomes **Club Notices** (hosts only), age-group channels
   become notices too, **stream** channels (computed from team membership,
   hosts only), **Committee** and **Team managers** rooms (computed from
   `club_roles`, two-way, like the Clubs room). **Message the club**:
   `club_messages` (audience = whole club · streams · age groups · teams ·
   staff · unpaid · not re-registered · PlayFootball not done; pin, until,
   attachments, urgent for safety only), `preview_club_message` ("this will
   reach 1,240 people" before sending), fan-out **queued in batches** by a
   worker (`fan_out_club_messages`, pg_cron each minute, 500 recipients a
   pass; never in the sender's transaction), `club_message_recipients`
   with seen_at for "Seen by X of Y" and one-tap re-ping of the unseen,
   push + in-app (a Messages screen and Home's club news) + email through
   the existing Resend hook; who may send by role. The push drain learns to
   loop until the queue is empty. Settings gets quiet hours and the
   notify toggles.
4. **0240 Getting live (item 5).** Setup steps grow to the brief's eight
   (streams & age groups, teams/coaches/managers, committee roles, grounds
   & slots, invite families); the roster importer takes a team column,
   1,500+ rows in batches, an `import_batches` id with **undo**; guardians
   stay out of bulk import (the contacts rule) — instead a per-team claim
   link + QR + printable sheet (`@media print`) with "claim your child"
   from the roster (name + DOB); staff invite links by role; **Club health**
   (`club_health`: % families joined per team, teams without a manager,
   staff with WWCC missing/expiring, PlayFootball not done).
5. **0241 Registration (item 6):** the PlayFootball importer's count bug;
   code of conduct asked on the team-link join; an admin consent-document
   editor; the Registrar's chase through Message the club.
6. **0242 Trials, grading, publish (item 7):** trial sessions per age
   group (programs of kind trial + sessions as events), private 1–5
   ratings with a note (reuse `player_reports`), a coordinator's allocation
   screen (phone list, laptop table), **Publish teams** → one message per
   family (team, coach, manager, slot, ground) and the chats follow.
7. **0243 Grounds & slots (item 8):** `training_slots` per pitch or
   half-pitch (weekday, time, team), clash refusal across parent and child
   pitches and pitch hours, the slot on the team page and in the calendar
   (through `event_series`), **Close ground** on a venue for a date →
   `call_off_day` by venue id, events and fixtures, one message.
8. **0244 Game day (item 9):** the President's **Saturday** view (every
   game today by ground, call-offs, missing managers, roster gaps, results),
   MiniRoos default (no scores or ladder for U6–U11 club events: `live_tick`
   lines, results lists, share cards, `division_table`), results posted to
   the team chat by `set_event_result`, "Submit your Dribl team sheet" to
   managers the evening before.
9. **0245 Volunteers (item 10):** club rosters per ground per Saturday
   (extend `event_jobs` to a venue-day), team duty rosters with fair
   rotation, swap requests and reminders, the Volunteer coordinator's gaps
   view and targeted ask.
10. **0246 Safety (item 11):** `clearance_kind` gains `accreditation`
    (with expiry), reminders 30 days out to the person and the club,
    expired staff flagged and removed from coaching children until renewed,
    **incident reports** (who, what, when, first aid) to the Welfare
    officer and President only, the officer's contact in every family's
    Settings, "Welfare" in the UI.
11. **Demo — Inner West FC (item 14):** a seed built on the scale tooling
    (local first), then on dev at the brief's size; ten demo logins; the
    10-minute walkthrough in `docs/DEMO.md`.
12. **Definition of done:** the role suites (each role its job and nothing
    more; coordinators and managers scoped; the Treasurer never medical;
    incident reports to two people; parents cannot send notices; MiniRoos
    hidden; the log records every admin change), Homes screenshotted at
    375px light/dark and admin screens at laptop width, "Message the club"
    to 2,000 on the local big dataset. **No deploy until then.**

Phase 2 (plan only) is written into `BUILD_PLAN.md` item 11.
