/**
 * test-chat-polish.mjs — the small things that make chat feel like WhatsApp
 * (0194): ticks, "typing…", link previews and swipe to reply.
 *
 * The rules first, as the API the browser uses; then a real browser at
 * 375px, where a coach types and a parent watches the line appear.
 */
import { createClient } from '@supabase/supabase-js'
import puppeteer from 'puppeteer-core'
import { resolveBaseUrl } from './_base-url.mjs'
import { signInBoth } from './_auth.mjs'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const anon = createClient(URL_, PUB, { auth: { persistSession: false } })
const ref = URL_.split('//')[1].split('.')[0]
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }
const head = (m) => console.log(`\n${m}`)

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const U8 = '00000000-0000-0000-0000-0000000d0008'

async function person(email) {
  const signed = await signInBoth(admin, email)
  if (!signed) {
    console.log("  could not sign in — the project's auth rate limit, not a failure")
    process.exit(2)
  }
  // REST is covered by the session; the socket is a separate connection
  // and must be told too (see test-chat.mjs), or a private topic is anon.
  await signed.client.realtime.setAuth(signed.session.access_token)
  return { client: signed.client, session: signed.session, id: signed.session.user.id }
}

const coach = await person('joeylameri@outlook.com')                 // owner, hosts U8
const parent = await person('p61400000011@squadroom.invalid')        // Sam Whitfield, U8 parent
const stranger = await person('p61400000091@squadroom.invalid')      // Ravens owner, not in NRIFA

const { data: u8 } = await admin.from('channels').select('id').eq('team_id', U8).eq('type', 'team').single()
await admin.from('channels').update({ posting_mode: 'open' }).eq('id', u8.id)
await admin.from('messages').delete().like('body', 'TEST::polish%')
await admin.from('link_previews').delete().like('url', '%TEST-polish%')

// ---------------------------------------------------------------- 1. ticks
head('1. Ticks: who has seen my message')
const { data: sent, error: se } = await coach.client.from('messages')
  .insert({ academy_id: NRIFA, channel_id: u8.id, sender_id: coach.id, body: 'TEST::polish ticks' })
  .select('id').single()
if (se) { bad(`the coach could not post: ${se.message}`); process.exit(1) }

let { data: r1 } = await coach.client.rpc('read_receipts', { p_channel: u8.id, p_message_ids: [sent.id] })
const first = r1?.[0]
first ? ok(`the sender sees a receipt: ${first.read_count} of ${first.member_count} others have seen it`) : bad('the sender got no receipt row')
first && first.read_count === 0 ? ok('nobody has opened the channel since it was sent: one tick') : bad(`expected 0 read, got ${first?.read_count}`)
first && first.member_count >= 1 ? ok('the member count excludes the sender and counts the others') : bad('member_count is 0')

await parent.client.rpc('mark_channel_read', { p_channel: u8.id })
;({ data: r1 } = await coach.client.rpc('read_receipts', { p_channel: u8.id, p_message_ids: [sent.id] }))
r1?.[0]?.read_count >= 1 ? ok('a parent opening the channel turns it into two ticks') : bad(`after mark_channel_read the sender sees ${r1?.[0]?.read_count} read`)

const { data: r2 } = await parent.client.rpc('read_receipts', { p_channel: u8.id, p_message_ids: [sent.id] })
;(r2 ?? []).length === 0 ? ok("a parent cannot ask who has seen the coach's message") : bad('a parent read receipts for a message that is not theirs')

const { data: mine } = await parent.client.from('messages')
  .insert({ academy_id: NRIFA, channel_id: u8.id, sender_id: parent.id, body: 'TEST::polish mine' })
  .select('id').single()
const { data: r3 } = await parent.client.rpc('read_receipts', { p_channel: u8.id, p_message_ids: [mine.id] })
;(r3 ?? []).length === 1 ? ok('a parent sees the receipt for their own message') : bad('a parent got no receipt for their own message')

const { data: r4 } = await stranger.client.rpc('read_receipts', { p_channel: u8.id, p_message_ids: [sent.id, mine.id] })
;(r4 ?? []).length === 0 ? ok('a stranger to the channel gets nothing') : bad(`a stranger read ${r4.length} receipts`)

const { data: cm } = await admin.from('channel_members').select('role').eq('channel_id', u8.id).eq('profile_id', coach.id).maybeSingle()
const { data: r5 } = await coach.client.rpc('read_receipts', { p_channel: u8.id, p_message_ids: [mine.id] })
if (cm?.role === 'host') {
  (r5 ?? []).length === 1 ? ok("a host may ask about a parent's message") : bad("a host got no receipt for a parent's message")
} else {
  (r5 ?? []).length === 0 ? ok("a non-host member cannot ask about a parent's message") : bad("a non-host read a parent's receipt")
}

