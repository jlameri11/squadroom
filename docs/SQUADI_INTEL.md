# Squadi + global platforms: competitive intelligence for Squadroom
*Compiled 30 Oct 2026. Companion to `DRIBL_INTEL.md` and `DRIBL_PARITY.md`.
Confidence: **[H]** primary source (federation memo, official guide, company page) · **[M]** single or secondary source · **[L]** inference or aggregator.*

---

## 0. Bottom line
- **Squadi** (World Sport Action, Sydney) runs Football Queensland (since 2023), Northern NSW (premier comps), Football West, and is rolling out in Football NT (Dec 2025). It **beats Dribl on business model and coverage, not on quality**:
  - It's free to clubs; participants pay card fees.
  - One system covers registration, draws, team sheets, live scores, referees, discipline, shop, ticketing and websites.
  - It sells partnership, customisation and training rather than software.
- **Users dislike it even more than Dribl:**
  - iOS AU 2.3★ (1.3K ratings), Google Play 2.1–2.2★ (100K+ installs), iOS USA 1.9★.
  - Its Queensland launch logged 1,249 support tickets and 100+ redraws in the first weeks.
- **Neither Squadi nor Dribl does chat well.** Squadi's chat is team or individual only. That's Squadroom's opening.
- **The registration landscape changed on 1 Oct 2026.** See Section 1. It affects how Squadroom registration must work for affiliated clubs.

---

## 1. ⚠️ Rule change: Football Australia Circular 26-02 (1 Oct 2026) [H]
Amendments to the National Registration, Status and Transfer Regulations (effective date shown as 22 Sep 2026; confirm against the final regulations):
- **Art. 6.17:** a Player's registration must go through **NORS (PlayFootball) as the "mandatory first point of entry"**. Officials too (16.3). All FA fees and later changes to a registration also go through NORS.
- **Art. 1.1 "Player"** includes anyone registered to play at a Club, MiniRoos, and **"any other football program or type delivered by FA, a Member Federation, a District Association or a Club."**
- **Art. 6.6:** a registration only takes effect once approved in NORS, and **requires a FIFA ID**. If the player was previously at another Club, a **National Transfer in DTMS** must exist first.
- **Art. 6.15:** Clubs must **disclose all their fees, levies and charges in NORS**. Fees must reflect actual costs, and the Club must justify them if challenged.
- **Binds:** FA, Member Federations, District Associations, Clubs, registered Players. **The circular is silent on independent academies and competitions not sanctioned by a Member Federation.**

**What it means for Squadroom:**
1. For any **affiliated** club, program or competition, the order is: **PlayFootball first, Squadroom second.** Squadi now works the same way in Queensland (a pop-up sends users to PlayFootball, then they come back for "Competition Access").
2. Squadroom academy registration remains valuable (programs, kit, consents, payments, squads, chat), but it must:
   - capture the **FFA/FIFA ID**
   - track official status, and **block approval** where the program requires official registration
   - remind clubs to **disclose their fees in PlayFootball**
3. **Find out:** is the SPL sanctioned by Football NSW (so these rules apply) or independent? And is NRIFA a "Club"?

---

## 2. Squadi: what it does (beyond our earlier notes)

### Registration [H]
- **Flow:** register → choose or add a participant → organisation → competition → membership product (player/coach/manager) → age group → extra questions → T&Cs → pay (discount code or government voucher).
- **Family:** parent profile plus linked child profiles, with "switch profile" in the app. A child gets their own login once an email is added.
- **Data collected:** photo (required for referees). Under-18s give school and parent details. Blue Card and accreditation expiry dates are captured.
- **Payments:**
  - Shop items can be bundled into checkout.
  - Instalments run on fixed dates (e.g. 5 monthly), and the federation fee is taken in the first one.
  - Instalments **can't be paid early**.
  - Up to 20 voucher categories, plus government vouchers.
  - "Pending" status until the voucher or direct debit clears.
- **De-registration:**
  - Approved in turn by club → association → state body; a decline at any level ends it.
  - Automatic refund after final approval, with each level refunding its own share.
  - Voucher money can't be refunded.
- **"Move Competition":** within an organisation, no approvals, can be done in bulk. Transfers and ITCs themselves happen in FIFA TMS, not Squadi.
- **"Notice of Offer":** clubs invite returning players back.

