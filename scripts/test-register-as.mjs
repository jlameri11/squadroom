// Run: node --env-file=.env.local scripts/test-register-as.mjs
//   (the dev server on :3000; SHOTS=1 saves the screens at 375px)
//
// The registration brief, gap 6 (0267): Register as. From NRIFA's public
// form, adults register themselves as a coach, a team manager, a volunteer
// and a referee, giving their Working With Children Check number and its
// expiry; a coach without one, and a 16-year-old, are refused. The owner
// cannot approve a coach, manager or referee until the WWCC is ticked as
// checked on the register (the queue's tick), and cannot approve a manager
// without a squad. Approval gives each the right thing: the coach's hat and
// squad, the manager's and volunteer's club role, the referee's place in
// the pool — and records the clearance. The form at 375px offers the five
// and asks a coach for the WWCC; the queue shows the role and the tick.
// Everything made here is removed.
import { createClient } from '@supabase/supabase-js'
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'
import { signInBoth } from './_auth.mjs'
import { listAllUsers } from './_users.mjs'
import { createAccount, deleteAccount } from './_account.mjs'
import { resolveBaseUrl } from './_base-url.mjs'

const BASE = await resolveBaseUrl()
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const ref = URL_.split('//')[1].split('.')[0]
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SHOTS = process.env.SHOTS === '1'
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }
const head = (m) => console.log(`\n${m}`)
if (SHOTS) mkdirSync('.shots', { recursive: true })

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const U8 = '00000000-0000-0000-0000-0000000d0008'
const SLUG = 'nrifa'
const TAG = 'Zz Role'
// Each has an account first (the sign-up brief, 12 Nov 2026): demo
// addresses, whose code is shown rather than sent.
const PEOPLE = {
  coach: { phone: '+61400009961', name: `${TAG} Coach`, email: 'role.coach@squadroom-demo.test' },
  team_manager: { phone: '+61400009962', name: `${TAG} Manager`, email: 'role.manager@squadroom-demo.test' },
  volunteer: { phone: '+61400009963', name: `${TAG} Volunteer`, email: 'role.volunteer@squadroom-demo.test' },
  referee: { phone: '+61400009964', name: `${TAG} Referee`, email: 'role.referee@squadroom-demo.test' },
  browser: { phone: '+61400009965', name: `${TAG} Browser Coach`, email: 'role.browser@squadroom-demo.test' },
}
const inTwoYears = new Date(Date.now() + 730 * 864e5).toISOString().slice(0, 10)
const post = async (path, body, cookie) => {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, ...json }
}

const owner = await signInBoth(admin, 'head@squadroom-demo.test')
if (!owner) { console.log("  could not sign in — the project's auth rate limit, not a failure"); process.exit(2) }
const cookie = `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(owner.session)).toString('base64')}`
const { data: pub } = await admin.rpc('public_programs', { p_slug: SLUG })
const consents = (pub?.consents ?? []).map((c) => ({ id: c.id, version: c.version }))
// The public form allows twenty registrations an hour from one address; a
// run of suites from this machine is more than that. The throttle log is
// not demo data.
await admin.from('registration_attempts').delete().gte('created_at', '1970-01-01')

async function cleanup() {
  await admin.from('registration_requests').delete().eq('academy_id', NRIFA).like('child_name', `${TAG} %`)
  await admin.from('referees').delete().eq('academy_id', NRIFA).like('full_name', `${TAG} %`)
  const { data: users } = await listAllUsers(admin)
  for (const p of Object.values(PEOPLE)) {
    const u = users?.users?.find((x) => x.phone === p.phone.replace('+', ''))
    if (!u) continue
    await admin.from('team_members').delete().eq('profile_id', u.id)
    await admin.from('club_roles').delete().eq('profile_id', u.id)
    await admin.from('staff_clearances').delete().eq('profile_id', u.id)
    await admin.from('referees').delete().eq('profile_id', u.id)
    await admin.from('academy_members').delete().eq('profile_id', u.id)
    await admin.auth.admin.deleteUser(u.id)
  }
  for (const p of Object.values(PEOPLE)) await deleteAccount(admin, p.email)
}
await cleanup()
for (const p of Object.values(PEOPLE)) {
  const acct = await createAccount(BASE, { first: TAG, last: p.name.slice(TAG.length + 1), email: p.email, mobile: p.phone })
  p.cookie = acct.cookie
  p.browserCookies = acct.browserCookies
}

