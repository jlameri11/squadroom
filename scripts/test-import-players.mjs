// Run: node --env-file=.env.local scripts/test-import-players.mjs
//
// Proves 0100: importing a roster, and re-importing it.
//
// The assertion that matters most is the second import. A club exports its
// spreadsheet again after adding ten players — that is the normal case, not
// the edge case — and an importer without dedupe turns two hundred children
// into four hundred, which is unrecoverable by hand.
//
// The second is that a coach's edits survive. Between the two exports somebody
// corrected a name or set a shirt number in the app, and a spreadsheet is not
// more authoritative than the person who did that.
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
const SEASON = 'TESTIMP-2027'
const TAG = 'TESTIMP'

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
  const { data: made } = await admin
    .from('players')
    .select('id')
    .eq('academy_id', NRIFA)
    .like('full_name', `${TAG}%`)
  for (const p of made ?? []) {
    await admin.from('squad_numbers').delete().eq('player_id', p.id)
    await admin.from('event_attendance').delete().eq('player_id', p.id)
  }
  await admin.from('squad_numbers').delete().eq('academy_id', NRIFA).eq('season', SEASON)
  await admin.from('players').delete().eq('academy_id', NRIFA).like('full_name', `${TAG}%`)
  await admin.from('teams').delete().eq('academy_id', NRIFA).eq('name', `${TAG} Squad`)
}
await clean()

const { data: team } = await admin
  .from('teams')
  .insert({ academy_id: NRIFA, name: `${TAG} Squad`, age_group: 'U11', season: SEASON })
  .select('id')
  .single()

// What a club's spreadsheet actually looks like: a blank line, a date nobody
// can parse, and one child who goes by something else.
const FIRST_EXPORT = [
  { full_name: `${TAG} Ada Brown`, dob: '2016-03-04', gender: 'female', squad_number: '7' },
  { full_name: `${TAG} Ben Clarke`, dob: '2016-11-20', gender: 'male', preferred_name: 'Benno' },
  { full_name: `${TAG} Cara Diaz`, dob: '2016-07-01', gender: 'female', ff_number: 'FFA-991' },
  { full_name: '', dob: '' },
  { full_name: `${TAG} Dev Patel`, dob: 'not a date', gender: 'male' },
  { full_name: `${TAG} Elle Fisher`, dob: '2016-01-15', school: 'North Ryde PS' },
]

head('1. A parent cannot import a roster')
{
  const { error } = await parent.client.rpc('import_players', {
    p_academy: NRIFA,
    p_team: team.id,
    p_rows: [{ full_name: `${TAG} Intruder`, dob: '2016-01-01' }],
    p_season: SEASON,
  })
  error ? ok('refused') : bad('a parent imported players')
}

head('2. The first import')
{
  const { data, error } = await coach.client.rpc('import_players', {
    p_academy: NRIFA,
    p_team: team.id,
    p_rows: FIRST_EXPORT,
    p_season: SEASON,
  })
  if (error) {
    bad(error.message)
    await clean()
    process.exit(1)
  }
  data.created === 4 ? ok(`${data.created} created`) : bad(`created ${data.created}, expected 4`)
  data.matched === 0 ? ok('nothing matched, because the club was empty') : bad(`matched ${data.matched}`)
  data.numbered === 1 ? ok('1 shirt number assigned') : bad(`numbered ${data.numbered}`)

  // The blank line is skipped silently; the unreadable date is REPORTED.
  const problems = data.problems ?? []
  problems.length === 1
    ? ok(`1 row reported: "${problems[0].problem}"`)
    : bad(`${problems.length} problems reported, expected 1`)
  problems[0]?.name?.includes('Dev Patel')
    ? ok('and it names the child, so a coach can find the line')
    : bad('the problem does not say which row')

  const { data: rows } = await admin
    .from('players')
    .select('full_name, preferred_name, ff_number, school, team_id')
    .eq('academy_id', NRIFA)
    .like('full_name', `${TAG}%`)
  rows.length === 4 ? ok('4 on the roster') : bad(`${rows.length} on the roster`)
  rows.every((r) => r.team_id === team.id) ? ok('all in the squad') : bad('some have no team')
  rows.find((r) => r.full_name.includes('Ben'))?.preferred_name === 'Benno'
    ? ok('and "goes by" came through')
    : bad('preferred_name was dropped')
}

head('3. Re-importing the same file creates nothing')
{
  // The whole point. A club exports again after adding players.
  const { data, error } = await coach.client.rpc('import_players', {
    p_academy: NRIFA,
    p_team: team.id,
    p_rows: FIRST_EXPORT,
    p_season: SEASON,
  })
  error
    ? bad(error.message)
    : data.created === 0 && data.matched === 4
      ? ok('0 created, 4 matched — name + gender + date of birth, Dribl\'s own rule')
      : bad(`created ${data.created}, matched ${data.matched}`)

  const { count } = await admin
    .from('players')
    .select('id', { count: 'exact', head: true })
    .eq('academy_id', NRIFA)
    .like('full_name', `${TAG}%`)
  count === 4 ? ok('still 4 children, not 8') : bad(`${count} children after re-import`)
}

