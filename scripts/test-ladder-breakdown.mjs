// Run: node --env-file=.env.local scripts/test-ladder-breakdown.mjs
//   (needs the app running — npm run dev, or serve:test; SHOTS=1 saves the
//   sheet on the league's page and the public centre, light and dark)
//
// Part C item 6 (0260): tap a ladder row to see every point. A throwaway
// league run by the SPL with two rounds played (one a forfeit) and a
// deduction with a reason: the breakdown's games, adjustment and total
// agree with the ladder row, on the league's Ladder tab and on the public
// match centre (published for the test); a stranger's breakdown is null
// while the competition is private; the organiser's switch off takes the
// tap off both pages. Everything made here is deleted.
import { createClient } from '@supabase/supabase-js'
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'
import { signInClient } from './_auth.mjs'
import { listAllUsers } from './_users.mjs'
import { resolveBaseUrl } from './_base-url.mjs'

const BASE = await resolveBaseUrl()
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const ref = URL_.split('//')[1].split('.')[0]
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const anon = createClient(URL_, PUB, { auth: { persistSession: false } })
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
const OUTSIDER = '00000000-0000-0000-0000-0000000000c2' // another club's member
const TAG = 'LADDERTEST'
const SLUG = 'laddertest-cup'
const VISITOR_EMAIL = 'laddertest-owner@squadroom.invalid'
const emailOf = async (id) => (await admin.auth.admin.getUserById(id)).data.user.email

async function cleanup() {
  const { data: comps } = await admin.from('competitions').select('id').like('name', `${TAG} %`)
  for (const c of comps ?? []) await admin.from('competitions').delete().eq('id', c.id)
  const { data: acads } = await admin.from('academies').select('id').like('name', `${TAG} %`)
  for (const a of acads ?? []) await admin.from('academies').delete().eq('id', a.id)
  await admin.from('academy_features').delete().eq('academy_id', SPL).eq('feature', 'ladder_breakdown')
  const { data: users } = await listAllUsers(admin)
  const u = users?.users?.find((x) => x.email === VISITOR_EMAIL)
  if (u) await admin.auth.admin.deleteUser(u.id)
}
await cleanup()

const { data: created } = await admin.auth.admin.createUser({ email: VISITOR_EMAIL, email_confirm: true })
const VISITOR = created.user.id
await admin.from('profiles').upsert({ id: VISITOR, full_name: 'Val Visitor' })
const { data: club } = await admin.from('academies').insert({ two_step_required: false, name: `${TAG} FC`, slug: 'laddertest-fc', type: 'academy', primary_colour: '#333333' }).select('id').single()
await admin.from('academy_members').insert({ academy_id: club.id, profile_id: VISITOR, role: 'owner', status: 'active' })
const { data: comp } = await admin.from('competitions').insert({
  organiser_id: SPL, name: `${TAG} Cup`, type: 'season', season: '2026', status: 'active', mode: 'managed', visibility: 'participants', created_by: OWNER,
}).select('id').single()
await admin.from('competition_clubs').insert([
  { competition_id: comp.id, academy_id: NRIFA, status: 'active', joined_at: new Date().toISOString() },
  { competition_id: comp.id, academy_id: club.id, status: 'active', joined_at: new Date().toISOString() },
])
const { data: entries } = await admin.from('competition_entries').insert([
  { competition_id: comp.id, academy_id: NRIFA, team_id: U8, display_name: 'NRIFA U8', division: 'U8' },
  { competition_id: comp.id, academy_id: club.id, display_name: `${TAG} U8`, division: 'U8' },
]).select('id')
const [home, away] = entries
const ago = (d) => new Date(Date.now() - d * 864e5).toISOString()
await admin.from('fixtures').insert([
  { competition_id: comp.id, division: 'U8', round: 'Round 1', home_entry_id: home.id, away_entry_id: away.id, starts_at: ago(14), status: 'final', stage: 'group', home_score: 3, away_score: 1 },
  { competition_id: comp.id, division: 'U8', round: 'Round 2', home_entry_id: away.id, away_entry_id: home.id, starts_at: ago(7), status: 'forfeit', stage: 'group', home_score: 3, away_score: 0 },
])
await admin.from('ladder_adjustments').insert({ competition_id: comp.id, division: 'U8', entry_id: home.id, points: -3, reason: `${TAG}: an ineligible player in Round 1`, made_by: OWNER })

