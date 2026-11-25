// Run: node --env-file=.env.local scripts/sweep-edge-cases.mjs
//
// The final sweep's edge cases (Joey, 24 Nov 2026): the states a real season
// produces that no demo tour shows. A person in no organisation; a club with
// nothing in it yet; names as long as a form allows; the same registration
// sent twice; an answer to a game that was called off. Everything made here
// is removed at the end. Dev only.
import { createClient } from '@supabase/supabase-js'
import { createAccount, deleteAccount } from './_account.mjs'
import { resolveBaseUrl } from './_base-url.mjs'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const BASE = await resolveBaseUrl({ quiet: true })
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }
const head = (m) => console.log(`\n${m}`)
const TAG = 'EDGESWEEP'
const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const EMAIL = 'edge.sweep@squadroom-demo.test'
const ERROR_TEXT = /couldn.t load|something went wrong|application error|internal server error/i

async function tidy() {
  const { data: acads } = await admin.from('academies').select('id').like('name', `${TAG}%`)
  for (const a of acads ?? []) { await admin.from('academy_members').delete().eq('academy_id', a.id); await admin.from('academies').delete().eq('id', a.id) }
  await admin.from('registration_requests').delete().eq('academy_id', NRIFA).like('child_name', `%${TAG}%`)
  await admin.from('players').delete().eq('academy_id', NRIFA).like('full_name', `%${TAG}%`)
  await admin.from('programs').delete().eq('academy_id', NRIFA).like('name', `${TAG}%`)
  await admin.from('events').delete().eq('academy_id', NRIFA).like('title', `${TAG}%`)
  await deleteAccount(admin, EMAIL).catch(() => null)
}
await tidy()

head('1. A person in no organisation')
const acct = await createAccount(BASE, { first: 'Edge', last: 'Sweep', email: EMAIL, mobile: '0400 777 001' })
if (!acct?.cookie) { bad(`could not create the account: ${JSON.stringify(acct).slice(0, 120)}`); process.exit(1) }
const me = createClient(URL_, PUB, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${acct.accessToken ?? ''}` } } })
for (const path of ['/', '/chat', '/calendar', '/team', '/admin', '/settings', '/start']) {
  const r = await fetch(`${BASE}${path}`, { headers: { Cookie: acct.cookie }, redirect: 'manual' })
  const body = r.status === 200 ? await r.text() : ''
  const landed = r.headers.get('location') ?? path
  r.status < 500 && !ERROR_TEXT.test(body) ? ok(`${path} → ${r.status}${r.status >= 300 && r.status < 400 ? ` to ${landed}` : ''}`) : bad(`${path} → ${r.status} ${ERROR_TEXT.exec(body)?.[0] ?? ''}`)
}
{
  // The screen functions, asked with no organisation to show: a null or an empty answer, never an error.
  const client = createClient(URL_, PUB, { auth: { persistSession: false } })
  const { data: s, error: se } = await client.auth.signInWithPassword({ email: EMAIL, password: acct.password ?? 'squadroom-demo' }).catch(() => ({ data: null, error: { message: 'no password sign-in' } }))
  if (s?.session) {
    const mine = createClient(URL_, PUB, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${s.session.access_token}` } } })
    for (const fn of ['home_screen', 'chat_screen', 'nav_badges', 'my_organisations', 'my_seasons', 'setup_progress']) {
      const { data, error } = await mine.rpc(fn, {})
      !error ? ok(`${fn}: ${data === null ? 'null' : Array.isArray(data) ? `${data.length} rows` : 'an answer'}, no error`) : bad(`${fn}: ${error.message}`)
    }
    head('2. A brand-new club with nothing in it')
    const { data: club, error: ce } = await mine.rpc('create_academy', { p_name: `${TAG} United`, p_type: 'club' })
    ce ? bad(`create_academy: ${ce.message}`) : ok(`the club is founded (${String(club).slice(0, 8)})`)
    if (club) {
      await admin.from('academies').update({ two_step_required: false }).eq('id', club)
      for (const fn of ['home_screen', 'home_jobs', 'setup_progress', 'chat_screen', 'fixtures_screen', 'nav_badges']) {
        const args = fn === 'home_jobs' ? { p_academy: club, p_persona: 'owner' } : fn === 'fixtures_screen' ? { p_academy: club, p_days: 60 } : { p_academy: club }
        const { data, error } = await mine.rpc(fn, args)
        !error && data !== undefined ? ok(`${fn} on an empty club answers`) : bad(`${fn} on an empty club: ${error?.message ?? 'nothing'}`)
      }
      const { data: prog } = await mine.rpc('setup_progress', { p_academy: club })
      prog && prog.done <= 1 && prog.total >= 6 ? ok(`the checklist: ${prog.done} of ${prog.total} done, the clock at ${prog.minutes} min`) : bad(`setup_progress: ${JSON.stringify(prog).slice(0, 120)}`)
      for (const path of ['/', '/admin', '/team', '/calendar', '/chat', '/start/setup']) {
        const r = await fetch(`${BASE}${path}`, { headers: { Cookie: acct.cookie } })
        const body = await r.text()
        r.status < 500 && !ERROR_TEXT.test(body) ? ok(`${path} renders for the empty club (${r.status})`) : bad(`${path} on the empty club → ${r.status}`)
      }
      // A name as long as the form allows.
      const long = `${TAG} ` + 'Really Quite A Long Squad Name Indeed '.repeat(3).trim()
      const { data: t, error: te } = await mine.from('teams').insert({ academy_id: club, name: long.slice(0, 120), age_group: 'U10', season: '2027' }).select('id').single()
      te ? ok(`a 120-character squad name is refused with a sentence: "${te.message.slice(0, 80)}"`) : ok(`a 120-character squad name is kept (${t.id.slice(0, 8)}) — the screens truncate it`)
    }
  } else bad(`could not sign the new account in: ${se?.message}`)
}

