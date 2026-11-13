// Run: node --env-file=.env.local scripts/test-game-page.mjs
//   (needs the app running — npm run dev, or serve:test)
//
// The game page (Joey, 4 Nov 2026; benchmark: a match preview).
//
//   1. TIMES ARE THE VENUE'S. A 2:20 pm kick-off never displays as AM: not
//      on a server running on UTC (where the first frame is drawn), not on a
//      phone set to Los Angeles or Kolkata, not anywhere on the page.
//   2. The hero: both sides, crests or initials, the countdown ("in 3
//      days"), on the day the kick-off time, then the live score, then the
//      final score — on the club's colour.
//   3. The tabs: Preview | Match sheet | Ladder, the Ladder only for a game
//      in a competition; Preview before kick-off, the sheet after.
//   4. Preview: availability first, then the match details, both sides'
//      last five, their two rows of the ladder — and the full ladder a tap
//      away.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import puppeteer from 'puppeteer-core'
import { signInBoth } from './_auth.mjs'
import { resolveBaseUrl } from './_base-url.mjs'

const BASE = await resolveBaseUrl()
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const ref = URL_.split('//')[1].split('.')[0]
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ROOT = new URL('..', import.meta.url).pathname
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }
const head = (m) => console.log(`\n${m}`)
const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const U8 = '00000000-0000-0000-0000-0000000d0008'
const MARCUS = '00000000-0000-0000-0000-0000000000a2'
const OWNER = '00000000-0000-0000-0000-0000000000a1'
const TAG = 'GAMETEST::'

/** The instant that is HH:MM in Sydney on the Sydney date `days` from today. */
function sydneyAt(days, hh, mm) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + days * 864e5))
  const [y, m, d] = day.split('-').map(Number)
  for (const offset of [11, 10]) {
    const t = new Date(Date.UTC(y, m - 1, d, hh - offset, mm))
    const shown = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(t)
    if (shown === `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`) return t
  }
  throw new Error('no such Sydney time')
}

