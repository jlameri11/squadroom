// Run on its own: node scripts/simulation/step.mjs --plan extra --round 10 --step PY
//
// Joey (16 Nov 2026): payments through Stripe TEST MODE for a sample of clubs
// — a registration fee, a season levy in instalments (a declined card first),
// a refund on withdrawal, a club's entry fee to the league — instead of the
// no-key path the rest of the season uses.
//
// Test mode only, ever: the key in .env.local must be sk_test_ or the group
// does not run; the merchant accounts are stand-ins made by
// scripts/_stripe-test-accounts.mjs (dashboard none, Stripe's test identity
// values, found again by metadata.academy_id); the cards are Stripe's test
// cards; the accounts are closed at the end. No real money can move.
//
// The pieces: the app built for the stack on :3300 (its STRIPE_* come from
// .env.local at runtime, its Supabase keys from the stack), `stripe listen`
// forwarding platform AND connected-account events to :3300 (the charges are
// made on the clubs' own accounts), the real routes called with a family's
// session, Stripe Checkout driven in headless Chrome, and the webhook watched
// for in the payments table — all inside withStack, because the webhook needs
// the stack's PostgREST up when Stripe calls back. Nothing here prints a key
// or a signing secret.
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { check, ids, mustWork, note, rpc, run, scenario, sql, val, who } from './lib.mjs'
import { COMP, LEAGUE } from './world.mjs'
import { plusDays } from './routine.mjs'
import { apiAs, withStack } from './live.mjs'
import { APP_URL } from './stack.mjs'

