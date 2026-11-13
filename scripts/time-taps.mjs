// Run: node --env-file=.env.local scripts/time-taps.mjs
//   TIME_BASE=http://localhost:3100   (default; a production build — npm run serve:test)
//   RUNS=3                            (taps per action; the median is reported)
//   THROTTLE=fast4g                   (Chrome's Fast 4G profile and a 4× slower CPU)
//   JSON=path                         (also write the numbers there)
//
// Tap-to-response (the "Feels instant" brief, item 6: "tap feedback under
// 100 ms"). Three taps people make most, timed INSIDE the page from the
// click to the screen changing:
//
//   RSVP     Home, a parent: tapping Going/Maybe/Out until the button reads
//            pressed. Also how long until the database confirms it.
//   send     a chat, a coach: tapping Send until the bubble is on screen —
//            and whether it then vanishes for a moment (it used to, until
//            the broadcast brought it back).
//   score    a game on match day, a coach: tapping +1 Them until the score
//            moves. Also until the hero above agrees.
//
// Not a pass/fail suite (not test-*): numbers for docs/SCALE.md. Everything
// it makes is removed: the answer put back, the message deleted, the game
// and its ticks gone.
import { createClient } from '@supabase/supabase-js'
import puppeteer, { PredefinedNetworkConditions } from 'puppeteer-core'
import { writeFileSync } from 'node:fs'
import { signInBoth } from './_auth.mjs'

const BASE = process.env.TIME_BASE ?? 'http://localhost:3100'
const RUNS = Math.max(1, Number(process.env.RUNS ?? 3))
const THROTTLE = process.env.THROTTLE === 'fast4g'
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const ref = URL_.split('//')[1].split('.')[0]
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const U8 = '00000000-0000-0000-0000-0000000d0008'
const LEO = '00000000-0000-0000-0000-0000000e0001'
const OWNER = '00000000-0000-0000-0000-0000000000a1'
const TAG = 'TIMETAP'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)]

const probe = await fetch(`${BASE}/signin`).catch(() => null)
if (!probe?.ok) {
  console.log(`  nothing answers at ${BASE} — start a production build first: npm run serve:test`)
  process.exit(2)
}
const parent = await signInBoth(admin, 'p61400000011@squadroom.invalid') // Sam, Leo's parent
const coach = await signInBoth(admin, 'p61400000002@squadroom.invalid') // Marcus, U8's coach
if (!parent || !coach) {
  console.log("  could not sign in — the project's auth rate limit")
  process.exit(2)
}
const { data: u8chat } = await admin.from('channels').select('id').eq('team_id', U8).eq('type', 'team').single()
const STARTED = new Date().toISOString()
// The score taps are the squad's coach's: Marcus coaches U8 in the demo, but
// not always on the team's own roster row (test-live does the same).
const { data: marcusOnU8 } = await admin.from('team_members').select('profile_id').eq('team_id', U8).eq('profile_id', coach.session.user.id).maybeSingle()
if (!marcusOnU8) await admin.from('team_members').insert({ academy_id: NRIFA, team_id: U8, profile_id: coach.session.user.id, role: 'coach' })

// A game needing Leo's answer: the next U8 match. His answer is put back after.
const { data: nextGame } = await admin.from('events').select('id').eq('team_id', U8).eq('type', 'match').is('cancelled_at', null)
  .gte('starts_at', new Date().toISOString()).order('starts_at').limit(1).maybeSingle()
const { data: leoBefore } = nextGame
  ? await admin.from('event_rsvps').select('status, note').eq('event_id', nextGame.id).eq('player_id', LEO).maybeSingle()
  : { data: null }

async function cleanup() {
  // The answer, as it was.
  if (nextGame) {
    if (leoBefore) await admin.from('event_rsvps').update({ status: leoBefore.status, note: leoBefore.note }).eq('event_id', nextGame.id).eq('player_id', LEO)
    else await admin.from('event_rsvps').delete().eq('event_id', nextGame.id).eq('player_id', LEO)
  }
  // The messages this run sent, and what the score taps posted to the chat.
  await admin.from('messages').delete().eq('channel_id', u8chat.id).like('body', `${TAG}%`)
  await admin.from('messages').delete().eq('channel_id', u8chat.id).gte('created_at', STARTED).is('sender_id', null)
  // A builder answers with an error, never throws; the archive may not hold the text at all.
  await admin.from('deleted_message_archive').delete().like('body', `${TAG}%`)
  // The match-day game and everything hanging off it.
  await admin.from('events').delete().eq('academy_id', NRIFA).like('title', `${TAG}%`)
}
const restoreCoach = async () => {
  if (!marcusOnU8) await admin.from('team_members').delete().eq('team_id', U8).eq('profile_id', coach.session.user.id)
}
await cleanup()

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
async function open(person, path) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 375, height: 812 })
  if (THROTTLE) {
    await page.emulateNetworkConditions(PredefinedNetworkConditions['Fast 4G'])
    await page.emulateCPUThrottling(4)
  }
  await page.setCookie({ name: `sb-${ref}-auth-token`, value: 'base64-' + Buffer.from(JSON.stringify(person.session)).toString('base64'), domain: 'localhost', path: '/' })
  await page.evaluateOnNewDocument((o) => { try { localStorage.setItem('squadroom.org', o) } catch {} }, NRIFA)
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 90000 })
  return { context, page }
}

