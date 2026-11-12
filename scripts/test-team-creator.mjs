// Run: node --env-file=.env.local scripts/test-team-creator.mjs
//   (needs the app running — npm run dev, or serve:test; SHOTS=1 saves the
//   enter form, the organiser's list, the join page and the team's page at
//   375px, light and dark)
//
// Part C item 3 (0261): Team Creator. A throwaway published league run by
// the SPL, open to entries, with a $240 fee: from the public enter page a
// captain ticks "I'm a captain", eight players, split the fee; the SPL's
// organiser accepts it on the Clubs tab and the code appears with a link to
// copy; the captain opens the link, joins with her mobile (the one on the
// request) and is the captain — on the SPL's books as a player, on the
// squad, the team's manager, with $30 to pay in the app; a teammate joins
// by the code; a child is refused; the team's page shows the code; the
// switch off hides the tick and refuses the door. Everything made here is
// deleted — the league, the team, the two new accounts.
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

const SPL = '00000000-0000-0000-0000-0000000a0003'
const OWNER = '00000000-0000-0000-0000-0000000000a1'
const TAG = 'TEAMCREATOR'
const SLUG = 'teamcreator-sixes'
const CAPTAIN_PHONE = '+61400008811'
const MATE_PHONE = '+61400008822'
const emailOf = async (id) => (await admin.auth.admin.getUserById(id)).data.user.email

async function cleanup() {
  const { data: comps } = await admin.from('competitions').select('id').like('name', `${TAG} %`)
  for (const c of comps ?? []) await admin.from('competitions').delete().eq('id', c.id)
  const { data: teams } = await admin.from('teams').select('id').eq('academy_id', SPL).like('name', `${TAG} %`)
  for (const t of teams ?? []) await admin.from('teams').delete().eq('id', t.id)
  await admin.from('payment_requests').delete().eq('academy_id', SPL).like('title', `${TAG} %`)
  // The captain and the mate become players of the organiser's team; deleting
  // the team leaves their roster rows behind (found by the demo guard, 12 Nov 2026).
  await admin.from('players').delete().eq('academy_id', SPL).in('full_name', ['Cass Captain', 'Mo Mate'])
  await admin.from('academy_features').delete().eq('academy_id', SPL).eq('feature', 'team_creator')
  const { data: users } = await listAllUsers(admin)
  for (const phone of [CAPTAIN_PHONE, MATE_PHONE]) {
    const u = users?.users?.find((x) => x.phone === phone.replace('+', ''))
    if (u) await admin.auth.admin.deleteUser(u.id)
  }
}
await cleanup()

