# Squadroom — Spec v5: WhatsApp + Dribl, built on what exists

> **For Claude Code:** Read this, `docs/DRIBL_INTEL.md` and `CLAUDE.md`.
> **CLAUDE.md decisions win.** Where this spec changes one, it says so explicitly in Section 5 and asks you to update CLAUDE.md in the same commit.
> Audit date: **29 Oct 2026** (first written 23 Oct). Taken from the schema (migrations **0001–0130, all applied** — verified by `npm run db:migrate -- --dry`), the commit history (**137 commits**) and a scan of `app/`. Verify each claim as you go and correct this file where it's wrong.
>
> **ID collision to resolve:** the 29 Oct brief calls the on-device contact matching feature "C-09", but C-09 in Section 2C is already *one search for the whole club* (built, migration 0130). Contacts is filed below as **C-10** to keep every ID pointing at one thing.

---

## 1. Where Squadroom stands

### Already built (from code)
> **Built is not the same as proven.** Three rows below have never run once in
> the real world: push has **0 registered devices**, payments have taken **0
> payments** (no Stripe key), and the Capacitor shell has **never been
> compiled** (no Xcode). Treat them as written, not working.
| Area | What exists |
|---|---|
| Tenancy | Organisations (academy/club/school/league) isolated by RLS. Composite FKs, helpers in `app_private`, `test-rls.sql` with **43 assertions**. Sydney region. |
| Roles | owner, admin, coach, parent, player |
| Onboarding | Academy invites and invite tree, team join links + QR, **six-character dictatable join codes** (X-21), join requests with coach approval, bulk invite, contact picker, join-link abuse controls, magic-link sign-in |
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

**Verdict (29 Oct):** On comms, events, safeguarding and tournaments, Squadroom already does more than Dribl's app. **Registration is now most of the way built** (R-01, R-02, R-05 … R-11 done) and what is left of it is the *money* — one checkout for several children, instalments, discounts, refunds and the finance export — all of which is blocked on one Stripe test key. The two genuinely unbuilt areas are **league mode** (M9: running a competition without Dribl) and the **native app** (which C-10 contacts and reliable iPhone push both need).

### Operational risks to fix now
1. ~~The repo has no git remote.~~ **RESOLVED.** `origin` is `git@github.com:jlameri11/squadroom.git` (private);
   137 commits pushed. `.env.local` has never been committed.
2. The production Supabase project doesn't exist yet (dev only: `rnykncrdcywmetuvslvw`).
3. Launch is blocked on outside accounts: **Stripe test key (`STRIPE_SECRET_KEY` is present but EMPTY — this now
   blocks eight registration and billing items)**, Stripe live keys, Apple Developer account + Xcode build, Twilio
   (prod only).
4. ~~The Supabase and Netlify MCP connections are down.~~ **RESOLVED.** Migrations go through
   `npm run db:migrate`, which talks to the management API with `SUPABASE_ACCESS_TOKEN` and is restricted to
   squadroom-dev by `scripts/_project.mjs`. **All 130 migrations are applied**, 0076 among them.
5. **Seeded fixtures age out.** They are written relative to the day they are created, so a demo left for a month has
   an empty next-up list. Run `node scripts/refresh-demo.mjs` before showing anyone.
6. Realtime: **chat messages moved to broadcast-from-trigger** (X-18 / 0088), which was the path that lost one
   message in five. Edits and deletes are still `postgres_changes`, which is one row when somebody fixes a typo —
   not the cost that path was replaced for. The 20th-academy concern in CLAUDE.md is addressed for the hot path.
7. **Tests must not depend on a healthy `next dev`.** `next dev` wedges with the port still open, so `fetch` hangs
   rather than failing and an overnight run stalls on the first screen with nothing written down. Every HTTP suite
   now resolves its target through `scripts/_base-url.mjs`: `BASE_URL` wins, else :3000 if it answers in 10s, else
   :3100 from `npm run serve:test` (which builds into `.next-test` so it can run alongside a live dev server).

---

## 2. Gap matrix (what to build)
**Priority:** P1 = before the NRIFA launch · P2 = before selling to other academies · P3 = later.
**Status:** MISSING / PARTIAL. Claude Code: confirm each one.