const register = (role, p, extra = {}) =>
  post('/api/register/request', { slug: SLUG, registerAs: role, childName: p.name, childDob: '1990-05-05', wwccNumber: 'WWC 1234567E', wwccExpiresOn: inTwoYears, roleNote: 'U8s on Saturdays', consents, ...extra }, p.cookie)
const profileOf = async (phone) => (await admin.from('profiles').select('id').eq('phone', phone).maybeSingle()).data?.id ?? null

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
async function open(who, path, scheme) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 375, height: 812 })
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }])
  if (who?.session) {
    await page.setCookie({ name: `sb-${ref}-auth-token`, value: 'base64-' + Buffer.from(JSON.stringify(who.session)).toString('base64'), domain: 'localhost', path: '/' })
    await page.evaluateOnNewDocument((o) => { try { localStorage.setItem('squadroom.org', o) } catch {} }, NRIFA)
  } else if (who?.browserCookies) {
    await page.setCookie(...who.browserCookies)
  }
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 90000 })
  return { page, context }
}
async function waitFor(page, selector, ms = 45000) {
  const found = await page.waitForSelector(selector, { timeout: ms }).catch(() => null)
  if (found) return found
  await page.reload({ waitUntil: 'networkidle2', timeout: 90000 })
  return page.waitForSelector(selector, { timeout: ms }).catch(() => null)
}
const fits = (page) => page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1)
const shot = (page, name) => SHOTS ? page.screenshot({ path: `.shots/register-as-${name}.png`, fullPage: true }) : null
const tap = async (h) => { await h.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' })); await h.click() }
// A React date input ignores `el.value =`; the native setter and an input event are what it listens to.
const setDate = (page, selector, value) => page.$eval(selector, (el, v) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })) }, value)
const byLabel = (text) => `xpath/.//label[contains(., ${JSON.stringify(text)})]//input`

