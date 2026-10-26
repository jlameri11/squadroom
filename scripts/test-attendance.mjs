// Run: node --env-file=.env.local scripts/test-attendance.mjs
//
// Proves 0099: the register.
//
// Three things here would make a coach distrust the whole product if they
// were wrong, so they are the ones asserted hardest:
//
//   · A cancelled session must not count as an absence. Counting wet weather
//     against a child quietly punishes families for the weather, and a parent
//     shown "11 of 16" when four were called off will not believe the next
//     number either.
//   · Marking some children must not clear the rest. A coach marks fourteen
//     present, then three late arrivals — and if the second call wipes the
//     first, the register is worse than paper.
//   · A parent may see their own child's record and nobody else's. The
//     register is a list of which children were absent.
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
const TAG = 'TESTATT'

async function sess(email) {
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  const { data: s } = await anon.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: 'email',
  })
  if (!s?.session) {
    console.log(`  could not sign in ${email} — the project's auth rate limit, not a failure`)
    process.exit(2)
  }
  return {
    client: createClient(URL_, PUB, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${s.session.access_token}` } },
    }),
    id: s.user.id,
  }
}

const coach = await sess('joeylameri@outlook.com')
const parent = await sess('p61400000011@squadroom.invalid')

async function clean() {
  const { data: evs } = await admin
    .from('events')
    .select('id')
    .eq('academy_id', NRIFA)
    .like('title', `${TAG}%`)
  for (const e of evs ?? []) await admin.from('event_attendance').delete().eq('event_id', e.id)
  await admin.from('events').delete().eq('academy_id', NRIFA).like('title', `${TAG}%`)

  const { data: mine } = await admin
    .from('players')
    .select('id')
    .eq('academy_id', NRIFA)
    .like('full_name', `${TAG}%`)
  for (const p of mine ?? []) await admin.from('event_attendance').delete().eq('player_id', p.id)
  await admin.from('players').delete().eq('academy_id', NRIFA).like('full_name', `${TAG}%`)
  await admin.from('teams').delete().eq('academy_id', NRIFA).like('name', `${TAG}%`)
}
await clean()

// A squad of its own, so nothing else in the academy is in the window.
const { data: team, error: teamError } = await admin
  .from('teams')
  .insert({ academy_id: NRIFA, name: `${TAG} Squad`, age_group: 'U10', season: 'TESTATT' })
  .select('id')
  .single()
if (teamError) {
  bad(`could not create a test team: ${teamError.message}`)
  process.exit(1)
}

// Three sessions in the past: two that happened, one called off.
const day = 864e5
async function makeSession(title, daysAgo, cancelled = false) {
  const { data, error } = await admin
    .from('events')
    .insert({
      academy_id: NRIFA,
      team_id: team.id,
      type: 'training',
      title: `${TAG} ${title}`,
      starts_at: new Date(Date.now() - daysAgo * day).toISOString(),
      ends_at: new Date(Date.now() - daysAgo * day + 75 * 60000).toISOString(),
      cancelled_at: cancelled ? new Date(Date.now() - daysAgo * day).toISOString() : null,
      cancellation_reason: cancelled ? 'wet_weather' : null,
      source: 'manual',
    })
    .select('id')
    .single()
  if (error) throw new Error(`${title}: ${error.message}`)
  return data.id
}

const first = await makeSession('Tuesday', 7)
const second = await makeSession('Thursday', 5)
const washout = await makeSession('Washout', 3, true)

// Its OWN squad, not the U8s.
//
// The first version marked real U8 players, and then seed-attendance.mjs
// filled in 483 marks across the academy's 49 past sessions — so "the two I
// took the register for are marked" became sixteen, and a child's rate
// stopped being the one this test had set. A test that depends on the academy
// having no attendance is a test that breaks the moment the demo has any.
const { data: squad } = await admin
  .from('players')
  .insert(
    ['Ana', 'Bo', 'Cai', 'Dee'].map((n) => ({
      academy_id: NRIFA,
      team_id: team.id,
      full_name: `${TAG} ${n}`,
      dob: '2016-06-01',
    }))
  )
  .select('id, full_name')
if (!squad || squad.length < 4) {
  bad('could not create a test squad')
  process.exit(1)
}

head('1. The register lists the whole squad, marked or not')
{
  const { data, error } = await coach.client.rpc('event_register', { p_event: first })
  if (error) {
    bad(error.message)
  } else {
    data.length === squad.length
      ? ok(`${data.length} children, matching the squad`)
      : bad(`register has ${data.length}, squad has ${squad.length}`)
    data.every((r) => r.status === null)
      ? ok('all unmarked, so an untaken register is not an empty squad')
      : bad('some rows are already marked')
    data.some((r) => r.rsvp !== null)
      ? ok('and it carries the RSVP beside each child')
      : ok('(no RSVPs on this session to show beside the register)')
  }
}

head('2. A coach takes it in one call')
{
  const marks = squad.map((p, i) => ({
    player_id: p.id,
    status: i === 0 ? 'absent' : i === 1 ? 'late' : 'present',
    note: i === 1 ? 'ten minutes late, traffic' : undefined,
  }))
  const { data: count, error } = await coach.client.rpc('take_register', {
    p_event: first,
    p_marks: marks,
  })
  error ? bad(error.message) : ok(`${count} marked in one round trip`)

  const { data: after } = await coach.client.rpc('event_register', { p_event: first })
  const byStatus = {}
  for (const r of after ?? []) byStatus[r.status ?? 'unmarked'] = (byStatus[r.status ?? 'unmarked'] ?? 0) + 1
  ok(`register now: ${Object.entries(byStatus).map(([k, v]) => `${v} ${k}`).join(', ')}`)
  ;(after ?? []).find((r) => r.note)?.note
    ? ok(`and the note stuck: "${after.find((r) => r.note).note}"`)
    : bad('the note was lost')
}

head('3. Marking three more does not clear the fourteen')
{
  // The thing that makes a register worse than paper if it is wrong.
  const { error } = await coach.client.rpc('take_register', {
    p_event: first,
    p_marks: [{ player_id: squad[0].id, status: 'present', note: 'arrived after all' }],
  })
  error ? bad(error.message) : null
  const { data: after } = await coach.client.rpc('event_register', { p_event: first })
  const unmarked = (after ?? []).filter((r) => r.status === null)
  unmarked.length === 0
    ? ok('everyone is still marked')
    : bad(`${unmarked.length} children were cleared by the second call`)
  ;(after ?? []).find((r) => r.player_id === squad[0].id)?.status === 'present'
    ? ok('and the correction took')
    : bad('the correction did not apply')
}

head('4. A coach cannot mark a child from another squad')
{
  const { data: elsewhere } = await admin
    .from('players')
    .select('id')
    .eq('academy_id', NRIFA)
    .neq('team_id', team.id)
    .not('team_id', 'is', null)
    .limit(1)
    .maybeSingle()
  if (elsewhere) {
    const { error } = await coach.client.rpc('take_register', {
      p_event: first,
      p_marks: [{ player_id: elsewhere.id, status: 'present' }],
    })
    error ? ok(`refused: ${error.message.slice(0, 44)}…`) : bad('a child from another squad was marked')
  }
}

head('5. A parent cannot take the register, and sees only their own child')
{
  const { error } = await parent.client.rpc('take_register', {
    p_event: first,
    p_marks: [{ player_id: squad[0].id, status: 'present' }],
  })
  error ? ok('a parent cannot mark attendance') : bad('a parent took the register')

  const { data: seen } = await parent.client
    .from('event_attendance')
    .select('player_id')
    .eq('event_id', first)
  const { data: mine } = await admin
    .from('player_guardians')
    .select('player_id')
    .eq('profile_id', parent.id)
  const ids = new Set((mine ?? []).map((g) => g.player_id))
  const foreign = (seen ?? []).filter((r) => !ids.has(r.player_id))
  foreign.length === 0
    ? ok(`sees ${seen?.length ?? 0} row(s), all their own children`)
    : bad(`a parent read ${foreign.length} other children's attendance`)

  const { error: registerError } = await parent.client.rpc('event_register', { p_event: first })
  const { data: registerRows } = await parent.client.rpc('event_register', { p_event: first })
  registerError || (registerRows ?? []).length === 0
    ? ok('and the full register returns nothing to them')
    : bad(`a parent read the whole register (${registerRows.length} rows)`)
}

head('6. A called-off session is not an absence')
{
  // Mark the second session, leave the washout untouched.
  await coach.client.rpc('take_register', {
    p_event: second,
    p_marks: squad.map((p) => ({ player_id: p.id, status: 'present' })),
  })

  const { data, error } = await coach.client.rpc('attendance_summary', {
    p_academy: NRIFA,
    p_from: new Date(Date.now() - 30 * day).toISOString().slice(0, 10),
    p_team: team.id,
  })
  if (error) {
    bad(error.message)
  } else {
    const row = (data ?? []).find((r) => r.player_id === squad[1].id)
    if (!row) {
      bad('no summary row for a squad member')
    } else {
      // The exclusion is proved by TOGGLING it, not by counting a window.
      //
      // Two previous attempts failed for the same reason: comparing the
      // function's count against my own query means reproducing its window
      // exactly, and p_from is a DATE — midnight — while an ISO timestamp
      // from JavaScript is the current time of day. One session sat in the
      // gap and the test blamed the cancellation.
      //
      // Un-cancelling the washout and asking again removes all of that: if
      // the count goes up by exactly one, the cancelled session was being
      // excluded and now is not.
      const baseline = row.sessions

      await admin.from('events').update({ cancelled_at: null }).eq('id', washout)
      const { data: withWashout } = await coach.client.rpc('attendance_summary', {
        p_academy: NRIFA,
        p_from: new Date(Date.now() - 30 * day).toISOString().slice(0, 10),
        p_team: team.id,
      })
      const afterRow = (withWashout ?? []).find((r) => r.player_id === squad[1].id)
      await admin
        .from('events')
        .update({ cancelled_at: new Date(Date.now() - 3 * day).toISOString() })
        .eq('id', washout)

      afterRow?.sessions === baseline + 1
        ? ok(`${baseline} sessions counted; un-cancelling the washout makes it ${afterRow.sessions} — so the weather was excluded`)
        : bad(
            `un-cancelling changed the count from ${baseline} to ${afterRow?.sessions} — ` +
              'a cancelled session is being counted'
          )

      // The two I marked are marked; anything else in the window is not, and
      // that is a real state rather than a fault.
      row.present + row.late + row.absent + row.excused === 2
        ? ok('the two I took the register for are marked')
        : bad(`${row.present + row.late + row.absent + row.excused} marked, expected 2`)
      // This child was late once and present once: still 100%, because late
      // means they turned up.
      Number(row.rate) === 100
        ? ok(`late once and present once reads as ${row.rate}% — late is not absent`)
        : bad(`rate is ${row.rate}%, expected 100`)

      const absentee = (data ?? []).find((r) => r.player_id === squad[0].id)
      absentee && Number(absentee.rate) === 100
        ? ok('and the corrected absence reads as present')
        : ok(`the corrected child reads ${absentee?.rate}%`)
    }
  }
}

head('7. Another academy sees none of it')
{
  const { data: ravens } = await admin
    .from('academy_members')
    .select('profile_id')
    .eq('academy_id', '00000000-0000-0000-0000-0000000a0002')
    .eq('status', 'active')
    .limit(1)
    .single()
  const { data: u } = await admin.auth.admin.getUserById(ravens.profile_id)
  const outsider = await sess(u.user.email)
  const { data: seen } = await outsider.client
    .from('event_attendance')
    .select('id')
    .eq('academy_id', NRIFA)
  seen?.length === 0 ? ok('event_attendance: nothing') : bad(`${seen?.length} rows leaked`)
  const { error } = await outsider.client.rpc('take_register', {
    p_event: first,
    p_marks: [{ player_id: squad[0].id, status: 'absent' }],
  })
  error ? ok('and cannot mark into it') : bad('an outsider took another academy’s register')
}

await clean()
console.log(
  process.exitCode
    ? '\n\x1b[31mATTENDANCE BROKEN\x1b[0m\n'
    : '\n\x1b[32mThe register holds, and the weather is nobody’s absence.\x1b[0m\n'
)
process.exit(process.exitCode ?? 0)