### A. Registration: teams and players (new requirement, top priority)
| ID | Feature | Status | Pri |
|---|---|---|---|
| R-01 | **Programs & products**: SPL squad, development, trials, holiday camp, term class, tournament entry, tour. Each has price, capacity, birth-year eligibility, open/close dates and a waitlist | **DONE** (0083, applied 25 Oct 2026), with /admin/programs and /programs. One table keyed by `kind`, not seven. Capacity and the waitlist are enforced by a trigger holding a lock on the program row, because two parents can tap Register in the same instant and only the database sees both | P1 |
| R-02 | **Public registration page** `/{slug}/register`: program → child(ren) → form → consents → pay (via existing Stripe Connect) → `pending` | **DONE** (0122 + `app/[slug]/register`, `app/admin/registrations`, `app/api/register/*`). **30 Oct: three steps with a progress bar — who's playing → details & agreements → review & send — and a draft kept in the browser as it is typed, reopening on the step they were on.** The pay step *shows* the fee and says when it is paid (after the club accepts, in the app) rather than taking it, by B-01's reasoning; proven in a real browser by test-register-flow (16). The most exposed surface in the product, so: nothing is an oracle (a full, closed, draft, other-club and nonexistent program all answer identically — asserted byte-for-byte; an unknown slug returns 200 with "not found" in the page rather than a 404), nothing is granted before a human decides, declining creates no account, and a PENDING request takes a place so a club cannot oversell. Child matched on name AND date of birth; consents recorded against the document version. Rate limited on a hashed IP before the eligibility check, so a program's rules cannot be probed for free. Payment (B-01) is deliberately absent until a Stripe test key exists. Proven by test-public-registration (48) and test-rls 35-40 | — |
| R-03 | **Self-serve identity**: phone OTP (or email link) *only* for public registration. Coach-approval join links stay as they are for invited families (see Section 5, D-1) | **NOT BUILT, AND DELIBERATELY SO — now reinstated by the 29 Oct brief.** `app/api/register/request/route.ts` says it in as many words: coach approval is the identity gate, not an OTP. A phone is normalised to E.164 and rate-limited on a hashed IP, and nothing is verified. Sign-in after approval is an **email** magic link against a synthetic address derived from the phone (`app/api/register/claim/route.ts`), so there is no SMS OTP path in the product at all; Twilio exists but is wired only to late-change escalation in `lib/push/sms.ts`. **What the brief changes:** OTP comes back for the self-serve path only — see the M1 plan. The reason it is justified now and was not before is that a public register page has no coach who already knows the family, so there is nobody to vouch | P1 |
| R-04 | **Household**: one guardian registers several children in one checkout; invite a second guardian; dedupe on name + DOB | **MOSTLY DONE** (0082, applied). `app_private.find_existing_player` matches Dribl on name + gender + DOB and is used by both the registration flow and the roster importer. Deliberately not fuzzy: it returns a candidate for a human to confirm, because guessing attaches a stranger's child to a family. Still to do: several children in ONE checkout. Confirmed 29 Oct — checkout builds a single `line_items` entry from one server-side quote, so a family with three children pays three times and the sibling ladder (B-03) is computed but never presented as one total | P1 |
| R-05 | **Player profile fields**: photo, gender, school, kit sizes (shirt/shorts/socks), FFA number, emergency contacts, medical notes (restricted column/table) | **DONE** (0082 + 0123/0124). Kit sizes are a fixed vocabulary, not free text: the value of recording a size is the COUNT on a purchase order, and "10" / "Size 10" / "10Y" is five sizes to a database and one to a human. Socks have their own list because junior football socks are sold by shoe size. Recorded on the roster (there is no player screen, so without that a club whose roster predates the feature could never produce a kit list) and by the bulk import, which DROPS an unrecognised size rather than guessing — "10Y" probably means 10, and a product that quietly decides that is a product that orders the wrong shirt. Medical is a separate TABLE, visible to guardians and owners/admins — not coaches. One narrow exception: `coach_note`, surfaced through `team_coach_alerts(team)` so the coach at the ground learns about the EpiPen without the medical history. **Kit sizes are complete** — the trailing "still to do" here contradicted this row's own text and is removed (29 Oct); R-09 carries the export | — |
| R-06 | **Consents**, versioned: code of conduct, photo/media, terms, privacy. Record who accepted, when, and which version | **DONE** (0084, applied 25 Oct 2026). A trigger refuses edits to text anybody has signed — versioning only works if something enforces it. Records the ANSWER, so a refusal of photo consent is kept as carefully as a yes. **No IP address and no user agent**: we would never use either, and they are personal information we would then be holding for nothing | P1 |
| R-07 | **Approval queue**: approve → assign to team, which adds the family to the team channels and calendar via existing triggers. Bulk approve; reject with a message | **DONE** at `/admin/programs/[id]`, same shape as the join-request queue because it is the same job. The team picker is ON the approve button, and 0098 makes the guardians follow the child into the squad's channels — which is the half I got wrong first time. Bulk approve still to do: confirmed 29 Oct that both queues decide **one row at a time** with no selection state, which is a hundred taps on the Monday after registrations open | P1 |
| R-08 | **Team registration fields**: capacity, coach/manager, kit colours (sky/navy), `external_team_id` for the Dribl name, a "don't import" flag (e.g. U7 Orange) | **DONE** (0121 + `app/admin/teams/[teamId]/league-name.tsx`). `teams.external_ref` is what the league calls the squad, stored exactly as the export writes it ("NRFA U7  navy", two spaces) and matched case- and whitespace-insensitively. Recording it buys two things: one export of the whole club imports in one go, routed per row; and the file then answers "which side were we" itself, so 0119's club question stops being asked. `skip_import` leaves out a side that is in the draw but has no families here. Coach/manager were already `team_members` roles. Proven by test-import-diff 10-13 | — |
| R-09 | **Jersey numbers**: one pool per season across the academy; no clashes between adjacent age groups (players play up/down); suggest the nearest free number; kit list export with sizes | **MOSTLY DONE** (0085, applied 25 Oct 2026). Pool is `(academy_id, season)`, not per team: a U10 filling in for the U11s in 7 against an existing 7 is two sevens on the pitch and a match sheet that cannot say who scored. `next_squad_number` answers "10 is taken, 11 is free" rather than "no". Kit export **DONE** (0123, `/admin/kit`): counts per garment and size, which is the order, plus every player, which is what somebody checks it against. The number of children nobody has asked is shown with the same weight as a size, because ordering 20 shirts for a squad of 24 is the failure the screen exists to prevent | — |
| R-10 | **Bulk player import** from CSV/XLSX, reusing the `/admin/import` mapping UI (currently fixtures only) | **DONE** (0100, `/admin/import/players`). The mapper is reused, not copied — `FieldKey` widened and a `PLAYER_FIELDS` set added. Dedupe on name + gender + DOB, so re-importing an updated export matches instead of doubling the roster, and a match fills BLANK fields only because a coach's edits are not less authoritative than a spreadsheet. **Guardians are deliberately never imported**: a column of parent phone numbers is the bulk address-book upload CLAUDE.md forbids, wearing a different hat | P1 |
| R-11 | **Custom form fields** per program | **SCHEMA DONE, HALF THE UI** (0083). `programs.questions` jsonb documents `[{id,label,type,required}]`, and `program_registrations.answers` holds the replies. Free-form on purpose: what a tour must ask has nothing to do with what a trials day asks, and a column each is a migration every time somebody thinks of something. The approval queue **does** show the answers. Two gaps: the parent form renders **every question as a plain text input** — `q.type` and `q.required` are never read, so a yes/no question is a box somebody types "yes" into — and there is **no builder at all**, so questions can only be set by writing JSON straight into the database | P1 |
| R-12 | **Season rollover**: clone teams, move everyone up an age group, prefilled re-registration invites, flag anyone who hasn't re-registered | **DONE** (0139, Admin → New season). Preview, then clone every active squad an age group up ("U8 SPL" → "U9 SPL"), move every player (the chat follows), keep each number where still free in the new pool and say how many were not, open next season's squad program so "re-registered" means an approved registration in it, end the old squad. Players move before anyone re-registers, on purpose — an empty squad for the weeks a club is chasing families is a coach with no list and families with no chat. Report of who has not, with a weekly nudge to their guardians. Proven by test-season-rollover (20) | — |
| R-13 | **Trials → offer → paid registration** | **DONE** (0140–0142). An offer is a dated, pre-approved place in a squad program, made by the coach from the trial's "Trialled" list; every guardian is told, `/offer/[id]` is where they accept (registration already approved, child into the squad, straight to the squad's fee through the one checkout) or decline; it lapses by date and can be offered again. A full squad is refused in the club's own words rather than quietly waitlisting a child who was told "in". Proven by test-trial-offers (26) | — |
| R-14 | **Official PlayFootball rego status** per player (done/pending) with reminders. Squadroom never does official registration | **DONE** (0137, 0138). A status a human sets on the roster — unknown / pending / registered / not required — with the FFA number beside it, the squad's count at the top, and the parent's view on My family. The reminder goes to the **family** a fortnight before the squad's next match, weekly until done, and **only for 'pending'**: 0137 fired on 'unknown' too and would have nagged every family at every club on its first morning. Proven by test-official-rego (14) | — |
| R-15 | Withdraw/deregister with full or partial refund before a cut-off | **DONE, bar the Stripe call running** (0145, `/api/payments/refund`). Each program carries its policy — full refund until a date, a share after it (0% by default, because "no refund after the cut-off" is what most clubs mean). A family withdraws from Sign up and is told the money before the tap; the club can withdraw too. The refund is worked out in the database from the payments actually made and recorded as *requested*; the treasurer issues it from Collect payments, on the club's connected account. Without a key the route says so and the request is kept. Withdrawing leaves the roster alone — removing a family from a chat is the club's explicit act. Proven by test-withdrawals (17), test-rls 50–51 | — |
| R-16 | Hide a player's name or photo on public tournament pages | **DONE** (0093–0096). Three controls: an academy setting (off / "Leo W." / full name), a per-child opt-out that always wins, and the rule that each player's OWN academy decides — a competition you run never publishes a visiting club's children. Proven by test-public-squads, which also asserts the payload carries nothing but a name and a number: no date of birth, no phone number, no medical note | P2 |
| R-17 | **Settings → My family**: each child's profile, medical, emergency contacts, consents (view *and withdraw*), kit sizes, number, squads | MISSING. Added as an ID on 29 Oct because it was only ever a cell in the Section 3 table, which is how it stayed unbuilt while every field behind it got built. All of it exists (0082, 0085, 0123) and all of it is **admin- and coach-side only**: a parent's single route to their own child's record is the JSON data export. The sharpest gap is consent *withdrawal* — R-06 records a refusal as carefully as a yes, and a parent currently has no way to change their mind | P1 |
| R-18 | **Circular 26-02 compliance** (FA, 1 Oct 2026): per-program "requires PlayFootball registration"; FFA number + FIFA ID captured; approval blocked until official status is confirmed where required; PlayFootball export import; fee-disclosure reminder. Never log in to or scrape PlayFootball | **DONE** (0162). `programs.requires_official_rego` — per program, because the circular is silent on independent academies. The public form shows the notice and takes the FFA number and FIFA ID (digits only); the queue shows them with "Not confirmed" and a one-tap "I checked PlayFootball — registered"; **Accept is refused** by the approve route (a sentence) *and* by a trigger on `program_registrations` (so offers and direct updates obey it) until the request is confirmed or the child is already on the roster as registered / not required. `/admin/import/playfootball` reads the club's own export (FFA number, FIFA ID, or name + DOB) and sets statuses and confirms waiting requests; club settings carry a per-season "our fees are in PlayFootball" tick. Proven by test-circular-26-02 (21), test-rls 66–67 | — |
| R-19 | Notice of Offer to returning players at rollover (extends R-12, R-13) | MISSING — added 30 Oct from `SQUADI_INTEL.md` §6B | P2 |
| R-20 | Registration dashboard: new vs returning, age, gender, against targets | MISSING — added 30 Oct from `SQUADI_INTEL.md` §6B | P3 |

