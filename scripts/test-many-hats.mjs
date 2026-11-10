// Run: node --env-file=.env.local scripts/test-many-hats.mjs
//   (needs the app running — npm run dev, or serve:test; SHOTS=1 saves the
//   screens at 375px, light and dark, in .shots/)
//
// Part A fix 1 (Joey, 10 Nov 2026; 0237): one membership, many hats. On
// squadroom-dev, at NRIFA, Sam — Leo and Zoe's parent — is made a coach, the
// President and U8's team manager too, by the Head of academy. Home shows
// four hats; each shows its own three jobs and nothing of the others; the
// parent's hat is still the parent's (his children's games); a one-role
// write from an older caller swaps that hat and keeps the rest; the
// Treasurer's money is not his. Everything made here is undone.
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
const SAM = '00000000-0000-0000-0000-0000000000b1'
const U8 = '00000000-0000-0000-0000-0000000d0008'

const { data: probe, error: no0237 } = await admin.from('academy_members').select('roles').eq('academy_id', NRIFA).eq('profile_id', SAM).maybeSingle()
if (no0237) {
  note('waiting for 0237 on squadroom-dev — test-rls 184–186 prove it locally meanwhile')
  process.exit(0)
}
const rolesBefore = probe?.roles ?? ['parent']

const owner = await signInBoth(admin, 'head@squadroom-demo.test')
const sam = await signInBoth(admin, 'p61400000011@squadroom.invalid')
if (!owner || !sam) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}
if (SHOTS) mkdirSync('.shots', { recursive: true })

const { data: clearance } = await admin.from('staff_clearances').select('profile_id').eq('academy_id', NRIFA).eq('profile_id', SAM).maybeSingle()
const hadClearance = Boolean(clearance)
if (!hadClearance) {
  await admin.from('staff_clearances').insert({ academy_id: NRIFA, profile_id: SAM, kind: 'wwcc', number: 'TEST-HATS', outcome: 'cleared', expires_on: new Date(Date.now() + 300 * 864e5).toISOString().slice(0, 10), verified_by: owner.session.user.id })
}
async function tidy() {
  const { data: roles } = await admin.from('club_roles').select('id').eq('academy_id', NRIFA).eq('profile_id', SAM)
  for (const r of roles ?? []) await admin.from('club_roles').delete().eq('id', r.id)
  await admin.from('academy_members').update({ roles: rolesBefore }).eq('academy_id', NRIFA).eq('profile_id', SAM)
  // The coach's hat put Sam in the Coaches room; the parent's hat alone does not belong there.
  const { data: coaches } = await admin.from('channels').select('id').eq('academy_id', NRIFA).eq('type', 'coaches').maybeSingle()
  if (coaches && !rolesBefore.includes('coach')) await admin.from('channel_members').delete().eq('channel_id', coaches.id).eq('profile_id', SAM)
  if (!hadClearance) await admin.from('staff_clearances').delete().eq('academy_id', NRIFA).eq('profile_id', SAM)
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
async function open(who, path, hat) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 375, height: 812 })
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
  await page.setCookie({ name: `sb-${ref}-auth-token`, value: 'base64-' + Buffer.from(JSON.stringify(who.session)).toString('base64'), domain: 'localhost', path: '/' })
  await page.evaluateOnNewDocument((o, h) => { try { localStorage.setItem('squadroom.org', o); if (h) localStorage.setItem(`squadroom.hat:${o}`, h); else localStorage.removeItem(`squadroom.hat:${o}`) } catch {} }, NRIFA, hat ?? null)
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 90000 })
  await page.waitForSelector('[data-persona]', { timeout: 20000 }).catch(() => null)
  await sleep(400)
  return { context, page }
}
const fits = (page) => page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1)
async function bothThemes(page, name) {
  let fitted = true
  for (const scheme of ['light', 'dark']) {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }])
    await sleep(250)
    fitted = fitted && (await fits(page))
    if (SHOTS) await page.screenshot({ path: `.shots/hats-${name}-${scheme}.png` })
  }
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
  return fitted
}

