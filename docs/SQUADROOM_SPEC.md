# Squadroom — Spec v5: WhatsApp + Dribl, built on what exists

> **For Claude Code:** Read this, `docs/DRIBL_INTEL.md` and `CLAUDE.md`.
> **CLAUDE.md decisions win.** Where this spec changes one, it says so explicitly in Section 5 and asks you to update CLAUDE.md in the same commit.
> Audit date: 23 Oct 2026. It was taken from the schema (migrations 0001–0075), the commit history (69 commits, last on 8 Oct) and a scan of `app/`. Verify each claim as you go and correct this file where it's wrong.

---

## 1. Where Squadroom stands

### Already built (from code)
> **Built is not the same as proven.** Three rows below have never run once in
> the real world: push has **0 registered devices**, payments have taken **0
> payments** (no Stripe key), and the Capacitor shell has **never been
> compiled** (no Xcode). Treat them as written, not working.
| Area | What exists |
|---|---|
| Tenancy | Organisations (academy/club/school/league) isolated by RLS. Composite FKs, helpers in `app_private`, `test-rls.sql` with 23 assertions. Sydney region. |
| Roles | owner, admin, coach, parent, player |
| Onboarding | Academy invites and invite tree, team join links + QR, join requests with coach approval, bulk invite, contact picker, join-link abuse controls, magic-link sign-in |
| Teams & players | Teams (U5–U18, season, archive), players (name, DOB, notes), `player_guardians`, add players to squad, parent attached to player |
| Chat | Team / age-group / coaches / academy-wide / custom / direct channels. Posting modes: open, hosts_only, replies_only. Hosts and co-hosts, message approval queue, reactions, replies, pins, announcement flag, edit/delete (with archive), photo + PDF attachments, event cards, poll cards, search, realtime, read state, nav badges, contact sheet |
| Safeguarding | DM policy (staff_only by default), directory visibility (phones staff-only by default), deleted-message archive |
| Events | match / training / social / other, arrival time, kit colour, venue, opponent. RSVP yes/no/maybe with note, shown to coach on the roster. Reminders at 24h and 2h. Cancellation with reason (can't be muted; SMS inside 24h). Alerts when a game is moved. ICS per event + subscribable calendar feed |
| Polls | Simple + availability, multi-select, anonymous, close date, poll → fixture conversion |
| Fixture import | `/admin/import` XLSX/CSV importer for the Dribl Events export: flexible mapping, re-import updates existing games. `/scan` screenshot reader (Claude) |
| Tournaments | Competitions that span organisations, external teams, club invites, draw generation, run sheet, live ladders, finals, broadcast, modes |
| Payments | Stripe Connect Express with direct charges. Payment requests per player/team/competition. Webhook-only "paid". Squadroom never charges parents. **No Stripe key configured, so 0 payments have been taken** |
| Push | Web push, APNs, FCM, queue + database wake-up, quiet hours, per-type notification settings. **Never delivered to a real device — 0 push_subscriptions** |
| Native | Capacitor shell + adapters (contacts, camera, push). **Never compiled — `npx cap add ios` has not run** |
| Admin | Teams, members tree, invites, requests, payments, import, platform super-admin page, demo data |

**Verdict:** On comms, events and tournaments, Squadroom already does more than Dribl's app. The big missing piece is **registration** (your new requirement), followed by safeguarding hardening, academy billing and a few chat features.

### Operational risks to fix now
1. **The repo has no git remote. CONFIRMED 23 Oct 2026.** `git remote -v` is empty; 69 commits exist only on this
   laptop, and `~/Desktop/PROJECTS /squadroom` is a symlink to the same disk rather than a backup. `.env.local` is
   gitignored and has never been committed, so the repo is safe to push as-is. This outranks every feature below it.
2. The production Supabase project doesn't exist yet (dev only: `rnykncrdcywmetuvslvw`).
3. Launch is blocked on outside accounts: Stripe live keys, Apple Developer account + Xcode build, Twilio (prod only).
4. **The Supabase and Netlify MCP connections are down**, so migrations cannot be applied from a session — 0076 is
   written, reviewed and waiting. Reconnect with `/mcp`. Netlify deploys still work through the CLI.
5. **Seeded fixtures age out.** They are written relative to the day they are created, so a demo left for a month has
   an empty next-up list. Run `node scripts/refresh-demo.mjs` before showing anyone.
6. Realtime runs on `postgres_changes`. Switch to broadcast-from-trigger before roughly the 20th academy (already noted in CLAUDE.md).

---

## 2. Gap matrix (what to build)
**Priority:** P1 = before the NRIFA launch · P2 = before selling to other academies · P3 = later.
**Status:** MISSING / PARTIAL. Claude Code: confirm each one.

### A. Registration: teams and players (new requirement, top priority)
| ID | Feature | Status | Pri |
|---|---|---|---|
| R-01 | **Programs & products**: SPL squad, development, trials, holiday camp, term class, tournament entry, tour. Each has price, capacity, birth-year eligibility, open/close dates and a waitlist | **SCHEMA WRITTEN, NOT APPLIED** (0083). One table keyed by `kind`, not seven. Capacity and the waitlist are enforced by a trigger holding a lock on the program row, because two parents can tap Register in the same instant and only the database sees both | P1 |
| R-02 | **Public registration page** `/{slug}/register`: program → child(ren) → form → consents → pay (via existing Stripe Connect) → `pending` | MISSING | P1 |
| R-03 | **Self-serve identity**: phone OTP (or email link) *only* for public registration. Coach-approval join links stay as they are for invited families (see Section 5, D-1) | MISSING | P1 |
| R-04 | **Household**: one guardian registers several children in one checkout; invite a second guardian; dedupe on name + DOB | PARTIAL → `app_private.find_existing_player` **written, not applied** (0082), matching Dribl on name + gender + DOB. Deliberately not fuzzy: it returns a candidate for a human to confirm, because guessing attaches a stranger's child to a family | P1 |
| R-05 | **Player profile fields**: photo, gender, school, kit sizes (shirt/shorts/socks), FFA number, emergency contacts, medical notes (restricted column/table) | **WRITTEN, NOT APPLIED** (0082). Medical is a separate TABLE, visible to guardians and owners/admins — not coaches. One narrow exception: `coach_note`, surfaced through `team_coach_alerts(team)` so the coach at the ground learns about the EpiPen without the medical history. Kit sizes still to do | P1 |
| R-06 | **Consents**, versioned: code of conduct, photo/media, terms, privacy. Record who accepted, when, and which version | **WRITTEN, NOT APPLIED** (0084). A trigger refuses edits to text anybody has signed — versioning only works if something enforces it. Records the ANSWER, so a refusal of photo consent is kept as carefully as a yes. **No IP address and no user agent**: we would never use either, and they are personal information we would then be holding for nothing | P1 |
| R-07 | **Approval queue**: approve → assign to team, which adds the family to the team channels and calendar via existing triggers. Bulk approve; reject with a message | MISSING (join-request queue exists; reuse its UI) | P1 |
| R-08 | **Team registration fields**: capacity, coach/manager, kit colours (sky/navy), `external_team_id` for the Dribl name, a "don't import" flag (e.g. U7 Orange) | PARTIAL | P1 |
| R-09 | **Jersey numbers**: one pool per season across the academy; no clashes between adjacent age groups (players play up/down); suggest the nearest free number; kit list export with sizes | **WRITTEN, NOT APPLIED** (0085). Pool is `(academy_id, season)`, not per team: a U10 filling in for the U11s in 7 against an existing 7 is two sevens on the pitch and a match sheet that cannot say who scored. `next_squad_number` answers "10 is taken, 11 is free" rather than "no". Kit export still to do | P1 |
| R-10 | **Bulk player import** from CSV/XLSX, reusing the `/admin/import` mapping UI (currently fixtures only) | MISSING | P1 |
| R-11 | **Custom form fields** per program | **SCHEMA WRITTEN, NOT APPLIED** (0083) — `programs.questions` jsonb and `program_registrations.answers`. Free-form on purpose: what a tour must ask has nothing to do with what a trials day asks, and a column each is a migration every time somebody thinks of something. UI still to do | P2 |
| R-12 | **Season rollover**: clone teams, move everyone up an age group, prefilled re-registration invites, flag anyone who hasn't re-registered | PARTIAL (season archive exists) | P2 |
| R-13 | **Trials → offer → paid registration** | MISSING | P2 |
| R-14 | **Official PlayFootball rego status** per player (done/pending) with reminders. Squadroom never does official registration | MISSING | P2 |
| R-15 | Withdraw/deregister with full or partial refund before a cut-off | MISSING | P2 |
| R-16 | Hide a player's name or photo on public tournament pages | MISSING | P2 |

### B. Safeguarding & compliance
| ID | Feature | Status | Pri |
|---|---|---|---|
| S-01 | **A child is never alone with an adult in a private chat.** Written as `supabase/migrations/0076_a_child_is_never_alone_with_an_adult.sql` with `scripts/test-minor-dms.mjs` | **WRITTEN, NOT APPLIED** — reviewed and its column dependencies verified, but squadroom-dev has not received it: the Supabase connection is down (see Risks) | P1 |
| S-02 | **Report message** → Safeguarding Officer role, report queue, audit log | MISSING | P1 |
| S-03 | **WWCC**: number, expiry, verified-by and verified-at for every coach/admin. Coach role can't be granted until verified; alert 60 days before expiry. Manual verification via the OCG Employer Portal (no API) | MISSING | P1 |
| S-04 | Photo-consent warning before posting media of a player without consent (needs R-06) | MISSING | P2 |
| S-05 | **Children's Online Privacy Code** (due by 10 Dec 2026): guardian consent records, export/delete my data, child-friendly privacy notice, data minimisation. Get a legal review before the second academy | MISSING | P2 |
| S-06 | Player accounts (13+) restricted to team/announcement channels and always linked to a guardian | MISSING | P2 |

### C. Chat (close the gap with WhatsApp)
| ID | Feature | Status | Pri |
|---|---|---|---|
| C-01 | **"Seen by 41/56"** on announcements, from `channel_members.last_read_at`, plus a one-tap re-ping of unread members | MISSING | P1 |
| C-02 | **Automatic member labels** from roster links: "Anna's Dad · U9 Navy", "Coach", "Manager" | MISSING | P1 |
| C-03 | @mentions | MISSING | P2 |
| C-04 | Scheduled messages | MISSING | P2 |
| C-05 | Voice notes + short video | MISSING | P2 |
| C-06 | Threaded replies under announcements that don't notify the whole channel | PARTIAL (replies_only mode + reply_to) | P2 |
| C-07 | Notification digest (one summary push instead of many) | MISSING | P2 |
| C-08 | Mute per channel / filter per child in the UI | DONE (column + channel settings sheet) | — |

### D. Events & availability
| ID | Feature | Status | Pri |
|---|---|---|---|
| E-01 | **Recurring training series**: every Tue/Thu for a term; edit one or all | MISSING | **P1** |
| E-02 | **Reason required when RSVP = no**, labelled "Can't play" (already visible to coaches) | PARTIAL (a free-text note exists on the event screen; not required, not labelled) | P1 |
| E-03 | **Chase non-responders**: "12 haven't answered" → one-tap nudge, plus an optional automatic nudge 48h before | PARTIAL (reminders exist) | P1 |
| E-04 | **Family view**: all kids across teams (and later across academies) in one home feed, colour-coded per child | PARTIAL (home shows a row per child across the academy; no per-child colour or filter, no cross-academy) | P1 |
| E-05 | Availability grid for coaches (players × upcoming events) | MISSING | P2 |
| E-06 | Squad selection from availability → notify the selected players, with position/meet time/kit | MISSING | P2 |
| E-07 | One-tap attendance at training + attendance % | MISSING | P2 |
| E-08 | Venue directory (maps link, parking, field numbers) as a table instead of free text | PARTIAL (`venues` table exists for competitions) | P2 |

### E. Dribl / official fixtures
| ID | Feature | Status | Pri |
|---|---|---|---|
| F-01 | Dribl Events export importer | **DONE** | — |
| F-02 | **Club-wide draw view**: all teams, Saturday/Sunday tabs, filter by team, shareable public link. Replaces the fixturefeed site | PARTIAL (/calendar shows the club&rsquo;s fixtures to a coach; no day tabs, team filter or public link) | P1 |
| F-03 | Import diff preview: "3 games moved, 1 new, 1 removed" before confirming. Moved games already alert families via the 0064 trigger | PARTIAL | P1 |
| F-04 | Retire fixturefeed: once Joey has club-admin export access, the weekly routine becomes "export → drop into /admin/import" (Fri 3pm + Sat/Sun morning). Keep fixturefeed running until then | TODO | P1 |
| F-05 | Results/ladder import for official comps (if the export carries scores) | MISSING | P2 |
| F-06 | Provider adapter interface (Squadi for QLD/WA/Northern NSW) | MISSING | P3 |
| F-07 | Match-day checklist push to managers: "Submit your Dribl team sheet" (late sheets are fined $25) with a deep link | MISSING | P2 |

### F. Academy billing (on top of existing Connect)
| ID | Feature | Status | Pri |
|---|---|---|---|
| B-01 | Pay at registration (R-02) | MISSING | P1 |
| B-02 | Instalment plans + recurring term fees, with Stripe retry on failure | MISSING | P2 |
| B-03 | Sibling discounts, promo codes | MISSING | P2 |
| B-04 | Refunds (R-15) and overdue reminders | MISSING | P2 |
| B-05 | Finance export (paid/outstanding by program/team) | MISSING | P2 |
| B-06 | **Squadroom SaaS billing** (`academy_billing` exists): plan tiers by team count via Stripe Billing, on a code path completely separate from academy collections | PARTIAL | P2 |

### G. SaaS & growth
| ID | Feature | Status | Pri |
|---|---|---|---|
| G-01 | Self-serve academy onboarding under 30 minutes (`/start` exists?) | PARTIAL (/start exists; the 30-minute claim is untested) | P2 |
| G-02 | Public academy page: programs + Register button + public draw. No public social feed | MISSING | P2 |
| G-03 | In-app support contact | MISSING | P2 |
| G-04 | App Store / Play submission | BLOCKED on accounts | P2 |
| G-05 | Development: coach notes, termly reports, video clips (Analysis Pro link) | MISSING | P3 |
| G-06 | Match report and live score taps posted to the team channel | MISSING | P3 |
| G-07 | Volunteer/referee roster for tournaments | MISSING | P3 |

### H. Match centre, stats & engagement (from the final Dribl scan)
Dribl's weak spots here:
- **No live scoring:** match events appear only after the referee completes the match sheet.
- **Empty junior stats:** Football NSW records goals and subs only for senior grades, so junior player stats are blank.
- **Clunky following:** following a team takes about 7 taps.
- **No share graphics, no sponsor slots, English only, no declared accessibility features.**

| ID | Feature | Status | Pri |
|---|---|---|---|
| X-01 | **Live score taps** by the coach/manager (goal, scorer, assist, card), pushed to the team channel and followers as it happens | MISSING | P2 |
| X-02 | **Junior player stats** entered by the academy (appearances, goals, assists, Player of the Match, minutes) with season history per player | MISSING | P2 |
| X-03 | **Player of the Match**: the coach picks one (optional parent/player vote), posted as a celebration card in chat | MISSING | P2 |
| X-04 | **Share cards**: result, Player of the Match and weekend-fixtures graphics in academy colours, sized for Instagram/WhatsApp stories. Fixturefeed already makes these, so reuse that | MISSING | P2 |
| X-05 | **Match centre per event**, with tabs: Overview (time, venue + directions, kit, arrive-by) · Availability (staff) · Lineup (private to the academy) · Result (score, scorers, Player of the Match, photos) · Table/Form (from the competition or imported ladder) | PARTIAL (event detail exists) | P2 |
| X-06 | **Player card**: photo, squad, number, season stats. Also serves as the academy "member card" | MISSING | P2 |
| X-07 | **Academy-wide table**: all squads' results in one view (Dribl's club championship, but easy to find) | MISSING | P3 |
| X-08 | **Sponsor slots** the academy sells itself: banner on the match centre, sponsor on the Player of the Match card and share cards | MISSING | P3 |
| X-09 | **Offline match day**: cache the schedule, roster, player cards and venue; queue RSVPs and score taps until there's signal | MISSING | P2 |
| X-10 | **Accessibility + languages**: Dynamic Type/VoiceOver labels; strings ready for translation (Italian, Arabic, Chinese, Greek, Vietnamese are common among Sydney football families) | MISSING | P3 |
| X-11 | **Post-match parent pulse**: a one-tap "How was today?" that only coaches see | MISSING | P3 |
| X-12 | **Ground view for tournaments**: games by field/time for organisers on the day (Dribl added this in Apr 2025) | VERIFY (run sheet exists) | P3 |
| X-13 | **One-tap wet-weather call for a whole venue/day**: cancels every affected event across all squads, uses the existing cancellation push and SMS | PARTIAL (per event) | P1 |
| X-14 | **The draw builder double-booked fields across divisions.** `generate_fixtures` (0047) tracks which TEAMS are busy in a slot, never which FIELDS, and each call assumes it owns the fields it is handed. Drawing three age groups onto the same four fields — which is what a gala day *is* — produced three games kicking off on Field 1 at nine. Found while seeding the Spring Gala Day, worked around there by giving each division its own fields | **FIX WRITTEN, NOT APPLIED** (0081) | P0 |
| X-15 | **The draw builder could only build ONE DAY**, so Squadroom could run a tournament and not a league season — half of what Dribl is for. Pass 2 of 0047 walks consecutive slots from a single start time and places any game whose teams are free: there is no way to say "Round 1 this Sunday, Round 2 next Sunday", and greedy placement puts Round 1 and Round 2 games in the same slot. 0081 adds `p_round_every_days`, defaulting to 0 so a gala day draws exactly as before | **FIX WRITTEN, NOT APPLIED** (0081) | P0 |
| X-16 | **Organisation switcher.** One person can run a league and coach at a club — `academies` means ORGANISATION and a `league` row has existed since 0021 — but every screen resolved it with `my_first_academy()`, the alphabetically first, with no way to reach the other. 0080 parameterises `home_screen`/`chat_screen`/`fixtures_screen`/`nav_badges`; the choice lives in the browser (two tabs can be two organisations) and the server validates it against active membership | **WRITTEN, NOT APPLIED** (0080); UI shipped and hidden until then | P0 |
| X-17 | **The run sheet was unreadable for a season**: grouped by kick-off time with no date, so ten Sundays of a division rendered as ten sections all headed "9:00 am". Now grouped by round with the weekend beside it when a competition spans more than one day, keeping the time-slot run sheet for a one-day gala | DONE | P1 |

