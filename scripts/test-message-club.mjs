// Run: node --env-file=.env.local scripts/test-message-club.mjs
//   (needs the app running — npm run dev, or serve:test; SHOTS=1 saves the
//   screens at 375px, light and dark, in .shots/)
//
// Message the club (Big Club Mode item 4; 0243). On squadroom-dev, at NRIFA:
// the Head of academy sees "This will reach N people" and sends to the
// whole club, pinned; the worker tells everyone in a batch; Sam finds it
// in Club messages (unread, then read on opening); the sender sees "Seen by
// 1 of N" and re-pings the unseen; a parent cannot send; a Treasurer may
// message the unpaid and not the club; a coordinator only their age group.
// Everything made here is removed.
import { createClient } from '@supabase/supabase-js'
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'
import { signInBoth } from './_auth.mjs'
import { resolveBaseUrl } from './_base-url.mjs'

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
const HANA_PARENT = '00000000-0000-0000-0000-0000000000b4'
const MARCUS = '00000000-0000-0000-0000-0000000000a2'
const TAG = 'TEST:: message the club'

const { error: no0243 } = await admin.from('club_messages').select('id').limit(1)
if (no0243) {
  note('waiting for 0243 on squadroom-dev — test-rls 194–196 prove it locally meanwhile')
  process.exit(0)
}
async function signInBothAs(profileId) {
  const { data } = await admin.auth.admin.getUserById(profileId)
  return data?.user?.email ? signInBoth(admin, data.user.email) : null
}
const owner = await signInBoth(admin, 'head@squadroom-demo.test')
const sam = await signInBoth(admin, 'p61400000011@squadroom.invalid')
const hana = await signInBothAs(HANA_PARENT)
const marcus = await signInBothAs(MARCUS)
if (!owner || !sam || !hana || !marcus) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}
if (SHOTS) mkdirSync('.shots', { recursive: true })

const { data: clearancesBefore } = await admin.from('staff_clearances').select('profile_id').eq('academy_id', NRIFA).in('profile_id', [HANA_PARENT, MARCUS])
const hadClearance = new Set((clearancesBefore ?? []).map((c) => c.profile_id))
for (const pid of [HANA_PARENT, MARCUS]) {
  if (!hadClearance.has(pid)) await admin.from('staff_clearances').insert({ academy_id: NRIFA, profile_id: pid, kind: 'wwcc', number: `TEST-MSG-${pid.slice(-2)}`, outcome: 'cleared', expires_on: new Date(Date.now() + 300 * 864e5).toISOString().slice(0, 10), verified_by: owner.session.user.id })
}
const made = []
async function tidy() {
  for (const id of made) {
    await admin.from('notification_queue').delete().like('dedupe_key', `club:${id}:%`)
    await admin.from('notification_queue').delete().like('dedupe_key', `clubreping:${id}:%`)
    await admin.from('club_messages').delete().eq('id', id)
  }
  const { data: roles } = await admin.from('club_roles').select('id').eq('academy_id', NRIFA).in('profile_id', [HANA_PARENT, MARCUS])
  for (const r of roles ?? []) await admin.from('club_roles').delete().eq('id', r.id)
  for (const pid of [HANA_PARENT, MARCUS]) if (!hadClearance.has(pid)) await admin.from('staff_clearances').delete().eq('academy_id', NRIFA).eq('profile_id', pid)
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
async function open(who, path, waitFor) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 375, height: 812 })
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
  await page.setCookie({ name: `sb-${ref}-auth-token`, value: 'base64-' + Buffer.from(JSON.stringify(who.session)).toString('base64'), domain: 'localhost', path: '/' })
  await page.evaluateOnNewDocument((o) => { try { localStorage.setItem('squadroom.org', o) } catch {} }, NRIFA)
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 90000 })
  if (waitFor) await page.waitForSelector(waitFor, { timeout: 20000 }).catch(() => null)
  await sleep(300)
  return { context, page }
}
const fits = (page) => page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1)
async function bothThemes(page, name) {
  let fitted = true
  for (const scheme of ['light', 'dark']) {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }])
    await sleep(250)
    fitted = fitted && (await fits(page))
    if (SHOTS) await page.screenshot({ path: `.shots/message-${name}-${scheme}.png`, fullPage: true })
  }
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
  return fitted
}

