// Run: node --env-file=.env.local scripts/test-import-diff.mjs
//
// Proves 0117 (F-03): the import says what it is about to do.
//
// Two assertions carry the weight.
//
// THE PREVIEW MUST MATCH THE WRITE. A preview computed by a second copy of
// the resolution logic is a preview of a different import, so the test runs
// the preview, runs the import, and checks the numbers are the same ones. If
// they ever drift this fails, which is the only way to know.
//
// AND "MISSING" MUST BE NARROW. A coach exporting one team must never be told
// the other squads' games have vanished, and a file covering one weekend must
// not accuse the rest of the season. Both are tested by setting up fixtures
// that a sloppy range check would wrongly include.
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
const U12 = '00000000-0000-0000-0000-0000000d0012'
const TAG = 'TESTDIFF'

async function sess(email) {
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  // generateLink is rate limited per project as well as verifyOtp, and
  // returns null when it trips — so the property read below throws
  // before any session check runs, and the runner reports a crash
  // that is really the auth budget.
  if (!link?.properties?.hashed_token) {
    console.log(`  could not issue a link for ${email} — the project's auth rate limit, not a failure`)
    process.exit(2)
  }
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
    .like('external_ref', `${TAG}%`)
  for (const e of evs ?? []) {
    await admin.from('notification_queue').delete().eq('payload->>event_id', e.id)
    await admin.from('event_rsvps').delete().eq('event_id', e.id)
  }
  await admin.from('events').delete().eq('academy_id', NRIFA).like('external_ref', `${TAG}%`)
}
await clean()

