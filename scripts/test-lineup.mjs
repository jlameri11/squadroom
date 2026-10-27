// Run: node --env-file=.env.local scripts/test-lineup.mjs
//
// Proves 0125 (X-05's Lineup): the team sheet.
//
// The feature is a DRAFT and a published version, and everything worth
// testing follows from that:
//
//   · an unpublished sheet is invisible to parents — and invisible means
//     nothing comes back, not an empty sheet, which would read as a decision
//     to play nobody
//   · publishing is deliberate, and retractable, because a side named for the
//     wrong game has to be takeable back without deleting it
//   · the sheet is replaced wholesale, so a coach who drops a player does not
//     end up with twelve starters
//   · a child from another squad cannot be named
//
// And the one thing it deliberately does NOT do: refuse a starter whose
// family said they cannot play. A coach may know something the form does not.
// It has to be visible, not forbidden.
import { createClient } from '@supabase/supabase-js'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})
const anon = createClient(URL_, PUB, { auth: { persistSession: false } })

/**
 * A client that has never signed in, and never will.
 *
 * `anon` is the client every suite here hands to verifyOtp, which means that
 * after the first sign-in it holds a SESSION and is not anonymous any more.
 * Every "as a stranger" assertion made through it after that point was
 * really being made as whoever signed in last — passing, in at least one
 * case, for entirely the wrong reason.
 *
 * So the stranger gets their own client, used for nothing else.
 */
const stranger = createClient(URL_, PUB, { auth: { persistSession: false } })


