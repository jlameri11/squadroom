// Run: node --env-file=.env.local scripts/test-kit.mjs
//
// Proves 0123 (R-05's last field, R-09's kit list): what size do they take.
//
// The feature is the COUNT, not the field. A club orders kit by counting, so
// the assertions are about the ways a count goes wrong:
//
//   · a vocabulary that lets "10" and "Size 10" both in, which is five sizes
//     to a database and one size to a human
//   · a blank that is silently treated as a size, so a club orders 20 shirts
//     for a squad of 24
//   · a size nobody can record, which is what happens when a product has no
//     player edit screen and only collects sizes at registration
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
const TAG = 'TESTKIT'

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

const owner = await sess('joeylameri@outlook.com')
const parent = await sess('p61400000011@squadroom.invalid')

async function clean() {
  await admin.from('players').delete().eq('academy_id', NRIFA).like('full_name', `${TAG}%`)
}
await clean()

// Four of our own players, so the counts are ours and not whatever the demo
// roster happens to hold.
const made = []
for (const [name, shirt] of [
  [`${TAG} Ann`, '10'],
  [`${TAG} Ben`, '10'],
  [`${TAG} Cal`, '12'],
  [`${TAG} Dee`, null],
]) {
  const { data, error } = await admin
    .from('players')
    .insert({
      academy_id: NRIFA,
      team_id: U8,
      full_name: name,
      dob: '2017-05-05',
      shirt_size: shirt,
    })
    .select('id')
    .single()
  if (error) {
    bad(error.message)
    process.exit(1)
  }
  made.push({ id: data.id, name, shirt })
}

head('1. The vocabulary is fixed, which is the whole point')
{
  // Free text would give a club "10", "Size 10", "size10", "10Y" and " 10" —
  // five sizes to a database and one size to a human — and the export would
  // become a list to be retyped by hand.
  for (const junk of ['Size 10', '10Y', 'medium', '  10', '11']) {
    const { error } = await admin
      .from('players')
      .update({ shirt_size: junk })
      .eq('id', made[0].id)
    error
      ? ok(`"${junk}" is refused`)
      : bad(`"${junk}" was accepted — the count is now wrong`)
  }

  // And a sock size is not a shirt size. Junior football socks are sold by
  // shoe size, so a sock column constrained to S/M/L would force a club to
  // invent a mapping and then remember it.
  const { error: wrongList } = await admin
    .from('players')
    .update({ socks_size: 'M' })
    .eq('id', made[0].id)
  wrongList ? ok('a shirt size is refused for socks') : bad("'M' was accepted as a sock size")

  const { error: right } = await admin
    .from('players')
    .update({ socks_size: 'K13-3' })
    .eq('id', made[0].id)
  right ? bad(right.message) : ok("and a shoe-size range is accepted ('K13-3')")
}

head('2. A coach can record one, because otherwise nobody can')
{
  // There is no player edit screen in this product. Without this function a
  // club whose roster was imported last season could never produce a kit
  // list, and the feature would only work for families registering after
  // today.
  const { error } = await owner.client.rpc('set_kit_sizes', {
    p_player: made[3].id,
    p_shirt: '12',
    p_shorts: '12',
    p_socks: '2-7',
  })
  if (error) {
    bad(error.message)
  } else {
    const { data } = await admin
      .from('players')
      .select('shirt_size, shorts_size, socks_size')
      .eq('id', made[3].id)
      .single()
    data.shirt_size === '12' && data.shorts_size === '12' && data.socks_size === '2-7'
      ? ok('recorded')
      : bad(`stored ${JSON.stringify(data)}`)
  }

  // Clearing has to work: a size typed into the wrong row is worse than a
  // blank, because a blank is a question a club asks and a wrong size is a
  // shirt discovered not to fit on the first morning.
  await owner.client.rpc('set_kit_sizes', { p_player: made[3].id })
  const { data: cleared } = await admin
    .from('players')
    .select('shirt_size')
    .eq('id', made[3].id)
    .single()
  cleared.shirt_size === null ? ok('and can be cleared again') : bad(`still ${cleared.shirt_size}`)

  const { error: asParent } = await parent.client.rpc('set_kit_sizes', {
    p_player: made[0].id,
    p_shirt: '16',
  })
  asParent ? ok(`a parent cannot (${asParent.code})`) : bad('a parent set a kit size')
}

head('3. The list counts what to order')
{
  const { data, error } = await owner.client.rpc('kit_list', {
    p_academy: NRIFA,
    p_team: U8,
  })
  if (error) {
    bad(error.message)
  } else {
    const shirts = data.counts.filter((c) => c.garment === 'shirt')
    const ten = shirts.find((c) => c.size === '10')
    const twelve = shirts.find((c) => c.size === '12')
    ten?.n >= 2 ? ok(`${ten.n} × size 10`) : bad(`size 10 count: ${JSON.stringify(ten)}`)
    twelve?.n >= 1 ? ok(`${twelve.n} × size 12`) : bad(`size 12 count: ${JSON.stringify(twelve)}`)

    // The number that stops a club ordering 20 shirts for a squad of 24.
    // Part of the answer rather than something a screen works out, so the
    // two cannot disagree.
    const names = data.players.filter((p) => p.name.startsWith(TAG))
    const blanks = names.filter((p) => !p.shirt_size).length
    data.missing.shirt >= blanks && blanks > 0
      ? ok(`and ${data.missing.shirt} with no shirt size recorded`)
      : bad(`missing.shirt ${data.missing.shirt}, blanks among ours ${blanks}`)

    // The counts have to add up to the players who HAVE a size, or an order
    // is short by however many the sum quietly dropped.
    const sized = names.filter((p) => p.shirt_size).length
    const ourSizes = new Set(names.filter((p) => p.shirt_size).map((p) => p.shirt_size))
    const summed = shirts
      .filter((c) => ourSizes.has(c.size))
      .reduce((n, c) => n + c.n, 0)
    summed >= sized
      ? ok(`the counts account for all ${sized} sized players`)
      : bad(`summed ${summed} but ${sized} have a size`)

    data.players.every((p) => 'squad_number' in p)
      ? ok('and each player carries their number, for the printer')
      : bad('no squad number on the list')
  }
}

head('4. A kit list is the whole roster with a measurement beside each name')
{
  // Which is not a parent's business, and not a coach-of-another-squad's.
  const { data: asParent } = await parent.client.rpc('kit_list', { p_academy: NRIFA })
  asParent === null ? ok('a parent gets nothing') : bad(`a parent read ${JSON.stringify(asParent).length} bytes`)

  const { data: asAnon } = await stranger.rpc('kit_list', { p_academy: NRIFA })
  asAnon === null ? ok('and a stranger gets nothing') : bad('anon read the kit list')
}

head('5. Another academy is not in the count')
{
  const { data } = await owner.client.rpc('kit_list', { p_academy: NRIFA })
  const { data: theirs } = await admin
    .from('players')
    .select('full_name')
    .neq('academy_id', NRIFA)
    .limit(30)
  const names = new Set(data.players.map((p) => p.name))
  const leaked = (theirs ?? []).filter((p) => names.has(p.full_name))
  leaked.length === 0
    ? ok(`${data.players.length} players, all this academy's`)
    : bad(`another academy's players in the list: ${leaked.length}`)
}

await clean()
console.log(
  process.exitCode ? '\n\x1b[31msome of this is wrong\x1b[0m' : '\n\x1b[32mall good\x1b[0m'
)