// --------------------------------------------------------- 2. link previews
head('2. Link previews: read by anyone signed in, written only by the server')
const { error: ie } = await parent.client.from('link_previews').insert({ url: 'https://example.com/TEST-polish-parent', ok: true, title: 'nope' })
ie ? ok(`a parent cannot write a preview (${ie.code ?? ie.message})`) : bad('a parent inserted a preview row')
await admin.from('link_previews').upsert({ url: 'https://example.com/TEST-polish-cached', ok: true, title: 'Cached by the test', fetched_at: new Date().toISOString() })
const { data: pv } = await parent.client.from('link_previews').select('title').eq('url', 'https://example.com/TEST-polish-cached')
pv?.[0]?.title === 'Cached by the test' ? ok('a parent reads a cached preview') : bad('a parent could not read a cached preview')
const { data: av, error: ae } = await anon.from('link_previews').select('title').eq('url', 'https://example.com/TEST-polish-cached')
ae || (av ?? []).length === 0 ? ok('a stranger with no account reads none') : bad('anon read a preview row')

// ------------------------------------------------------------ 3. the route
head('3. The preview route: signed in, public hosts only, cached once')
const BASE = await resolveBaseUrl()
const cookie = {
  name: `sb-${ref}-auth-token`,
  value: 'base64-' + Buffer.from(JSON.stringify(parent.session)).toString('base64'),
  domain: 'localhost',
  path: '/',
}
const withCookie = { headers: { cookie: `${cookie.name}=${cookie.value}` } }
const api = (u, opts) => fetch(`${BASE}/api/link-preview?url=${encodeURIComponent(u)}`, opts)

const noAuth = await api('https://example.com/')
noAuth.status === 401 ? ok('signed out: 401') : bad(`signed out got ${noAuth.status}`)
for (const u of ['http://localhost:3100/', 'http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data', 'http://10.0.0.1/', 'http://192.168.1.1/', 'ftp://example.com/', 'http://metadata/', 'https://user:pw@example.com/']) {
  const res = await api(u, withCookie)
  res.status === 400 ? ok(`refused ${u}`) : bad(`${u} answered ${res.status}, expected 400`)
}
const cached = await api('https://example.com/TEST-polish-cached', withCookie)
const cachedBody = cached.ok ? await cached.json() : null
cachedBody?.title === 'Cached by the test' ? ok('a cached preview is served from the table, not fetched') : bad(`cached preview: ${cached.status} ${JSON.stringify(cachedBody)}`)

const live = await api('https://example.com/', withCookie)
const liveBody = live.ok ? await live.json() : null
if (live.status === 200 && liveBody && typeof liveBody.ok === 'boolean') {
  ok(`a public page answers 200 and is ${liveBody.ok ? `previewable: "${liveBody.title}"` : 'recorded as not previewable (no internet from this machine?)'}`)
  const { data: row } = await admin.from('link_previews').select('url').eq('url', 'https://example.com/')
  const cachedRows = row ?? []
  cachedRows.length === 1 ? ok('and the answer was cached for next time') : bad('the fetched preview was not cached')
} else {
  bad(`a public page got ${live.status}`)
}

// ---------------------------------------------------------------- 4. typing
head('4. Typing: a member may say so on the topic; a stranger cannot even listen')
const heard = await new Promise((resolve) => {
  let settled = false
  const finish = (v) => { if (settled) return; settled = true; clearTimeout(timer); resolve(v) }
  const timer = setTimeout(() => finish(null), 15000)
  parent.client
    .channel(`channel:${u8.id}`, { config: { private: true } })
    .on('broadcast', { event: 'typing' }, ({ payload }) => finish(payload))
    .subscribe((status, err) => {
      if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) return finish({ failed: `${status} ${err?.message ?? ''}` })
      if (status !== 'SUBSCRIBED') return
      const sender = coach.client.channel(`channel:${u8.id}`, { config: { private: true } })
      sender.subscribe(async (s) => {
        if (s !== 'SUBSCRIBED') return
        const r = await sender.send({ type: 'broadcast', event: 'typing', payload: { id: coach.id, name: 'Coach Test' } })
        if (r !== 'ok') finish({ failed: `send returned ${r}` })
      })
    })
})
heard && !heard.failed && heard.name === 'Coach Test'
  ? ok('the coach\'s "typing" reached the parent on the channel\'s private topic')
  : bad(`typing did not arrive: ${heard?.failed ?? 'nothing within 15s'}`)

const strangerStatus = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve('TIMED_OUT'), 15000)
  stranger.client.channel(`channel:${u8.id}`, { config: { private: true } }).subscribe((status) => {
    if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'CLOSED' || status === 'TIMED_OUT') { clearTimeout(timer); resolve(status) }
  })
})
strangerStatus !== 'SUBSCRIBED' ? ok(`a stranger is refused the topic (${strangerStatus})`) : bad('a stranger subscribed to a channel topic')

