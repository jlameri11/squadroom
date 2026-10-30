# Heja + TeamSnap: what makes team apps simple and loved
*Compiled 30 Oct 2026 for Squadroom. Companion to DRIBL_INTEL.md and SQUADI_INTEL.md.*

## 0. Bottom line
- **Heja** (4.8★, ~55K iOS ratings; Stockholm; 50 countries, with the US, UK, Australia and NZ leading) and **TeamSnap** (4.7★, ~130K ratings; 19K+ orgs, 30M users) are the best-loved team apps.
- Heja is loved because it **does very little, with strong defaults**. TeamSnap is loved for chat, scheduling and rosters.
- **Users hate the same things in both:** ads, paywalled basics, notification noise, important news buried in chat, and confusing navigation. TeamSnap also had a botched migration to a second app.
- **Squadroom is on the right track.** It already copies most of what users love and avoids most of what they hate. It also fills the gaps neither app covers in Australia:
  - Heja: no in-app payments in Australia, a "club" that is only two chats, and a paid multi-child schedule.
  - TeamSnap ONE: sold only to clubs, US-centric.

## 1. Heja: why it feels simple
- **Navigation:** Home feed (posts) · Schedule · Messages · Team · You. One team at a time. The combined all-teams schedule is a **paid** parent add-on.
- **Coach onboarding:** "Create team" makes the account and team in one go. It can pre-load **sample activities with test users** so the coach sees how RSVPs look straight away, and a **progress-bar checklist** guides the first steps.
- **Parent onboarding:** enter a team code (XX-XXXXXX), pick a role, add or link a child. About 5 steps. Coaches share the code via WhatsApp or SMS; **coaches can't add adults themselves**.
- **Kids:** under-13 profiles are managed by a parent with no login, and can be handed to the child later with approval.
- **RSVP:** every event starts as "unanswered", then Yes/No with an optional note.
- **Automatic reminders:**
  - 3h before
  - morning-of (different wording for answered vs unanswered)
  - Sun/Wed/Fri nudges to non-responders about the next 7 days
  - Pro adds "Remind now" and drop-out alerts
- **"Notify team?" on edit:** when an event is edited, the coach chooses whether to notify, and only people who are going get told.
- **Posts vs chat:** posts are one-to-all with "seen by" and can be restricted to coaches; chat stays open. Team chat and coach chat are created automatically.
- **Safeguarding on by default:** parents see their child's conversations, new contacts with a child need approval, and medical and contact fields are admin-only.
- **Leaves out on purpose:** registration, league management, a club console, rich RSVP states.
- **Copy and tone:** warm and short; parents are called "supporters".
- **Business:**
  - free with ads, capped at one full-screen ad every 3 days, none for under-13s
  - Team Pro US$99.99/yr; Pro Max US$139.99/yr
  - Heja Plus (parents) US$29.99/yr
  - growth is coach-led: one coach brings in about 20 families
- **Complaints:**
  - ads (~15%)
  - paid calendar sync (~10%)
  - freezes
  - reminders sent to people who already answered
  - notification badges that lead nowhere
  - can't scroll back through chat history
  - slow to enter a whole season
  - getting parents to adopt it at all

## 2. TeamSnap: how it scales from team to league
- **Two products:** classic TeamSnap (freemium, for one team) and **TeamSnap ONE** (club/league platform plus a separate app, launched Nov 2025).
- **ONE parent app has 3 areas:**
  - **Home:** my teams plus today
  - **Schedule:** all teams and kids merged
  - **Messages:** alerts, team chats, DMs and groups in one inbox

  Club tools live in a web Org Portal that parents never see.
- **Family joining:** code, link or QR, then claim your child from the roster and confirm their date of birth. The first guardian becomes primary and can invite or promote others.
- **Admin to app flow (one source of truth):**
  1. Registration forms (copyable each season, with a separate staff registration)
  2. Divisions and teams
  3. Rostering; **welcome emails held until the admin publishes rosters**
  4. Families appear in the app automatically, with a placement email
- **Admins can read and join team chats** and push alerts.
- **Features:**
  - **Assignments:** snacks, volunteers, jobs; sign-up or assigned
  - **Tracking items:** a per-player checklist, e.g. form handed in, uniform received
  - **Alerts channel:** urgent, can't be replied to, admins only
  - chat polls; tag players in media; score entry
  - subscribe to one team's calendar
  - **Org Invoicing:** up to 24 instalments, bank payments, automatic overdue reminders
  - Health Check questionnaire
  - **Live streaming** from a phone at 720p, 60-second clips, a shareable link; paid replays
- **Business:**
  - classic Premium ~US$130/yr; Ultra ~US$165/yr
  - parents still see ads unless they pay for ad removal themselves
  - ONE priced per organisation ("No hidden fees. Ever.")
  - card fees passed to families by default, which is resented
- **Complaints:**
  - ads ("beyond nauseating")
  - attachments and photos from mobile
  - stale RSVPs and sync bugs
  - too many or missing notifications
  - paywalls (availability is Premium-only)
  - confusing navigation and households
  - **five overlapping message types**, with replies landing in email
  - the ONE migration lost features ("significant step backwards")
  - support (Trustpilot 1.1★)

