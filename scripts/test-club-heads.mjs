// Run: node --env-file=.env.local scripts/test-club-heads.mjs
//   (needs the app running — npm run dev, or serve:test; SHOTS=1 saves the
//   screens at 375px, light and dark, in .shots/)
//
// The organiser groups (Joey, 9 Nov 2026; 0234–0235): each competition's
// Clubs chat — the league's staff and the head of every entered club, two-way,
// members following the entries, nobody added by hand; one-to-one chats
// between the league and a club's head, never with parents or coaches; the
// league's Referees chat. On squadroom-dev, with the SPL: the league posts,
// Ravens' owner (an entered club's head) reads and replies, Sam (a parent)
// and Marcus (a coach) see none of it; the league opens a direct chat with
// Ravens' head and both see it in their own lists; the head cannot message a
// parent. Then the screens at 375px. Everything made here is removed.
import { createClient } from '@supabase/supabase-js'
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'
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
const RAVENS = '00000000-0000-0000-0000-0000000a0002'
const SPL_ORG = '00000000-0000-0000-0000-0000000a0003'
const TAG = 'TEST:: clubs-chat'

const league = await signInBoth(admin, 'p61400000301@squadroom.invalid') // the SPL's owner
const ravens = await signInBoth(admin, 'p61400000091@squadroom.invalid') // Ravens FC's owner — an entered club's head
const sam = await signInBoth(admin, 'p61400000011@squadroom.invalid') // a parent at NRIFA
const marcus = await signInBoth(admin, 'p61400000002@squadroom.invalid') // a coach at NRIFA
if (!league || !ravens || !sam || !marcus) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}
const { data: spl } = await admin.from('competitions').select('id, name').eq('name', 'SPL Season 3').single()
const { data: ch, error: noCh } = await admin.from('channels').select('id, name, type').eq('type', 'clubs').eq('competition_id', spl.id).maybeSingle()
if (noCh || !ch) {
  note('waiting for 0235 on squadroom-dev — test-rls 174–177 prove it locally meanwhile')
  process.exit(0)
}
if (SHOTS) mkdirSync('.shots', { recursive: true })
let dmId = null
async function tidy() {
  await purgeTestMessages(admin, [TAG])
  if (dmId) await admin.from('channels').delete().eq('id', dmId)
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
async function open(who, path, org) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 375, height: 812 })
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
  await page.setCookie({ name: `sb-${ref}-auth-token`, value: 'base64-' + Buffer.from(JSON.stringify(who.session)).toString('base64'), domain: 'localhost', path: '/' })
  await page.evaluateOnNewDocument((o) => { try { localStorage.setItem('squadroom.org', o) } catch {} }, org)
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 90000 })
  return { context, page }
}
const fits = (page) => page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1)
async function bothThemes(page, name, sel = null) {
  let fitted = true
  if (sel) await page.$eval(sel, (el) => el.scrollIntoView({ block: 'start' })).catch(() => null)
  for (const scheme of ['light', 'dark']) {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }])
    await sleep(250)
    fitted = fitted && (await fits(page))
    if (SHOTS) await page.screenshot({ path: `.shots/clubs-${name}-${scheme}.png` })
  }
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
  return fitted
}