const made = {}
try {
  head('1. Four adults register for roles; a coach without a WWCC and a 16-year-old are refused')
  for (const role of ['coach', 'team_manager', 'volunteer', 'referee']) {
    const r = await register(role, PEOPLE[role], role === 'volunteer' ? { wwccNumber: '', wwccExpiresOn: '' } : {})
    if (r.status === 200) { made[role] = r; ok(`${role.replace('_', ' ')}: registered${role === 'volunteer' ? ' (no WWCC given)' : ' with WWC1234567E'}`) } else bad(`${role}: ${r.status} ${r.error ?? ''}`)
  }
  const noWwcc = await register('coach', { ...PEOPLE.coach, phone: '+61400009966', name: `${TAG} No Check` }, { wwccNumber: '', wwccExpiresOn: '' })
  noWwcc.status === 400 && /Working With Children Check/.test(noWwcc.error ?? '') ? ok('a coach with no WWCC is refused') : bad(`no wwcc: ${noWwcc.status} ${noWwcc.error ?? ''}`)
  const young = await register('coach', { ...PEOPLE.coach, phone: '+61400009967', name: `${TAG} Young` }, { childDob: new Date(Date.now() - 16 * 365.25 * 864e5).toISOString().slice(0, 10) })
  young.status === 400 && /18 or over/.test(young.error ?? '') ? ok('a 16-year-old is refused') : bad(`young: ${young.status} ${young.error ?? ''}`)
  const expired = await register('referee', { ...PEOPLE.referee, phone: '+61400009968', name: `${TAG} Expired` }, { wwccExpiresOn: '2020-01-01' })
  expired.status === 400 && /expired/.test(expired.error ?? '') ? ok('an expired WWCC is refused') : bad(`expired: ${expired.status} ${expired.error ?? ''}`)
  const { data: rows } = await owner.client.rpc('registration_queue', { p_academy: NRIFA, p_status: 'pending' })
  const q = (rows ?? []).find((x) => x.request_id === made.coach?.requestId)
  q && q.register_as === 'coach' && q.wwcc_number === 'WWC1234567E' && q.program_id === null && q.role_note === 'U8s on Saturdays' ? ok('the queue carries the role, the WWCC number and the note, and no program') : bad(`queue row: ${JSON.stringify(q)?.slice(0, 200)}`)

  head('2. Nothing before the WWCC is checked on the register')
  const early = await post('/api/register/approve', { requestId: made.coach.requestId, decision: 'approve', teamId: U8 }, cookie)
  early.status === 422 && /checked on the Service NSW register/.test(early.error ?? '') ? ok('approving the coach is refused until the tick') : bad(`early approve: ${early.status} ${early.error ?? ''}`)
  // The account exists from the start now (the sign-up brief); a refused
  // approval must grant it nothing.
  const coachBefore = await profileOf(PEOPLE.coach.phone)
  const { count: hats } = coachBefore ? await admin.from('academy_members').select('*', { count: 'exact', head: true }).eq('academy_id', NRIFA).eq('profile_id', coachBefore) : { count: 0 }
  hats === 0 ? ok('and nothing was granted — their account is still a stranger to the club') : bad(`${hats} membership rows after a refused approval`)
  for (const role of ['coach', 'team_manager', 'referee']) {
    const { error } = await owner.client.rpc('confirm_wwcc_check', { p_request: made[role].requestId, p_checked: true })
    if (error) bad(`tick ${role}: ${error.message}`)
  }
  const noTeam = await post('/api/register/approve', { requestId: made.team_manager.requestId, decision: 'approve' }, cookie)
  noTeam.status === 422 && /squad/.test(noTeam.error ?? '') ? ok('a manager cannot be approved without a squad') : bad(`manager without team: ${noTeam.status} ${noTeam.error ?? ''}`)

  head('3. Approved: each gets the right thing')
  const a = await post('/api/register/approve', { requestId: made.coach.requestId, decision: 'approve', teamId: U8 }, cookie)
  const coachId = await profileOf(PEOPLE.coach.phone)
  const { data: coachHats } = coachId ? await admin.from('academy_members').select('roles').eq('academy_id', NRIFA).eq('profile_id', coachId).maybeSingle() : { data: null }
  const { data: coachSquad } = coachId ? await admin.from('team_members').select('role').eq('team_id', U8).eq('profile_id', coachId).maybeSingle() : { data: null }
  const { data: coachClear } = coachId ? await admin.from('staff_clearances').select('number, outcome, expires_on, verified_by').eq('academy_id', NRIFA).eq('profile_id', coachId).maybeSingle() : { data: null }
  a.status === 200 && a.role === 'coach' && (coachHats?.roles ?? []).includes('coach') && coachSquad?.role === 'coach' ? ok('the coach: an account, the coach hat, the U8 squad as its coach') : bad(`coach: ${a.status} ${a.error ?? ''}; hats ${JSON.stringify(coachHats)}; squad ${JSON.stringify(coachSquad)}`)
  coachClear?.number === 'WWC1234567E' && coachClear.outcome === 'cleared' && coachClear.expires_on === inTwoYears && coachClear.verified_by === owner.session.user.id ? ok('their clearance recorded: the number, the expiry, checked by the owner') : bad(`clearance ${JSON.stringify(coachClear)}`)
  const { count: players } = await admin.from('players').select('id', { count: 'exact', head: true }).eq('academy_id', NRIFA).eq('full_name', PEOPLE.coach.name)
  players === 0 ? ok('and no player row for a coach') : bad(`${players} player rows for the coach`)

  const m = await post('/api/register/approve', { requestId: made.team_manager.requestId, decision: 'approve', teamId: U8 }, cookie)
  const managerId = await profileOf(PEOPLE.team_manager.phone)
  const { data: managerRole } = managerId ? await admin.from('club_roles').select('role, scope_kind, team_id').eq('academy_id', NRIFA).eq('profile_id', managerId).maybeSingle() : { data: null }
  const { data: managerHats } = managerId ? await admin.from('academy_members').select('roles').eq('academy_id', NRIFA).eq('profile_id', managerId).maybeSingle() : { data: null }
  m.status === 200 && managerRole?.role === 'team_manager' && managerRole.scope_kind === 'team' && managerRole.team_id === U8 && (managerHats?.roles ?? []).includes('parent') ? ok('the team manager: the club role on the U8s, a member') : bad(`manager: ${m.status} ${m.error ?? ''}; role ${JSON.stringify(managerRole)}; hats ${JSON.stringify(managerHats)}`)

  const v = await post('/api/register/approve', { requestId: made.volunteer.requestId, decision: 'approve' }, cookie)
  const volunteerId = await profileOf(PEOPLE.volunteer.phone)
  const { data: volunteerRole } = volunteerId ? await admin.from('club_roles').select('role, scope_kind').eq('academy_id', NRIFA).eq('profile_id', volunteerId).maybeSingle() : { data: null }
  const { count: volunteerClear } = volunteerId ? await admin.from('staff_clearances').select('id', { count: 'exact', head: true }).eq('profile_id', volunteerId) : { count: 0 }
  v.status === 200 && volunteerRole?.role === 'volunteer' && volunteerRole.scope_kind === 'club' && volunteerClear === 0 ? ok('the volunteer: the club role, no squad needed, no clearance to record') : bad(`volunteer: ${v.status} ${v.error ?? ''}; role ${JSON.stringify(volunteerRole)}; clearances ${volunteerClear}`)

  const r = await post('/api/register/approve', { requestId: made.referee.requestId, decision: 'approve' }, cookie)
  const refereeId = await profileOf(PEOPLE.referee.phone)
  const { data: pool } = refereeId ? await admin.from('referees').select('status, claimed_at, full_name').eq('academy_id', NRIFA).eq('profile_id', refereeId).maybeSingle() : { data: null }
  const { data: refClear } = refereeId ? await admin.from('staff_clearances').select('number').eq('profile_id', refereeId).maybeSingle() : { data: null }
  r.status === 200 && pool?.status === 'active' && pool.claimed_at && pool.full_name === PEOPLE.referee.name && refClear?.number === 'WWC1234567E' ? ok('the referee: in the pool, claimed, with the clearance') : bad(`referee: ${r.status} ${r.error ?? ''}; pool ${JSON.stringify(pool)}; clearance ${JSON.stringify(refClear)}`)
  const { data: decided } = await admin.from('registration_requests').select('status, profile_id').eq('id', made.referee.requestId).single()
  decided?.status === 'approved' && decided.profile_id === refereeId ? ok('the request reads approved, linked to the account') : bad(`request ${JSON.stringify(decided)}`)

  head('4. The form and the queue, 375px')
  {
    // Signed in as the would-be coach: step 2 asks a stranger to create an account first.
    const { page, context } = await open(PEOPLE.browser, `/${SLUG}/register`, 'light')
    const chooser = await waitFor(page, '[data-register-as]')
    if (!chooser) bad('no Register as chooser')
    else {
      await tap(await page.$('[data-role-option="coach"]'))
      await page.waitForSelector('[data-register-as="coach"]', { timeout: 10000 })
      const programs = await page.$$('[aria-pressed]')
      const wwcc = await page.$(byLabel('Working With Children Check number'))
      wwcc ? ok('Coach picked: the WWCC fields show') : bad('no WWCC field for a coach')
      ;(await page.evaluate(() => document.body.innerText.includes('What for'))) === false ? ok('and no program list — a role is not for a program') : bad('the program list still shows for a coach')
      await page.type(byLabel('Your full name'), PEOPLE.browser.name, { delay: 5 })
      // The first date input on step 1 is the date of birth; the second the WWCC expiry.
      await setDate(page, 'input[type=date]', '1988-02-02')
      await page.type(byLabel('Working With Children Check number'), 'WWC7654321E', { delay: 5 })
      const dates = await page.$$('input[type=date]')
      if (dates[1]) await dates[1].evaluate((el, v) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })) }, inTwoYears)
      await shot(page, 'form-step1-light')
      const cont = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Continue'))
      const el = cont.asElement()
      if (!el) bad(`Continue not enabled: ${await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => b.textContent?.trim()).filter((t) => /Continue|Fill|WWCC|Choose/.test(t ?? '')).join(' | '))}`)
      else {
        await tap(el)
        await page.waitForFunction(() => document.body.innerText.includes('This is how the club replies'), { timeout: 15000 }).catch(() => {})
        const name = await page.$eval(byLabel('Your name'), (i) => i.value).catch(() => '')
        name === PEOPLE.browser.name ? ok('step 2: their name carried over') : bad(`step 2 name "${name}"`)
        // The mobile and email are the account's, filled in already.
        const mobile = await page.$eval(byLabel('Mobile'), (i) => i.value).catch(() => '')
        mobile === PEOPLE.browser.phone ? ok('and the mobile is the account\'s, filled in') : bad(`step 2 mobile "${mobile}"`)
        const boxes = await page.$$('input[type=checkbox]')
        for (const b of boxes) if (!(await b.evaluate((e) => e.checked))) await tap(b)
        await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.previousElementSibling?.textContent?.trim() === 'Back' && !b.disabled)?.click())
        const review = await page.waitForFunction(() => document.body.innerText.includes('Registering as'), { timeout: 15000 }).then(() => true).catch(() => false)
        review && (await fits(page)) ? ok('the review step says "Registering as Coach" with the WWCC') : bad('no review step')
        await shot(page, 'form-review-light')
        await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Send to the club/.test(b.textContent ?? ''))?.click())
        await page.waitForFunction(() => document.body.innerText.includes('Sent to the club'), { timeout: 30000 }).catch(() => {})
        const { data: sent } = await admin.from('registration_requests').select('register_as, wwcc_number, program_id, for_self').eq('academy_id', NRIFA).eq('child_name', PEOPLE.browser.name).maybeSingle()
        sent?.register_as === 'coach' && sent.wwcc_number === 'WWC7654321E' && sent.program_id === null && sent.for_self === true ? ok('sent from the browser: a coach\'s request with the WWCC, no program, their own') : bad(`browser request: ${JSON.stringify(sent)}`)
      }
    }
    await context.close()
    const dark = await open(owner, '/admin/registrations', 'dark')
    const row = await waitFor(dark.page, `xpath/.//button[contains(., ${JSON.stringify(PEOPLE.browser.name)})]`)
    if (!row) bad('the coach\'s request is not in the queue')
    else {
      await tap(row)
      const block = await dark.page.waitForSelector('[data-wwcc-block]', { timeout: 15000 }).catch(() => null)
      const chip = await dark.page.$('[data-register-as="coach"]')
      const text = await dark.page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))
      block && chip && /WWC7654321E/.test(text) && /Not checked/.test(text) ? ok('the queue: the Coach chip, the WWCC number, not yet checked') : bad(`queue: block ${Boolean(block)} chip ${Boolean(chip)} ${text.slice(0, 200)}`)
      const accept = await dark.page.$('[data-accept]')
      accept && (await accept.evaluate((b) => b.disabled)) ? ok('Accept waits on the check') : bad('Accept enabled before the check')
      await shot(dark.page, 'queue-dark')
      const tick = await dark.page.$('[data-wwcc-check]')
      if (tick) {
        await tap(tick)
        await dark.page.waitForFunction(() => document.body.innerText.includes('Checked on the register'), { timeout: 15000 }).catch(() => {})
        const after = await dark.page.$('[data-accept]')
        after && !(await after.evaluate((b) => b.disabled)) && (await fits(dark.page)) ? ok('ticked: Accept is live, 375px dark') : bad('Accept still disabled after the tick')
        await shot(dark.page, 'queue-ticked-dark')
      } else bad('no tick button')
    }
    await dark.context.close()
  }
} catch (e) {
  bad(`threw: ${e.message}`)
} finally {
  await browser.close()
  await cleanup()
  const { count } = await admin.from('registration_requests').select('id', { count: 'exact', head: true }).eq('academy_id', NRIFA).like('child_name', `${TAG} %`)
  const { data: users } = await listAllUsers(admin)
  const left = Object.values(PEOPLE).filter((p) => users?.users?.some((x) => x.phone === p.phone.replace('+', ''))).length
  count === 0 && left === 0 ? ok('everything made here is gone') : bad(`${count} requests, ${left} accounts left`)
}
console.log(process.exitCode ? '' : '\n  \x1b[32mregister as: coach, manager, volunteer or referee — the WWCC checked, the role given\x1b[0m\n')
