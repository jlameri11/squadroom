# Simplicity — every feature, its switch, who sees it, the taps

Kept because Joey asked for it (10 Nov 2026) and because "simplicity beats
features every time" (Big Club Mode). After the Season 4 simulation and real
testing, Joey decides which switches default OFF. Until then **every switch
is ON in the demo** so everything can be tested.

## The brief (Joey, 10 Nov 2026), verbatim

> FEATURE SWITCHES (Joey, 10 Nov) — keep building everything as briefed (Parts A, B, C, registration). We'll filter after testing.
>
> 1. Every feature that isn't core gets an on/off switch in Settings → Features (club or league level), with a one-line description. Built and tested, but easy to hide later.
>    CORE (no switch): chat + notices, fixtures + availability, team sheets + match sheets, registration + payments, roles, safeguarding, branding, offline scores, "Message the club".
>    SWITCHABLE: everything else — e.g. Player of the Match, sponsors, Fixture Flowing, player stats + development notes, referee self-appointment, referee pay tracker, training-ground slots, trial ratings, team duty rotation, Team Creator, blue cards, ladder breakdown, Find a club, card-fee pass-through, Active Kids vouchers, scheduled messages, digest.
> 2. When a switch is off, nothing about that feature appears anywhere (no empty tabs, buttons or settings rows).
> 3. For now, leave them all ON in the demo so we can test everything.
> 4. Keep docs/SIMPLICITY.md: every feature, its switch, which roles see it, taps for each role's top 3 jobs. After the Season 4 simulation and real testing, Joey decides which switches default OFF.
> Commit and push hourly.

## How the switches work (built 10 Nov 2026, 0242)

- `academy_features (academy_id, feature, enabled, changed_by, changed_at)`,
  one row per switched-off feature (absent = on, so a new feature is on
  everywhere until someone turns it off; the demo stays on). The keys are the
  table below's **Switch** column.
- `app_private.feature_on(p_academy, p_feature)` for the database (a function
  behind a switched-off feature refuses with a plain message); `useFeatures()`
  for the screens (a tab, button, card or settings row behind a switched-off
  feature is not rendered — not greyed, not empty).
- Settings → **Features**: owners, admins, President and Secretary (a league's
  staff for a league); each switch with its one line; the activity log
  records every flip.
- A feature built from now arrives with its switch and its row below.
- **Gated so far (10 Nov):** kit, sponsors, helpers, match_photos,
  match_video, development, digest, referee_pay, fixture_flowing,
  referee_self_appoint, scheduled_messages, scan. Still to gate among what
  exists: player_of_match (the pick lives on the game's stats), polls (the
  composer's poll form), respect_marks (the match sheet and the referee's
  report), kit's order list. The "to come" rows are gated as they are built.

## Core (no switch)

Chat and notices · fixtures and availability · team sheets and match sheets ·
registration and payments · roles · safeguarding · branding · offline scores ·
"Message the club".

## Switchable features