## 3. Squadroom against the best-practice list
| Best practice | Squadroom |
|---|---|
| One link/code/QR per team; join in under a minute; claim child | ✅ join links, QR, join codes (X-21), coach approval |
| Parents manage child profiles; no child logins by default | ✅ guardians hold accounts; player accounts optional (13+) |
| Safeguarding on by default; no adult alone with a child | ✅ 0076, DM policy, phone numbers staff-only |
| Auto-created team and coach chats | ✅ team, coaches and academy-wide channels |
| Announcements separate from chat, with "seen by" | ✅ hosts-only/announcement channels, pins, C-01 Seen by + nudge |
| RSVP with "unanswered" visible, plus reminders and one-tap chase | ✅ "Can't play" with a reason (richer than Heja), 24h/2h reminders, E-03 chase |
| One combined schedule across kids and teams, **free** | ✅ family view + child chips, free calendar feed |
| Notifications open the exact item | ✅ (keep testing) |
| No ads; core features never paywalled; parents never pay the platform | ✅ by rule |
| Admin data flows into the team app automatically | ✅ registration → approval → squad → channels and calendar |
| In-app payments work in Australia; instalments; overdue reminders | ✅ built (needs the Stripe test key to prove) |
| Club/league layer hidden from parents | ✅ by role; keep it that way (simplicity rule 1) |

## 4. Worth adding (small, high value)
1. **Coach first-run demo:** a new team starts with sample events and fake RSVPs, plus a checklist bar ("Invite families → Add training → Post first announcement") that disappears once done.
2. **Event jobs:** sign-up slots on any event (oranges, canteen, linesperson/assistant referee, carpool, set-up), so they don't get lost in chat.
3. **Smarter reminder schedule:**
   - morning-of reminder, worded differently for answered vs unanswered
   - a weekly digest nudge to non-responders ("3 events this week need your answer")
   - never remind people who already answered
4. **"Notify team?" on minor edits:** when an event is edited (not cancelled or moved), the coach chooses whether to notify, and only people going are told. Cancellations and moves still always notify everyone (existing rule).
5. **Publish squads before welcoming families:** a new season's squads stay in draft until the admin publishes; then families get one placement message plus access, all at once.
6. **Tracking checklist per player** (form returned, kit received, PlayFootball done) that staff can see at a glance. Reuses R-14 and kit data.
7. **Copy and tone:** short, warm, parent-as-supporter wording across the app.

## 5. Avoid (from their mistakes)
- Ads of any kind; paywalling RSVP, calendar sync, attachments or the multi-child view.
- Separate apps for clubs and parents, or any relaunch that drops features.
- More than one way to message the same people (Squadroom: one chat + announcement channels + DMs, never email threads).
- Reminders to people who already answered; badges with nothing behind them.
- Email-only support; hard-to-delete accounts (S-05 export/delete covers this).

## Sources
- **Heja:** [Main features](https://help.heja.io/en/articles/2483013-heja-s-main-features) · [Multiple teams](https://help.heja.io/en/articles/12310118-managing-multiple-teams-on-heja) · [Plans](https://help.heja.io/en/articles/8061610-what-is-the-difference-between-heja-plus-team-pro-team-pro-max) · [Demo guide](https://help.heja.io/en/articles/12974764-how-to-demo-the-heja-platform) · [Join](https://help.heja.io/en/articles/12870390-how-to-join-heja) · [Inviting](https://help.heja.io/en/articles/2455365-inviting-members-to-your-team) · [Safety for minors](https://help.heja.io/en/articles/8812912-heja-s-safety-measures-for-minors) · [RSVP](https://help.heja.io/en/articles/14643676-how-to-rsvp-to-an-activity-in-heja) · [Reminders](https://help.heja.io/articles/2455312-how-when-are-activity-reminders-sent-out) · [Pro features](https://help.heja.io/en/articles/4358964-team-pro-pro-max-features) · [Payment fees](https://help.heja.io/en/articles/4707227-understanding-the-service-fee-for-in-app-payments) · [Club Connect](https://help.heja.io/en/articles/11549829-what-is-club-connect) · [Ads](https://help.heja.io/en/articles/9236458-ads-on-heja) · [Pricing](https://heja.io/pricing) · [App Store](https://apps.apple.com/app/id1157335714) · [mwm.ai](https://mwm.ai/apps/heja/1157335714) · [tech.eu](https://tech.eu/2021/06/07/stockholms-youth-sports-management-social-platform-heja-scores-4-2-million-goes-for-the-gold)
- **TeamSnap:** [TeamSnap ONE launch](https://www.teamsnap.com/blog/announcements/teamsnap-unveils-teamsnap-one-next-generation-platform-future-youth-sports-technology) · [ONE mobile guide](https://teams-help.teamsnap.com/article/2970-teamsnap-one-mobile-guide-staff-parents-and-players) · [Join guide](https://teams-help.teamsnap.com/article/3004-how-to-join-and-connect-with-your-player-s-team-in-teamsnap-one) · [ONE release notes Jan 2026](https://teamsnapone.launchnotes.io/announcements/ann_e8MwMb5PX343a) · [Mar 2026](https://teamsnapone.launchnotes.io/announcements/ann_GEZnMT9ARk0gM) · [Jun 2026](https://teamsnapone.launchnotes.io/announcements/ann_pxpM2g4TRBOEM) · [AYSO wiki](https://wiki.ayso.org/wiki/TeamSnap_ONE) · [Owner setup guide](https://helpme.teamsnap.com/article/183-set-up-guide-for-team-owners) · [Message types](https://helpme.teamsnap.com/article/434-overview-of-message-types) · [Assignments free](https://www.teamsnap.com/blog/announcements/assignments-now-free-for-all-users) · [Soccer pricing](https://www.teamsnap.com/teams/sports/soccer) · [Payment fee settings](https://helpme.teamsnap.com/article/1314-select-payment-methods-and-automatic-adjustments) · [App Store](https://apps.apple.com/us/app/teamsnap/id393048976) · [ONE App Store](https://apps.apple.com/app/id6670517733) · [mwm.ai](https://mwm.ai/apps/teamsnap/393048976) · [Trustpilot](https://at.trustpilot.com/review/teamsnap.com) · [Capterra](https://www.capterra.com/p/123208/TeamSnap/reviews/)
