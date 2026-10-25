// Run: node --env-file=.env.local scripts/seed-registration.mjs
//
// Gives the registration screens something to be. Empty screens demonstrate
// nothing, and the three states that matter — waiting, in, and on a waitlist —
// only exist once somebody has actually registered.
//
// Also publishes the Spring Gala Day's public match centre, because that page
// is the only part of the product a person with no account can see, and a
// demo that cannot show it is missing the answer to "what do the visiting
// clubs get?"
//
// Idempotent: it clears and rebuilds its own rows each run.
import { createClient } from '@supabase/supabase-js'

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const say = (m) => console.log('  ' + m)
const die = (m) => {
  throw new Error(m)
}

console.log('\nSeeding registration\n')

const { data: owner } = await admin
  .from('profiles')
  .select('id, full_name')
  .ilike('full_name', '%joey%')
  .limit(1)
  .maybeSingle()
if (!owner) die('no owner profile — run scripts/refresh-demo.mjs first')

// --- programs --------------------------------------------------------------
const { data: existing } = await admin
  .from('programs')
  .select('id')
  .eq('academy_id', NRIFA)
for (const p of existing ?? []) {
  await admin.from('program_registrations').delete().eq('program_id', p.id)
}
await admin.from('programs').delete().eq('academy_id', NRIFA)

const year = new Date().getFullYear()
const inDays = (n) => new Date(Date.now() + n * 864e5).toISOString()

// Four programs covering the shapes an academy actually runs, so the screen
// shows that one table really does serve all of them.
const PROGRAMS = [
  {
    name: 'January Holiday Camp',
    kind: 'camp',
    status: 'open',
    description: 'Four mornings at ELS Hall. Bring a hat, a drink bottle and boots.',
    born_from_year: year - 12,
    born_to_year: year - 7,
    // Small on purpose: a camp that fills is how the waitlist gets
    // demonstrated, and the waitlist is the part nobody believes works.
    capacity: 4,
    waitlist_enabled: true,
    closes_at: inDays(21),
    starts_on: new Date(year + 1, 0, 12).toISOString().slice(0, 10),
    ends_on: new Date(year + 1, 0, 15).toISOString().slice(0, 10),
  },
  {
    name: `SPL Squad Trials ${year + 1}`,
    kind: 'trial',
    status: 'open',
    description: 'Two sessions. Selected players are offered a squad place afterwards.',
    born_from_year: year - 13,
    born_to_year: year - 9,
    capacity: 40,
    closes_at: inDays(30),
    questions: [
      { id: 'position', label: 'Preferred position', required: true },
      { id: 'current_club', label: 'Current club', required: false },
    ],
  },
  {
    name: 'Tuesday Development',
    kind: 'development',
    status: 'open',
    description: 'Weekly technical work through the school term.',
    born_from_year: year - 11,
    born_to_year: year - 8,
  },
  {
    name: `Gold Coast Tour ${year + 1}`,
    kind: 'tour',
    status: 'draft',
    description: 'Four days, three games. Costs and rooming to be confirmed.',
    capacity: 18,
  },
]

const made = {}
for (const p of PROGRAMS) {
  const { data, error } = await admin
    .from('programs')
    .insert({ academy_id: NRIFA, season: String(year + 1), created_by: owner.id, ...p })
    .select('id, name, capacity')
    .single()
  if (error) die(`${p.name}: ${error.message}`)
  made[p.name] = data
}
say(`${PROGRAMS.length} programs (one kept as a draft, so that state shows too)`)

// --- registrations ---------------------------------------------------------
// Real children with real guardians, so the queue shows names a coach
// recognises and a parent opening /programs sees their own child's status.
const camp = made['January Holiday Camp']
const { data: eligible } = await admin
  .from('players')
  .select('id, full_name, dob, player_guardians(profile_id)')
  .eq('academy_id', NRIFA)
  .not('dob', 'is', null)
  .gte('dob', `${year - 12}-01-01`)
  .lte('dob', `${year - 7}-12-31`)
  .limit(12)

const withGuardian = (eligible ?? []).filter((p) => (p.player_guardians ?? []).length > 0)
if (withGuardian.length < 3) {
  die(`only ${withGuardian.length} eligible children have a guardian — run scripts/refresh-demo.mjs`)
}

// Deliberately more than the capacity of 4, so the trigger has to waitlist
// somebody. That it does so without anybody asking is the point.
let pending = 0
let waitlisted = 0
for (const child of withGuardian.slice(0, 7)) {
  const guardian = child.player_guardians[0].profile_id
  const { data, error } = await admin
    .from('program_registrations')
    .insert({
      academy_id: NRIFA,
      program_id: camp.id,
      player_id: child.id,
      submitted_by: guardian,
    })
    .select('status')
    .single()
  if (error) die(`registering ${child.full_name}: ${error.message}`)
  if (data.status === 'waitlisted') waitlisted++
  else pending++
}
say(`${pending} waiting on a ${camp.capacity}-place camp, ${waitlisted} waitlisted by the trigger`)