---

## 3. How it all ties together

### The core loop (one data spine, so nothing is entered twice)
```
REGISTRATION ──► PLAYER (+ guardians, consents, kit, number)
      │ pay (Stripe Connect)          │ approve → assign
      ▼                               ▼
  PAYMENTS ◄──── payment requests ─── TEAM ──► auto-joins: team channel, age-group, academy-wide
                                      │                 calendar feed, directory
                                      ▼
   EVENTS ◄── manual / recurring training / Dribl import / screenshot scan / tournament draw
      │  every create/change/cancel posts an EVENT CARD into the team channel + push
      ▼
   RSVP / AVAILABILITY ──► coach grid ──► squad selection ──► match centre
                                                               │
                                       live score taps ◄───────┘
                                              ▼
                     RESULT + STATS + PLAYER OF THE MATCH ──► celebration card in chat
                                              ▼
                                share card (Instagram/WhatsApp) + player card history
```
**Rule:** chat is where every object surfaces, but nothing *lives* in chat. Events, polls, payments, results and registrations are real records shown in the channel as cards. That's the "WhatsApp + Dribl" promise: WhatsApp's feel, with Dribl's structure underneath.

### Where each new feature lives (keep the 5 tabs; CLAUDE.md says "five destinations, and no more")
| Tab | Today | Add |
|---|---|---|
| **Home** | Upcoming 3 weeks + channels | A **"Needs you"** strip at the top: RSVPs due, payments due, forms/consents due, approvals (staff). **Child filter chips** when a family has more than one kid. **Last result** on each child's next-game card |
| **Chat** | Channels, cards, polls, search | "Seen by" on announcements, celebration/result cards, @mentions, voice notes |
| **Fixtures** | Calendar list + event detail | Event detail becomes the **match centre** (X-05). Club-wide draw toggle (F-02). Table/Form for imported comps |
| **Team** | Directory | Segmented control: **Squad** (players, numbers, player cards) · **People** (current directory) · **Stats** (leaders, Player of the Match tally) |
| **Admin** | Teams, members, invites, requests, payments, import | **Registrations** (queue) · **Programs** · **Players** (profiles, medical restricted, kit, numbers) · **Compliance** (WWCC) · **Sponsors** (P3). Group these into sections so the screen doesn't become a junk drawer |
| *Settings (gear)* | Profile, academy, calendar feed, push | **My family** (children's profiles, emergency contacts, consents, documents) · privacy: export/delete my data |
| *Public (no tabs)* | Join links, join competition | **/{slug}**: academy page + programs + Register · public draw · tournament live scoreboard |

### Look & feel (keep it; Joey likes it)
- Keep the prototype language: navy app bar, academy colour as `--brand`, white cards, eyebrow section labels, pills, date chips, sheets from the bottom, dark mode.
- New screens reuse the existing primitives (`AppBar`, `Screen`, `.card`, `.sect`, `.eyebrow`, `.pill`, `.chan`, `Sheet`). No new design system.
- Registration and the public page are the first screens a *stranger* sees, so they get the most polish: crest, academy colour, big program cards, a three-step progress bar, Apple Pay first.
- Check every new screen at 375px (iPhone SE) in light and dark, as the prototype asks.

---

## 4. Registration design notes (R-01 to R-10)
- **New tables** (all with `academy_id` + composite FKs, RLS, and `test-rls.sql` assertions added):
  - `programs`, `products` (type, price_cents, capacity, birth_year_min/max, opens_at, closes_at, waitlist)
  - `registrations` (status: draft|pending|approved|waitlisted|rejected|withdrawn; product_id, player_id, guardian_profile_id, answers jsonb, payment_id, official_rego_status, ffa_number)
  - `consent_versions`, `consent_acceptances`
  - `emergency_contacts`
  - `player_medical` (separate table, readable only by owner/admin and that team's coaches)
  - `kit_sizes` (or columns on players)
  - `jersey_numbers` (season, player_id, number, unique per pool rule)
- **Payment:** reuse `payment_requests`/`payments`. A registration creates a per-player payment, and the existing webhook remains the only thing that marks it paid.
- **Approval → team:** inserting `team_members`/guardian rows should fire the existing channel-sync triggers (0027), so chat and calendar membership follow automatically.
- **Age group:** computed from birth year and the season (configurable per academy). Show it; don't trust a typed value.
- **Jersey pool rule:** a number can't be reused within the same age group or between adjacent age groups in a season. Enforce it with a constraint or trigger, not just the UI.

---

## 5. Decision changes (update CLAUDE.md in the same PR)
- **D-1 Registration.** CLAUDE.md says "Dribl is the source of truth for registration… do not rebuild registration." Keep the reason (official FNSW eligibility stays in PlayFootball/Dribl) and narrow the rule:
  - **Squadroom does ACADEMY registration**: enrolment into programs/teams, details, consents and fees.
  - **It never does OFFICIAL registration**; it only tracks its status (R-14).
  - Public self-serve registration needs a verified identity, so add OTP for that path only. CLAUDE.md already says to "revisit before opening self-serve signup".
- **D-2 Dribl calendar sync.** CLAUDE.md says it "moved behind a paid tier". Dribl shipped Google/Outlook calendar sync in v4.1.7 on 19 Oct 2026 (matches only). Update the note. Squadroom's feed still wins because it covers training, socials and tournaments, per family.
- **D-3 Pricing.** Unchanged: Squadroom charges clubs, never parents. Competitor benchmarks for setting `academies.plan` tiers are in DRIBL_INTEL.md §5. Spond's parent-side fee model is the one we're deliberately *not* copying.

---

## 6. Build order
1. **Housekeeping:**
   - Push the repo to a private GitHub remote.
   - Update CLAUDE.md decisions D-1/D-2.
   - Verify every VERIFY item above and correct this file.
2. **Safeguarding first:**
   - Apply 0076 and run `test-minor-dms.mjs` + `test-rls.sql` (S-01).
   - Then S-02 and S-03. These are small and non-negotiable.
3. **Registration core:** R-01 → R-10, B-01, plus the Settings → My family screen.
4. **Engagement:** E-01, E-02, E-03, C-01, C-02, X-13, the Home "Needs you" strip + child chips, F-02, F-03, then the F-04 switchover.
5. **Match centre & stats:** X-05, X-01, X-02, X-03, X-06, X-04, X-09.
6. **Before the second academy:** the P2 items, the legal review (S-05), the prod Supabase project, Stripe live, the App Store build.

### Acceptance test for this round
A new family must be able to do all of this, end to end:
1. Open NRIFA's public register page and verify their phone.
2. Register two kids into SPL U9 and U11 and pay $X each.
3. Get approved and assigned (jersey numbers allocated without clashes).
4. Land in both team chats, with phone numbers hidden.
5. See both kids' recurring training and imported Dribl games in one feed and in their phone calendar.
6. RSVP "Can't play" with a reason the coach sees.
7. Get pushed when a Dribl re-import moves a game.

Also: a coach can't open a private DM with a player, and `test-rls.sql` passes with the new tables.

---

## 7. Kickoff prompt for Claude Code
```
Read CLAUDE.md, docs/SQUADROOM_SPEC.md and docs/DRIBL_INTEL.md. First, verify the
"Already built" table and every VERIFY/PARTIAL status in Section 2 against the code,
and correct the spec where it's wrong. Review migration 0076 and
scripts/test-minor-dms.mjs, apply 0076 to squadroom-dev only, run the test and
test-rls.sql, and fix anything that fails. Then propose updated CLAUDE.md wording for
decisions D-1 and D-2 and show me before committing. Then build in the Section 6
order. Keep the existing look (Section 3), plain SQL migrations, test-rls.sql after
every migration, thin pages, commit after each feature. Never touch any Supabase
project other than squadroom-dev.
```