const GROUP = 'Payments (Stripe test mode)'
/** Stripe's test cards: always approved; always declined; a charge whose funds are available at once. */
const CARD = { ok: '4242424242424242', declined: '4000000000000002', instant: '4000000000000077' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function stripePlan(ctx, S, add) {
  add(`${plusDays(S, -3)} 19:00`, 'PY0 Stripe test mode: two clubs and the league set up payments', () => setup(ctx, S))
  add(`${plusDays(S, -3)} 19:20`, 'PY1 a family pays a registration fee by card', () => registration(ctx, S))
  add(`${plusDays(S, -3)} 19:45`, 'PY2 the season levy in instalments, a declined card first', () => instalments(ctx, S))
  add(`${plusDays(S, -2)} 09:00`, 'PY3 a withdrawal and the refund', () => refund(ctx, S))
  add(`${plusDays(S, -2)} 09:30`, 'PY4 a club pays the league its entry fee', () => entryFee(ctx, S))
  add(`${plusDays(S, -2)} 09:50`, 'PY9 the stand-in accounts closed, the listener stopped', () => teardown(ctx))
}

// ------------------------------------------------------------------ plumbing
/** The two Stripe variables, read from .env.local by name; null unless the key is a TEST key. */
function stripeEnv() {
  if (!existsSync('.env.local')) return null
  const out = {}
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = /^(STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET)=(.*)$/.exec(line.trim())
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  if (!out.STRIPE_SECRET_KEY || !out.STRIPE_SECRET_KEY.startsWith('sk_test_')) return null
  return out
}

/** The Stripe CLI: $STRIPE_CLI, .cache/tools/stripe, or one on the PATH. */
function stripeCli() {
  const candidates = [process.env.STRIPE_CLI, '.cache/tools/stripe'].filter(Boolean)
  for (const c of candidates) if (existsSync(c)) return c
  try {
    const p = execFileSync('which', ['stripe'], { encoding: 'utf8' }).trim()
    if (p) return p
  } catch {
    // not on the PATH
  }
  return null
}

/**
 * A probe signed with the listener's secret: the app answers 200 (an event of
 * no interest, received) when its STRIPE_WEBHOOK_SECRET is that secret, 400
 * "Bad signature" when it is another. Proves the pair before a cent moves.
 */
async function signedProbe(secret) {
  const { createHmac } = await import('node:crypto')
  const body = JSON.stringify({ id: 'evt_sim_probe', object: 'event', type: 'sim.probe', api_version: '2026-08-26', data: { object: { id: 'probe' } } })
  const ts = Math.floor(Date.now() / 1000)
  const sig = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')
  const r = await fetch(`${APP_URL}/api/payments/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': `t=${ts},v1=${sig}` }, body }).catch(() => null)
  return r ? r.status : 0
}

/** The app's webhook asks for a signature when its Stripe keys are set (400); 503 when they are not. */
async function webhookStatus() {
  const r = await fetch(`${APP_URL}/api/payments/webhook`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => null)
  return r ? r.status : 0
}

/**
 * `stripe listen`, forwarding platform and connected-account events to the
 * app, with the key in the child's environment (never on its command line).
 * Its signing secret must be the one in .env.local, or the app refuses every
 * event — checked without printing either.
 */
async function startListener(ctx, env, cli) {
  const target = `${new URL(APP_URL).host}/api/payments/webhook`
  // --all-snapshot: the classic event shapes the webhook reads (checkout.session.*, refund.*, capability.updated); the CLI insists on a selector.
  const child = spawn(cli, ['listen', '--all-snapshot', '--forward-to', target, '--forward-connect-to', target], {
    env: { ...process.env, STRIPE_API_KEY: env.STRIPE_SECRET_KEY, STRIPE_CLI_TELEMETRY_OPTOUT: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const lines = []
  let secret = null
  const onData = (d) => {
    for (const l of d.toString().split('\n')) {
      if (!l.trim()) continue
      lines.push(l)
      if (lines.length > 300) lines.shift()
      const m = /(whsec_[A-Za-z0-9]+)/.exec(l)
      if (m) secret = m[1]
    }
  }
  child.stdout.on('data', onData)
  child.stderr.on('data', onData)
  const t0 = Date.now()
  while (Date.now() - t0 < 45000 && child.exitCode === null && !lines.some((l) => /Ready!/.test(l))) await sleep(300)
  const redacted = () => lines.slice(-3).join(' | ').replace(/whsec_[A-Za-z0-9]+/g, 'whsec_…').replace(/sk_test_[A-Za-z0-9]+/g, 'sk_test_…').slice(0, 220)
  if (!lines.some((l) => /Ready!/.test(l))) {
    try { child.kill() } catch { /* already gone */ }
    note(`stripe listen did not get ready: ${redacted()}`)
    return null
  }
  if (secret && env.STRIPE_WEBHOOK_SECRET && secret !== env.STRIPE_WEBHOOK_SECRET) {
    note(`.env.local's STRIPE_WEBHOOK_SECRET (${env.STRIPE_WEBHOOK_SECRET.length} chars) is not the CLI listener's (${secret.length}); the simulation server is given the listener's by .cache/rebuild-sim.sh — proved by the signed probe below`)
  }
  const listener = {
    child,
    lines,
    secret,
    /** The forwarded events seen so far, by type (what the CLI prints as "--> type [evt_…]"). */
    seen: () => lines.filter((l) => /-->/.test(l)).map((l) => (/-->\s+(\S+)/.exec(l) ?? [])[1]).filter(Boolean),
    kill: () => { try { child.kill() } catch { /* already gone */ } },
  }
  process.on('exit', listener.kill)
  return listener
}

/** A stand-in merchant account for an organisation, its billing row, and the owner's Payments page agreeing it is live. */
async function merchant(ctx, db, { academyId, owner, role }) {
  const { stripe, mod } = ctx.stripe
  const org = (await db.query(`select name, slug from public.academies where id = $1`, [academyId])).rows[0]
  if (!org) return null
  let acct
  try {
    acct = await mod.testMerchantAccount(stripe, { academyId, name: org.name, email: `${org.slug}-harness@squadroom.invalid`, url: `https://squadroom-dev.netlify.app/${org.slug}` })
  } catch (e) {
    note(`stand-in account for ${org.name}: ${String(e.message).slice(0, 160)}`)
    return null
  }
  await db.query(`insert into public.academy_billing (academy_id, stripe_account_id, charges_enabled, payouts_enabled, details_submitted, connected_at)
                  values ($1, $2, true, true, true, now())
                  on conflict (academy_id) do update set stripe_account_id = excluded.stripe_account_id, charges_enabled = true, payouts_enabled = true, details_submitted = true,
                    connected_at = coalesce(public.academy_billing.connected_at, now())`, [academyId, acct.id])
  const g = await apiAs(db, owner, `/api/payments/connect?academyId=${academyId}`, { method: 'GET' })
  check(g.status === 200 && Boolean(g.data?.charges_enabled) && Boolean(g.data?.payouts_enabled), {
    what: `${org.name}: the owner's Payments page shows the account live (charges and payouts on)${acct.reused ? ' — the stand-in from an earlier run, found again' : ''}`,
    expected: 'charges_enabled, payouts_enabled',
    actual: g.status === 200 ? JSON.stringify({ charges: g.data?.charges_enabled, payouts: g.data?.payouts_enabled, outstanding: g.data?.requirements?.summary }) : `${g.status} ${JSON.stringify(g.data).slice(0, 120)}`,
    role, where: 'GET /api/payments/connect',
  })
  return acct.id
}

function shotsDir(ctx) {
  const dir = `.cache/screens/${ctx.seed ?? 1}-stripe`
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Stripe Checkout in headless Chrome. Since November 2026 Checkout draws its
 * whole form inside Stripe's own frame (elements-inner-habanero-…): the email,
 * the card number, expiry, security code, name and country, Link's "save my
 * information" box (unticked, or the phone number is demanded) and the Pay
 * button all live there, so everything is typed into that frame. A plain page,
 * not pageAs, so Stripe's page keeps the real clock. Done when the page lands
 * back on the app; a decline is read off the frame's own text.
 */
async function payOnCheckout(browser, url, label, { card = CARD.ok, dir, expectDecline = false } = {}) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  const shot = () => page.screenshot({ path: `${dir}/${label}.png`, fullPage: true }).catch(() => null)
  try {
    await page.setViewport({ width: 420, height: 900 })
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 })
    // The payment frame, once it has drawn the card number field.
    let f = null
    for (let i = 0; i < 120 && !f; i++) {
      for (const fr of page.frames()) {
        if (!/js\.stripe\.com\/v3\/elements-inner/.test(fr.url())) continue
        if (await fr.$('#payment-numberInput').catch(() => null)) { f = fr; break }
      }
      if (!f) await sleep(500)
    }
    if (!f) { await shot(); return { ok: false, error: `no card field in ${page.frames().length} frames after 60 s` } }
    // The fields by id, name or autocomplete — whichever this session draws
    // (a session without Link has a plain email box, not Link's).
    const SEL = {
      email: '#linkAuthentication-emailInput, input[type="email"], input[name="email"], input[autocomplete="email"], #email',
      number: '#payment-numberInput, input[name="number"], input[autocomplete="cc-number"], #cardNumber',
      expiry: '#payment-expiryInput, input[name="expiry"], input[autocomplete="cc-exp"], #cardExpiry',
      cvc: '#payment-cvcInput, input[name="cvc"], input[autocomplete="cc-csc"], #cardCvc',
      name: '#payment-nameInput, input[name="name"], input[autocomplete="cc-name"], #billingName',
      country: '#payment-countryInput, select[name="country"], #billingCountry',
      postal: '#payment-postalCodeInput, input[name="postalCode"], input[autocomplete="postal-code"], #billingPostalCode',
      link: '#payment-linkOptInInput, input[name="linkOptIn"], input[name="enableStripePass"]',
    }
    const visible = async (sel) => {
      for (const el of await f.$$(sel)) if (await el.evaluate((e) => e.offsetParent !== null || e.getClientRects().length > 0)) return el
      return null
    }
    const type = async (sel, value) => {
      const el = await visible(sel)
      if (!el) return false
      await el.click({ clickCount: 3 }).catch(() => null)
      await el.type(value, { delay: 15 })
      return true
    }
    const fields = () => f.$$eval('input, select', (els) => els.map((e) => e.id || e.getAttribute('name') || e.getAttribute('autocomplete') || e.type).join(',')).catch(() => '?')
    await sleep(600)
    const EMAIL = 'sim-payer@squadroom.invalid'
    // The email box is re-drawn when Link looks the address up, which can
    // swallow what was typed the moment the frame appeared: type, then make sure.
    const email = async () => {
      for (let i = 0; i < 3; i++) {
        if (!(await type(SEL.email, EMAIL))) return false
        await sleep(400)
        const el = await visible(SEL.email)
        const v = el ? await el.evaluate((e) => e.value) : ''
        if (v === EMAIL) return true
      }
      return false
    }
    const hadEmail = await email()
    const hadCard = await type(SEL.number, card)
    if (!hadCard) { await shot(); return { ok: false, error: `no card number field; fields: ${await fields()}` } }
    await type(SEL.expiry, '1234')
    await type(SEL.cvc, '123')
    await type(SEL.name, 'Sim Payer')
    const country = await visible(SEL.country)
    if (country) await country.select('AU').catch(() => null)
    await type(SEL.postal, '2113')
    const link = await visible(SEL.link)
    if (link && (await link.evaluate((e) => e.checked))) await link.click()
    if (!hadEmail) note(`checkout ${label}: no email box took the address (fields: ${await fields()})`)
    const submit = 'button[data-testid="payment-form-submit-button"], button[type="submit"]'
    await f.click(submit)
    const problem = async () => {
      const txt = await f.evaluate(() => document.body.innerText).catch(() => '')
      const m = /[^\n]*(declined|try a different card|was not accepted|insufficient funds|could not be processed|incorrect|invalid|is incomplete)[^\n]*/i.exec(txt)
      return m ? m[0].trim().slice(0, 200) : ''
    }
    for (let i = 0; i < 45; i++) {
      await sleep(2000)
      if (page.url().startsWith(APP_URL)) return { ok: true }
      const txt = await f.evaluate(() => document.body.innerText).catch(() => '')
      if (/enter your email/i.test(txt)) {
        // The address was lost; put it back and press Pay again.
        await email()
        await f.click(submit).catch(() => null)
        continue
      }
      const err = await problem()
      if (err) {
        if (expectDecline) return { ok: false, declined: /declined|different card|not accepted|insufficient/i.test(err), error: err }
        await shot()
        return { ok: false, error: err }
      }
      if (i === 10) {
        const txt = await f.$eval(submit, (b) => b.textContent).catch(() => '')
        if (/pay/i.test(txt)) await f.click(submit).catch(() => null)
      }
    }
    await shot()
    const last = await f.evaluate(() => document.body.innerText).catch(() => '')
    return { ok: false, error: `still on Checkout after 90 s — the frame says: ${last.replace(/\s+/g, ' ').slice(0, 140)}; fields: ${await fields()}` }
  } catch (e) {
    await shot()
    return { ok: false, error: String(e.message).slice(0, 200) }
  } finally {
    await context.close().catch(() => null)
  }
}

