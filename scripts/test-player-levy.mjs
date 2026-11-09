// Run: node --env-file=.env.local scripts/test-player-levy.mjs
//   (needs the app running — npm run dev, or serve:test; SHOTS=1 saves the
//   screens at 375px, light and dark, in .shots/)
//
// B-09 as Joey decided it (9 Nov 2026): the club collects the whole fee, and
// the league sees what each club owes it — a levy per registered player, by
// division — ticked off by the league's treasurer, as entry fees are.
//
// Against squadroom-dev: the SPL's owner sets the levy, the statement adds
// up from the entered squads' rosters, a payment is recorded and undone, a
// club's owner sees their own statement and a parent nothing; then both
// screens at 375px, light and dark. Everything made here is removed, and
// the SPL's levy rows put back as they were.
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
const RAVENS = '00000000-0000-0000-0000-0000000a0002'
const TAG = 'TEST:: levy'

const league = await signInBoth(admin, 'p61400000301@squadroom.invalid') // the SPL's owner
const ravens = await signInBoth(admin, 'p61400000091@squadroom.invalid') // Ravens FC's owner, an entered club
const sam = await signInBoth(admin, 'p61400000011@squadroom.invalid') // a parent
if (!league || !ravens || !sam) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}
const { error: no0230 } = await admin.from('competition_levies').select('competition_id').limit(1)
if (no0230) {
  note('waiting for 0230 on squadroom-dev — test-rls 164–166 prove it locally meanwhile')
  process.exit(0)
}
if (SHOTS) mkdirSync('.shots', { recursive: true })

const { data: spl } = await admin.from('competitions').select('id, name').eq('name', 'SPL Season 3').single()
const { data: before } = await admin.from('competition_levies').select('*').eq('competition_id', spl.id)
async function restore() {
  await admin.from('levy_payments').delete().eq('competition_id', spl.id).like('note', `${TAG}%`)
  await admin.from('competition_levies').delete().eq('competition_id', spl.id)
  if (before?.length) await admin.from('competition_levies').insert(before)
}

// What the clubs should owe, from the rosters as they stand.
const { data: entries } = await admin.from('competition_entries').select('academy_id, division, team_id').eq('competition_id', spl.id).not('team_id', 'is', null)
const rosters = {}
for (const e of entries ?? []) {
  const { count } = await admin.from('players').select('*', { count: 'exact', head: true }).eq('team_id', e.team_id)
  rosters[e.academy_id] = (rosters[e.academy_id] ?? 0) + (count ?? 0)
}
const u8 = (entries ?? []).find((e) => e.academy_id === NRIFA)?.division ?? 'U8s Championship'

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
async function bothThemes(page, name, sel) {
  let fitted = true
  await page.$eval(sel, (el) => el.scrollIntoView({ block: 'start' })).catch(() => null)
  for (const scheme of ['light', 'dark']) {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }])
    await sleep(250)
    fitted = fitted && (await fits(page))
    if (SHOTS) await page.screenshot({ path: `.shots/levy-${name}-${scheme}.png` })
  }
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
  return fitted
}