// ------------------------------------------------------------ 5. browser
head('5. In the browser at 375px: the typing line, the ticks, the preview, the swipe')
const cookieFor = (p) => ({ ...cookie, value: 'base64-' + Buffer.from(JSON.stringify(p.session)).toString('base64') })
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
try {
  const open = async (who) => {
    const page = await browser.newPage()
    await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 1, hasTouch: true, isMobile: true })
    await page.setCookie(cookieFor(who))
    await page.evaluateOnNewDocument((org) => { try { localStorage.setItem('squadroom.org', org) } catch {} }, NRIFA)
    await page.goto(`${BASE}/chat/${u8.id}`, { waitUntil: 'networkidle2', timeout: 60000 })
    await page.waitForSelector('textarea', { timeout: 45000 })
    return page
  }
  const parentPage = await open(parent)
  const coachPage = await open(coach)

  // Give both sockets a moment to join before the coach types.
  await new Promise((r) => setTimeout(r, 2500))
  await coachPage.type('textarea', 'Hello from the coach', { delay: 40 })
  const line = await parentPage.waitForSelector('[data-typing]', { timeout: 12000 }).catch(() => null)
  const lineText = line ? await line.evaluate((el) => el.textContent) : null
  lineText && /typing…/.test(lineText) ? ok(`the parent sees "${lineText.trim()}"`) : bad('the typing line never appeared on the parent\'s screen')
  if (lineText && !/Joey|Coach|Lameri/i.test(lineText)) bad(`the line names "${lineText.trim()}", not the coach`)

  // Ticks on the parent's own message (posted in step 1, seen by nobody yet
  // bar whoever opened the channel in this run).
  const ticks = await parentPage.$$eval('[data-ticks]', (els) => els.map((e) => e.getAttribute('data-ticks')))
  ticks.length >= 1 ? ok(`the parent's own messages carry ticks (${ticks.join(', ')})`) : bad('no ticks on the parent\'s own messages')
  const otherTicks = await coachPage.$$eval('[data-ticks]', (els) => els.length)
  otherTicks >= 1 ? ok("the coach's own message carries ticks too") : bad("no ticks on the coach's message")

  // Everything is swipeable; the swipe itself, emulated.
  const swipeable = await parentPage.$$eval('[data-swipe-reply]', (els) => els.length)
  swipeable >= 2 ? ok(`${swipeable} bubbles answer a swipe`) : bad('bubbles are not swipeable')
  // The gesture as the browser delivers it: a touchstart, a run of
  // touchmoves to the right, a touchend — dispatched on the bubble itself,
  // because CDP's touch emulation hangs on a busy page.
  const target = (await parentPage.$$('[data-swipe-reply]')).at(-1)
  await target.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const fire = (type, x) => {
      const t = new Touch({ identifier: 1, target: el, clientX: x, clientY: r.top + r.height / 2 })
      el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [t], changedTouches: [t] }))
    }
    fire('touchstart', r.left + 30)
    for (let x = 40; x <= 130; x += 15) fire('touchmove', r.left + x)
    fire('touchend', r.left + 130)
  })
  const replying = await parentPage.waitForFunction(() => /Replying to/.test(document.body.innerText), { timeout: 5000 }).then(() => true).catch(() => false)
  replying ? ok('a swipe to the right starts a reply') : bad('swiping a bubble did not start a reply')

  // A link in a message becomes a tappable link and, when the page answers,
  // a preview card.
  await parentPage.click('button[aria-label="Cancel reply"], button::-p-text(✕)').catch(() => null)
  await admin.from('messages').insert({ academy_id: NRIFA, channel_id: u8.id, sender_id: coach.id, body: 'TEST::polish link https://example.com/TEST-polish-cached ok?' })
  const anchor = await parentPage.waitForSelector('a[href="https://example.com/TEST-polish-cached"]', { timeout: 15000 }).catch(() => null)
  anchor ? ok('a link in a message is a link, without the trailing punctuation') : bad('the link in the message was not linked')
  const card = await parentPage.waitForSelector('[data-link-preview]', { timeout: 15000 }).catch(() => null)
  card ? ok('the cached preview shows as a card under the message') : bad('no preview card appeared for a cached link')
} finally {
  await browser.close()
}

// ----------------------------------------------------------------- tidy
await admin.from('messages').delete().like('body', 'TEST::polish%')
await admin.from('link_previews').delete().like('url', '%TEST-polish%')
for (const p of [coach, parent, stranger]) p.client.realtime.disconnect()
process.exit(process.exitCode ?? 0)