head('1. A 2:20 pm kick-off, on machines set to three other timezones')
{
  const iso = sydneyAt(3, 14, 20).toISOString()
  for (const tz of ['UTC', 'America/Los_Angeles', 'Asia/Kolkata', 'Pacific/Kiritimati']) {
    const out = execFileSync(process.execPath, ['-e', `import('${ROOT}lib/time.ts').then((t) => console.log(JSON.stringify({ k: t.kickOff('${iso}', 'Australia/Sydney'), d: t.gameDay('${iso}', 'Australia/Sydney') })))`], { env: { ...process.env, TZ: tz, NODE_NO_WARNINGS: '1' } }).toString().trim()
    const { k, d } = JSON.parse(out)
    k === '2:20 pm' ? ok(`a server on ${tz} writes ${k} (${d})`) : bad(`a server on ${tz} writes ${k} for a 2:20 pm kick-off`)
  }
  // Nothing on the game page formats a time without naming the timezone.
  const files = ['app/calendar/[eventId]/event-detail.tsx', 'app/calendar/[eventId]/game-hero.tsx', 'app/calendar/[eventId]/game-panels.tsx', 'app/calendar/[eventId]/use-game.ts']
  const raw = files.filter((f) => /toLocale(Time|Date)?String\(/.test(readFileSync(ROOT + f, 'utf8')))
  raw.length === 0 ? ok('the game page formats every time through lib/time.ts (the venue\'s timezone)') : bad(`a time formatted with the phone's clock in: ${raw.join(', ')}`)
  // Everywhere else a game's time is shown, every format names a timezone.
  const GAME_TIMES = [
    'app/calendar/calendar-list.tsx', 'app/training-block.tsx', 'app/home.tsx', 'app/home-calendar.tsx', 'app/home-jobs.tsx',
    'app/chat/[channelId]/event-card.tsx', 'app/calendar/matchdays.tsx', 'app/calendar/draw-filters.tsx', 'app/calendar/call-off-day.tsx',
    'app/calendar/[eventId]/stats.tsx', 'app/competitions/[competitionId]/match/[fixtureId]/match-sheet.tsx',
    'app/competitions/[competitionId]/competition-view.tsx', 'app/c/[slug]/match-centre.tsx', 'app/referee/checkin/checkin-screen.tsx',
    'app/scan/scan-client.tsx', 'app/competitions/[competitionId]/change-requests.tsx', 'app/competitions/[competitionId]/nominations.tsx',
    'app/card/[playerId]/season-stats.tsx', 'app/my/[token]/my-games.tsx',
  ]
  const loose = []
  for (const f of GAME_TIMES) {
    const ls = readFileSync(ROOT + f, 'utf8').split('\n')
    ls.forEach((l, i) => {
      if (!/toLocale(Time|Date)?String\(/.test(l)) return
      const window = ls.slice(i, i + 8).join('\n')
      const seg = window.includes('})') ? window.slice(0, window.indexOf('})')) : window
      if (!seg.includes('timeZone')) loose.push(`${f}:${i + 1}`)
    })
  }
  loose.length === 0 ? ok(`${GAME_TIMES.length} other screens that show a game's time name the timezone every time`) : bad(`a game time on the phone's clock: ${loose.join(', ')}`)
}

const [parent, coach] = [await signInBoth(admin, 'p61400000011@squadroom.invalid'), await signInBoth(admin, 'p61400000002@squadroom.invalid')]
if (!parent || !coach) { console.log("  could not sign in — the project's auth rate limit, not a failure"); process.exit(2) }
const { data: cl } = await admin.from('staff_clearances').select('id').eq('academy_id', NRIFA).eq('profile_id', MARCUS).maybeSingle()
const addedClearance = !cl
if (addedClearance) await admin.from('staff_clearances').insert({ academy_id: NRIFA, profile_id: MARCUS, kind: 'wwcc', number: 'WWC0000001E', outcome: 'cleared', expires_on: new Date(Date.now() + 400 * 864e5).toISOString().slice(0, 10), verified_by: OWNER })
const tidy = async () => {
  const { data: evs } = await admin.from('events').select('id').like('title', `${TAG}%`)
  for (const e of evs ?? []) await admin.from('messages').delete().eq('event_id', e.id)
  await admin.from('events').delete().like('title', `${TAG}%`)
}
await tidy()

const kick = sydneyAt(3, 14, 20)
const mk = async (title, startsAt, extra = {}) => (await admin.from('events').insert({ academy_id: NRIFA, team_id: U8, type: 'match', title: `${TAG} ${title}`, opponent: 'Hornsby Heat', starts_at: startsAt.toISOString(), ends_at: new Date(startsAt.getTime() + 3600e3).toISOString(), created_by: OWNER, ...extra }).select('id').single()).data
const ahead = await mk('v Hornsby Heat', kick)
const liveStart = new Date(Date.now() - 10 * 60e3)
const live = await mk('live v Hornsby Heat', liveStart)
const { data: compGame } = await admin.from('events').select('id').eq('team_id', U8).eq('type', 'match').not('fixture_id', 'is', null).is('cancelled_at', null).gt('starts_at', new Date().toISOString()).order('starts_at').limit(1).maybeSingle()
const { data: finalGame } = await admin.from('events').select('id, fixture_id, fixtures!inner(home_score, away_score, status)').eq('team_id', U8).eq('type', 'match').eq('fixtures.status', 'final').order('starts_at', { ascending: false }).limit(1).maybeSingle()

const cookieFor = (s) => ({ name: `sb-${ref}-auth-token`, value: 'base64-' + Buffer.from(JSON.stringify(s.session)).toString('base64'), domain: 'localhost', path: '/' })
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
const open = async (who, id, { tz = null, hash = '' } = {}) => {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 375, height: 812 })
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
  if (tz) await page.emulateTimezone(tz)
  await page.setCookie(cookieFor(who))
  await page.evaluateOnNewDocument((org) => { try { localStorage.setItem('squadroom.org', org) } catch {} }, NRIFA)
  await page.goto(`${BASE}/calendar/${id}${hash}`, { waitUntil: 'networkidle2', timeout: 90000 })
  await page.waitForSelector('[data-game-hero]', { timeout: 30000 })
  // The game's data arrives after the first frame; the tabs say when.
  await page.waitForFunction(() => document.querySelectorAll('[data-tab]').length >= 2 && document.querySelector('[data-team-form]'), { timeout: 30000 }).catch(() => null)
  return { context, page }
}
const heroText = (page) => page.$eval('[data-game-hero]', (e) => e.innerText.replace(/\s+/g, ' '))