/** Every payments row of a Checkout session reaches the status (the webhook's doing), within the time. */
async function untilStatus(db, sessionId, status, ms = 60000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const r = await db.query(`select status::text from public.payments where stripe_session_id = $1`, [sessionId])
    if (r.rows.length && r.rows.every((x) => x.status === status)) return true
    await sleep(1500)
  }
  return false
}

async function statuses(db, sessionId) {
  const r = await db.query(`select coalesce(string_agg(status::text, ','), 'no row') s from public.payments where stripe_session_id = $1`, [sessionId])
  return r.rows[0]?.s ?? 'no row'
}

/** The simulated club's number from its id (ids.club(n) is deterministic). */
function clubOf(academyId) {
  for (let n = 1; n <= 120; n++) if (ids.club(n) === academyId) return n
  return null
}

/** A family of the club with a primary guardian, skipping the first `skip` players (other scenarios use those). */
async function family(pool, academyId, { skip = 0, years = null, unregistered = false, unpaid = null } = {}) {
  const rows = await sql(pool, `select pl.id as player, pl.full_name, g.profile_id as parent
      from public.players pl join public.player_guardians g on g.player_id = pl.id and g.is_primary
     where pl.academy_id = $1
       and ($2::int is null or extract(year from pl.dob) between $2 and $3)
       and (not $4 or not exists (select 1 from public.program_registrations r where r.player_id = pl.id))
       and ($6::uuid is null or not exists (select 1 from public.payments p where p.request_id = $6 and p.player_id = pl.id))
     order by pl.id offset $5 limit 1`, [academyId, years ? years[0] : null, years ? years[1] : null, unregistered, skip, unpaid])
  return rows[0] ?? null
}