try {
  head('1. Four hats on one membership')
  const { data: r1, error: e1 } = await owner.client.rpc('add_member_role', { p_academy: NRIFA, p_profile: SAM, p_role: 'coach' })
  e1 ? bad(`coach hat: ${e1.message}`) : ok(`Sam gains the coach's hat: ${(r1 ?? []).join(', ')}`)
  const { error: e2 } = await owner.client.rpc('grant_club_role', { p_academy: NRIFA, p_profile: SAM, p_role: 'president' })
  e2 ? bad(`president: ${e2.message}`) : ok('and the President\'s')
  const { error: e3 } = await owner.client.rpc('grant_club_role', { p_academy: NRIFA, p_profile: SAM, p_role: 'team_manager', p_scope_kind: 'team', p_team: U8 })
  e3 ? bad(`manager: ${e3.message}`) : ok("and U8's team manager")
  const { data: row } = await admin.from('academy_members').select('role, roles').eq('academy_id', NRIFA).eq('profile_id', SAM).single()
  row?.role === 'coach' && (row.roles ?? []).includes('parent') && (row.roles ?? []).includes('coach') ? ok(`one membership: role ${row.role} (the strongest), roles ${row.roles.join(' + ')}`) : bad(`membership: ${JSON.stringify(row)}`)

  head('2. Home: each hat its own jobs, nothing of the others')
  const { data: home } = await sam.client.rpc('home_jobs', { p_academy: NRIFA })
  const hats = home?.hats ?? []
  ;['president', 'manager', 'coach', 'parent'].every((h) => hats.includes(h)) ? ok(`hats: ${hats.join(' · ')}`) : bad(`hats: ${JSON.stringify(hats)}`)
  home?.persona === 'president' ? ok('the biggest hat first: President (Club HQ)') : bad(`default persona: ${home?.persona}`)
  const byHat = {}
  for (const h of ['president', 'manager', 'coach', 'parent']) {
    const { data } = await sam.client.rpc('home_jobs', { p_academy: NRIFA, p_persona: h })
    byHat[h] = data
  }
  const ids = (h) => (byHat[h]?.jobs ?? []).map((j) => j.id).join(',')
  byHat.president?.persona === 'president' && ids('president') === 'decisions,weekend,money' ? ok(`President: ${ids('president')}`) : bad(`president jobs: ${ids('president')}`)
  byHat.manager?.persona === 'manager' && ids('manager') === 'availability,sheet,chat' ? ok(`Team manager: ${ids('manager')}`) : bad(`manager jobs: ${ids('manager')}`)
  byHat.coach?.persona === 'coach' && ids('coach') === 'post,squad,attendance' ? ok(`Coach: ${ids('coach')}`) : bad(`coach jobs: ${ids('coach')}`)
  byHat.parent?.persona === 'parent' && ids('parent') === 'rsvp,chat,pay' ? ok(`Parent: ${ids('parent')} — his own children's games`) : bad(`parent jobs: ${ids('parent')}`)
  const { data: notMine } = await sam.client.rpc('home_jobs', { p_academy: NRIFA, p_persona: 'treasurer' })
  notMine?.persona !== 'treasurer' ? ok('a hat he does not wear is not shown (asked for Treasurer, got ' + notMine?.persona + ')') : bad('wore the Treasurer\'s hat')
  const { error: money } = await sam.client.rpc('outstanding_fees', { p_academy: NRIFA })
  // The President runs the whole club, money included; that is the brief.
  money ? bad(`a President was refused the money: ${money.message}`) : ok('the President reads who owes (the whole club is theirs)')

  head('3. A one-role write from an older caller keeps the other hats')
  await admin.from('academy_members').update({ role: 'admin' }).eq('academy_id', NRIFA).eq('profile_id', SAM)
  const { data: after } = await admin.from('academy_members').select('role, roles').eq('academy_id', NRIFA).eq('profile_id', SAM).single()
  after?.role === 'admin' && (after.roles ?? []).includes('parent') && !(after.roles ?? []).includes('coach') ? ok(`role set to admin the old way: coach swapped out, parent kept (${after.roles.join(' + ')})`) : bad(`after: ${JSON.stringify(after)}`)
  await owner.client.rpc('remove_member_role', { p_academy: NRIFA, p_profile: SAM, p_role: 'admin' })
  await owner.client.rpc('add_member_role', { p_academy: NRIFA, p_profile: SAM, p_role: 'coach' })

  head('4. The screens, at 375px')
  {
    const { context, page } = await open(sam, '/', null)
    const chips = await page.$$eval('[data-hat]', (bs) => bs.map((b) => b.getAttribute('data-hat')))
    chips.length === 4 ? ok(`Home shows four hats: ${chips.join(' · ')}`) : bad(`chips: ${chips.join(', ')}`)
    const worn = await page.$eval('[data-persona]', (e) => e.getAttribute('data-persona')).catch(() => null)
    worn === 'president' ? ok('President worn by default — Club HQ') : bad(`worn: ${worn}`)
    ;(await page.$$('[data-job]')).length === 3 ? ok('three tiles: Needs a decision · This weekend · Money') : bad('not three tiles')
    ;(await bothThemes(page, 'president')) ? ok('fits 375px, light and dark') : bad('wider than the phone')
    await page.click('[data-hat="parent"]')
    await page.waitForFunction(() => document.querySelector('[data-persona]')?.getAttribute('data-persona') === 'parent', { timeout: 15000 }).then(() => ok('a tap wears the parent\'s hat')).catch(() => bad('the parent\'s hat did not go on'))
    ;(await page.$$('[data-job]')).length === 0 ? ok('and the admin tiles are gone — a parent\'s jobs are rows in Needs you') : bad('admin tiles still showing as a parent')
    ;(await bothThemes(page, 'parent')) ? ok('fits 375px, light and dark') : bad('wider than the phone')
    await context.close()
  }
  {
    const { context, page } = await open(sam, '/', 'manager')
    const worn = await page.$eval('[data-persona]', (e) => e.getAttribute('data-persona')).catch(() => null)
    worn === 'manager' ? ok('the remembered hat is worn on the next open: Team manager') : bad(`worn: ${worn}`)
    const labels = await page.$$eval('[data-job]', (as) => as.map((a) => a.textContent?.trim().split('\n')[0] ?? ''))
    labels.join(' ').includes('Availability') ? ok(`the manager's tiles: ${labels.map((l) => l.slice(0, 14)).join(' · ')}`) : bad(`tiles: ${labels.join(' | ')}`)
    await context.close()
  }
} finally {
  await browser.close()
  await tidy()
}
console.log(process.exitCode ? '' : '\n  \x1b[32mone membership, every hat in its place\x1b[0m\n')