try {
  head('2. On the page: 2:20 pm wherever the phone is')
  for (const tz of ['UTC', 'America/Los_Angeles', 'Asia/Kolkata']) {
    const { context, page } = await open(parent, ahead.id, { tz })
    const hero = await heroText(page)
    const info = await page.$eval('[data-match-info]', (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => '')
    const both = `${hero} ${info}`
    both.includes('2:20 pm') && !/\b\d{1,2}:\d{2}\s?am\b/i.test(both)
      ? ok(`a phone on ${tz}: the hero and the details say 2:20 pm, and no "am" anywhere`)
      : bad(`a phone on ${tz}: “${both.slice(0, 160)}”`)
    await context.close()
  }
  {
    // The Fixtures list, on a phone set to UTC.
    const context = await browser.createBrowserContext()
    const page = await context.newPage()
    await page.setViewport({ width: 375, height: 812 })
    await page.emulateTimezone('UTC')
    await page.setCookie(cookieFor(parent))
    await page.evaluateOnNewDocument((org) => { try { localStorage.setItem('squadroom.org', org) } catch {} }, NRIFA)
    await page.goto(`${BASE}/calendar`, { waitUntil: 'networkidle2', timeout: 90000 })
    await page.waitForFunction(() => !document.querySelector('[data-skeleton]'), { timeout: 30000 }).catch(() => null)
    const text = await page.evaluate(() => document.body.innerText)
    text.includes('2:20 pm') && !/3:20\s?am/i.test(text) ? ok('the Fixtures list on a phone set to UTC: 2:20 pm') : bad('the Fixtures list does not show the 2:20 pm kick-off on a UTC phone')
    await context.close()
  }
  {
    // Since 0273 the server sends a shell and the browser draws the game in
    // the venue's time (section 2 above). What the server must never do is
    // print a time of its own — a UTC server once said 3:20 am.
    const html = await fetch(`${BASE}/calendar/${ahead.id}`, { headers: { cookie: `${cookieFor(parent).name}=${cookieFor(parent).value}` } }).then((r) => r.text())
    !/\b\d{1,2}:\d{2}\s?(am|pm)\b/i.test(html) ? ok('the first frame from the server prints no clock time of its own — the browser draws 2:20 pm in the venue\'s time') : bad(`the server-rendered page prints a time: ${html.match(/\b\d{1,2}:\d{2}\s?(am|pm)\b/i)?.[0]}`)
  }

  head('3. The hero, through a game\'s life')
  {
    const { context, page } = await open(parent, ahead.id)
    const st = await page.$eval('[data-game-hero]', (e) => ({ state: e.getAttribute('data-state'), countdown: e.querySelector('[data-countdown]')?.textContent, kick: e.querySelector('[data-kick-off]')?.textContent, crests: [...e.querySelectorAll('[data-crest]')].map((c) => c.getAttribute('data-crest')), bg: getComputedStyle(e).backgroundColor }))
    st.state === 'ahead' && st.countdown === 'In 3 days' && st.kick === '2:20 pm' ? ok(`three days out: “${st.countdown}”, then “${st.kick}”`) : bad(`three days out: ${JSON.stringify(st)}`)
    st.crests.length === 2 && st.crests.includes('initials') ? ok(`both sides drawn: ${st.crests.join(' and ')} (the opposition by its initials)`) : bad(`crests: ${JSON.stringify(st.crests)}`)
    const { data: club } = await admin.from('academies').select('primary_colour').eq('id', NRIFA).single()
    const hex = (c) => '#' + c.match(/\d+/g).slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('')
    hex(st.bg) === club.primary_colour.toLowerCase() ? ok(`on the club's colour (${hex(st.bg)})`) : bad(`the hero is ${hex(st.bg)}, not the club's ${club.primary_colour}`)
    const tabs = await page.$$eval('[data-tab]', (ts) => ts.map((t) => t.getAttribute('data-tab') + (t.getAttribute('aria-selected') === 'true' ? '*' : '')))
    tabs.join(',') === 'preview*,sheet' ? ok('a friendly: Preview and Match sheet, no Ladder; Preview first') : bad(`friendly tabs ${tabs.join(',')}`)
    const order = await page.evaluate(() => {
      const a = document.querySelector('[data-your-answer]'), m = document.querySelector('[data-match-info]')
      return a && m ? Boolean(a.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING) : null
    })
    order ? ok('Preview: the family\'s Going / Maybe / Out comes before the match details') : bad(`availability is not first (${order})`)
    const theirs = await page.$eval('[data-form-side="theirs"]', (e) => e.innerText).catch(() => '')
    ;/Not in a competition/.test(theirs) ? ok('a friendly\'s opposition: “Not in a competition here”, not five empty boxes') : bad(`their form on a friendly: ${theirs}`)
    await context.close()
  }
  {
    // Today, a few hours from now, if today has a few hours left in Sydney.
    const hourNow = Number(new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', hour: 'numeric', hourCycle: 'h23' }).format(new Date()))
    if (hourNow <= 21) {
      const hour = Math.min(hourNow + 2, 23)
      const today = await mk('today v Hornsby Heat', sydneyAt(0, hour, 20))
      const { context, page } = await open(parent, today.id)
      const st = await page.$eval('[data-game-hero]', (e) => ({ state: e.getAttribute('data-state'), kick: e.querySelector('[data-kick-off]')?.textContent, text: e.innerText }))
      // The exact time at the venue. (It said /pm$/, which failed whenever the
      // suite ran before 10 am — two hours on is still morning.)
      const want = `${hour % 12 || 12}:20 ${hour >= 12 ? 'pm' : 'am'}`
      st.state === 'today' && /today/i.test(st.text) && st.kick === want ? ok(`on the day: “Today”, “${st.kick}”`) : bad(`on the day, wanted ${want}: ${JSON.stringify(st)}`)
      await context.close()
    } else ok('on the day: skipped — it is after 9 pm in Sydney, so "today" has no evening left to test')
  }
  {
    // Live: the coach kicks off and scores.
    const { error: k } = await coach.client.rpc('live_tick', { p_event: live.id, p_kind: 'kick_off' })
    const { error: g } = await coach.client.rpc('live_tick', { p_event: live.id, p_kind: 'goal_for', p_minute: 7 })
    if (k || g) bad(`the coach could not tap: ${(k ?? g).message}`)
    const { context, page } = await open(parent, live.id)
    await page.waitForFunction(() => document.querySelector('[data-game-hero]')?.getAttribute('data-state') === 'live', { timeout: 20000 }).catch(() => null)
    const st = await page.$eval('[data-game-hero]', (e) => ({ state: e.getAttribute('data-state'), score: e.querySelector('[data-hero-score]')?.textContent, live: /\blive\b/i.test(e.innerText) }))
    st.state === 'live' && st.score === '1–0' && st.live ? ok(`kicked off and a goal in: “${st.score}”, marked Live`) : bad(`live: ${JSON.stringify(st)}`)
    const tab = await page.$$eval('[data-tab]', (ts) => ts.find((t) => t.getAttribute('aria-selected') === 'true')?.getAttribute('data-tab'))
    tab === 'sheet' ? ok('once it has kicked off, the page opens on the Match sheet') : bad(`a live game opens on ${tab}`)
    await context.close()
  }
  if (finalGame) {
    const { context, page } = await open(parent, finalGame.id)
    await page.waitForFunction(() => document.querySelector('[data-game-hero]')?.getAttribute('data-state') === 'final', { timeout: 20000 }).catch(() => null)
    const st = await page.$eval('[data-game-hero]', (e) => ({ state: e.getAttribute('data-state'), score: e.querySelector('[data-hero-score]')?.textContent, text: e.innerText }))
    const f = finalGame.fixtures
    st.state === 'final' && st.score === `${f.home_score}–${f.away_score}` && /Full time/i.test(st.text)
      ? ok(`a played game: “Full time ${st.score}”, home on the left as the programme prints it`)
      : bad(`final: ${JSON.stringify(st)} (fixture ${f.home_score}–${f.away_score})`)
    await context.close()
  } else bad('no played competition game in the demo to check the final score on')

  head('4. A game in a competition: form, the mini ladder, the full one')
  if (compGame) {
    const { context, page } = await open(parent, compGame.id)
    await page.waitForSelector('[data-mini-ladder]', { timeout: 20000 }).catch(() => null)
    const tabs = await page.$$eval('[data-tab]', (ts) => ts.map((t) => t.getAttribute('data-tab')))
    tabs.join(',') === 'preview,sheet,ladder' ? ok('Preview | Match sheet | Ladder') : bad(`competition tabs ${tabs.join(',')}`)
    const form = await page.$$eval('[data-form-side]', (rows) => rows.map((r) => ({ side: r.getAttribute('data-form-side'), n: r.querySelectorAll('[data-form]').length })))
    form.length === 2 && form.every((f) => f.n >= 1 && f.n <= 5) ? ok(`both sides' last five: ${form.map((f) => `${f.side} ${f.n}`).join(', ')}`) : bad(`form ${JSON.stringify(form)}`)
    const mini = await page.$$eval('[data-mini-ladder] [data-ladder-row]', (rows) => rows.map((r) => r.getAttribute('data-ladder-row')))
    mini.length === 2 && mini.includes('ours') && mini.includes('theirs') ? ok('the mini ladder is the two sides\' rows and nothing else') : bad(`mini ladder rows ${JSON.stringify(mini)}`)
    // Clicked where a thumb would: scrolled clear of the tab bar first.
    await page.$eval('[data-open-ladder]', (e) => { e.scrollIntoView({ block: 'center' }); e.click() })
    await page.waitForSelector('[data-full-ladder]', { timeout: 10000 }).catch(() => null)
    const full = await page.$$eval('[data-full-ladder] [data-ladder-row]', (rows) => rows.map((r) => r.getAttribute('data-ladder-row')))
    const selected = await page.$$eval('[data-tab]', (ts) => ts.find((t) => t.getAttribute('aria-selected') === 'true')?.getAttribute('data-tab'))
    selected === 'ladder' && full.length > 2 && full.includes('ours') && full.includes('theirs') ? ok(`“Full ladder” opens the Ladder tab: ${full.length} teams, both sides marked`) : bad(`full ladder: ${selected} ${JSON.stringify(full)}`)
    await context.close()
  } else bad('no upcoming competition game for U8 in the demo')
  {
    const { context, page } = await open(coach, ahead.id)
    const order = await page.evaluate(() => {
      const w = document.querySelector('[data-whos-coming]'), m = document.querySelector('[data-match-info]')
      return w && m ? Boolean(w.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING) : null
    })
    order ? ok('a coach\'s Preview also leads with availability (who\'s coming)') : bad(`a coach's availability is not first (${order})`)
    await context.close()
  }
} finally {
  await browser.close()
  await tidy()
  if (addedClearance) await admin.from('staff_clearances').delete().eq('academy_id', NRIFA).eq('profile_id', MARCUS).eq('number', 'WWC0000001E')
}
console.log(process.exitCode ? '' : '\n  \x1b[32ma game reads like a programme, in the ground\'s own time\x1b[0m\n')
