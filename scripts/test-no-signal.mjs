// Run: node --env-file=.env.local scripts/test-no-signal.mjs
//   (needs the app running — npm run dev, or serve:test)
//   SHOTS=1 also saves the waiting states at 375px, light and dark, in .shots/
//
// X-09 in a real browser with its signal cut. The first time the outbox was
// driven this way (5 Nov 2026) NOTHING tapped with no signal was kept: it
// asked the auth server who was signed in and refused every write as "Not
// signed in". The pure tests (test-outbox.ts) could never have seen it. This
// suite drives the real screens:
//
//   1. A parent answers with no signal: the answer stays where they put it,
//      is kept on the phone, and is in the database once the signal is back.
//   2. Score taps with no signal: the coach's panel survives the refresh it
//      cannot make; the score moves at once, in the panel and the hero; a slip
//      undone before the signal never reaches the chat; every tap arrives
//      once, in order, at the minute it was tapped.
//   3. Bars that carry nothing: a tap that gets no answer is kept within
//      seconds instead of spinning, and a tap made as the signal returns does
//      not overtake the one still waiting.
//   4. A kept tap the database turns down (the other coach blew full time):
//      the coach is told, and the waiting tap is gone.
import { createClient } from '@supabase/supabase-js'
import puppeteer from 'puppeteer-core'
import { signInBoth } from './_auth.mjs'
import { resolveBaseUrl } from './_base-url.mjs'
import { purgeTestMessages } from './_purge-test-messages.mjs'

