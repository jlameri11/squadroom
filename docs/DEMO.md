# Demo walkthrough

Everything below is live at **https://squadroom-dev.netlify.app** against real
data in squadroom-dev. Checked end to end by `scripts/smoke-demo.mjs`, which
reports 0 blocking issues.

Run `node --env-file=.env.local scripts/smoke-demo.mjs` before any demo. It
walks every screen as a coach, as a parent and as nobody at all, and tells you
what is thin before a club does.

---

## Signing in

| Who | Email | Password |
|---|---|---|
| You — owner of the academy **and** the league | `joeylameri@outlook.com` | yours |
| **Head of academy** — NRIFA's owner, nothing else (Joey, 9 Nov) | `head@squadroom-demo.test` | `squadroom-demo` |
| **League organiser** — the Sydney Premier League's staff, nothing else | `organiser@squadroom-demo.test` | `squadroom-demo` |
| Marcus Obi — coach only, no admin rights | `p61400000002@squadroom.invalid` | `squadroom-demo` |
| Sam Whitfield — parent of Leo and Zoe | `p61400000011@squadroom.invalid` | `squadroom-demo` |

The seeded families have `@squadroom.invalid` addresses on purpose — `.invalid`
is reserved so it can never resolve, which is right for a parent who signs up
with a phone number and a dead end for a demo. `scripts/demo-passwords.mjs`
gives them passwords instead; the sign-in screen defaults to a password rather
than a link. **Dev only.**

**Two-step sign-in in the demo (0232).** NRIFA and the SPL do not require
it yet (the switch is in Club settings, one way). Where an organisation does,
its owners and admins are asked for a six-digit code; a real account is
texted it, and a demo or placeholder account — which can receive nothing —
has the code **shown on the wall itself**, so the demo is never locked out.
Tick "Trust this device for 30 days" and that browser is not asked again.

Open a second browser profile or a private window to hold two sessions at
once. Showing the coach and the parent side by side is the demo.

---

## The ten minutes that sell it

### 1. The coach's morning — sign in as yourself
The home screen is the three things you are here to do, what needs you, and
the next fixtures — a screen and a half at most. Nothing to navigate to; the
chats are one tap away on the Chat tab.

### 2. One account, two organisations — tap the crest, top left
NRIFA Football Academy (an academy) and Sydney Premier League (a league).
Switch and everything follows: chats, fixtures, teams, badges.

> Dribl has no equivalent. A league secretary whose own child plays needs two
> logins there.

### 3. Chat — the WhatsApp half
**Chat → U8 SPL.** Messages with sender names and roles, two polls with real
votes, a fixture card with RSVPs inside the thread. Try the search icon:
"kit", "training".

