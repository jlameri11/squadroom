# Dribl: Competitive Intelligence Report
*Compiled 23 Oct 2026 for Squadroom. Confidence: **[H]** official or federation document · **[M]** secondary source · **[L]** vendor claim or inference.*

---

## 1. Bottom line
- **Dribl is the federation's competition system, not a club or academy app.** Football NSW, Capital Football, Football SA, Football Tasmania and (from the 2026 season) Football Victoria mandate it for fixtures, match sheets, referees and results. Clubs can't leave it. **[H]**
- **Official player registration is not Dribl.** It's Football Australia's **PlayFootball** (1.98% service fee in 2026), which syncs into Dribl about an hour after approval. Dribl's own registration product (Connect) is mostly used for social/summer comps, holiday programs and add-ons. **[H]**
- **Communication is Dribl's weakest area.** Its website claims "team communications and chat", but no federation guide, release note or review mentions a chat feature. In practice its comms are push alerts for fixture changes plus email from the web admin. **[L/M]**
- **Users dislike the app.** It rates **2.3★ on Google Play** (260 reviews, 100K+ downloads) and **2.8–2.9★ on iOS** (~285 ratings). About 73% of written iOS reviews are 1–2★, and there are no developer replies. **[H/M]**
- **Squadroom's opening:** the academy's operating system (comms, events, availability, academy registration and billing, development, safeguarding) that **reads from Dribl** rather than fighting it.

---

## 2. Company
| | |
|---|---|
| Entity | DRIBL PTY LTD, Sydney (Revesby NSW) |
| Founded | 2016 by Rob Georgievski (CEO) and Chris Boulamatsis **[H]** |
| Funding | No public round found **[M]** |
| Claims | "1,000+ clubs, leagues, associations", "1M+ registered users", "70%+ of Australia's football ecosystem" (Nov 2025) **[L]** |
| Customers | FNSW (2022), Capital Football (2022), Football SA (2023), Football Tasmania (2023), Football Victoria (2026), Macarthur FA (2026), AWFA (2026), NSFA, Manly Warringah, Canterbury & District, plus CONIFA, Homeless World Cup, Laos (via Koach Hub) **[H]** |
| Not customers | Football Queensland, Football West and Northern NSW Football use **Squadi** (World Sport Action) **[H]** |
| Pricing | Not public; bundled into federation and association fees. Free app with no in-app purchases **[M]** |
| Vision (AI camera) | Marketing only; no launch, pricing or deployments found **[L]** |

---

## 3. Full feature inventory

