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
| Marcus Obi — coach only, no admin rights | `p61400000002@squadroom.invalid` | `squadroom-demo` |
| Sam Whitfield — parent of Leo and Zoe | `p61400000011@squadroom.invalid` | `squadroom-demo` |

The seeded families have `@squadroom.invalid` addresses on purpose — `.invalid`
is reserved so it can never resolve, which is right for a parent who signs up
with a phone number and a dead end for a demo. `scripts/demo-passwords.mjs`
gives them passwords instead; the sign-in screen defaults to a password rather
than a link. **Dev only.**

Open a second browser profile or a private window to hold two sessions at
once. Showing the coach and the parent side by side is the demo.

---

## The ten minutes that sell it

### 1. The coach's morning — sign in as yourself
The home screen is the next fixtures and the chats with unread counts. Nothing
to navigate to.

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
Fixtures with **a row per child**: Leo and Zoe answered separately. Two bills
on **Payments**. **Sign up** shows the three open programs, and the camp says
which child is waitlisted and at what position.

**Settings → "Send it to your child"** is the link a 14-year-old opens: their
next game, kit colour and arrive-by time, no account, nothing to log into.
Children do not get accounts in Squadroom at all.

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

## Known gaps — say them before you are asked

| | |
|---|---|
| **Taking a payment** | Needs a Stripe test key (free, `sk_test_…`). A parent sees the bill and the screen says the club is still setting up, rather than offering a dead button. |
| **Push on a phone** | Works, but needs the PWA installed on a device. No notifications in a desktop browser. |
| **Live chat delivery** | Reliable now via three paths, but the underlying socket drops about one message in five on its own (X-18). The broadcast fix is built and blocked on a Supabase project setting. |
| **Native iOS app** | Needs an Apple Developer account. The Capacitor shell is written and has never been compiled. |
| **Match sheets, referees, player borrowing** | Dribl's, on purpose. Federation functions. |
