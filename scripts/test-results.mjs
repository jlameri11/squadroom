// Run: node --env-file=.env.local scripts/test-results.mjs
//
// Proves 0118 (X-05, the Result half): what happened on Saturday.
//
// The assertion that carries the weight is the one about TWO PLACES. A
// competition fixture already carries a score, and the ladder is computed
// from it; an ordinary imported game now carries its own. If both could hold
// a score for the same game then the number a parent reads on Sunday morning
// would not be the number the table was built from, and nobody would notice
// until a club argued about a position. So: the writer refuses an event that
// has a fixture, and the reader prefers the fixture.
//
// And the one about SIGNS. Ours and theirs, not home and away — a fixture
// where this academy is the AWAY entry must report the away score as "ours",
// or a 3-0 win is shown as a 0-3 loss on the one screen a parent opens.
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
const TAG = 'TESTRESULT'

async function sess(email) {
  // generateLink is rate limited per project too, not just verifyOtp, and
  // when it trips `link` comes back null — so reading link.properties throws
  // before the check below ever runs. Every suite here has the same helper
  // and the same hole; the runner only recognises the verifyOtp half of it,
  // so this crash would be reported as a product failure.
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
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
    .like('title', `${TAG}%`)
  for (const e of evs ?? []) {
    await admin.from('notification_queue').delete().eq('payload->>event_id', e.id)
    await admin.from('event_rsvps').delete().eq('event_id', e.id)
  }
  await admin.from('events').delete().eq('academy_id', NRIFA).like('title', `${TAG}%`)
}
await clean()

const make = async (extra = {}) => {
  const { data, error } = await admin
    .from('events')
    .insert({
      academy_id: NRIFA,
      team_id: U8,
      type: 'match',
      title: `${TAG} vs Gladesville`,
      // Yesterday. A result is about a game that has been played.
      starts_at: new Date(Date.now() - 864e5).toISOString(),
      ends_at: new Date(Date.now() - 864e5 + 36e5).toISOString(),
      venue: 'ELS Hall Park',
      source: 'manual',
      ...extra,
    })
    .select('id')
    .single()
  if (error) {
    bad(error.message)
    process.exit(1)
  }
  return data.id
}

const setResult = (who, id, ours, theirs, note, home) =>
  who.client.rpc('set_event_result', {
    p_event: id,
    p_ours: ours,
    p_theirs: theirs,
    p_note: note ?? null,
    p_home: home ?? null,
  })

const readResult = async (who, id) => {
  const { data, error } = await who.client.rpc('event_result', { p_event: id })
  if (error) throw new Error(error.message)
  return data?.[0] ?? null
}

head('1. A coach records a result, and everyone in the squad can read it')
{
  const id = await make()
  const { error } = await setResult(coach, id, 3, 1, 'Two from Leo', true)
  if (error) {
    bad(error.message)
  } else {
    const r = await readResult(coach, id)
    r?.ours === 3 && r?.theirs === 1 ? ok('3-1') : bad(`read back ${JSON.stringify(r)}`)
    r?.outcome === 'won' ? ok('outcome: won') : bad(`outcome ${r?.outcome}`)
    r?.note === 'Two from Leo' ? ok('and the note') : bad(`note ${JSON.stringify(r?.note)}`)
    r?.source === 'event' ? ok('stored on the event') : bad(`source ${r?.source}`)
    r?.entered_by ? ok(`entered by ${r.entered_by}`) : bad('nobody named')

    const asParent = await readResult(parent, id)
    asParent?.ours === 3
      ? ok('a parent in the squad reads the same score')
      : bad(`parent saw ${JSON.stringify(asParent)}`)
  }
}

head('2. The outcome is from this academy\'s point of view, never the scoreline\'s')
{
  for (const [ours, theirs, want] of [
    [0, 2, 'lost'],
    [2, 2, 'drew'],
    [0, 0, 'drew'],
  ]) {
    const id = await make()
    await setResult(coach, id, ours, theirs)
    const r = await readResult(coach, id)
    r?.outcome === want
      ? ok(`${ours}-${theirs} is "${want}"`)
      : bad(`${ours}-${theirs} came back "${r?.outcome}"`)
  }
}

head('3. A parent cannot record one')
{
  const id = await make()
  const { error } = await setResult(parent, id, 9, 0)
  error ? ok(`refused (${error.code})`) : bad('a parent entered a score')
}

head('4. A game that has not been played has no result')
{
  const id = await make({
    starts_at: new Date(Date.now() + 3 * 864e5).toISOString(),
    ends_at: new Date(Date.now() + 3 * 864e5 + 36e5).toISOString(),
  })
  const { error } = await setResult(coach, id, 3, 0)
  error
    ? ok('refused — a result for next Saturday is a typo or a prank')
    : bad('a future game was given a score')
}