| Feature | Switch | Who sees it when on | Where |
|---|---|---|---|
| Registrations spreadsheet (0259) | `registrations_csv` | the club's staff and its Registrar | Admin → Registrations → "Download the spreadsheet" (`/api/export/registrations?academyId=…[&programId=…]`: one row per request, the child, guardian, program, status, PlayFootball ids, squad, consents, and a column per question headed by its label) |
| Bans (0257) | `bans` | the club's staff, President and Welfare officer; the league's staff, competition manager and discipline officer; the banned person sees their own | Admin → Welfare → Bans (ban a member, a player or a name; a reason, until a date or until lifted; lift with a note); the league's Discipline tab → Bans; the refusals themselves ("no answer while banned until 18 Nov — …") |
| Role requests (0256) | `role_requests` | every member asks; owners, admins, President, Secretary decide (coordinators inside their age groups; committee seats the owner or President only) | Settings → "Request a role" (a sheet: the role, the squads, a note; your requests with their state); Admin → Requests (Approve / Decline with a note, "waiting on WWCC"); Club HQ's "Needs a decision" counts them |
| Player of the Match | `player_of_match` | the squad's coach picks; the squad's families see | the game page, the team chat |
| Sponsors | `sponsors` | staff manage; everyone sees on the match centre and share cards | Admin → Sponsors, `/c/{slug}` |
| Fixture Flowing | `fixture_flowing` | the league; home clubs in the window | the competition's Run tab |
| Player stats and development notes | `development` | the squad's coaches and club staff write; a family reads what is shared | the player card |
| Referee self-appointment | `referee_self_appoint` | the league's referees | the referee's own screens |
| Referee pay tracker | `referee_pay` | the league's treasurer | the competition's Referees tab |
| Training-ground slots (0250) | `training_slots` | coaches and staff put a squad's weekly training on a pitch; everyone sees the slot | Add training (a pitch instead of a typed ground), the team page's Training line, the ground's week on Admin → Venues |
| Trial ratings and grading (0249) | `trial_ratings` | the coaches at a trial rate; owners, admins and coordinators place and publish | the trial program's screen (Grading: ratings, notes, a squad per player, Publish teams) |
| Team duty rotation (0252) | `duty_roster` | the squad's coach or manager rosters; families see their turn and ask for swaps | the team page (Duties), the game page (Duties), Admin → Rosters |
| Team Creator (0261) | `team_creator` | anyone on the public enter page may tick "I'm a captain"; the organiser accepts; adults join by the code | `/c/{slug}/enter` (the captain's tick: how many players, who pays); the organiser's Clubs tab (the request marked captain's team; after acceptance the code and the join link to copy); `/c/{slug}/team/{code}` (name, mobile, email, date of birth — adults only; the first with the request's mobile or email is the captain); the team's page in the organiser's organisation ("Your team's code"); split pays as one fee per player in the app, captain pays the organiser who marks it |
| Registration photo (0263) | club setting `photo_required` (Settings → Club; off = the photo is optional on the form) | families on the public form; the club's coaches, owner and Registrar until approval, then whoever may see the card | `/{slug}/register` step 2 (the rules, Add a photo, cropped on the phone); Admin → Registrations (the open request's photo); the card |
| Blue cards (sin bin) (0258) | `blue_cards` | a league that turns them on in its discipline rules (with the minutes off); the teams, the referee and the organiser record them | the match sheet's events (🟦 Blue with the minute shown and "back 33'"; refused without a minute, and anywhere the league does not use them); the Discipline tab's rules and report |
| Ladder breakdown (0260) | `ladder_breakdown` | anyone who sees the ladder: the competition's participants on its Ladder tab, anyone on the public match centre | tap a ladder row: a sheet with every game (score, result, the points the division gives, forfeits named), the league's adjustments with their reasons, and the sum the row shows; off, the rows are not tappable and both readers answer null |
| Find a club (0266) | `find_a_club` | the public; the club chooses to be listed and gives its suburb | `/clubs` (search by name or suburb; each card → Register and About the club); Settings → Club → Find a club (the suburb); a league's `/c/{slug}` lists its clubs |
| Card-fee pass-through (0270) | `card_fee_passthrough` | families, before paying; the club turns the setting on in Settings → Club (off by default there too) | the Payments row ("Card processing fee $2.39 … you pay $122.39"), the Pay now card, Checkout's own line, the receipt |
| Active & Creative Kids vouchers (0264) | `active_kids` | families on a child's fee (Payments) and on a pay-now registration's Pay now card, once the club says it is a provider in Settings → Club; the club's staff and its Treasurer redeem | Payments → "Use an Active & Creative Kids voucher" (the number, the child as on the voucher; $50 off); `/{slug}/register` after sending (the Pay now card); Admin → Payments → "Vouchers to redeem in Service NSW" with a Redeemed tick |
| Scheduled messages | `scheduled_messages` | anyone who may post | the composer's "Send later" |
| Digest | `digest` | everyone, in Settings | Settings → Notifications |
| Helpers wanted (G-07) | `helpers` | the squad's coach asks; families help | the game page; a ground's day with its own jobs seen from every game there, and Admin → Rosters (0252) |
| Game photos (M5) | `match_photos` | the squad's coach adds; the squad sees | the game page |
| Kit list | `kit` | staff | Admin → Kit list |
| Coaching accreditation (0253) | `accreditations` | owners and admins record; the person and the club are reminded | Admin → Checks (Coaching accreditation) |
| Game day (0251) | `game_day` | owners, admins, President, Secretary, coordinators | Admin → Game day (every game today by ground, with call-offs, live, results, squads short, nobody in charge, referees and sheets missing) |
| Club health (0247) | `club_health` | owners, admins, President, Secretary | Admin → Club health (families joined per squad, squads with nobody in front of them, checks running out, PlayFootball not done) |
| Game video (Matchdays) | `match_video` | the squad's coach adds; the squad sees | Fixtures → Matchdays |
| Respect marks (W-01) | `respect_marks` | managers and referees mark; the league's dashboard | the match page |
| Polls | `polls` | hosts post; members vote | the composer |
| Scan a draw (screenshots) | `scan` | coaches and families | Admin → Import, Settings |

(The table grows with every feature built; "to build" rows are the brief's.)

## Taps for each role's top three jobs (CLAUDE.md "Product direction"; proven by `scripts/test-role-nav.mjs`)

| Role | Job | Taps from Home |
|---|---|---|
| Parent | RSVP · team chat · pay | 1 (a row in Needs you) + 1 on the page |
| Coach | post · availability/squad · attendance | 1 (a tile) + 1 on the page |
| Owner / club admin | approve registrations · chase payments · message everyone | 1 (a tile) + 1 on the page |
| League organiser | change the draw / call off a day · appoint referees · resolve results | 1 (a tile) + 1 on the page |
| President (0237) | needs a decision · this weekend · money | 1 (a tile) + 1 on the page |
| Treasurer (0237) | who owes · collected · refunds | 1 (a tile) + 1 on the page |
| Registrar (0237) | registrations · PlayFootball not done · offers | 1 (a tile) + 1 on the page |
| Coordinator (0237) | my teams · this weekend · the coaches' room | 1 (a tile) + 1 on the page |
| Team manager (0237) | availability · team sheet · team chat | 1 (a tile) + 1 on the page |
| Welfare officer (0237) | reports · concerns · checks | 1 (a tile) + 1 on the page |
| Volunteer coordinator (0237) | this weekend's gaps · rosters · ask for help | 1 (a tile) + 1 on the page |
| Adult player (0238) | answer · team chat · pay | 1 (a row in Needs you) + 1 on the page |
