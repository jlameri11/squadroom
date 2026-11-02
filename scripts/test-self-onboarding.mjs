// Run: node --env-file=.env.local scripts/test-self-onboarding.mjs
//   (the setup page itself needs the app running; the rest does not)
//
// G-01: a stranger founds a club and has it running — crest and colours,
// squads, a roster, a program, coaches invited, training in the calendar —
// with every step read back from the data and the clock showing it took
// well under thirty minutes. Nobody from Squadroom in the loop.
import { createClient } from '@supabase/supabase-js'
import { signInBoth } from './_auth.mjs'
import { resolveBaseUrl } from './_base-url.mjs'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`)
  process.exitCode = 1
}
const head = (m) => console.log(`\n${m}`)

const PARENT = '00000000-0000-0000-0000-0000000000b1'
const TAG = 'SETUPTEST'
const FOUNDER_EMAIL = 'setuptest-founder@squadroom.invalid'
const started = Date.now()

async function cleanup() {
  const { data: acads } = await admin.from('academies').select('id').like('name', `${TAG} %`)
  for (const a of acads ?? []) {
    const { data: files } = await admin.storage.from('club-logos').list(a.id)
    if (files?.length) await admin.storage.from('club-logos').remove(files.map((f) => `${a.id}/${f.name}`))
    await admin.from('academies').delete().eq('id', a.id)
  }
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 })
  const u = users?.users?.find((x) => x.email === FOUNDER_EMAIL)
  if (u) await admin.auth.admin.deleteUser(u.id)
}
await cleanup()

const { data: created } = await admin.auth.admin.createUser({ email: FOUNDER_EMAIL, email_confirm: true })
const FOUNDER = created.user.id
await admin.from('profiles').upsert({ id: FOUNDER, full_name: 'Fiona Founder', phone: '+61400000555' })
const founder = await signInBoth(admin, FOUNDER_EMAIL)
const parentSigned = await signInBoth(admin, (await admin.auth.admin.getUserById(PARENT)).data.user.email)
if (!founder || !parentSigned) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  await cleanup()
  process.exit(2)
}
const me = founder.client
const parent = parentSigned.client

head('1. Found the club; the checklist starts at nothing')
const { data: academyId, error: foundErr } = await me.rpc('create_academy', { p_name: `${TAG} Rovers`, p_type: 'club' })
foundErr ? bad(`found: ${foundErr.message}`) : ok('a stranger founds a club and owns it')
const progress = async () => (await me.rpc('setup_progress', { p_academy: academyId })).data
{
  const p = await progress()
  p && p.done === 0 && p.total === 6 && !p.complete ? ok(`six steps, none done, clock at ${p.minutes} min`) : bad(JSON.stringify(p))
  const { data: pp } = await parent.rpc('setup_progress', { p_academy: academyId })
  pp === null ? ok('a parent of another club gets nothing') : bad('a stranger read the checklist')
}

head('2. Crest and colours')
{
  const { error } = await me.from('academies').update({ primary_colour: '#C8102E' }).eq('id', academyId)
  error ? bad(`colour: ${error.message}`) : ok('the owner picks red')
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0000000030001a7f02f5e0000000049454e44ae426082', 'hex')
  const path = `${academyId}/crest.png`
  const { error: up } = await me.storage.from('club-logos').upload(path, png, { contentType: 'image/png', upsert: true })
  up ? bad(`upload: ${up.message}`) : ok('and uploads the crest to the club\'s own folder')
  const { error: stranger } = await parent.storage.from('club-logos').upload(`${academyId}/sneaky.png`, png, { contentType: 'image/png' })
  stranger ? ok('a stranger cannot put a file in that folder') : bad('a stranger uploaded into the club\'s crest folder')
  const url = me.storage.from('club-logos').getPublicUrl(path).data.publicUrl
  const { error: setErr } = await me.rpc('set_academy_logo', { p_academy: academyId, p_url: url })
  setErr ? bad(`set crest: ${setErr.message}`) : ok('the crest is set from its public URL')
  const { error: wrong } = await me.rpc('set_academy_logo', { p_academy: academyId, p_url: 'https://evil.example/x.png' })
  wrong ? ok('a crest from anywhere else is refused') : bad('an outside URL became the crest')
  const res = await fetch(url)
  res.status === 200 ? ok('and anyone can fetch it — it is the one public picture') : bad(`crest fetch: ${res.status}`)
  const p = await progress()
  p?.steps?.[0]?.done ? ok('step 1 reads as done') : bad(JSON.stringify(p?.steps?.[0]))
}

head('3. Squads, roster, program, coaches, training — each read from the data')
let teamId
{
  const { data: team, error } = await me.from('teams').insert({ academy_id: academyId, name: 'U9s', age_group: 'U9', season: String(new Date().getFullYear()) }).select('id').single()
  error ? bad(`team: ${error.message}`) : ok('a squad')
  teamId = team?.id
  const { error: pl } = await me.from('players').insert([
    { academy_id: academyId, team_id: teamId, full_name: 'Ava Example', dob: '2017-03-03' },
    { academy_id: academyId, team_id: teamId, full_name: 'Ben Example', dob: '2017-05-05' },
  ])
  pl ? bad(`players: ${pl.message}`) : ok('two players on it')
  const { error: pr } = await me.from('programs').insert({ academy_id: academyId, name: 'U9 season', kind: 'squad', status: 'open', season: String(new Date().getFullYear()), born_from_year: 2017, born_to_year: 2017, created_by: FOUNDER })
  pr ? bad(`program: ${pr.message}`) : ok('a program families can register for')
  const { error: jl } = await me.from('join_links').insert({ academy_id: academyId, team_id: teamId, role: 'coach', created_by: FOUNDER })
  jl ? bad(`coach link: ${jl.message}`) : ok('a join link for coaches')
  let p = await progress()
  p?.done === 5 && p.complete && p.completed_at ? ok(`five core steps done — the club counts as set up at ${p.minutes} min`) : bad(JSON.stringify({ done: p?.done, complete: p?.complete, completed_at: p?.completed_at }))
  const { data: series, error: se } = await me.rpc('create_event_series', {
    p_academy: academyId, p_title: 'Training', p_team: teamId, p_days: [2], p_time: '17:00',
    p_from: new Date().toISOString().slice(0, 10), p_until: new Date(Date.now() + 28 * 864e5).toISOString().slice(0, 10),
  })
  se ? bad(`training: ${se.message}`) : ok(`weekly training (${series?.created} sessions)`)
  p = await progress()
  p?.done === 6 ? ok('all six') : bad(`done ${p?.done}`)
  const { data: a } = await admin.from('academies').select('setup_completed_at, setup_started_at').eq('id', academyId).single()
  const mins = (new Date(a.setup_completed_at).getTime() - new Date(a.setup_started_at).getTime()) / 60000
  mins < 30 ? ok(`recorded on the club: set up in ${mins.toFixed(1)} min (this test took ${((Date.now() - started) / 1000).toFixed(0)} s)`) : bad(`${mins} min`)
}

head('4. The owner\'s Home and the setup page')
{
  const { data: jobs } = await me.rpc('home_jobs', { p_academy: academyId })
  jobs?.persona === 'owner' ? ok('Home knows a club owner') : bad(JSON.stringify(jobs?.persona))
  const BASE = await resolveBaseUrl({ quiet: true })
  const ref = URL_.split('//')[1].split('.')[0]
  const cookie = `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(founder.session)).toString('base64')}`
  try {
    const res = await fetch(`${BASE}/start/setup`, { headers: { cookie }, redirect: 'manual' })
    res.status === 200 ? ok('the setup page answers the owner') : bad(`/start/setup: ${res.status}`)
    const html = await res.text()
    const isSetup = /Set up|setup/i.test(html)
    isSetup ? ok('and is the setup page') : bad('not the setup page')
  } catch (e) {
    console.log(`  (setup page skipped — ${String(e).slice(0, 60)})`)
  }
}

await cleanup()
console.log(process.exitCode ? '\n\x1b[31mSELF-ONBOARDING IS WRONG\x1b[0m\n' : '\n\x1b[32mall good\x1b[0m\n')
