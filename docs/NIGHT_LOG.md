# Night log

Newest first. Each entry: what got done, what broke, and anything that needs
Joey. The **NEEDS JOEY** list below the summary is the one to read first —
every item on it is something no amount of building can get past.

---

## Morning summary — 29 Oct 2026

**Done:** the tidy-up (Step 0). Tests no longer depend on a healthy dev
server, and `docs/SQUADROOM_SPEC.md` now matches the code — five statuses in
it were wrong, two of them saying work was blocked that has in fact been
applied for days.

**Broke:** nothing. No feature code was touched.

**The one thing that would unblock the most work:** a Stripe **test** key.
It is free, it takes about three minutes, and it is currently the only thing
standing between us and eight of the registration and billing items Joey
asked for — one checkout for several children, the sibling discount,
instalments, promo codes, refunds, overdue reminders and the finance export.
Exact steps are in NEEDS JOEY below.

---

## NEEDS JOEY

### 1. Stripe test key — blocks 8 items, free, ~3 minutes

`STRIPE_SECRET_KEY` exists in `.env.local` but is **empty**, so every money
path is written and untestable. A *test* key costs nothing and charges
nobody; this does not go against "don't spend money on API keys".

1. Go to <https://dashboard.stripe.com/register> and make an account (no
   business details or bank account needed for test mode).
2. Make sure the **Test mode** toggle, top right, is ON.
3. Go to Developers → API keys.
4. Copy the **Secret key** — it starts `sk_test_`.
5. Open `/Users/j.lameri/Projects/squadroom/.env.local` and put it on the
   existing line, so it reads `STRIPE_SECRET_KEY=sk_test_...`
6. Tell me it's in. Don't paste the key into chat.

Blocks: B-01's card step, B-02 instalments and term fees, B-03 sibling
discount and promo codes, B-04 refunds and overdue reminders, B-05 finance
export, R-04 several children in one checkout, R-13 trials pay link, R-15
withdraw with partial refund, and league fees in M9.

Test card once it's in: `4242 4242 4242 4242`, any future expiry, any CVC.

### 2. Dribl club-admin export access — blocks F-04

Until your NRIFA login can reach Events → Export, the weekly routine stays
on fixturefeed. Everything on our side is built and tested against a real
export. Ask whoever administers the NRIFA Dribl account for club-admin
rights, then drop one export into `/admin/import` and we can retire
fixturefeed the same day.

### 3. A demo on a real phone — nothing else can prove this

Especially **chat**. Every message now arrives by a different path than it
did a week ago (broadcast rather than `postgres_changes`, X-18). It measures
40 of 40 delivered in a script, which is not the same as working in your
hand on patchy reception at a ground. Send a few messages between two
phones.

### 4. Child-friendly privacy notice + legal review — S-05, due 10 Dec 2026

Export and erase are built and return a manifest. What is outstanding is a
privacy notice written for children and a lawyer's read of it. This has a
real deadline (the Children's Online Privacy Code) and I cannot write the
legal review.

### 5. Apple Developer account + Xcode — blocks M7, and M7 blocks contacts

The Capacitor shell has never been compiled. Both on-device contact matching
(C-10) and reliable iPhone push need a native build, so this gates more than
it looks like it does. Apple Developer is US$99/year — flagging the cost
rather than assuming it, given the standing rule about spending.

---

## 29 Oct 2026 — Step 0: tidy up

### Tests no longer depend on a healthy `next dev`

**The problem, measured rather than assumed.** `next dev` does not fail
cleanly. It compiles a route on first request, and when something wedges it
the port stays **open** while the server stops answering — so `fetch`
connects and waits. A suite does not fail, it *stalls*, and a run left going
overnight is still sitting on the first screen in the morning with nothing
written down. A dead port is a good failure; a listening port that never
replies is the bad one, and it is the one `next dev` actually produces.

- **`scripts/_base-url.mjs`** resolves the target once: `BASE_URL` (or the
  older `SITE`) wins outright and is never probed — a deploy preview is not
  ours to second-guess; otherwise :3000 if it answers a HEAD request inside
  **10 seconds**; otherwise :3100. Any status counts as alive, including 404
  and 500: we are asking whether a server is answering, not whether a page is
  right, and refusing to run against a 500 on `/` would hide the twelve URLs
  the suite actually wants behind one.
- It never throws. "Could not work out which port" is not a product failure,
  so when neither port answers it returns the test port anyway and lets the
  suite's own first request report it — with the URL in the message, which is
  what somebody reading the log needs.
- **`npm run serve:test`** builds and serves on :3100. A build either
  succeeds or fails; it does not half-compile a route at request time, so
  :3100 cannot wedge the way :3000 does.
- It builds into **`.next-test`** (`DIST_DIR` in `next.config.ts`), not
  `.next`. They would otherwise share a directory, and building into a wedged
  dev server's own state mid-request turns a stalled test run into a broken
  checkout as well. Now the fallback never has to ask whether dev is healthy
  first. `.next-test/` is gitignored.
- Seven suites rewired: `shots`, `test-screens`, `test-join-flow`,
  `test-join-codes`, `test-contacts`, `test-public-registration`,
  `test-share-cards`.

Verified: with a dev server up, resolution costs 0.17s and picks :3000; an
explicit `BASE_URL` short-circuits the probe and has its trailing slash
stripped, so `${BASE}/calendar` cannot become `//calendar`.

### Spec corrected against the code

`docs/SQUADROOM_SPEC.md` was audited on 23 Oct against migrations 0001–0075
and 69 commits. It is now 0001–**0130** and **137** commits, and five
statuses were wrong:

| Was | Is |
|---|---|
| S-01 "WRITTEN, NOT APPLIED — the Supabase connection is down" | **DONE.** `db:migrate --dry` reports all 130 applied, 0076 among them |
| Risk 1 "the repo has no git remote, CONFIRMED" | Resolved — private `origin`, 137 commits pushed |
| Risk 4 "Supabase and Netlify MCP are down, migrations cannot be applied" | Resolved — `npm run db:migrate` goes through the management API, restricted to squadroom-dev by `scripts/_project.mjs` |
| R-05 "Kit sizes still to do" | Contradicted the same row's own text, which said done in 0123/0124. Removed |
| S-06 "Player accounts (13+) — MISSING" | **Superseded, will not be built.** Nobody under 18 gets an account; enforced by 0078's two triggers and `test-adults-only.mjs` |
| `test-rls.sql` "23 assertions" | 43 |

Also recorded: an **ID collision**. The 29 Oct brief calls on-device contact
matching "C-09", but C-09 is already *one search for the whole club* (0130,
built). Contacts is filed as **C-10** so every ID points at one thing.

### What this did not touch

No feature code, no migrations, no schema. `.next-test` is a new build
directory and `next.config.ts` gained one line reading an env var that
defaults to the old behaviour.
