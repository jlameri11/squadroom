// Run: node --env-file=.env.local scripts/test-getting-live.mjs
//   (needs the app running — npm run dev, or serve:test; SHOTS=1 saves
//   screenshots to .shots/)
//
// Getting live (Big Club Mode item 5; 0247). A whole club's roster in one
// file: a squad per row, 1,200 rows in chunks on one batch, and an undo that
// removes exactly what the import added — never a child a family has since
// claimed. The setup steps the brief names (a manager per squad, grounds,
// invite families; streams and committee roles in club mode). Club health in
// one card for the committee, and for nobody else.
//
// The demo is left as found: two throwaway squads, the players the imports
// made (removed by the undo), the batches and their log lines are all
// removed at the end.
import { createClient } from '@supabase/supabase-js'
import puppeteer from 'puppeteer-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
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
mkdirSync('.shots', { recursive: true })

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const RAVENS = '00000000-0000-0000-0000-0000000a0002'
const MARCUS = '00000000-0000-0000-0000-0000000000a2'
const TEAM_A = 'Zz Import A'
const TEAM_B = 'Zz Import B'
const NAME = (i) => `Zz Import ${String(i).padStart(4, '0')}`

const batches = []
let teamA = null
let teamB = null
let guardianPlayer = null

async function cleanup() {
  if (guardianPlayer) await admin.from('player_guardians').delete().eq('player_id', guardianPlayer)
  await admin.from('players').delete().eq('academy_id', NRIFA).like('full_name', 'Zz Import %')
  await admin.from('teams').delete().eq('academy_id', NRIFA).in('name', [TEAM_A, TEAM_B])
  const { data: left } = await admin.from('import_batches').select('id').eq('academy_id', NRIFA).or(`id.in.(${batches.join(',') || '00000000-0000-0000-0000-000000000000'}),file_name.eq.getting-live.csv`)
  const ids = (left ?? []).map((b) => b.id)
  if (ids.length) {
    await admin.from('activity_log').delete().in('subject_id', ids)
    await admin.from('import_batches').delete().in('id', ids)
  }
}
await cleanup()

const headOf = await signInBoth(admin, 'head@squadroom-demo.test') // NRIFA's owner
const sam = await signInBoth(admin, 'p61400000011@squadroom.invalid') // a parent at NRIFA
const { data: marcusProfile } = await admin.from('profiles').select('phone').eq('id', MARCUS).single()
const marcus = marcusProfile?.phone ? await signInBoth(admin, `p${String(marcusProfile.phone).replace('+', '')}@squadroom.invalid`) : null
if (!headOf || !sam) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}

// Two squads nobody coaches.
for (const name of [TEAM_A, TEAM_B]) {
  const { data, error } = await admin.from('teams').insert({ academy_id: NRIFA, name, age_group: 'U12', season: '2026', status: 'active' }).select('id').single()
  if (error) { bad(`could not make ${name}: ${error.message}`); await cleanup(); process.exit(1) }
  if (name === TEAM_A) teamA = data.id
  else teamB = data.id
}
const { data: ravensTeam } = await admin.from('teams').select('id').eq('academy_id', RAVENS).limit(1).maybeSingle()

const rows = (from, to) => {
  const out = []
  for (let i = from; i < to; i++) {
    out.push({ full_name: NAME(i), dob: `2014-0${1 + (i % 9)}-1${i % 9}`, gender: i % 2 ? 'male' : 'female', team_id: i % 2 ? teamA : teamB })
  }
  return out
}