### Teams and match day [H]
- **Nominations:**
  - The club drags players into teams and proposes a division with a comment; the organiser sets the final division.
  - Teams lock on submit.
  - Admins can override date-of-birth rules.
  - Teams must be "published to Match Day" before the draw.
- **Team sheet:**
  - Each player is Playing, Bench or Not Playing, with a position.
  - Shirt numbers carry over week to week.
  - Players can be borrowed from other squads, and officials added.
  - Drag-and-drop starting formation.
- **Lock:** sheets lock **30 min before kick-off (seniors) / 15 min (youth)**; after that only the referee can edit.
- **Live scoring:**
  - The home manager assigns a scorer. The scorer taps "+" per team, then the action, then the player (assist optional), with Undo.
  - Corrections go through the action log, but only after full-time.
  - The referee verifies on their own phone, **or on the scorer's phone by entering their mobile number**.
- **Referee finalising:**
  - "Verify action log and scores", then type "Confirm".
  - Sanctions use codes Y1–Y6 and R1–R8.
  - A send-off report form stays on the referee's to-do list until it's done.
- **Match status:** a match is editable until **Ended**, then locked. Corrections go through the federation.
- **Forfeits:** a coach requests, the club approves, then the federation approves.
- **App extras:**
  - QR code to open scoring.
  - ID card / club pass.
  - **Finals eligibility and borrowing limits driven by attendance.**
  - The start button appears 10 minutes before kick-off.
  - Offline scoring is claimed but undocumented, and paper sheets remain the fallback.

### Referees [H]
- Accept or decline with a reason; organisers can **block late declines**.
- Officials can see the others on the same match.
- **Self-appointment** limited by experience. Clubs can allocate their own referees to unfilled games.
- Pools and divisions; assessors can see their matches.
- Pay via **Stripe Connect** to individuals or sole traders, using a parent's details for under-18s.
- Payments only became visible in the app in Dec 2025.

### Discipline [H]
- Federation-set yellow and red card **accumulation thresholds** produce automatic suspensions.
- **An email warning when a player is one card away,** and again when the threshold is reached.
- The match-day dashboard shows pending suspensions and send-off reports.
- Incident categories: First Aid, Discipline, General. Reports can be saved as drafts.
- Automated fines exist per the marketing [M]. No tribunal or appeals workflow was found.

### Competition setup [H]
- Team preferences for field and time.
- **"Fixture Flowing":** after the draw is published, home clubs get a one-week window to rearrange their own home fixtures, with **club-to-club chat on the fixture**.
- Draw summary: match counts per team pair, home/away balance, timeslot rotation.
- An "unavailable field" pop-up shows which teams are affected.
- Drag-and-drop draw, copy a competition to the next year.
- "AI grading" and "the Squadi algorithm" are marketing only, with no public detail.
- **Known flaw:** match-day edits don't flow back to the competition dashboard, and republishing the draw overwrites them.

### Other [H]
- **Parent app:** follow teams/leagues, team and individual chat, recurring events with RSVP, action log, formation, stats.
- **Admin broadcasts:** targeted by organisation, role or year, with an expiry date.
- **Shop:** SKUs, inventory, shipping, order status, partial refunds. **POS** tap-to-pay for canteens. **Ticketing:** seasonal or set-use tickets, with redemption.
- **Website builder:** registration, fixtures, ladders, shop and canteen. FQ funded club migrations.
- **Ad banners** with impressions, clicks and engagement time.
- **Admin:** mandatory **2FA via an authenticator app**, with peer reset.
- **Dashboards:** registrations (new vs returning, gender, age, against targets); live match day (how each score was entered).
- **Finance:** payment summary, per-participant summary, withdrawal exports with a fee column.

---

## 3. Squadi: the business [H unless marked]
- **Company:** World Sport Action Pty Ltd, Mona Vale NSW, with a US subsidiary (squadi USA, 5K+ installs). Sports: football, netball (NetballConnect, Queensland 2021 and Victoria 2021), basketball, gymnastics.
  - Netball Australia chose **PlayHQ** nationally in 2022.
  - ZoomInfo: founded 2018, 11–50 staff, roughly US$7.9M revenue [L].
  - Hosting: AWS Australia. Stripe for payments. AI support via Mistral. No ISO 27001 / SOC 2 claimed.