const BASE = await resolveBaseUrl()
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const ref = URL_.split('//')[1].split('.')[0]
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SHOTS = process.env.SHOTS === '1'
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }
const head = (m) => console.log(`\n${m}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const U8 = '00000000-0000-0000-0000-0000000d0008'
const MARCUS = '00000000-0000-0000-0000-0000000000a2'
const OWNER = '00000000-0000-0000-0000-0000000000a1'
const SAM = '00000000-0000-0000-0000-0000000000b1'
const SAMS = ['00000000-0000-0000-0000-0000000e0001', '00000000-0000-0000-0000-0000000e0006']
const TAG = 'TEST:: nosignal'

const coach = await signInBoth(admin, 'p61400000002@squadroom.invalid')
const parent = await signInBoth(admin, 'p61400000011@squadroom.invalid')
if (!coach || !parent) { console.log("  could not sign in — the project's auth rate limit, not a failure"); process.exit(2) }
const { data: cl } = await admin.from('staff_clearances').select('id').eq('academy_id', NRIFA).eq('profile_id', MARCUS).maybeSingle()
const addedClearance = !cl
if (addedClearance) await admin.from('staff_clearances').insert({ academy_id: NRIFA, profile_id: MARCUS, kind: 'wwcc', number: 'WWC0000001E', outcome: 'cleared', expires_on: new Date(Date.now() + 400 * 864e5).toISOString().slice(0, 10), verified_by: OWNER })

const tidy = async () => {
  const { data: evs } = await admin.from('events').select('id').like('title', `${TAG}%`)
  for (const e of evs ?? []) {
    const { data: ms } = await admin.from('messages').select('id').eq('event_id', e.id)
    if (ms?.length) await admin.from('deleted_message_archive').delete().in('message_id', ms.map((m) => m.id))
    await admin.from('messages').delete().eq('event_id', e.id)
  }
  await admin.from('events').delete().like('title', `${TAG}%`)
}
await tidy()

// A training in two days for the parent to answer; a game that began twenty minutes ago.
const day = (n) => new Date(Date.now() + n * 864e5)
const { data: training, error: te } = await admin.from('events').insert({ academy_id: NRIFA, team_id: U8, type: 'training', title: `${TAG} training`, starts_at: day(2).toISOString(), ends_at: new Date(day(2).getTime() + 3600e3).toISOString(), created_by: OWNER }).select('id').single()
const started = new Date(Date.now() - 20 * 60e3)
const { data: match, error: me } = await admin.from('events').insert({ academy_id: NRIFA, team_id: U8, type: 'match', title: `${TAG} v Hornsby`, opponent: 'Hornsby Heat', starts_at: started.toISOString(), ends_at: new Date(started.getTime() + 3600e3).toISOString(), created_by: OWNER }).select('id').single()
if (te || me) { console.log(`  could not set up: ${(te ?? me).message}`); await tidy(); process.exit(1) }
const ticker = async () => (await admin.from('event_ticker').select('kind, minute, undone_at, created_at').eq('event_id', match.id).order('created_at')).data ?? []
const chatLines = async () => (await admin.from('messages').select('id, body').eq('event_id', match.id).is('deleted_at', null)).data ?? []

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })

async function open(person, path) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 375, height: 812 })
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
  await page.setCookie({ name: `sb-${ref}-auth-token`, value: 'base64-' + Buffer.from(JSON.stringify(person.session)).toString('base64'), domain: 'localhost', path: '/' })
  await page.evaluateOnNewDocument((org) => { try { localStorage.setItem('squadroom.org', org) } catch {} }, NRIFA)
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 90000 })
  return { context, page }
}
// What the phone is keeping, read the way the app stores it. Only after the
// app has opened its database: opening it first would create it without stores.
const keptWrites = (page) => page.evaluate(() => new Promise((resolve) => {
  const req = indexedDB.open('squadroom')
  req.onsuccess = () => {
    const db = req.result
    if (!db.objectStoreNames.contains('outbox')) return resolve([])
    const all = db.transaction('outbox', 'readonly').objectStore('outbox').getAll()
    all.onsuccess = () => resolve(all.result.sort((a, b) => a.queuedAt - b.queuedAt).map((i) => i.write))
    all.onerror = () => resolve([])
  }
  req.onerror = () => resolve([])
}))
const statusText = (page) => page.evaluate(() => [...document.querySelectorAll('[role="status"], [role="alert"]')].map((e) => e.innerText).join(' | '))
const shot = async (page, name) => {
  if (!SHOTS) return
  for (const scheme of ['light', 'dark']) {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }])
    await sleep(150)
    await page.screenshot({ path: `.shots/no-signal-${name}-${scheme}.png`, fullPage: false })
  }
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
}

try {
  // ------------------------------------------------------------------------
  head('1. A parent answers with no signal')
  {
    const { context, page } = await open(parent, `/calendar/${training.id}`)
    await page.waitForSelector('[data-your-answer] [data-choice="yes"]', { timeout: 30000 })
    await page.setOfflineMode(true)
    const kid = await page.$eval('[data-your-answer] [data-choice="yes"]', (e) => { e.scrollIntoView({ block: 'center' }); e.click(); return e.getAttribute('data-player') })
    await page.waitForFunction(() => [...document.querySelectorAll('[role="status"]')].some((e) => /saved on this phone/.test(e.textContent ?? '')), { timeout: 10000 }).catch(() => null)
    const pressed = await page.$eval(`[data-your-answer] [data-choice="yes"][data-player="${kid}"]`, (e) => e.getAttribute('aria-pressed'))
    pressed === 'true' ? ok('"Going" with no signal: the button stays where the parent put it') : bad(`aria-pressed after the tap: ${pressed}`)
    const text = await page.evaluate(() => document.body.innerText)
    ;/Not signed in/.test(text) ? bad('the page says "Not signed in" — the 5 Nov failure') : ok('no "Not signed in" (the failure found on 5 Nov)')
    const bar = await statusText(page)
    ;/1 change saved on this phone/.test(bar) ? ok(`the bar at the top says so: “${bar.split(' | ')[0]}”`) : bad(`the bar says: ${bar}`)
    const kept = await keptWrites(page)
    const w = kept.find((k) => k.kind === 'upsert' && k.table === 'event_rsvps')
    w?.rows?.[0]?.profile_id === SAM && w.rows[0].player_id === kid && w.rows[0].status === 'yes'
      ? ok("kept on the phone as Sam's answer for their child")
      : bad(`kept: ${JSON.stringify(kept).slice(0, 240)}`)
    const { data: before } = await admin.from('event_rsvps').select('status').eq('event_id', training.id).eq('profile_id', SAM)
    before?.length === 0 ? ok('and nothing has reached the database') : bad(`already in the database: ${JSON.stringify(before)}`)
    await shot(page, 'rsvp')

    await page.setOfflineMode(false)
    let row = null
    for (let i = 0; i < 25 && !row; i++) {
      await sleep(800)
      row = (await admin.from('event_rsvps').select('player_id, status').eq('event_id', training.id).eq('profile_id', SAM)).data?.[0] ?? null
    }
    row?.status === 'yes' && row.player_id === kid && SAMS.includes(kid) ? ok('signal back: the answer is in the database') : bad(`after the signal: ${JSON.stringify(row)}`)
    await page.waitForFunction(() => ![...document.querySelectorAll('[role="status"]')].some((e) => /saved on this phone/.test(e.textContent ?? '')), { timeout: 15000 }).catch(() => null)
    ;/saved on this phone/.test(await statusText(page)) ? bad('the bar still says something is waiting') : ok('and the bar has gone')
    await context.close()
  }

  // ------------------------------------------------------------------------
  head('2. Score taps with no signal')
  const { error: ko } = await coach.client.rpc('live_tick', { p_event: match.id, p_kind: 'kick_off' })
  ko ? bad(`kick-off: ${ko.message}`) : ok('kicked off (with signal, from another phone)')
  // The whistle went twenty minutes ago.
  await admin.from('event_ticker').update({ created_at: new Date(Date.now() - 20 * 60e3).toISOString() }).eq('event_id', match.id).eq('kind', 'kick_off')
  const linesBefore = (await chatLines()).length
  const { context, page } = await open(coach, `/calendar/${match.id}#sheet`)
  await page.waitForSelector('[data-live] [data-tap="goal_against"]', { timeout: 30000 })
  const panel = () => page.$eval('[data-live-score]', (e) => e.innerText.replace(/\s+/g, ' ').trim()).catch(() => '(gone)')
  const hero = () => page.$eval('[data-hero-score]', (e) => e.innerText.trim()).catch(() => '(none)')
  const click = (sel) => page.$eval(sel, (e) => { e.scrollIntoView({ block: 'center' }); e.click() })
  const waitingRows = () => page.$$eval('[data-ticker] li[data-waiting]', (ls) => ls.length)
  const untilWaiting = (n) => page.waitForFunction((n) => document.querySelectorAll('[data-ticker] li[data-waiting]').length === n, { timeout: 15000 }, n).catch(() => null)
  // The hero and the bar read the same queue as the panel, each on its own
  // turn — wait for each rather than reading it the moment the panel moves.
  const untilHero = (re) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('[data-hero-score]')?.textContent?.trim() ?? ''), { timeout: 8000 }, re.source).catch(() => null)
  const untilBar = (re) => page.waitForFunction((src) => [...document.querySelectorAll('[role="status"]')].some((e) => new RegExp(src).test(e.textContent ?? '')), { timeout: 8000 }, re.source).catch(() => null)

  await page.setOfflineMode(true)
  // Until 5 Nov one failed fifteen-second refresh blanked the panel and its buttons.
  await sleep(16500)
  ;(await page.$('[data-live] [data-tap="goal_against"]')) ? ok('the panel and its buttons outlast a refresh that cannot happen') : bad(`the panel after a failed refresh: ${await panel()}`)

  await click('[data-tap="goal_against"]')
  await untilWaiting(1)
  let s = await panel()
  s.startsWith('0 – 1') ? ok('"+1 Them" with no signal: 0 – 1 at once') : bad(`the score after an offline tap: ${s}`)
  await untilHero(/^(0–1|1–0)$/)
  const h1 = await hero()
  h1 === '0–1' || h1 === '1–0' ? ok(`and the hero at the top agrees (${h1})`) : bad(`the hero says ${h1}`)
  const note = await page.$eval('[data-live-waiting]', (e) => e.innerText).catch(() => '')
  ;/kept on this phone/.test(note) ? ok(`the panel says so: “${note.slice(0, 64)}…”`) : bad('no "kept on this phone" note in the panel')
  ;(await ticker()).some((t) => t.kind === 'goal_against') ? bad('the tap reached the database with no signal') : ok('nothing has reached the database')
  let kept = (await keptWrites(page)).filter((w) => w.fn === 'live_tick')
  const theirs = kept[0]?.args
  typeof theirs?.p_minute === 'number' && theirs.p_minute >= 19 && theirs.p_minute <= 23
    ? ok(`the kept tap carries the minute it was tapped: ${theirs.p_minute}'`)
    : bad(`kept: ${JSON.stringify(kept).slice(0, 200)}`)

  await click('[data-tap="goal_for"]')
  await page.waitForSelector('[data-scorer]', { timeout: 10000 })
  await click('[data-scorer]')
  await click('[data-confirm-goal]')
  await untilWaiting(2)
  s = await panel()
  s.startsWith('1 – 1') ? ok('a goal for us with no signal, scorer picked: 1 – 1') : bad(`after our goal: ${s}`)

  await click('[data-tap="goal_against"]')
  await untilWaiting(3)
  s = await panel()
  s.startsWith('1 – 2') ? ok('a slip: 1 – 2') : bad(`after the slip: ${s}`)
  await shot(page, 'live')
  await click('[data-undo]')
  await untilWaiting(2)
  s = await panel()
  kept = (await keptWrites(page)).filter((w) => w.fn === 'live_tick')
  s.startsWith('1 – 1') && kept.length === 2 ? ok('undone before the signal: back to 1 – 1, and taken off the phone') : bad(`after the undo: ${s}, ${kept.length} kept`)
  await untilHero(/^1–1$/)
  ;(await hero()) === '1–1' ? ok('the hero agrees: 1–1') : bad(`the hero says ${await hero()}`)
  await untilBar(/2 changes saved on this phone/)
  const bar = await statusText(page)
  ;/2 changes saved on this phone/.test(bar) ? ok('the bar at the top counts two waiting') : bad(`the bar says: ${bar}`)

  // Ten more minutes pass before the signal comes back: a minute worked out
  // on arrival would now say 30', not the 20' it was tapped at.
  const { data: ko0 } = await admin.from('event_ticker').select('created_at').eq('event_id', match.id).eq('kind', 'kick_off').single()
  await admin.from('event_ticker').update({ created_at: new Date(new Date(ko0.created_at).getTime() - 10 * 60e3).toISOString() }).eq('event_id', match.id).eq('kind', 'kick_off')

  await page.setOfflineMode(false)
  let rows = []
  for (let i = 0; i < 30; i++) {
    rows = (await ticker()).filter((t) => t.kind !== 'kick_off')
    if (rows.length >= 2) break
    await sleep(800)
  }
  await sleep(1500)
  rows = (await ticker()).filter((t) => t.kind !== 'kick_off')
  JSON.stringify(rows.map((t) => t.kind)) === JSON.stringify(['goal_against', 'goal_for'])
    ? ok('signal back: both taps in the database, once each, in the order tapped')
    : bad(`in the database: ${JSON.stringify(rows.map((t) => t.kind))}`)
  rows.some((t) => t.undone_at) ? bad('an undone row: the slip reached the database') : ok('and the slip never reached it at all')
  rows[0]?.minute === kept[0]?.args?.p_minute && rows[1]?.minute === kept[1]?.args?.p_minute
    ? ok(`at the minutes they were tapped (${rows.map((t) => `${t.minute}'`).join(', ')}), not when they arrived`)
    : bad(`minutes in the database ${rows.map((t) => t.minute)}, tapped at ${kept.map((k) => k.args.p_minute)}`)
  const added = (await chatLines()).length - linesBefore
  added === 2 ? ok("the squad's chat got two lines — nothing for the slip") : bad(`the chat got ${added} lines`)
  await page.waitForFunction(() => !document.querySelector('[data-live-waiting]'), { timeout: 20000 }).catch(() => null)
  s = await panel()
  s.startsWith('1 – 1') && (await waitingRows()) === 0 ? ok('the page reads the game back: 1 – 1, nothing waiting') : bad(`after the signal: ${s}, ${await waitingRows()} waiting`)

  // ------------------------------------------------------------------------
  head('3. Bars that carry nothing')
  {
    // The phone says it is online; nothing to the database gets an answer.
    const host = new URL(URL_).host
    const hung = []
    let mode = 'hang'
    await page.setRequestInterception(true)
    page.on('request', (r) => {
      if (mode === 'hang' && new URL(r.url()).host === host) { hung.push(r); return }
      r.continue().catch(() => {})
    })
    const t0 = Date.now()
    await click('[data-tap="goal_for"]')
    await page.waitForSelector('[data-confirm-goal]', { timeout: 10000 })
    await click('[data-confirm-goal]')
    await untilWaiting(1)
    const took = (Date.now() - t0) / 1000
    ;(await waitingRows()) === 1 && took < 10 ? ok(`a tap that gets no answer is kept after ${took.toFixed(1)} s, not left spinning`) : bad(`after ${took.toFixed(1)} s: ${await waitingRows()} waiting`)
    ;(await panel()).startsWith('2 – 1') ? ok('and the score moved: 2 – 1') : bad(`score: ${await panel()}`)

    // The signal returns — no "online" event, the phone never knew it was gone —
    // and the next tap comes at once. It must not overtake the one waiting.
    mode = 'pass'
    for (const r of hung.splice(0)) r.abort('timedout').catch(() => {})
    await click('[data-tap="goal_against"]')
    let last2 = []
    for (let i = 0; i < 30; i++) {
      last2 = (await ticker()).filter((t) => t.kind !== 'kick_off').slice(2)
      if (last2.length >= 2) break
      await sleep(800)
    }
    JSON.stringify(last2.map((t) => t.kind)) === JSON.stringify(['goal_for', 'goal_against'])
      ? ok('the tap made as the signal came back went behind the one waiting, not ahead of it')
      : bad(`order in the database: ${JSON.stringify(last2.map((t) => t.kind))}`)
    await page.waitForFunction(() => document.querySelectorAll('[data-ticker] li[data-waiting]').length === 0, { timeout: 20000 }).catch(() => null)
    s = await panel()
    s.startsWith('2 – 2') ? ok('2 – 2, nothing waiting') : bad(`after: ${s}`)
    await page.setRequestInterception(false)
  }

  // ------------------------------------------------------------------------
  head('4. A kept tap the database turns down')
  {
    await page.setOfflineMode(true)
    await click('[data-tap="goal_against"]')
    await untilWaiting(1)
    // Meanwhile the assistant, with signal, blows full time.
    const { error: ft } = await coach.client.rpc('live_tick', { p_event: match.id, p_kind: 'full_time' })
    ft ? bad(`full time from the other phone: ${ft.message}`) : ok('full time blown from the other phone while this one waits')
    await page.setOfflineMode(false)
    await page.waitForSelector('[data-not-done]', { timeout: 20000 }).catch(() => null)
    const told = await page.$eval('[data-not-done]', (e) => e.innerText).catch(() => '')
    ;/not saved/.test(told) && /game is over/.test(told) ? ok(`the coach is told: “${told.replace(/\s+/g, ' ').slice(0, 90)}…”`) : bad(`told: ${told || '(nothing)'}`)
    await shot(page, 'not-done')
    const dbAgainst = (await ticker()).filter((t) => t.kind === 'goal_against').length
    dbAgainst === 2 ? ok('the refused goal is not in the database') : bad(`goals against in the database: ${dbAgainst}`)
    await page.waitForFunction(() => document.querySelectorAll('[data-ticker] li[data-waiting]').length === 0, { timeout: 20000 }).catch(() => null)
    ;(await waitingRows()) === 0 ? ok('and it is no longer shown as waiting') : bad('still shown as waiting')
    await click('[data-not-done] button')
    ;(await page.$('[data-not-done]')) ? bad('"OK" did not put the message away') : ok('"OK" puts the message away')
  }
  await context.close()
} finally {
  await browser.close()
  await tidy()
  await purgeTestMessages(admin, [TAG])
  if (addedClearance) await admin.from('staff_clearances').delete().eq('academy_id', NRIFA).eq('profile_id', MARCUS).eq('number', 'WWC0000001E')
}
console.log(process.exitCode ? '' : '\n  \x1b[32mwhat is tapped with no signal is kept, sent once, in order, and told when refused\x1b[0m\n')
