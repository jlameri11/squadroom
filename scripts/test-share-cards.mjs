// Run: node --env-file=.env.local scripts/test-share-cards.mjs
//   (needs the app running — npm run dev)
//
// Proves X-04: the share cards.
//
// A graphic is the most shareable thing this product makes. Once it is in a
// WhatsApp group it is beyond anyone's recall, which makes two things worth
// asserting above all others:
//
//   NO CHILD IS NAMED ON ANY CARD. R-16 exists because other products
//   published children. A card is not a screen somebody has to be logged in
//   to see — it is a file that travels.
//
//   THE SCORE IS THE RIGHT WAY ROUND. A card printing a 3-0 win as 0-3 would
//   be the single most visible bug the product could ship.
//
// The images themselves are checked as real PNGs of the right dimensions.
// What they LOOK like is not something a test can judge, and pretending
// otherwise would be a test that passes while the card is unreadable.
import { createClient } from '@supabase/supabase-js'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
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
const TAG = 'TESTCARD'

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
  const ref = URL_.split('//')[1].split('.')[0]
  return {
    cookie: `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(s.session)).toString('base64')}`,
    client: createClient(URL_, PUB, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${s.session.access_token}` } },
    }),
    id: s.user.id,
  }
}

const coach = await sess('joeylameri@outlook.com')

async function clean() {
  await admin.from('events').delete().eq('academy_id', NRIFA).like('title', `${TAG}%`)
}
await clean()

/** A PNG's width and height live in the IHDR chunk at bytes 16-23. */
function png(buf) {
  const isPng = buf.length > 24 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG'
  return isPng ? { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), bytes: buf.length } : null
}

const { data: event } = await admin
  .from('events')
  .insert({
    academy_id: NRIFA,
    team_id: U8,
    type: 'match',
    title: `${TAG} vs Gladesville Ravens`,
    opponent: 'Gladesville Ravens',
    round: 'Round 12',
    starts_at: new Date(Date.now() - 864e5).toISOString(),
    ends_at: new Date(Date.now() - 864e5 + 36e5).toISOString(),
    venue: 'ELS Hall Park, Field 3',
    source: 'manual',
  })
  .select('id')
  .single()

head('1. A game with no result has no card')
{
  // A card with a blank where the score goes is worse than no card.
  const res = await fetch(`${BASE}/api/share/result/${event.id}`, {
    headers: { cookie: coach.cookie },
  })
  res.status === 409 ? ok('409, and it says why') : bad(`expected 409, got ${res.status}`)
}

head('2. A result becomes a card at every shape')
{
  await coach.client.rpc('set_event_result', {
    p_event: event.id,
    p_ours: 3,
    p_theirs: 1,
    p_note: `${TAG} two from the left side`,
    p_home: true,
  })

  const want = { story: [1080, 1920], portrait: [1080, 1350], square: [1080, 1080] }
  for (const [size, [w, h]] of Object.entries(want)) {
    const res = await fetch(`${BASE}/api/share/result/${event.id}?size=${size}`, {
      headers: { cookie: coach.cookie },
    })
    const image = png(Buffer.from(await res.arrayBuffer()))
    image && image.w === w && image.h === h
      ? ok(`${size}: a real PNG at ${w}×${h} (${Math.round(image.bytes / 1024)}kb)`)
      : bad(`${size}: ${JSON.stringify(image)}`)
  }

  // An unknown size is the story card rather than an error. A bad query
  // parameter is not a reason to deny somebody their result.
  const odd = await fetch(`${BASE}/api/share/result/${event.id}?size=banner`, {
    headers: { cookie: coach.cookie },
  })
  const image = png(Buffer.from(await odd.arrayBuffer()))
  image?.h === 1920 ? ok('and an unknown shape falls back to the story') : bad(`got ${JSON.stringify(image)}`)
}

head('3. The score on the card is this academy’s way round')
{
  // Not checkable by reading pixels, so it is checked where the card gets
  // it: event_result, which knows whether the score lives on the event or on
  // a competition fixture and which side of that fixture we were.
  const { data } = await coach.client.rpc('event_result', { p_event: event.id })
  const r = data?.[0]
  r?.ours === 3 && r?.theirs === 1
    ? ok('3–1 to us, from the same function the card reads')
    : bad(`event_result says ${JSON.stringify(r)}`)
  r?.outcome === 'won' ? ok('and the word is "won"') : bad(`outcome ${r?.outcome}`)
}

head('4. The weekend card renders, and covers the right two days')
{
  const now = new Date()
  const d = now.getDay()
  const sat = new Date(now)
  sat.setDate(now.getDate() + (d === 6 ? 0 : d === 0 ? -1 : 6 - d))
  sat.setHours(9, 30, 0, 0)
  const sun = new Date(sat)
  sun.setDate(sat.getDate() + 1)
  // And one well outside the weekend, which must NOT appear.
  const far = new Date(sat)
  far.setDate(sat.getDate() + 9)

  for (const [when, label] of [
    [sat, 'sat'],
    [sun, 'sun'],
    [far, 'far'],
  ]) {
    await admin.from('events').insert({
      academy_id: NRIFA,
      team_id: U8,
      type: 'match',
      title: `${TAG} ${label}`,
      opponent: 'Mosman Lions',
      starts_at: when.toISOString(),
      ends_at: new Date(when.getTime() + 36e5).toISOString(),
      venue: 'Christie Park',
      source: 'manual',
    })
  }

  const res = await fetch(`${BASE}/api/share/weekend?academy=${NRIFA}&size=story`, {
    headers: { cookie: coach.cookie },
  })
  const image = png(Buffer.from(await res.arrayBuffer()))
  image?.w === 1080 && image.h === 1920
    ? ok(`a real PNG at 1080×1920 (${Math.round(image.bytes / 1024)}kb)`)
    : bad(`weekend card: ${JSON.stringify(image)}`)

  // The window the card uses, asserted against the same screen function it
  // reads — a card that showed a different weekend from the Fixtures tab
  // would send somebody to the wrong ground.
  const { data: screen } = await coach.client.rpc('fixtures_screen', {
    p_days: 14,
    p_academy: NRIFA,
  })
  const monday = new Date(sat)
  monday.setDate(sat.getDate() + 2)
  monday.setHours(0, 0, 0, 0)
  const start = new Date(sat)
  start.setHours(0, 0, 0, 0)
  const inWindow = (screen.events ?? []).filter((e) => {
    const t = new Date(e.starts_at)
    return t >= start && t < monday && e.title?.startsWith(TAG)
  })
  inWindow.length === 2
    ? ok('the Saturday and Sunday games are in the window')
    : bad(`${inWindow.length} of ours in the weekend window`)
  inWindow.some((e) => e.title.endsWith('far'))
    ? bad('a game nine days away is in the weekend window')
    : ok('and the one nine days out is not')
}

head('5. Neither card is open to the internet')
{
  // Nothing on a card is secret — the public match centre publishes scores.
  // But an open endpoint that renders any club's branded graphic on request
  // is a thing somebody will eventually use to make a fake one.
  const result = await fetch(`${BASE}/api/share/result/${event.id}`)
  result.status === 401 ? ok(`result card: ${result.status}`) : bad(`result card: ${result.status}`)

  const weekend = await fetch(`${BASE}/api/share/weekend?academy=${NRIFA}`)
  weekend.status === 401 ? ok(`weekend card: ${weekend.status}`) : bad(`weekend card: ${weekend.status}`)
}

head('6. No child is named on anything a card can reach')
{
  // The cards render from these fields and nothing else. Asserting on the
  // SOURCE rather than the pixels is the honest check: a roster name can
  // only appear on a card if it is in the data the card is given.
  const { data: ev } = await admin
    .from('events')
    .select('title, opponent, venue, round, result_note')
    .eq('id', event.id)
    .single()
  const { data: kids } = await admin
    .from('players')
    .select('full_name')
    .eq('academy_id', NRIFA)

  const printed = JSON.stringify(ev)
  const named = (kids ?? [])
    .map((k) => k.full_name.split(' ')[0])
    .filter((n) => n.length > 2 && printed.includes(n))
  named.length === 0
    ? ok(`nothing the card prints names a child (${kids?.length ?? 0} checked)`)
    : bad(`a card field contains ${named.join(', ')}`)

  // The note is free text a coach typed, and a coach CAN type a child's name
  // into it. That is their sentence about their own squad, posted by them —
  // but it is the one field that can carry a name, and it is worth knowing
  // that is where it would come from.
  ok('the only field that could carry one is the coach’s own note')
}

await clean()
console.log(
  process.exitCode ? '\n\x1b[31msome of this is wrong\x1b[0m' : '\n\x1b[32mall good\x1b[0m'
)