/** Click `selector` and time, in the page, until `until(el, root)` is true. -1 when it never is. */
const timeTap = (page, selector, untilSource, limit = 10000) =>
  page.evaluate(
    ([sel, src, lim]) => new Promise((resolve) => {
      const until = new Function('el', 'root', `return (${src})(el, root)`)
      const el = document.querySelector(sel)
      if (!el) return resolve(-2)
      const root = document.body
      const t0 = performance.now()
      let done = false
      const check = () => {
        if (done) return
        if (until(el, root)) { done = true; obs.disconnect(); resolve(Math.round(performance.now() - t0)) }
      }
      const obs = new MutationObserver(check)
      obs.observe(root, { subtree: true, childList: true, attributes: true, characterData: true })
      el.click()
      check()
      setTimeout(() => { if (!done) { obs.disconnect(); resolve(-1) } }, lim)
    }),
    [selector, untilSource, limit]
  )

const results = {}
try {
  // ---------------------------------------------------------------- RSVP
  if (nextGame) {
    const taps = []
    const confirms = []
    for (let i = 0; i < RUNS; i++) {
      const { context, page } = await open(parent, '/')
      await page.waitForSelector('.rsvp button[data-v]', { timeout: 30000 }).catch(() => null)
      // Leo's row on the next game: the first card's first row. Tap whichever
      // answer is not the current one.
      const target = await page.evaluate(() => {
        const row = document.querySelector('.kidrow .rsvp')
        if (!row) return null
        const pressed = row.querySelector('button[aria-pressed="true"]')?.getAttribute('data-v')
        return pressed === 'maybe' ? 'yes' : 'maybe'
      })
      if (!target) { taps.push(-2); await context.close(); continue }
      const sel = `.kidrow .rsvp button[data-v="${target}"]`
      const ms = await timeTap(page, sel, `(el) => el.getAttribute('aria-pressed') === 'true'`)
      taps.push(ms)
      // Until the database has it: the row's own answer, read back.
      const t1 = Date.now()
      let saved = -1
      for (let n = 0; n < 150; n++) {
        const { data } = await admin.from('event_rsvps').select('status').eq('event_id', nextGame.id).eq('player_id', LEO)
        if ((data ?? []).some((r) => r.status === target)) { saved = Date.now() - t1; break }
        await sleep(100)
      }
      confirms.push(saved)
      await context.close()
    }
    results.rsvp = { tap: median(taps), saved: median(confirms), taps }
  } else {
    results.rsvp = { tap: null, saved: null, note: 'no upcoming U8 match to answer' }
  }

  // ---------------------------------------------------------------- send
  {
    const taps = []
    const flickers = []
    for (let i = 0; i < RUNS; i++) {
      const { context, page } = await open(coach, `/chat/${u8chat.id}`)
      await page.waitForSelector('textarea', { timeout: 30000 })
      const text = `${TAG} ${Date.now()}`
      await page.type('textarea', text)
      const ms = await timeTap(page, 'button[aria-label="Send"]', `(el, root) => [...root.querySelectorAll('div, p, span')].some((n) => n.childElementCount === 0 && n.textContent === ${JSON.stringify(text)})`)
      taps.push(ms)
      // Does the bubble stay? Watch for three seconds.
      const gone = await page.evaluate((t) => new Promise((resolve) => {
        const has = () => [...document.querySelectorAll('div, p, span')].some((n) => n.childElementCount === 0 && n.textContent === t)
        let vanished = false
        const obs = new MutationObserver(() => { if (!has()) vanished = true })
        obs.observe(document.body, { subtree: true, childList: true })
        setTimeout(() => { obs.disconnect(); resolve(vanished || !has()) }, 3000)
      }), text)
      flickers.push(gone)
      await context.close()
    }
    results.send = { tap: median(taps), vanished: flickers.filter(Boolean).length, taps }
  }

  // ---------------------------------------------------------------- score
  {
    const taps = []
    const heroes = []
    for (let i = 0; i < RUNS; i++) {
      // A match on now, so the taps are offered; the coach kicks off, then +1 Them.
      const { data: game } = await admin.from('events').insert({
        academy_id: NRIFA, team_id: U8, type: 'match', title: `${TAG} v Timers`, opponent: 'Timers',
        starts_at: new Date(Date.now() - 5 * 60e3).toISOString(), ends_at: new Date(Date.now() + 55 * 60e3).toISOString(), created_by: OWNER,
      }).select('id').single()
      // The score panel lives on the Match sheet tab (#sheet); before kick-off the page opens on the preview.
      const { context, page } = await open(coach, `/calendar/${game.id}#sheet`)
      const kick = await page.waitForSelector('[data-tap="kick_off"]', { timeout: 30000 }).catch(() => null)
      if (!kick) {
        const why = await page.evaluate(() => (document.querySelector('[data-live]') ? 'the live panel is there but offers no kick-off' : document.body.innerText.slice(0, 120)))
        console.log(`  no kick-off button: ${why}`)
        taps.push(-2)
        await context.close()
        await admin.from('events').delete().eq('id', game.id)
        continue
      }
      await kick.click()
      // The buttons come back enabled once the kick-off has been read back.
      const goal = await page.waitForSelector('[data-tap="goal_against"]:not([disabled])', { timeout: 20000 }).catch(() => null)
      if (!goal) {
        const panel = await page.evaluate(() => document.querySelector('[data-live]')?.innerText.replace(/\s+/g, ' ').slice(0, 160) ?? 'no live panel')
        console.log(`  no +1 Them after kick-off: ${panel}`)
        taps.push(-2)
        await context.close()
        await admin.from('events').delete().eq('id', game.id)
        continue
      }
      await sleep(400)
      const before = await page.$eval('[data-live-score]', (e) => e.textContent.trim())
      const ms = await timeTap(page, '[data-tap="goal_against"]:not([disabled])', `(el, root) => root.querySelector('[data-live-score]')?.textContent.trim() !== ${JSON.stringify(before)}`)
      taps.push(ms)
      // The hero: the same score at the top of the page.
      const t1 = Date.now()
      let hero = -1
      for (let n = 0; n < 200; n++) {
        const agree = await page.evaluate(() => {
          const panel = document.querySelector('[data-live-score]')?.textContent.replace(/\s+/g, ' ').trim() ?? ''
          const top = document.querySelector('[data-game-hero]')?.textContent.replace(/\s+/g, ' ') ?? ''
          const m = panel.match(/(\d+)\s*[–-]\s*(\d+)/)
          return m ? top.includes(`${m[1]}`) && top.includes(`${m[2]}`) && /[–-]/.test(top) : false
        })
        if (agree) { hero = Date.now() - t1; break }
        await sleep(100)
      }
      heroes.push(hero)
      await context.close()
      await admin.from('messages').delete().eq('channel_id', u8chat.id).gte('created_at', STARTED).is('sender_id', null)
      await admin.from('events').delete().eq('id', game.id)
    }
    results.score = { tap: median(taps), hero: median(heroes), taps }
  }
} finally {
  await browser.close()
  await cleanup()
  await restoreCoach()
}

const pad = (v, n) => String(v).padEnd(n)
console.log(`\n  ${BASE} · median of ${RUNS}${THROTTLE ? ' · Fast 4G, CPU 4× slower' : ''} · target: feedback under 100 ms\n`)
console.log(`  ${pad('tap', 8)}${pad('feedback ms', 13)}then`)
console.log(`  ${pad('RSVP', 8)}${pad(results.rsvp.tap ?? '—', 13)}${results.rsvp.saved != null ? `saved in the database after ${results.rsvp.saved} ms` : results.rsvp.note}`)
console.log(`  ${pad('send', 8)}${pad(results.send.tap, 13)}${results.send.vanished ? `the bubble vanished for a moment in ${results.send.vanished} of ${RUNS}` : 'the bubble stayed'}`)
console.log(`  ${pad('score', 8)}${pad(results.score.tap, 13)}${results.score.hero >= 0 ? `the hero agreed after ${results.score.hero} ms` : 'the hero never agreed within 20 s'}`)
if (process.env.JSON) writeFileSync(process.env.JSON, JSON.stringify({ base: BASE, runs: RUNS, throttle: THROTTLE, at: new Date().toISOString(), results }, null, 2))
console.log('')
