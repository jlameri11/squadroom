// Run: node --env-file=.env.local scripts/test-organiser-group.mjs
//   (needs the app running — npm run dev, or serve:test; SHOTS=1 saves
//   screenshots to .shots/)
//
// The organiser group (Joey, 5 and 10 Nov 2026; 0246). One organisation —
// Magic Group, say — runs several leagues and tournaments. Its staff have
// rights on all of them; "Run by <Group>" names it on the competition
// screen, the public match centre and the Notices room; the org switcher
// shows the group with its competitions underneath; and /competitions opens
// with one overview of everything it runs, with this week's numbers. A
// parent gets none of the overview and no competitions under their club.
//
// The switcher only exists for someone in more than one organisation, so
// the league's owner is given a throwaway second one for the run and it is
// removed at the end (the demo is left as found).
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
if (SHOTS) mkdirSync('.shots', { recursive: true })

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const SPL_ORG = '00000000-0000-0000-0000-0000000a0003'
const LEAGUE_OWNER = '00000000-0000-0000-0000-0000000000e1'
const AAA_SLUG = 'organiser-group-aaa'

// The facts, from the demo.
const { data: spl } = await admin.from('competitions').select('id, name, organiser').eq('name', 'SPL Season 3').maybeSingle()
const { data: splOrg } = await admin.from('academies').select('name').eq('id', SPL_ORG).single()
const { data: noticesRoom } = await admin.from('channels').select('id').eq('competition_id', spl?.id ?? '').eq('type', 'notices').maybeSingle()
const { data: pub } = await admin.from('competitions').select('public_slug, organiser_id, academies!organiser_id(name)').not('public_slug', 'is', null).limit(1).maybeSingle()
const pubOrganiser = (Array.isArray(pub?.academies) ? pub.academies[0] : pub?.academies)?.name ?? null
if (!spl) { bad('no SPL Season 3 in the demo'); process.exit(1) }

const league = await signInBoth(admin, 'p61400000301@squadroom.invalid') // the SPL's owner
const sam = await signInBoth(admin, 'p61400000011@squadroom.invalid') // a parent at NRIFA, which is in the SPL
if (!league || !sam) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}

head('1. The group sees everything it runs, and only its staff do')
{
  const { data: orgs, error } = await league.client.rpc('my_organisations_with_competitions')
  const mine = (orgs ?? []).find((o) => o.id === SPL_ORG)
  const under = (mine?.competitions ?? []).map((c) => c.name)
  !error && under.includes('SPL Season 3')
    ? ok(`the switcher's list puts ${under.length} competition(s) under ${mine.name}: ${under.join(', ')}`)
    : bad(`switcher list: ${error?.message ?? JSON.stringify(orgs).slice(0, 200)}`)

  const { data: over, error: e2 } = await league.client.rpc('group_overview', { p_academy: SPL_ORG })
  const row = (over?.competitions ?? []).find((c) => c.id === spl.id)
  !e2 && over?.group?.name === splOrg.name && row
    ? ok(`the overview is ${over.group.name}'s: ${over.competitions.length} competition(s)`)
    : bad(`overview: ${e2?.message ?? JSON.stringify(over).slice(0, 200)}`)
  row && ['clubs', 'teams', 'weekend', 'unfilled', 'disputed', 'missing_sheets'].every((k) => typeof row[k] === 'number')
    ? ok(`SPL Season 3: ${row.clubs} clubs, ${row.teams} teams, ${row.weekend} this weekend, ${row.unfilled} without a referee, ${row.disputed} disputed, ${row.missing_sheets} sheets missing`)
    : bad(`the row's numbers: ${JSON.stringify(row)}`)
  row && row.clubs >= 1 && row.teams >= 1 ? ok('with the clubs and teams entered counted') : bad(`clubs ${row?.clubs}, teams ${row?.teams}`)

  // Rights on all of them: the group's owner runs the competition itself.
  const { data: access } = await league.client.rpc('my_competition_access', { p_competition: spl.id })
  const areas = access?.areas ?? []
  areas.includes('competition') ? ok("the group's owner runs SPL Season 3 (my_competition_access)") : bad(`areas: ${JSON.stringify(access)}`)

  // A parent: no overview, and nothing under their club in the switcher.
  const { data: parentOver } = await sam.client.rpc('group_overview', { p_academy: SPL_ORG })
  parentOver === null ? ok("a parent gets no overview of the league's group") : bad(`a parent read: ${JSON.stringify(parentOver).slice(0, 120)}`)
  const { data: ownOver } = await sam.client.rpc('group_overview', { p_academy: NRIFA })
  ownOver === null ? ok('nor of their own club (owners, admins and league roles only)') : bad(`a parent read NRIFA's: ${JSON.stringify(ownOver).slice(0, 120)}`)
  const { data: parentOrgs } = await sam.client.rpc('my_organisations_with_competitions')
  const listed = (parentOrgs ?? []).flatMap((o) => o.competitions ?? [])
  ;(parentOrgs ?? []).length >= 1 && listed.length === 0
    ? ok(`a parent's switcher lists their ${parentOrgs.length} organisation(s) with nothing underneath`)
    : bad(`a parent's switcher: ${JSON.stringify(parentOrgs).slice(0, 200)}`)
}