try {
  head('1. The reach, the send, the batch')
  const { data: preview } = await owner.client.rpc('preview_club_message', { p_academy: NRIFA, p_audience: { kind: 'club' } })
  const { count: members } = await admin.from('academy_members').select('*', { count: 'exact', head: true }).eq('academy_id', NRIFA).eq('status', 'active')
  preview?.allowed && preview.count === (members ?? 0) - 1 ? ok(`"This will reach ${preview.count} people" — every member but the sender`) : bad(`preview ${JSON.stringify(preview)} vs members ${members}`)
  const { error: parentSend } = await sam.client.rpc('send_club_message', { p_academy: NRIFA, p_body: `${TAG} nope`, p_audience: { kind: 'club' } })
  parentSend?.code === '42501' ? ok('a parent cannot send') : bad(`parent sent: ${parentSend?.message ?? 'allowed'}`)
  const { data: msgId, error: sendErr } = await owner.client.rpc('send_club_message', { p_academy: NRIFA, p_body: `${TAG} Presentation day is Sunday 14 Dec at the clubhouse, 10 am.`, p_audience: { kind: 'club' }, p_pinned: true })
  if (msgId) made.push(msgId)
  sendErr ? bad(`send: ${sendErr.message}`) : ok('the Head sends to the whole club, pinned — the tap returns at once')
  const { data: row } = await admin.from('club_messages').select('status, recipient_count').eq('id', msgId).single()
  row?.status === 'queued' && row.recipient_count === preview.count ? ok(`queued for ${row.recipient_count}; the pushes are the worker's`) : bad(`row: ${JSON.stringify(row)}`)
  const { data: told } = await admin.rpc('fan_out_club_messages')
  const { data: after } = await admin.from('club_messages').select('status').eq('id', msgId).single()
  const { count: queued } = await admin.from('notification_queue').select('*', { count: 'exact', head: true }).like('dedupe_key', `club:${msgId}:%`)
  told === row.recipient_count && after?.status === 'sent' && queued === row.recipient_count ? ok(`the worker told ${told} people in one pass and marked it sent`) : bad(`worker ${told}, status ${after?.status}, queued ${queued}`)

  head('2. A parent reads it; the sender sees who has')
  const { data: mine } = await sam.client.rpc('my_club_messages', { p_academy: NRIFA })
  const got = (mine ?? []).find((m) => m.id === msgId)
  got && got.pinned && !got.seen_at ? ok("it is in Sam's Club messages, pinned, unread") : bad(`sam's list: ${JSON.stringify(mine).slice(0, 160)}`)
  {
    const { context, page } = await open(sam, '/messages', '[data-club-messages]')
    const unread = await page.$eval(`[data-club-message="${msgId}"]`, (e) => e.getAttribute('data-seen')).catch(() => null)
    unread === 'no' ? ok('the screen shows it unread') : bad(`seen attr: ${unread}`)
    await page.click(`[data-club-message="${msgId}"] button`)
    await page.waitForFunction((id) => document.querySelector(`[data-club-message="${id}"]`)?.getAttribute('data-seen') === 'yes', { timeout: 10000 }, msgId).then(() => ok('opening it marks it read')).catch(() => bad('not marked read'))
    ;(await bothThemes(page, 'inbox')) ? ok('fits 375px, light and dark') : bad('wider than the phone')
    // The screen marks it seen as it opens, without waiting; give the call
    // its moment before the tab goes.
    let seenRow = null
    for (let i = 0; i < 10 && !seenRow?.seen_at; i++) {
      await sleep(400)
      ;({ data: seenRow } = await admin.from('club_message_recipients').select('seen_at').eq('message_id', msgId).eq('profile_id', sam.session.user.id).maybeSingle())
    }
    seenRow?.seen_at ? ok('and the database has it seen') : bad('seen_at never landed')
    await context.close()
  }
  const { data: sentList } = await owner.client.rpc('club_messages_sent', { p_academy: NRIFA })
  const sentRow = (sentList ?? []).find((m) => m.id === msgId)
  sentRow?.seen === 1 ? ok(`the sender sees "Seen by 1 of ${sentRow.recipients}"`) : bad(`sent row: ${JSON.stringify(sentRow)}`)
  const { data: repinged } = await owner.client.rpc('reping_club_message', { p_message: msgId })
  repinged === sentRow.recipients - 1 ? ok(`one tap re-pings the ${repinged} who have not opened it — not Sam`) : bad(`re-pinged ${repinged}`)
  {
    const { context, page } = await open(owner, '/admin/message', '[data-message-club]')
    const reach = await page.$eval('[data-reach]', (e) => e.getAttribute('data-reach')).catch(() => null)
    Number(reach) === preview.count ? ok('the sender\'s screen: the reach shown before sending') : bad(`reach on screen: ${reach}`)
    const seen = await page.$eval(`[data-sent="${msgId}"] [data-seen-of]`, (e) => e.getAttribute('data-seen-of')).catch(() => null)
    seen === `1/${sentRow.recipients}` ? ok('and "Seen by 1 of N" on the sent list') : bad(`seen-of: ${seen}`)
    ;(await bothThemes(page, 'compose')) ? ok('fits 375px, light and dark') : bad('wider than the phone')
    await context.close()
  }

  head('3. Each role its own audience')
  await owner.client.rpc('grant_club_role', { p_academy: NRIFA, p_profile: HANA_PARENT, p_role: 'treasurer' })
  const { data: tClub } = await hana.client.rpc('preview_club_message', { p_academy: NRIFA, p_audience: { kind: 'club' } })
  const { data: tUnpaid } = await hana.client.rpc('preview_club_message', { p_academy: NRIFA, p_audience: { kind: 'unpaid' } })
  !tClub?.allowed && tUnpaid?.allowed ? ok(`the Treasurer may message the unpaid (${tUnpaid.count}) and not the whole club`) : bad(`treasurer: club ${JSON.stringify(tClub)}, unpaid ${JSON.stringify(tUnpaid)}`)
  await owner.client.rpc('grant_club_role', { p_academy: NRIFA, p_profile: MARCUS, p_role: 'coordinator', p_scope_kind: 'age_group', p_age_group: 'U8' })
  const { data: cU8 } = await marcus.client.rpc('preview_club_message', { p_academy: NRIFA, p_audience: { kind: 'age_groups', age_groups: ['U8'] } })
  const { data: cU12 } = await marcus.client.rpc('preview_club_message', { p_academy: NRIFA, p_audience: { kind: 'age_groups', age_groups: ['U12'] } })
  cU8?.allowed && cU8.count >= 1 && !cU12?.allowed ? ok(`the U8 coordinator reaches U8 (${cU8.count}) and not U12`) : bad(`coordinator: U8 ${JSON.stringify(cU8)}, U12 ${JSON.stringify(cU12)}`)
  const { data: staffMsg } = await owner.client.rpc('send_club_message', { p_academy: NRIFA, p_body: `${TAG} staff only: keys are in the canteen`, p_audience: { kind: 'staff' } })
  if (staffMsg) made.push(staffMsg)
  const { data: samStaff } = await sam.client.from('club_messages').select('id').eq('id', staffMsg)
  ;(samStaff ?? []).length === 0 ? ok('a staff-only message is not a parent\'s to read') : bad('a parent read a staff message')
} finally {
  await browser.close()
  await tidy()
}
console.log(process.exitCode ? '' : '\n  \x1b[32mwrite once, the right people hear it\x1b[0m\n')
