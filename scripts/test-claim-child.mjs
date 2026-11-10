// Run: node --env-file=.env.local scripts/test-claim-child.mjs
//   (needs the app running — npm run dev, or serve:test; SHOTS=1 saves
//   screenshots to .shots/)
//
// A family claims their child from the roster (Big Club Mode item 5; 0248).
// The join form takes each child's name AND birthday; approval finds the
// child already on the roster by both — anywhere in the club, the link's
// squad preferred, a squadless child put on the link's squad — and only
// makes a new record for a child nobody has. An older client sending bare
// names still works as before. The printable sheet carries the code, the QR
// and the three steps.
//
// Over real HTTP, like test-join-flow. The demo is left as found: a
// throwaway squad, its players, the links, the requests and the accounts
// the approvals made are all removed at the end.
import { createClient } from '@supabase/supabase-js'
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'
import { signInBoth } from './_auth.mjs'
import { resolveBaseUrl } from './_base-url.mjs'

const BASE = await resolveBaseUrl()
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const REF = URL_.split('//')[1].split('.')[0]
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SHOTS = process.env.SHOTS === '1'
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }
const head = (m) => console.log(`\n${m}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
if (SHOTS) mkdirSync('.shots', { recursive: true })

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const TEAM = 'Zz Claim U9'
const LABEL = 'claim-test'
const PHONE_A = '+61400008877'
const PHONE_B = '+61400008866'
const post = (path, body, cookie) =>
  fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) })

async function cleanup() {
  const { data: u } = await admin.auth.admin.listUsers({ perPage: 1000 })
  for (const phone of [PHONE_A, PHONE_B]) {
    const user = u?.users?.find((x) => x.phone === phone.replace('+', ''))
    if (user) await admin.auth.admin.deleteUser(user.id)
  }
  await admin.from('join_requests').delete().in('phone', [PHONE_A, PHONE_B])
  await admin.from('join_links').delete().eq('label', LABEL)
  await admin.from('players').delete().eq('academy_id', NRIFA).like('full_name', 'Claim Child %')
  await admin.from('teams').delete().eq('academy_id', NRIFA).eq('name', TEAM)
}
await cleanup()

const headOf = await signInBoth(admin, 'head@squadroom-demo.test') // NRIFA's owner approves
if (!headOf) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}
const cookie = `sb-${REF}-auth-token=base64-${Buffer.from(JSON.stringify(headOf.session)).toString('base64')}`

// The roster, as an import would leave it: one child on the squad, one on
// no squad yet.
const { data: team, error: teamErr } = await admin.from('teams').insert({ academy_id: NRIFA, name: TEAM, age_group: 'U9', season: '2026', status: 'active' }).select('id').single()
if (teamErr) { bad(`team: ${teamErr.message}`); await cleanup(); process.exit(1) }
const { data: one } = await admin.from('players').insert({ academy_id: NRIFA, team_id: team.id, full_name: 'Claim Child One', dob: '2017-05-05' }).select('id').single()
const { data: two } = await admin.from('players').insert({ academy_id: NRIFA, team_id: null, full_name: 'Claim Child Two', dob: '2016-02-02' }).select('id').single()
const { data: link, error: linkErr } = await admin.from('join_links').insert({ academy_id: NRIFA, team_id: team.id, role: 'parent', label: LABEL, created_by: headOf.session.user.id }).select('token, code').single()
if (linkErr) { bad(`link: ${linkErr.message}`); await cleanup(); process.exit(1) }

try {
  head('1. A family names three children with birthdays')
  {
    const wrong = await post('/api/join/request', { token: link.token, fullName: 'Claimant Parent', phone: '0400 008 877', email: 'claimant@example.com', children: [{ name: 'Claim Child One', dob: '2090-01-01' }] })
    const wrongBody = await wrong.json().catch(() => ({}))
    wrong.status === 400 && /Claim Child One/.test(wrongBody.error ?? '') ? ok(`a birthday that cannot be one is refused, naming the child: "${wrongBody.error}"`) : bad(`wrong dob: ${wrong.status} ${JSON.stringify(wrongBody)}`)

    const res = await post('/api/join/request', {
      token: link.token, fullName: 'Claimant Parent', phone: '0400 008 877', email: 'claimant@example.com',
      children: [
        { name: 'claim child one', dob: '2017-05-05' }, // on the squad, spelt differently
        { name: 'Claim Child Two', dob: '2016-02-02' }, // on no squad yet
        { name: 'Claim Child New', dob: '2018-01-01' }, // nobody has them
      ],
    })
    const body = await res.json().catch(() => ({}))
    res.ok && body.requestId ? ok('the request is made') : bad(`request: ${res.status} ${JSON.stringify(body)}`)
    const { data: row } = await admin.from('join_requests').select('children, children_names').eq('id', body.requestId).maybeSingle()
    Array.isArray(row?.children) && row.children.length === 3 && row.children[1].dob === '2016-02-02' && row.children_names.length === 3
      ? ok('the request carries the three children with their birthdays, and the names beside them')
      : bad(`row: ${JSON.stringify(row)}`)

    const appr = await post('/api/join/approve', { requestId: body.requestId, decision: 'approve' }, cookie)
    const apprBody = await appr.json().catch(() => ({}))
    appr.ok ? ok('the owner approves') : bad(`approve: ${appr.status} ${JSON.stringify(apprBody)}`)

    const { data: prof } = await admin.from('profiles').select('id').eq('phone', PHONE_A).maybeSingle()
    const { data: links } = await admin.from('player_guardians').select('player_id').eq('profile_id', prof?.id ?? '00000000-0000-0000-0000-000000000000')
    const linked = new Set((links ?? []).map((l) => l.player_id))
    linked.size === 3 ? ok('the parent is guardian of three children') : bad(`guardian of ${linked.size}`)
    linked.has(one.id) ? ok('Claim Child One: the child already on the squad, found by name and birthday despite the spelling') : bad('Child One was not matched')
    linked.has(two.id) ? ok('Claim Child Two: found on no squad, by name and birthday') : bad('Child Two was not matched')
    const { data: twoNow } = await admin.from('players').select('team_id').eq('id', two.id).single()
    twoNow?.team_id === team.id ? ok("and put on the link's squad") : bad(`Child Two's squad: ${twoNow?.team_id}`)
    const { data: made } = await admin.from('players').select('id, full_name, dob, team_id').eq('academy_id', NRIFA).like('full_name', 'Claim Child %').order('full_name')
    made?.length === 3 ? ok('three players in all — nobody was added twice') : bad(`${made?.length} players: ${JSON.stringify(made?.map((p) => p.full_name))}`)
    const fresh = (made ?? []).find((p) => p.full_name === 'Claim Child New')
    fresh && fresh.dob === '2018-01-01' && fresh.team_id === team.id ? ok('Claim Child New: made, with the birthday, on the squad') : bad(`new child: ${JSON.stringify(fresh)}`)
  }

  head('2. An older client sends bare names: the old rule, a name within the squad')
  {
    const res = await post('/api/join/request', { token: link.token, fullName: 'Second Parent', phone: '0400 008 866', email: 'second@example.com', children: ['Claim Child One'] })
    const body = await res.json().catch(() => ({}))
    res.ok ? ok('the request is made') : bad(`request: ${res.status} ${JSON.stringify(body)}`)
    const appr = await post('/api/join/approve', { requestId: body.requestId, decision: 'approve' }, cookie)
    appr.ok ? ok('approved') : bad(`approve: ${appr.status}`)
    const { data: prof } = await admin.from('profiles').select('id').eq('phone', PHONE_B).maybeSingle()
    const { data: links } = await admin.from('player_guardians').select('player_id').eq('profile_id', prof?.id ?? '00000000-0000-0000-0000-000000000000')
    links?.length === 1 && links[0].player_id === one.id ? ok('linked to Claim Child One by name within the squad') : bad(`links: ${JSON.stringify(links)}`)
    const { count } = await admin.from('players').select('id', { count: 'exact', head: true }).eq('academy_id', NRIFA).like('full_name', 'Claim Child %')
    count === 3 ? ok('still three players') : bad(`${count} players`)
  }

  head('3. The screens, at 375px')
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
  try {
    const context = await browser.createBrowserContext()
    const page = await context.newPage()
    await page.setViewport({ width: 375, height: 812 })
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
    await page.goto(`${BASE}/join/${link.token}`, { waitUntil: 'networkidle2', timeout: 90000 })
    await page.waitForSelector('[data-join-children]', { timeout: 20000 }).catch(() => null)
    const names = await page.$$eval('[data-join-child-name]', (es) => es.length)
    const dobs = await page.$$eval('[data-join-child-dob]', (es) => es.length)
    names === 1 && dobs === 1 ? ok('the join form asks for a child by name and birthday') : bad(`children fields: ${names} names, ${dobs} birthdays`)
    await page.click('[data-join-add-child]')
    const more = await page.$$eval('[data-join-child-name]', (es) => es.length)
    more === 2 ? ok('"Add another" adds a second child') : bad(`${more} rows after Add another`)
    const hint = await page.$eval('[data-join-children]', (e) => e.innerText)
    ;/as the club has them/i.test(hint) ? ok('and says why: as the club has them, so they are matched to the roster') : bad(`hint: ${hint.slice(0, 160)}`)
    for (const scheme of ['light', 'dark']) {
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }])
      await sleep(150)
      if (SHOTS) await page.screenshot({ path: `.shots/claim-join-${scheme}.png`, fullPage: true })
    }
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
    const fits = await page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1)
    fits ? ok('join form: fits 375px, light and dark') : bad('join form wider than the phone')

    await page.goto(`${BASE}/join/sheet/${link.code}`, { waitUntil: 'networkidle2', timeout: 90000 })
    await page.waitForSelector('[data-join-sheet]', { timeout: 20000 }).catch(() => null)
    const sheet = await page.$eval('[data-join-sheet]', (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => '')
    sheet.includes(link.code) && sheet.includes(TEAM) ? ok(`the sheet names the squad and carries the code ${link.code}`) : bad(`sheet: ${sheet.slice(0, 200) || 'missing'}`)
    const svg = await page.$('[data-join-sheet] svg')
    svg ? ok('with the QR') : bad('no QR on the sheet')
    ;/birthday/i.test(sheet) ? ok("and the step: your children's names and birthdays as the club has them") : bad(`steps: ${sheet.slice(0, 200)}`)
    if (SHOTS) await page.screenshot({ path: '.shots/claim-sheet-light.png', fullPage: true })
    const sheetFits = await page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1)
    sheetFits ? ok('sheet: fits 375px') : bad('sheet wider than the phone')
    await context.close()
  } finally {
    await browser.close()
  }
} finally {
  await cleanup()
  const { count } = await admin.from('players').select('id', { count: 'exact', head: true }).eq('academy_id', NRIFA).like('full_name', 'Claim Child %')
  count === 0 ? ok('the demo is as it was') : bad(`${count} test players left`)
}
console.log(process.exitCode ? '' : '\n  \x1b[32ma family claims their child from the roster, by name and birthday\x1b[0m\n')