- **Football timeline:**
  - **FQ:** announced Nov 2022 for 2023–24, replacing GameDay after a 4-week Townsville pilot. Ran alongside GameDay until 1 Mar 2023. Still in use in 2026, so it was renewed.
  - **NNSWF:** Apr 2023, premier competitions only.
  - **Football West:** 2023 season.
  - **Football NT:** rolling out from Dec 2025.
  - No federation has left Squadi.
- **Fees paid by participants:**
  - FQ FAQ: card up to 2.5% + 30c, Amex 2.85%, international 4%, direct debit 2.1% + 30c, Afterpay free.
  - Some clubs show 2.0–2.2% + 30c, so rates vary by contract.
  - FQ also charges its own $7/$8/$10 "technology and transaction service fee".
- **Football Australia's 2026 fee comparison:**
  - PlayFootball 1.98%
  - **PlayHQ 1.99% + 30c**
  - **Squadi 2–4% + 30c**
  - revolutioniseSPORT 2% + $1.60
  - TidyHQ/GameDay 2.7% + 50c
  - PlayHQ list price: A$6–10 per registration.
- **Oct 2026 Queensland fee revolt:** 100+ clubs objected to FQ's proposed 2027 "Competition Access Fee"; FQ dropped it on 16 Oct (ABC). Families resent stacked, itemised fees.
- **PlayFootball link:** FQ built an integration with FA in 2023. FA says data is shared with competition providers via "secure technical integrations". There's **no public partner program**. The likely route is a federation sponsoring the integration.
- **What federations value** (from announcements; no tender documents are public):
  - one system replacing scattered tools
  - less volunteer load
  - mobile team sheets
  - fast results
  - **rollout support** (help hubs, videos, Q&A sessions, hotline, 1:1 setup)
  - willingness to customise (FQ: about 2 years of tailoring)
  - PlayFootball integration
  - instalments and Afterpay
  - low or zero cost to clubs

---

## 4. What users say about Squadi [H/M]
**Ratings:** iOS AU 2.3★ (1.3K), Google Play 2.1–2.2★ (~480 reviews, 100K+ installs), iOS USA 1.9★.

**Complaint themes:**
1. Navigation is hard, and real work is pushed to the website.
2. Bugs and forced updates; scrolling jumps.
3. **Wrong ladders, scores and draws** ("ladders that add points in mysterious ways").
4. Registration and payment failures ("50+ parents unable to register"), plus two systems to deal with.
5. Notifications don't open the right item; multi-team and multi-profile confusion.
6. Weak support: boilerplate "email us" replies (one batch answered 4–6 months late), a broken support link, blaming organisers in public replies.
7. Privacy: "all photos" access forced; questions about biometrics.

**Struggles by role:**
- **Parents:** two systems; child registered under the parent's name; can't edit a child's photo; works better on a computer.
- **Coaches:** "player can't be selected" on match day; managing two teams; borrowing rules.
- **Club admins:** authenticator logins; personal vs admin profile confusion; payments stuck on "Pending"; three-level refund approvals; mass redraws.
- **Referees:** a second profile needed; hard to join a league; verification window rules changed mid-season.

**Praise:** fast scores ("up in minutes"), live score updates, scheduling and stats, officials doing pre- and post-match work on a phone.

---

