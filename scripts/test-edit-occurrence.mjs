// Run: node --env-file=.env.local scripts/test-edit-occurrence.mjs
//   (needs the app running — npm run dev, or serve:test)
//
// E-01b: change one session's time or place without breaking its series.
//
// "Training is at 5:30 this Thursday, not 5" — from the session's own page,
// by its coach, in the ground's time whatever the coach's phone says. Only
// that row moves; next Thursday is still at 5. The squad is told (the 0064
// change alert). A parent cannot do it, and a league game is not offered it.
import { createClient } from '@supabase/supabase-js'
import puppeteer from 'puppeteer-core'
import { signInBoth } from './_auth.mjs'
import { resolveBaseUrl } from './_base-url.mjs'

const BASE = await resolveBaseUrl()
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const ref = URL_.split('//')[1].split('.')[0]
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }
const head = (m) => console.log(`\n${m}`)
const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const U8 = '00000000-0000-0000-0000-0000000d0008'
const MARCUS = '00000000-0000-0000-0000-0000000000a2'
const OWNER = '00000000-0000-0000-0000-0000000000a1'
const TAG = 'EDITOCC::'
const SYD = 'Australia/Sydney'
const sydney = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: SYD, weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso))
const sydneyDate = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: SYD, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)

const [coach, parent] = [await signInBoth(admin, 'p61400000002@squadroom.invalid'), await signInBoth(admin, 'p61400000011@squadroom.invalid')]
if (!coach || !parent) { console.log("  could not sign in — the project's auth rate limit, not a failure"); process.exit(2) }
const { data: cl } = await admin.from('staff_clearances').select('id').eq('academy_id', NRIFA).eq('profile_id', MARCUS).maybeSingle()
const addedClearance = !cl
if (addedClearance) await admin.from('staff_clearances').insert({ academy_id: NRIFA, profile_id: MARCUS, kind: 'wwcc', number: 'WWC0000001E', outcome: 'cleared', expires_on: new Date(Date.now() + 400 * 864e5).toISOString().slice(0, 10), verified_by: OWNER })

const tidy = async () => {
  const { data: series } = await admin.from('event_series').select('id').like('title', `${TAG}%`)
  const ids = (series ?? []).map((s) => s.id)
  if (ids.length) {
    const { data: evs } = await admin.from('events').select('id').in('series_id', ids)
    for (const e of evs ?? []) await admin.from('notification_queue').delete().contains('payload', { event_id: e.id })
    await admin.from('events').delete().in('series_id', ids)
    await admin.from('event_series').delete().in('id', ids)
  }
}
await tidy()

const cookieFor = (s) => ({ name: `sb-${ref}-auth-token`, value: 'base64-' + Buffer.from(JSON.stringify(s.session)).toString('base64'), domain: 'localhost', path: '/' })
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
const open = async (who, id, tz = null) => {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 375, height: 812 })
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
  if (tz) await page.emulateTimezone(tz)
  await page.setCookie(cookieFor(who))
  await page.evaluateOnNewDocument((org) => { try { localStorage.setItem('squadroom.org', org) } catch {} }, NRIFA)
  await page.goto(`${BASE}/calendar/${id}`, { waitUntil: 'networkidle2', timeout: 90000 })
  return { context, page }
}

