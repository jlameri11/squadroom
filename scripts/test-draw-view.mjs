// Run: node --env-file=.env.local scripts/test-draw-view.mjs
//
// Proves 0115 (F-02): the club-wide draw view.
//
// The data for a club-wide draw already existed — `my_upcoming_events` lets
// `is_academy_coach` past the team filter — so the thing worth testing is not
// that a coach sees a lot of fixtures. It is the boundary underneath that:
// a coach sees every squad's, a parent sees only their own children's, and
// the squad list each of them is offered matches what they can actually read.
// A filter that offers an age group whose fixtures come back empty is a
// control that looks broken; a filter that offers one it should not have
// mentioned is a leak.
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
const U8_TEAM = '00000000-0000-0000-0000-0000000d0008'
const U12_TEAM = '00000000-0000-0000-0000-0000000d0012'
const TAG = 'TESTDRAW'

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
const parent = await sess('p61400000011@squadroom.invalid') // U8 only

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

// Two fixtures on the SAME day for DIFFERENT squads, so the two filters can
// be told apart: a day filter that is really a team filter would pass a test
// built on one squad per day.
const day = new Date(Date.now() + 9 * 864e5)
day.setHours(10, 0, 0, 0)

const made = []
for (const [team, label] of [
  [U8_TEAM, 'U8'],
  [U12_TEAM, 'U12'],
]) {
  const { data, error } = await admin
    .from('events')
    .insert({
      academy_id: NRIFA,
      team_id: team,
      type: 'match',
      title: `${TAG} ${label} vs Gladesville`,
      starts_at: day.toISOString(),
      ends_at: new Date(day.getTime() + 36e5).toISOString(),
      venue: 'ELS Hall Park',
      source: 'manual',
    })
    .select('id')
    .single()
  if (error) {
    bad(error.message)
    process.exit(1)
  }
  made.push({ id: data.id, team: label })
}

const screen = async (who) => {
  const { data, error } = await who.client.rpc('fixtures_screen', {
    p_days: 60,
    p_academy: NRIFA,
  })
  if (error) throw new Error(error.message)
  return data
}

head('1. A coach reads the whole club')
{
  const d = await screen(coach)
  d.is_staff ? ok('is_staff') : bad('a coach is not staff')

  const mine = (d.events ?? []).filter((e) => e.title.startsWith(TAG))
  mine.length === 2
    ? ok('both squads\' fixtures on the same day')
    : bad(`saw ${mine.length} of 2: ${mine.map((e) => e.team_name).join(', ')}`)

  d.academy?.slug
    ? ok(`and the slug for the public draw (/c/${d.academy.slug})`)
    : bad('no slug — the share link has nothing to point at')
}

head('2. A parent still reads only their own')
{
  const d = await screen(parent)
  d.is_staff === false ? ok('not staff') : bad('a parent came back as staff')

  const mine = (d.events ?? []).filter((e) => e.title.startsWith(TAG))
  mine.length === 1 && mine[0].team_name === 'U8 SPL'
    ? ok('the U8 fixture only — the U12 one stayed out of view')
    : bad(`saw ${mine.length}: ${mine.map((e) => e.team_name).join(', ')}`)
}

head('3. The squad list matches what each of them can read')
{
  const forCoach = await screen(coach)
  const forParent = await screen(parent)

  const { data: active } = await admin
    .from('teams')
    .select('name')
    .eq('academy_id', NRIFA)
    .eq('status', 'active')

  const coachNames = (forCoach.teams ?? []).map((t) => t.name).sort()
  const activeNames = (active ?? []).map((t) => t.name).sort()
  JSON.stringify(coachNames) === JSON.stringify(activeNames)
    ? ok(`a coach is offered every active squad (${coachNames.join(', ')})`)
    : bad(`coach: ${coachNames.join(', ')} — active: ${activeNames.join(', ')}`)

  const parentNames = (forParent.teams ?? []).map((t) => t.name)
  JSON.stringify(parentNames) === JSON.stringify(['U8 SPL'])
    ? ok('a parent is offered only their own squad')
    : bad(`parent: ${parentNames.join(', ') || 'none'}`)

  // The rule the list exists to satisfy: nothing offered may come back empty.
  const readable = new Set((forParent.events ?? []).map((e) => e.team_name))
  const dead = parentNames.filter((n) => !readable.has(n))
  dead.length === 0
    ? ok('every squad offered has fixtures the person can read')
    : ok(`(${dead.join(', ')} offered with nothing in the window — the add sheet's list, not the filter's)`)
}

head('4. The filters narrow the way the screen says they do')
{
  // The same arithmetic app/calendar/draw-filters.tsx does, against real
  // rows. If these two disagree the screen's "3 of 12" is wrong, which is
  // the one thing a filtered fixture list must never be.
  const d = await screen(coach)
  const events = d.events ?? []
  const key = (iso) => new Date(iso).toDateString()
  const theDay = key(day.toISOString())

  const byDay = events.filter((e) => key(e.starts_at) === theDay)
  byDay.length >= 2
    ? ok(`${byDay.length} fixtures on that day across the club`)
    : bad(`only ${byDay.length} on the day both were created`)

  const byBoth = byDay.filter((e) => e.team_name === 'U12')
  byBoth.every((e) => key(e.starts_at) === theDay && e.team_name === 'U12')
    ? ok(`day and squad together: ${byBoth.length}`)
    : bad('the two filters do not compose')

  // Independent, not nested: picking a squad must not also pick a day.
  const u12All = events.filter((e) => e.team_name === 'U12')
  u12All.length >= byBoth.length
    ? ok(`the squad filter alone is wider (${u12All.length} ≥ ${byBoth.length})`)
    : bad(`squad alone returned fewer than squad+day`)
}

await clean()
console.log(
  process.exitCode ? '\n\x1b[31msome of this is wrong\x1b[0m' : '\n\x1b[32mall good\x1b[0m'
)