head('5. Half a score is refused by the database, not the form')
{
  const id = await make()
  const { error } = await admin
    .from('events')
    .update({ our_score: 3, their_score: null })
    .eq('id', id)
  error
    ? ok('3-null refused — it would render as "3-" for three days')
    : bad('a half-entered score was accepted')

  const { error: silly } = await admin
    .from('events')
    .update({ our_score: -1, their_score: 0 })
    .eq('id', id)
  silly ? ok('and a negative score is a minus key, not a result') : bad('-1 was accepted')
}

head('6. Clearing is allowed — it is the only way to undo a typo')
{
  const id = await make()
  await setResult(coach, id, 7, 0)
  const { error } = await setResult(coach, id, null, null)
  if (error) {
    bad(error.message)
  } else {
    const r = await readResult(coach, id)
    r === null ? ok('the result is gone') : bad(`still reads ${JSON.stringify(r)}`)
    const { data: row } = await admin
      .from('events')
      .select('score_entered_by, score_entered_at')
      .eq('id', id)
      .single()
    !row.score_entered_by && !row.score_entered_at
      ? ok('and nobody is named for a result that is not there')
      : bad(`still attributed to ${row.score_entered_by}`)
  }
}

head('7. Only a match has a result')
{
  const id = await make({ type: 'training', title: `${TAG} Tuesday training` })
  const { error } = await setResult(coach, id, 1, 0)
  error ? ok('training has no score') : bad('a training session was given a result')
}

head('8. A competition game keeps ONE score, on the fixture')
{
  // Using the event the fixture ALREADY mirrored into this academy, not a new
  // one — `events_one_per_fixture_per_club` exists precisely so a fixture
  // cannot sprout a second event per club, and the first version of this step
  // tried to make one and was refused by that constraint. The constraint was
  // right and the test was wrong.
  const { data: mirrored } = await admin
    .from('events')
    .select('id, team_id, fixture_id, academy_id')
    .eq('academy_id', NRIFA)
    .not('fixture_id', 'is', null)
    .limit(20)

  let checked = false
  for (const ev of mirrored ?? []) {
    const { data: fix } = await admin
      .from('fixtures')
      .select('id, home_entry_id, away_entry_id, home_score, away_score')
      .eq('id', ev.fixture_id)
      .maybeSingle()
    if (!fix || fix.home_score === null) continue

    const { data: entries } = await admin
      .from('competition_entries')
      .select('id, team_id')
      .in('id', [fix.home_entry_id, fix.away_entry_id])
    const home = entries.find((e) => e.id === fix.home_entry_id)
    const weAreHome = home?.team_id === ev.team_id
    // The away case is the one that matters: if the resolver returned the
    // home score regardless, a 3-0 win would read as a 0-3 loss on the one
    // screen a parent opens on Sunday morning.
    const wantOurs = weAreHome ? fix.home_score : fix.away_score
    const wantTheirs = weAreHome ? fix.away_score : fix.home_score

    const { error } = await setResult(coach, ev.id, 5, 5)
    error
      ? ok('writing a second score onto the event is refused')
      : bad('the same game now has two different results')

    const r = await readResult(coach, ev.id)
    r?.source === 'fixture' ? ok("the fixture's score is what is read") : bad(`source ${r?.source}`)
    r?.ours === wantOurs && r?.theirs === wantTheirs
      ? ok(`${r.ours}-${r.theirs}, and we were ${weAreHome ? 'home' : 'away'}`)
      : bad(`read ${r?.ours}-${r?.theirs}, expected ${wantOurs}-${wantTheirs}`)
    checked = true
    break
  }
  if (!checked) ok('(no scored competition fixture mirrored into this academy to check)')
}

head('9. A result answers to the same visibility rule as its game')
{
  // Specifically `private_to`, the fourth visibility rule, which every reader
  // has to honour — a FOR ALL policy once beat it and a coach read every
  // parent's private events for three weeks. event_result is a new reader, so
  // it is a new chance to miss it.
  //
  // Checked with the sessions already open rather than a third sign-in: every
  // sign-in in this file comes out of the same per-project auth budget, and a
  // suite that cannot run is a suite that proves nothing.
  // `events_private_has_no_team` — a private event belongs to one person, so
  // it cannot also belong to a squad. Which makes this the stronger test:
  // an event with no team is otherwise visible to the WHOLE academy, so
  // private_to is the only thing standing between this result and everyone.
  const id = await make({ private_to: coach.id, team_id: null })
  await setResult(coach, id, 4, 0)

  const mine = await readResult(coach, id)
  mine?.ours === 4 ? ok('the person it belongs to reads it') : bad(`owner saw ${JSON.stringify(mine)}`)

  const theirs = await readResult(parent, id)
  theirs === null
    ? ok('and nobody else does, though an event with no team is otherwise academy-wide')
    : bad(`a private game's result leaked: ${JSON.stringify(theirs)}`)
}

await clean()
console.log(
  process.exitCode ? '\n\x1b[31msome of this is wrong\x1b[0m' : '\n\x1b[32mall good\x1b[0m'
)