try {
  head('1. A Thursday series, as its coach makes it')
  const from = sydneyDate(new Date(Date.now() + 2 * 864e5))
  const until = sydneyDate(new Date(Date.now() + 30 * 864e5))
  const { data: made, error: me } = await coach.client.rpc('create_event_series', {
    p_academy: NRIFA, p_title: `${TAG} Thursday training`, p_days: [4], p_time: '17:00', p_from: from, p_until: until,
    p_team: U8, p_type: 'training', p_duration: 75, p_arrive: 15, p_venue: 'ELS Hall Park', p_address: 'Cnr Pennant Hills Rd & Boundary Rd',
  })
  if (me) throw new Error(`could not make the series: ${me.message}`)
  const { data: before } = await admin.from('events').select('id, starts_at, ends_at, arrive_at, venue').eq('series_id', made.series_id).order('starts_at')
  before.length >= 3 ? ok(`${before.length} Thursdays at ${sydney(before[0].starts_at).split(', ')[1]}`) : bad(`only ${before.length} sessions`)
  const target = before[1]

  head('2. The coach moves one of them, from a phone set to UTC')
  {
    const { context, page } = await open(coach, target.id, 'UTC')
    await page.waitForSelector('[data-edit-occurrence]', { timeout: 20000 })
    await page.$eval('[data-edit-occurrence]', (e) => { e.scrollIntoView({ block: 'center' }); e.click() })
    await page.waitForSelector('[data-edit-form]', { timeout: 10000 })
    const prefilled = await page.$eval('[data-field="start"]', (e) => e.value)
    prefilled === '17:00' ? ok('the form shows the ground\'s time, 17:00, not the phone\'s') : bad(`the start field says ${prefilled}`)
    const says = await page.$eval('[data-edit-form]', (e) => e.innerText)
    ;/rest of the series stays/.test(says) ? ok('and says only this one changes') : bad('the form does not say the rest of the series stays')
    const setField = (name, value) => page.$eval(`[data-field="${name}"]`, (e, v) => {
      const proto = Object.getPrototypeOf(e)
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(e, v)
      e.dispatchEvent(new Event('input', { bubbles: true }))
      e.dispatchEvent(new Event('change', { bubbles: true }))
    }, value)
    await setField('start', '17:30')
    await setField('venue', 'Christie Park')
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => null),
      page.$eval('[data-save-occurrence]', (e) => e.click()),
    ])
    await context.close()
  }
  const { data: after } = await admin.from('events').select('id, starts_at, ends_at, arrive_at, venue').eq('series_id', made.series_id).order('starts_at')
  const moved = after.find((e) => e.id === target.id)
  const t = sydney(moved.starts_at)
  t.endsWith('17:30') && moved.venue === 'Christie Park' ? ok(`this Thursday: ${t} at ${moved.venue}`) : bad(`the session is ${t} at ${moved.venue}`)
  sydney(moved.ends_at).endsWith('18:45') && sydney(moved.arrive_at).endsWith('17:15')
    ? ok('the finish and the arrive-by moved with it (18:45, 17:15)')
    : bad(`finish ${sydney(moved.ends_at)}, arrive ${sydney(moved.arrive_at)}`)
  const others = after.filter((e) => e.id !== target.id)
  const untouched = others.every((e) => { const b = before.find((x) => x.id === e.id); return b && b.starts_at === e.starts_at && b.venue === e.venue })
  untouched && others.length === before.length - 1 ? ok(`the other ${others.length} Thursdays are untouched, still at 17:00 at ELS Hall Park`) : bad('another session in the series changed')

  head('3. The squad is told')
  {
    const { data: told } = await admin.from('notification_queue').select('profile_id, title, body').eq('kind', 'event_changed').contains('payload', { event_id: target.id })
    told?.length > 0 && told.every((n) => /Christie Park/.test(n.body) && /Now/.test(n.body))
      ? ok(`${told.length} people: “${told[0].title} — ${told[0].body}”`)
      : bad(`change alerts: ${JSON.stringify(told?.slice(0, 2))}`)
  }

  head('4. A parent sees it, and cannot change it')
  {
    const { context, page } = await open(parent, target.id)
    const text = await page.evaluate(() => document.body.innerText)
    text.includes('5:30 pm') && text.includes('Christie Park') ? ok('the family sees 5:30 pm at Christie Park') : bad('the family does not see the new time and place')
    const button = await page.$('[data-edit-occurrence]')
    !button ? ok('no "Change time or place" for a parent') : bad('a parent was offered the change')
    await context.close()
    const { data: rows } = await parent.client.from('events').update({ venue: 'Somewhere else' }).eq('id', target.id).select('id')
    ;(rows ?? []).length === 0 ? ok('and the database refuses a parent\'s own attempt') : bad('a parent changed the session')
  }

  head('5. A league game is the league\'s to move')
  {
    const { data: game } = await admin.from('events').select('id').eq('team_id', U8).not('fixture_id', 'is', null).is('cancelled_at', null).gt('starts_at', new Date().toISOString()).order('starts_at').limit(1).maybeSingle()
    if (game) {
      const { context, page } = await open(coach, game.id)
      await page.waitForSelector('[data-game-hero]', { timeout: 20000 })
      const offered = await page.$('[data-edit-occurrence]')
      const note = await page.$('[data-league-sets-time]')
      !offered && note ? ok('a competition game: no edit, and it says the league sets the time') : bad(`competition game: edit offered ${Boolean(offered)}, note ${Boolean(note)}`)
      await context.close()
    } else bad('no upcoming league game for U8 to check')
  }
} finally {
  await browser.close()
  await tidy()
  if (addedClearance) await admin.from('staff_clearances').delete().eq('academy_id', NRIFA).eq('profile_id', MARCUS).eq('number', 'WWC0000001E')
}
console.log(process.exitCode ? '' : '\n  \x1b[32mone Thursday moves, the series stays, the squad is told\x1b[0m\n')