// ---------------------------------------------------------------- PY0 set up
async function setup(ctx, S) {
  const { pool } = ctx
  scenario('PY0', GROUP, 'Stripe test mode: two clubs and the league set up payments on stand-in accounts, the listener forwards every event to the app, and nothing real can move')
  const env = stripeEnv()
  if (!env) {
    note('no sk_test_ STRIPE_SECRET_KEY in .env.local — the Stripe group is skipped; the no-key path stands')
    ctx.needsJoey?.push('The Stripe test-mode scenarios were skipped: .env.local has no sk_test_ STRIPE_SECRET_KEY (they refuse anything but a test key).')
    return
  }
  const cli = stripeCli()
  if (!cli) {
    note('no Stripe CLI (.cache/tools/stripe, $STRIPE_CLI or the PATH) — the Stripe group is skipped')
    ctx.needsJoey?.push('The Stripe test-mode scenarios were skipped: no Stripe CLI on this machine. `brew install stripe/stripe-cli/stripe` (free) or copy the binary to .cache/tools/stripe.')
    return
  }
  const status = await webhookStatus()
  check(status === 400, { what: 'the app on :3300 has its Stripe keys (the webhook asks for a signature)', expected: '400 No signature', actual: status === 503 ? '503 — STRIPE_* missing from the server' : status === 0 ? 'the app is not serving' : String(status), role: 'system', where: 'POST /api/payments/webhook' })
  if (status !== 400) return
  // For scripts/_stripe-test-accounts.mjs, which reads the key from the environment. Never printed.
  process.env.STRIPE_SECRET_KEY = env.STRIPE_SECRET_KEY
  const mod = await import('../_stripe-test-accounts.mjs')
  const stripe = mod.testStripe()
  const listener = await startListener(ctx, env, cli)
  check(Boolean(listener), { what: 'stripe listen forwards platform and connected-account events to the app', expected: 'Ready!', actual: listener ? 'ready' : 'not ready (see the note)', role: 'system', where: 'stripe listen' })
  if (!listener) return
  const probe = listener.secret ? await signedProbe(listener.secret) : 0
  check(probe === 200, { what: 'the app verifies events with the listener\'s signing secret (a signed probe)', expected: '200 received', actual: probe === 400 ? '400 Bad signature — the server\'s STRIPE_WEBHOOK_SECRET is not the CLI listener\'s' : String(probe), role: 'system', where: 'POST /api/payments/webhook (signed)' })
  if (probe !== 200) {
    listener.kill()
    ctx.needsJoey?.push('Stripe test mode: the app on :3300 does not verify events with the CLI listener\'s secret (.cache/rebuild-sim.sh exports it from `stripe listen --print-secret`); the Stripe scenarios were skipped.')
    return
  }
  ctx.stripe = { env, cli, mod, stripe, listener, accounts: {} }
  await withStack(ctx, 'PY0 payments set up', async ({ db }) => {
    for (const [key, a] of [
      ['club1', { academyId: ids.club(1), owner: who.president(1), role: 'president (club 1)' }],
      ['club2', { academyId: ids.club(2), owner: who.president(2), role: 'president (club 2)' }],
      ['league', { academyId: LEAGUE, owner: ids.leagueOwner, role: 'league owner' }],
    ]) {
      const id = await merchant(ctx, db, a)
      if (id) ctx.stripe.accounts[key] = id
    }
  })
  // The program and the fee the registration scenario pays for: club 2's Registrar opens a clinic tonight.
  const prog = await run(pool, who.registrar(2), `insert into public.programs (academy_id, name, kind, status, season, born_from_year, born_to_year, capacity, opens_at, closes_at, starts_on, ends_on, withdraw_until, refund_bps_after, created_by)
    values ($1, 'Winter skills clinic', 'development', 'open', '2027', 2013, 2017, 40, now() - interval '1 day', $2, $3, $4, $5, 5000, $6) returning id`,
    [ids.club(2), plusDays(S, 30), plusDays(S, 7), plusDays(S, 63), plusDays(S, 21), who.registrar(2)])
  mustWork(prog, { what: 'the Registrar opens a clinic with a fee', role: 'registrar', where: 'programs' })
  if (!prog.ok) return
  ctx.stripe.program = prog.data[0].id
  const fee = await rpc(pool, who.treasurer(2), 'set_program_fee', { p_program: ctx.stripe.program, p_amount_cents: 9000, p_title: 'Clinic fee', p_due_on: plusDays(S, 14), p_instalments: 1, p_every_days: 30 })
  mustWork(fee, { what: 'the Treasurer sets the fee: $90, one payment', role: 'treasurer', where: 'set_program_fee' })
  if (fee.ok) ctx.stripe.fee = fee.data
}

