# Squadroom Build Plan: the Dribl + WhatsApp combination
*Written 26 Oct 2026 from the repo as it stands (commits to "Sibling discounts and instalments", migrations to 0102).
Companion to `docs/SQUADROOM_SPEC.md` (feature IDs) and `docs/DRIBL_INTEL.md` (research). Claude Code: work through this top to bottom.*

---

## 0. The vision in one paragraph
Parents and coaches open one app that **feels like WhatsApp**: chats, announcements, photos, voice notes, reactions, instant. Underneath, it **knows what Dribl knows**: who's in which squad, every fixture and change, who's available, results, ladders and stats. On top of that, it does the academy jobs neither of them does: registration and payments, child-safe messaging, training, attendance and tournaments. Every real thing (a fixture, a poll, a payment, a result, a registration) is a proper record that **shows up in chat as a card**. Nothing important gets lost in scrolling.

### The two weeks that define "done"
**A parent's week (two kids, U9 and U11):**
1. Monday: the Home screen shows "Needs you: 2". One is an RSVP for Saturday and one is a term-fee instalment. Both are done in two taps each, without opening a chat.
2. Tuesday: training is cancelled for wet weather. One push notification; the chat card goes grey; their phone calendar updates itself.
3. Thursday: the coach posts an announcement. It reads "Seen by 41/56", and the parent gets one nudge because they hadn't opened it.
4. Friday 3pm: the Dribl draw changes. "⚠️ U11 Navy now 10:15, Field 3" lands in the U11 chat automatically.
5. Saturday: live score taps come through as goals go in. After the game, a Player of the Match card for their kid is posted in chat, ready to share to Instagram.
6. Sunday: they check the U9 ladder and their son's season stats on his player card.

**A coach's week:**
1. They see the availability grid for Saturday: 11 available, 2 can't play (with reasons), 1 hasn't answered. They nudge that one with a single tap.
2. They pick the squad from availability, and the selected families are notified with meet time and kit.
3. They take attendance at training in 20 seconds.
4. On match day: a checklist ("Submit your Dribl team sheet") and live score entry.
5. They never see a parent's medical history, but they *do* see "EpiPen in the bag".
6. They can't privately message a child alone. Any private chat with a child brings the parents in.

---

## 1. Where Squadroom is today
**Built and proven by tests:**
- Multi-organisation tenancy with an organisation switcher
- Chat: channels, hosts, posting modes, reactions, pins, edit/delete, photos and PDFs, event and poll cards, search
- DMs under a safeguarding policy
- Events with RSVPs, reminders, unmutable cancellation and moved-game alerts
- Recurring training, attendance, join codes, the calendar feed
- Dribl spreadsheet import and the screenshot reader
- Registration: programs, the approval queue, consents, jersey pool, household dedupe, medical with coach alerts, roster import, public-name controls
- Sibling discounts and instalments
- Tournaments and league draws across organisations; public competition pages
- A demo walkthrough (`docs/DEMO.md`, `smoke-demo.mjs`)

**Built but never proven in the real world:** push (0 registered devices), payments (no Stripe key, 0 payments), the native app (never compiled).

**Blocked right now:**
- **S-01** (no private chat alone with a child): migration 0076 is written but not applied. Claude Code lost its database connection.
- **X-18**: live chat drops about 1 message in 5. The broadcast fix (0088) is waiting on a Supabase Realtime project setting.

**Stale statuses to correct in the spec:** E-07 (attendance is done, see X-19), X-13 (venue/day call-off is done, 0101), B-02/B-03 (instalments and siblings are done, 0102), E-04.

---

## 2. Milestones
Each milestone is one Claude Code run with plan mode on. It ends with tests passing, a 375px light/dark walkthrough as a parent **and** as a coach, spec statuses updated, `DEMO.md` updated, and a push to GitHub. Estimates are in Claude Code sessions (one session ≈ one evening).

### M0: Make what exists real (1–2 sessions) ← START HERE
Nothing after this matters if chat drops messages, push never reaches a phone, and payments have never run.