try {
  head('1. 1,200 rows, three calls, one batch, a squad per row')
  {
    const { data: batchId, error } = await headOf.client.rpc('start_import_batch', { p_academy: NRIFA, p_kind: 'players', p_file: 'whole-club.xlsx' })
    if (error || !batchId) { bad(`start: ${error?.message}`); throw new Error('no batch') }
    batches.push(batchId)
    ok(`a batch starts: ${batchId.slice(0, 8)}…`)
    let created = 0, matched = 0, problems = 0
    const t0 = Date.now()
    for (let at = 0; at < 1200; at += 400) {
      const { data, error: e } = await headOf.client.rpc('import_players', { p_academy: NRIFA, p_team: null, p_rows: rows(at, at + 400), p_season: null, p_batch: batchId })
      if (e) { bad(`chunk at ${at}: ${e.message}`); break }
      created += data.created; matched += data.matched; problems += (data.problems ?? []).length
    }
    created === 1200 && matched === 0 && problems === 0
      ? ok(`1,200 created, none matched, no problems, in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
      : bad(`created ${created}, matched ${matched}, problems ${problems}`)
    const { count: inA } = await admin.from('players').select('id', { count: 'exact', head: true }).eq('team_id', teamA).eq('import_batch_id', batchId)
    const { count: inB } = await admin.from('players').select('id', { count: 'exact', head: true }).eq('team_id', teamB).eq('import_batch_id', batchId)
    inA === 600 && inB === 600 ? ok('600 in each squad, each stamped with the batch') : bad(`A ${inA}, B ${inB}`)
    const { data: b } = await headOf.client.from('import_batches').select('rows_sent, created_players, matched_players, undone_at').eq('id', batchId).maybeSingle()
    b && b.rows_sent === 1200 && b.created_players === 1200 && !b.undone_at ? ok('the batch counts 1,200 sent, 1,200 created') : bad(`batch: ${JSON.stringify(b)}`)

    // The same rows again: matched, not doubled. A squad from another club: a problem, not a player.
    const { data: again, error: e2 } = await headOf.client.rpc('start_import_batch', { p_academy: NRIFA, p_kind: 'players', p_file: 'again.xlsx' })
    if (!e2 && again) batches.push(again)
    const stray = ravensTeam ? [{ full_name: 'Zz Import Stray', dob: '2014-02-02', team_id: ravensTeam.id }] : []
    const { data: r2, error: e3 } = await headOf.client.rpc('import_players', { p_academy: NRIFA, p_team: null, p_rows: [...rows(0, 10), ...stray], p_season: null, p_batch: again })
    !e3 && r2.created === 0 && r2.matched === 10 ? ok('the same ten rows again: ten matched, none added') : bad(`again: ${e3?.message ?? JSON.stringify(r2).slice(0, 160)}`)
    if (ravensTeam) {
      ;(r2?.problems ?? []).some((p) => /not in this club/.test(p.problem)) ? ok("a row naming another club's squad is a problem on that row") : bad(`stray: ${JSON.stringify(r2?.problems)}`)
    }
    const { count: total } = await admin.from('players').select('id', { count: 'exact', head: true }).eq('academy_id', NRIFA).like('full_name', 'Zz Import %')
    total === 1200 ? ok('still 1,200 players') : bad(`${total} players`)
    const { data: u2 } = await headOf.client.rpc('undo_import_batch', { p_batch: again })
    u2?.removed === 0 ? ok('undoing the second batch removes nothing — it added nothing') : bad(`undo 2: ${JSON.stringify(u2)}`)
  }

  head('2. Club health, while two squads have nobody in front of them')
  let clubMode = false
  {
    const { data: h, error } = await headOf.client.rpc('club_health', { p_academy: NRIFA })
    if (error || !h) bad(`health: ${error?.message ?? 'null'}`)
    else {
      ok(`families: ${h.families.with_family} of ${h.families.players} players (${h.families.pct}%)`)
      const names = (h.teams_without_manager ?? []).map((t) => t.name)
      names.includes(TEAM_A) && names.includes(TEAM_B) ? ok(`squads with nobody in front: ${names.length}, the two throwaways among them`) : bad(`nobody: ${JSON.stringify(names)}`)
      const worst = h.families.teams[0]
      worst && worst.pct === 0 && worst.name.startsWith('Zz Import') ? ok(`worst squad first: ${worst.name}, ${worst.with_family} of ${worst.players}`) : bad(`worst: ${JSON.stringify(worst)}`)
      ;['missing', 'expired', 'expiring', 'barred', 'people'].every((k) => typeof h.checks?.[k] === 'number') ? ok(`checks: ${h.checks.missing} missing, ${h.checks.expiring} expiring, ${h.checks.expired} expired of ${h.checks.people}`) : bad(`checks: ${JSON.stringify(h.checks)}`)
      typeof h.playfootball_not_done === 'number' ? ok(`PlayFootball not done: ${h.playfootball_not_done}`) : bad('no PlayFootball count')
      h.setup && typeof h.setup.total === 'number' ? ok(`setup: ${h.setup.done} of ${h.setup.total}`) : bad(`setup: ${JSON.stringify(h.setup)}`)
    }
    const { data: ph } = await sam.client.rpc('club_health', { p_academy: NRIFA })
    ph === null ? ok('a parent gets nothing') : bad(`a parent read: ${JSON.stringify(ph).slice(0, 100)}`)
    if (marcus) {
      const { data: ch } = await marcus.client.rpc('club_health', { p_academy: NRIFA })
      ch === null ? ok('a coach who is not staff gets nothing') : bad(`a coach read: ${JSON.stringify(ch).slice(0, 100)}`)
    } else note('Marcus could not sign in; the coach check is skipped')

    const { data: setup } = await headOf.client.rpc('setup_progress', { p_academy: NRIFA })
    const ids = (setup?.steps ?? []).map((s) => s.id)
    const { data: acad } = await admin.from('academies').select('club_mode').eq('id', NRIFA).single()
    clubMode = Boolean(acad?.club_mode)
    ;['managers', 'grounds', 'families'].every((k) => ids.includes(k)) ? ok(`the setup steps: ${ids.join(', ')}`) : bad(`steps: ${ids.join(', ')}`)
    const managers = (setup?.steps ?? []).find((s) => s.id === 'managers')
    managers && !managers.done && /2 of \d+ squads with nobody yet|of \d+ squads/.test(managers.detail) ? ok(`"${managers.label}": ${managers.detail}`) : bad(`managers step: ${JSON.stringify(managers)}`)
    if (clubMode) {
      ids.includes('streams') && ids.includes('committee') ? ok('club mode adds streams and committee roles') : bad('club mode steps missing')
    } else {
      !ids.includes('streams') && !ids.includes('committee') ? ok('not in club mode: no streams or committee step') : bad('club-mode steps shown outside club mode')
    }
  }

  head('3. Undo keeps a child a family has since claimed, and removes the rest')
  {
    const { data: one } = await admin.from('players').select('id, full_name').eq('team_id', teamA).like('full_name', 'Zz Import %').limit(1).single()
    const { data: samProfile } = await admin.from('academy_members').select('profile_id').eq('academy_id', NRIFA).eq('role', 'parent').eq('status', 'active').limit(1).single()
    await admin.from('player_guardians').insert({ academy_id: NRIFA, player_id: one.id, profile_id: samProfile.profile_id, relationship: 'parent' })
    guardianPlayer = one.id
    const { data: u, error } = await headOf.client.rpc('undo_import_batch', { p_batch: batches[0] })
    !error && u.removed === 1199 && u.kept === 1 && u.kept_names.includes(one.full_name)
      ? ok(`undo: ${u.removed} removed, ${u.kept} kept — ${u.kept_names[0]}, who now has a family`)
      : bad(`undo: ${error?.message ?? JSON.stringify(u).slice(0, 160)}`)
    const { count: left } = await admin.from('players').select('id', { count: 'exact', head: true }).eq('import_batch_id', batches[0])
    left === 1 ? ok('one player still carries the batch; 1,199 are gone') : bad(`${left} left`)
    const { data: b } = await headOf.client.from('import_batches').select('undone_at, removed_players').eq('id', batches[0]).single()
    b?.undone_at && b.removed_players === 1199 ? ok('the batch says undone, 1,199 removed') : bad(`batch: ${JSON.stringify(b)}`)
    const { error: twice } = await headOf.client.rpc('undo_import_batch', { p_batch: batches[0] })
    twice && /already undone/.test(twice.message) ? ok('undoing it again is refused') : bad(`twice: ${twice?.message ?? 'allowed'}`)
    const { error: parentUndo } = await sam.client.rpc('undo_import_batch', { p_batch: batches[1] })
    parentUndo ? ok('a parent cannot undo an import') : bad('a parent undid an import')
    // Back to how it was: the kept child and the link go.
    await admin.from('player_guardians').delete().eq('player_id', one.id)
    await admin.from('players').delete().eq('id', one.id)
    guardianPlayer = null
  }

  head('4. The screens, at 375px')
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
  async function open(who, path, waitFor) {
    const context = await browser.createBrowserContext()
    const page = await context.newPage()
    await page.setViewport({ width: 375, height: 812 })
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
    await page.setCookie({ name: `sb-${ref}-auth-token`, value: 'base64-' + Buffer.from(JSON.stringify(who.session)).toString('base64'), domain: 'localhost', path: '/' })
    await page.evaluateOnNewDocument((o) => { try { localStorage.setItem('squadroom.org', o) } catch {} }, NRIFA)
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 90000 })
    if (waitFor) await page.waitForSelector(waitFor, { timeout: 30000 }).catch(() => null)
    await sleep(300)
    return { context, page }
  }
  async function shots(page, name) {
    for (const scheme of ['light', 'dark']) {
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }])
      await sleep(150)
      if (SHOTS) await page.screenshot({ path: `.shots/live-${name}-${scheme}.png`, fullPage: true })
    }
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
    const fits = await page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1)
    fits ? ok(`${name}: fits 375px, light and dark`) : bad(`${name}: wider than the phone`)
  }
  try {
    {
      const { context, page } = await open(headOf, '/admin/health', '[data-club-health]')
      const text = await page.$eval('[data-club-health]', (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => '')
      ;/Families in the app/i.test(text) && /PlayFootball/i.test(text) && /Working With Children/i.test(text) ? ok('Club health: families, checks, PlayFootball') : bad(`health screen: ${text.slice(0, 200) || 'missing'}`)
      const nobody = await page.$eval('[data-health-managers]', (e) => e.innerText).catch(() => '')
      nobody.includes(TEAM_A) ? ok('the two throwaway squads are listed with nobody in front of them') : bad(`nobody section: ${nobody.slice(0, 160)}`)
      await shots(page, 'health')
      await context.close()
    }
    {
      const { context, page } = await open(headOf, '/admin', 'a[href="/admin/health"]')
      const row = await page.$('a[href="/admin/health"]')
      row ? ok('the Admin hub has a Club health row') : bad('no Club health row on the hub')
      await context.close()
    }
    {
      const { context, page } = await open(headOf, '/start/setup', '[data-step="families"]')
      const steps = await page.$$eval('[data-step]', (es) => es.map((e) => e.getAttribute('data-step')))
      ;['managers', 'grounds', 'families'].every((k) => steps.includes(k)) ? ok(`the setup checklist: ${steps.join(', ')}`) : bad(`checklist steps: ${steps.join(', ')}`)
      await shots(page, 'setup')
      await context.close()
    }
    {
      // A small file through the real screen: a Squad column, two squads and
      // one that does not exist, import, then undo.
      const csv = ['Player Name,Date of Birth,Squad']
      for (let i = 0; i < 12; i++) csv.push(`${NAME(9000 + i)},1${i % 9}/0${1 + (i % 9)}/2014,${i < 5 ? TEAM_A : i < 10 ? TEAM_B : 'Nowhere FC'}`)
      const file = resolve('.shots/getting-live.csv')
      writeFileSync(file, csv.join('\n') + '\n')
      const { context, page } = await open(headOf, '/admin/import/players', '[data-import-file]')
      const input = await page.$('[data-import-file]')
      await input.uploadFile(file)
      await page.waitForSelector('[data-map="team"]', { timeout: 30000 }).catch(() => null)
      const mapped = await page.$eval('[data-map="team"]', (e) => e.value).catch(() => '')
      mapped === 'Squad' ? ok('the Squad column is suggested for the squad') : bad(`squad mapped to "${mapped}"`)
      const preview = await page.$eval('[data-import-preview]', (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => '')
      preview.includes('no squad called "Nowhere FC"') ? ok('a squad that does not exist is a problem on its rows') : bad(`preview: ${preview.slice(0, 200)}`)
      preview.includes(TEAM_A) ? ok('the preview names the squad each row goes to') : bad(`preview names: ${preview.slice(0, 200)}`)
      const go = await page.$eval('[data-import-go]', (e) => e.textContent.trim()).catch(() => '')
      go === 'Import 10 players' ? ok(`the button: "${go}"`) : bad(`button: "${go}"`)
      if (SHOTS) await page.screenshot({ path: '.shots/live-import-preview-light.png', fullPage: true })
      await page.click('[data-import-go]')
      await page.waitForSelector('[data-import-result]', { timeout: 60000 }).catch(() => null)
      const result = await page.$eval('[data-import-result]', (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => '')
      result.includes('10 added') ? ok('ten added through the screen') : bad(`result: ${result.slice(0, 200) || 'missing'}`)
      const { count: made } = await admin.from('players').select('id', { count: 'exact', head: true }).eq('academy_id', NRIFA).like('full_name', 'Zz Import 9%')
      made === 10 ? ok('ten players on the roster, in their two squads') : bad(`${made} players`)
      await page.click('[data-import-undo]')
      await page.waitForSelector('[data-import-undone]', { timeout: 30000 }).catch(() => null)
      const undone = await page.$eval('[data-import-undone]', (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => '')
      undone.includes('10 players removed') ? ok('Undo this import: ten removed') : bad(`undone: ${undone.slice(0, 160) || 'missing'}`)
      const { count: after } = await admin.from('players').select('id', { count: 'exact', head: true }).eq('academy_id', NRIFA).like('full_name', 'Zz Import 9%')
      after === 0 ? ok('and the roster is as it was') : bad(`${after} players left`)
      await shots(page, 'import-undone')
      await context.close()
    }
  } finally {
    await browser.close()
  }
} finally {
  await cleanup()
  const { count: players } = await admin.from('players').select('id', { count: 'exact', head: true }).eq('academy_id', NRIFA).like('full_name', 'Zz Import %')
  const { count: teams } = await admin.from('teams').select('id', { count: 'exact', head: true }).eq('academy_id', NRIFA).in('name', [TEAM_A, TEAM_B])
  players === 0 && teams === 0 ? ok('the demo is as it was: no throwaway squads or players left') : bad(`left behind: ${players} players, ${teams} squads`)
}
console.log(process.exitCode ? '' : '\n  \x1b[32mgetting live: a whole club in one file, undo that keeps what families claimed, club health for the committee\x1b[0m\n')
