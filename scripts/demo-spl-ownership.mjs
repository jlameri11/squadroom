// Run: node --env-file=.env.local scripts/demo-spl-ownership.mjs [--dry]
//
// The ownership fix (Joey, 16 Nov 2026): NRIFA and the Sydney Premier League
// are separate organisations with separate owners.
//   1. joeylameri@outlook.com owns NRIFA only. Joey's owner membership of the
//      SPL goes (and with it the SPL's own channels); NRIFA stays entered in
//      the SPL, so Joey still sees it as a club head — notices, the Clubs
//      chat, fixtures, results, ladders, fees owed — through NRIFA's entry
//      (competition_clubs, status active), never through league staff rights.
//   2. The SPL is owned by the League organiser demo account
//      (organiser@squadroom-demo.test) — the organiser organisation IS the
//      organiser group (0246) — with its own staff (SPL Admin stays).
//   3. Prints what changed and what Joey can still reach, so the check in the
//      brief is on the screen.
// Dev only (scripts/_project.mjs guards the project). Idempotent.
import { createClient } from '@supabase/supabase-js'
import { assertOurs } from './_project.mjs'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
assertOurs(URL_)
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const DRY = process.argv.includes('--dry')

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const SPL = '00000000-0000-0000-0000-0000000a0003'
const JOEY = '00000000-0000-0000-0000-0000000000a1'
const ORGANISER_EMAIL = 'organiser@squadroom-demo.test'

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const note = (m) => console.log(`  \x1b[2m… ${m}\x1b[0m`)
const bad = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }

const { data: spl } = await admin.from('academies').select('id, name, type, created_by').eq('id', SPL).maybeSingle()
if (!spl) { bad('no Sydney Premier League organisation'); process.exit(1) }
const { data: orgRows } = await admin.from('account_emails').select('profile_id').ilike('email', ORGANISER_EMAIL)
let organiser = orgRows?.[0]?.profile_id ?? null
if (!organiser) {
  // The account lives in auth; its email is mirrored in account_emails (0214). Fall back to the profile by name.
  const { data: p } = await admin.from('profiles').select('id').eq('full_name', 'League Organiser').maybeSingle()
  organiser = p?.id ?? null
}
if (!organiser) { bad(`no account for ${ORGANISER_EMAIL}`); process.exit(1) }

const memberships = async (profile) => {
  const { data } = await admin.from('academy_members').select('academy_id, role, roles, status, academies(name)').eq('profile_id', profile)
  return (data ?? []).map((m) => `${m.academies?.name ?? m.academy_id} (${m.role}, ${m.status})`)
}

console.log(`\nBefore: Joey — ${(await memberships(JOEY)).join('; ')}`)
console.log(`        organiser — ${(await memberships(organiser)).join('; ') || 'nothing'}`)

if (!DRY) {
  // 2. The organiser owns the SPL.
  const { data: has } = await admin.from('academy_members').select('role, status').eq('academy_id', SPL).eq('profile_id', organiser).maybeSingle()
  if (!has) {
    const { error } = await admin.from('academy_members').insert({ academy_id: SPL, profile_id: organiser, role: 'owner', roles: ['owner'], status: 'active', invited_by: null })
    error ? bad(`organiser as owner: ${error.message}`) : ok('the League organiser account owns the Sydney Premier League')
  } else if (has.role !== 'owner' || has.status !== 'active') {
    const { error } = await admin.from('academy_members').update({ role: 'owner', roles: ['owner'], status: 'active' }).eq('academy_id', SPL).eq('profile_id', organiser)
    error ? bad(`organiser as owner: ${error.message}`) : ok('the League organiser account now owns the Sydney Premier League')
  } else ok('the League organiser account already owns the Sydney Premier League')
  if (spl.created_by === JOEY) {
    const { error } = await admin.from('academies').update({ created_by: organiser }).eq('id', SPL)
    error ? note(`created_by left as it was: ${error.message}`) : ok('the SPL is recorded as the organiser\'s')
  }

  // 1. Joey is NRIFA's owner only: no owner or admin role at the SPL, no committee or league role, no seat in its own channels.
  const { data: splChannels } = await admin.from('channels').select('id, name').eq('academy_id', SPL)
  const ids = (splChannels ?? []).map((c) => c.id)
  if (ids.length) {
    const { error: e1 } = await admin.from('channel_members').delete().eq('profile_id', JOEY).in('channel_id', ids)
    e1 ? bad(`leaving the SPL's channels: ${e1.message}`) : ok(`Joey is out of the SPL's own channels (${(splChannels ?? []).map((c) => c.name).join(', ')})`)
  }
  await admin.from('club_roles').delete().eq('academy_id', SPL).eq('profile_id', JOEY)
  await admin.from('league_roles').delete().eq('academy_id', SPL).eq('profile_id', JOEY)
  const { error: e2 } = await admin.from('academy_members').delete().eq('academy_id', SPL).eq('profile_id', JOEY)
  e2 ? bad(`removing Joey's SPL membership: ${e2.message}`) : ok('Joey\'s owner membership of the SPL is removed')
}

// 3. What Joey can still reach: NRIFA's entry in the SPL's competitions.
const { data: comps } = await admin.from('competitions').select('id, name, season, status').eq('organiser_id', SPL)
for (const c of comps ?? []) {
  const { data: cc } = await admin.from('competition_clubs').select('status').eq('competition_id', c.id).eq('academy_id', NRIFA).maybeSingle()
  const { data: entries } = await admin.from('competition_entries').select('display_name, team_id').eq('competition_id', c.id).eq('academy_id', NRIFA)
  const entered = cc?.status === 'active' || (entries ?? []).length > 0
  ;(entered ? ok : note)(`${c.name} (${c.season}, ${c.status}): NRIFA ${cc ? `entered (${cc.status})` : 'has no club row'}, ${(entries ?? []).length} squads entered${(entries ?? []).length ? ` — ${(entries ?? []).map((e) => e.display_name).join(', ')}` : ''}`)
  if (!cc && (entries ?? []).length && !DRY) {
    const { error } = await admin.from('competition_clubs').insert({ competition_id: c.id, academy_id: NRIFA, status: 'active', invited_by: organiser, joined_at: new Date().toISOString() })
    error ? note(`club row for NRIFA: ${error.message}`) : ok(`NRIFA entered in ${c.name} as a club, so its head sees the notices and the Clubs chat`)
  }
}
const { data: splStaff } = await admin.from('academy_members').select('profile_id, role, status').eq('academy_id', SPL).eq('status', 'active')
const { data: staffNames } = await admin.from('profiles').select('id, full_name').in('id', (splStaff ?? []).map((m) => m.profile_id))
const nameOf = (id) => staffNames?.find((p) => p.id === id)?.full_name ?? id
console.log(`\nAfter:  Joey — ${(await memberships(JOEY)).join('; ')}`)
console.log(`        organiser — ${(await memberships(organiser)).join('; ')}`)
console.log(`        the SPL's staff — ${(splStaff ?? []).map((m) => `${nameOf(m.profile_id)} (${m.role})`).join(', ')}`)
const stillStaff = (await memberships(JOEY)).some((m) => m.startsWith('Sydney Premier League'))
stillStaff ? bad('Joey is still SPL staff') : ok('the organisation switcher no longer shows Joey as SPL staff (one membership: NRIFA)')
console.log('')
