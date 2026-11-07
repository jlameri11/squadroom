// Run: node --env-file=.env.local scripts/test-returning-offers.mjs
//   (needs the app running — npm run dev, or serve:test; SHOTS=1 saves the
//   screens at 375px, light and dark, in .shots/)
//
// R-20, the Notice of Offer (0221–0222): every returning child not yet
// registered is offered their place for next season, to accept by a date.
//
// Two halves. The screens are checked now, in a browser at 375px in light
// and dark, with 0221's answers stood in by request interception: the
// family's offer, its two-step "won't be back", a place held for
// PlayFootball; the club's report with an open offer, a lapsed one, a form
// to approve and a "no", and exactly what "Offer N places" and "Ask again"
// send. The rest — who may offer, a place held against a newcomer, accept,
// decline, ask again, Home's row, the nudge — runs against squadroom-dev once
// 0221 is applied, and says it is waiting until then. test-rls 135–140 and a
// local run (scripts/local-db) prove the database half meanwhile.
import { createClient } from '@supabase/supabase-js'
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'
import { signInBoth } from './_auth.mjs'
import { resolveBaseUrl } from './_base-url.mjs'

const BASE = await resolveBaseUrl()
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const ref = URL_.split('//')[1].split('.')[0]
const host = new URL(URL_).host
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SHOTS = process.env.SHOTS === '1'
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }
const note = (m) => console.log(`  \x1b[2m… ${m}\x1b[0m`)
const head = (m) => console.log(`\n${m}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const OWNER = '00000000-0000-0000-0000-0000000000a1'
const PARENT = '00000000-0000-0000-0000-0000000000b1'
const OUTSIDER = '00000000-0000-0000-0000-0000000000c2'
const TAG = 'R20TEST'

async function person(id) {
  const { data } = await admin.auth.admin.getUserById(id)
  return data?.user?.email ? signInBoth(admin, data.user.email) : null
}
const owner = await person(OWNER)
const parent = await person(PARENT)
const outsider = await person(OUTSIDER)
if (!owner || !parent || !outsider) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}
const { error: no0221 } = await admin.from('offers').select('kind').limit(1)
const has0221 = !no0221

const inDays = (n) => new Date(Date.now() + n * 864e5).toLocaleDateString('en-CA')
const sydneyDay = (n) => new Date(Date.now() + n * 864e5).toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' })
if (SHOTS) mkdirSync('.shots', { recursive: true })

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })

/** A page as someone, at 375px; `answers` stands in for named database functions. */
async function open(who, path, answers = null) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 375, height: 812 })
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
  await page.setCookie({ name: `sb-${ref}-auth-token`, value: 'base64-' + Buffer.from(JSON.stringify(who.session)).toString('base64'), domain: 'localhost', path: '/' })
  await page.evaluateOnNewDocument((org) => { try { localStorage.setItem('squadroom.org', org) } catch {} }, NRIFA)
  const calls = []
  if (answers) {
    await page.setRequestInterception(true)
    page.on('request', (r) => {
      const u = new URL(r.url())
      const fn = u.host === host && u.pathname.startsWith('/rest/v1/rpc/') ? u.pathname.slice('/rest/v1/rpc/'.length) : null
      if (fn && fn in answers && r.method() === 'POST') {
        let body = {}
        try { body = JSON.parse(r.postData() ?? '{}') } catch {}
        calls.push({ fn, body })
        const value = typeof answers[fn] === 'function' ? answers[fn](body) : answers[fn]
        r.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(value) }).catch(() => {})
        return
      }
      r.continue().catch(() => {})
    })
  }
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 90000 })
  return { context, page, calls }
}
const text = (page) => page.evaluate(() => document.body.innerText)
const fits = (page) => page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1)
async function clickText(page, label) {
  return page.$$eval('button', (bs, l) => {
    const b = bs.find((x) => x.textContent?.trim() === l)
    b?.click()
    return Boolean(b)
  }, label)
}
async function bothThemes(page, name) {
  let fitted = true
  for (const scheme of ['light', 'dark']) {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }])
    await sleep(200)
    fitted = fitted && (await fits(page))
    if (SHOTS) await page.screenshot({ path: `.shots/returning-${name}-${scheme}.png`, fullPage: true })
  }
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
  return fitted
}

const FAKE = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const until = new Date(Date.now() + 14 * 864e5).toISOString()

try {
  // ---------------------------------------------------------------------------
  head("1. The family's offer of next season's place (0221's answers stood in)")
  {
    let state = 'open'
    let registration_status = null
    const offer = () => [{
      id: FAKE(1), kind: 'returning', player_id: FAKE(2), player: 'Mia Testing', squad_program: 'U9 Navy — 2027 season',
      squad_program_id: FAKE(3), squad: 'U9 Navy', season: '2027', trial: null, fee_cents: 42000, expires_at: until, state,
      decided_at: state === 'open' ? null : new Date().toISOString(), registration_id: null, registration_status,
    }]
    const { context, page, calls } = await open(parent, `/offer/${FAKE(1)}`, {
      my_offers: () => offer(),
      decline_offer: () => { state = 'declined'; return null },
    })
    await page.waitForSelector('[data-offer-kind]', { timeout: 15000 }).catch(() => null)
    let t = await text(page)
    t.includes('2027 season') && t.includes('Mia has a place in U9 Navy for 2027') ? ok('"Mia has a place in U9 Navy for 2027", under "2027 season"') : bad(`heading: ${t.slice(0, 200)}`)
    t.includes('Accept and pay') && t.includes("Mia won't be back") ? ok('"Accept and pay" and "Mia won\'t be back"') : bad('the two answers are not there')
    t.includes('After the date, the club can give it to someone else') ? ok('it says what the date means') : bad('no word about the date')
    ;(await bothThemes(page, 'offer')) ? ok('fits 375px, light and dark') : bad('wider than the phone')

    await clickText(page, "Mia won't be back")
    await page.waitForSelector('[data-decline-confirm]', { timeout: 5000 }).catch(() => null)
    const asked = await page.$('[data-decline-confirm]')
    asked && calls.filter((c) => c.fn === 'decline_offer').length === 0
      ? ok('"won\'t be back" asks first — it takes the child off the squad — and has not told the club')
      : bad(`no second question (${calls.map((c) => c.fn).join(', ')})`)
    ;(await text(page)).includes('Mia comes off U9 Navy, and the place can go to someone else') ? ok('and says what it does') : bad('the question does not say what happens')
    ;(await bothThemes(page, 'offer-sure')) ? ok('the question fits 375px, light and dark') : bad('the question is wider than the phone')
    await clickText(page, 'Keep the place')
    await sleep(200)
    !(await page.$('[data-decline-confirm]')) ? ok('"Keep the place" puts it back') : bad('the question did not go away')

    await clickText(page, "Mia won't be back")
    await page.waitForSelector('[data-decline-confirm]', { timeout: 5000 }).catch(() => null)
    await clickText(page, 'Yes, Mia is leaving')
    await page.waitForFunction(() => document.body.innerText.includes('You told the club'), { timeout: 10000 }).catch(() => null)
    const sent = calls.filter((c) => c.fn === 'decline_offer')
    sent.length === 1 && sent[0].body.p_offer === FAKE(1) ? ok('then "Yes, Mia is leaving" tells the club, once') : bad(`decline sent ${sent.length} times`)
    t = await text(page)
    t.includes("You told the club Mia won't be back, so Mia is off U9 Navy") ? ok('and the page says where that leaves Mia') : bad(`after: ${t.slice(0, 240)}`)

    // Accepted where PlayFootball comes first: held, and said so.
    state = 'accepted'
    registration_status = 'pending'
    await page.reload({ waitUntil: 'networkidle2' })
    await page.waitForSelector('[data-held]', { timeout: 15000 }).catch(() => null)
    ;(await text(page)).includes('The place is held for Mia: the club confirms it') ? ok('a place waiting on PlayFootball says it is held, and what happens next') : bad('no held message')
    ;(await bothThemes(page, 'offer-held')) ? ok('fits 375px, light and dark') : bad('wider than the phone')
    await context.close()
  }

  // ---------------------------------------------------------------------------
  head("2. The club's report, with offers (0221's answers stood in)")
  {
    const lapsedAt = new Date(Date.now() - 2 * 864e5).toISOString()
    const report = [{
      team_id: FAKE(10), team: 'U9 Navy', program_id: FAKE(11), total: 5, registered: 1,
      not_yet: [
        { player_id: FAKE(21), name: 'Ava Testing', guardians: [{ name: 'Pat Testing', phone: null }], registration: null, offer: { id: FAKE(31), state: 'open', expires_at: until } },
        { player_id: FAKE(22), name: 'Ben Testing', guardians: [{ name: 'Lou Testing', phone: null }], registration: null, offer: { id: FAKE(32), state: 'lapsed', expires_at: lapsedAt } },
        { player_id: FAKE(23), name: 'Cal Testing', guardians: [{ name: 'Sol Testing', phone: null }], registration: null, offer: null },
        { player_id: FAKE(24), name: 'Dee Testing', guardians: [], registration: 'pending', offer: null },
      ],
      declined: [{ player_id: FAKE(25), name: 'Eve Testing', decided_at: new Date().toISOString() }],
    }]
    const { context, page, calls } = await open(owner, '/admin/season', {
      rollover_report: report,
      offer_returning_places: (b) => ({ offered: b.p_players ? 1 : 2, unchanged: 1, skipped: 1, no_family: 0, closed: [], expires_at: until }),
    })
    await page.waitForSelector('[data-offer-places]', { timeout: 20000 }).catch(() => null)
    const button = await page.$eval('[data-offer-button]', (b) => b.textContent?.trim()).catch(() => null)
    button === 'Offer 2 places' ? ok('"Offer 2 places": the one never offered and the lapsed one') : bad(`the button says ${button}`)
    const states = await page.$$eval('[data-offer-state]', (els) => els.map((e) => e.textContent?.trim()))
    states.some((s) => s.startsWith('Offered · until')) && states.includes('Offer lapsed · offer again') && states.includes('Registered · yours to approve')
      ? ok('each child says where they are: offered until, lapsed, a form to approve')
      : bad(`states: ${JSON.stringify(states)}`)
    ;(await page.$(`[data-declined="${FAKE(25)}"]`)) && (await text(page)).includes('Said no') ? ok('a family that said no is listed, off the squad, with "Ask again"') : bad('no "said no" row')
    const date = await page.$eval('[data-offer-places] input[type="date"]', (i) => i.value).catch(() => null)
    date === inDays(14) ? ok('accept by defaults to a fortnight') : bad(`the date is ${date}`)
    ;(await bothThemes(page, 'season')) ? ok('fits 375px, light and dark') : bad('wider than the phone')

    await page.$eval('[data-offer-button]', (b) => b.click())
    await page.waitForSelector('[data-offered]', { timeout: 10000 }).catch(() => null)
    const sent = calls.filter((c) => c.fn === 'offer_returning_places')
    sent.length === 1 && sent[0].body.p_until === inDays(14) && !('p_players' in sent[0].body) && sent[0].body.p_academy === NRIFA
      ? ok('"Offer 2 places" sends the season and the date, for everyone')
      : bad(`sent: ${JSON.stringify(sent)}`)
    ;(await text(page)).includes('Offered 2 places, to accept by') ? ok('and says what went') : bad('no result line')

    await clickText(page, 'Ask again')
    await sleep(800)
    const again = calls.filter((c) => c.fn === 'offer_returning_places')[1]
    JSON.stringify(again?.body?.p_players) === JSON.stringify([FAKE(25)]) ? ok('"Ask again" asks for that child by name') : bad(`ask again sent ${JSON.stringify(again?.body)}`)
    await context.close()
  }

  // ---------------------------------------------------------------------------
  head('3. Against the database')
  if (!has0221) {
    note('waiting for 0221 on squadroom-dev (the Supabase token) — who may offer, a place held against a newcomer, accept, decline, ask again, Home\'s row and the nudge run then; test-rls 135–140 prove them locally meanwhile')
  } else {
    await cleanup()
    try {
      await endToEnd()
    } finally {
      await cleanup()
    }
  }
} finally {
  await browser.close()
}
console.log(process.exitCode ? '' : '\n  \x1b[32mlast season\'s players are offered their places\x1b[0m\n')

// -----------------------------------------------------------------------------
async function cleanup() {
  const { data: kids } = await admin.from('players').select('id').eq('academy_id', NRIFA).like('full_name', `% ${TAG}`)
  for (const k of kids ?? []) {
    await admin.from('notification_queue').delete().in('kind', ['offer', 'reregister_nudge']).filter('payload->>player_id', 'eq', k.id)
    await admin.from('offers').delete().eq('player_id', k.id)
    await admin.from('program_registrations').delete().eq('player_id', k.id)
    await admin.from('player_guardians').delete().eq('player_id', k.id)
  }
  await admin.from('players').delete().eq('academy_id', NRIFA).like('full_name', `% ${TAG}`)
  const { data: progs } = await admin.from('programs').select('id').eq('academy_id', NRIFA).like('name', `${TAG} %`)
  const pids = (progs ?? []).map((p) => p.id)
  if (pids.length) {
    await admin.from('payment_requests').delete().in('program_id', pids)
    await admin.from('programs').delete().in('id', pids)
  }
  const { data: teams } = await admin.from('teams').select('id').eq('academy_id', NRIFA).like('name', `${TAG} %`)
  for (const t of teams ?? []) await admin.from('teams').delete().eq('id', t.id)
}

async function endToEnd() {
  // Last season's squad, next season's rolled from it with its program and
  // fee, three children on it (Sam's), and a newcomer of Sam's not on it.
  const { data: old } = await admin.from('teams').insert({ academy_id: NRIFA, name: `${TAG} U8`, age_group: 'U8', season: 'R20-old', status: 'ended' }).select('id').single()
  const { data: team } = await admin.from('teams').insert({ academy_id: NRIFA, name: `${TAG} U9`, age_group: 'U9', season: 'R20-new', status: 'active', capacity: 3, rolled_from: old.id }).select('id').single()
  const { data: prog } = await admin.from('programs').insert({ academy_id: NRIFA, name: `${TAG} U9 — R20-new season`, kind: 'squad', status: 'open', season: 'R20-new', team_id: team.id, capacity: 3, created_by: OWNER }).select('id').single()
  const { data: fee } = await admin.from('payment_requests').insert({ academy_id: NRIFA, title: `${TAG} season fee`, amount_cents: 42000, program_id: prog.id, created_by: OWNER }).select('id').single()
  const { data: kids } = await admin.from('players')
    .insert(['Ava', 'Ben', 'Cal', 'Dan'].map((n, i) => ({ academy_id: NRIFA, full_name: `${n} ${TAG}`, dob: `2018-0${i + 1}-01`, team_id: n === 'Dan' ? null : team.id })))
    .select('id, full_name')
  for (const k of kids) await admin.from('player_guardians').insert({ academy_id: NRIFA, player_id: k.id, profile_id: PARENT, relationship: 'parent' })
  const [ava, ben, cal, dan] = kids
  const offerOf = async (kid) => (await admin.from('offers').select('*').eq('player_id', kid.id).eq('squad_program_id', prog.id).maybeSingle()).data

  {
    const { error: e1 } = await parent.client.rpc('offer_returning_places', { p_academy: NRIFA, p_season: 'R20-new', p_until: sydneyDay(10) })
    const { error: e2 } = await outsider.client.rpc('offer_returning_places', { p_academy: NRIFA, p_season: 'R20-new', p_until: sydneyDay(10) })
    e1?.code === '42501' && e2?.code === '42501' ? ok('a parent and another club cannot offer places') : bad(`${e1?.message} / ${e2?.message}`)
  }
  {
    const { data: r1, error } = await owner.client.rpc('offer_returning_places', { p_academy: NRIFA, p_season: 'R20-new', p_until: sydneyDay(10) })
    r1?.offered === 3 ? ok('the owner offers the three returning children their places') : bad(`offered: ${JSON.stringify(r1)} ${error?.message ?? ''}`)
    const { data: pushes } = await admin.from('notification_queue').select('url, title, payload').eq('kind', 'offer').in('payload->>player_id', [ava.id, ben.id, cal.id])
    pushes?.length === 3 && pushes.every((p) => p.url.startsWith('/offer/') && p.title.endsWith('place for R20-new')) ? ok('Sam is told once per child, and the push opens the offer') : bad(`pushes: ${JSON.stringify(pushes)}`)
    const { data: r2 } = await owner.client.rpc('offer_returning_places', { p_academy: NRIFA, p_season: 'R20-new', p_until: sydneyDay(10) })
    r2?.offered === 0 && r2?.unchanged === 3 ? ok('sent again with the same date, nobody is told twice') : bad(`again: ${JSON.stringify(r2)}`)
  }
  {
    const { data: needs } = await parent.client.rpc('needs_you', { p_academy: NRIFA })
    const row = (needs ?? []).find((i) => i.kind === 'offers')
    row?.urgent && row.count >= 3 && row.title.includes('places to accept') ? ok(`Home's Needs you: "${row.title}" — ${row.detail}`) : bad(`needs_you: ${JSON.stringify(needs)}`)
  }
  {
    const { data: reg, error } = await parent.client.from('program_registrations')
      .insert({ academy_id: NRIFA, program_id: prog.id, player_id: dan.id, submitted_by: PARENT }).select('status').single()
    reg?.status === 'waitlisted' ? ok('three open offers hold three places: a newcomer is waitlisted') : bad(`newcomer: ${reg?.status} ${error?.message ?? ''}`)
  }
  {
    const { data: res, error } = await parent.client.rpc('accept_offer', { p_offer: (await offerOf(ava)).id })
    const { data: reg } = await admin.from('program_registrations').select('status, decided_by').eq('program_id', prog.id).eq('player_id', ava.id).single()
    res?.payment_request_id === fee.id && reg?.status === 'approved' && reg.decided_by === OWNER
      ? ok('Sam accepts Ava\'s place: approved, by the club that offered it, and the fee is next')
      : bad(`accept: ${JSON.stringify(res)} ${error?.message ?? ''} ${JSON.stringify(reg)}`)
  }
  {
    await parent.client.rpc('decline_offer', { p_offer: (await offerOf(ben)).id })
    const { data: b } = await admin.from('players').select('team_id').eq('id', ben.id).single()
    const { data: rep } = await owner.client.rpc('rollover_report', { p_academy: NRIFA, p_season: 'R20-new' })
    const sq = (rep ?? []).find((r) => r.team_id === team.id)
    b?.team_id === null && sq?.declined?.some((d) => d.player_id === ben.id) ? ok('Sam says Ben won\'t be back: Ben is off the squad, and the report says so') : bad(`ben ${JSON.stringify(b)}, report ${JSON.stringify(sq?.declined)}`)
    const { data: again } = await owner.client.rpc('offer_returning_places', { p_academy: NRIFA, p_season: 'R20-new', p_until: sydneyDay(10), p_players: [ben.id] })
    await parent.client.rpc('accept_offer', { p_offer: (await offerOf(ben)).id })
    const { data: b2 } = await admin.from('players').select('team_id').eq('id', ben.id).single()
    again?.offered === 1 && b2?.team_id === team.id ? ok('the club asks again by name; accepting puts Ben back in the squad') : bad(`again ${JSON.stringify(again)}, ben ${JSON.stringify(b2)}`)
  }
  {
    const n = (await owner.client.rpc('nudge_unregistered', { p_academy: NRIFA, p_season: 'R20-new' })).data
    const { data: nudge } = await admin.from('notification_queue').select('url, body').eq('kind', 'reregister_nudge').filter('payload->>player_id', 'eq', cal.id).maybeSingle()
    n >= 1 && nudge?.url === `/offer/${(await offerOf(cal)).id}` && nudge.body.includes('Accept it by') ? ok('the reminder for Cal is the offer, with its date') : bad(`nudge: ${n} ${JSON.stringify(nudge)}`)
  }
  {
    const { context, page } = await open(parent, `/offer/${(await offerOf(cal)).id}`)
    await page.waitForSelector('[data-offer-kind="returning"]', { timeout: 15000 }).catch(() => null)
    ;(await text(page)).includes('Cal has a place in') && (await fits(page)) ? ok("Cal's real offer opens at 375px") : bad('the real offer page did not show')
    await context.close()
  }
}