// ---------------------------------------------------- PY1 a registration fee
async function registration(ctx) {
  const { pool } = ctx
  scenario('PY1', GROUP, 'A family registers a child for a club program and pays the fee by card on Stripe Checkout; the webhook marks it paid; the quote, the receipt and the family\'s Payments page agree')
  const st = ctx.stripe
  if (!st?.accounts.club2 || !st.fee) { note('PY0 did not set club 2 up — skipped'); return }
  const kid = await family(pool, ids.club(2), { skip: 3, years: [2013, 2017], unregistered: true })
  if (!kid) { note('no unregistered child in club 2'); return }
  const reg = await run(pool, kid.parent, `insert into public.program_registrations (academy_id, program_id, player_id, submitted_by, status) values ($1, $2, $3, $4, 'pending') returning id`, [ids.club(2), st.program, kid.player, kid.parent])
  mustWork(reg, { what: 'a family registers a child for the clinic', role: 'parent', where: 'program_registrations' })
  if (!reg.ok) return
  mustWork(await run(pool, who.registrar(2), `update public.program_registrations set status = 'approved' where id = $1 returning id`, [reg.data[0].id]), { what: 'the Registrar approves', role: 'registrar', where: 'program_registrations' })
  st.registration = { id: reg.data[0].id, player: kid.player, parent: kid.parent }
  await withStack(ctx, 'PY1 a registration fee by card', async ({ db, browser }) => {
    const co = await apiAs(db, kid.parent, '/api/payments/checkout', { body: { requestId: st.fee, playerId: kid.player } })
    check(co.status === 200 && String(co.data?.url ?? '').startsWith('https://checkout.stripe.com/'), { what: 'Pay opens Stripe Checkout, on the club\'s own account', expected: '200 and a checkout.stripe.com link', actual: `${co.status} ${JSON.stringify(co.data).slice(0, 160)}`, role: 'parent', where: 'POST /api/payments/checkout' })
    if (co.status !== 200) return
    check(co.data.amount_cents === 9000, { what: 'for the one price, $90 — a card fee only as its own line if the club passes it on', expected: 9000, actual: JSON.stringify({ amount: co.data.amount_cents, card_fee: co.data.card_fee_cents, total: co.data.total_cents }), role: 'parent', where: 'checkout' })
    const paid = await payOnCheckout(browser, co.data.url, 'py1-registration', { dir: shotsDir(ctx) })
    check(paid.ok, { what: 'the test card goes through on Stripe\'s page and lands back on the app', expected: 'back on /payments?paid=1', actual: paid.ok ? 'paid' : paid.error, role: 'parent', where: 'Stripe Checkout' })
    if (!paid.ok) return
    const marked = await untilStatus(db, co.data.session_id, 'paid')
    check(marked, { what: 'the webhook — a connected-account event through stripe listen — marks the payment paid within a minute', expected: 'paid', actual: marked ? 'paid' : `${await statuses(db, co.data.session_id)}; events seen: ${st.listener.seen().slice(-6).join(', ') || 'none'}`, role: 'system', where: 'POST /api/payments/webhook' })
    const q = await rpc(pool, kid.parent, 'quote_payment', { p_request: st.fee, p_player: kid.player })
    check(q.ok && q.data?.outstanding_cents === 0, { what: 'the family\'s quote says nothing is owed', expected: 0, actual: q.ok ? q.data?.outstanding_cents : q.error, role: 'parent', where: 'quote_payment' })
    const receipt = await val(pool, `select count(*)::int from public.notification_queue where kind = 'receipt' and profile_id = $1`, [kid.parent])
    check(receipt > 0, { what: 'a receipt is queued for the family', expected: '≥1', actual: receipt, role: 'parent', where: 'payments → notification_queue (receipt)', severity: 'medium' })
    const mine = await rpc(pool, kid.parent, 'my_payment_requests', { p_academy: ids.club(2) })
    const row = (mine.data ?? []).find((x) => x.request_id === st.fee || x.id === st.fee)
    check(Boolean(row) && (/"paid"/.test(JSON.stringify(row)) || row.outstanding_cents === 0), { what: 'and the family\'s Payments page shows it paid', expected: 'paid / nothing outstanding', actual: row ? JSON.stringify(row).slice(0, 160) : `not listed (${(mine.data ?? []).length} rows)`, role: 'parent', where: 'my_payment_requests' })
    st.paidSession = co.data.session_id
  }, { browser: true })
}

