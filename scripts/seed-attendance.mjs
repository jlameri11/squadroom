// Run: node --env-file=.env.local scripts/seed-attendance.mjs
//
// Registers for the sessions that have already happened, so the attendance
// screens have something to be and the summary reads like a real term.
//
// Deterministic from the player and event ids, so a refresh tells the same
// story twice — a demo where the numbers move every reload is a demo nobody
// trusts. Roughly 85% present, which is what a real squad looks like: high
// enough that the register is mostly taps on "everyone's here", low enough
// that there is something for a coach to point at.
import { createClient } from '@supabase/supabase-js'

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const say = (m) => console.log('  ' + m)

const { data: coach } = await admin
  .from('profiles').select('id').ilike('full_name', '%joey%').limit(1).single()

// Past sessions that were not called off — the only ones a register exists for.
const { data: events } = await admin
  .from('events')
  .select('id, title, team_id, starts_at')
  .eq('academy_id', NRIFA)
  .not('team_id', 'is', null)
  .is('cancelled_at', null)
  .lt('starts_at', new Date().toISOString())
  .gte('starts_at', new Date(Date.now() - 90 * 864e5).toISOString())
  .order('starts_at')

if (!events?.length) {
  console.log('\n  No past sessions to mark. Run scripts/refresh-demo.mjs first.\n')
  process.exit(0)
}

console.log('\nTaking the registers\n')

// A stable pseudo-random number from two ids, so the same child gets the same
// story every time this runs.
const hash = (a, b) => {
  let n = 7
  for (const c of a + b) n = (n * 31 + c.charCodeAt(0)) % 100003
  return n
}

await admin.from('event_attendance').delete().eq('academy_id', NRIFA)

const rows = []
for (const e of events) {
  const { data: squad } = await admin
    .from('players').select('id').eq('academy_id', NRIFA).eq('team_id', e.team_id)
  for (const p of squad ?? []) {
    const n = hash(p.id, e.id) % 100
    // 85 present, 7 late, 6 absent, 2 excused.
    const status = n < 85 ? 'present' : n < 92 ? 'late' : n < 98 ? 'absent' : 'excused'
    rows.push({
      academy_id: NRIFA,
      event_id: e.id,
      player_id: p.id,
      status,
      note: status === 'excused' ? 'away with family' : null,
      marked_by: coach.id,
      // Marked at the end of the session, which is when a coach does it.
      marked_at: new Date(new Date(e.starts_at).getTime() + 80 * 60000).toISOString(),
    })
  }
}

// In batches: a few thousand rows in one insert is a request nobody needs.
let written = 0
for (let i = 0; i < rows.length; i += 400) {
  const batch = rows.slice(i, i + 400)
  const { error } = await admin.from('event_attendance').insert(batch)
  if (error) throw new Error(`batch at ${i}: ${error.message}`)
  written += batch.length
}
say(`${written} marks across ${events.length} sessions`)

// Read it back the way the SCREEN will — as the coach, not as the service
// role. attendance_summary is gated on app_private.is_academy_coach, and the
// service role has no auth.uid() at all, so it returns nothing and looks like
// a broken summary rather than an unauthenticated one. Same trap as
// competition_ladder.
const anon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: false } }
)
const { data: coachUser } = await admin.auth.admin.getUserById(coach.id)
const { data: link } = await admin.auth.admin.generateLink({
  type: 'magiclink',
  email: coachUser.user.email,
})
// generateLink is rate limited per project as well as verifyOtp, and
// returns null when it trips — so this property read throws before any
// session check runs, and the runner reports a crash that is really the
// auth budget.
if (!link?.properties?.hashed_token) {
  console.log("  could not issue a magic link — the project's auth rate limit, not a failure")
  process.exit(2)
}
const { data: session } = await anon.auth.verifyOtp({
  token_hash: link.properties.hashed_token,
  type: 'email',
})
if (!session?.session) {
  console.log("\n  Marks written. Could not read back — auth rate limit, not a failure.\n")
  process.exit(0)
}
const asCoach = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${session.session.access_token}` } },
  }
)

const { data: teams } = await admin
  .from('teams').select('id, name').eq('academy_id', NRIFA).eq('status', 'active').order('name')
for (const t of teams ?? []) {
  const { data: summary, error } = await asCoach.rpc('attendance_summary', {
    p_academy: NRIFA, p_team: t.id,
  })
  if (error) throw new Error(`${t.name}: ${error.message}`)
  const rated = (summary ?? []).filter((r) => r.rate !== null)
  if (rated.length === 0) { say(`${t.name}: nothing marked`); continue }
  const avg = Math.round(rated.reduce((s, r) => s + Number(r.rate), 0) / rated.length)
  const worst = rated.slice().sort((a, b) => Number(a.rate) - Number(b.rate))[0]
  say(`${t.name}: ${rated.length} players, ${avg}% average, lowest ${worst.player_name} on ${worst.rate}%`)
}

console.log('\nDone.\n')