// A second organisation for the league's owner, so the switcher exists.
{
  const { data: old } = await admin.from('academies').select('id').eq('slug', AAA_SLUG)
  for (const o of old ?? []) await admin.from('academies').delete().eq('id', o.id)
}
const { data: aaa, error: aaaErr } = await admin
  .from('academies')
  .insert({ two_step_required: false, name: 'Aaa Test Group', slug: AAA_SLUG, type: 'league', primary_colour: '#333333' })
  .select('id')
  .single()
if (aaaErr) { bad(`could not make the throwaway organisation: ${aaaErr.message}`); process.exit(1) }
await admin.from('academy_members').insert({ academy_id: aaa.id, profile_id: LEAGUE_OWNER, role: 'owner', status: 'active' })

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
async function open(who, path, org, waitFor) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 375, height: 812 })
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
  if (who) {
    await page.setCookie({ name: `sb-${ref}-auth-token`, value: 'base64-' + Buffer.from(JSON.stringify(who.session)).toString('base64'), domain: 'localhost', path: '/' })
    await page.evaluateOnNewDocument((o) => { try { localStorage.setItem('squadroom.org', o) } catch {} }, org)
  }
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 90000 })
  if (waitFor) await page.waitForSelector(waitFor, { timeout: 20000 }).catch(() => null)
  await sleep(300)
  return { context, page }
}
async function shots(page, name) {
  for (const scheme of ['light', 'dark']) {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }])
    await sleep(150)
    if (SHOTS) await page.screenshot({ path: `.shots/group-${name}-${scheme}.png`, fullPage: true })
  }
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
  const fits = await page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1)
  fits ? ok(`${name}: fits 375px, light and dark`) : bad(`${name}: wider than the phone`)
}