| # | Task | Detail | Done when |
|---|---|---|---|
| 0.1 | Restore the database connection | Joey runs `npm run db:setup` (or `npx supabase login` then `npx supabase link --project-ref rnykncrdcywmetuvslvw`). Claude Code says exactly what to paste. **squadroom-dev only.** | Claude Code can apply migrations |
| 0.2 | Apply 0076 (S-01) | Then run `test-minor-dms.mjs`, `test-dms-and-approval.mjs` and `test-rls.sql` | All green |
| 0.3 | Fix X-18, the lost chat messages | Joey changes the Supabase Realtime setting that Claude Code identifies (private-channel authorisation). Wire `useChannelMessages` to prefer broadcast and fall back to postgres_changes. Add a reconnect + catch-up fetch (anything newer than the last seen message) on focus/reconnect, so a missed event can never stay missed | `test-chat` realtime step passes 20/20 runs |
| 0.4 | Payments in Stripe test mode | Joey adds Stripe **test** keys + webhook secret to `.env.local` and Netlify. Connect a test Express account for NRIFA. Pay a payment request, a registration and an instalment with test cards, including one that fails and is retried | Rows marked paid **by the webhook**, with the right amounts in cents |
| 0.5 | Push on a real phone | Joey installs the PWA from squadroom-dev.netlify.app on his iPhone (Add to Home Screen) and allows notifications. Test a message, an announcement, a cancellation (bypassing quiet hours) and a moved fixture | 4/4 arrive within ~5s; `push_subscriptions` > 0 |
| 0.6 | One test command | `npm run test:all` runs every `scripts/test-*.mjs` + `test-rls.sql` and prints a pass/fail table | One command shows the health of the whole app |
| 0.7 | Spec hygiene | Fix the stale statuses listed in Section 1 | Spec matches the code |

### M1: Registration complete (2–3 sessions)
**Goal:** a stranger finds NRIFA, registers two kids, pays, and is placed in squads with no admin typing.

| ID | Task | Detail |
|---|---|---|
| G-02 | Public academy page `/{slug}` | Crest, colours, about, a program card for each open program (price, age, spots left), Register button, link to the public draw. No public feed |
| R-02 | Register flow `/{slug}/register` | Three steps with a progress bar: **1 Who's playing** (pick existing kids or add new; dedupe prompt) → **2 Details & consents** (profile, emergency contacts, medical, kit sizes, program questions, consents) → **3 Pay** (Apple Pay/Google Pay first). Resumable draft if they drop off |
| R-03 | Self-serve identity | Phone OTP for this path only (Twilio Verify is already in env). Invited families keep the coach-approval link. Update CLAUDE.md D-1 |
| R-04 | Several children, one checkout | One Stripe Checkout with a line item per child; sibling discount applied; instalment option shown |
| B-01 | Pay at registration | Registration → payment → webhook → status `pending` (or `waitlisted`). "Pay later" if the program allows it |
| R-05 | Kit sizes | Shirt/shorts/socks per player; feeds the kit export |
| R-07 | Bulk approve | Select many → assign team → approve. Guardians follow into channels (0098) |
| R-08 | Team fields | Capacity, coach/manager, kit colours, `external_team_id` (Dribl name), "don't import" flag |
| R-09 | Kit export | CSV/XLSX per season: name, squad, number, sizes. Ready for a kit order |
| R-11 | Program questions UI | Builder in `/admin/programs/[id]` (text, select, yes/no, date, file); answers shown in the queue |
| R-17 | Settings → My family | Each child: profile, medical, emergency contacts, consents (view/withdraw), kit sizes, number, squads. Given an ID on 29 Oct: it was only ever a dash in this table, which is how it stayed unbuilt while every field behind it got built |
| — | Merch / kit add-ons | Optional purchasable items at checkout (a training top, a spare pair of socks), as extra line items on the same session. Distinct from R-05 kit *sizes*, which exist only so a club can place an order offline |

**Acceptance (29 Oct brief), in Stripe test mode at 375px:**
1. A brand-new family finds the academy's **public page** and registers **two
   kids into different programs**.
2. They answer the program questions, accept the consents, enter kit sizes,
   and pay in **one checkout** — with the sibling discount **and** an
   instalment plan.
3. They are approved into two squads; **jersey numbers are allocated with no
   clashes** (the pool is per season across the academy, so a U10 filling in
   for the U11s cannot collide).
4. They land in **both team chats** (guardians follow the child, 0098).
5. Later they **withdraw one child before the cut-off and get a partial
   refund** — which needs a refund to be *issuable* from Squadroom, not just
   recordable (see B-04).

