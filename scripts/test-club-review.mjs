// Run: node --env-file=.env.local scripts/test-club-review.mjs
//   (the dev server on :3000; SHOTS=1 saves the screens at 375px)
//
// The registration brief, gap 7 (0268): the club's review, on NRIFA. Three
// children register from the public form. The owner's queue filters by
// name and by program; "Needs info" sends a question to one family, who
// see it on the page they registered from and answer it there, and the
// queue shows the answer; a child is accepted into the U8s with jersey 7
// in the same step, a second child cannot have 7 this season, 8 is fine;
// on the Decided tab the accepted child is deregistered with a reason and
// the row says so. Everything made here is removed.
import { createClient } from '@supabase/supabase-js'
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'
import { signInBoth } from './_auth.mjs'
import { listAllUsers } from './_users.mjs'
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
const TAG = 'Zz Review'
const PHONE = '+61400009971'
const until = async (fn, ms = 15000, every = 500) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, every)) }
  return null
}
const post = async (path, body, cookie) => {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, ...json }
}

const owner = await signInBoth(admin, 'head@squadroom-demo.test')
if (!owner) { console.log("  could not sign in — the project's auth rate limit, not a failure"); process.exit(2) }
const cookie = `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(owner.session)).toString('base64')}`
// The public form allows twenty registrations an hour from one address; the
// throttle log is not demo data.
await admin.from('registration_attempts').delete().gte('created_at', '1970-01-01')
const { data: u8 } = await admin.from('teams').select('season').eq('id', U8).single()
const SEASON = u8?.season ?? String(new Date().getFullYear())

