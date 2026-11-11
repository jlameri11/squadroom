// Run: node --env-file=.env.local scripts/test-bans.mjs
//   (needs the app running — npm run dev, or serve:test; SHOTS=1 saves the
//   Welfare screen's Bans section at 375px, light and dark, and the sheet)
//
// Part C item 2 (0257): the club bans a person for a period with a reason.
// On the NRIFA demo with a throwaway squad: Sam (a parent) answers a
// training and posts in the squad's chat; the Head bans him from the
// Welfare screen for a week; now his answer is refused ("no answer while
// banned until …"), the composer's gate says no and the table refuses the
// post, he reads his own ban and is told; a banned child is refused from
// the coach's lineup; a parent cannot ban; lifted with a note from the same
// screen, Sam answers again and is told he is welcome back; the log has
// every step. The demo is left as it was found.
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
const head = (m) => console.log(`\n${m}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
if (SHOTS) mkdirSync('.shots', { recursive: true })

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const TEAM = 'Zz Bans U12'
const started = new Date().toISOString()

async function cleanup() {
  await admin.from('bans').delete().eq('academy_id', NRIFA).gte('issued_at', started)
  await admin.from('notification_queue').delete().eq('academy_id', NRIFA).eq('kind', 'ban').gte('created_at', started)
  await admin.from('activity_log').delete().eq('academy_id', NRIFA).in('action', ['ban.issued', 'ban.lifted']).gte('at', started)
  const { data: teams } = await admin.from('teams').select('id').eq('academy_id', NRIFA).eq('name', TEAM)
  for (const t of teams ?? []) {
    await admin.from('messages').delete().eq('academy_id', NRIFA).like('body', 'Zz bans %')
    await admin.from('events').delete().eq('team_id', t.id)
    await admin.from('teams').delete().eq('id', t.id)
  }
  await admin.from('players').delete().eq('academy_id', NRIFA).like('full_name', 'Zz Bans %')
}
await cleanup()

const headOf = await signInBoth(admin, 'head@squadroom-demo.test') // NRIFA's owner
const sam = await signInBoth(admin, 'p61400000011@squadroom.invalid') // a parent
if (!headOf || !sam) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  await cleanup()
  process.exit(2)
}
const samId = sam.session.user.id

// A squad with Sam's child on it and Sam in it; a training to answer and a
// game to pick a side for (the Head picks it: the staff may, and a coach's
// squad row needs a check the demo's Marcus does not have).
const { data: team } = await admin.from('teams').insert({ academy_id: NRIFA, name: TEAM, age_group: 'U12', season: '2026', status: 'active' }).select('id').single()
const { data: kid } = await admin.from('players').insert({ academy_id: NRIFA, team_id: team.id, full_name: 'Zz Bans Kid', dob: '2014-06-06' }).select('id').single()
await admin.from('player_guardians').insert({ academy_id: NRIFA, player_id: kid.id, profile_id: samId, relationship: 'parent' })
// 0098 already put Sam on the squad with his child; this only makes sure.
const { error: tmErr } = await admin.from('team_members').upsert({ academy_id: NRIFA, team_id: team.id, profile_id: samId, role: 'parent' }, { onConflict: 'team_id,profile_id', ignoreDuplicates: true })
if (tmErr) { console.log(`  could not put Sam on the squad: ${tmErr.message}`); await cleanup(); process.exit(1) }
const { data: training } = await admin.from('events').insert({ academy_id: NRIFA, team_id: team.id, type: 'training', title: 'Zz Bans training', starts_at: new Date(Date.now() + 2 * 864e5).toISOString(), ends_at: new Date(Date.now() + 2 * 864e5 + 3600e3).toISOString(), source: 'manual' }).select('id').single()
const { data: game } = await admin.from('events').insert({ academy_id: NRIFA, team_id: team.id, type: 'match', title: 'Zz Bans v Rovers', opponent: 'Zz Rovers', starts_at: new Date(Date.now() + 3 * 864e5).toISOString(), ends_at: new Date(Date.now() + 3 * 864e5 + 3600e3).toISOString(), venue: 'Zz Oval', source: 'manual' }).select('id').single()
const { data: chan } = await admin.from('channels').select('id').eq('team_id', team.id).eq('type', 'team').maybeSingle()
const until = new Date(Date.now() + 7 * 864e5)
const untilIso = until.toISOString().slice(0, 10)

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
async function open(who, path, scheme = 'light') {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 375, height: 812 })
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }])
  await page.setCookie({ name: `sb-${ref}-auth-token`, value: 'base64-' + Buffer.from(JSON.stringify(who.session)).toString('base64'), domain: 'localhost', path: '/' })
  await page.evaluateOnNewDocument((o) => { try { localStorage.setItem('squadroom.org', o) } catch {} }, NRIFA)
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 90000 })
  return { page, context }
}
const fits = (page) => page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1)

try {
  head('1. Before: Sam answers and posts')
  {
    const { error: r } = await sam.client.from('event_rsvps').insert({ academy_id: NRIFA, event_id: training.id, profile_id: samId, status: 'yes' })
    r ? bad(`RSVP before the ban: ${r.message}`) : ok('Sam says yes to Thursday')
    if (chan) {
      const { error: m } = await sam.client.from('messages').insert({ academy_id: NRIFA, channel_id: chan.id, sender_id: samId, body: 'Zz bans — see you Thursday' })
      m ? bad(`post before the ban: ${m.message}`) : ok('and posts in the squad\'s chat')
    } else console.log('  (the squad has no chat to try)')
    const { error: pe } = await sam.client.rpc('ban_person', { p_academy: NRIFA, p_reason: 'Zz parent banning', p_profile: headOf.session.user.id })
    pe ? ok('a parent cannot ban anyone') : bad('a parent banned the coach')
  }

  head('2. The Head bans Sam from the Welfare screen')
  let banId = null
  {
    const { page, context } = await open(headOf, '/admin/safeguarding')
    try {
      await page.waitForSelector('[data-ban-open]', { timeout: 30000 })
      ;(await fits(page)) ? ok('Welfare fits 375px with the Bans section') : bad('Welfare is wider than the phone')
      await page.click('[data-ban-open]')
      await page.waitForSelector('[data-ban-member]', { timeout: 15000 })
      await page.waitForFunction(() => document.querySelectorAll('[data-ban-member] option').length > 1, { timeout: 20000 })
      await page.select('[data-ban-member]', samId)
      await page.type('[data-ban-reason]', 'Zz: abuse of the referee at the U12s on Saturday')
      // React listens to the native setter, not a plain `el.value =`.
      await page.$eval('[data-ban-until]', (el, v) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }, untilIso)
      await page.type('[data-ban-note]', 'Zz: second warning this season')
      if (SHOTS) await page.screenshot({ path: '.shots/bans-sheet-light.png', fullPage: true })
      await page.click('[data-ban-send]')
      await page.waitForSelector('[data-ban][data-ban-kind="member"]', { timeout: 20000 })
      const text = await page.$eval('[data-bans]', (el) => el.innerText.replace(/\s+/g, ' '))
      const listed = /until \d+ \w+/.test(text) && text.includes('abuse of the referee')
      listed ? ok('the list: Sam, until next week, with the reason') : bad(`list: ${text.slice(0, 160)}`)
      if (SHOTS) await page.screenshot({ path: '.shots/bans-welfare-light.png', fullPage: true })
    } catch (e) {
      bad(`the Welfare screen: ${String(e.message).slice(0, 100)}`)
    }
    await context.close()
    const { data } = await admin.from('bans').select('id, ends_on, profile_id').eq('academy_id', NRIFA).eq('profile_id', samId).is('lifted_at', null).maybeSingle()
    banId = data?.id ?? null
    data && data.ends_on === untilIso ? ok(`a ban row, until ${data.ends_on}`) : bad(`ban row: ${JSON.stringify(data)}`)
    const { page: dark, context: c2 } = await open(headOf, '/admin/safeguarding', 'dark')
    await dark.waitForSelector('[data-bans]', { timeout: 30000 }).catch(() => {})
    ;(await fits(dark)) ? ok('Welfare fits 375px in dark') : bad('Welfare (dark) is wider than the phone')
    if (SHOTS) await dark.screenshot({ path: '.shots/bans-welfare-dark.png', fullPage: true })
    await c2.close()
  }

  head('3. While it runs: no answer, no post; Sam reads why')
  {
    const { error: r } = await sam.client.from('event_rsvps').update({ status: 'no' }).eq('event_id', training.id).eq('profile_id', samId)
    r && /no answer while banned until/.test(r.message) ? ok(`his answer is refused: "${r.message.slice(0, 70)}"`) : bad(`RSVP while banned: ${r?.message ?? 'went through'}`)
    const { error: r2 } = await sam.client.from('event_rsvps').insert({ academy_id: NRIFA, event_id: game.id, profile_id: samId, status: 'yes' })
    r2 ? ok('a new answer is refused too') : bad('a banned parent answered the game')
    if (chan) {
      const { data: can } = await sam.client.rpc('can_post_in_channel', { p_channel: chan.id })
      can === false ? ok('the composer\'s gate says no') : bad(`can_post_in_channel: ${can}`)
      const { error: m } = await sam.client.from('messages').insert({ academy_id: NRIFA, channel_id: chan.id, sender_id: samId, body: 'Zz bans — a banned post' })
      m && /no posting while banned/.test(m.message) ? ok('and the table refuses the post') : bad(`post while banned: ${m?.message ?? 'went through'}`)
    }
    const { data: mine } = await sam.client.from('bans').select('reason, ends_on').eq('academy_id', NRIFA)
    ;(mine ?? []).length === 1 && mine[0].reason.includes('abuse of the referee') ? ok('Sam reads his own ban and the reason') : bad(`Sam's view: ${JSON.stringify(mine)}`)
    const { data: told } = await admin.from('notification_queue').select('title, body').eq('profile_id', samId).eq('kind', 'ban').gte('created_at', started)
    ;(told ?? []).some((t) => /cannot take part/.test(t.title)) ? ok(`told: "${told[0].title}"`) : bad(`told: ${JSON.stringify(told)}`)
    const { data: list } = await sam.client.rpc('bans_list', { p_academy: NRIFA })
    list == null ? ok('and has no list of anyone else\'s') : bad('a parent read the bans list')
  }

  head('4. A banned child is refused from the lineup')
  {
    const { data: pid, error } = await headOf.client.rpc('ban_person', { p_academy: NRIFA, p_reason: 'Zz: a player ban', p_player: kid.id, p_ends_on: untilIso })
    error ? bad(`ban the player: ${error.message}`) : ok('the Head bans the child for a week')
    const { error: le } = await headOf.client.rpc('set_lineup', { p_event: game.id, p_players: [{ player_id: kid.id }], p_formation: null, p_note: null })
    le && /is banned/.test(le.message) ? ok(`the side cannot be picked with them: "${le.message.slice(0, 60)}"`) : bad(`lineup with a banned child: ${le?.message ?? 'went through'}`)
    const { data: guardianTold } = await admin.from('notification_queue').select('title').eq('profile_id', samId).eq('kind', 'ban').gte('created_at', started)
    ;(guardianTold ?? []).some((t) => t.title.startsWith('Zz Bans Kid')) ? ok('the child\'s parent is told') : bad(`guardian told: ${JSON.stringify(guardianTold)}`)
    if (pid) await headOf.client.rpc('lift_ban', { p_ban: pid, p_note: 'Zz: a word with the family' })
  }

  head('5. Lifted from the screen; Sam answers again')
  {
    const { page, context } = await open(headOf, '/admin/safeguarding')
    try {
      await page.waitForSelector(`[data-lift-open="${banId}"]`, { timeout: 30000 })
      await page.click(`[data-lift-open="${banId}"]`)
      await page.waitForSelector('[data-lift-note]', { timeout: 10000 })
      await page.type('[data-lift-note]', 'Zz: apology accepted')
      await page.click(`[data-lift-ban="${banId}"]`)
      await page.waitForFunction((id) => !document.querySelector(`[data-ban="${id}"]`), { timeout: 20000 }, banId)
      ok('lifted from the Welfare screen, with a note')
    } catch (e) {
      bad(`lifting on screen: ${String(e.message).slice(0, 100)}`)
    }
    await context.close()
    const { error: r } = await sam.client.from('event_rsvps').update({ status: 'maybe' }).eq('event_id', training.id).eq('profile_id', samId)
    r ? bad(`RSVP after the lift: ${r.message}`) : ok('Sam answers Thursday again')
    const { data: back } = await admin.from('notification_queue').select('title, body').eq('profile_id', samId).eq('kind', 'ban').gte('created_at', started)
    ;(back ?? []).some((t) => /welcome back/.test(t.title) && /apology accepted/.test(t.body)) ? ok('and is told he is welcome back, with the note') : bad(`told on lift: ${JSON.stringify(back)}`)
    const { data: log } = await headOf.client.from('activity_log').select('action, subject_name').eq('academy_id', NRIFA).in('action', ['ban.issued', 'ban.lifted']).gte('at', started)
    const n = (a) => (log ?? []).filter((r) => r.action === a).length
    n('ban.issued') === 2 && n('ban.lifted') === 2 ? ok('the log: two bans issued, two lifted, each with the name') : bad(`log: ${JSON.stringify(log)}`)
  }
} catch (e) {
  bad(`threw: ${e.message}`)
} finally {
  await browser.close()
  await cleanup()
  const { count: t } = await admin.from('teams').select('id', { count: 'exact', head: true }).eq('academy_id', NRIFA).eq('name', TEAM)
  const { count: b } = await admin.from('bans').select('id', { count: 'exact', head: true }).eq('academy_id', NRIFA).gte('issued_at', started)
  t === 0 && b === 0 ? ok('the demo is as it was') : bad(`left behind: ${t} squads, ${b} bans`)
}
console.log(process.exitCode ? '' : '\n  \x1b[32mbans: no answer, no post, no team sheet while it runs; lifted with a note\x1b[0m\n')
