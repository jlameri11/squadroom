// Run: BASE_URL=http://localhost:3000 node --env-file=.env.local scripts/test-playfootball-first.mjs
//   (needs the app running with 0284 — npm run dev, or serve:test after a build)
//
// PlayFootball first, Squadi-style but smoother (Joey, 16 Nov 2026; 0284).
// A throwaway club that requires PlayFootball, a program, the club's import
// with one child in it. Then, in a real browser at 375px:
//   · a family whose child IS in the import: Step 1 (the PlayFootball screen),
//     "I've done it", an account, the child claimed by name + birthday + FFA
//     number, only what the import does not have — and the whole of step 2
//     in under two minutes, with nothing the import had asked again;
//   · a family whose child is NOT in the import yet: let in as PlayFootball
//     pending, chased, the Registrar reminded to import; the next import
//     confirms them.
// And a club that does not require PlayFootball sees none of it. Everything
// made here is removed.
import { createClient } from '@supabase/supabase-js'
import puppeteer from 'puppeteer-core'
import { createAccount, deleteAccount } from './_account.mjs'
import { signInBoth } from './_auth.mjs'
import { resolveBaseUrl } from './_base-url.mjs'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SHOTS = process.env.SHOTS === '1'
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }
const note = (m) => console.log(`  \x1b[2m… ${m}\x1b[0m`)
const head = (m) => console.log(`\n${m}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const TAG = `PF${Date.now().toString(36).slice(-5)}`
const OWNER_EMAIL = `pf-owner-${TAG.toLowerCase()}@squadroom-demo.test`
const FAM1_EMAIL = `pf-family1-${TAG.toLowerCase()}@squadroom-demo.test`
const FAM2_EMAIL = `pf-family2-${TAG.toLowerCase()}@squadroom-demo.test`
const mobile = (n) => `+6147${String(1000000 + (Date.now() % 900000) + n).slice(-7)}`
const cookieFor = (session) => {
  const ref = URL_.split('//')[1].split('.')[0]
  return `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`
}

const BASE = process.env.BASE_URL ?? (await resolveBaseUrl({ quiet: true }))
const made = { clubs: [], emails: [] }
async function cleanup() {
  for (const id of made.clubs) await admin.from('academies').delete().eq('id', id)
  for (const e of made.emails) await deleteAccount(admin, e).catch(() => {})
}

let browser = null
try {
  head('0. A club that registers in PlayFootball first, its program, its import')
  const owner = await createAccount(BASE, { first: 'Priya', last: `Registrar ${TAG}`, email: OWNER_EMAIL, mobile: mobile(1) })
  made.emails.push(OWNER_EMAIL)
  const ownerIn = await signInBoth(admin, OWNER_EMAIL)
  if (!ownerIn) { console.log("  could not sign in — the project's auth rate limit, not a failure"); process.exit(2) }
  const { data: clubId, error: e0 } = await ownerIn.client.rpc('create_academy', { p_name: `PF Test Club ${TAG}`, p_type: 'club' })
  if (e0 || !clubId) { bad(`create_academy: ${e0?.message}`); await cleanup(); process.exit(1) }
  made.clubs.push(clubId)
  const { data: clubRow } = await admin.from('academies').select('slug').eq('id', clubId).single()
  const slug = clubRow.slug
  // A club made by hand in a suite does not require two-step of its owner (CLAUDE.md); this one requires PlayFootball.
  const { error: e1 } = await admin.from('academies').update({ two_step_required: false, requires_playfootball: true, playfootball_url: 'https://www.playfootball.com.au/football-finder' }).eq('id', clubId)
  e1 ? bad(`the club's switch: ${e1.message}`) : ok(`${slug} registers in PlayFootball first`)
  const { error: eBad } = await admin.from('academies').update({ playfootball_url: 'https://example.com/not-playfootball' }).eq('id', clubId)
  eBad ? ok('a PlayFootball page must be on playfootball.com.au') : bad('an address off playfootball.com.au was kept')
  const { data: program } = await admin.from('programs').insert({ academy_id: clubId, name: `${TAG} U10s 2026`, kind: 'squad', status: 'open', season: '2026', born_from_year: 2015, born_to_year: 2017 }).select('id').single()
  const CHILD1 = { name: `Amelie Testling ${TAG}`, dob: '2016-04-02', ffa: '70000011' }
  const CHILD2 = { name: `Bo Testling ${TAG}`, dob: '2016-09-09', ffa: '70000022' }
  const { data: imp1, error: eImp } = await ownerIn.client.rpc('import_official_status', { p_academy: clubId, p_rows: [{ full_name: CHILD1.name, dob: CHILD1.dob, ffa_number: CHILD1.ffa, status: 'Registered' }] })
  eImp ? bad(`the import: ${eImp.message}`) : imp1.rows === 1 && imp1.matched === 0 && imp1.unmatched.length === 1 ? ok('the import keeps its one row to claim from (nobody on the roster yet)') : bad(`import answered ${JSON.stringify(imp1)}`)
  const anon = createClient(URL_, PUB, { auth: { persistSession: false } })
  const { data: pub } = await anon.rpc('public_programs', { p_slug: slug })
  pub?.academy?.requires_playfootball === true && pub.programs?.[0]?.fee_kind === 'extra' ? ok('the front door says PlayFootball first, and its fees are extras') : bad(`public_programs: ${JSON.stringify(pub?.academy)} ${JSON.stringify(pub?.programs?.[0])}`)
  const { data: standing } = await ownerIn.client.rpc('playfootball_import_status', { p_academy: clubId })
  standing?.rows === 1 && standing?.to_claim === 1 ? ok('the import screen can say where things stand: 1 row, 1 to claim') : bad(`standing ${JSON.stringify(standing)}`)

  head('1. A family whose child is in the import — the real screens at 375px')
  const fam1 = await createAccount(BASE, { first: 'Hanna', last: `Testling ${TAG}`, email: FAM1_EMAIL, mobile: mobile(2), next: `/${slug}/register` })
  made.emails.push(FAM1_EMAIL)
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 375, height: 812 })
  await page.setCookie(...fam1.browserCookies)
  const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `.shots/playfootball-${name}.png`, fullPage: true }).catch(() => null) }
  const setDate = (sel, ymd) => page.$eval(sel, (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }, ymd)
  const inputByLabel = async (label) => {
    const handle = await page.evaluateHandle((text) => {
      for (const l of document.querySelectorAll('label')) {
        const span = l.querySelector('span')
        if (span && span.textContent.trim() === text) return l.querySelector('input, select, textarea')
      }
      return null
    }, label)
    return handle.asElement()
  }
  const clickText = async (text, tag = 'button') => {
    const found = await page.evaluateHandle((t, tg) => [...document.querySelectorAll(tg)].find((b) => b.textContent.trim().startsWith(t)) ?? null, text, tag)
    const el = found.asElement()
    if (!el) throw new Error(`no ${tag} reading "${text}"`)
    await el.click()
  }
  const TYPING = { delay: 45 } // a thumb, not a script
  let typed = 0
  const t0 = Date.now()
  await page.goto(`${BASE}/${slug}/register`, { waitUntil: 'networkidle2', timeout: 120000 })
  const step1 = await page.waitForSelector('[data-playfootball-step1]', { timeout: 30000 }).catch(() => null)
  step1 ? ok('Step 1 comes first: "Register in PlayFootball → come back here"') : bad('no Step 1 screen')
  await shot('1-step1')
  const openHref = await page.$eval('[data-playfootball-open]', (a) => a.getAttribute('href')).catch(() => null)
  openHref?.startsWith('https://www.playfootball.com.au/') ? ok(`the button opens PlayFootball (${openHref.slice(0, 44)}…)`) : bad(`the button opens ${openHref}`)
  const formBefore = await page.$('[data-register-as]')
  formBefore ? bad('the form showed before Step 1 was done') : ok('nothing else is asked before Step 1')
  await page.click('[data-playfootball-done]')
  await page.waitForSelector('[data-register-as]', { timeout: 15000 })
  ok('"I\'ve done it" brings them back to the form')
  await clickText(`${TAG} U10s 2026`)
  await sleep(300)
  const nameIn = await inputByLabel('Their full name')
  await nameIn.type(CHILD1.name, TYPING); typed++
  const dobIn = await inputByLabel('Date of birth')
  await setDate(`label:has(> span) input[type="date"]`, CHILD1.dob); typed++
  void dobIn
  const ffaIn = await inputByLabel('FFA number')
  await ffaIn.type(CHILD1.ffa, TYPING); typed++
  const canFind = await page.$('[data-pf-find]')
  canFind ? ok('with name, birthday and FFA number, the form offers to find them in the club\'s list') : bad('no find button (signed in?)')
  await page.click('[data-pf-find]')
  const claimed = await page.waitForSelector('[data-pf-claimed]', { timeout: 20000 }).catch(() => null)
  claimed ? ok('found in the club\'s PlayFootball list — registered') : bad(`not found: ${await page.$eval('[data-pf-claim-card]', (e) => e.textContent).catch(() => '?')}`)
  await shot('2-claimed')
  await clickText('Girl')
  await clickText('Continue')
  await page.waitForSelector('[data-register-you]', { timeout: 15000 })
  const youName = await page.$eval('[data-register-you] input', (i) => i.value).catch(() => '')
  youName.includes('Hanna') ? ok('step 2 already knows who they are (the account)') : bad(`the "You" fields read "${youName}"`)
  const asksFfaAgain = await page.evaluate(() => [...document.querySelectorAll('label span')].some((s) => /FFA number/i.test(s.textContent)))
  asksFfaAgain ? bad('step 2 asks the FFA number again') : ok('nothing the import already has is asked again')
  const em = await page.$$('[data-emergency-step] input')
  em.length === 3 ? ok('what is missing is asked: an emergency contact') : bad(`emergency fields: ${em.length}`)
  if (em.length === 3) {
    await em[0].type(`Nana Testling ${TAG}`, TYPING); typed++
    await em[1].type('0400 000 011', TYPING); typed++
    await em[2].type('Grandmother', TYPING); typed++
  }
  const kit = await page.$('[data-kit-shirt]')
  if (kit) { await page.select('[data-kit-shirt]', '10'); typed++ }
  await clickText('Continue')
  await page.waitForSelector('[data-review-playfootball]', { timeout: 15000 })
  const review = await page.$eval('[data-review-playfootball]', (e) => e.textContent)
  const reviewOk = /Registered/.test(review)
  reviewOk ? ok(`the review says: ${review.trim()}`) : bad(`the review says ${review}`)
  const feeText = await page.evaluate(() => document.body.innerText)
  const feeOk = /PlayFootball’s|PlayFootball's|club extra/.test(feeText)
  feeOk ? ok('the fee reads as a club extra; the registration fee is PlayFootball\'s') : bad('no word that the fee is an extra')
  await shot('3-review')
  await clickText('Send to the club')
  // The request is the proof it was sent (the review page already says "accepts").
  let req1 = null
  for (let i = 0; i < 40 && !req1; i++) {
    await sleep(500)
    req1 = (await admin.from('registration_requests').select('id, official_confirmed_at, playfootball_row_id, emergency_name, shirt_size, ffa_number').eq('academy_id', clubId).eq('child_name', CHILD1.name).maybeSingle()).data
  }
  const seconds = Math.round((Date.now() - t0) / 1000)
  req1 && seconds < 120 ? ok(`step 2 took ${seconds} s at a thumb's pace (${typed} things typed) — under two minutes`) : bad(req1 ? `step 2 took ${seconds} s` : `nothing was sent in ${seconds} s: ${(await page.evaluate(() => document.body.innerText)).slice(0, 200)}`)
  await shot('4-sent')
  req1?.playfootball_row_id && req1.official_confirmed_at && req1.ffa_number === CHILD1.ffa ? ok('the request carries the claimed row, confirmed by it, with the FFA number') : bad(`request ${JSON.stringify(req1)}`)
  req1?.emergency_name?.startsWith('Nana') ? ok('and the emergency contact') : bad(`emergency on the request: ${req1?.emergency_name}`)
  const approve1 = await fetch(`${BASE}/api/register/approve`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: cookieFor(ownerIn.session) }, body: JSON.stringify({ requestId: req1?.id, decision: 'approve' }) })
  approve1.ok ? ok('the club accepts') : bad(`approve: ${approve1.status} ${await approve1.text()}`)
  const { data: p1 } = await admin.from('players').select('id, official_status, ff_number, shirt_size').eq('academy_id', clubId).eq('full_name', CHILD1.name).maybeSingle()
  p1?.official_status === 'registered' && p1.ff_number === CHILD1.ffa ? ok(`on the roster as registered, FFA ${p1.ff_number}${p1.shirt_size ? `, shirt ${p1.shirt_size}` : ''}`) : bad(`player ${JSON.stringify(p1)}`)
  const { data: med1 } = await admin.from('player_medical').select('emergency_name, emergency_phone').eq('player_id', p1?.id ?? '00000000-0000-0000-0000-000000000000').maybeSingle()
  med1?.emergency_name?.startsWith('Nana') ? ok('the emergency contact is where the club keeps it') : bad(`medical ${JSON.stringify(med1)}`)
  const { data: row1 } = await admin.from('playfootball_rows').select('player_id, claimed_at').eq('academy_id', clubId).eq('ffa_number', CHILD1.ffa).maybeSingle()
  row1?.player_id === p1?.id && row1.claimed_at ? ok('the import row points at the roster record and says who claimed it') : bad(`row ${JSON.stringify(row1)}`)
  await context.close()

  head('2. A family whose child is not in the import — PlayFootball pending, chased, confirmed later')
  const fam2 = await createAccount(BASE, { first: 'Ola', last: `Testling ${TAG}`, email: FAM2_EMAIL, mobile: mobile(3) })
  made.emails.push(FAM2_EMAIL)
  const r2 = await fetch(`${BASE}/api/register/request`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: fam2.cookie }, body: JSON.stringify({ slug, programId: program.id, childName: CHILD2.name, childDob: CHILD2.dob, childFfa: CHILD2.ffa, childGender: 'male', answers: {}, consents: [], emergencyName: `Pop Testling ${TAG}`, emergencyPhone: '0400 000 022', emergencyRelation: 'Grandfather' }) })
  const made2 = await r2.json().catch(() => ({}))
  r2.ok ? ok('a child not in the import registers all the same') : bad(`request: ${r2.status} ${JSON.stringify(made2)}`)
  const approve2 = await fetch(`${BASE}/api/register/approve`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: cookieFor(ownerIn.session) }, body: JSON.stringify({ requestId: made2.requestId, decision: 'approve' }) })
  approve2.ok ? ok('the club lets them in (no 409 — the team sheet is the gate now)') : bad(`approve: ${approve2.status} ${await approve2.text()}`)
  const { data: p2 } = await admin.from('players').select('id, official_status').eq('academy_id', clubId).eq('full_name', CHILD2.name).maybeSingle()
  p2?.official_status === 'pending' ? ok('on the roster as PlayFootball pending') : bad(`player ${JSON.stringify(p2)}`)
  const { data: chased } = await admin.rpc('queue_official_rego_reminders')
  const { data: n2 } = await admin.from('notification_queue').select('id, body').eq('kind', 'official_rego_pending').eq('profile_id', (await admin.from('account_emails').select('profile_id').ilike('email', FAM2_EMAIL).single()).data.profile_id).filter('payload->>player_id', 'eq', p2?.id ?? '')
  n2?.length === 1 && /PlayFootball pending/.test(n2[0].body) ? ok(`the family is chased without a game in sight: "${n2[0].body.slice(0, 70)}…" (${chased} queued)`) : bad(`chase: ${JSON.stringify(n2)} (${chased})`)
  const { data: n1 } = await admin.from('notification_queue').select('id').eq('kind', 'official_rego_pending').filter('payload->>player_id', 'eq', p1?.id ?? '')
  const chasedRegistered = (n1 ?? []).length
  chasedRegistered === 0 ? ok('a registered child\'s family is not') : bad('the registered child\'s family was chased')
  // The Registrar's weekly reminder: due once the import is a week old while anyone is pending.
  const { data: due0 } = await admin.rpc('queue_playfootball_import_reminders')
  const ownerId = (await admin.from('account_emails').select('profile_id').ilike('email', OWNER_EMAIL).single()).data.profile_id
  const importDue = () => admin.from('notification_queue').select('id, body, payload').eq('kind', 'playfootball_import_due').eq('academy_id', clubId).eq('profile_id', ownerId)
  const fresh = (await importDue()).data?.length ?? 0
  fresh === 0 ? ok(`no import reminder while this week's import stands (${due0} queued)`) : bad('reminded with a fresh import')
  await admin.from('playfootball_imports').update({ imported_at: new Date(Date.now() - 8 * 864e5).toISOString() }).eq('academy_id', clubId)
  const { data: due1 } = await admin.rpc('queue_playfootball_import_reminders')
  const d1 = (await importDue()).data ?? []
  d1.length === 1 && Number(d1[0].payload?.pending) === 1 ? ok(`a week on, with one child pending, the club is reminded: "${d1[0].body.slice(0, 80)}…"`) : bad(`import reminder: ${JSON.stringify(d1)} (${due1})`)
  await admin.rpc('queue_playfootball_import_reminders')
  const weekly = ((await importDue()).data ?? []).length
  weekly === 1 ? ok('once a week, not once a day') : bad('reminded twice in a week')
  const { data: imp2 } = await ownerIn.client.rpc('import_official_status', { p_academy: clubId, p_rows: [{ full_name: CHILD2.name, dob: CHILD2.dob, ffa_number: CHILD2.ffa, status: 'Registered' }] })
  const { data: p2b } = await admin.from('players').select('official_status, ff_number').eq('id', p2?.id ?? '00000000-0000-0000-0000-000000000000').maybeSingle()
  imp2?.matched === 1 && p2b?.official_status === 'registered' ? ok('the next import confirms them — registered, cleared for team sheets') : bad(`second import ${JSON.stringify(imp2)} → ${JSON.stringify(p2b)}`)

  head('3. A club that does not require PlayFootball skips Step 1 entirely')
  const { data: club2 } = await ownerIn.client.rpc('create_academy', { p_name: `Plain Club ${TAG}`, p_type: 'club' })
  if (club2) {
    made.clubs.push(club2)
    await admin.from('academies').update({ two_step_required: false }).eq('id', club2)
    const { data: c2 } = await admin.from('academies').select('slug').eq('id', club2).single()
    await admin.from('programs').insert({ academy_id: club2, name: `${TAG} Camp`, kind: 'camp', status: 'open', season: '2026' })
    const { data: pub2 } = await anon.rpc('public_programs', { p_slug: c2.slug })
    pub2?.academy?.requires_playfootball === false && pub2.programs?.[0]?.fee_kind === 'fee' ? ok('the front door says nothing of PlayFootball; its fee is a fee') : bad(`public_programs: ${JSON.stringify(pub2?.academy)}`)
    const ctx2 = await browser.createBrowserContext()
    const page2 = await ctx2.newPage()
    await page2.setViewport({ width: 375, height: 812 })
    await page2.goto(`${BASE}/${c2.slug}/register`, { waitUntil: 'networkidle2', timeout: 120000 })
    await page2.waitForSelector('[data-register-as]', { timeout: 30000 }).catch(() => null)
    const s1 = await page2.$('[data-playfootball-step1]')
    s1 ? bad('Step 1 showed at a club that does not require PlayFootball') : ok('the form opens straight away')
    await ctx2.close()
  }
  console.log(process.exitCode ? '\n  \x1b[31msome checks failed\x1b[0m' : '\n  \x1b[32mPlayFootball first, Squadi-style but smoother\x1b[0m')
} catch (e) {
  bad(`stopped: ${e.stack ?? e.message}`)
} finally {
  await browser?.close().catch(() => null)
  await cleanup()
}