async function cleanup() {
  const { data: kids } = await admin.from('players').select('id').eq('academy_id', NRIFA).like('full_name', `${TAG} %`)
  for (const k of kids ?? []) {
    await admin.from('squad_numbers').delete().eq('player_id', k.id)
    await admin.from('program_registrations').delete().eq('player_id', k.id)
    await admin.from('player_guardians').delete().eq('player_id', k.id)
    await admin.from('players').delete().eq('id', k.id)
  }
  await admin.from('registration_requests').delete().eq('academy_id', NRIFA).like('child_name', `${TAG} %`)
  await admin.from('programs').delete().eq('academy_id', NRIFA).like('name', `${TAG} %`)
  const { data: users } = await listAllUsers(admin)
  const u = users?.users?.find((x) => x.phone === PHONE.replace('+', ''))
  if (u) {
    await admin.from('team_members').delete().eq('profile_id', u.id)
    await admin.from('academy_members').delete().eq('profile_id', u.id)
    await admin.auth.admin.deleteUser(u.id)
  }
}
await cleanup()

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
async function open(who, path, scheme, seed) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 375, height: 812 })
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }])
  if (who) await page.setCookie({ name: `sb-${ref}-auth-token`, value: 'base64-' + Buffer.from(JSON.stringify(who.session)).toString('base64'), domain: 'localhost', path: '/' })
  await page.evaluateOnNewDocument((o, s) => { try { if (o) localStorage.setItem('squadroom.org', o); for (const [k, v] of Object.entries(s ?? {})) localStorage.setItem(k, v) } catch {} }, who ? NRIFA : null, seed ?? {})
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
const shot = (page, name) => SHOTS ? page.screenshot({ path: `.shots/club-review-${name}.png`, fullPage: true }) : null
const tap = async (h) => { await h.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' })); await h.click() }
const rowFor = (page, name) => waitFor(page, `xpath/.//button[contains(., ${JSON.stringify(name)})]`)
const visibleRows = (page) => page.$$eval('[data-request-photo], button', () => 0).then(() => page.evaluate((t) => [...document.querySelectorAll('button')].filter((b) => b.textContent?.includes(t) && b.className.includes('min-w-0')).length, TAG))

const ONE = `${TAG} Child One`, TWO = `${TAG} Child Two`, THREE = `${TAG} Child Three`
const made = {}
try {
  const { data: program } = await admin.from('programs').insert({ academy_id: NRIFA, name: `${TAG} Squad`, kind: 'squad', status: 'open', season: SEASON, created_by: owner.session.user.id, payment_required: false, born_from_year: 2015, born_to_year: 2018 }).select('id').single()
  const { data: pub } = await admin.rpc('public_programs', { p_slug: SLUG })
  const consents = (pub?.consents ?? []).map((c) => ({ id: c.id, version: c.version }))
  for (const [child, dob] of [[ONE, '2016-01-01'], [TWO, '2017-02-02'], [THREE, '2018-03-03']]) {
    const r = await post('/api/register/request', { slug: SLUG, programId: program.id, guardianName: `${TAG} Parent`, guardianPhone: PHONE, guardianEmail: 'review.parent@example.com', childName: child, childDob: dob, consents })
    if (r.status !== 200) bad(`request ${child}: ${r.status} ${r.error ?? ''}`)
    made[child] = r
  }
  head('1. The filters')
  {
    const { page, context } = await open(owner, '/admin/registrations', 'light')
    const box = await waitFor(page, '[data-filter-text]')
    if (!box) bad('no filter box (the queue has fewer than four rows?)')
    else {
      await page.type('[data-filter-text]', 'Child Two', { delay: 10 })
      await new Promise((r) => setTimeout(r, 400))
      const n = await visibleRows(page)
      const two = await page.$(`xpath/.//button[contains(., ${JSON.stringify(TWO)})]`)
      n === 1 && two ? ok('typing "Child Two" leaves one row') : bad(`${n} rows after filtering`)
      await page.click('[data-filter-text]', { clickCount: 3 })
      await page.keyboard.press('Backspace')
      const sel = await page.$('[data-filter-program]')
      if (sel) {
        await page.select('[data-filter-program]', program.id)
        await new Promise((r) => setTimeout(r, 400))
        const m = await visibleRows(page)
        m === 3 ? ok('the program filter leaves the three of this squad') : bad(`${m} rows under the program filter`)
        await page.select('[data-filter-program]', '')
      } else ok('one program on the queue: no program filter to show')
      await shot(page, 'filters-light')
    }
    await context.close()
  }

  head('2. Needs info: a question out, an answer back')
  {
    const { page, context } = await open(owner, '/admin/registrations', 'light')
    const row = await rowFor(page, ONE)
    await tap(row)
    const btn = await page.waitForSelector('[data-needs-info]', { timeout: 15000 }).catch(() => null)
    if (!btn) bad('no Needs info button')
    else {
      await tap(btn)
      await page.waitForSelector('[data-info-text]', { timeout: 10000 })
      await page.type('[data-info-text]', 'Which school does Child One go to?', { delay: 5 })
      await tap(await page.$('[data-info-send]'))
      const asked = await until(async () => { const { data } = await admin.from('registration_requests').select('info_note, info_requested_by, status').eq('id', made[ONE].requestId).single(); return data?.info_note ? data : null })
      asked?.info_note === 'Which school does Child One go to?' && asked.info_requested_by === owner.session.user.id && asked.status === 'pending' ? ok('the question is on the request, by the owner; it still waits') : bad(`asked: ${JSON.stringify(asked)}`)
      const chip = await page.waitForSelector('[data-info-state="asked"]', { timeout: 15000 }).catch(() => null)
      chip ? ok('the row says Asked for info') : bad('no chip')
      await shot(page, 'asked-light')
    }
    await context.close()
    const fam = await open(null, `/${SLUG}/register`, 'dark', { [`squadroom.registration.${SLUG}`]: JSON.stringify({ requestId: made[ONE].requestId, secret: made[ONE].secret, programId: program.id }) })
    const card = await waitFor(fam.page, '[data-needs-info]')
    const text = card ? await fam.page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ')) : ''
    card && /Which school does Child One go to\?/.test(text) ? ok('the family\'s page shows the question, 375px dark') : bad(`family page: ${text.slice(0, 200)}`)
    if (card) {
      await fam.page.type('[data-info-reply]', 'Ryde Public School', { delay: 5 })
      await tap(await fam.page.$('[data-info-send]'))
      const replied = await until(async () => { const { data } = await admin.from('registration_requests').select('family_reply').eq('id', made[ONE].requestId).single(); return data?.family_reply ? data : null })
      replied?.family_reply === 'Ryde Public School' && (await fam.page.waitForSelector('[data-info-replied]', { timeout: 10000 }).then(() => true).catch(() => false)) ? ok('answered from the page; the answer is on the request') : bad(`reply: ${JSON.stringify(replied)}`)
      ;(await fits(fam.page)) ? ok('375px dark fits') : bad('family page overflows')
      await shot(fam.page, 'family-reply-dark')
    }
    await fam.context.close()
    const back = await open(owner, '/admin/registrations', 'dark')
    const row2 = await rowFor(back.page, ONE)
    await tap(row2)
    const block = await back.page.waitForSelector('[data-info-block="replied"]', { timeout: 15000 }).catch(() => null)
    const t2 = block ? await back.page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ')) : ''
    block && /Ryde Public School/.test(t2) && (await back.page.$('[data-info-state="replied"]')) ? ok('the queue shows the answer and the row says Replied') : bad('the answer is not on the queue')
    await shot(back.page, 'replied-dark')
    await back.context.close()
    const stranger = await post('/api/register/reply', { requestId: made[ONE].requestId, secret: 'wrong', reply: 'x' })
    const notAsked = await post('/api/register/reply', { requestId: made[TWO].requestId, secret: made[TWO].secret, reply: 'x' })
    stranger.status === 404 && notAsked.status === 409 ? ok('a wrong secret is nothing; an unasked family has nothing to answer') : bad(`stranger ${stranger.status}, not asked ${notAsked.status}`)
  }

  head('3. Accepted into the U8s with number 7, in one step')
  {
    const a = await post('/api/register/approve', { requestId: made[TWO].requestId, decision: 'approve', teamId: U8, number: 7 }, cookie)
    const { data: kid } = await admin.from('players').select('id, team_id').eq('academy_id', NRIFA).eq('full_name', TWO).maybeSingle()
    const { data: num } = kid ? await admin.from('squad_numbers').select('number, season, assigned_by').eq('player_id', kid.id).maybeSingle() : { data: null }
    a.status === 200 && kid?.team_id === U8 && num?.number === 7 && num.season === SEASON && num.assigned_by === owner.session.user.id ? ok(`accepted: in the U8s, number 7 for ${SEASON}, assigned by the owner`) : bad(`approve with number: ${a.status} ${a.error ?? ''}; kid ${JSON.stringify(kid)}; number ${JSON.stringify(num)}`)
    const clash = await post('/api/register/approve', { requestId: made[THREE].requestId, decision: 'approve', teamId: U8, number: 7 }, cookie)
    const { data: still } = await admin.from('registration_requests').select('status').eq('id', made[THREE].requestId).single()
    const { count: nobody } = await admin.from('players').select('id', { count: 'exact', head: true }).eq('academy_id', NRIFA).eq('full_name', THREE)
    clash.status === 409 && /taken this season/.test(clash.error ?? '') && still?.status === 'pending' && nobody === 0 ? ok('7 again: refused before anything was written — still pending, no player') : bad(`clash: ${clash.status} ${clash.error ?? ''}; status ${still?.status}; players ${nobody}`)
    const bad99 = await post('/api/register/approve', { requestId: made[THREE].requestId, decision: 'approve', teamId: U8, number: 120 }, cookie)
    bad99.status === 400 ? ok('120 is not a squad number') : bad(`120: ${bad99.status}`)
    const { page, context } = await open(owner, '/admin/registrations', 'light')
    const row = await rowFor(page, THREE)
    await tap(row)
    await page.waitForSelector('[data-squad-select]', { timeout: 15000 })
    await page.select('[data-squad-select]', U8)
    const numberBox = await page.waitForSelector('[data-number]', { timeout: 10000 }).catch(() => null)
    const hint = numberBox ? await until(() => page.$eval('[data-number]', (el) => (el.placeholder.includes('free') ? el.placeholder : null)), 10000, 300) : null
    numberBox && hint && !/\b7 is free/.test(hint) ? ok(`picking the squad shows the number field with a free one suggested (“${hint}”)`) : bad(`number field ${Boolean(numberBox)} hint "${hint}"`)
    await page.type('[data-number]', '8', { delay: 5 })
    await shot(page, 'accept-number-light')
    await tap(await page.$('[data-accept]'))
    const kid3 = await until(async () => { const { data } = await admin.from('players').select('id').eq('academy_id', NRIFA).eq('full_name', THREE).maybeSingle(); return data ?? null })
    const { data: num3 } = kid3 ? await admin.from('squad_numbers').select('number').eq('player_id', kid3.id).maybeSingle() : { data: null }
    kid3 && num3?.number === 8 ? ok('accepted from the queue with number 8') : bad(`from the queue: kid ${Boolean(kid3)} number ${JSON.stringify(num3)}`)
    await context.close()
  }

  head('4. After approval it is Deregister')
  {
    const { page, context } = await open(owner, '/admin/registrations', 'dark')
    await waitFor(page, '[data-filter-text]')
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Decided')?.click())
    const row = await rowFor(page, TWO)
    await tap(row)
    const btn = await page.waitForSelector('[data-deregister]', { timeout: 15000 }).catch(() => null)
    const noReject = await page.evaluate(() => ![...document.querySelectorAll('button')].some((b) => /Decline|Reject/.test(b.textContent ?? '')))
    btn && noReject ? ok('an accepted row offers Deregister and no Reject') : bad(`deregister ${Boolean(btn)}, no reject ${noReject}`)
    if (btn) {
      await tap(btn)
      await page.waitForSelector('[data-deregister-reason]', { timeout: 10000 })
      await page.type('[data-deregister-reason]', 'Zz: moved interstate', { delay: 5 })
      await tap(await page.$('[data-deregister-send]'))
      const { data: kid } = await admin.from('players').select('id').eq('academy_id', NRIFA).eq('full_name', TWO).single()
      const gone = await until(async () => { const { data } = await admin.from('program_registrations').select('status, decision_note').eq('player_id', kid.id).maybeSingle(); return data?.status === 'withdrawn' ? data : null })
      gone?.decision_note === 'Zz: moved interstate' ? ok('deregistered with the reason; the registration reads withdrawn') : bad(`after deregister: ${JSON.stringify(gone)}`)
      const chip = await page.waitForSelector('[data-deregistered]', { timeout: 15000 }).catch(() => null)
      chip && (await fits(page)) ? ok('the row says Deregistered, 375px dark') : bad('no Deregistered chip')
      await shot(page, 'deregistered-dark')
    }
    await context.close()
  }
} catch (e) {
  bad(`threw: ${e.message}`)
} finally {
  await browser.close()
  await cleanup()
  const { count } = await admin.from('registration_requests').select('id', { count: 'exact', head: true }).eq('academy_id', NRIFA).like('child_name', `${TAG} %`)
  const { count: nums } = await admin.from('squad_numbers').select('id', { count: 'exact', head: true }).eq('academy_id', NRIFA).eq('season', SEASON).in('number', [7, 8]).eq('assigned_by', owner.session.user.id)
  count === 0 ? ok(`everything made here is gone${nums ? ` (numbers 7/8 held by others this season: ${nums})` : ''}`) : bad(`${count} requests left`)
}
console.log(process.exitCode ? '' : '\n  \x1b[32mthe club\'s review: filters, a question to the family, the jersey with the squad, deregister after\x1b[0m\n')
