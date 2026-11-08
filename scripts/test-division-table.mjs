// Run: node --env-file=.env.local scripts/test-division-table.mjs
//   (needs the app running — npm run dev, or serve:test; SHOTS=1 saves the
//   screens at 375px, light and dark, in .shots/)
//
// F-05's last piece, the division table from a league's file (0228). The
// other clubs' games in an export were left out as "neither team is yours";
// kept, they make the table — the teams around our squad, 3/1/0, goal
// difference then goals for — on the squad's page and a game's Preview.
//
// Three parts. The importer is driven end to end NOW with a real file and
// every write stood in (the screen's own teams, the preview, the import,
// the results, the table) — so the demo is untouched and what the importer
// SENDS for the table is asserted exactly. The two screens are checked now
// with the table's answer stood in. The real thing — the coach stores a
// file's games, the table adds up, the squad's family sees it, another
// club does not — runs against squadroom-dev once 0228 is applied, and
// says it is waiting until then; test-rls 161–163 prove it locally.
import { createClient } from '@supabase/supabase-js'
import puppeteer from 'puppeteer-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import { signInBoth } from './_auth.mjs'
import { resolveBaseUrl } from './_base-url.mjs'

const BASE = await resolveBaseUrl()
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const ref = URL_.split('//')[1].split('.')[0]
const host = new URL(URL_).host
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SHOTS = process.env.SHOTS === '1'
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }
const note = (m) => console.log(`  \x1b[2m… ${m}\x1b[0m`)
const head = (m) => console.log(`\n${m}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const OWNER = '00000000-0000-0000-0000-0000000000a1'
const U8 = '00000000-0000-0000-0000-0000000d0008'
const TAG = 'TESTDIV'

const owner = await signInBoth(admin, 'joeylameri@outlook.com')
const sam = await signInBoth(admin, 'p61400000011@squadroom.invalid')
const ravens = await signInBoth(admin, 'p61400000091@squadroom.invalid')
if (!owner || !sam || !ravens) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}
const { error: no0228 } = await admin.from('imported_games').select('id').limit(1)
const has0228 = !no0228
if (SHOTS) mkdirSync('.shots', { recursive: true })
mkdirSync('.cache', { recursive: true })

const dmy = (daysAgo) => {
  const d = new Date(Date.now() - daysAgo * 864e5)
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`
}
const ymd = (daysAgo) => new Date(Date.now() - daysAgo * 864e5).toLocaleDateString('en-CA')
const { data: u8 } = await admin.from('teams').select('season, external_ref').eq('id', U8).single()

async function tidy() {
  const { data: evs } = await admin.from('events').select('id').like('title', `${TAG}%`)
  for (const e of evs ?? []) await admin.from('notification_queue').delete().filter('payload->>event_id', 'eq', e.id)
  await admin.from('events').delete().like('title', `${TAG}%`)
  if (has0228) await admin.from('imported_games').delete().eq('academy_id', NRIFA).like('home', `${TAG} %`)
}
await tidy()
const when = new Date(Date.now() + 2 * 864e5)
const { data: game } = await admin.from('events').insert({ academy_id: NRIFA, team_id: U8, type: 'match', title: `${TAG} v Hornsby`, opponent: 'Hornsby U8', starts_at: when.toISOString(), ends_at: new Date(when.getTime() + 3600e3).toISOString(), created_by: OWNER }).select('id').single()

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })

