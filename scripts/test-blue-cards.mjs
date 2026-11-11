// Run: node --env-file=.env.local scripts/test-blue-cards.mjs
//   (needs the app running — npm run dev, or serve:test; SHOTS=1 saves the
//   sheet and the rules at 375px, light and dark)
//
// Part C item 4 (0258): blue cards — the sin bin — per league, on the match
// sheet with minutes. A throwaway league run by the SPL (as test-discipline
// builds one): NRIFA's U8s against a visitor, both sheets in. A blue is
// refused while the league does not use them; the organiser turns them on
// from the Discipline tab's rules (ten minutes off); the sheet offers Blue
// and will not add one without the minute; recorded at 23', it reads
// "back 33'"; the report counts it and names the rule; the organiser's
// switch off takes Blue off the sheet and the database refuses it again.
// Everything made here is deleted.
import { createClient } from '@supabase/supabase-js'
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'
import { signInClient } from './_auth.mjs'
import { listAllUsers } from './_users.mjs'
import { resolveBaseUrl } from './_base-url.mjs'

const BASE = await resolveBaseUrl()
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const ref = URL_.split('//')[1].split('.')[0]
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SHOTS = process.env.SHOTS === '1'
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }
const head = (m) => console.log(`\n${m}`)
if (SHOTS) mkdirSync('.shots', { recursive: true })

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const SPL = '00000000-0000-0000-0000-0000000a0003'
const OWNER = '00000000-0000-0000-0000-0000000000a1'
const U8 = '00000000-0000-0000-0000-0000000d0008'
const TAG = 'BLUETEST'
const VISITOR_EMAIL = 'bluetest-owner@squadroom.invalid'
const emailOf = async (id) => (await admin.auth.admin.getUserById(id)).data.user.email

async function cleanup() {
  const { data: comps } = await admin.from('competitions').select('id').like('name', `${TAG} %`)
  for (const c of comps ?? []) await admin.from('competitions').delete().eq('id', c.id)
  const { data: acads } = await admin.from('academies').select('id').like('name', `${TAG} %`)
  for (const a of acads ?? []) await admin.from('academies').delete().eq('id', a.id)
  await admin.from('academy_features').delete().eq('academy_id', SPL).eq('feature', 'blue_cards')
  const { data: users } = await listAllUsers(admin)
  const u = users?.users?.find((x) => x.email === VISITOR_EMAIL)
  if (u) await admin.auth.admin.deleteUser(u.id)
}
await cleanup()
const { data: splSwitch } = await admin.from('academy_features').select('enabled').eq('academy_id', SPL).eq('feature', 'blue_cards').maybeSingle()
if (splSwitch) console.log('  (the SPL already has a blue_cards switch row — left alone)')

// The league, the two sides, one game with both sheets in.
const { data: created } = await admin.auth.admin.createUser({ email: VISITOR_EMAIL, email_confirm: true })
const VISITOR = created.user.id
await admin.from('profiles').upsert({ id: VISITOR, full_name: 'Val Visitor' })
const { data: club } = await admin.from('academies').insert({ two_step_required: false, name: `${TAG} FC`, slug: 'bluetest-fc', type: 'academy', primary_colour: '#333333' }).select('id').single()
await admin.from('academy_members').insert({ academy_id: club.id, profile_id: VISITOR, role: 'owner', status: 'active' })
const { data: vteam } = await admin.from('teams').insert({ academy_id: club.id, name: `${TAG} U8`, age_group: 'U8', season: '2026', status: 'active' }).select('id').single()
const { data: vkids } = await admin.from('players').insert(
  Array.from({ length: 9 }, (_, i) => ({ academy_id: club.id, team_id: vteam.id, full_name: `Visitor ${i + 1} ${TAG}`, dob: '2018-01-01' }))
).select('id')
const { data: comp } = await admin.from('competitions').insert({
  organiser_id: SPL, name: `${TAG} League`, type: 'season', season: '2026', status: 'active', mode: 'managed', visibility: 'participants', created_by: OWNER,
}).select('id').single()
await admin.from('competition_clubs').insert([
  { competition_id: comp.id, academy_id: NRIFA, status: 'active', joined_at: new Date().toISOString() },
  { competition_id: comp.id, academy_id: club.id, status: 'active', joined_at: new Date().toISOString() },
])
const { data: entries } = await admin.from('competition_entries').insert([
  { competition_id: comp.id, academy_id: NRIFA, team_id: U8, display_name: 'NRIFA U8', division: 'U8' },
  { competition_id: comp.id, academy_id: club.id, team_id: vteam.id, display_name: `${TAG} U8`, division: 'U8' },
]).select('id')
const [home, away] = entries
const { data: fx } = await admin.from('fixtures').insert({ competition_id: comp.id, division: 'U8', round: 'Round 1', home_entry_id: home.id, away_entry_id: away.id, starts_at: new Date(Date.now() + 864e5).toISOString(), status: 'scheduled', stage: 'group' }).select('id').single()

