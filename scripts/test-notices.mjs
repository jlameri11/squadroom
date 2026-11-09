// Run: node --env-file=.env.local scripts/test-notices.mjs
//   (needs the app running — npm run dev, or serve:test)
//
// League notices (Joey, 5 Nov 2026; 0212–0213, extends L-11). Each
// competition has a read-only Notices channel that everyone in it is in:
// the league posts to Everyone or to Club staff only; families of the
// entered teams read the first and never the second; nobody sees anybody
// else in it; nobody replies or reacts; the league sees how many have seen
// each notice. Emailed too when RESEND_API_KEY is set — and silent when not.
//
// The database half is unapplied until the Supabase token is renewed, so
// this suite checks what works now (the tab, the email route, the old
// broadcast still there) and notes the rest as waiting for 0213. test-rls
// 115–123 prove the policies themselves.
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
const note = (m) => console.log(`  \x1b[2m… ${m}\x1b[0m`)
const head = (m) => console.log(`\n${m}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const TAG = 'TEST:: notices'

const { data: spl } = await admin.from('competitions').select('id, name, organiser_id').eq('name', 'SPL Season 3').single()
const { error: no0213 } = await admin.from('channels').select('competition_id').limit(1)
const has0213 = !no0213

const league = await signInBoth(admin, 'p61400000301@squadroom.invalid') // owner of the Sydney Premier League
const parent = await signInBoth(admin, 'p61400000011@squadroom.invalid') // Sam, NRIFA U8
const coach = await signInBoth(admin, 'p61400000002@squadroom.invalid') // Marcus, NRIFA U8 coach
const ravens = await signInBoth(admin, 'p61400000092@squadroom.invalid') // a Ravens U8 parent
if (!league || !parent || !coach || !ravens) { console.log("  could not sign in — the project's auth rate limit, not a failure"); process.exit(2) }

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
async function open(person, path, org) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 375, height: 812 })
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
  await page.setCookie({ name: `sb-${ref}-auth-token`, value: 'base64-' + Buffer.from(JSON.stringify(person.session)).toString('base64'), domain: 'localhost', path: '/' })
  if (org) await page.evaluateOnNewDocument((o) => { try { localStorage.setItem('squadroom.org', o) } catch {} }, org)
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 90000 })
  return { context, page }
}
const shot = async (page, name) => {
  if (!SHOTS) return
  for (const scheme of ['light', 'dark']) {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }])
    await sleep(150)
    await page.screenshot({ path: `.shots/notices-${name}-${scheme}.png` })
  }
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
}

try {
  head('1. The competition\'s tab is Notices')
  {
    const { context, page } = await open(league, `/competitions/${spl.id}?tab=send`, spl.organiser_id)
    const tabs = await page.$$eval('button', (bs) => bs.map((b) => b.innerText.trim()))
    tabs.includes('Notices') ? ok('"Send" is now "Notices"') : bad(`tabs: ${JSON.stringify(tabs.slice(0, 12))}`)
    if (has0213) {
      const link = await page.$eval('[data-notices-tab] a', (a) => a.getAttribute('href')).catch(() => null)
      link?.startsWith('/chat/') ? ok(`and it opens the competition's Notices (${link})`) : bad('no link to the Notices channel')
    } else {
      const old = await page.evaluate(() => document.body.innerText.includes('Message every club'))
      old ? ok('until 0213, the tab still sends the old way: to each club\'s coaches') : bad('neither the Notices nor the old broadcast is there')
      note('the Notices channel itself waits for migration 0213 (needs the Supabase token)')
    }
    await shot(page, 'tab')
    await context.close()
  }

  head('2. Email: on with a key, silent without')
  {
    const res = await fetch(`${BASE}/api/notices/email`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messageId: 'not-a-uuid' }) })
    res.status === 400 ? ok('a request that names no notice is refused') : bad(`a bad id got ${res.status}`)
    const r2 = await fetch(`${BASE}/api/notices/email`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messageId: crypto.randomUUID() }) })
    const j = await r2.json().catch(() => ({}))
    if (!process.env.RESEND_API_KEY) {
      r2.status === 200 && j.email === 'off' ? ok('with no RESEND_API_KEY, emailing a notice does nothing and says nothing to the poster') : bad(`without a key: ${r2.status} ${JSON.stringify(j)}`)
    } else {
      r2.status === 401 ? ok('with a key, a stranger cannot ask for a notice to be emailed') : bad(`a stranger got ${r2.status}`)
    }
  }

  if (!has0213) {
    head('3–5. Posting, reading and seeing a notice')
    note('waiting for migration 0213 — the channel, its audience and its "seen by" are proven by test-rls 115–123 once applied')
  } else {
    const { data: ch } = await admin.from('channels').select('id, name').eq('type', 'notices').eq('competition_id', spl.id).single()
    await purgeTestMessages(admin, [TAG])

    head('3. The league posts — to everyone, then to club staff only')
    {
      const { context, page } = await open(league, `/chat/${ch.id}`, spl.organiser_id)
      await page.waitForSelector('[data-notice-composer]', { timeout: 20000 })
      ok('the league gets the composer, with one choice: Everyone · Club staff only')
      const post = async (audience, text) => {
        await page.$eval(`[data-audience="${audience}"]`, (b) => b.click())
        await page.type('textarea[aria-label="Notice"]', text)
        await page.$eval('[data-post-notice]', (b) => b.click())
        await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout: 15000 }, text).catch(() => null)
        // The bubble appears before the insert answers; the composer is busy
        // until it does. Wait for it to be ready again before the next post.
        await page.waitForFunction(() => { const t = document.querySelector('textarea[aria-label="Notice"]'); return Boolean(t) && !t.disabled && t.value === '' }, { timeout: 15000 }).catch(() => null)
      }
      await post('everyone', `${TAG} Round 12 is off — grounds closed.`)
      await post('club_staff', `${TAG} Team sheets due Monday 9am.`)
      const rows = (await admin.from('messages').select('audience, is_announcement').eq('channel_id', ch.id).like('body', `${TAG}%`)).data ?? []
      rows.length === 2 && rows.every((r) => r.is_announcement) && rows.some((r) => r.audience === 'club_staff')
        ? ok('both posted as notices, one for club staff only') : bad(`posted: ${JSON.stringify(rows)}`)
      await shot(page, 'league')
      await context.close()
    }

    head('4. Who reads what')
    {
      // Sam: a family in the competition — the first, never the second.
      const { context, page } = await open(parent, '/chat', NRIFA)
      // The heading is an eyebrow, rendered in capitals: read the text as written.
      // The group is "Competitions" since 0235: Notices, Clubs and Referees rooms together.
      const listed = await page.evaluate(() => document.body.textContent?.includes('Competitions') && !!document.querySelector('[data-notices]'))
      listed ? ok('Sam\'s chat list has the Notices under "Competitions"') : bad('no notices group in Sam\'s list')
      await page.goto(`${BASE}/chat/${ch.id}`, { waitUntil: 'networkidle2' })
      const text = await page.evaluate(() => document.body.innerText)
      text.includes('Round 12 is off') && !text.includes('Team sheets due') ? ok('Sam reads the notice for everyone and not the one for club staff') : bad('Sam reads the wrong notices')
      ;(await page.$('[data-notice-composer]')) ? bad('Sam has a composer') : ok(`Sam cannot post: “${(await page.$eval('[data-notices-footer]', (e) => e.innerText).catch(() => '')).slice(0, 60)}…”`)
      const actions = await page.$$eval('button', (bs) => bs.map((b) => (b.getAttribute('aria-label') ?? b.innerText).trim()))
      !actions.includes('Reply') && !actions.includes('Add a reaction') ? ok('no Reply and no reactions on a notice') : bad(`actions: ${JSON.stringify(actions)}`)
      await shot(page, 'parent')
      await context.close()
    }
    {
      const { context, page } = await open(coach, `/chat/${ch.id}`, NRIFA)
      const text = await page.evaluate(() => document.body.innerText)
      text.includes('Team sheets due') && text.toLowerCase().includes('club staff only') ? ok('Marcus, an entered club\'s coach, reads the staff notice, marked for club staff') : bad('the coach does not read the staff notice')
      await context.close()
    }
    {
      const { context, page } = await open(ravens, `/chat/${ch.id}`)
      const text = await page.evaluate(() => document.body.innerText)
      text.includes('Round 12 is off') && !text.includes('Team sheets due') ? ok('a Ravens family — another club — reads the same notice, and not the staff one') : bad('the other club\'s family reads the wrong notices')
      await context.close()
    }

    head('5. The league sees how many, never who')
    {
      const { context, page } = await open(league, `/chat/${ch.id}`, spl.organiser_id)
      await page.waitForSelector('[data-notice-reach]', { timeout: 40000 }).catch(() => null)
      const reach = await page.$$eval('[data-notice-reach]', (es) => es.map((e) => e.innerText))
      reach.length > 0 && reach.every((r) => /^Seen by \d+ of \d+$/.test(r)) ? ok(`"${reach[0]}" — a count`) : bad(`reach: ${JSON.stringify(reach)}`)
      await context.close()
    }
    await purgeTestMessages(admin, [TAG])
  }
} finally {
  await browser.close()
}
console.log(process.exitCode ? '' : '\n  \x1b[32ma competition\'s notices reach its people, and only what is theirs to read\x1b[0m\n')