const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`)
  process.exitCode = 1
}
const head = (m) => console.log(`\n${m}`)

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const U8 = '00000000-0000-0000-0000-0000000d0008'
const U12 = '00000000-0000-0000-0000-0000000d0012'
const LEO = '00000000-0000-0000-0000-0000000e0001'
const ZOE = '00000000-0000-0000-0000-0000000e0006'
const TAG = 'TESTLINEUP'

async function sess(email) {
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (!link?.properties?.hashed_token) {
    console.log("  could not issue a magic link — the project's auth rate limit, not a failure")
    process.exit(2)
  }
  const { data: s } = await anon.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: 'email',
  })
  if (!s?.session) {
    console.log("  could not sign in — the project's auth rate limit, not a failure")
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
const parent = await sess('p61400000011@squadroom.invalid') // Leo and Zoe's

async function clean() {
  const { data: evs } = await admin
    .from('events')
    .select('id')
    .eq('academy_id', NRIFA)
    .like('title', `${TAG}%`)
  for (const e of evs ?? []) {
    await admin.from('notification_queue').delete().eq('payload->>event_id', e.id)
    await admin.from('event_rsvps').delete().eq('event_id', e.id)
    await admin.from('event_lineups').delete().eq('event_id', e.id)
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
      starts_at: new Date(Date.now() + 3 * 864e5).toISOString(),
      ends_at: new Date(Date.now() + 3 * 864e5 + 36e5).toISOString(),
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

// The U8 squad, so the sheet is built from real players.
const { data: squad } = await admin
  .from('players')
  .select('id, full_name')
  .eq('team_id', U8)
  .order('full_name')
  .limit(12)

const event = await make()
const sheet = (players, formation) =>
  coach.client.rpc('set_lineup', {
    p_event: event,
    p_players: players,
    p_formation: formation ?? null,
  })
const read = async (who) => {
  const { data, error } = await who.client.rpc('event_lineup', { p_event: event })
  if (error) throw new Error(error.message)
  return data
}

head('1. Before there is a sheet')
{
  const asCoach = await read(coach)
  asCoach?.can_pick === true && asCoach?.lineup === null
    ? ok('a coach is told there is none, so a screen can offer to make one')
    : bad(`coach saw ${JSON.stringify(asCoach)}`)

  // Not an empty sheet. An empty sheet reads as a decision to play nobody,
  // and the absence of one must not be information either.
  const asParent = await read(parent)
  asParent === null ? ok('a parent sees nothing at all') : bad(`parent saw ${JSON.stringify(asParent)}`)
}

head('2. A coach picks a side')
{
  const players = squad.slice(0, 9).map((p, i) => ({
    player_id: p.id,
    role: i < 7 ? 'starting' : 'bench',
    position: i === 0 ? 'GK' : null,
    sort_order: i + 1,
  }))
  const { error } = await sheet(players, '2-3-1')
  if (error) {
    bad(error.message)
  } else {
    const d = await read(coach)
    d.lineup.players.length === 9 ? ok('9 named') : bad(`${d.lineup.players.length} named`)
    d.lineup.players.filter((p) => p.role === 'starting').length === 7
      ? ok('7 starting, 2 on the bench')
      : bad(`starting: ${d.lineup.players.filter((p) => p.role === 'starting').length}`)
    d.lineup.formation === '2-3-1' ? ok('with the formation') : bad(`formation ${d.lineup.formation}`)
    d.lineup.players.find((p) => p.position === 'GK') ? ok('and a keeper') : bad('no position kept')
    d.lineup.published_at === null ? ok('and it is a draft') : bad('it published itself')
  }
}

head('3. A draft is nobody else’s business')
{
  const asParent = await read(parent)
  asParent === null
    ? ok("a parent cannot see a side the coach is still thinking about")
    : bad(`parent read an unpublished sheet: ${JSON.stringify(asParent).slice(0, 120)}`)

  // Nor through the table, which is the gap a policy would leave if the read
  // rule lived only in the function.
  const { data: rows } = await parent.client.from('event_lineup_players').select('player_id')
  ;(rows ?? []).length === 0
    ? ok('and not through the table either')
    : bad(`a parent read ${rows.length} lineup rows directly`)
}

head('4. Publishing is deliberate, and can be undone')
{
  const { error } = await coach.client.rpc('publish_lineup', { p_event: event })
  if (error) {
    bad(error.message)
  } else {
    const asParent = await read(parent)
    asParent?.lineup?.players?.length === 9
      ? ok('published — the parent sees the side')
      : bad(`parent saw ${JSON.stringify(asParent)?.slice(0, 120)}`)
    asParent?.can_pick === false ? ok('and is told they cannot edit it') : bad('can_pick wrong for a parent')

    // A side named for the wrong game has to be retractable, or a coach
    // deletes the whole sheet to hide it.
    await coach.client.rpc('publish_lineup', { p_event: event, p_published: false })
    const after = await read(parent)
    after === null ? ok('and it can be taken back') : bad('unpublishing did not hide it')
    await coach.client.rpc('publish_lineup', { p_event: event })
  }
}

head('5. The sheet is replaced, not merged')
{
  // Naming five after naming nine must leave five. A partial update is how a
  // product ends up with twelve starters because the delete failed and the
  // insert did not.
  const players = squad.slice(0, 5).map((p, i) => ({
    player_id: p.id,
    role: 'starting',
    sort_order: i + 1,
  }))
  await sheet(players)
  const d = await read(coach)
  d.lineup.players.length === 5
    ? ok('9 became 5, not 14')
    : bad(`${d.lineup.players.length} on the sheet`)

  // And publishing survives a re-pick: a coach fixing a name should not have
  // to remember to publish again.
  d.lineup.published_at ? ok('and it is still published') : bad('re-picking unpublished it')
}

head('6. A child from another squad cannot be named')
{
  const { data: other } = await admin
    .from('players')
    .select('id, full_name')
    .eq('team_id', U12)
    .limit(1)
    .maybeSingle()
  if (!other) {
    ok('(no other squad to try)')
  } else {
    const { error } = await sheet([{ player_id: other.id, role: 'starting' }])
    error
      ? ok(`refused — ${other.full_name} is not in this squad`)
      : bad('a child from another squad was named')
  }

  // And the sheet is unchanged by a refused call, because the whole thing
  // runs in one statement.
  const d = await read(coach)
  d.lineup.players.length === 5
    ? ok('and the refused call changed nothing')
    : bad(`the sheet is now ${d.lineup.players.length}`)
}

head('7. A parent cannot pick the side')
{
  const { error } = await parent.client.rpc('set_lineup', {
    p_event: event,
    p_players: [{ player_id: LEO, role: 'starting' }],
  })
  error ? ok(`refused (${error.code})`) : bad('a parent picked the team')

  const { error: pub } = await parent.client.rpc('publish_lineup', { p_event: event })
  pub ? ok('and cannot publish one') : bad('a parent published a lineup')
}

head('8. A starter whose family said no is shown, not refused')
{
  // The clash a coach needs to see. NOT enforced: a coach may know something
  // the form does not, and a product that refuses the sheet sends them back
  // to paper.
  await admin.from('event_rsvps').insert({
    academy_id: NRIFA,
    event_id: event,
    profile_id: parent.id,
    player_id: LEO,
    status: 'no',
    note: 'Away that weekend',
  })

  const { error } = await sheet([
    { player_id: LEO, role: 'starting', sort_order: 1 },
    { player_id: ZOE, role: 'bench', sort_order: 2 },
  ])
  error ? bad(`refused a starter who said no: ${error.message}`) : ok('the sheet saves')

  const d = await read(coach)
  const leo = d.lineup.players.find((p) => p.player_id === LEO)
  leo?.rsvp === 'no'
    ? ok(`and says so on the sheet (${leo.name} — ${leo.rsvp})`)
    : bad(`rsvp came back ${JSON.stringify(leo?.rsvp)}`)
}

head('9. Only a match has a team sheet')
{
  const training = await make({ type: 'training', title: `${TAG} Tuesday training` })
  const { error } = await coach.client.rpc('set_lineup', {
    p_event: training,
    p_players: [{ player_id: LEO, role: 'starting' }],
  })
  error ? ok('training has none') : bad('a training session got a team sheet')
}

head('10. A private game’s sheet follows the game')
{
  // private_to is the fourth visibility rule and every reader has to honour
  // it. event_lineup is a new reader.
  const priv = await make({ private_to: coach.id, team_id: null, title: `${TAG} private` })
  await coach.client.rpc('set_lineup', {
    p_event: priv,
    p_players: [{ player_id: LEO, role: 'starting' }],
  })
  await coach.client.rpc('publish_lineup', { p_event: priv })

  const { data: asParent } = await parent.client.rpc('event_lineup', { p_event: priv })
  asParent === null
    ? ok('published, and still invisible to everyone else')
    : bad(`a private game's sheet leaked: ${JSON.stringify(asParent).slice(0, 120)}`)
}

head('11. Nothing of this is public')
{
  const { error } = await stranger.rpc('event_lineup', { p_event: event })
  error ? ok(`anon cannot call it (${error.code})`) : bad('anon read a team sheet')

  const { data: centre } = await stranger.rpc('public_match_centre', { p_slug: 'nrifa' })
  const blob = JSON.stringify(centre ?? {})
  const named = (squad ?? [])
    .map((p) => p.full_name.split(' ')[0])
    .filter((n) => n.length > 2 && blob.includes(n))
  named.length === 0
    ? ok('and no child from the sheet appears on the public page')
    : bad(`the public page names ${named.join(', ')}`)
}

await clean()
console.log(
  process.exitCode ? '\n\x1b[31msome of this is wrong\x1b[0m' : '\n\x1b[32mall good\x1b[0m'
)