async function open(who, path, answers = null) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 375, height: 812 })
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
  await page.setCookie({ name: `sb-${ref}-auth-token`, value: 'base64-' + Buffer.from(JSON.stringify(who.session)).toString('base64'), domain: 'localhost', path: '/' })
  await page.evaluateOnNewDocument((org) => { try { localStorage.setItem('squadroom.org', org) } catch {} }, NRIFA)
  const calls = []
  if (answers) {
    await page.setRequestInterception(true)
    page.on('request', (r) => {
      const u = new URL(r.url())
      const fn = u.host === host && u.pathname.startsWith('/rest/v1/rpc/') ? u.pathname.slice('/rest/v1/rpc/'.length) : null
      if (fn && fn in answers && r.method() === 'POST') {
        let body = {}
        try { body = JSON.parse(r.postData() ?? '{}') } catch {}
        calls.push({ fn, body })
        const value = typeof answers[fn] === 'function' ? answers[fn](body) : answers[fn]
        r.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(value) }).catch(() => {})
        return
      }
      r.continue().catch(() => {})
    })
  }
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 90000 })
  return { context, page, calls }
}
const text = (page) => page.evaluate(() => document.body.innerText)
const fits = (page) => page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1)
async function bothThemes(page, name) {
  let fitted = true
  await page.$eval('[data-division-table]', (el) => el.scrollIntoView({ block: 'start' })).catch(() => null)
  for (const scheme of ['light', 'dark']) {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }])
    await sleep(250)
    fitted = fitted && (await fits(page))
    if (SHOTS) await page.screenshot({ path: `.shots/division-${name}-${scheme}.png` })
  }
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
  return fitted
}
const clickButton = (page, re) => page.$$eval('button', (bs, src) => { const b = bs.find((x) => new RegExp(src).test(x.textContent?.trim() ?? '')); b?.click(); return b?.textContent?.trim() ?? null }, re.source)

const table = {
  team: { id: U8, name: 'U8 SPL', league_name: `${TAG} NRFA U8` }, division: 'U8 Premier', season: u8?.season ?? '2026', updated_at: new Date().toISOString(), games: 4,
  rows: [
    { team: `${TAG} NRFA U8`, ours: true, p: 2, w: 2, d: 0, l: 0, gf: 6, ga: 2, gd: 4, pts: 6 },
    { team: `${TAG} Hornsby U8`, ours: false, p: 2, w: 1, d: 0, l: 1, gf: 4, ga: 2, gd: 2, pts: 3 },
    { team: `${TAG} Manly U8`, ours: false, p: 2, w: 0, d: 1, l: 1, gf: 1, ga: 4, gd: -3, pts: 1 },
    { team: `${TAG} Mosman U8`, ours: false, p: 2, w: 0, d: 1, l: 1, gf: 0, ga: 3, gd: -3, pts: 1 },
  ],
}