const owner = await signInClient(admin, await emailOf(OWNER))
const vera = await signInClient(admin, VISITOR_EMAIL)
const outsider = await signInClient(admin, await emailOf(OUTSIDER))
if (!owner || !vera || !outsider) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  await cleanup()
  process.exit(2)
}
const { data: ownerSession } = await owner.auth.getSession()
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
async function open(path, scheme = 'light', signedIn = true) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 375, height: 812 })
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }])
  if (signedIn) {
    await page.setCookie({ name: `sb-${ref}-auth-token`, value: 'base64-' + Buffer.from(JSON.stringify(ownerSession.session)).toString('base64'), domain: 'localhost', path: '/' })
    await page.evaluateOnNewDocument((o) => { try { localStorage.setItem('squadroom.org', o) } catch {} }, SPL)
  }
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 90000 })
  return { page, context }
}
const fits = (page) => page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1)
async function readSheet(page) {
  await page.waitForSelector('[data-ladder-breakdown]:not([data-ladder-breakdown="loading"])', { timeout: 20000 })
  const games = await page.$$eval('[data-breakdown-game]', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')))
  const adj = await page.$$eval('[data-breakdown-adjustment]', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')))
  const total = await page.$eval('[data-breakdown-total]', (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => '')
  return { games, adj, total }
}

try {
  head('1. The numbers: the breakdown adds up to the ladder row')
  {
    const { data: bd } = await owner.rpc('competition_ladder_breakdown', { p_competition: comp.id, p_division: 'U8', p_entry: home.id })
    const { data: ladder } = await owner.rpc('competition_ladder', { p_competition: comp.id, p_division: 'U8' })
    const row = (ladder ?? []).find((r) => r.entry_id === home.id)
    bd && bd.games.length === 2 && bd.totals.from_games === 3 && bd.totals.from_adjustments === -3 && bd.totals.points === row?.points
      ? ok(`two games (3 and 0 points), −3 adjusted, ${bd.totals.points} on the ladder — as the row says`) : bad(`breakdown ${JSON.stringify(bd?.totals)} vs row ${JSON.stringify(row)}`)
    bd?.games[1]?.forfeit && bd.games[1].result === 'L' ? ok('Round 2 is a forfeit, lost 0–3') : bad(`game 2: ${JSON.stringify(bd?.games?.[1])}`)
    const { data: theirs } = await vera.rpc('competition_ladder_breakdown', { p_competition: comp.id, p_division: 'U8', p_entry: home.id })
    theirs?.totals?.points === 0 ? ok('the other club in the competition reads it too') : bad(`the visitors' owner: ${JSON.stringify(theirs)}`)
    const { data: stranger } = await outsider.rpc('competition_ladder_breakdown', { p_competition: comp.id, p_division: 'U8', p_entry: home.id })
    stranger == null ? ok('before publishing, someone from another club gets nothing') : bad('a stranger read the breakdown')
    const { data: notYet } = await anon.rpc('public_ladder_breakdown', { p_slug: SLUG, p_entry: home.id })
    notYet == null ? ok('the public door is shut while the competition is private') : bad('the public door opened for a private competition')
  }

  head('2. The league\'s Ladder tab: tap a row')
  {
    const { page, context } = await open(`/competitions/${comp.id}?tab=ladder`)
    try {
      await page.waitForSelector(`[data-ladder-breakdown-open="${home.id}"]`, { timeout: 30000 })
      await page.click(`[data-ladder-breakdown-open="${home.id}"]`)
      const s = await readSheet(page)
      s.games.length === 2 && /won 3–1 v/.test(s.games[0]) && /lost 0–3 at .*forfeit/.test(s.games[1]) ? ok(`the games: "${s.games[0]}" · "${s.games[1]}"`) : bad(`games: ${JSON.stringify(s.games)}`)
      s.adj.length === 1 && /ineligible player/.test(s.adj[0]) && /-3/.test(s.adj[0]) ? ok(`the adjustment: "${s.adj[0]}"`) : bad(`adjustments: ${JSON.stringify(s.adj)}`)
      ;/From games 3/.test(s.total) && /adjustments -3/.test(s.total) && /0 points on the ladder/.test(s.total) ? ok(`the total: "${s.total}"`) : bad(`total: ${s.total}`)
      ;(await fits(page)) ? ok('fits 375px') : bad('the sheet is wider than the phone')
      if (SHOTS) await page.screenshot({ path: '.shots/ladder-breakdown-league-light.png', fullPage: true })
    } catch (e) {
      bad(`the league's ladder: ${String(e.message).slice(0, 100)}`)
    }
    await context.close()
  }

  head('3. Published: the public match centre, signed out')
  {
    await admin.from('competitions').update({ public_slug: SLUG, published_at: new Date().toISOString() }).eq('id', comp.id)
    const { data: pub } = await anon.rpc('public_ladder_breakdown', { p_slug: SLUG, p_entry: home.id })
    pub && pub.totals.points === 0 && !JSON.stringify(pub).includes('player_id') && !JSON.stringify(pub).includes('full_name') ? ok('the public door answers, teams and scores only') : bad(`public: ${JSON.stringify(pub)?.slice(0, 120)}`)
    for (const scheme of ['light', 'dark']) {
      const { page, context } = await open(`/c/${SLUG}`, scheme, false)
      try {
        const ladderTab = await page.waitForSelector('xpath/.//button[normalize-space()="Ladder"]', { timeout: 30000 })
        await ladderTab.click()
        await page.waitForSelector(`[data-ladder-breakdown-open="${home.id}"]`, { timeout: 30000 })
        await page.click(`[data-ladder-breakdown-open="${home.id}"]`)
        const s = await readSheet(page)
        s.games.length === 2 && s.adj.length === 1 && /0 points on the ladder/.test(s.total) ? ok(`${scheme}: the same breakdown on the public page`) : bad(`${scheme} public sheet: ${JSON.stringify(s)}`)
        ;(await fits(page)) ? ok(`${scheme}: fits 375px`) : bad(`${scheme}: wider than the phone`)
        if (SHOTS) await page.screenshot({ path: `.shots/ladder-breakdown-public-${scheme}.png`, fullPage: true })
      } catch (e) {
        bad(`the public ladder (${scheme}): ${String(e.message).slice(0, 100)}`)
      }
      await context.close()
    }
  }

  head('4. The organiser\'s switch off: no tap, both doors shut')
  {
    const { error } = await owner.rpc('set_feature', { p_academy: SPL, p_feature: 'ladder_breakdown', p_enabled: false })
    error ? bad(`switch: ${error.message}`) : ok('the SPL turns the breakdown off')
    const { data: off } = await owner.rpc('competition_ladder_breakdown', { p_competition: comp.id, p_division: 'U8', p_entry: home.id })
    const { data: offPublic } = await anon.rpc('public_ladder_breakdown', { p_slug: SLUG, p_entry: home.id })
    off == null && offPublic == null ? ok('both readers answer null') : bad(`off: ${off != null} public ${offPublic != null}`)
    const { page, context } = await open(`/c/${SLUG}`, 'light', false)
    const tabBtn = await page.waitForSelector('xpath/.//button[normalize-space()="Ladder"]', { timeout: 30000 }).catch(() => null)
    if (tabBtn) await tabBtn.click()
    const rowThere = await page.waitForSelector(`[data-ladder-row="${home.id}"]`, { timeout: 30000 }).then(() => true).catch(() => false)
    const taps = await page.$$eval('[data-ladder-breakdown-open]', (els) => els.length)
    rowThere && taps === 0 ? ok('the public ladder shows the row with no tap') : bad(`row ${rowThere}, ${taps} taps with the switch off`)
    await context.close()
    const { page: lp, context: lc } = await open(`/competitions/${comp.id}?tab=ladder`)
    const lrow = await lp.waitForSelector(`[data-ladder-row="${home.id}"]`, { timeout: 30000 }).then(() => true).catch(() => false)
    const ltaps = await lp.$$eval('[data-ladder-breakdown-open]', (els) => els.length)
    lrow && ltaps === 0 ? ok('nor the league\'s') : bad(`league row ${lrow}, ${ltaps} taps with the switch off`)
    await lc.close()
    await owner.rpc('set_feature', { p_academy: SPL, p_feature: 'ladder_breakdown', p_enabled: true })
  }
} catch (e) {
  bad(`threw: ${e.message}`)
} finally {
  await browser.close()
  await cleanup()
  const { count } = await admin.from('competitions').select('id', { count: 'exact', head: true }).like('name', `${TAG} %`)
  count === 0 ? ok('everything made here is gone') : bad(`${count} leagues left behind`)
}
console.log(process.exitCode ? '' : '\n  \x1b[32mthe ladder breakdown: every point, on the league\'s page and the public one\x1b[0m\n')