const { data: comp } = await admin.from('competitions').insert({
  organiser_id: SPL, name: `${TAG} Sixes`, type: 'season', season: '2026', status: 'active', mode: 'managed', visibility: 'participants', created_by: OWNER,
  public_slug: SLUG, published_at: new Date().toISOString(), entries_open: true,
}).select('id').single()
await admin.from('competition_fees').insert({ competition_id: comp.id, division: '', fee_cents: 24000 })
// One division, so the public form offers it and the organiser's Accept has one to pick.
const { error: divErr } = await admin.from('competition_divisions').insert({ competition_id: comp.id, division: 'Open' })
if (divErr) { console.log(`  could not make the division: ${divErr.message}`); await cleanup(); process.exit(1) }
const owner = await signInClient(admin, await emailOf(OWNER))
if (!owner) { console.log("  could not sign in — the project's auth rate limit, not a failure"); await cleanup(); process.exit(2) }
const { data: ownerSession } = await owner.auth.getSession()
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
async function open(path, scheme = 'light', signedIn = false) {
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
const post = (path, body) => fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

let code = null, teamId = null, entryId = null
try {
  head('1. A captain asks to enter, from the public page')
  {
    const { page, context } = await open(`/c/${SLUG}/enter`)
    try {
      await page.waitForSelector('[data-enter-captain]', { timeout: 30000 })
      await page.click('[data-enter-captain]')
      await page.type('input[required]:not([type=tel]):not([type=email])', `${TAG} Dad Bods`)
      await page.$eval('[data-enter-squad-size]', (el) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '8'); el.dispatchEvent(new Event('input', { bubbles: true })) })
      await page.click('[data-enter-pay-mode="split"]')
      const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))
      ;/Split 8 ways, \$30\.00 each/.test(text) ? ok('the form works out the share: $30.00 each') : bad(`share line: ${text.slice(text.indexOf('Entry fee'), text.indexOf('Entry fee') + 90)}`)
      // The contact: name, mobile.
      const inputs = await page.$$('input[required]')
      await inputs[inputs.length - 1].type('Cass Captain')
      await page.type('input[type=tel]', '0400 008 811')
      ;(await fits(page)) ? ok('the enter page fits 375px with the captain\'s tick') : bad('the enter page is wider than the phone')
      if (SHOTS) await page.screenshot({ path: '.shots/team-creator-enter-light.png', fullPage: true })
      await page.click('button[type=submit]')
      await page.waitForFunction(() => /Sent\./.test(document.body.innerText), { timeout: 20000 })
      ok('sent — "the team\'s code to share" promised')
    } catch (e) {
      bad(`the enter page: ${String(e.message).slice(0, 100)}`)
    }
    await context.close()
    const { data: req } = await admin.from('competition_entry_requests').select('id, captain, squad_size, pay_mode, contact_phone, club_name').eq('competition_id', comp.id).maybeSingle()
    req?.captain && req.squad_size === 8 && req.pay_mode === 'split' && req.contact_phone === CAPTAIN_PHONE ? ok('the request: a captain\'s team, eight, split, her mobile') : bad(`request: ${JSON.stringify(req)}`)
  }

  head('2. The organiser accepts; the code and its link')
  {
    const { page, context } = await open(`/competitions/${comp.id}?tab=clubs`, 'light', true)
    try {
      await page.waitForSelector('[data-captain-request]', { timeout: 30000 })
      ok('the request reads "captain\'s team · 8 players · split the fee"')
      const accept = await page.waitForSelector('xpath/.//button[normalize-space()="Accept"]', { timeout: 15000 })
      await accept.click()
      await page.waitForSelector('[data-captain-team]', { timeout: 20000 })
      code = await page.$eval('[data-captain-team]', (el) => el.getAttribute('data-captain-team'))
      ;/^[A-Z2-9]{6}$/.test(code ?? '') ? ok(`accepted — the code ${code}, with a link to copy`) : bad(`code: ${code}`)
      ;(await fits(page)) ? ok('the Clubs tab fits 375px') : bad('the Clubs tab is wider than the phone')
      if (SHOTS) await page.screenshot({ path: '.shots/team-creator-organiser-light.png', fullPage: true })
    } catch (e) {
      bad(`the organiser's list: ${String(e.message).slice(0, 100)}`)
    }
    await context.close()
    const { data: entry } = await admin.from('competition_entries').select('id, team_id, join_code, pay_mode, squad_size, academy_id').eq('competition_id', comp.id).maybeSingle()
    teamId = entry?.team_id ?? null; entryId = entry?.id ?? null; code = code ?? entry?.join_code ?? null
    entry?.academy_id === SPL && entry.team_id && entry.join_code === code ? ok('a team in the SPL\'s own organisation, the entry with the code') : bad(`entry: ${JSON.stringify(entry)}`)
  }

  head('3. The captain joins by the link, with her mobile')
  let captainId = null
  {
    const { page, context } = await open(`/c/${SLUG}/team/${code}`)
    try {
      await page.waitForSelector('[data-join-team-name]', { timeout: 30000 })
      const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))
      ;/0 of 8 in/.test(text) && /\$30\.00/.test(text) ? ok('the door: "0 of 8 in", the $30.00 share') : bad(`door: ${text.slice(0, 160)}`)
      await page.type('[data-join-team-name]', 'Cass Captain')
      await page.type('[data-join-team-phone]', '0400 008 811')
      await page.type('[data-join-team-email]', 'cass-captain@squadroom.invalid')
      await page.$eval('[data-join-team-dob]', (el) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '1991-02-03'); el.dispatchEvent(new Event('input', { bubbles: true })) })
      ;(await fits(page)) ? ok('the join page fits 375px') : bad('the join page is wider than the phone')
      if (SHOTS) await page.screenshot({ path: '.shots/team-creator-join-light.png', fullPage: true })
      await page.click('[data-join-team-send]')
      await page.waitForSelector('[data-joined="captain"]', { timeout: 20000 })
      const shown = await page.$eval('[data-join-code]', (el) => el.innerText.trim())
      shown === code ? ok(`"You're the captain" — the code ${shown} to share`) : bad(`captain page: ${shown}`)
      if (SHOTS) await page.screenshot({ path: '.shots/team-creator-captain-light.png', fullPage: true })
    } catch (e) {
      bad(`the join page: ${String(e.message).slice(0, 100)}`)
    }
    await context.close()
    const { data: prof } = await admin.from('profiles').select('id').eq('phone', CAPTAIN_PHONE).maybeSingle()
    captainId = prof?.id ?? null
    const { data: m } = captainId ? await admin.from('academy_members').select('roles').eq('academy_id', SPL).eq('profile_id', captainId).maybeSingle() : { data: null }
    const { count: onTeam } = await admin.from('team_members').select('*', { count: 'exact', head: true }).eq('team_id', teamId).eq('profile_id', captainId ?? '00000000-0000-0000-0000-000000000000')
    const { count: squad } = await admin.from('entry_squads').select('*', { count: 'exact', head: true }).eq('entry_id', entryId)
    const { count: manager } = await admin.from('club_roles').select('*', { count: 'exact', head: true }).eq('academy_id', SPL).eq('profile_id', captainId ?? '00000000-0000-0000-0000-000000000000').eq('role', 'team_manager').eq('team_id', teamId)
    m?.roles?.includes('player') && onTeam === 1 && squad === 1 && manager === 1 ? ok('on the SPL\'s books as a player, on the squad and the season squad, the team\'s manager') : bad(`captain: roles ${JSON.stringify(m?.roles)}, team ${onTeam}, squad ${squad}, manager ${manager}`)
    const { data: pr } = await admin.from('payment_requests').select('amount_cents, per_player, team_id').eq('academy_id', SPL).eq('competition_id', comp.id).maybeSingle()
    pr?.amount_cents === 3000 && pr.per_player && pr.team_id === teamId ? ok('one fee per player on the team: $30.00') : bad(`payment request: ${JSON.stringify(pr)}`)
  }

  head('4. A teammate joins; a child is refused; the team\'s page shows the code')
  {
    const mate = await post('/api/competitions/join-team', { code, fullName: 'Mo Mate', phone: '0400 008 822', dob: '1988-07-07' })
    const body = await mate.json().catch(() => ({}))
    mate.ok && body.captain === false && body.members === 2 ? ok('Mo joins by the code — 2 of 8 in, not the captain') : bad(`mate: ${mate.status} ${JSON.stringify(body)}`)
    const kid = await post('/api/competitions/join-team', { code, fullName: 'Kid Mate', phone: '0400 008 833', dob: '2012-01-01' })
    const kbody = await kid.json().catch(() => ({}))
    !kid.ok && /adults/.test(kbody.error ?? '') ? ok('a child is refused: adults only') : bad(`child: ${kid.status} ${JSON.stringify(kbody)}`)
    const { data: page1 } = await admin.rpc('public_captain_team', { p_slug: SLUG, p_code: code })
    page1?.members === 2 && page1.has_captain ? ok('the door says 2 of 8, captain in') : bad(`door: ${JSON.stringify(page1)}`)
    const { page, context } = await open(`/admin/teams/${teamId}`, 'dark', true)
    try {
      await page.waitForSelector('[data-join-code-panel]', { timeout: 30000 })
      const shown = await page.$eval('[data-join-code-panel]', (el) => el.getAttribute('data-join-code-panel'))
      shown === code && (await fits(page)) ? ok(`the team's page carries the code (dark, 375px)`) : bad(`team page code: ${shown}`)
      if (SHOTS) await page.screenshot({ path: '.shots/team-creator-team-dark.png', fullPage: true })
    } catch (e) {
      bad(`the team's page: ${String(e.message).slice(0, 100)}`)
    }
    await context.close()
  }

  head('5. The switch off')
  {
    const { error } = await owner.rpc('set_feature', { p_academy: SPL, p_feature: 'team_creator', p_enabled: false })
    error ? bad(`switch: ${error.message}`) : ok('the SPL turns Team Creator off')
    const { page, context } = await open(`/c/${SLUG}/enter`)
    await page.waitForSelector('button[type=submit]', { timeout: 30000 }).catch(() => {})
    const tick = await page.$('[data-enter-captain]')
    tick ? bad('the captain\'s tick is still on the enter page') : ok('the enter page has no captain\'s tick')
    await context.close()
    const shut = await post('/api/competitions/join-team', { code, fullName: 'Late Mate', phone: '0400 008 844', dob: '1990-01-01' })
    shut.ok ? bad('the door opened with the switch off') : ok(`the door is shut (${shut.status})`)
    await owner.rpc('set_feature', { p_academy: SPL, p_feature: 'team_creator', p_enabled: true })
  }
} catch (e) {
  bad(`threw: ${e.message}`)
} finally {
  await browser.close()
  await cleanup()
  const { count } = await admin.from('competitions').select('id', { count: 'exact', head: true }).like('name', `${TAG} %`)
  const { count: t } = await admin.from('teams').select('id', { count: 'exact', head: true }).eq('academy_id', SPL).like('name', `${TAG} %`)
  count === 0 && t === 0 ? ok('everything made here is gone') : bad(`${count} leagues, ${t} teams left behind`)
}
console.log(process.exitCode ? '' : '\n  \x1b[32mTeam Creator: a captain\'s team, a code, the share, the organiser\'s yes\x1b[0m\n')