// --------------------------------------------- PY2 instalments, a decline first
async function instalments(ctx) {
  const { pool } = ctx
  scenario('PY2', GROUP, 'A season levy paid in instalments by card: the first card is declined on Stripe\'s page and nothing is marked paid; the next card pays part one, then part two; the quote and the Treasurer\'s Who owes follow')
  const st = ctx.stripe
  if (!st?.accounts.club1) { note('PY0 did not set club 1 up — skipped'); return }
  const levy = ctx.money?.levy ?? await val(pool, `select id from public.payment_requests where academy_id = $1 and title = 'Season levy 2027' order by created_at limit 1`, [ids.club(1)])
  if (!levy) { note('club 1 has no season levy'); return }
  // The first two families belong to OFF4's failed card and missed instalment; this is the next
  // with nothing paid on the levy yet (a re-run of the step takes the one after).
  const fam = await family(pool, ids.club(1), { skip: 2, unpaid: levy })
  if (!fam) { note('no family in club 1'); return }
  await withStack(ctx, 'PY2 instalments', async ({ db, browser }) => {
    const dir = shotsDir(ctx)
    const pay = (label, card, expectDecline = false) => apiAs(db, fam.parent, '/api/payments/checkout', { body: { requestId: levy, playerId: fam.player } }).then(async (co) => {
      if (co.status !== 200 || !co.data?.url) return { co, paid: { ok: false, error: `${co.status} ${JSON.stringify(co.data).slice(0, 120)}` } }
      return { co, paid: await payOnCheckout(browser, co.data.url, label, { card, dir, expectDecline }) }
    })
    // 1. The declined card.
    const first = await pay('py2-declined', CARD.declined, true)
    check(first.co.status === 200 && first.co.data?.amount_cents === 4000, { what: 'Pay offers the first of three instalments, $40', expected: '200, 4000', actual: `${first.co.status} ${first.co.data?.amount_cents}`, role: 'parent', where: 'POST /api/payments/checkout (instalments)' })
    check(Boolean(first.paid.declined), { what: 'Stripe refuses the declined test card on its page and keeps the family there to try another', expected: '"Your card was declined"', actual: first.paid.declined ? first.paid.error : first.paid.ok ? 'PAID' : first.paid.error, role: 'parent', where: 'Stripe Checkout' })
    const q0 = await rpc(pool, fam.parent, 'quote_payment', { p_request: levy, p_player: fam.player })
    check(q0.ok && q0.data?.outstanding_cents === 12000, { what: 'nothing is marked paid after the decline: the whole levy is still owed', expected: 12000, actual: q0.ok ? `${q0.data?.outstanding_cents} (part 1: ${q0.data?.schedule?.[0]?.status})` : q0.error, role: 'parent', where: 'quote_payment' })
    // 2. Another card, the same part.
    const second = await pay('py2-part-1', CARD.ok)
    check(second.paid.ok, { what: 'trying again with a good card pays part one', expected: 'paid', actual: second.paid.ok ? 'paid' : second.paid.error, role: 'parent', where: 'Stripe Checkout' })
    if (!second.paid.ok) return
    const m1 = await untilStatus(db, second.co.data.session_id, 'paid')
    check(m1, { what: 'the webhook marks part one paid', expected: 'paid', actual: m1 ? 'paid' : await statuses(db, second.co.data.session_id), role: 'system', where: 'POST /api/payments/webhook' })
    const q1 = await rpc(pool, fam.parent, 'quote_payment', { p_request: levy, p_player: fam.player })
    check(q1.ok && q1.data?.outstanding_cents === 8000 && q1.data?.schedule?.[0]?.status === 'paid', { what: '$80 left over two instalments; part one shows paid', expected: '8000, part 1 paid', actual: q1.ok ? `${q1.data?.outstanding_cents}, ${(q1.data?.schedule ?? []).map((s) => s.status).join('/')}` : q1.error, role: 'parent', where: 'quote_payment' })
    // 3. Part two, a month early — allowed.
    const third = await pay('py2-part-2', CARD.ok)
    check(third.co.status === 200 && third.co.data?.amount_cents === 4000 && third.paid.ok, { what: 'Pay now offers part two, $40, and it goes through', expected: '4000 paid', actual: `${third.co.status} ${third.co.data?.amount_cents} ${third.paid.ok ? 'paid' : third.paid.error}`, role: 'parent', where: 'checkout (part 2)' })
    if (!third.paid.ok) return
    const m2 = await untilStatus(db, third.co.data.session_id, 'paid')
    const q2 = await rpc(pool, fam.parent, 'quote_payment', { p_request: levy, p_player: fam.player })
    check(m2 && q2.ok && q2.data?.outstanding_cents === 4000 && (q2.data?.schedule ?? []).map((s) => s.status).join('/') === 'paid/paid/unpaid', { what: 'two of three paid, $40 to go', expected: '4000; paid/paid/unpaid', actual: `${q2.data?.outstanding_cents}; ${(q2.data?.schedule ?? []).map((s) => s.status).join('/')}`, role: 'parent', where: 'quote_payment' })
    const owes = await rpc(pool, who.treasurer(1), 'outstanding_fees', { p_academy: ids.club(1) })
    const mine = (owes.data ?? []).find((o) => o.player_id === fam.player)
    check(Boolean(mine) && mine.outstanding_cents === 4000, { what: 'the Treasurer\'s Who owes has the family at $40', expected: 4000, actual: mine ? mine.outstanding_cents : `not listed (${(owes.data ?? []).length} rows)`, role: 'treasurer', where: 'outstanding_fees' })
    const receipts = await val(pool, `select count(*)::int from public.notification_queue where kind = 'receipt' and profile_id = $1`, [fam.parent])
    check(receipts >= 2, { what: 'a receipt for each part', expected: '≥2', actual: receipts, role: 'parent', where: 'notification_queue (receipt)', severity: 'medium' })
  }, { browser: true })
}