try {
  head('1. The levy is the organiser\'s to set, and the statement adds up from the rosters')
  const { error: e1 } = await sam.client.rpc('set_competition_levy', { p_competition: spl.id, p_division: '', p_levy_cents: 1000 })
  const { error: e2 } = await ravens.client.rpc('set_competition_levy', { p_competition: spl.id, p_division: '', p_levy_cents: 1000 })
  e1?.code === '42501' && e2?.code === '42501' ? ok('a parent and an entered club cannot set it') : bad(`${e1?.message} / ${e2?.message}`)
  await league.client.rpc('set_competition_levy', { p_competition: spl.id, p_division: '', p_levy_cents: 1000, p_instructions: `${TAG} Bank transfer to SPL Inc, reference your club` })
  const { data: st, error: e3 } = await league.client.rpc('set_competition_levy', { p_competition: spl.id, p_division: u8, p_levy_cents: 1200 })
  st?.levies?.length === 2 ? ok(`the SPL's owner sets $10 a player, $12 in ${u8}`) : bad(`set: ${e3?.message} ${JSON.stringify(st).slice(0, 200)}`)
  const owedBy = {}
  for (const e of entries ?? []) {
    const { count } = await admin.from('players').select('*', { count: 'exact', head: true }).eq('team_id', e.team_id)
    owedBy[e.academy_id] = (owedBy[e.academy_id] ?? 0) + (count ?? 0) * (e.division === u8 ? 1200 : 1000)
  }
  const nrifa = (st?.clubs ?? []).find((c) => c.club_id === NRIFA)
  nrifa && nrifa.owed_cents === owedBy[NRIFA] && nrifa.players === rosters[NRIFA] ? ok(`NRIFA owes $${(nrifa.owed_cents / 100).toFixed(2)} for ${nrifa.players} players on its entered squads`) : bad(`NRIFA: ${JSON.stringify(nrifa)} expected ${owedBy[NRIFA]} for ${rosters[NRIFA]}`)
  const rav = (st?.clubs ?? []).find((c) => c.club_id === RAVENS)
  rav && rav.owed_cents === (owedBy[RAVENS] ?? 0) ? ok(`Ravens owes $${(rav.owed_cents / 100).toFixed(2)} for ${rav.players}`) : bad(`Ravens: ${JSON.stringify(rav)} expected ${owedBy[RAVENS]}`)

  head('2. A payment is recorded by the league, seen by the club, and undone by the league only')
  const { error: e4 } = await ravens.client.rpc('record_levy_payment', { p_competition: spl.id, p_club: RAVENS, p_amount_cents: 2000, p_method: 'bank' })
  e4?.code === '42501' ? ok('a club cannot record its own payment') : bad(`club recorded: ${e4?.message ?? 'allowed'}`)
  const { data: st2 } = await league.client.rpc('record_levy_payment', { p_competition: spl.id, p_club: RAVENS, p_amount_cents: 2000, p_method: 'bank', p_note: `${TAG} ref RAV-1` })
  const rav2 = (st2?.clubs ?? []).find((c) => c.club_id === RAVENS)
  rav2?.paid_cents === 2000 && rav2.balance_cents === rav2.owed_cents - 2000 ? ok('$20 by bank: Ravens\' balance comes down') : bad(`after payment: ${JSON.stringify(rav2)}`)
  const { data: mine, error: e5 } = await ravens.client.rpc('my_levy_statement', { p_competition: spl.id })
  mine?.club_id === RAVENS && mine.paid_cents === 2000 && /Bank transfer/.test(mine.instructions ?? '') ? ok("Ravens' owner sees their own statement, with how to pay") : bad(`mine: ${e5?.message} ${JSON.stringify(mine).slice(0, 200)}`)
  const { error: e6 } = await sam.client.rpc('my_levy_statement', { p_competition: spl.id })
  const { data: peek } = await sam.client.from('levy_payments').select('id').eq('competition_id', spl.id)
  e6?.code === '42501' && (peek ?? []).length === 0 ? ok('a parent sees nothing of it') : bad(`parent: ${e6?.message ?? 'allowed'} rows ${peek?.length}`)
  const payId = rav2?.payments?.[0]?.id
  const { error: e7 } = await ravens.client.rpc('undo_levy_payment', { p_payment: payId })
  const { data: st3 } = await league.client.rpc('undo_levy_payment', { p_payment: payId })
  e7?.code === '42501' && (st3?.clubs ?? []).find((c) => c.club_id === RAVENS)?.paid_cents === 0 ? ok('only the league undoes it') : bad(`undo: club ${e7?.message ?? 'allowed'}, after ${JSON.stringify(st3).slice(0, 120)}`)
  await league.client.rpc('record_levy_payment', { p_competition: spl.id, p_club: RAVENS, p_amount_cents: 2000, p_method: 'cash', p_note: `${TAG} for the screen` })

  head('3. Both screens, at 375px')
  {
    const { context, page } = await open(league, `/competitions/${spl.id}?tab=clubs`, '00000000-0000-0000-0000-0000000a0003')
    await page.waitForSelector('[data-levy]', { timeout: 20000 }).catch(() => null)
    const summary = await page.$eval('[data-levy]', (e) => e.textContent ?? '').catch(() => '')
    summary.includes('Player levy') && summary.includes('$10.00 a player') ? ok('the league\'s Entries & fees shows the levy summary') : bad(`league: ${summary.slice(0, 160)}`)
    await page.$eval('[data-levy-toggle]', (b) => b.click())
    await page.waitForSelector('[data-levy-panel]', { timeout: 5000 }).catch(() => null)
    const clubs = await page.$$eval('[data-levy-club]', (ls) => ls.map((l) => l.textContent ?? ''))
    clubs.length >= 2 && clubs.some((c) => c.includes('Ravens') && c.includes('paid $20.00')) ? ok('every entered club with players, owed, paid and balance') : bad(`clubs: ${JSON.stringify(clubs).slice(0, 300)}`)
    ;(await bothThemes(page, 'league', '[data-levy]')) ? ok('fits 375px, light and dark') : bad('wider than the phone')
    await context.close()
  }
  {
    const { context, page } = await open(ravens, `/competitions/${spl.id}?tab=clubs`, RAVENS)
    await page.waitForSelector('[data-club-levy]', { timeout: 20000 }).catch(() => null)
    const t = await page.$eval('[data-club-levy]', (e) => e.textContent ?? '').catch(() => '')
    t.includes('Player levy to') && t.includes('paid $20.00') && t.includes('How to pay') ? ok("Ravens' owner sees what they owe, what they've paid, and how to pay") : bad(`club: ${t.slice(0, 200)}`)
    ;(await bothThemes(page, 'club', '[data-club-levy]')) ? ok('fits 375px, light and dark') : bad('wider than the phone')
    await context.close()
  }
} finally {
  await browser.close()
  await restore()
}
console.log(process.exitCode ? '' : '\n  \x1b[32mthe club collects, and the league sees what each club owes it\x1b[0m\n')