### M2: Safeguarding & trust (1–2 sessions)
| ID | Task | Detail |
|---|---|---|
| S-02 | Report a message | Long-press → Report (reason). New role flag `safeguarding_officer`. Report queue in Admin with hide/keep/escalate actions. Audit log of every action. The reporter's identity is visible only to the officer |
| S-03 | WWCC | Fields: number, expiry, verified_by, verified_at, a link to the OCG portal. A coach can't be added to a channel with players until verified. Alerts 60/30/7 days before expiry. Admin → Compliance list |
| S-06 | Player accounts (13+) | Optional per academy. Team and announcement channels only, always linked to a guardian; 0076 rules apply |
| S-04 | Photo consent | When posting a photo, show a warning if the channel has a child without photo consent ("2 players in this squad have no photo consent") |
| S-05 | Privacy basics | Settings → My data: export (JSON/PDF) and delete-my-account (with a 30-day hold). A child-friendly privacy page. Collect only what's needed. Flag for legal review |

### M3: The WhatsApp feel (2–3 sessions)
**Goal:** parents would rather be in Squadroom than in WhatsApp.

| ID | Task | Detail |
|---|---|---|
| C-01 | "Seen by 41/56" | On announcements and host messages, worked out from `last_read_at`. Tap for the seen/not-seen lists. **Nudge unread** button (one push; rate-limited) |
| C-02 | Member labels | Under each sender name: "Anna's Dad · U9 Navy", "Coach", "Manager", generated from roster links |
| E-02 | "Can't play" with a reason | Rename No → Can't play; reason required (quick chips: Sick / Injured / Away / Other + text). Coach sees it on the roster and in the grid |
| E-03 | Chase non-responders | "12 haven't answered" → one tap sends a nudge; automatic nudge 48h before (academy setting) |
| E-04 + Home | "Needs you" strip and family view | At the top of Home: RSVPs due · payments due · forms/consents due · approvals (staff). Child chips filter Home and Fixtures by kid, with a colour per child. Each child's next-game card shows their last result |
| C-03 | @mentions | Autocomplete from channel members; a mention notifies even in a muted channel; @everyone for hosts only |
| C-05 | Voice notes + video | Hold to record (max 2 min), waveform playback. Video up to ~60s, compressed client-side, thumbnail. Storage rules as for photos |
| C-04 | Scheduled messages | "Send Thursday 7pm". Shown as scheduled to the sender, with edit/cancel |
| C-06 | Threads on announcements | Replies collapse under the announcement ("8 replies") and don't notify the whole channel |
| C-07 | Digest | Non-urgent pushes batched (e.g. "5 new messages in U9 Navy"). Urgent ones (cancellations, mentions, announcements) are never batched |
| — | Small polish | Link previews; tap an address to open maps; "typing…"; message delivery ticks; swipe to reply |

### M4: The Dribl side — fixtures, availability, squad (2 sessions)
| ID | Task | Detail |
|---|---|---|
| F-02 | Club-wide draw | Fixtures tab toggle: My teams / Whole club. Saturday and Sunday tabs, team filter chips. **Public share link** (replaces the fixturefeed site). Shareable weekend graphic |
| F-03 | Import diff preview | Before confirming a Dribl export: "3 moved · 1 new · 1 removed · 40 unchanged", each with old → new. Moved games fire the existing alerts |
| F-04 | Retire fixturefeed | Once Joey has club-admin export access, the weekly routine becomes export → drop into `/admin/import` on Fri 3pm and Sat/Sun morning. Saved column mapping so it's one click. Push to admins if no import has happened by Friday 4pm |
| F-05 | Results/ladders import | If the export has scores, fill in results; show Table/Form for official comps |
| E-05 | Availability grid | Players × next 4 events, colour-coded, tap a cell to see the reason |
| E-06 | Squad selection | Pick from the available players → positions (optional), meet time, kit → "Selected" push to those families; "Not selected this week" handled gently |
| E-08 | Venues table | Maps link, parking, field map photo, toilets/canteen notes; reused by events and competitions |
| E-01b | Edit one occurrence | Change a single training session's time/venue without breaking the series |
| F-07 | Match-day checklist | Push to the manager 60 min before kick-off: "Submit the team sheet in Dribl (fines apply)" with a deep link; tick-off list |

### M5: Match centre & stats (2–3 sessions)
**Goal:** what Dribl's app shows the public, but live, and for juniors too.