// ---------------------------------------------------------- PY3 the refund
async function refund(ctx) {
  const { pool } = ctx
  scenario('PY3', GROUP, 'The family withdraws from the program inside the full-refund window; the club issues the refund through Stripe; the webhook marks the payment refunded and the Treasurer\'s list clears')
  const st = ctx.stripe
  if (!st?.registration || !st.paidSession) { note('PY1 did not pay — skipped'); return }
  const { id: registrationId, parent, player } = st.registration
  const w = await rpc(pool, parent, 'withdraw_registration', { p_registration: registrationId, p_reason: 'Moving to Newcastle' })
  mustWork(w, { what: 'the family withdraws', role: 'parent', where: 'withdraw_registration' })
  if (!w.ok) return
  check(w.data?.policy === 'full' && w.data?.refund_cents === 9000, { what: 'inside the window the refund is the full $90', expected: 'full, 9000', actual: JSON.stringify(w.data), role: 'parent', where: 'withdraw_registration' })
  const req = (await sql(pool, `select id, status::text, amount_cents, payment_id from public.refunds where registration_id = $1 order by requested_at desc limit 1`, [registrationId]))[0]
  check(Boolean(req) && req.status === 'requested', { what: 'a refund is requested for the Treasurer', expected: 'requested', actual: req ? `${req.status} ${req.amount_cents}` : 'no refunds row', role: 'treasurer', where: 'refunds' })
  if (!req) return
  const toIssue = async () => {
    const jobs = await rpc(pool, who.treasurer(2), 'home_jobs', { p_academy: ids.club(2), p_persona: 'treasurer' })
    const detail = (jobs.data?.jobs ?? []).find((j) => j.id === 'refunds')?.detail ?? ''
    return Number((/(\d+) to issue/.exec(detail) ?? [])[1] ?? 0)
  }
  const before = await toIssue()
  await withStack(ctx, 'PY3 the refund', async ({ db }) => {
    const asTreasurer = await apiAs(db, who.treasurer(2), '/api/payments/refund', { body: { refundId: req.id } })
    let issued = asTreasurer
    if (asTreasurer.status !== 200) {
      check(false, { what: 'the Treasurer — whose Home says "1 to issue" — can press Issue', expected: '200', actual: `${asTreasurer.status} ${asTreasurer.data?.error ?? ''} (the route takes owner/admin only; the Treasurer must fetch the President)`, role: 'treasurer', where: 'POST /api/payments/refund', severity: 'medium' })
      issued = await apiAs(db, who.president(2), '/api/payments/refund', { body: { refundId: req.id } })
    }
    check(issued.status === 200 && Boolean(issued.data?.stripe_refund_id), { what: 'the club issues the refund on Stripe', expected: '200 with a refund id', actual: `${issued.status} ${JSON.stringify(issued.data).slice(0, 120)}`, role: 'president', where: 'POST /api/payments/refund' })
    if (issued.status !== 200) return
    const refunded = await untilStatus(db, st.paidSession, 'refunded')
    check(refunded, { what: 'the webhook (refund.created / refund.updated) marks the payment refunded', expected: 'refunded', actual: refunded ? 'refunded' : `${await statuses(db, st.paidSession)}; events: ${st.listener.seen().slice(-6).join(', ') || 'none'}`, role: 'system', where: 'POST /api/payments/webhook' })
    const row = (await db.query(`select status::text, stripe_refund_id is not null as has_id from public.refunds where id = $1`, [req.id])).rows[0]
    check(row?.status === 'issued' && row.has_id, { what: 'the refund row is issued, with Stripe\'s id', expected: 'issued', actual: JSON.stringify(row), role: 'treasurer', where: 'refunds' })
    // refunds_to_issue is the Treasurer's record — every refund with its status, the requested ones first.
    const todo = await rpc(pool, who.treasurer(2), 'refunds_to_issue', { p_academy: ids.club(2) })
    const listed = (Array.isArray(todo.data) ? todo.data : []).find((r) => r.id === req.id || r.refund_id === req.id)
    check(todo.ok && listed?.status === 'issued', { what: 'and the Treasurer\'s list shows it issued, nothing left requested for it', expected: 'issued', actual: todo.ok ? (listed ? listed.status : `not in the list (${(todo.data ?? []).length} rows)`) : todo.error, role: 'treasurer', where: 'refunds_to_issue' })
    const after = await toIssue()
    check(after === Math.max(0, before - 1), { what: 'and their Home counts one refund fewer to issue (others may be waiting)', expected: `${Math.max(0, before - 1)} to issue`, actual: `${after} to issue (was ${before})`, role: 'treasurer', where: 'home_jobs' })
    const again = await apiAs(db, who.president(2), '/api/payments/refund', { body: { refundId: req.id } })
    check(again.status === 409, { what: 'issuing it twice is refused', expected: 409, actual: again.status, role: 'president', where: 'POST /api/payments/refund' })
  })
}