// A couple already approved, so the queue is not only a to-do list.
const { data: toApprove } = await admin
  .from('program_registrations')
  .select('id')
  .eq('program_id', camp.id)
  .eq('status', 'pending')
  .limit(2)
for (const r of toApprove ?? []) {
  const { error } = await admin
    .from('program_registrations')
    .update({ status: 'approved', decided_by: owner.id, decided_at: new Date().toISOString() })
    .eq('id', r.id)
  if (error) die(`approving: ${error.message}`)
}
say(`${(toApprove ?? []).length} already approved`)

// Trials, which has questions — so the answers show in the queue.
//
// Checked, not fired and forgotten. The first version of this loop ignored
// the error and reported "5 trial registrations" while writing three: the
// trials program runs from a different birth year to the camp, so children
// picked for one are not all eligible for the other and the trigger correctly
// refused them. A seed script that lies about what it wrote is how the
// player_guardians bug survived for weeks.
const trials = made[`SPL Squad Trials ${year + 1}`]
const trialYears = PROGRAMS.find((p) => p.kind === 'trial')
const eligibleForTrials = withGuardian.filter((c) => {
  const y = new Date(c.dob).getFullYear()
  return y >= trialYears.born_from_year && y <= trialYears.born_to_year
})

const POSITIONS = ['Goalkeeper', 'Centre back', 'Winger', 'Striker', 'Midfield']
let trialCount = 0
for (const [i, child] of eligibleForTrials.slice(0, 5).entries()) {
  const { error } = await admin.from('program_registrations').insert({
    academy_id: NRIFA,
    program_id: trials.id,
    player_id: child.id,
    submitted_by: child.player_guardians[0].profile_id,
    answers: { position: POSITIONS[i % POSITIONS.length] },
  })
  if (error) die(`registering ${child.full_name} for trials: ${error.message}`)
  trialCount++
}
if (trialCount === 0) die('no child is eligible for trials — check the birth years')
say(`${trialCount} trial registrations with answers`)

// --- a code of conduct, versioned -----------------------------------------
await admin.from('consent_documents').delete().eq('academy_id', NRIFA)
const { error: docError } = await admin.from('consent_documents').insert([
  {
    academy_id: NRIFA,
    kind: 'code_of_conduct',
    title: 'Player and Parent Code of Conduct',
    version: 1,
    body: 'Support every player on both teams. Let the coach coach and the referee referee. Nobody is here to be shouted at.',
    required: true,
    published_at: new Date().toISOString(),
    created_by: owner.id,
  },
  {
    academy_id: NRIFA,
    kind: 'photo_media',
    title: 'Photography and social media',
    version: 1,
    body: 'We photograph training and games for the academy’s own channels. You may say no, and saying no changes nothing else about your child’s place here.',
    // Not required, and that is the point: a consent you cannot refuse is
    // not a consent.
    required: false,
    published_at: new Date().toISOString(),
    created_by: owner.id,
  },
])
if (docError) die(`consents: ${docError.message}`)
say('2 consent documents, one required and one genuinely optional')

// --- publish the gala day --------------------------------------------------
const { data: gala } = await admin
  .from('competitions')
  .select('id, name')
  .eq('organiser_id', NRIFA)
  .eq('name', 'Spring Gala Day')
  .maybeSingle()

if (gala) {
  const { error } = await admin
    .from('competitions')
    .update({ public_slug: 'nrifa-spring-gala', published_at: new Date().toISOString() })
    .eq('id', gala.id)
  if (error) die(`publishing the gala day: ${error.message}`)

  // Read it back the way a stranger would — through the anon key, with no
  // session at all. If this returns nothing the page is broken for exactly
  // the people it exists for.
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false } }
  )
  const { data: page, error: readError } = await anon.rpc('public_match_centre', {
    p_slug: 'nrifa-spring-gala',
  })
  if (readError) die(`reading it back as a stranger: ${readError.message}`)
  if (!page) die('published, but the public page returns nothing')
  say(`public page live: /c/nrifa-spring-gala — ${page.fixtures.length} fixtures, ${page.divisions.length} divisions`)

  // And prove the boundary, rather than trusting the comment in 0079.
  const body = JSON.stringify(page)
  const { data: kids } = await admin
    .from('players')
    .select('full_name')
    .eq('academy_id', NRIFA)
    .limit(50)
  const leaked = (kids ?? []).filter((k) => body.includes(k.full_name))
  if (leaked.length) die(`the public page names ${leaked.length} children — stop and fix 0079`)
  say('and no child is named on it')
}

console.log('\nDone.\n')