Worth saying out loud: **phone numbers are hidden** (WhatsApp shows every
member's number to every member), **parent-to-parent DMs are off by default**,
and **an adult cannot be alone in a private chat with a child** — the database
pulls a guardian in, and children have no accounts at all.

### 4. Fixtures and training — **Fixtures** tab
67 events in the next 60 days: league games, gala day games and 78 training
sessions across three squads.

**Tap "Add weekly training."** Pick Tuesday and Thursday, a time, three
months. It says how many sessions before you press the button.

### 5. Take the register — open any session that has already started
**Everyone's here**, then mark the exceptions. The RSVP sits greyed beside each
name, so "said yes, did not come" is one line.

Then **Admin → Teams and players → U8 SPL → Attendance this term**: 17
players, 91% average, worst first. That is what the register is for.

> Dribl does not do training attendance at all.

### 6. Registration — **Admin → Programs and registrations**
Four programs: a camp, trials, weekly development, and a tour kept as a draft
so you can show that families cannot see drafts.

**Open January Holiday Camp.** Four places, seven applied — three were
**waitlisted by the database**, in the order they applied, because two parents
can tap Register in the same instant and only the database sees both.

Approve one. The team picker is on the approve button: approving without
assigning a squad leaves a family approved and still seeing nothing.

### 7. Run a competition — **Competitions**
- **Spring Gala Day** — 45 games, 6 fields, one day, live ladders in three divisions.
- **SPL Season 3** — 90 games, 10 Sunday rounds, three divisions, mid-season.
- **U7s Come & Try** — six teams, **no draw yet**. Open it and press *Build the
  draw*. Choose **One day** or **A round a week**.

### 8. The public page — **Spring Gala Day → Clubs tab**
The code is already published: **https://squadroom-dev.netlify.app/c/nrifa-spring-gala**

Open it in a private window. No login. Fixtures, results, three ladders and
**Squads** with named players and shirt numbers.

Three controls worth naming: the academy chooses off / "Leo W." / full names
(**Settings → Club settings**), any family can be left off and that always
wins, and each player's own academy decides — running a gala day never
publishes a visiting club's children.

### 9. How a family gets in — **Admin → Teams → U8 SPL**
The join **code** is first and largest, above the link and the QR, because it
is the only one that works without a device in your hand.

| Squad | Code |
|---|---|
| U8 SPL | `YNS8YN` |
| U10 | `RPBSSG` |

Open **https://squadroom-dev.netlify.app/join** in a private window and type
one. Six boxes, no account needed. It lands **pending** — a short code is not
a shortcut past the coach.

### 10. The parent's side — sign in as Sam Whitfield
One list — **Needs you** — with the fees, the agreements, "10 to answer" and
the team chat, one orange card for the most urgent, then the next two
fixtures with **a row per child**: Leo and Zoe answered separately. Two bills
on **Payments**. **Sign up** shows the three open programs, and the camp says
which child is waitlisted and at what position.

**Settings → "Send it to your child"** is the link a 14-year-old opens: their
next game, kit colour and arrive-by time, no account, nothing to log into.
Children do not get accounts in Squadroom at all.

### 10b. A game, as a match preview — as Sam, **Fixtures → the next SPL game**

The top of the page is the game: both crests (the other side's initials
until 0210 is applied), "In 9 days" and the kick-off, on NRIFA's colour.
**Preview** starts with Leo and Zoe's Going / Maybe / Out, then the ground
and its map, both sides' last five and their two rows of the ladder — tap
**Full ladder**. A played game (Spring Gala, Round 3) opens on the **Match
sheet** with "Full time 1–3". Every time is Sydney's, whatever the phone
says.

### 11. What a stranger sees — open **https://squadroom-dev.netlify.app/nrifa** in a private window
The club's front door: crest, colour, the three open programs with the price
and the places left, **Register**, and the public draw. Nothing about a
person. An unknown slug says "not found" with a 200 — no enumeration oracle.

Tap **Register**. Three steps — who's playing, details and agreements, review
and send. Fill in a child, press Continue, type your name, then **reload the
page**: it reopens on step 2 with everything still there. The review step
says the fee and that nothing is charged now — a family pays once a human has
said yes.

### 12. The parent's own records — sign in as Sam, **Settings → My family**
Leo and Zoe: squad and number, kit sizes (editable), medical and emergency
details (editable), the agreements with **Withdraw** on each, PlayFootball
status, and a **Player card** — photo in a private bucket only this family and
the club's coaches can open, never published anywhere.

### 13. The club's season — **Admin**
- **New season**: preview, then every squad rolls up an age group with its
  families, chat and numbers; the "not yet re-registered" list with a weekly
  nudge.
- **Programs → SPL Squad Trials → Trialled**: offer a trialist a squad place
  for N days. The family sees it at the top of **Sign up** and on
  `/offer/…`; accepting is pre-approved and goes straight to the fee.
- **Collect payments**: two CSVs (every fee per child with Stripe ids; totals
  by program, squad and family) and **Refunds** — worked out when a family
  withdraws before or after the program's cut-off, issued here.
- **Registrations → Select**: tick many, one squad for all, Accept N.

---

## If somebody asks

**"Does it replace Dribl?"** No, and deliberately. Football NSW mandates Dribl
for registration, eligibility and match sheets — that is governance, and the
failure mode is a child being ineligible on a Saturday. Squadroom reads from
it (`Admin → Import a draw`, or `/scan` from a screenshot) and does everything
Dribl does badly or not at all.

**"Can we move our roster over?"** `Admin → Import a roster`. A spreadsheet,
mapped column by column with your confirmation. Re-importing a corrected file
matches on name, gender and date of birth instead of doubling the squad.
Parent numbers are never imported — families join with a code.

**"What does it cost?"** Free for parents and coaches. Squadroom charges
clubs, never parents: there is no application-fee column and no code path that
could add one.

---

### 14. A club in its own colours — sign in as Joey, **Settings → Club settings**

1. **Club logo and colours** is at the top. NRIFA's crest is its logo; tap
   **Change logo** and pick any PNG, JPG or SVG — the colours in it are
   suggested at once ("From your logo"), **Use these** puts them on the two
   phones underneath (light and dark), and nothing changes for anyone until
   **Save colours**. Pick yellow to see the note: the header stays yellow
   with black text, buttons and links use a deeper shade on white screens.
2. Switch to **Sydney Premier League** (tap the crest): the bar turns the
   league's green with its logo. (That logo is a stand-in until the league
   sends theirs — NEEDS JOEY #16.)
3. As Sam: **Settings → Appearance** — Club colours or Black & white, and
   Match my phone, Light or Dark. It changes at once, for Sam only.
4. Sign-in and **/for-clubs** stay Squadroom's black and white, whatever the
   club; **/nrifa** is always in NRIFA's colours, whoever opens it.

Until migration 0209 is applied (NEEDS JOEY #12) the second colour is not
saved and Appearance lives on the phone rather than in the profile.

## Known gaps — say them before you are asked

| | |
|---|---|
| **Taking a payment** | Works end to end on Stripe test mode on the laptop (3 Nov, `test-stripe-e2e`). **On the live site** the Stripe keys are not on Netlify yet and NRIFA's Stripe onboarding has not been clicked through, so a parent sees the bill and the screen says the club is still setting up, rather than offering a dead button (NIGHT_LOG, NEEDS JOEY #14). |
| **Push on a phone** | Works, but needs the PWA installed on a device. No notifications in a desktop browser. |
| **Live chat delivery** | Fixed (X-18): messages arrive by broadcast, 40 of 40 in the measurement. Still worth two phones in your hands at a ground before a club sees it. |
| **Native iOS app** | Needs an Apple Developer account. The Capacitor shell is written and has never been compiled. |
| **Match sheets, referees, discipline** | League mode (M9) — being built now so the SPL can run a season without Dribl. Until then, Dribl's. |
| **Refunds, instalments, vouchers, one checkout for several children** | All proven on Stripe test mode on 3 Nov, including the webhook marking each row. Live, they wait on the same two steps as "Taking a payment". |
| **Referee payouts through Stripe** | Parked (Joey, 3 Nov): Stripe will not move money between two connected accounts. Squadroom tracks who refereed and what is owed; the treasurer pays by bank transfer and marks the run paid. |
