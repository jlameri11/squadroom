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
  groups and the "Academy vs league organiser" brief. Not started. The audit
  (what exists, what is a gap) is the first step and goes here when done.