## 5. Best ideas from global platforms that Dribl and Squadi lack
| Idea | Source | Why it matters |
|---|---|---|
| **Respect / behaviour marks:** referees and the opposition rate players, coaches and **spectators** 1–5; league dashboard; bi-monthly club report against benchmarks | The FA (England), 2026/27 | Parent and coach behaviour is youth football's biggest problem. Gives leagues evidence |
| **Concussion register:** logging an injury locks the player off team sheets until graded return-to-play steps and a medical clearance upload are done (U19: at least 21 days) | FA (Australia) guidelines | Liability and player welfare. A strong sell to leagues |
| **Auto referee assignment:** weighs distance, grade, games-per-day cap, conflicts (own club), declines; preview with skip reasons; undo | HorizonWebRef (US) | Neither Dribl nor Squadi advertises one-click auto-assign |
| **Match QR check-in:** referee scans, sees player photos, confirms the sheet; no app or login needed | GotSport (US) | Fixes casual referees who can't log in |
| **Safeguarding gate:** expired WWCC or missing training automatically blocks someone from rosters, chat and team sheets; reportable-conduct register; audit export | Ankored / SportsEngine | NSW Child Safe Standards; a selling point |
| **Children's privacy consent centre:** verified guardian consent for under-15s, no bundled or pre-ticked consents, renewal every 12 months, private by default | OAIC Children's Online Privacy Code (due 10 Dec 2026) | "Compliant from day one" |
| **League video exchange + clips on player profiles:** attach Veo/Hudl/phone video to a fixture; timestamped clips land on the player's profile and in the parent feed | MLS NEXT × Veo, 360Player, Hudl | Academies sell development; Football NSW already uses Veo for talent ID |
| **Individual development plans + positional assessments + session/curriculum library** | 360Player, TeamSnap ONE | Evidence of development for paying parents |
| **Club-to-club game change requests** with approval | PlayHQ 2025 | Rescheduling without emailing the league |
| **Block attendance when fees are overdue** | SportMember | Ties into instalments |
| **Registration insurance** at checkout (refund for injury or relocation) | PlayHQ | Reduces refund disputes |
| **Pitch and change-room booking + venue info screen** | SportMember | Tight council grounds in Sydney |
| **Casual / pay-per-session / holiday clinics with guest players** | Footy Addicts | A funnel for new players |
| **Auto-translated chat + AI admin assistant** | PlayHQ 2025 | Sydney's many non-English-speaking families |
| **Recurring club lotto / prize draws** | Clubforce, Pitchero | Club income. ⚠️ NSW permit rules apply |
| **Live streaming with a scoreboard overlay** driven by live score taps | Hudl, TeamSnap ONE | Fans and grandparents. Large build |
| **Referee report quality:** custom questions per league, "flag as important", missing-report filter | FA Full-Time | Discipline workflow |
| **Exportable player passport** (registration and club history) | FIFA COMET | Future-proofs identity data |

---

## 6. What Squadroom should do (prioritised)