head("4. A coach's edits survive the next export")
{
  // Somebody set a preferred name in the app. The spreadsheet does not have
  // one, and must not blank it.
  const { data: cara } = await admin
    .from('players')
    .select('id')
    .eq('academy_id', NRIFA)
    .like('full_name', `${TAG} Cara%`)
    .single()
  await admin
    .from('players')
    .update({ preferred_name: 'Caz', school: 'Set by the coach' })
    .eq('id', cara.id)

  await coach.client.rpc('import_players', {
    p_academy: NRIFA,
    p_team: team.id,
    p_rows: FIRST_EXPORT,
    p_season: SEASON,
  })

  const { data: after } = await admin
    .from('players')
    .select('preferred_name, school, ff_number')
    .eq('id', cara.id)
    .single()
  after.preferred_name === 'Caz'
    ? ok('a preferred name set in the app is not blanked by a file without one')
    : bad(`preferred_name became ${JSON.stringify(after.preferred_name)}`)
  after.school === 'Set by the coach'
    ? ok('nor is a school')
    : bad(`school became ${JSON.stringify(after.school)}`)
  after.ff_number === 'FFA-991' ? ok('and the file still filled a blank field') : bad('ff_number lost')
}

head('5. A date read the wrong way round is caught')
{
  const { data } = await coach.client.rpc('import_players', {
    p_academy: NRIFA,
    p_team: team.id,
    // 2040 is what you get reading a two-digit year wrongly, and a child born
    // in the future is worth stopping on rather than importing.
    p_rows: [{ full_name: `${TAG} Future Child`, dob: '2040-01-01' }],
  })
  const problems = data?.problems ?? []
  problems.length === 1 && /day\/month|check/.test(problems[0].problem)
    ? ok(`refused: "${problems[0].problem}"`)
    : bad(`a child born in 2040 was imported (${JSON.stringify(problems)})`)
}

head('6. A clashing shirt number costs one row, not the import')
{
  const { data: taken } = await admin
    .from('squad_numbers')
    .select('number')
    .eq('academy_id', NRIFA)
    .eq('season', SEASON)
    .limit(1)
    .single()
  const { data, error } = await coach.client.rpc('import_players', {
    p_academy: NRIFA,
    p_team: team.id,
    p_rows: [
      { full_name: `${TAG} Gina Hall`, dob: '2016-05-05', squad_number: String(taken.number) },
      { full_name: `${TAG} Hugo Ives`, dob: '2016-06-06', squad_number: '88' },
    ],
    p_season: SEASON,
  })
  if (error) {
    bad(`the whole import failed on one clash: ${error.message}`)
  } else {
    data.created === 2 ? ok('both children created') : bad(`created ${data.created}`)
    ;(data.problems ?? []).some((p) => /already taken/.test(p.problem))
      ? ok('and the clash is reported rather than thrown')
      : bad('the clash was silent')
    data.numbered === 1 ? ok('one number assigned, one refused') : bad(`numbered ${data.numbered}`)
  }
}

head('7. No guardian is ever imported')
{
  // CLAUDE.md forbids a bulk contact upload, and a spreadsheet column of
  // parent phone numbers is that upload wearing a different hat. Asserted so
  // that nobody adds it later without reading why.
  const { data } = await coach.client.rpc('import_players', {
    p_academy: NRIFA,
    p_team: team.id,
    p_rows: [
      {
        full_name: `${TAG} Ivy Jones`,
        dob: '2016-08-08',
        guardian_name: 'Should Be Ignored',
        guardian_phone: '0400000999',
        guardian_email: 'nobody@example.com',
      },
    ],
  })
  data.created === 1 ? ok('the child was imported') : bad('the child was not imported')

  const { data: child } = await admin
    .from('players')
    .select('id')
    .eq('academy_id', NRIFA)
    .like('full_name', `${TAG} Ivy%`)
    .single()
  const { count: guardians } = await admin
    .from('player_guardians')
    .select('id', { count: 'exact', head: true })
    .eq('player_id', child.id)
  guardians === 0 ? ok('and no guardian was created from the file') : bad(`${guardians} guardians imported`)

  const { count: strangers } = await admin
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('full_name', 'Should Be Ignored')
  strangers === 0 ? ok('and no profile for a stranger') : bad('a profile was created from a spreadsheet')
}

head('8. An outsider cannot import into this academy')
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
  const { error } = await outsider.client.rpc('import_players', {
    p_academy: NRIFA,
    p_team: team.id,
    p_rows: [{ full_name: `${TAG} Hijack`, dob: '2016-01-01' }],
  })
  error ? ok('refused') : bad("an outsider imported into another academy's squad")
}

await clean()
console.log(
  process.exitCode
    ? '\n\x1b[31mROSTER IMPORT BROKEN\x1b[0m\n'
    : '\n\x1b[32mA roster imports once, and re-imports without duplicating.\x1b[0m\n'
)
process.exit(process.exitCode ?? 0)