const owner = await signInClient(admin, await emailOf(OWNER))
const vera = await signInClient(admin, VISITOR_EMAIL)
if (!owner || !vera) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  await cleanup()
  process.exit(2)
}
await owner.rpc('seed_entry_squad', { p_entry: home.id })
await vera.rpc('seed_entry_squad', { p_entry: away.id })
const { data: hs } = await admin.from('entry_squads').select('player_id').eq('entry_id', home.id)
const H = hs.map((s) => s.player_id)
const rows = (ids) => ids.map((id, i) => ({ player_id: id, number: i + 1, starting: true }))
const a = await owner.rpc('submit_match_sheet', { p_fixture: fx.id, p_entry: home.id, p_players: rows(H) })
const b = await vera.rpc('submit_match_sheet', { p_fixture: fx.id, p_entry: away.id, p_players: rows(vkids.map((k) => k.id)) })
if (a.error || b.error) { bad(`sheets: ${a.error?.message ?? b.error?.message}`); await cleanup(); process.exit(1) }
const binned = H[0]
const { data: binnedRow } = await admin.from('players').select('full_name').eq('id', binned).single()

// The owner's session, for the browser.
const { data: ownerSession } = await owner.auth.getSession()
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
async function open(path, scheme = 'light') {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 375, height: 812 })
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }])
  await page.setCookie({ name: `sb-${ref}-auth-token`, value: 'base64-' + Buffer.from(JSON.stringify(ownerSession.session)).toString('base64'), domain: 'localhost', path: '/' })
  await page.evaluateOnNewDocument((o) => { try { localStorage.setItem('squadroom.org', o) } catch {} }, SPL)
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 90000 })
  return { page, context }
}
const fits = (page) => page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1)
const kinds = (page) => page.$$eval('[data-event-kind] option', (os) => os.map((o) => o.value))