try {
  head('2. /competitions opens with the overview for the group')
  {
    const { context, page } = await open(league, '/competitions', SPL_ORG, '[data-group-overview]')
    const card = await page.$eval('[data-group-overview]', (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => '')
    card.includes('SPL Season 3') ? ok('the overview names SPL Season 3') : bad(`overview: ${card.slice(0, 200) || 'missing'}`)
    ;/\d+ clubs? · \d+ teams? · \d+ this weekend/.test(card) ? ok('with its clubs, teams and this weekend\'s games') : bad(`numbers: ${card.slice(0, 200)}`)
    const cardIsLink = await page.$('[data-group-overview] a[href^="/competitions/"]')
    cardIsLink ? ok('each row opens the competition') : bad('no link in the overview')
    await shots(page, 'competitions')
    await context.close()
  }

  head('3. The switcher shows the group with its competitions underneath')
  {
    const { context, page } = await open(league, '/', SPL_ORG, '[aria-label="Switch organisation"]')
    const btn = await page.$('[aria-label="Switch organisation"]')
    if (!btn) bad('no switcher button for someone in two organisations')
    else {
      await btn.click()
      await page.waitForSelector(`[data-org-competitions="${SPL_ORG}"]`, { timeout: 15000 }).catch(() => null)
      const under = await page.$eval(`[data-org-competitions="${SPL_ORG}"]`, (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => '')
      under.includes('SPL Season 3') ? ok(`under ${splOrg.name}: ${under}`) : bad(`nothing under the SPL: ${under || 'missing'}`)
      const underAaa = await page.$(`[data-org-competitions="${aaa.id}"]`)
      !underAaa ? ok('an organisation that runs nothing has nothing underneath') : bad('the empty organisation shows a list')
      await shots(page, 'switcher')
      // Tapping one opens that competition.
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(() => null),
        page.$eval(`[data-org-competitions="${SPL_ORG}"] button`, (b) => b.click()),
      ])
      page.url().includes(`/competitions/${spl.id}`) ? ok('tapping it opens the competition') : bad(`landed on ${page.url()}`)
    }
    await context.close()
  }

  head('4. "Run by <Group>" on the competition, the Notices room and the public page')
  {
    const { context, page } = await open(league, `/competitions/${spl.id}`, SPL_ORG, '[data-run-by]')
    const runBy = await page.$eval('[data-run-by]', (e) => e.textContent.trim()).catch(() => '')
    runBy === `Run by ${splOrg.name}` ? ok(`the competition screen: "${runBy}"`) : bad(`competition screen: "${runBy || 'missing'}"`)
    await context.close()
  }
  if (noticesRoom) {
    const { context, page } = await open(league, `/chat/${noticesRoom.id}`, SPL_ORG, '[data-channel-kind="notices"]')
    const sub = await page.$eval('[data-channel-kind="notices"]', (e) => e.textContent.trim()).catch(() => '')
    sub.startsWith(`Run by ${splOrg.name}`) ? ok(`the Notices room: "${sub}"`) : bad(`Notices room: "${sub || 'missing'}"`)
    await context.close()
  } else note('no Notices room for SPL Season 3 on this database')
  if (pub?.public_slug) {
    const { context, page } = await open(null, `/c/${pub.public_slug}`, null, '.eyebrow')
    const eyebrows = await page.$$eval('.eyebrow', (es) => es.map((e) => e.textContent.replace(/\s+/g, ' ').trim()))
    const hit = eyebrows.find((t) => /^run by /i.test(t))
    hit && (!pubOrganiser || hit.toLowerCase().includes(pubOrganiser.toLowerCase()))
      ? ok(`the public match centre /c/${pub.public_slug}: "${hit}"`)
      : bad(`public page eyebrows: ${JSON.stringify(eyebrows).slice(0, 200)}`)
    await context.close()
  } else note('no published competition on this database')

  head('5. A parent sees the plain list, no overview')
  {
    const { context, page } = await open(sam, '/competitions', NRIFA, 'a[href^="/competitions/"]')
    await sleep(1500)
    const over = await page.$('[data-group-overview]')
    !over ? ok('no overview for a parent') : bad('a parent sees the overview')
    const links = await page.$$eval('a[href^="/competitions/"]', (as) => as.map((a) => a.textContent?.replace(/\s+/g, ' ').trim() ?? ''))
    const row = links.find((t) => t.includes('SPL Season 3'))
    row && row.includes(`run by ${splOrg.name}`) ? ok(`their row says: ${row}`) : bad(`row: ${row ?? 'missing'} (expected "run by ${splOrg.name}")`)
    await context.close()
  }
} finally {
  await browser.close()
  await admin.from('academies').delete().eq('id', aaa.id)
  const { data: left } = await admin.from('academy_members').select('academy_id').eq('profile_id', LEAGUE_OWNER).eq('status', 'active')
  ;(left ?? []).length === 1 && left[0].academy_id === SPL_ORG ? ok("the throwaway organisation is gone; the league's owner is back in one") : bad(`the league's owner is in ${JSON.stringify(left)}`)
}
console.log(process.exitCode ? '' : '\n  \x1b[32mthe organiser group: one overview, the switcher lists its competitions, "Run by" everywhere\x1b[0m\n')
