// Run: node --env-file=.env.local scripts/test-league-divisions.mjs
//
// L-01: a division has its own rules — points, tie-break, scores public or
// hidden, ladder on or off — set by the organiser, read by the ladder and
// by the public page.
import { createClient } from '@supabase/supabase-js'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const anon = createClient(URL_, PUB, { auth: { persistSession: false } })

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`)
  process.exitCode = 1
}
const head = (m) => console.log(`\n${m}`)

const OWNER = '00000000-0000-0000-0000-0000000000a1'
const PARENT = '00000000-0000-0000-0000-0000000000b1'

async function signIn(profileId) {
  const { data: u } = await admin.auth.admin.getUserById(profileId)
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email: u.user.email })
  if (!link?.properties?.hashed_token) return null
  const client = createClient(URL_, PUB, { auth: { persistSession: false } })
  const { data } = await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' })
  return data?.session ? client : null
}
const owner = await signIn(OWNER)
const parent = await signIn(PARENT)
if (!owner || !parent) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}

// The published gala day: results exist and the public page shows them.
const { data: comp } = await admin.from('competitions').select('id, name, public_slug').eq('public_slug', 'nrifa-spring-gala').single()
const { data: divs } = await admin.from('competition_entries').select('division').eq('competition_id', comp.id)
const division = [...new Set(divs.map((d) => d.division))].sort()[0]
await admin.from('competition_divisions').delete().eq('competition_id', comp.id)

head(`1. The defaults apply when nothing is set — ${comp.name}, ${division}`)
const { data: before } = await owner.rpc('competition_ladder', { p_competition: comp.id, p_division: division })
const top = before?.[0]
top && top.points === top.won * 3 + top.drawn ? ok(`${top.team_name}: ${top.points} points on 3/1/0`) : bad(JSON.stringify(top))

head('2. The organiser sets 2/1/0 and the ladder follows; a parent cannot')
{
  const { error } = await owner.from('competition_divisions').upsert(
    { competition_id: comp.id, division, points_win: 2, points_draw: 1, points_loss: 0 },
    { onConflict: 'competition_id,division' }
  )
  error ? bad(`organiser: ${error.message}`) : ok('saved')
  const { data: after } = await owner.rpc('competition_ladder', { p_competition: comp.id, p_division: division })
  const same = after?.find((r) => r.entry_id === top.entry_id)
  same && same.points === same.won * 2 + same.drawn ? ok(`${same.team_name}: now ${same.points} points on 2/1/0`) : bad(JSON.stringify(same))
  const { error: pErr, data: pData } = await parent.from('competition_divisions').upsert(
    { competition_id: comp.id, division, points_win: 9 }, { onConflict: 'competition_id,division' }
  ).select('id')
  pErr || !pData?.length ? ok('a parent is refused') : bad('a parent rewrote the rules')
  const { error: bad11 } = await owner.from('competition_divisions').update({ points_win: 11 }).eq('competition_id', comp.id).eq('division', division)
  bad11 ? ok('eleven points for a win is refused') : bad('11 points accepted')
}

head('3. Tie-break: goals for before goal difference')
{
  await owner.from('competition_divisions').update({ points_win: 3, tie_break: 'gf_then_gd' }).eq('competition_id', comp.id).eq('division', division)
  const { data: rows } = await owner.rpc('competition_ladder', { p_competition: comp.id, p_division: division })
  const sorted = [...(rows ?? [])].sort((a, b) => b.points - a.points || b.goals_for - a.goals_for || b.goal_difference - a.goal_difference || a.team_name.localeCompare(b.team_name))
  JSON.stringify(rows.map((r) => r.entry_id)) === JSON.stringify(sorted.map((r) => r.entry_id)) ? ok('ordered points, then goals for, then goal difference') : bad('the order is not goals-for first')
}

head('4. Hidden scores: the public page lists the games and withholds the result and the table')
{
  await owner.from('competition_divisions').update({ scores_public: false }).eq('competition_id', comp.id).eq('division', division)
  const { data: centre } = await anon.rpc('public_match_centre', { p_slug: comp.public_slug })
  const hidden = (centre?.fixtures ?? []).filter((f) => f.division === division)
  const shown = (centre?.fixtures ?? []).filter((f) => f.division !== division)
  hidden.length > 0 && hidden.every((f) => f.home_score == null && f.away_score == null && f.scores_hidden === true)
    ? ok(`${hidden.length} ${division} games listed, no scores`)
    : bad(`hidden division: ${JSON.stringify(hidden[0])}`)
  shown.some((f) => f.home_score != null) ? ok('the other divisions still show scores') : bad('scores vanished from other divisions')
  centre?.ladder?.[division] === undefined ? ok('and no table for it') : bad('a table is published for a hidden division')
  hidden.some((f) => f.status === 'final') ? ok('but whether a game is finished still shows') : ok('(no finished games to show status for)')
}

await admin.from('competition_divisions').delete().eq('competition_id', comp.id)
console.log(process.exitCode ? '\n\x1b[31mDIVISION RULES ARE WRONG\x1b[0m\n' : '\n\x1b[32mall good\x1b[0m\n')