try {
  head('1. Not this league\'s: refused, and not on the sheet')
  {
    const { error } = await owner.rpc('record_match_event', { p_fixture: fx.id, p_entry: home.id, p_kind: 'blue', p_player: binned, p_minute: 23 })
    error && /does not use blue cards/.test(error.message) ? ok(`a blue is refused: "${error.message}"`) : bad(`blue while off: ${error?.message ?? 'recorded'}`)
    const { page, context } = await open(`/competitions/${comp.id}/match/${fx.id}`)
    await page.waitForSelector('[data-event-kind]', { timeout: 30000 }).catch(() => {})
    const ks = await kinds(page).catch(() => [])
    ks.length > 0 && !ks.includes('blue') ? ok(`the sheet offers ${ks.length} kinds and no blue`) : bad(`kinds on the sheet: ${JSON.stringify(ks)}`)
    await context.close()
  }

  head('2. The organiser turns them on from the Discipline tab')
  {
    const { page, context } = await open(`/competitions/${comp.id}?tab=discipline`)
    try {
      const edit = await page.waitForSelector('xpath/.//button[normalize-space()="Edit"]', { timeout: 30000 })
      await edit.click()
      await page.waitForSelector('[data-rule-blue-cards]', { timeout: 15000 })
      await page.click('[data-rule-blue-cards]')
      await page.$eval('[data-rule-blue-minutes]', (el) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '10'); el.dispatchEvent(new Event('input', { bubbles: true })) })
      if (SHOTS) await page.screenshot({ path: '.shots/blue-cards-rules-light.png', fullPage: true })
      await page.click('[data-rules-save]')
      await page.waitForFunction(() => /blue cards: a 10-minute sin bin/.test(document.body.innerText), { timeout: 20000 })
      ok('the rules read "blue cards: a 10-minute sin bin"')
      ;(await fits(page)) ? ok('the Discipline tab fits 375px') : bad('the Discipline tab is wider than the phone')
    } catch (e) {
      bad(`the rules editor: ${String(e.message).slice(0, 100)}`)
    }
    await context.close()
    const { data: r } = await admin.from('competition_discipline_rules').select('blue_cards, blue_minutes').eq('competition_id', comp.id).maybeSingle()
    r?.blue_cards === true && r.blue_minutes === 10 ? ok('saved: on, ten minutes') : bad(`rules row: ${JSON.stringify(r)}`)
  }

  head('3. On the sheet: Blue with the minute, and "back 33\'"')
  {
    const { error: noMinute } = await owner.rpc('record_match_event', { p_fixture: fx.id, p_entry: home.id, p_kind: 'blue', p_player: binned })
    noMinute && /needs the minute/.test(noMinute.message) ? ok('without a minute the database refuses') : bad(`blue without a minute: ${noMinute?.message ?? 'recorded'}`)
    const { page, context } = await open(`/competitions/${comp.id}/match/${fx.id}`)
    try {
      await page.waitForSelector('[data-event-kind]', { timeout: 30000 })
      const ks = await kinds(page)
      ks.includes('blue') ? ok('the sheet offers Blue now') : bad(`kinds: ${JSON.stringify(ks)}`)
      await page.select('[data-event-kind]', 'blue')
      await page.select('select[aria-label="Player"]', binned)
      const disabled = await page.$eval('[data-event-add]', (el) => el.disabled)
      disabled ? ok('Add waits for the minute') : bad('Add was live without a minute')
      await page.type('input[aria-label="Minute"]', '23')
      await page.click('[data-event-add]')
      await page.waitForSelector('[data-match-event="blue"]', { timeout: 20000 })
      const line = await page.$eval('[data-match-event="blue"]', (el) => el.innerText.replace(/\s+/g, ' '))
      const reads = /23'/.test(line) && /back 33'/.test(line) && line.includes(binnedRow.full_name.split(' ')[0])
      reads ? ok(`the sheet: "${line}"`) : bad(`the event line: ${line}`)
      ;(await fits(page)) ? ok('the sheet fits 375px') : bad('the sheet is wider than the phone')
      if (SHOTS) await page.screenshot({ path: '.shots/blue-cards-sheet-light.png', fullPage: true })
    } catch (e) {
      bad(`the sheet: ${String(e.message).slice(0, 100)}`)
    }
    await context.close()
    const { data: report } = await owner.rpc('discipline_report', { p_competition: comp.id })
    const row = (report?.players ?? []).find((p) => p.player_id === binned)
    row?.blues === 1 && report?.rules?.blue_cards === true ? ok('the report: one blue against them, the rule carried') : bad(`report: ${JSON.stringify(row)} rules ${JSON.stringify(report?.rules)}`)
    const { page: dark, context: c2 } = await open(`/competitions/${comp.id}/match/${fx.id}`, 'dark')
    await dark.waitForSelector('[data-match-event="blue"]', { timeout: 30000 }).catch(() => {})
    ;(await fits(dark)) ? ok('the sheet fits 375px in dark') : bad('the sheet (dark) is wider than the phone')
    if (SHOTS) await dark.screenshot({ path: '.shots/blue-cards-sheet-dark.png', fullPage: true })
    await c2.close()
  }

  head('4. The organiser\'s switch off: gone from the sheet, refused again')
  {
    const { error } = await owner.rpc('set_feature', { p_academy: SPL, p_feature: 'blue_cards', p_enabled: false })
    error ? bad(`switch off: ${error.message}`) : ok('the SPL turns blue cards off in Settings → Features')
    const { error: again } = await owner.rpc('record_match_event', { p_fixture: fx.id, p_entry: home.id, p_kind: 'blue', p_player: binned, p_minute: 40 })
    again && /does not use blue cards/.test(again.message) ? ok('a blue is refused again') : bad(`blue with the switch off: ${again?.message ?? 'recorded'}`)
    const { page, context } = await open(`/competitions/${comp.id}/match/${fx.id}`)
    await page.waitForSelector('[data-event-kind]', { timeout: 30000 }).catch(() => {})
    const ks = await kinds(page).catch(() => [])
    ks.length > 0 && !ks.includes('blue') ? ok('and Blue is gone from the sheet') : bad(`kinds with the switch off: ${JSON.stringify(ks)}`)
    await context.close()
    await owner.rpc('set_feature', { p_academy: SPL, p_feature: 'blue_cards', p_enabled: true })
  }
} catch (e) {
  bad(`threw: ${e.message}`)
} finally {
  await browser.close()
  await cleanup()
  const { count } = await admin.from('competitions').select('id', { count: 'exact', head: true }).like('name', `${TAG} %`)
  count === 0 ? ok('everything made here is gone') : bad(`${count} leagues left behind`)
}
console.log(process.exitCode ? '' : '\n  \x1b[32mblue cards: per league, on the sheet with the minute and the minute back\x1b[0m\n')