### B. Safeguarding & compliance
| ID | Feature | Status | Pri |
|---|---|---|---|
| S-01 | **A child is never alone with an adult in a private chat.** Written as `supabase/migrations/0076_a_child_is_never_alone_with_an_adult.sql` with `scripts/test-minor-dms.mjs` | **DONE** — applied to squadroom-dev and verified on 29 Oct (`db:migrate --dry` reports all 130 applied). The earlier "written, not applied" status was true only while the MCP connection was down. Guardians are pulled into any private chat that would otherwise put one adult alone with a minor; kept as defence in depth even though no under-18 gets an account at all (see S-06), because the rule then holds even if that decision is ever revisited | — |
| S-02 | **Report message** → Safeguarding Officer role, report queue, audit log | **DONE** (0108). `safeguarding_officers`, `message_reports`, `report_message`, `safeguarding_queue`, `review_report` + `app/admin/safeguarding`. Closing a report requires a sentence — "dismissed" alone is the state a club cannot defend a year later. Insert is `with check (false)` so a report is only ever written through the RPC, which takes the channel and academy from the MESSAGE; delete is refused for everyone, because a club that can delete its reports has no reports. Proven by test-reporting and test-rls 24-29 | — |
| S-03 | **WWCC**: number, expiry, verified-by and verified-at for every coach/admin. Coach role can't be granted until verified; alert 60 days before expiry. Manual verification via the OCG Employer Portal (no API) | **DONE** (0120 + `app/admin/clearances`). The team-coach gate has NO exemption, not even for the owner — an exception for the most senior person is an exception for exactly the person nobody else will question. Nobody records their own. 'barred' with a future date is still refused, and an expiry already past cannot be recorded as current. The board is built from the PEOPLE so somebody with no record at all appears. Warnings go to owners and admins (the club carries the duty), re-sent every 14 days, rate limited in the function so running the sweep twice tells nobody twice. Proven by test-clearances (28) and test-rls 30-34 | — |
| S-04 | Photo-consent warning before posting media of a player without consent (needs R-06) | **DONE** (0128 + `app/chat/[channelId]/photo-consent.tsx`). Consent had been recorded since R-06, refusals included, and nothing read it back — so a coach could photograph training and post it into a chat containing the family who said no. It does NOT claim to have looked at the photo: a product that said so would be trusted and cannot be. It names who in THIS squad must not be photographed, at the moment of posting, and leaves the looking to the human who was there. REFUSED and NOT ANSWERED are never merged — one is a decision, the other a question the club has not asked, and merging them fires the warning for every child at a new club, which trains people past the real one. A club with no photo policy gets nothing. Proven by test-photo-consent (16), including that reissuing the form resets every earlier answer | — |
| S-05 | **Children's Online Privacy Code** (due by 10 Dec 2026): guardian consent records, export/delete my data, child-friendly privacy notice, data minimisation. Get a legal review before the second academy | **EXPORT AND ERASE DONE** (0127, `app/settings/my-data.tsx`, `app/api/me/erase`). Consent records were already versioned (R-06). The thinking is in what is KEPT, each with a stated reason returned by the function itself so a screen cannot describe a policy the code does not implement: safeguarding reports (a report naming somebody cannot be erased BY them), payment amounts (the club's books, five years), WWCC records (the club's obligation, not the holder's property), messages tombstoned not deleted (removing them rewrites other people's conversations), and the child's roster row (it belongs to the club) — with the club NOTIFIED when the last guardian goes, because a child nobody can ring about is a child nobody can collect from training. Erasure returns a manifest, which is the compliance artifact. **Still outstanding: the child-friendly privacy notice and the legal review** | P2 |
| S-06 | Player accounts (13+) restricted to team/announcement channels and always linked to a guardian | **SUPERSEDED — will not be built.** Joey's decision: *nobody under 18 gets an account.* Children exist as roster records, never as users, and they see fixtures, results and ladders through the public match centre with no login and nothing collected about them — which is how Dribl already does it. This is both the stronger safeguarding posture and a large reduction in regulatory surface: the under-16 social-media minimum age and most of the Children's Online Privacy Code apply to *child users*, and there will not be any. Enforced by **0078** (applied), which is two triggers, not one: `academy_members_adults_only` refuses the `player` role outright, and `players_no_logins` refuses a `profile_id` on a player record — because a child given a login through the roster rather than the member list would have walked around a single gate. The `player` role stays in the enum, refused at the door, rather than being removed: a role nothing can grant is safer than a migration across every policy. Proven by `test-adults-only.mjs` | — |
| S-07 | Mandatory 2FA for owners, admins and league admins (TOTP); parents untouched | MISSING — added 30 Oct from `SQUADI_INTEL.md` §6B.20 | P2 |

### C. Chat (close the gap with WhatsApp)
| ID | Feature | Status | Pri |
|---|---|---|---|
| C-01 | **"Seen by 41/56"** on announcements, from `channel_members.last_read_at`, plus a one-tap re-ping of unread members | **DONE** (0109). `announcement_reach` and `reping_unread`; the re-ping is rate limited in the database, so pressing it twice tells nobody twice | — |
| C-02 | **Automatic member labels** from roster links: "Anna's Dad · U9 Navy", "Coach", "Manager" | **DONE** (0111). `app_private.channel_member_label` takes the CHANNEL, not the academy, because what may be said about a person depends on who is listening: a team channel names that person's children in THAT squad (everyone there can already read the roster), an academy-wide channel names no child at all — only the role and the squads. Proven by test-labels-and-reasons, which checks every child's first name in the academy against every academy-wide label | — |
| C-03 | @mentions | MISSING | P2 |
| C-04 | Scheduled messages | MISSING | P2 |
| C-05 | Voice notes + short video | MISSING | P2 |
| C-06 | Threaded replies under announcements that don't notify the whole channel | PARTIAL (replies_only mode + reply_to) | P2 |
| C-07 | Notification digest (one summary push instead of many) | MISSING | P2 |
| C-08 | Mute per channel / filter per child in the UI | DONE (column + channel settings sheet) | — |
| C-09 | **One search for the whole club**, not just messages | **DONE** (0130). DRIBL_INTEL ranks "navigation is confusing: finding teams" at #1 and "search is broken" at #8 among complaints against Dribl, and Squadroom's search answered neither: it covered messages and people, so typing an opponent's name found the chat about the game rather than the game. It now also finds FIXTURES and SQUADS, games first, each result carrying the id its screen needs. Fixtures go through `my_upcoming_events`, so the four visibility rules including `private_to` are the screens' rules and not a second copy. A squad result links to the fixtures filtered to that squad, never to the staff team page — the person searching "U10" is usually a parent asking when the U10s play | — |

### D. Events & availability
| ID | Feature | Status | Pri |
|---|---|---|---|
| E-01 | **Recurring training series**: every Tue/Thu for a term; edit one or all | **DONE** (0090–0092) — see X-20. Materialised as real events, built from a local time so daylight saving does not move training. "End the series" cancels only the future and keeps answered sessions. Editing ONE occurrence's details is still to do | **P1** |
| E-02 | **Reason required when RSVP = no**, labelled "Can't play" (already visible to coaches) | **DONE** (0111–0113). Required on 'no' and nothing else — a reason for turning UP is an interrogation. Enforced by trigger, because three screens and two functions write an RSVP; `components/why-out.tsx` asks inline on all three so the tap never fails at the database. 0113 fixed 0111's own clearing logic, which left "Injured" sitting next to "Going" | — |
| E-03 | **Chase non-responders**: "12 haven't answered" → one-tap nudge, plus an optional automatic nudge 48h before | **DONE** (0109, 0110). `who_hasnt_answered` lists per CHILD with the number to ring; `nudge_non_responders` is rate limited to one per person per day, so a coach who is not sure it worked can press it again. The automatic 48h nudge is still to do | **P2** |
| E-04 | **Family view**: all kids across teams (and later across academies) in one home feed, colour-coded per child | **DONE within one academy** (0114). Filter chips on home, one colour per child derived from their id — stable on every device with no column, no default and no settings screen. The chips render only for a family with two or more children. Cross-academy is still to do, and needs the switcher to stop scoping the screen | **P2** |
| E-05 | Availability grid for coaches (players × upcoming events) | MISSING | P2 |
| E-06 | Squad selection from availability → notify the selected players, with position/meet time/kit | MISSING | P2 |
| E-07 | One-tap attendance at training + attendance % | MISSING | P2 |
| E-08 | Venue directory (maps link, parking, field numbers) as a table instead of free text | PARTIAL (`venues` table exists for competitions) | P2 |

### E. Dribl / official fixtures
| ID | Feature | Status | Pri |
|---|---|---|---|
| F-01 | Dribl Events export importer | **DONE** | — |
| F-02 | **Club-wide draw view**: all teams, Saturday/Sunday tabs, filter by team, shareable public link. Replaces the fixturefeed site | **DONE** (0115 + `app/calendar/draw-filters.tsx`, `share-draw.tsx`). The data layer needed nothing — `my_upcoming_events` already lets `is_academy_coach` past the team filter, so a coach has always read every fixture. Both chip rows are derived from the fixtures IN VIEW, never from a list of days or squads, so every chip has something behind it and an ended squad with a game still in the window is offered while a full squad with no games is not. The public link is the existing `/c/{slug}` match centre. Proven by test-draw-view, including that a parent still reads only their own children's fixtures and is offered only their own squad | — |
| F-03 | Import diff preview: "3 games moved, 1 new, 1 removed" before confirming. Moved games already alert families via the 0064 trigger | **DONE** (0117 + `app/admin/import/import-diff.tsx`). `preview_imported_events` resolves every row with the SAME helper the writer uses, so the two cannot describe different imports. MOVED and CHANGED are reported separately, because a coach reading "3 moved" checks the times and would check the wrong thing for a new ground. Fixtures in the app but not in the file can be CALLED OFF, never deleted — a game somebody has answered is a Saturday they have planned around — and only on the whole local days the file covers | — |
| F-04 | Retire fixturefeed: once Joey has club-admin export access, the weekly routine becomes "export → drop into /admin/import" (Fri 3pm + Sat/Sun morning). Keep fixturefeed running until then | TODO | P1 |
| F-05 | Results/ladder import for official comps (if the export carries scores) | MISSING | P2 |
| F-06 | Provider adapter interface (Squadi for QLD/WA/Northern NSW) | MISSING | P3 |
| F-07 | Match-day checklist push to managers: "Submit your Dribl team sheet" (late sheets are fined $25) with a deep link | MISSING | P2 |

### F. Academy billing (on top of existing Connect)
| ID | Feature | Status | Pri |
|---|---|---|---|
| B-01 | Pay at registration (R-02) | **DONE, bar the card hop** (0126). The repo's plan said this "becomes wiring" and it did: nothing here touches Stripe, because CLAUDE.md is blunt that platform billing and academy collections must never share a code path. `payment_requests.program_id` is the one missing relationship — a fee owed by the children with an APPROVED registration in that program, rather than by a team (which bills eighteen children who never registered) or the academy (which bills everybody). A fee is scoped by a team OR a program, never both, because two scopes is two answers to "who owes this". The fee is deliberately NOT taken at the form: a registration is a request a club has not accepted, and charging before a human says yes means refunding everyone they turn away — a second money path for a signal coach approval already gives. The public page shows the fee so nobody is surprised; the charge goes through the existing checkout once the child is on the roster. Proven by test-program-fees (27), with test-payments and test-fees unchanged | — |
| B-02 | Instalment plans + recurring term fees, with Stripe retry on failure | **BACKEND DONE, NO UI** (0102) — the status said MISSING and was wrong (corrected 29 Oct). `payment_requests.instalments` (1–12) + `instalment_every_days`, `payments.instalment_seq`, `quote_payment`, and `app/api/payments/checkout/route.ts` picks the next unpaid instalment and labels it "part N of M", upserting on `(request_id, player_id, instalment_seq)` so a double tap cannot make two. **UI added 30 Oct:** "Ask for a payment" offers one payment or 2–12 instalments, fortnightly to termly, and the quote splits exactly (test-fee-settings). Each instalment is still a separate one-off Checkout the parent starts: there are no Stripe Subscriptions and **no retry/dunning**, which is the half that needs a card on file and therefore a Stripe key | P1 |
| B-03 | Sibling discounts, promo codes | **SIBLING BACKEND DONE, NO UI; PROMO CODES MISSING** (0102, 0103) — also wrongly marked MISSING. `academies.sibling_discount_bps` is a LADDER (second child, third, …), validated by `app_private.bps_ladder_ok`; 0103 fixed the ranking so **twins are siblings too** — ranking by date of birth gave two children born the same day the same rank and charged both full price. Applied in checkout and shown in `app/admin/payments/outstanding.tsx`. **UI added 30 Oct:** Club settings → Family discounts, "2nd child X% off, 3rd and beyond Y%", written as the bps ladder and refused by the constraint when wrong; a parent cannot set it (test-fee-settings). Promo codes: nothing anywhere — see B-07 vouchers | P1 |
| B-04 | Refunds (R-15) and overdue reminders | **LISTENER ONLY** — the webhook handles an inbound `charge.refunded` and flips `payments.status` to `refunded` (`app/api/payments/webhook/route.ts`), but there is **no way to issue one**: no `stripe.refunds.create`, no route, no RPC, no button. A refund today means opening the Stripe dashboard. 0126 avoided the question by charging only after approval. Overdue is *surfaced* (`outstanding_fees` returns `days_overdue`, shown on the admin screen and `app/home-owing.tsx`) but never *sent*: the only chase is a manual `sms:` deep link per parent. No notification kind, no queue row, no cron — and note the existing `event_reminder` machinery is unrelated | P1 |
| B-05 | Finance export (paid/outstanding by program/team) | **DONE, bar Stripe's side of reconciliation** (0143/0144, `/api/export/finance`). Two CSVs from Admin → Collect payments: every fee per child (list price, owed after discounts, paid, outstanding, status, Stripe payment ids for matching a payout) and totals by program, squad and family with a grand total to the cent. Money from `quote_payment`, the one price function. Pulling Stripe's payout report *into* the app to reconcile automatically needs the key. Proven by test-finance-export (14) | — |
| B-06 | **Squadroom SaaS billing** (`academy_billing` exists): plan tiers by team count via Stripe Billing, on a code path completely separate from academy collections | PARTIAL | P2 |
| B-07 | **Vouchers** — Active Kids-style government voucher (a code with a $ value the club redeems with Service NSW) and club vouchers, applied at checkout; code, value and net recorded per registration | MISSING — added 29 Oct for Dribl Connect parity (`docs/DRIBL_PARITY.md` #6). Blocked on the Stripe test key for the charge; the record and the arithmetic are not | P1 |
| B-08 | **Bank transfer and pay later** — Stripe `au_becs_debit` as a payment method, and an explicit "pay later by [date]" with a reminder, alongside card | MISSING — parity #8. Blocked on the Stripe test key | P1 |
| B-09 | **Fee split per product** — one checkout, two transfers: the league's share to the league's connected account, the club's to the club's. Squadroom still takes nothing | MISSING — parity #7; the league side is L-02. Blocked on the Stripe test key | P1 |

### G. SaaS & growth
| ID | Feature | Status | Pri |
|---|---|---|---|
| G-01 | Self-serve academy onboarding under 30 minutes (`/start` exists?) | PARTIAL (/start exists; the 30-minute claim is untested) | P2 |
| G-02 | Public academy page: programs + Register button + public draw. No public social feed | **CONTENT EXISTS, ROUTE DOES NOT** (corrected 29 Oct). `/{slug}` **404s** — `app/[slug]/` holds only `register/`. But everything the page needs is already rendered one level down inside `app/[slug]/register/register-form.tsx`: academy name, logo, primary colour, program cards with price, the birth-year band and `spots_left`. So this is a route and a split, not a feature — lift the presentation out of the form, and link the public draw (`/c/{slug}`) which already exists | P1 |
| G-03 | In-app support contact | MISSING | P2 |
| G-04 | App Store / Play submission | BLOCKED on accounts | P2 |
| G-05 | Development: coach notes, termly reports, video clips (Analysis Pro link) | MISSING | P3 |
| G-06 | Match report and live score taps posted to the team channel | MISSING | P3 |
| G-07 | Volunteer/referee roster for tournaments | MISSING | P3 |

### I. League mode — run a competition without Dribl (M9, added 29 Oct 2026)
The one milestone that lets a league leave Dribl. SPL first. Detail and the acceptance test (`test-league-season.mjs`) are in `BUILD_PLAN.md` § M9.

| ID | Feature | Status | Pri |
|---|---|---|---|
| L-01 | League setup: per-division rules — scores public/hidden, ladder on/off, points, tie-break, match length, squad size, grading | **DONE** (0148–0150). A division with no row keeps the old rules; the ladder and the public page honour the row; organiser-only writes. Proven by test-league-divisions (12) | P1 |
| L-02 | Club entry + league fees through Stripe Connect to the league; nominations; coach/manager contacts | PARTIAL — entries and invites exist; fees need the Stripe key | P1 |
| L-03 | Season squad lists per entry, playing-up/borrowing rules, eligibility check before a sheet | **DONE** (0151). `entry_squads` seeded from the club's roster; playing up by division rank within the same club where the division allows it, never down; a sheet with an ineligible child is refused naming them; squad-size maximum enforced. Suspensions plug into `app_private.suspension_reason`. Proven by test-match-sheets | — |
| L-04 | Photo player cards as match-day ID | **DONE** (0159). The card (X-06) now opens for two more people, each tied to a sheet: the organiser's officials, for any child on a season squad in their competition; and the opposition's manager, from the day before kick-off to the day after, for a child on the sheet. The photo follows the same rule. Nobody outside those can edit it. Every name on a sheet links to the card. Proven by test-league-public (7 of 13) | — |
| L-05 | Match sheets: both teams submit, opposition confirms, goals/assists/cards/subs, both scores with mismatch as a dispute, audit trail | **DONE** (0151, 0152, `/competitions/[id]/match/[fixtureId]`). Each side submits and the other confirms; events against players on the sheet; both scores — agreement is final, disagreement is disputed with the ladder unmoved until the organiser rules, never averaged; every action logged. Proven by test-match-sheets (36), test-rls 56–59 | — |
| L-06 | Referees: pool, availability, appointments with accept/decline, check-in, report | **DONE** (0161, the Refs tab, `/referee`, `/ref/[token]`). The pool belongs to the league, not the competition; a referee claims a link once and is not a member of anything. Block-outs ("not free"), availability per game with the reason (blocked out / already on another pitch inside the game's window), an appointment is *offered* with a push, accepted or declined with a note, withdrawn with a reason; check-in in a window around kick-off; the referee's report. Clubs see the name on the run sheet and nothing else; the pool's phones are the league's. Proven by test-referees (40), test-rls 64–65 | — |
| L-07 | Referee match fees, payment run, export | **DONE bar the Stripe transfer** (0163, `/api/payments/referees`, `/api/export/referee-payments`). Fees per competition and role; a run is a snapshot of every accepted, checked-in game in a period not already in a run, amounts locked onto the appointment; marked paid by bank transfer or cash (one tap), or through Stripe transfers from the league's connected account to each referee's (the route says plainly when a key, the league's account or a referee's account is missing); a draft run can be voided, a paid one cannot; the treasurer's CSV; the referee's page shows the fee per game, owed / paid, and takes their bank details (league staff only). Proven by test-referee-payments (23), test-rls 68–69 | — |
| L-08 | Discipline: card accumulation, thresholds, red = suspension, suspended players blocked from the sheet, tribunal notes, report | **DONE** (0153–0155, the Cards tab). Rules per competition; a red or the Nth yellow on a sheet is a suspension automatically; served one game at a time as the team plays without them; refused on the sheet by name; tribunal suspensions, appeals noted, overturns with a reason, nothing deleted; the report. Proven by test-discipline (24), test-rls 60–61 | — |
| L-09 | Match-day ops: washouts by ground/day, forfeits, postponements, byes, every change pushed to club chats | **DONE** (0156). Call off a day or a ground, postpone or cancel, reschedule, forfeit (scored by the division's forfeit score), bye — organiser-only. Nothing here notifies: the fixture change is mirrored into each club's event and 0064's trigger pushes cancelled / changed / back-on with the reason, the same path a club's own change takes. Proven by test-match-day (20) | — |
| L-10 | Ladders and finals: point adjustments with reason, forfeit scoring, finals from the ladder | **DONE** (0158 + 0156's forfeit score). An adjustment is a row with a reason, never an edit to a score; the one ladder function adds it so the organiser's tab, the club's and the public page show the same table, with the reasons listed under it. Proven by test-ladder-adjustments (9), test-rls 62–63 | — |
| L-11 | League announcements to club staff, never to other clubs' families | **DONE** (0157). Was wrong, not missing: `broadcast_to_competition` posted into each club's *academy-wide* channel — every family at every club. It now goes to each club's coaches channel; a parent sees it in no channel at all. Proven by test-league-comms (6) | — |
| L-12 | Public match centre: fixtures, results, ladders, top scorers, share link, widget, honouring club privacy | **DONE** — `/c/[slug]` has fixtures, results, ladders and now **top scorers** (0160: from the sheets, final games only, each player named by their own club's rule with a family's opt-out winning, "A <team> player" when unnamed, nothing for a hidden-score division; test-league-public 5). **Share link and widget done (30 Oct):** a Share button on the page (the phone's share sheet, copy elsewhere; the link carries no tracking); `/c/[slug]/embed?view=ladder|fixtures|scorers&division=…` is the widget — no header, a link back, the one path `next.config.ts` lets any site frame (`frame-ancestors *`; everything else stays DENY) — and the organiser's publish control hands out the iframe snippet. Cached 60s like the page. Proven by test-league-public (19) | — |
| L-13 | League roles: admin, competition manager, referee coordinator, discipline officer, ground manager | **DONE** (0164, 0165). Roles are held at the league and given by its owners/admins to members of the league. Every write that asked "is this the organiser?" now asks `may_run(competition, area)`: *competition* (staff or competition manager — the draw, scores, ladders, finals, rules, announcements; `is_competition_organiser` now means this), *referees* (coordinator), *discipline* (officer), *grounds* (ground manager or competition manager). Twenty area functions regenerated from the live definitions with the one guard swapped; the page asks `my_competition_access` once and shows each tab's controls by area. A role never shows anyone a club's people. Proven by test-league-roles (35), test-rls 70–71; the referees, match-day, discipline and payments suites still green | — |
| L-14 | Switching from Dribl: import a league's teams, squads, fixtures | PARTIAL — the fixture importer exists for a club; the league-wide form is not | P2 |
| L-15 | Reports: results, ladders, discipline, referee payments, entries | **DONE** (`/api/export/competition?report=results|ladders|discipline|entries`, plus L-07's referee payments). CSV through the caller's own session, so each answers what that person may see — a club its competition, the organiser the contacts and the money too, a stranger 404. A Reports card on the Clubs tab. Proven by test-league-reports (9) through the real route | — |
| L-16 | Tournament entry: external teams register and pay through the registration engine | MISSING — Stripe for the fee | P2 |
| L-17 | Team-sheet lock at T-30/T-15, referee-only edits after, logged | MISSING — Squadi parity, `SQUADI_INTEL.md` §6A.1 | P1 |
| L-18 | Scorer handoff: referee verifies on the scorer's phone with their mobile; typed "Confirm" | MISSING — §6A.2 | P2 |
| L-19 | Match lifecycle Editable → Ended (locked) → correction request, audited | MISSING — §6A.3; L-05 has final + dispute | P1 |
| L-20 | "One card away" warning push; sanction codes (extends L-08) | MISSING — §6A.4 | P2 |
| L-21 | Attendance-driven finals eligibility; borrowing caps, enforced on the sheet | MISSING — §6A.5 | P1 |
| L-22 | Forfeit request chain coach → club → league | MISSING — §6A.6; L-09 has the organiser's forfeit | P2 |
| L-23 | Fixture Flowing: home clubs adjust in a window; club-to-club chat on a fixture | MISSING — §6A.7 | P1 |
| L-24 | Draw quality summary and field-impact view; match-day edits never overwritten by republishing | MISSING — §6A.8 | P1 |
| L-25 | Referee extras: decline reason, late-decline block, self-appointment by experience, club-allocated refs, under-18 payouts to a parent, payments in app | MISSING — §6A.9; extends L-06/L-07 | P2 |
| L-26 | Live match-day ops dashboard: missing sheets, unverified results, pending reports, suspensions, unfilled referees | MISSING — §6A.10 | P1 |
| L-27 | Nominations: drag players into teams, propose a division with a comment, league sets it, lock on submit, DOB override | MISSING — §6A.11 | P2 |
| L-28 | Bulk tools: score upload, reschedule a round, double headers, abandon, move a competition | MISSING — §6A.12 | P2 |

### J. Differentiators — neither Squadi nor Dribl (M10, added 30 Oct 2026)

| ID | Feature | Status | Priority |
|---|---|---|---|
| W-01 | Respect / behaviour marks (players, coaches, spectators) with a league dashboard; never public | MISSING | P2 |
| W-02 | Concussion register: sheet lockout until a clearance is uploaded and accepted | MISSING | P1 |
| W-03 | Safeguarding gate: a lapsed WWCC or training blocks rosters, chat and sheets; reportable-conduct register | PARTIAL — 0120 gates coaching on a clearance | P1 |
| W-04 | Children's privacy consent centre | PARTIAL — R-06, R-17 | P2 |
| W-05 | Auto referee assignment with preview and undo | MISSING | P2 |
| W-06 | Match QR check-in for referees | MISSING — L-06 has a tap check-in | P3 |
| W-07 | Club-to-club change requests; attendance blocked on overdue fees | MISSING | P2 |
| W-08 | Auto-translated chat, original one tap away | MISSING | P3 |
| W-09 | Later: video, development plans, pitch booking, casual sessions, insurance, streaming, lotto | LATER | — |

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
| X-04 | **Share cards**: result, Player of the Match and weekend-fixtures graphics in academy colours, sized for Instagram/WhatsApp stories | **RESULT AND WEEKEND DONE** (`lib/share/card.tsx`, `/api/share/result/[eventId]`, `/api/share/weekend`). Rendered server-side through next/og — flexbox only, no external fonts or images at render time, because a card that waits on a font host is a card that sometimes does not render. Story, portrait and square; an unknown shape falls back rather than erroring. The text colour is computed from the club's own colour by relative luminance, because some clubs pick yellow and white on it is unreadable. NO CHILD IS NAMED on any card: a graphic is the most shareable thing the product makes and is beyond recall once it is in a group chat — the only field that could carry a name is the coach's own note, which is their sentence about their own squad. Signed in, though nothing on a card is secret: an open endpoint rendering any club's branded graphic is a thing somebody would use to make a fake one. Player of the Match not built (stats deprioritised). Proven by test-share-cards (15) | P2 |
| X-05 | **Match centre per event**, with tabs: Overview (time, venue + directions, kit, arrive-by) · Availability (staff) · Lineup (private to the academy) · Result (score, scorers, Player of the Match, photos) · Table/Form | **DONE except photos and Player of the Match** (0118 Result, 0125 Lineup). The Lineup is a DRAFT until a coach publishes it, which is the whole design: a side is picked over two days with changes of mind, and a sheet parents can watch being edited gets argued about before it is a decision — at which point a coach goes back to paper. Never on the public page (R-16). A starter whose family said they cannot play is SHOWN, never refused: a coach may know something the form does not, and a product that refuses the sheet sends them back to paper too. Replaced wholesale, because a partial update is how a sheet ends up with twelve starters. Proven by test-lineup (24) and test-rls 41-43 | P2 |
| X-06 | **Player card**: photo, squad, number, season stats. Also serves as the academy "member card" | **DONE, bar stats** (0146, `/card/[playerId]`). Photo in its own private bucket under `<club>/<child>/`, read only by the family and the club's coaches by signed link; club colour and crest, squad, number, DOB, FFA number, PlayFootball status. Linked from My family and the roster. Season stats stay deprioritised (X-02). Proven by test-player-card (16), test-rls 52–53 | — |
| X-07 | **Academy-wide table**: all squads' results in one view (Dribl's club championship, but easy to find) | MISSING | P3 |
| X-08 | **Sponsor slots** the academy sells itself: banner on the match centre, sponsor on the Player of the Match card and share cards | MISSING | P3 |
| X-09 | **Offline match day**: cache the schedule, roster, player cards and venue; queue RSVPs and score taps until there's signal | **DONE for reads and the two taps that matter** (`lib/offline/`). Screens persist to IndexedDB so arriving at a ground with no bars still shows the fixtures — `useScreen`'s cache was a Map that died with the tab, and the moment that matters most is reopening the app at the gate. The register and all three RSVP paths go through an outbox: a network failure KEEPS the write and replays it, a refusal does not (a queue that never drains is a badge that never clears). The queue stops at the first network failure rather than burning an attempt on each, preserves order, caps at five, and is tagged with who made it — a shared club tablet must not replay one coach's register as another. Sign-out clears it all, because a cached home screen is somebody's children's names on a disk. Proven by test-outbox (31), which needs no browser and no database because the storage is an interface. Score taps are not queued: a score is typed once, sitting down, after the game | P2 |
| X-10 | **Accessibility + languages**: Dynamic Type/VoiceOver labels; strings ready for translation (Italian, Arabic, Chinese, Greek, Vietnamese are common among Sydney football families) | MISSING | P3 |
| X-11 | **Post-match parent pulse**: a one-tap "How was today?" that only coaches see | MISSING | P3 |
| X-12 | **Ground view for tournaments**: games by field/time for organisers on the day (Dribl added this in Apr 2025) | **DONE** — the run sheet groups by kick-off time for a one-day competition and by round for a season (X-17) | P3 |
| X-13 | **One-tap wet-weather call for a whole venue/day**: cancels every affected event across all squads, uses the existing cancellation push and SMS | **DONE**. `app/calendar/call-off-day.tsx` + `call_off_day`; it shows what it is about to cancel before it does, skips what is already cancelled so a second press tells nobody twice, and each event goes through the existing 0064 trigger so the reason travels with it. Proven by test-call-off-day, including the Sydney-timezone edge where an early-morning game falls on the previous UTC day | — |
| X-14 | **The draw builder double-booked fields across divisions.** `generate_fixtures` (0047) tracks which TEAMS are busy in a slot, never which FIELDS, and each call assumes it owns the fields it is handed. Drawing three age groups onto the same four fields — which is what a gala day *is* — produced three games kicking off on Field 1 at nine. Found while seeding the Spring Gala Day, worked around there by giving each division its own fields | **DONE** (0081, applied 25 Oct 2026; proven by test-league-draw) | P0 |
| X-15 | **The draw builder could only build ONE DAY**, so Squadroom could run a tournament and not a league season — half of what Dribl is for. Pass 2 of 0047 walks consecutive slots from a single start time and places any game whose teams are free: there is no way to say "Round 1 this Sunday, Round 2 next Sunday", and greedy placement puts Round 1 and Round 2 games in the same slot. 0081 adds `p_round_every_days`, defaulting to 0 so a gala day draws exactly as before | **DONE** (0081, applied 25 Oct 2026; proven by test-league-draw) | P0 |
| X-16 | **Organisation switcher.** One person can run a league and coach at a club — `academies` means ORGANISATION and a `league` row has existed since 0021 — but every screen resolved it with `my_first_academy()`, the alphabetically first, with no way to reach the other. 0080 parameterises `home_screen`/`chat_screen`/`fixtures_screen`/`nav_badges`; the choice lives in the browser (two tabs can be two organisations) and the server validates it against active membership | **DONE** (0080, applied 25 Oct 2026; proven by test-organisations, including that an academy you are not in leaks nothing) | P0 |
| X-19 | **Attendance** — the register, taken at the ground. RSVPs are an intention recorded days earlier by a parent; attendance is a fact recorded by a coach, and conflating them makes both useless. One row per child per session, no row when the register has not been taken, so "nobody came" and "nobody marked it" stay distinguishable. `attendance_summary` counts only sessions that were NOT called off — wet weather is nobody's absence — and late counts as turning up. Visible on the event (take it) and the squad page (worst first, because the reason to open it is to find who has stopped coming). Dribl does not do this for training at all | **DONE** (0099) | P1 |
| X-20 | **Recurring sessions** — weekly training, set once. Materialised as real `events` rows rather than expanded from a rule at read time, because an occurrence carries RSVPs, a cancellation, a notification, an ICS entry and a chat card, and every one of those readers would have had to learn to expand a rule. Built from a DATE and a LOCAL TIME in the academy's zone, so a season crossing the daylight-saving boundary keeps training at 5pm instead of drifting to 4pm | **DONE** (0090–0092) | P1 |
| X-21 | **Join codes** — six dictatable characters per join link, for the way a club actually recruits: said at the end of training, written on a whiteboard, printed on a flyer. An alternative spelling of the same link, carrying the same expiry, use limit, revocation and coach approval. No anon-callable lookup, which would be an oracle for guessing codes | **DONE** (0089) | P1 |
| X-18 | **Live chat loses about one message in five.** | **FIXED** (0088 + `lib/hooks/use-channel-messages.ts`). It was never blocked on a dashboard setting — that diagnosis came from Realtime answering "You do not have permissions to read from this Channel topic", which sounds like a project toggle and is not. A private broadcast topic is authorised from the token on the SOCKET, and a client is authorised for HTTP by its session without the socket ever being told; `realtime.setAuth` is what tells it, and it has to be AWAITED. The hook now subscribes to `channel:{id}` as a private topic after awaiting setAuth and listens for the `new_message` broadcast 0088's trigger sends. Updates stay on postgres_changes, because one row when somebody fixes a typo is not the cost that path was replaced for. Measured after: **40 of 40** delivered across four runs of ten on an aged subscription, where the old path lost roughly one in five. test-chat step 8 now exercises the broadcast path rather than the one the app abandoned | — |
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
- **D-2 Dribl calendar sync. APPLIED 29 Oct 2026** — CLAUDE.md no longer claims it is behind a paid tier. Dribl shipped Google/Outlook calendar sync in v4.1.7 on 19 Oct 2026 (matches only). It changes nothing about our approach: sync *out* of Dribl into a parent's calendar is not a way to get data *into* Squadroom, and we do not fetch from Dribl at all (see the Rules heading). Squadroom's feed still wins on merit — training, socials and tournaments, per family.
- **D-4 Dribl independence. DECIDED 29 Oct 2026, by Joey.** Recorded under CLAUDE.md's new **Rules** heading. Never use Fixturefeed's code, Dribl's API or Match Centre, Dribl ids, or any Dribl data fetched by us. Fixtures, teams, players and results come from leagues, academies and coaches entering them in Squadroom, or from a league exporting its **own** data to us. The importer and the `external_ref` columns **stay** — importing a file a club or league exports from its own account and hands over is allowed. The line is the handover: we never reach across. Squadroom must be able to run a whole competition without Dribl (M9), starting with the SPL.
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
4. **Engagement:** E-01, E-02, E-03, C-01, C-02, X-13, the Home "Needs you" strip
   and child chips are **DONE**, and so are **F-02** and **F-03**. What is
   left in this phase: the **F-04** switchover, which needs club-admin export
   access rather than code.
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