// Dates far enough out that nothing seeded sits in the same window.
const d = (n) => {
  const x = new Date(Date.now() + n * 864e5)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(
    x.getDate()
  ).padStart(2, '0')}`
}
const DAY1 = d(40)
const DAY2 = d(41)
const FAR = d(90)

const row = (ref, date, time, extra = {}) => ({
  external_ref: `${TAG}:${ref}`,
  local_date: date,
  local_time: time,
  title: `${TAG} ${ref}`,
  venue: 'ELS Hall Park',
  ...extra,
})

const preview = async (events, team = U8, who = coach) => {
  const { data, error } = await who.client.rpc('preview_imported_events', {
    p_academy: NRIFA,
    p_team: team,
    p_events: events,
  })
  if (error) throw new Error(error.message)
  return data
}
const commitAs = async (who, events, { team = U8, cancelMissing = false } = {}) => {
  const { data, error } = await who.client.rpc('create_imported_events', {
    p_academy: NRIFA,
    p_team: team,
    p_events: events,
    p_cancel_missing: cancelMissing,
  })
  return { data: data?.[0], error }
}
const commit = async (events, { team = U8, cancelMissing = false } = {}) => {
  const { data, error } = await coach.client.rpc('create_imported_events', {
    p_academy: NRIFA,
    p_team: team,
    p_events: events,
    p_cancel_missing: cancelMissing,
  })
  if (error) throw new Error(error.message)
  return data[0]
}
const count = (p, verdict) => p.rows.filter((r) => r.verdict === verdict).length

head('1. A first import is all new, and says so before writing anything')
{
  const file = [row('a', DAY1, '09:00'), row('b', DAY1, '11:00'), row('c', DAY2, '10:00')]

  const p = await preview(file)
  count(p, 'new') === 3
    ? ok('3 new')
    : bad(`${count(p, 'new')} new: ${JSON.stringify(p.rows.map((r) => r.verdict))}`)
  p.missing.length === 0 ? ok('nothing missing') : bad(`${p.missing.length} missing`)

  // Nothing written yet — the whole point of a preview.
  const { count: before } = await admin
    .from('events')
    .select('id', { count: 'exact', head: true })
    .like('external_ref', `${TAG}%`)
  before === 0 ? ok('and the preview wrote nothing') : bad(`${before} rows appeared`)

  const r = await commit(file)
  r.created === 3 && r.updated === 0
    ? ok('the import then creates exactly the 3 it promised')
    : bad(`created ${r.created}, updated ${r.updated}`)
}

head('2. The same file again is all unchanged — a re-import is safe')
{
  const file = [row('a', DAY1, '09:00'), row('b', DAY1, '11:00'), row('c', DAY2, '10:00')]
  const p = await preview(file)
  count(p, 'unchanged') === 3
    ? ok('3 unchanged')
    : bad(`verdicts: ${JSON.stringify(p.rows.map((r) => r.verdict))}`)
  count(p, 'new') === 0 ? ok('and nothing is called new') : bad('a re-import would duplicate')
}

head('3. A moved game reads as moved, with both times')
{
  const file = [row('a', DAY1, '14:30'), row('b', DAY1, '11:00'), row('c', DAY2, '10:00')]
  const p = await preview(file)
  count(p, 'moved') === 1
    ? ok('1 moved')
    : bad(`${count(p, 'moved')} moved`)

  const m = p.rows.find((r) => r.verdict === 'moved')
  m?.was_at && m?.now_at && m.was_at !== m.now_at
    ? ok(`and carries both times (${new Date(m.was_at).toLocaleTimeString('en-AU')} → ${new Date(m.now_at).toLocaleTimeString('en-AU')})`)
    : bad(`was_at/now_at missing: ${JSON.stringify(m)}`)

  // 14:30 local must stay 14:30 local. The timezone bug this feature keeps
  // having is a game drifting an hour, or a day, on the way through.
  new Date(m.now_at).toLocaleTimeString('en-AU', {
    timeZone: 'Australia/Sydney',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }) === '14:30'
    ? ok('and 14:30 in the file is 14:30 in Sydney')
    : bad(`14:30 became ${new Date(m.now_at).toISOString()}`)
}

head('4. A venue change is named separately from a time change')
{
  // Because a coach reading "3 moved" checks the times. If a new ground is
  // reported the same way, they check the wrong thing.
  const file = [row('a', DAY1, '09:00', { venue: 'Christie Park' })]
  const p = await preview(file)
  count(p, 'changed') === 1 && count(p, 'moved') === 0
    ? ok('1 changed, 0 moved')
    : bad(`verdicts: ${JSON.stringify(p.rows.map((r) => r.verdict))}`)
}

head('5. A row with no readable date is skipped, not guessed at')
{
  const p = await preview([row('a', DAY1, '09:00'), row('z', '', '')])
  count(p, 'skipped') === 1 ? ok('1 skipped') : bad(`${count(p, 'skipped')} skipped`)
  const r = await commit([row('z', '', '')])
  r.skipped === 1 && r.created === 0
    ? ok('and the import agrees — skipped, nothing created')
    : bad(`created ${r.created}, skipped ${r.skipped}`)
}

head('6. "Missing" is narrow, and the window is whole DAYS')
{
  // Four fixtures the file will not mention, each one a different way for a
  // sloppy window to be wrong.
  //
  //   early — same day as the file, but BEFORE its first kick-off. This is
  //           the one that caught the first version: a window built from the
  //           span between the earliest and latest kick-off started at 9am
  //           and an 8am game dropped from the draw fell outside it.
  //   u12   — same day, another squad.
  //   c     — a day the file says nothing about.
  //   far   — months away.
  await commit([row('early', DAY1, '08:00')])
  await commit([row('u12', DAY1, '13:00')], { team: U12 })
  await commit([row('far', FAR, '09:00')])

  // A file covering DAY1 only, 9am and 11am.
  const file = [row('a', DAY1, '09:00'), row('b', DAY1, '11:00')]
  const p = await preview(file)
  const names = p.missing.map((m) => m.title)

  names.some((n) => n.endsWith('early'))
    ? ok('an 8am game dropped from a 9am-11am file IS reported')
    : bad(`missing: ${names.join(', ') || 'none'} — the day window is too tight`)

  names.some((n) => n.endsWith('u12'))
    ? bad("another squad's fixture was reported missing")
    : ok("another squad's fixture is not this file's business")

  // Deliberately NOT reported. A file that says nothing about Sunday has no
  // evidence that Sunday's game is withdrawn.
  names.some((n) => n.endsWith('c'))
    ? bad('a fixture on a day the file never mentions was called withdrawn')
    : ok('a day the file never mentions is left alone')

  names.some((n) => n.endsWith('far'))
    ? bad('a fixture months away was reported missing')
    : ok('and so is a fixture months away')

  p.covers?.from === DAY1 && p.covers?.to === DAY1
    ? ok(`the window is reported as whole days (${p.covers.from})`)
    : bad(`covers: ${JSON.stringify(p.covers)}`)

  // The count a coach reads has to be the number they can see.
  names.length === p.missing.length && names.length === 1
    ? ok('1 missing, and it is the one named')
    : bad(`${names.length} missing: ${names.join(', ')}`)
}

head('7. Missing fixtures are CALLED OFF, never deleted')
{
  // Somebody has answered for this game. That is the whole argument: a row
  // with an answer on it is a Saturday a family has planned around.
  const { data: ev } = await admin
    .from('events')
    .select('id')
    .eq('external_ref', `${TAG}:early`)
    .single()
  await admin.from('event_rsvps').insert({
    academy_id: NRIFA,
    event_id: ev.id,
    profile_id: parent.id,
    player_id: '00000000-0000-0000-0000-0000000e0001',
    status: 'yes',
  })

  const file = [row('a', DAY1, '09:00'), row('b', DAY1, '11:00')]
  const r = await commit(file, { cancelMissing: true })
  r.cancelled === 1 ? ok('1 called off') : bad(`cancelled ${r.cancelled}`)

  const { data: after } = await admin
    .from('events')
    .select('cancelled_at, cancellation_reason, cancellation_note')
    .eq('id', ev.id)
    .maybeSingle()
  after
    ? ok('the row is still there — a family that answered can still see it')
    : bad('the event was deleted out from under an answer')
  after?.cancelled_at ? ok('and is marked off') : bad('not cancelled')
  after?.cancellation_note === 'No longer in the league draw'
    ? ok(`with a reason: "${after.cancellation_note}"`)
    : bad(`note: ${JSON.stringify(after?.cancellation_note)}`)

  // The cancellation trigger must have told the team, same as any other.
  const { count: told } = await admin
    .from('notification_queue')
    .select('id', { count: 'exact', head: true })
    .eq('payload->>event_id', ev.id)
    .eq('kind', 'event_cancelled')
  told > 0
    ? ok(`${told} people told — it went through the ordinary cancellation path`)
    : bad('nobody was told a game was called off')
}

head('8. Not asking does not cancel anything')
{
  const { data: ev } = await admin
    .from('events')
    .select('id')
    .eq('external_ref', `${TAG}:far`)
    .single()
  // A file covering only the far date, mentioning nothing.
  const r = await commit([row('a', FAR, '09:00')], { cancelMissing: false })
  const { data: after } = await admin
    .from('events')
    .select('cancelled_at')
    .eq('id', ev.id)
    .maybeSingle()
  !after?.cancelled_at && r.cancelled === 0
    ? ok('a fixture the file omits survives an import that was not asked to cancel')
    : bad(`cancelled ${r.cancelled}, cancelled_at ${after?.cancelled_at}`)
}

head('9. A parent cannot preview somebody\'s draw')
{
  // A function that claims to change nothing can still leak everything.
  let refused = false
  try {
    await preview([row('a', DAY1, '09:00')], U8, parent)
  } catch {
    refused = true
  }
  refused ? ok('refused') : bad('a parent previewed an import')
}

// ---------------------------------------------------------------------------
// 0121: one export of the whole club, routed by what the league calls each
// squad.
// ---------------------------------------------------------------------------

const LEAGUE_U8 = `${TAG} NRFA U7  navy` // two spaces, as a real export has
const LEAGUE_U12 = `${TAG} NRFA U12 navy`

async function setLeagueNames(u8, u12, skipU12 = false) {
  await admin.from('teams').update({ external_ref: u8, skip_import: false }).eq('id', U8)
  await admin.from('teams').update({ external_ref: u12, skip_import: skipU12 }).eq('id', U12)
}
async function clearLeagueNames() {
  await admin.from('teams').update({ external_ref: null, skip_import: false }).in('id', [U8, U12])
}
await clearLeagueNames()

head('10. A row names its own squad, so one file serves the whole club')
{
  await clean()
  await setLeagueNames(LEAGUE_U8, LEAGUE_U12)

  // p_team is deliberately null: the rows carry their own squads, which is
  // what a club-wide export looks like.
  const file = [
    { ...row('r8', DAY1, '09:00'), team_id: U8 },
    { ...row('r12', DAY1, '13:00'), team_id: U12 },
  ]

  const p = await preview(file, null)
  count(p, 'new') === 2
    ? ok('2 new across two squads')
    : bad(`verdicts: ${JSON.stringify(p.rows.map((r) => r.verdict))}`)
  p.rows.every((r) => r.team)
    ? ok(`and each says where it is going (${p.rows.map((r) => r.team).join(', ')})`)
    : bad(`a row does not name its squad: ${JSON.stringify(p.rows)}`)

  const r = await commit(file, { team: null })
  r.created === 2 ? ok('both created') : bad(`created ${r.created}`)

  const { data: landed } = await admin
    .from('events')
    .select('external_ref, team_id')
    .like('external_ref', `${TAG}%`)
  const map = new Map(landed.map((e) => [e.external_ref, e.team_id]))
  map.get(`${TAG}:r8`) === U8 && map.get(`${TAG}:r12`) === U12
    ? ok('and each landed with the right squad')
    : bad(`routing: ${JSON.stringify([...map])}`)
}

head('11. A squad set to be left out is left out')
{
  await clean()
  await setLeagueNames(LEAGUE_U8, LEAGUE_U12, true)

  const file = [
    { ...row('keep', DAY1, '09:00'), team_id: U8 },
    { ...row('drop', DAY1, '13:00'), team_id: U12 },
  ]

  const p = await preview(file, null)
  const skipped = p.rows.filter((r) => r.verdict === 'skipped')
  skipped.length === 1 && /left out of imports/.test(skipped[0].reason ?? '')
    ? ok(`the preview says why ("${skipped[0].reason}")`)
    : bad(`verdicts: ${JSON.stringify(p.rows)}`)

  const r = await commit(file, { team: null })
  r.created === 1 && r.skipped === 1
    ? ok('1 created, 1 skipped')
    : bad(`created ${r.created}, skipped ${r.skipped}`)

  const { count: dropped } = await admin
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('external_ref', `${TAG}:drop`)
  dropped === 0
    ? ok("and nothing landed in that squad's families' calendars")
    : bad('the excluded squad got a fixture')
}

head('12. A coach cannot import into a squad they do not coach')
{
  // The authorisation used to be done ONCE, on the p_team argument, while the
  // rows went wherever they said. A coach of the U8s could have written
  // fixtures into the U12s by naming them in the payload.
  await clean()
  await clearLeagueNames()

  const marcus = await sess('p61400000002@squadroom.invalid')
  await admin.from('team_members').delete().eq('profile_id', marcus.id).eq('team_id', U12)
  // 0120: a team coach needs a current clearance, so one is recorded to set
  // this up — and removed again at the end.
  await admin.from('staff_clearances').insert({
    academy_id: NRIFA,
    profile_id: marcus.id,
    number: `${TAG}-WWC`,
    outcome: 'cleared',
    expires_on: new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10),
    verified_by: '00000000-0000-0000-0000-0000000000a1',
  })
  await admin
    .from('team_members')
    .insert({ academy_id: NRIFA, team_id: U8, profile_id: marcus.id, role: 'coach' })

  const sneaky = [{ ...row('sneak', DAY1, '09:00'), team_id: U12 }]
  const { error } = await commitAs(marcus, sneaky, { team: U8 })
  error ? ok(`refused per row (${error.code})`) : bad('a U8 coach wrote a fixture into the U12s')

  // Their own squad still works, so the check is about the squad and not
  // about being a lesser kind of coach.
  const own = [{ ...row('own', DAY1, '09:00'), team_id: U8 }]
  const { data: fine, error: ownError } = await commitAs(marcus, own, { team: U8 })
  if (ownError) bad(ownError.message)
  else
    fine?.created === 1
      ? ok('and their own squad still imports')
      : bad(`created ${fine?.created}`)

  await admin.from('team_members').delete().eq('profile_id', marcus.id).eq('team_id', U8)
  await admin.from('staff_clearances').delete().eq('number', `${TAG}-WWC`)
}

head('13. A squad in the file is not a licence to cancel another one')
{
  // "Missing" is scoped to the squads the FILE mentions. With per-row routing
  // there is no single p_team, and falling back to every squad in the window
  // would call off the U12s' game because the U8s' file did not mention it.
  await clean()
  await clearLeagueNames()

  await commit([{ ...row('u8keep', DAY1, '09:00'), team_id: U8 }], { team: null })
  await commit([{ ...row('u12keep', DAY1, '13:00'), team_id: U12 }], { team: null })

  // A U8-only file, same day, mentioning neither existing game.
  const r = await commit([{ ...row('u8new', DAY1, '15:00'), team_id: U8 }], {
    team: null,
    cancelMissing: true,
  })
  r.cancelled === 1 ? ok("the U8s' own missing game is called off") : bad(`cancelled ${r.cancelled}`)

  const { data: u12 } = await admin
    .from('events')
    .select('cancelled_at')
    .eq('external_ref', `${TAG}:u12keep`)
    .maybeSingle()
  !u12?.cancelled_at
    ? ok("and the U12s' game, on the same day, is untouched")
    : bad("another squad's game was called off by a file that never mentioned it")
}

await clearLeagueNames()

await clean()
console.log(
  process.exitCode ? '\n\x1b[31msome of this is wrong\x1b[0m' : '\n\x1b[32mall good\x1b[0m'
)