### A. Copy from Squadi into M9 League mode (the SPL needs these)
1. Team-sheet lock at T-30/T-15, then referee-only edits.
2. Scorer handoff; referee verifies on the scorer's phone with their mobile number; typed "Confirm" to finalise.
3. Match lifecycle **Editable → Ended (locked) → correction request** with an audit trail.
4. Card-accumulation auto-suspensions with **"one card away" warning pushes**; suspended players blocked from sheets; sanction codes.
5. **Attendance-driven finals eligibility and borrowing caps.**
6. Forfeit request: coach → club → league approval.
7. **Fixture Flowing:** after the draw is published, home clubs get a window to adjust home fixtures, with **club-to-club chat on the fixture** (a natural fit for Squadroom's chat).
8. Draw quality summary (pair counts, home/away balance, slot rotation, travel and club clustering) plus an unavailable-field impact pop-up. **One source of truth:** match-day edits are never overwritten by republishing.
9. Referees: accept/decline with a reason, a late-decline block, self-appointment by experience, club-allocated referees for unfilled games, Stripe Connect payouts (parent details for under-18s), payments visible in the app.
10. **Live match-day ops dashboard:** missing sheets, unverified results, pending reports, suspensions, unfilled referees.
11. Nominations: clubs drag players into teams and propose a division with a comment; the league sets the final division; lock on submit; date-of-birth override by admins.
12. Bulk tools: bulk score upload, bulk reschedule (push a round back, double headers, abandon), move a competition in bulk.

### B. Registration and money (M1/M6)
13. **Circular 26-02 compliance:**
    - per-program "requires PlayFootball registration" setting
    - FFA/FIFA ID capture and validation
    - approval blocked until official status is confirmed (when required)
    - PlayFootball export import to tick off status
    - a reminder to disclose club fees in PlayFootball
    - never log in to or scrape PlayFootball
14. Multi-level fee split with each level refunding its own share; finance views per organisation; withdrawal exports with fees.
15. De-registration approval chain (club → league) with automatic refunds; voucher carve-outs.
16. Named voucher types (coach, volunteer, scholarship, sibling, government) with limits and expiry.
17. Direct debit (Stripe BECS) and Afterpay; **allow paying instalments early** (Squadi can't).
18. "Notice of Offer" to invite returning players (extends R-12 rollover and R-13 offers).
19. Shop: standalone and at checkout, inventory and variants, pickup or shipped, partial refunds. Kit sizes feed orders so a supplier such as Libero Apparel can fulfil them.
20. Mandatory **2FA for owners, admins and league admins**.
21. Registration dashboard: new vs returning, age, gender, against targets.

### C. Differentiators Squadi and Dribl don't have (after M9 core)
22. **Respect / behaviour marks** (players, coaches, spectators) with a league dashboard.
23. **Concussion register** with team-sheet lockout and clearance upload.
24. **Safeguarding gate** (WWCC or training lapses block rosters, chat and sheets) plus a reportable-conduct register.
25. **Children's privacy consent centre** (Privacy Code).
26. **Auto referee assignment** with preview and undo.
27. **Match QR check-in** for referees.
28. Club-to-club game change requests; block attendance on overdue fees.
29. Auto-translated chat.
30. Later: video clips on player profiles and a league video exchange; development plans; pitch booking; casual sessions; registration insurance; streaming; lotto (check NSW permits first).

### D. Win on what users hate about Squadi and Dribl
- **Everything works on the phone.** No "do it on the website".
- **One flow for families.** Profiles are clearly the child's, not the parent's; parents can edit their own child's photo.
- Notifications open the exact item.
- **Ladder audit:** tap a ladder row to see how every point was earned.
- **A sanity check before publishing a generated draw** (empty slots, travel, same-club clashes).
- Ask for selected photos only, never "all photos".
- **Support:** fast human replies, a match-day hotline, staged rollouts (pilot one division first), never blaming organisers publicly.
- Transparent, published pricing. Show families one clear total, not stacked fees.

### E. Pricing position (decision for Joey)
- **Benchmarks:** PlayHQ 1.99% + 30c; Squadi 2–4% + 30c; Stripe AU costs about 1.7% + 30c.
- **Current Squadroom rule:** "never charges parents".
- **Option to consider:** free for clubs and leagues; families pay **Stripe's fee at cost** (no Squadroom margin); revenue from league and academy plans. Publish it.

---

## Sources
- **Squadi:** [Soccer](https://squadi.com/soccer/) · [Competition mgmt](https://squadi.com/competition-management/) · [Live scoring](https://squadi.com/live-scoring/) · [About](https://squadi.com/about-squadi/) · [eCommerce](https://squadi.com/ecommerce/) · [WSA privacy policy](https://worldsportaction.com/privacy-policy/)
- **Football Queensland:** [Squadi FAQs](https://footballqueensland.com.au/Resources/squadi-faqs/) · [2022 announcement](https://footballqueensland.com.au/2022/11/23/football-queensland-announces-partnership-with-world-sport-action-as-competition-management-services-provider-for-2023-2024/) · [Implementation update Feb 2023](https://footballqueensland.com.au/2023/02/04/update-on-implementation-of-squadi-platform/) · [Rollout update Mar 2023](https://footballqueensland.com.au/2023/03/17/football-queensland-update-on-the-rollout-of-squadi/) · [Dev Update May 2024](https://footballqueensland.com.au/wp-content/uploads/2024/05/Squadi-Development-Update-May-2024.pdf) · [Memo 41-25](https://footballqueensland.com.au/wp-content/uploads/2025/10/41-25-FQ-Memo-2026-PlayFootball-Participant-Registration.pdf) · [Memo 44-25](https://footballqueensland.com.au/wp-content/uploads/2025/11/44-25-FQ-Memo-2026-Notice-of-Offer-Competition-Access-Update.pdf) · [Fixture Flowing guide](https://footballqueensland.com.au/wp-content/uploads/2025/02/Squadi-Help-Guide-2025-Fixture-Flowing.pdf) · [Team preferences](https://footballqueensland.com.au/wp-content/uploads/2025/02/Squadi-Help-Guide-2025-How-to-Add-Team-Preferences.pdf) · [Results FAQ](https://footballqueensland.com.au/wp-content/uploads/2026/06/Recording-Match-Results-in-Squadi-Club-FAQs.pdf) · [Referee registration guide](https://footballqueensland.com.au/wp-content/uploads/2024/05/Referee-Squadi-Registration-Guide.pdf) · [Parents guide](https://footballqueensland.com.au/wp-content/uploads/2024/02/Squadi-Help-Guide-Parents-App-V1.pdf) · [Fees fact check](https://footballqueensland.com.au/football-queensland-fees-fact-check/)
- **Northern NSW / Football West / NT:** [NNSWF partnership](https://northernnswfootball.com.au/news/nnswf-announces-partnership-world-sport-action-competition-management-services-provider) · [NNSWF Squadi FAQs](https://northernnswfootball.com.au/squadi-faqs) · [NNSWF Matchday Procedures](https://northernnswfootball.com.au/sites/nnswf/files/2026-02/Matchday%20Procedures.pdf) · [FW Squadi](https://footballwest.com.au/squadi) · [FW team sheet guide](https://footballwest.com.au/wp-content/uploads/2026/04/User-Guide-Completing-Team-Sheet-Substitution.pdf) · [FW live scoring guide](https://footballwest.com.au/wp-content/uploads/2026/04/User-Guide-Scoring-a-Match-Live.pdf) · [FQ × Football NT](https://www.soccerscene.com.au/football-qld-strengthens-ties-with-football-nt-in-new-deal/)
- **Clubs:** [Southside Eagles guide](https://www.southsideeagles.com/squadi-how-to-guide) · [Souths United 2026](https://southsunited.org.au/page/registering-2026-season) · [Toowong FC FAQ](https://toowongfc.com.au/2025/02/10/faqs-registration-2025/)
- **Football Australia:** [Circular 26-02 (1 Oct 2026)](https://footballaustralia.com.au/sites/default/files/2026-10/26-1001%20-%20Football%20Australia%20Circular%20-%20Amendments%20to%20National%20Registration%2C%20Status%20and%20Transfer%20Regulations.pdf) · [2026 Service Fee FAQs](https://footballaustralia.com.au/sites/default/files/2025-12/2026%20Service%20Fee%20FAQs.pdf) · [FA submission to OAIC](https://www.oaic.gov.au/__data/assets/pdf_file/0034/266695/Football-Australia.PDF)
- **News:** [ABC: FQ fee backlash](https://www.abc.net.au/news/2026-10-07/football-queensland-player-registration-fee-backlash/107240208) · [ABC: FQ backflip](https://www.abc.net.au/news/2026-10-16/football-queensland-fee-backflip/107276500)
- **Apps:** [Squadi iOS AU reviews](https://apps.apple.com/au/app/squadi/id1614546003?see-all=reviews&platform=iphone) · [Google Play AU](https://play.google.com/store/apps/details?id=com.wsa.squadi&hl=en-AU) · [squadi USA](https://apps.apple.com/app/id6473519715)
- **Global:** [FA Respect marks 26/27](https://grassrootstechnology.thefa.com/support/solutions/articles/48001285393-updated-respect-marks-for-2026-27) · [FA Matchday](https://www.thefa.com/get-involved/matchday/about-matchday) · [FA referee reports](https://grassrootstechnology.thefa.com/support/solutions/articles/48001187368-referee-reports) · [GotSport match QR](https://app.tcslsoccer.com/guides/digitalgameday/team/accessing-the-match-qr-code-to-give-match-officials) · [HorizonWebRef auto-assign](https://helpcenter.horizonwebref.com/en/articles/6229197-how-to-use-auto-assign) · [360Player](https://360player.com/product/player-development) · [MLS NEXT × Veo](https://www.mlssoccer.com/news/mls-next-and-veo-to-deliver-advanced-video-exchange-to-north-america-youth-soccer) · [PlayHQ 2025 releases](https://support.playhq.com/hc/en-us/articles/23891960971292-Release-Notes-2025) · [PlayHQ pricing](https://get.playhq.com/pricing) · [SportMember](https://www.sportmember.co.uk/en/team-app/complete-club-and-association-app-for-coaches-players-and-parents) · [Ankored](https://www.ankored.com/blog/how-to-compare-youth-sports-background-check-platforms) · [FA concussion guidelines (PDF)](https://archive.balmainfootball.com.au/wp-content/uploads/2025/06/Football-Canterbury_Heading-and-Concussion-Document_Combined.pdf) · [Allens: Children's Privacy Code](https://www.allens.com.au/insights-news/insights/2026/04/draft-childrens-online-privacy-code-proposed-protections-to-have-material-impact-on-online-services/) · [Office of Sport NSW child safety](https://www.sport.nsw.gov.au/running-your-club/safe-and-fair-clubs/child-safe-sport/child-safety-laws-nsw) · [FIFA COMET passport](https://kb.analyticom.de/comet/electronic-player-passport)