### Registration (Connect)
- Product types: **Competition** or **Program** (camps, clinics). Gender/role/age limits, registrant cap, SKU, form template. **[H]**
- **Fee split per product** (e.g. $100 to the association + $165 to the club). **[H]**
- **Team Creator / Team Link** products: a captain registers a team and teammates join with a code (social football). **[H]**
- Family: one login registers several dependants; duplicate detection on name+gender+DOB fills in FFA/Dribl numbers. **[H]**
- Emergency contacts, registration photo, government (Active Kids) and club vouchers, optional merch/program/team-nomination steps. **[H]**
- Payment: card, bank transfer or pay later, via **Stripe Connect Express** (set up by the club's Financial Controller). **[H]**
- Double approval (club store, then Dribl). Deregistration with full or partial refund, cut-off dates. **[H]**
- **Not found:** instalments, sibling discount rules, custom questions. Clubs handle these manually. **[M]**
- Transfers and clearances happen in PlayFootball. **[M]**

### Teams and members
- Teams by competition, age group, division, gender, min/max players. **[H]**
- **Team mapping:** one team per player, season jersey number, federation approval needed to appear on a match sheet. **[H]**
- Borrowing players per match (league rules; suspended players blocked; borrowing export). **[H]**
- About 25 roles: Body/Club Admin, Age Coordinator, Financial Controller, Adjudicator, Recorder, Reporter, Guardian, Viewer, Game Leader, coach, manager, player, referee, supporter. **[H]**
- Bulk regrades and bulk account activation, bans and card accumulation, ID cards, digital membership cards, alias/photo exclusion for public pages. **[H]**

### Competition management
- Fixtures timeline with clash blocking, byes, knockouts and finals, extra time and penalties. **[H]**
- Ladder adjustments, club championships, forfeit requests, disputes, abandonments and washouts, postponement emails. **[H]**
- **Match sheets:** submit, then opposition confirms (locks); goals, cards (incl. blue cards), subs, votes, audit stamps; match commissioner. **[H]**
- Under-12 scores kept private (grading only). Futsal fouls. Social tournaments (Sep 2025). **[H]**

### Referees (Command)
- Availability (recurring, zones, venues, age limits), panels, cross-association allocation. **[H]**
- Appointments pushed to the app: Accept or "Request Contact" (no formal decline). Check-in required on match day. **[H]**
- Pay through Stripe: rate cards, branch levies, home/away split, payslips. Pay runs were delayed in Aug 2026. **[H]**

### App (Unity)
- Follow teams and leagues, in-app calendar, ladders, squads, stats, directions. **[H]**
- Push notifications for fixture changes, postponements and washouts. **[H]**
- Match-sheet availability with a reason, **but managers can't see the reason and there's no "can't play" state**. **[M]**
- **Calendar sync (Google/Outlook) shipped only in Android v4.1.7 on 19 Oct 2026.** Before that, hobbyists built their own iCal scrapers. **[H]**
- Theme setting (May 2026), match feedback survey (Feb 2025). **[H]**

### Data and integrations
- **Club-wide fixture export exists:** Dribl Web → Events → Filter (date/league/age) → Export → Events → Exports menu → download spreadsheet (FNSW KB, Dec 2025; role not stated, aimed at club admins). **[H]**
- Public match centre per body (fv., fsa., nsfa., awfa.dribl.com), a single-page web app on an **undocumented API (mc-api.dribl.com) behind Cloudflare**. Hobbyists use Playwright to get past it. FNSW's competition site is built on that API by an agency. **[H/M]**
- No public API docs, embeddable widgets or official iCal feed. **[M]**

---

## 4. What users say
**Ratings:** Google Play 2.3★ (260 reviews, 100K+ installs, updated May 2026). iOS 2.8–2.9★ (~285). Of ~111 written iOS reviews, 67 are 1★.

**Complaints, ranked:**
1. **Navigation is confusing:** finding teams, ladders and club points; many taps to follow a team. ("Can you make this app anymore convoluted and confusing to use!")
2. **Login and accounts:** daily logouts (iOS fix only in v4.1.0), the email must match PlayFootball exactly, "Member" vs "Supporter" confusion, and the fix is often delete-and-restart.
3. **No calendar sync**, the top request until Oct 2026.
4. **Updates break things** (mid-2026 cluster: "newest update broke everything").
5. **Results slow or wrong:** 3–4 day delays; both teams must enter matching scores.
6. **Availability can't be read:** no "can't play" state, reasons hidden from managers.
7. **Multiple kids or teams** is painful.
8. **Search is broken.**
9. **Support is hard to reach:** separate help-portal login, and clubs can't raise tickets for members.

**Match-day friction:** a late player means unconfirming and resubmitting the sheet in front of the opposition. Jersey numbers sit behind a hidden long-press. There's a **$25 fine per late match sheet**, and outages aren't excused without screenshots.

**Praise:** fixture detail, ladders, locations, everything in one place. Federations like paperless team sheets.

---

## 5. Competitor landscape
| App | Strength | Chat | Rego/payments | Pricing | Weakness |
|---|---|---|---|---|---|
| **WhatsApp Communities** | Everyone has it; announcement groups, polls, events/RSVP; **member tags + event reminders (Jan 2026)** | Excellent | None | Free | No rosters, guardian links, payments or analytics; **exposes phone numbers** |
| **Spond** | Free; RSVP, auto-reminders, guardian accounts, payment requests, subscriptions with retries | Medium (tied to groups/events, no search) | Yes | Free; **2.5% + A$0.30** per payment | Notification overload; clubs still copy into WhatsApp |
| **Stack Team App** (AU) | 7M members; news, events, store, tickets, access groups | Medium (read receipts added Sep 2026) | Yes | Free with ads; A$4.49/yr to remove ads | Busy, dated design |
| **PlayHQ** (AU) | Rego, fixtures, live scores | Notifications only | Strong | A$6–10 per registration | Not used by football federations |
| **Heja** | Clean coach/parent app | Good | Partial | Pro ~US$100/yr per team | Per-team pricing |
| **TeamSnap ONE** | Full club platform, streaming | Good | Strong | US$600+/yr per club | US-centric, ads |
| **360Player** | Development: video, drills, stats | Good | Yes | From ~US$49/mo | Opaque pricing |

**Table stakes:** free parent app, events with RSVP, recurring sessions, calendar sync, chat + DMs + admin-only announcements, polls, push, guardian/child accounts, roles, payment requests with fee pass-through, invite links, bulk import, attendance exports.

**Gaps nobody fills for Australian football academies:**
1. Linking parent chat to Dribl fixtures (and PlayFootball status).
2. Academy billing: term fees, instalments, sibling discounts, trials, make-up credits.
3. Chat parents will actually move to from WhatsApp: per-child filters, team labels, announcements separate from chat.
4. One parent login across club + academy + rep program.
5. Safeguarding built in: WWCC tracking, the rule against private adult-to-child messages, hidden phone numbers.
6. Development records + paid tours/camps with deposits.
7. Local support and AUD pricing.

**Pricing benchmark for Squadroom:** free for parents and coaches · payment fee ~**2.5% + A$0.30** (Stripe AU costs about 1.7% + A$0.30, pass-through optional) · academy tier **A$99–249/month** (branding, Dribl sync, multiple squads, development tools).

---

## 6. Regulatory (Australia, 2026)
- **Under-16 social media minimum age (in force 10 Dec 2025):** services whose sole or primary purpose is messaging are excluded. Squadroom is likely outside it as a team-chat + events app, but it's a self-assessment. **Avoid public feeds, public profiles and open posting.** **[M-H]**
- **Children's Online Privacy Code (OAIC):** must be registered by **10 Dec 2026**; the draft covers messaging-type services likely to be used by children. Expect verified parental consent for under-15s, data minimisation, age assurance, a child-friendly privacy policy, deletion on request and privacy impact assessments. Small-business exemption is unclear. **Get legal advice before launching to other academies.** **[M]**
- **NSW Child Safe Scheme:** the academy must meet the 10 Child Safe Standards. **[H]**
- **WWCC verification:** through the OCG Employer Portal or the Service NSW QR check; **no public API**. PlayFootball 2.0 already runs WWCC for registered officials. **[H/M]**
- **Sport Integrity Australia:** adults in authority must not message a child one-to-one unless a parent/carer or club representative is included. **[H]**

---

## 7. Actions for Joey
1. **Ask the SPL competition admin / FNSW for club-admin access to NRIFA's teams in Dribl.** That unlocks the club-wide Events export, the cleanest source for fixturefeed and Squadroom sync, and cuts out the per-team scraping and sign-out failures.
2. Treat the public match-centre API as a fallback only (Cloudflare-protected, undocumented; check Dribl's terms of use).
3. Longer term: ask Dribl for partner/API access. You'd be driving app engagement *to* their fixtures, not competing with their match sheets.
4. To expand beyond NSW/VIC/SA/ACT/TAS you'll need a **Squadi** adapter (QLD, WA, Northern NSW).
5. Get a privacy lawyer to review against the Children's Online Privacy Code before selling to other academies.

---

## Sources
- Dribl: [Our Platform](https://dribl.com/our-platform/) · [News](https://dribl.com/news/) · [Products](https://help.dribl.com/hc/en-au/articles/5444783957263-Products) · [Registrations Overview](https://help.dribl.com/hc/en-au/articles/4408424744719-Registrations-Overview) · [Approve Registrations](https://help.dribl.com/hc/en-au/articles/5561033320335-Approve-Registrations) · [Deregister](https://help.dribl.com/hc/en-au/articles/5562041897231-Deregister-Registrants) · [Connect Account](https://help.dribl.com/hc/en-au/articles/6247462916751-Setup-Connect-Account) · [May 2022 notes](https://help.dribl.com/hc/en-au/articles/5134090609807-May-2022)
- Federations: [FNSW club fixture export](https://kb.footballnsw.com.au/kb/how-to-export-your-clubs-fixtures-in-dribl/) · [FNSW roles](https://kb.footballnsw.com.au/?p=32600) · [FNSW referee pay](https://footballnsw.com.au/?p=116983) · [FV Dribl rollout](https://footballvictoria.com.au/news/dribl-transform-victorian-football-competition-management) · [FV coach & manager training](https://footballvictoria.com.au/sites/ffv/files/2026-01/Coach%20%26%20Manager%20Training%20FV.pdf) · [FV roles guide](https://footballvictoria.com.au/sites/ffv/files/2026-02/FV%20DRIBL%20User%20Guide%20-%20Club%20Administrator%20%26%20Member%20Access.pdf) · [FV team mapping](https://footballvictoria.com.au/sites/ffv/files/2026-02/FV%20DRIBL%20User%20Guide%20-%20Team%20Mapping%20%26%20Borrowing.pdf) · [FSA](https://footballsa.com.au/news/senior-mens-and-womens-2023-fixtures-revealed-new-competition-management-system-dribl) · [Capital Football](https://capitalfootball.com.au/dribl-for-competition-management/) · [FQ PlayFootball memo](https://footballqueensland.com.au/wp-content/uploads/2025/10/41-25-FQ-Memo-2026-PlayFootball-Participant-Registration.pdf) · [NNSWF Squadi](https://northernnswfootball.com.au/news/nnswf-announces-partnership-world-sport-action-competition-management-services-provider) · [PlayFootball 2026 fee](https://footballaustralia.com.au/sites/default/files/2025-12/2026%20Service%20Fee%20FAQs.pdf)
- Clubs: [Penno FC Dribl guide](https://www.pennofc.com.au/resources/dribl) · [Abbotsford JFC access issues](https://www.abbotsfordjuniorsfc.com.au/dribl-match-sheet-access-issues/) · [BSSFC registration guide](https://bssfc.com.au/wp-content/uploads/2023/01/BSSFC-Registration-Guide-2023-Dribl.pdf)
- Apps and reviews: [App Store reviews](https://apps.apple.com/au/app/1555038633?see-all=reviews&platform=iphone) · [Google Play](https://play.google.com/store/apps/details?id=com.dribl.app&hl=en_AU) · [mwm.ai](https://mwm.ai/apps/dribl/1555038633) · [APKPure v4.1.7](https://apkpure.com/dribl/com.dribl.app) · [dribl-ics (community iCal)](https://github.com/slappa81/dribl-ics) · [apidribl](https://github.com/Data-Monkey/apidribl)
- Company: [Soccer Scene profile](https://www.soccerscene.com.au/dribl-footballs-passion-project-set-to-change-the-game/) · [Soccer Scene Tasmania](https://www.soccerscene.com.au/football-tasmania-and-dribl-combine-to-manage-clubs-in-the-state/)
- Competitors: [Spond AUD fees](https://help.spond.com/club/en/articles/58192-what-is-the-transaction-fee-in-spond-club) · [Stack Team App](https://apps.apple.com/us/app/stack-team-app/id625607532) · [PlayHQ pricing](https://get.playhq.com/pricing) · [Heja fees](https://help.heja.io/en/articles/6114466-what-s-the-fee-for-in-app-payments) · [TeamSnap ONE](https://teamsnap.com/one) · [360Player](https://www.360player.com/pricing) · [WhatsApp Jan 2026 group features](https://about.fb.com/news/2026/01/whatsapp-group-chats-member-tags-text-stickers-event-reminders/)
- Regulatory: [Sport Integrity Australia](https://www.sportintegrity.gov.au/dos-and-donts/digital-communication) · [Clayton Utz: age restrictions](https://www.claytonutz.com/insights/2025/october/social-media-age-restrictions-esafety-commissioner-provides-regulatory-guidance) · [DLA Piper: Children's Online Privacy Code](https://privacymatters.dlapiper.com/2026/04/australia-exposure-draft-of-childrens-online-privacy-code-signals-tougher-standards/) · [NSW OCG Child Safe Scheme](https://ocg.nsw.gov.au/child-safe-scheme/sector-specific/sport-and-recreation) · [Service NSW WWCC verify](https://www.service.nsw.gov.au/transaction/verify-your-wwcc-workers)

---

## 8. Addendum: final scan of the Dribl app experience (23 Oct 2026)
- **Navigation:** Home ("My Matches" calendar you swipe by date) · Following ("My Hub": teams and leagues) · Profile (settings, notifications, account, memberships). Following a team takes about 7 taps (body → club → team → tick). [FNSW](https://kb.footballnsw.com.au/kb/how-to-follow-at-team-and-league/)
- **Match Centre tabs:** Overview (score, ground map + directions, next game) · Facts (Player of the Match, goals, cards) · Table · Lineups (pitch graphic) · Match Sheet. [mwm.ai](https://mwm.ai/ja/apps/dribl/1555038633)
- **No live scoring:** match events appear only after the match sheet is completed. [FNSW](https://kb.footballnsw.com.au/kb/how-to-view-match-stats-via-the-dribl-app/)
- **Junior stats are empty:** FNSW guides record goals and subs only for 1st Grade, Reserve Grade and U20. [FNSW](https://kb.footballnsw.com.au/?p=33355)
- **Public lineups** on the FNSW competitions site 30 minutes before kick-off. [FNSW](https://kb.footballnsw.com.au/?p=35649)
- **Digital membership/ID card** under Profile → Memberships; officials swipe a squad's cards from the match sheet. [help.dribl](https://help.dribl.com/space/ME/141393922.md)
- **2025–26 release notes:**
  - Match feedback survey (Feb 2025)
  - Manage Matches ground/field view (Apr 2025)
  - Team sharing (Aug 2025)
  - Social tournaments (Sep 2025)
  - Configurable vote limits + match commissioner (Dec 2025)
  - Theme (May 2026)
  - Calendar sync (Oct 2026)

  [App Store](https://apps.apple.com/app/id1555038633)
- **No sponsor slots, ads, accessibility declarations, offline mode or languages other than English.** By contrast, PlayHQ sells sponsor placements, but only governing bodies control them. [PlayHQ](https://supporta.playhq.com/hc/en-au/articles/29642412694681-Managing-mobile-app-sponsorship-advertising)

**What this adds to Squadroom:**
- live score taps
- junior stats and Player of the Match
- share cards
- a match centre per event
- a player card
- sponsor slots for the academy
- offline match day
- accessibility and languages

These are spec items X-01 to X-13.
