// Run: node --env-file=.env.local scripts/demo-spl-season-4.mjs
//
// The demo league's next season (Joey, 24 Nov 2026): SPL Season 3's last
// game was 20 Nov, so the demo had no upcoming competition game. This starts
// SPL Season 4 from Season 3 as the League organiser would — the same three
// divisions and the same eighteen entries (NRIFA's squads stay the squads the
// demo tour names), a two-leg Sunday draw from the coming Sunday, published
// at /c/spl-season-4 — ends Season 3, and clears the stray "spl season 4"
// of 16 Nov that no account made. Idempotent: run it again and it does
// nothing new. Only the squadroom-dev project (scripts/_project.mjs).
import { createClient } from '@supabase/supabase-js'
import { signInClient } from './_auth.mjs'

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const SPL = '00000000-0000-0000-0000-0000000a0003'
const SEASON3 = '43f2a577-c4fe-472d-b946-7c67b03b055a'
const say = (m) => console.log('  ' + m)
const fail = (m) => { console.log('  ✗ ' + m); process.exitCode = 1 }

// The coming Sunday, 9 am Sydney.
const sydney = (d) => new Date(d.toLocaleString('en-US', { timeZone: 'Australia/Sydney' }))
const todaySyd = sydney(new Date())
const daysToSunday = (7 - todaySyd.getDay()) % 7 || 7
const firstSunday = new Date(todaySyd); firstSunday.setDate(todaySyd.getDate() + daysToSunday)
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const FIRST = ymd(firstSunday)
const last = new Date(firstSunday); last.setDate(firstSunday.getDate() + 9 * 7)
const LAST = ymd(last)
// Sydney is UTC+11 in late November (daylight saving).
const startAt = `${FIRST}T09:00:00+11:00`

// 0. The stray.
{
  const { data: strays } = await admin.from('competitions').select('id, name').eq('organiser_id', SPL).ilike('name', 'spl season 4').is('created_by', null)
  for (const s of strays ?? []) {
    for (const t of ['channels', 'entry_fees', 'competition_fees', 'fixtures', 'competition_entries', 'competition_clubs', 'competition_divisions']) {
      const { error } = await admin.from(t).delete().eq('competition_id', s.id)
      if (error) say(`stray ${t}: ${error.message}`)
    }
    const { error } = await admin.from('competitions').delete().eq('id', s.id)
    error ? fail(`the stray "${s.name}" would not go: ${error.message}`) : say(`the stray "${s.name}" (${s.id.slice(0, 8)}) is gone`)
  }
  if (!(strays ?? []).length) say('no stray to clear')
}

// 1. Season 4, from Season 3, as the organiser.
const organiser = await signInClient(admin, 'organiser@squadroom-demo.test')
if (!organiser) { fail('could not sign in as the organiser'); process.exit(1) }
let s4 = (await admin.from('competitions').select('id, public_slug, published_at, starts_on').eq('organiser_id', SPL).eq('name', 'SPL Season 4').not('created_by', 'is', null).maybeSingle()).data
if (!s4) {
  const { data, error } = await organiser.rpc('new_season_from', { p_competition: SEASON3, p_name: 'SPL Season 4', p_season: '2027', p_starts_on: FIRST, p_ends_on: LAST, p_slug: 'spl-season-4' })
  if (error) { fail(`new_season_from: ${error.message}`); process.exit(1) }
  s4 = (await admin.from('competitions').select('id, public_slug, published_at, starts_on').eq('id', data.competition_id).single()).data
  say(`SPL Season 4 started from Season 3 (${s4.id.slice(0, 8)}), ${data.entries} entries carried by lineage`)
} else say(`SPL Season 4 exists (${s4.id.slice(0, 8)})`)

