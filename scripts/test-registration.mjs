/**
 * test-registration.mjs — 0082 to 0085: programs, registrations, medical,
 * consents and squad numbers.
 *
 * The assertions that matter here are the ones about things no screen can be
 * trusted with:
 *
 *   · Two parents tapping Register at the same instant for the last place.
 *     Both browsers counted a free place. Only one may get it.
 *   · A coach who is not an owner or admin reading a child's medical record.
 *   · A guardian approving their own child's registration.
 *   · Editing a code of conduct that families have already signed.
 *   · The same shirt number in two age groups.
 *
 * Needs 0082-0085 applied. Each step reports PGRST202/42P01 as "not applied"
 * rather than as a failure of the rule.
 */
import { createClient } from '@supabase/supabase-js'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})
const anon = createClient(URL_, PUB, { auth: { persistSession: false } })

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`)
  process.exitCode = 1
}
const head = (m) => console.log(`\n${m}`)

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const U8 = '00000000-0000-0000-0000-0000000d0008'
const SEASON = 'TESTREG-2026'

async function sess(email) {
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  const { data: s } = await anon.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: 'email',
  })
  if (!s?.session) {
    console.log(`  could not sign in ${email} — the project's auth rate limit, not a failure`)
    process.exit(1)
  }
  return {
    client: createClient(URL_, PUB, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${s.session.access_token}` } },
    }),
    id: s.user.id,
  }
}

const owner = await sess('joeylameri@outlook.com')
const coach = await sess('p61400000002@squadroom.invalid') // Marcus Obi, coach only
const sam = await sess('p61400000011@squadroom.invalid') // Sam Whitfield, Leo + Zoe
const other = await sess('p61400000012@squadroom.invalid') // another parent

// --- clean up anything a previous run left ---------------------------------
async function clean() {
  const { data: progs } = await admin
    .from('programs')
    .select('id')
    .eq('academy_id', NRIFA)
    .like('name', 'TESTREG%')
  for (const p of progs ?? []) {
    await admin.from('program_registrations').delete().eq('program_id', p.id)
    await admin.from('programs').delete().eq('id', p.id)
  }
  await admin.from('squad_numbers').delete().eq('academy_id', NRIFA).eq('season', SEASON)
  const { data: docs } = await admin
    .from('consent_documents')
    .select('id')
    .eq('academy_id', NRIFA)
    .like('title', 'TESTREG%')
  for (const d of docs ?? []) {
    await admin.from('consent_acceptances').delete().eq('document_id', d.id)
    await admin.from('consent_documents').delete().eq('id', d.id)
  }
}

const notApplied = (e) =>
  e && (e.code === 'PGRST202' || e.code === '42P01' || /does not exist|schema cache/i.test(e.message))

{
  const { error } = await admin.from('programs').select('id').limit(1)
  if (notApplied(error)) {
    bad('0083 is not applied — public.programs does not exist yet')
    process.exit(1)
  }
}
await clean()

// Sam's children.
const { data: kids } = await admin
  .from('players')
  .select('id, full_name, dob')
  .eq('academy_id', NRIFA)
  .in(
    'id',
    (
      await admin.from('player_guardians').select('player_id').eq('profile_id', sam.id)
    ).data.map((g) => g.player_id)
  )
if ((kids ?? []).length < 1) {
  bad('Sam has no children linked — run scripts/refresh-demo.mjs')
  process.exit(1)
}
const leo = kids[0]
const leoYear = new Date(leo.dob).getFullYear()

head('1. Only staff may create a program')
const { error: coachCreate } = await coach.client.from('programs').insert({
  academy_id: NRIFA,
  name: 'TESTREG by a coach',
  kind: 'camp',
  status: 'open',
})
coachCreate ? ok('a coach cannot create one') : bad('a coach created a program')

const { data: program, error: createError } = await owner.client
  .from('programs')
  .insert({
    academy_id: NRIFA,
    name: 'TESTREG Summer Camp',
    kind: 'camp',
    status: 'open',
    season: SEASON,
    born_from_year: leoYear,
    born_to_year: leoYear,
    capacity: 1,
    waitlist_enabled: true,
    created_by: owner.id,
  })
  .select('id')
  .single()
createError ? bad(`the owner could not create one: ${createError.message}`) : ok('the owner can')
if (createError) process.exit(1)

head('2. A draft program is invisible to families')
const { data: draft } = await owner.client
  .from('programs')
  .insert({ academy_id: NRIFA, name: 'TESTREG Draft', kind: 'trial', status: 'draft' })
  .select('id')
  .single()
const { data: samSees } = await sam.client.from('programs').select('id').eq('id', draft.id)
samSees?.length === 0 ? ok('a parent cannot see a draft') : bad('a parent saw a draft program')
const { data: coachSees } = await coach.client.from('programs').select('id').eq('id', draft.id)
coachSees?.length === 1 ? ok('a coach can, so they can help prepare it') : bad('a coach cannot see the draft')

head('3. Birth year, not age')
const { data: wrongAge } = await admin
  .from('players')
  .select('id, full_name, dob')
  .eq('academy_id', NRIFA)
  .not('dob', 'is', null)
  .neq('id', leo.id)
  .limit(40)
const outOfRange = (wrongAge ?? []).find((p) => new Date(p.dob).getFullYear() !== leoYear)
if (outOfRange) {
  // Registered by staff so the age check is what refuses it, not the guardian rule.
  const { error } = await owner.client.from('program_registrations').insert({
    academy_id: NRIFA,
    program_id: program.id,
    player_id: outOfRange.id,
    submitted_by: owner.id,
  })
  error && /born/.test(error.message)
    ? ok(`refused, and said why: "${error.message.slice(0, 70)}…"`)
    : bad(error ? `refused for the wrong reason: ${error.message}` : 'an out-of-year player was accepted')
} else {
  bad('no player outside the birth year to test with')
}

head('4. A guardian registers their own child, and nobody else’s')
const { error: notMine } = await sam.client.from('program_registrations').insert({
  academy_id: NRIFA,
  program_id: program.id,
  player_id: outOfRange?.id ?? leo.id,
  submitted_by: sam.id,
})
// outOfRange is not Sam's child, so this must fail either way.
notMine ? ok("a parent cannot register another family's child") : bad('a parent registered a stranger')

head('5. The last place: two parents, same instant, one winner')
// The race the screen cannot win. Capacity is 1.
const { data: siblings } = await admin
  .from('players')
  .select('id')
  .eq('academy_id', NRIFA)
  .eq('team_id', U8)
  .eq('dob', leo.dob)
  .limit(2)

const racers = (siblings ?? []).length >= 2 ? siblings.slice(0, 2) : [leo, leo]
const [a, b] = await Promise.all([
  owner.client
    .from('program_registrations')
    .insert({ academy_id: NRIFA, program_id: program.id, player_id: racers[0].id, submitted_by: owner.id })
    .select('status, waitlist_position')
    .single(),
  owner.client
    .from('program_registrations')
    .insert({ academy_id: NRIFA, program_id: program.id, player_id: racers[1].id, submitted_by: owner.id })
    .select('status, waitlist_position')
    .single(),
])

const { data: rows } = await admin
  .from('program_registrations')
  .select('status, waitlist_position')
  .eq('program_id', program.id)
const pending = (rows ?? []).filter((r) => r.status === 'pending')
const waiting = (rows ?? []).filter((r) => r.status === 'waitlisted')

if (racers[0].id === racers[1].id) {
  // Only one child available: the unique constraint is what must hold.
  const failed = [a, b].filter((r) => r.error).length
  failed === 1 ? ok('the same child twice became one row, not two') : bad(`${failed} of 2 inserts failed`)
} else {
  pending.length === 1
    ? ok(`exactly one took the last place (${pending.length} pending)`)
    : bad(`${pending.length} rows hold a place in a program with capacity 1`)
  waiting.length === 1 && waiting[0].waitlist_position === 1
    ? ok('the other was waitlisted at position 1, not rejected')
    : bad(`waitlist: ${JSON.stringify(waiting)}`)
}

head('6. A guardian cannot approve their own child')
const { data: mine } = await admin
  .from('program_registrations')
  .select('id, player_id')
  .eq('program_id', program.id)
  .limit(1)
  .maybeSingle()
if (mine) {
  const { error: selfApprove } = await sam.client
    .from('program_registrations')
    .update({ status: 'approved' })
    .eq('id', mine.id)
  const { data: after } = await admin
    .from('program_registrations')
    .select('status, decided_by')
    .eq('id', mine.id)
    .single()
  after.status === 'approved'
    ? bad('a parent approved a registration')
    : ok(`a parent cannot approve${selfApprove ? '' : ' (silently filtered)'}`)

  const { error: staffApprove } = await owner.client
    .from('program_registrations')
    .update({ status: 'approved' })
    .eq('id', mine.id)
  const { data: decided } = await admin
    .from('program_registrations')
    .select('status, decided_by, decided_at')
    .eq('id', mine.id)
    .single()
  staffApprove
    ? bad(`staff could not approve: ${staffApprove.message}`)
    : decided.decided_by === owner.id && decided.decided_at
      ? ok('staff can, and the decision is stamped with who and when')
      : bad(`approved but not stamped: ${JSON.stringify(decided)}`)
}

head('7. Medical: a guardian writes it, a plain coach cannot read it')
const { error: medError } = await sam.client.from('player_medical').upsert({
  player_id: leo.id,
  academy_id: NRIFA,
  conditions: 'TESTREG asthma, mild',
  coach_note: 'TESTREG blue inhaler in the side pocket',
  emergency_name: 'TESTREG Nan',
  emergency_phone: '0400000000',
  first_aid_consent: true,
})
medError ? bad(`a guardian could not write it: ${medError.message}`) : ok('a guardian wrote it')

const { data: coachRead } = await coach.client
  .from('player_medical')
  .select('conditions')
  .eq('player_id', leo.id)
coachRead?.length === 0
  ? ok('a coach who is not an admin reads nothing from the table')
  : bad(`a coach read medical data: ${JSON.stringify(coachRead)}`)

const { data: ownerRead } = await owner.client
  .from('player_medical')
  .select('conditions')
  .eq('player_id', leo.id)
ownerRead?.length === 1 ? ok('the owner can, because somebody has to') : bad('the owner cannot read it')

const { data: otherParent } = await other.client
  .from('player_medical')
  .select('conditions')
  .eq('player_id', leo.id)
otherParent?.length === 0
  ? ok("another family reads nothing")
  : bad('another parent read a child’s medical record')

head('8. But the coach still learns what they need at the ground')
const { data: alerts, error: alertError } = await coach.client.rpc('team_coach_alerts', {
  p_team: U8,
})
if (alertError) {
  bad(alertError.message)
} else {
  const hit = (alerts ?? []).find((r) => r.player_id === leo.id)
  hit?.coach_note?.includes('inhaler')
    ? ok(`the one line: "${hit.coach_note}"`)
    : bad(`the coach_note did not come through: ${JSON.stringify(alerts)}`)
  // And nothing else came with it.
  const leaked = Object.keys(alerts?.[0] ?? {}).filter(
    (k) => !['player_id', 'player_name', 'coach_note'].includes(k)
  )
  leaked.length === 0 ? ok('and only that line') : bad(`it also returned ${leaked.join(', ')}`)
}

const { data: strangerAlerts } = await other.client.rpc('team_coach_alerts', { p_team: U8 })
strangerAlerts?.length === 0
  ? ok('a parent gets nothing from it at all')
  : bad(`a parent read ${strangerAlerts?.length} coach notes`)

head('9. A signed consent cannot be edited, only superseded')
const { data: doc, error: docError } = await owner.client
  .from('consent_documents')
  .insert({
    academy_id: NRIFA,
    kind: 'code_of_conduct',
    title: 'TESTREG Code of Conduct',
    version: 1,
    body: 'Be kind. Version one.',
    required: true,
    published_at: new Date().toISOString(),
    created_by: owner.id,
  })
  .select('id')
  .single()
if (docError) {
  bad(docError.message)
} else {
  const { data: outstanding } = await sam.client.rpc('outstanding_consents', { p_player: leo.id })
  ;(outstanding ?? []).some((d) => d.document_id === doc.id)
    ? ok('it appears as outstanding for the family')
    : bad('outstanding_consents did not list it')

  const { error: acceptError } = await sam.client.from('consent_acceptances').insert({
    academy_id: NRIFA,
    document_id: doc.id,
    profile_id: sam.id,
    player_id: leo.id,
    accepted: true,
  })
  acceptError ? bad(`could not accept: ${acceptError.message}`) : ok('the guardian accepted it')

  const { data: still } = await sam.client.rpc('outstanding_consents', { p_player: leo.id })
  ;(still ?? []).some((d) => d.document_id === doc.id)
    ? bad('it is still listed as outstanding after being accepted')
    : ok('and is not asked for again')

  const { error: editError } = await owner.client
    .from('consent_documents')
    .update({ body: 'Be kind. Quietly rewritten.' })
    .eq('id', doc.id)
  editError
    ? ok(`signed text is frozen: "${editError.message.slice(0, 60)}…"`)
    : bad('published text that families had signed was rewritten in place')

  const { error: titleError } = await owner.client
    .from('consent_documents')
    .update({ title: 'TESTREG Code of Conduct (2026)' })
    .eq('id', doc.id)
  titleError ? bad(`the title should still be editable: ${titleError.message}`) : ok('but the title is not frozen')

  const { error: forgeError } = await other.client.from('consent_acceptances').insert({
    academy_id: NRIFA,
    document_id: doc.id,
    profile_id: sam.id,
    player_id: leo.id,
    accepted: true,
  })
  forgeError ? ok('nobody can accept on another adult’s behalf') : bad('a consent was forged')
}

head('10. One shirt number per season, across every age group')
const { data: n1, error: numError } = await coach.client
  .from('squad_numbers')
  .insert({ academy_id: NRIFA, player_id: leo.id, season: SEASON, number: 7, assigned_by: coach.id })
  .select('number')
  .single()
numError ? bad(`a coach could not assign a number: ${numError.message}`) : ok(`assigned ${n1.number}`)

// A different child, in a different age group, asking for the same 7.
const { data: elsewhere } = await admin
  .from('players')
  .select('id, team_id')
  .eq('academy_id', NRIFA)
  .neq('team_id', U8)
  .not('team_id', 'is', null)
  .limit(1)
  .maybeSingle()
if (elsewhere) {
  const { error: clash } = await coach.client.from('squad_numbers').insert({
    academy_id: NRIFA,
    player_id: elsewhere.id,
    season: SEASON,
    number: 7,
  })
  clash
    ? ok('7 in another age group is refused — two sevens cannot take the field')
    : bad('the same number was issued twice in one season')

  const { data: next } = await coach.client.rpc('next_squad_number', {
    p_academy: NRIFA,
    p_season: SEASON,
    p_preferred: 7,
  })
  next && next !== 7 ? ok(`and it offers ${next} instead of just saying no`) : bad(`next_squad_number gave ${next}`)
}

const { error: parentNumber } = await sam.client
  .from('squad_numbers')
  .update({ number: 10 })
  .eq('player_id', leo.id)
const { data: unchanged } = await admin
  .from('squad_numbers')
  .select('number')
  .eq('player_id', leo.id)
  .eq('season', SEASON)
  .single()
unchanged.number === 7
  ? ok(`a parent cannot reassign it${parentNumber ? '' : ' (silently filtered)'}`)
  : bad('a parent changed a squad number')

head('11. Nothing of this leaked to another academy')
const { data: ravens } = await admin
  .from('academy_members')
  .select('profile_id')
  .eq('academy_id', '00000000-0000-0000-0000-0000000a0002')
  .eq('status', 'active')
  .limit(1)
  .maybeSingle()
if (ravens) {
  const { data: u } = await admin.auth.admin.getUserById(ravens.profile_id)
  if (u?.user?.email) {
    const outsider = await sess(u.user.email)
    for (const table of ['programs', 'program_registrations', 'player_medical', 'squad_numbers']) {
      const { data } = await outsider.client.from(table).select('academy_id').eq('academy_id', NRIFA)
      data?.length === 0 ? ok(`${table}: nothing`) : bad(`${table}: ${data?.length} rows leaked`)
    }
  }
}

await clean()
await admin.from('player_medical').delete().eq('player_id', leo.id)
await admin.from('programs').delete().eq('id', draft.id)

console.log(
  process.exitCode
    ? '\n\x1b[31mREGISTRATION RULES BROKEN\x1b[0m\n'
    : '\n\x1b[32mREGISTRATION RULES HOLD\x1b[0m\n'
)
process.exit(process.exitCode ?? 0)