try {
  head('1. The Clubs chat: the league and the entered clubs\' heads, two-way; nobody else')
  ch.name.endsWith('Clubs') ? ok(`"${ch.name}" exists for the competition`) : bad(`channel name: ${ch.name}`)
  const { error: p1 } = await league.client.from('messages').insert({ academy_id: SPL_ORG, channel_id: ch.id, sender_id: league.session.user.id, body: `${TAG} Round 12 kick-offs move to 9 am — please tell your coaches.` })
  p1 ? bad(`the league could not post: ${p1.message}`) : ok('the league posts')
  const { data: readByHead } = await ravens.client.rpc('channel_messages', { p_channel: ch.id, p_limit: 50 })
  ;(readByHead ?? []).some((m) => (m.body ?? '').startsWith(TAG)) ? ok("Ravens' owner, an entered club's head, reads it") : bad(`head reads: ${JSON.stringify(readByHead).slice(0, 160)}`)
  const { error: p2 } = await ravens.client.from('messages').insert({ academy_id: SPL_ORG, channel_id: ch.id, sender_id: ravens.session.user.id, body: `${TAG} Noted, thanks.` })
  p2 ? bad(`the head could not reply: ${p2.message}`) : ok('and replies — it is two-way')
  const { data: mineRavens } = await ravens.client.rpc('my_channels', { p_academy: RAVENS })
  ;(mineRavens ?? []).some((c) => c.channel_id === ch.id) ? ok("it is in Ravens' owner's own chat list, under their own club") : bad('not in the head\'s list')
  for (const [who, label, org] of [[sam, 'Sam, a parent', NRIFA], [marcus, 'Marcus, a coach', NRIFA]]) {
    const { data: mine } = await who.client.rpc('my_channels', { p_academy: org })
    const { data: read, error: re } = await who.client.rpc('channel_messages', { p_channel: ch.id, p_limit: 50 })
    const { error: post } = await who.client.from('messages').insert({ academy_id: SPL_ORG, channel_id: ch.id, sender_id: who.session.user.id, body: `${TAG} should not land` })
    !(mine ?? []).some((c) => c.channel_id === ch.id) && (re || (read ?? []).length === 0) && post ? ok(`${label}: not in the list, reads nothing, cannot post`) : bad(`${label}: listed ${(mine ?? []).some((c) => c.channel_id === ch.id)}, reads ${(read ?? []).length}, posted ${!post}`)
  }
  const { error: byHand } = await league.client.from('channel_members').insert({ academy_id: SPL_ORG, channel_id: ch.id, profile_id: sam.session.user.id, role: 'member' })
  byHand ? ok('nobody is added to it by hand, not even by the league') : bad('the league added a parent by hand')

  head('2. Direct: the league with a club\'s head, and back; never a parent')
  const { data: dm, error: d1 } = await league.client.rpc('open_competition_direct', { p_competition: spl.id, p_other: ravens.session.user.id })
  dmId = dm ?? null
  dm ? ok("the league opens a one-to-one chat with Ravens' head") : bad(`dm: ${d1?.message}`)
  const { data: dmL } = await league.client.rpc('my_channels', { p_academy: SPL_ORG })
  const { data: dmR } = await ravens.client.rpc('my_channels', { p_academy: RAVENS })
  ;(dmL ?? []).some((c) => c.channel_id === dm) && (dmR ?? []).some((c) => c.channel_id === dm) ? ok('and both see it in their own lists') : bad(`in lists: league ${(dmL ?? []).some((c) => c.channel_id === dm)}, head ${(dmR ?? []).some((c) => c.channel_id === dm)}`)
  const { data: again } = await ravens.client.rpc('open_competition_direct', { p_competition: spl.id, p_other: league.session.user.id })
  again === dm ? ok('the head opening it back gets the same chat') : bad(`a second chat: ${again}`)
  const { error: d2 } = await ravens.client.rpc('open_competition_direct', { p_competition: spl.id, p_other: sam.session.user.id })
  const { error: d3 } = await league.client.rpc('open_competition_direct', { p_competition: spl.id, p_other: sam.session.user.id })
  d2?.code === '42501' && d3?.code === '42501' ? ok("neither the head nor the league can message another club's parent") : bad(`to a parent: ${d2?.message ?? 'head allowed'} / ${d3?.message ?? 'league allowed'}`)
  const { data: contacts } = await league.client.rpc('competition_people', { p_competition: spl.id })
  contacts?.standing === 'league' && (contacts.people ?? []).some((p) => p.profile_id === ravens.session.user.id) && !(contacts.people ?? []).some((p) => p.profile_id === sam.session.user.id)
    ? ok("the league's contacts are the clubs' heads — Ravens' owner among them, no parent")
    : bad(`contacts: ${JSON.stringify(contacts).slice(0, 200)}`)

  head('3. The screens, at 375px')
  {
    const { context, page } = await open(ravens, '/chat', RAVENS)
    await page.waitForSelector('[data-group="clubs"]', { timeout: 20000 }).catch(() => null)
    const t = await page.evaluate(() => document.body.textContent ?? '')
    t.includes('Competitions') && (await page.$('[data-group="clubs"]')) ? ok('the head\'s chat list: "Competitions", with the Clubs chat') : bad('no Clubs chat in the list')
    ;(await bothThemes(page, 'list')) ? ok('fits 375px, light and dark') : bad('wider than the phone')
    await page.goto(`${BASE}/chat/${ch.id}`, { waitUntil: 'networkidle2', timeout: 60000 })
    await page.waitForSelector('textarea', { timeout: 20000 }).catch(() => null)
    ;(await page.$('textarea')) && (await page.evaluate(() => document.body.innerText)).includes('Noted, thanks.') ? ok('the chat opens with a composer — two-way — and their reply in it') : bad('no composer, or the reply is missing')
    ;(await bothThemes(page, 'chat')) ? ok('fits 375px, light and dark') : bad('wider than the phone')
    await context.close()
  }
  {
    const { context, page } = await open(league, `/competitions/${spl.id}?tab=clubs`, SPL_ORG)
    await page.waitForSelector('[data-competition-people]', { timeout: 20000 }).catch(() => null)
    const t = await page.$eval('[data-competition-people]', (e) => e.textContent ?? '').catch(() => '')
    t.includes('Clubs chat') && (await page.$$('[data-message]')).length >= 1 ? ok('the league\'s Clubs tab: the Clubs chat and a Message button per club head') : bad(`people: ${t.slice(0, 160)}`)
    ;(await bothThemes(page, 'people', '[data-competition-people]')) ? ok('fits 375px, light and dark') : bad('wider than the phone')
    await context.close()
  }
} finally {
  await browser.close()
  await tidy()
}
console.log(process.exitCode ? '' : '\n  \x1b[32mthe league and the clubs\' heads, in one room, and one to one\x1b[0m\n')