try {
  // ---------------------------------------------------------------------------
  head('1. The importer keeps the other clubs\' games for the table (a real file; every write stood in)')
  {
    const csv = [
      'Match Id,Date,Time,Home Team,Away Team,Home Score,Away Score,Division,Round',
      `${TAG}-1,${dmy(14)},09:00,${TAG} NRFA U8,${TAG} Hornsby U8,2,1,U8 Premier,1`,
      `${TAG}-2,${dmy(7)},10:30,${TAG} Manly U8,${TAG} NRFA U8,,,U8 Premier,2`,
      `${TAG}-3,${dmy(14)},09:00,${TAG} Mosman U8,${TAG} Manly U8,0,0,U8 Premier,1`,
    ].join('\n')
    const file = '.cache/test-division.csv'
    writeFileSync(file, csv)
    const { context, page, calls } = await open(owner, '/admin/import', {
      import_screen: { academy: { id: NRIFA, name: 'NRIFA Football Academy', timezone: 'Australia/Sydney' }, teams: [{ id: U8, name: 'U8 SPL', external_ref: `${TAG} NRFA U8`, skip_import: false, season: '2026' }] },
      preview_imported_events: (b) => ({ rows: b.p_events.map((e) => ({ verdict: 'new', event_id: null, title: e.title, round: e.round, venue: e.venue, was_at: null, now_at: new Date().toISOString(), was_venue: null })), missing: [], covers: null }),
      create_imported_events: [{ created: 2, updated: 0, skipped: 0, cancelled: 0 }],
      apply_imported_results: { results: 1, unmatched: 0 },
      store_imported_games: { added: 3, updated: 0, unreadable: 0, with_scores: 2 },
    })
    await page.waitForSelector('input[type="file"]', { timeout: 20000 }).catch(() => null)
    const input = await page.$('input[type="file"]')
    await input.uploadFile(file)
    await page.waitForFunction(() => document.body.innerText.includes('Which column is which?'), { timeout: 20000 }).catch(() => null)
    const division = await page.$$eval('label', (ls) => { const l = ls.find((x) => x.textContent?.trim().startsWith('Division')); return l?.querySelector('select')?.value ?? null })
    division === 'Division' ? ok('the Division column is suggested on its own') : bad(`division mapped to ${division}`)
    await page.waitForFunction(() => /games? read/.test(document.body.innerText), { timeout: 10000 }).catch(() => null)
    let t = await text(page)
    t.includes('2 games read, 1 not imported') ? ok('"2 games read, 1 not imported"') : bad(`summary: ${t.slice(t.indexOf('games read') - 20, t.indexOf('games read') + 60)}`)
    ;/1 × Another club.s game — kept for the division table, not imported/.test(t) ? ok("and why: another club's game, kept for the table") : bad(`the reason is not said: ${t.slice(Math.max(0, t.indexOf('not imported') - 80), t.indexOf('not imported') + 120).replace(/\n/g, ' | ')}`)
    const checked = await clickButton(page, /^Check the changes/)
    checked ? ok(`"${checked}"`) : bad('no Check the changes button')
    await page.waitForFunction(() => document.body.innerText.includes('What this will do'), { timeout: 15000 }).catch(() => null)
    const imported = await clickButton(page, /^(Apply|Import)\b/)
    imported ? ok(`then "${imported}"`) : bad(`no Import button — buttons: ${JSON.stringify(await page.$$eval('button', (bs) => bs.map((b) => b.textContent?.trim())))}`)
    await page.waitForFunction(() => document.body.innerText.includes('kept for the division table'), { timeout: 15000 }).catch(() => null)
    const sent = calls.find((c) => c.fn === 'store_imported_games')
    const rows = sent?.body?.p_rows ?? []
    const foreign = rows.find((r) => r.home === `${TAG} Mosman U8`)
    sent && sent.body.p_season === '2026' && rows.length === 3 && foreign && foreign.home_score === 0 && foreign.away_score === 0 && foreign.division === 'U8 Premier' && foreign.external_ref === `${TAG}-3`
      ? ok('the table is sent all three games — the other clubs\' included — with the file\'s own home and away scores, the division and the reference')
      : bad(`store call: ${JSON.stringify(sent?.body ?? null).slice(0, 400)}`)
    const ours = rows.find((r) => r.external_ref === `${TAG}-1`)
    ours?.home === `${TAG} NRFA U8` && ours.home_score === 2 && ours.away_score === 1 && rows.find((r) => r.external_ref === `${TAG}-2`)?.home_score === null
      ? ok('our games keep home and away as the file had them, a game still to play with no score')
      : bad(`ours: ${JSON.stringify(ours)}`)
    t = await text(page)
    t.includes('3 games kept for the division table') ? ok('and the report says so') : bad(`report: ${t.slice(0, 200)}`)
    await context.close()
  }

  // ---------------------------------------------------------------------------
  head("2. The table on the squad's page and a game's Preview (stood in)")
  {
    const { context, page } = await open(owner, `/admin/teams/${U8}`, { division_table: table })
    await page.waitForSelector('[data-division-table]', { timeout: 20000 }).catch(() => null)
    const t = await page.$eval('[data-division-table]', (e) => e.textContent ?? '').catch(() => '')
    t.includes('Division table') && t.includes('U8 Premier') ? ok('"Division table · U8 Premier" under the squad\'s form') : bad(`table: ${t.slice(0, 200)}`)
    const first = await page.$eval('[data-division-table] [role="row"]:nth-child(2)', (e) => e.textContent).catch(() => '')
    first?.includes(`${TAG} NRFA U8`) && first.includes('+4') && first.endsWith('6') ? ok('first row: NRFA U8, +4, 6 points') : bad(`first row: ${first}`)
    ;(await page.$('[data-table-row="ours"]')) ? ok('ours is marked') : bad('ours is not marked')
    t.includes('4 games played') && t.includes('Three for a win, one for a draw') ? ok('and the rule is said') : bad('no rule line')
    ;(await bothThemes(page, 'team')) ? ok('fits 375px, light and dark') : bad('wider than the phone')
    await context.close()

    const g = await open(sam, `/calendar/${game.id}`, { division_table: table })
    await g.page.waitForSelector('[data-division-table]', { timeout: 20000 }).catch(() => null)
    ;(await g.page.$('[data-division-table]')) ? ok("on a game's Preview too, for Sam") : bad('no table on the game page')
    ;(await bothThemes(g.page, 'game')) ? ok('fits 375px, light and dark') : bad('wider than the phone')
    await g.context.close()
  }

  // ---------------------------------------------------------------------------
  head('3. Against the database')
  if (!has0228) {
    note('waiting for 0228 on squadroom-dev (the Supabase token) — the coach stores a file\'s games, the table adds up, the squad\'s family sees it, another club does not; test-rls 161–163 prove it locally meanwhile')
  } else {
    await admin.from('teams').update({ external_ref: `${TAG} NRFA U8` }).eq('id', U8)
    try {
      const rows = [
        { round: '1', local_date: ymd(14), home: `${TAG} NRFA U8`, away: `${TAG} Hornsby U8`, home_score: 2, away_score: 1, external_ref: `${TAG}-1` },
        { round: '1', local_date: ymd(14), home: `${TAG} Mosman U8`, away: `${TAG} Manly U8`, home_score: 0, away_score: 0 },
        { round: '2', local_date: ymd(7), home: `${TAG} Hornsby U8`, away: `${TAG} Mosman U8`, home_score: 3, away_score: 0, external_ref: `${TAG}-3` },
        { round: '2', local_date: ymd(7), home: `${TAG} Manly U8`, away: `${TAG} NRFA U8`, home_score: 1, away_score: 4, external_ref: `${TAG}-4` },
        { round: '2', local_date: ymd(7), home: `${TAG} Hornsby U9`, away: `${TAG} Mosman U9`, home_score: 5, away_score: 5 },
      ]
      const { error: e1 } = await sam.client.rpc('store_imported_games', { p_academy: NRIFA, p_season: u8.season, p_rows: rows })
      e1?.code === '42501' ? ok('a family cannot store a file\'s games') : bad(`parent stored: ${e1?.message ?? 'allowed'}`)
      const { data: st, error: e2 } = await owner.client.rpc('store_imported_games', { p_academy: NRIFA, p_season: u8.season, p_rows: rows })
      st?.added === 5 ? ok('the owner stores five games') : bad(`store: ${e2?.message} ${JSON.stringify(st)}`)
      const { data: tb } = await sam.client.rpc('division_table', { p_team: U8 })
      const names = (tb?.rows ?? []).map((r) => r.team)
      tb?.rows?.length === 4 && tb.rows[0].team === `${TAG} NRFA U8` && tb.rows[0].ours && tb.rows[0].pts === 6 && tb.rows[1].team === `${TAG} Hornsby U8` && !names.some((n) => n.endsWith('U9'))
        ? ok('Sam\'s table: the four U8 sides, NRFA on top with 6, not the U9s')
        : bad(`table: ${JSON.stringify(tb)}`)
      const { error: e3 } = await ravens.client.rpc('division_table', { p_team: U8 })
      const { data: peek } = await ravens.client.from('imported_games').select('id').eq('academy_id', NRIFA)
      e3 && (peek ?? []).length === 0 ? ok('another club reads none of it') : bad('another club reached the table')
      const { context, page } = await open(owner, `/admin/teams/${U8}`)
      await page.waitForSelector('[data-division-table]', { timeout: 20000 }).catch(() => null)
      ;(await page.$('[data-table-row="ours"]')) && (await fits(page)) ? ok('the real squad page shows it, at 375px') : bad('the real page shows no table')
      await context.close()
    } finally {
      await admin.from('teams').update({ external_ref: u8?.external_ref ?? null }).eq('id', U8)
    }
  }
} finally {
  await browser.close()
  await tidy()
}
console.log(process.exitCode ? '' : '\n  \x1b[32mthe file says who leads\x1b[0m\n')