// ------------------------------------------------------- PY4 the entry fee
async function entryFee(ctx) {
  const { pool } = ctx
  scenario('PY4', GROUP, 'A club that still owes the league its entry fee pays it by card; the money goes to the league\'s account; the league and the club both see it paid')
  const st = ctx.stripe
  if (!st?.accounts.league) { note('PY0 did not set the league up — skipped'); return }
  const fees = await sql(pool, `select ef.id, ef.club_academy_id, ef.amount_cents from public.entry_fees ef where ef.competition_id = $1 and ef.status = 'owed' and ef.club_academy_id is not null order by ef.id`, [COMP])
  const fee = fees.find((f) => clubOf(f.club_academy_id))
  if (!fee) { note('no club with an owed entry fee'); return }
  const n = clubOf(fee.club_academy_id)
  await withStack(ctx, 'PY4 the entry fee', async ({ db, browser }) => {
    const asTreasurer = await apiAs(db, who.treasurer(n), '/api/payments/entry-fee', { body: { feeId: fee.id } })
    if (asTreasurer.status !== 200) {
      check(false, { what: 'the club Treasurer, who sees what the club owes, can pay it', expected: '200', actual: `${asTreasurer.status} ${asTreasurer.data?.error ?? ''} (owner/admin only)`, role: 'treasurer', where: 'POST /api/payments/entry-fee', severity: 'medium' })
    }
    const co = asTreasurer.status === 200 ? asTreasurer : await apiAs(db, who.president(n), '/api/payments/entry-fee', { body: { feeId: fee.id } })
    check(co.status === 200 && String(co.data?.url ?? '').startsWith('https://checkout.stripe.com/') && co.data?.amount_cents === fee.amount_cents, { what: `the club pays its $${fee.amount_cents / 100} entry fee on Stripe Checkout, on the league's account`, expected: `200, ${fee.amount_cents}`, actual: `${co.status} ${co.data?.amount_cents ?? JSON.stringify(co.data).slice(0, 120)}`, role: 'president', where: 'POST /api/payments/entry-fee' })
    if (co.status !== 200) return
    const paid = await payOnCheckout(browser, co.data.url, 'py4-entry-fee', { card: CARD.instant, dir: shotsDir(ctx) })
    check(paid.ok, { what: 'the card goes through', expected: 'paid', actual: paid.ok ? 'paid' : paid.error, role: 'president', where: 'Stripe Checkout' })
    if (!paid.ok) return
    const t0 = Date.now()
    let row = null
    while (Date.now() - t0 < 60000) {
      row = (await db.query(`select status::text, method, paid_at is not null as paid from public.entry_fees where id = $1`, [fee.id])).rows[0]
      if (row?.status === 'paid') break
      await sleep(1500)
    }
    check(row?.status === 'paid' && row.method === 'stripe', { what: 'the webhook marks the entry fee paid by Stripe', expected: 'paid, stripe', actual: JSON.stringify(row), role: 'system', where: 'POST /api/payments/webhook (entry_fee)' })
    const mine = await rpc(pool, who.treasurer(n), 'my_entry_fees', { p_competition: COMP })
    check(mine.ok && JSON.stringify(mine.data ?? '').includes('"paid"'), { what: 'the club sees it paid', expected: 'paid', actual: mine.ok ? JSON.stringify(mine.data).slice(0, 120) : mine.error, role: 'treasurer', where: 'my_entry_fees' })
    const owed = await val(pool, `select count(*)::int from public.entry_fees where competition_id = $1 and status = 'owed'`, [COMP])
    check(owed === fees.length - 1, { what: 'the league has one fewer owed', expected: fees.length - 1, actual: owed, role: 'league treasurer', where: 'entry_fees' })
  }, { browser: true })
}

// ------------------------------------------------------------------ PY9 tidy
async function teardown(ctx) {
  const st = ctx.stripe
  if (!st) return
  st.listener?.kill()
  const results = []
  for (const [key, id] of Object.entries(st.accounts)) results.push(`${key}: ${await st.mod.closeTestAccount(st.stripe, id)}`)
  note(`stand-in accounts: ${results.join('; ') || 'none'}; ${st.listener?.seen().length ?? 0} events forwarded`)
}