| ID | Task | Detail |
|---|---|---|
| X-05 | Match centre (event detail becomes tabs) | **Overview** (time, venue + directions, kit, arrive-by, weather) · **Availability** (staff) · **Lineup** (formation picker, private to the academy) · **Live/Result** (score, timeline, scorers, cards, Player of the Match, photos) · **Table/Form** (competition or imported ladder) |
| X-01 | Live score taps | Manager mode: big +1 buttons per team, goal → scorer/assist picker, cards, half time / full time. Each event posts a compact live card to the team channel + push to followers. Undo within 60s |
| X-02 | Junior stats | Appearances (from attendance/selection), goals, assists, Player of the Match, minutes (optional). Season totals + history across seasons |
| X-03 | Player of the Match | Coach picks; optional parent/player vote (closes 24h after the game). A celebration card in chat with photo and sponsor slot |
| X-06 | Player card | Photo, squad, number, season stats, Player of the Match count. It's also the academy member card |
| X-04 | Share cards | Generated images in academy colours: result, Player of the Match, weekend fixtures (port fixturefeed's card generator). Share to Instagram/WhatsApp. Respects photo consent and public-name settings |
| X-07 | Academy table | All squads' results this season on one screen |
| X-11 | Parent pulse | After the game: "How was today?" (😀😐🙁 + optional note), seen only by coaches |

### M6: Money and the season cycle (2 sessions)
| ID | Task | Detail |
|---|---|---|
| B-02b | Recurring term fees | Stripe subscription or scheduled charges per term; failed-payment retry and a parent "Update card" link |
| B-04 / R-15 | Refunds & withdrawals | Withdraw before the cut-off → full/partial refund (admin fee) through Stripe; after the cut-off, admin discretion. Overdue reminders at 3/7/14 days |
| B-05 | Finance export | Paid/outstanding by program/team/family; Stripe payout reconciliation; CSV |
| — | Promo codes | Per program, % or $, limited uses and expiry |
| R-13 | Trials → offer | Trial registration (free or paid) → trial event → coach marks Offer/Waitlist/No → offer email/push with a pay link that expires |
| R-12 | Season rollover | Clone teams → move everyone up an age group → keep numbers where possible → re-registration invites prefilled → report on who hasn't re-registered |
| R-14 | Official rego status | Per player: PlayFootball done/pending, manual or via import; reminders to pending families before round 1 |

### M7: Native app, offline, reliability (2–3 sessions; needs Joey's Apple account)
| ID | Task | Detail |
|---|---|---|
| G-04 | iOS + Android builds | `npx cap add ios/android`, icons/splash in academy-neutral Squadroom branding, APNs/FCM keys, deep links (`/join`, `/chat/…`, `/calendar/…`), TestFlight then App Store review notes (push, contacts, camera = not a "web wrapper") |
| C-10 | **Contacts like WhatsApp** | Filed as C-10, not C-09 — C-09 is already club-wide search (0130, built). Native, via the Capacitor contacts plugin: an explanation screen → the permission request → read contacts and normalise to E.164 **on the device**. Match on the device against directory numbers this user is **already** allowed to see, so `member_directory` and `directory_visibility` stay the only rule about who can see a phone number. **Contacts and hashes are NEVER sent to the server** — not even hashed, because a hashed phone number is a reversible phone number: the space is ten digits. Team → People shows matched members as "In your phone as &lt;name&gt;", with squad and role, sorted first. "Invite from contacts" opens the user's **own** SMS or WhatsApp with the join link or code; nothing is created until they join and a coach approves. Web/PWA keeps the picker and manual add, plus an iPhone hint: "Get the app to see your contacts here". Settings: a contact-matching toggle and "Forget contact names". **Test proves no network request ever carries contact data**, and that matching respects `directory_visibility` |
| X-09 | Offline match day | Cache the schedule, rosters, player cards, venue and medical *alerts* (not histories). Queue RSVPs, attendance and score taps; sync on reconnect; an "offline" banner |
| X-10 | Accessibility | Dynamic Type, VoiceOver labels, contrast in both themes, 44px tap targets; strings extracted for translation |
| — | Reliability | Error monitoring (e.g. Sentry); uptime check; a nightly `smoke-demo` against dev; rate limits on every public endpoint |

### M8: SaaS — the second academy (2 sessions + Joey's admin work)
| ID | Task | Detail |
|---|---|---|
| — | Production Supabase project | New project in Sydney; apply migrations from scratch; separate Netlify env; a promotion script dev → prod for migrations only, **never data** |
| G-01 | Self-serve onboarding | `/start`: name, crest, colours → create squads → import the roster → invite coaches → first program. Timed: under 30 minutes |
| B-06 | Squadroom billing | Plans by team count via Stripe Billing on a **separate code path** from academy collections. Free trial. Parents never pay Squadroom |
| G-03 | Support | In-app "Help" → a support channel to Squadroom staff; status page |
| X-08 | Sponsor slots | The academy uploads sponsor logos; slots on the match centre, Player of the Match and share cards; simple impressions count |
| F-06 | Squadi adapter | Fixture import mapping for QLD/WA/Northern NSW exports |
| S-05 | Legal | Privacy lawyer review (Children's Online Privacy Code, Child Safe Standards); terms for academies; data processing terms |

---

### M9: League mode — run a competition without Dribl (4–6 sessions)

**Goal:** the Sydney Premier League runs an entire season in Squadroom and
never opens Dribl. Six age groups, eight clubs, home and away, referees
appointed and paid, cards accumulating into suspensions, a washout
rescheduled in one tap, ladders into finals, and a public match centre
anybody can share.

**Why this is the biggest thing left, and why now.** Everything else in this
plan makes Squadroom a better app *alongside* Dribl. This is the one
milestone that makes a league able to leave. SPL is the first target because
its software choice is one we can influence, and a league that switches
brings every club, coach and parent in it.

**What this does NOT do, and must never claim to.** Official PlayFootball
registration stays out of scope — Football NSW mandates it for eligibility,
insurance and age verification, and the failure mode is a child being
ineligible on a Saturday. Squadroom runs the *competition*; PlayFootball
still registers the *player*. R-14 tracks that status and no more.

| ID | Task | Detail |
|---|---|---|
| L-01 | League setup | Seasons, age groups, divisions, grading. **Settings are per division, not per league**, because a league that is relaxed about U8 scores is not relaxed about Premier: public-or-hidden scores, ladder on/off, 3/1/0, tie-break order, match length, squad size |
| L-02 | Club entry + league fees | A club enters teams, nominates squads, and pays the **league** through Stripe Connect — to the league's connected account, the same direct-charge path academies already use. Coach and manager contacts captured at entry. A club that has not signed up is still a name on the draw (`competition_entries.team_id` is already nullable) |
| L-03 | Squads and eligibility | Season squad lists per entry. Playing-up and borrowing rules as data, not custom. **An eligibility check runs before a sheet can be submitted** — this is the whole point: ineligible-player disputes are what leagues spend their Mondays on |
| L-04 | Player cards | Photo cards as match-day ID, printable and on screen. Reuses X-06 and honours R-16: a league we run never publishes a visiting club's children |
| L-05 | Match sheets | Both teams submit a side pre-kick-off (numbers, keeper, captain); the opposition **confirms**. Goals, assists, yellow/red/blue cards, subs. **Both teams enter the score and a mismatch is a dispute, not an average** — never silently resolved. Full audit trail of who typed what and when |
| L-06 | Referees | A pool, availability and block-outs, appointments with accept/decline and a push, match-day check-in, referee report |
| L-07 | Referee payments | Match fees, a payment run, and an export. Referees are paid *by the league*, so this rides L-02's account, not a club's |
| L-08 | Discipline | Season card accumulation with **configurable** thresholds (they differ by league and change between seasons). A red card is an automatic suspension, and **a suspended player is blocked from the sheet** — a suspension nothing enforces is a note in a minute book. Tribunal and appeal notes; discipline report |
| L-09 | Match-day operations | Washouts by ground or by day in one tap (X-13 already does this for an academy; this does it for a league), forfeits, postponements, rescheduling, byes. **Every change pushes into the affected clubs' team chats** through the existing 0064 trigger, so the reason travels with it |
| L-10 | Ladders and finals | Point adjustments **with a reason attached**, forfeit scoring, finals seeded from the ladder. Ladders stay computed, not stored |
| L-11 | League communication | Announcements to club admins, managers and coaches across the league — **never to other clubs' families.** "See the draw, not each other's people" is the rule that must not be blurred, and this is the feature most likely to blur it |
| L-12 | Public match centre | Fixtures, results, ladders, top scorers. Shareable link, embeddable widget, and it honours each club's own privacy settings. Cached — it is the one page a hundred people open at 9am |
| L-13 | League roles | League admin, competition manager, referee coordinator, discipline officer, ground manager |
| L-14 | Switching from Dribl | Import a league's teams, squads and fixtures from Dribl exports. The `/admin/import` mapper is reused again, not copied |
| L-15 | Reports | Results, ladders, discipline, referee payments, team entries |
| L-16 | Tournament entry | External teams register and pay through the **same registration engine** as a family does. A tournament entry is a registration whose subject is a team |

**Acceptance — `scripts/test-league-season.mjs`:** a simulated SPL season. Six
age groups, eight clubs, home and away across real venues. Referees
appointed and checked in. Sheets submitted, confirmed, completed. A red card
that suspends a player and **blocks them from next week's sheet**. A washout
that reschedules a round and notifies every affected chat. Ladders, then
finals. The public match centre shows all of it. `smoke-demo` covers four
people: league admin, club manager, referee and parent.

---

## 3. How the screens fit (keep the 5 tabs)
| Tab | What it becomes |
|---|---|
| **Home** | "Needs you" strip → child chips → this week's events (RSVP inline, last result) → chats with unread counts |
| **Chat** | WhatsApp-grade chat + cards (events, polls, payments, live scores, Player of the Match, registrations) + Seen by + threads |
| **Fixtures** | My teams / Whole club · Sat/Sun · match centre per event · ladders |
| **Team** | Squad (player cards, numbers) · People (directory) · Stats (leaders) |
| **Admin** | Grouped: **People** (members, invites, requests, registrations, compliance) · **Teams & programs** (teams, programs, numbers, kit export, rollover) · **Fixtures** (import, competitions, venues) · **Money** (payments, outstanding, refunds, exports) · **Academy** (settings, branding, sponsors, safeguarding reports) |
| *Settings (gear)* | Profile · My family · Notifications · Calendar feed · My data |
| *Public* | `/{slug}` academy page · `/{slug}/register` · public draw · `/c/[slug]` competitions |

Look and feel: keep the current design language (navy bar, academy `--brand`, cards, eyebrows, pills, sheets, dark mode). No new design system.

---

## 4. How each Claude Code session should run
1. Start in plan mode: "Do milestone Mx, items …". Approve the plan.
2. For every feature, in this order:
   - SQL migration
   - RLS policies plus `test-rls.sql` assertions
   - a feature test script
   - the thin page plus a client component
   - a 375px light/dark check
   - commit
3. End of milestone:
   - `npm run test:all` is green
   - `smoke-demo.mjs` reports 0 blockers
   - spec statuses and DEMO.md are updated
   - push to GitHub
   - a report listing anything that needs Joey
4. Rules that never change:
   - squadroom-dev only
   - CLAUDE.md decisions win
   - Squadroom never charges parents
   - children never alone with an adult in a private chat
   - no address-book uploads

---

## 5. Joey's to-do list (things Claude Code can't do)
| When | Task |
|---|---|
| M0 | Run `npm run db:setup` / Supabase login when asked · change the Realtime setting for X-18 · add Stripe **test** keys · install the PWA on your iPhone and allow notifications |
| M1 | Twilio account for phone OTP (dev can use Supabase test numbers) |
| M4 | Ask the SPL/FNSW admin for **club-admin access** to NRIFA's teams in Dribl (the club-wide Events export) |
| M7 | Apple Developer account (US$99/yr) + Xcode installed · Google Play developer account (US$25 one-off) |
| M8 | Stripe live keys + business details · privacy lawyer review · choose plan prices (benchmarks in DRIBL_INTEL.md §5) |

---

## 6. Order at a glance

**Revised 29 Oct 2026.** M0 and M2 are done; M1, M4 and M5 are largely done.
Nothing has been dropped — M9 and C-10 are *added*.

1. **M1 + M6 together — registration and the money that goes with it.** They
   are one job, not two: a sibling discount, an instalment plan and a refund
   are all the same checkout seen at different moments, and building the form
   now and the money later means building the checkout twice. **Eight of these
   items are blocked on a free Stripe test key** (NIGHT_LOG, NEEDS JOEY #1).
2. **M9 League mode.** The one milestone that lets a league leave Dribl.
3. **M7 native, pulled forward** from its old slot. Both C-10 contacts and
   reliable iPhone push need a real build, so it gates more than it looks
   like it does. Needs Joey's Apple account.
4. **M3 the WhatsApp feel.**
5. The rest of **M4 / M5**.
6. **M8 SaaS.**

Original order, for reference: M0 → M1 → M2 → M3 → M4 → M5 → M6 → M7 → M8.
Roughly 15–20 sessions, plus 4–6 for M9.