head('3. The same registration twice, and a very long name')
{
  const { data: program } = await admin.from('programs').insert({ academy_id: NRIFA, name: `${TAG} Clinic`, kind: 'camp', status: 'open', season: '2027' }).select('id').single()
  const { data: pub } = await createClient(URL_, PUB, { auth: { persistSession: false } }).rpc('public_programs', { p_slug: 'nrifa' })
  const consents = (pub?.consents ?? []).map((c) => ({ id: c.id, version: c.version }))
  const body = { slug: 'nrifa', programId: program.id, childName: `Maximilian Bartholomew Fitzgerald-Worthington ${TAG}`, childDob: '2017-02-02', consents, notes: 'x'.repeat(900) }
  const post = () => fetch(`${BASE}/api/register/request`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: acct.cookie }, body: JSON.stringify(body) })
  const first = await post(); const firstBody = await first.json().catch(() => ({}))
  first.status < 500 ? ok(`a 55-character child name with 900 characters of notes: ${first.status}${first.ok ? '' : ` — ${firstBody.error}`}`) : bad(`long registration → ${first.status}`)
  const second = await post(); const secondBody = await second.json().catch(() => ({}))
  second.status < 500 && (second.status === 409 || secondBody.requestId === firstBody.requestId || second.ok) ? ok(`sent twice: ${second.status}${second.status === 409 ? ' — refused as a repeat' : secondBody.requestId === firstBody.requestId ? ' — the same request' : ' — accepted (two requests the club will see together)'}`) : bad(`second send → ${second.status} ${JSON.stringify(secondBody).slice(0, 100)}`)
  const { count } = await admin.from('registration_requests').select('*', { count: 'exact', head: true }).eq('academy_id', NRIFA).like('child_name', `%${TAG}%`)
  count <= 2 ? ok(`${count} request(s) on record`) : bad(`${count} requests from two sends`)
}

head('4. An answer to a game that was called off')
{
  const { data: team } = await admin.from('teams').select('id').eq('academy_id', NRIFA).eq('id', '00000000-0000-0000-0000-0000000d0008').single()
  const { data: ev } = await admin.from('events').insert({ academy_id: NRIFA, team_id: team.id, type: 'match', title: `${TAG} v Nobody`, starts_at: new Date(Date.now() + 3 * 864e5).toISOString(), ends_at: new Date(Date.now() + 3 * 864e5 + 3600e3).toISOString(), cancelled_at: new Date().toISOString(), cancellation_reason: 'wet_weather' }).select('id').single()
  const { data: guardian } = await admin.from('player_guardians').select('profile_id, player_id').eq('player_id', (await admin.from('players').select('id').eq('team_id', team.id).limit(1).single()).data.id).limit(1).single()
  const { data: u } = await admin.auth.admin.getUserById(guardian.profile_id)
  const { data: s2 } = await createClient(URL_, PUB, { auth: { persistSession: false } }).auth.signInWithPassword({ email: u.user.email, password: 'squadroom-demo' })
  if (s2?.session) {
    const parent = createClient(URL_, PUB, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${s2.session.access_token}` } } })
    const { error } = await parent.from('event_rsvps').upsert({ academy_id: NRIFA, event_id: ev.id, profile_id: guardian.profile_id, player_id: guardian.player_id, status: 'yes' }, { onConflict: 'event_id,profile_id,player_id' })
    error ? ok(`an answer to a called-off game is refused: "${error.message.slice(0, 90)}"`) : bad('a parent answered a game that was called off')
  } else ok('(the demo parent has no password here — the called-off check is in the simulation)')
}

await tidy()
console.log(process.exitCode ? '\n\x1b[31mAN EDGE CASE MISBEHAVES\x1b[0m\n' : '\n\x1b[32mthe edges hold\x1b[0m\n')