// 2. The same eighteen entries: the demo's squads are not rolled over.
{
  const { data: old } = await admin.from('competition_entries').select('academy_id, team_id, display_name, division, group_label').eq('competition_id', SEASON3).is('withdrawn_at', null).order('division').order('display_name')
  const { data: have } = await admin.from('competition_entries').select('display_name, division').eq('competition_id', s4.id)
  const seen = new Set((have ?? []).map((e) => `${e.division}|${e.display_name}`))
  let added = 0
  for (const e of old ?? []) {
    if (seen.has(`${e.division}|${e.display_name}`)) continue
    const { error } = await admin.from('competition_entries').insert({ competition_id: s4.id, academy_id: e.academy_id, team_id: e.team_id, display_name: e.display_name, division: e.division, group_label: e.group_label, nominated_at: new Date().toISOString() })
    error ? fail(`entry ${e.display_name}: ${error.message}`) : added++
  }
  say(`${added} entries added (${(have ?? []).length} were there)`)
}

// 3. The draw: ten Sunday rounds a division, each on its own field.
{
  // Season 3's divisions lived only in its entries; name Season 4's (0287) so the league has rules to set.
  const { data: ents } = await admin.from('competition_entries').select('division').eq('competition_id', s4.id)
  const divs = [...new Set((ents ?? []).map((e) => e.division))].sort().map((division) => ({ division }))
  for (const d of divs) {
    const age = (/^U(\d+)/.exec(d.division) ?? [])[1]
    const { error } = await organiser.rpc('add_division', { p_competition: s4.id, p_division: d.division, p_age_group: age ? `U${age}` : null, p_pitch_size: age && Number(age) <= 10 ? 'half' : null })
    if (error) say(`add_division ${d.division}: ${error.message}`)
  }
  const fields = ['Field 1', 'Field 2', 'Field 3']
  let i = 0
  for (const d of divs) {
    const { count } = await admin.from('fixtures').select('*', { count: 'exact', head: true }).eq('competition_id', s4.id).eq('division', d.division)
    if (count) { say(`${d.division}: ${count} games already drawn`); i++; continue }
    const { data, error } = await organiser.rpc('generate_fixtures', { p_competition: s4.id, p_division: d.division, p_start_at: startAt, p_game_mins: 50, p_gap_mins: 10, p_fields: [fields[i % 3]], p_venue_label: 'ELS Hall Park', p_replace: false, p_round_every_days: 7, p_legs: 2 })
    error ? fail(`${d.division}: ${error.message}`) : say(`${d.division}: ${data} games drawn from ${FIRST} on ${fields[i % 3]}`)
    i++
  }
}

// 4. Published, so the match centre and the public game pages exist.
if (!s4.published_at || s4.public_slug !== 'spl-season-4') {
  const { error } = await admin.from('competitions').update({ public_slug: 'spl-season-4', published_at: new Date().toISOString() }).eq('id', s4.id)
  error ? fail(`publish: ${error.message}`) : say('published at /c/spl-season-4')
} else say('already published at /c/spl-season-4')

// 5. Season 3 is over.
{
  const { data: s3 } = await admin.from('competitions').select('status').eq('id', SEASON3).single()
  if (s3?.status === 'ended') say('Season 3 already ended')
  else {
    const { error } = await organiser.rpc('end_season', { p_competition: SEASON3 })
    error ? fail(`end_season: ${error.message}`) : say('Season 3 ended — it stays readable as last season')
  }
}

// 6. What the demo now has.
{
  const { count: games } = await admin.from('fixtures').select('*', { count: 'exact', head: true }).eq('competition_id', s4.id)
  const { count: upcoming } = await admin.from('events').select('*', { count: 'exact', head: true }).eq('team_id', '00000000-0000-0000-0000-0000000d0008').not('fixture_id', 'is', null).is('cancelled_at', null).gt('starts_at', new Date().toISOString())
  say(`Season 4: ${games} games; NRIFA U8 has ${upcoming} upcoming competition games`)
  if (!upcoming) fail('NRIFA U8 still has no upcoming competition game')
}
console.log(process.exitCode ? '\nSOMETHING DID NOT TAKE\n' : '\nThe demo league has a season again.\n')
