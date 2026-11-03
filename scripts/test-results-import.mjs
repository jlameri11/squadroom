// Run: node --env-file=.env.local scripts/test-results-import.mjs
//
// F-05 (0201): a league's results export fills in the results on the games
// it imported — ours and theirs by which side was ours, matched by the
// file's reference or by the day and the opponent — and the squad's form
// reads them back for its own people.
import { createClient } from '@supabase/supabase-js'
import { signInClient } from './_auth.mjs'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }
const head = (m) => console.log(`\n${m}`)

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const U8 = '00000000-0000-0000-0000-0000000d0008'
const TAG = 'RESIMP'

const owner = await signInClient(admin, 'joeylameri@outlook.com')
const parent = await signInClient(admin, 'p61400000011@squadroom.invalid')
const ravens = await signInClient(admin, 'p61400000091@squadroom.invalid')
if (!owner || !parent || !ravens) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}
const tidy = async () => { await admin.from('events').delete().like('external_ref', `${TAG}-%`); await admin.from('events').delete().like('title', `${TAG} %`) }
await tidy()

// Three games from a league file, two Saturdays ago and last Saturday — one
// with a reference, one without — and one next week with no score.
const sat = (weeksAgo) => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 1) % 7) - 7 * weeksAgo); return d.toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' }) }
const rows = [
  { local_date: sat(2), local_time: '09:00', title: `${TAG} Round 3 vs Hornsby Heat`, opponent: 'Hornsby Heat', venue: 'ELS Hall Park', round: 'Round 3', external_ref: `${TAG}-R3`, was_home: true, our_score: 3, their_score: 1 },
  { local_date: sat(1), local_time: '10:30', title: `${TAG} Round 4 vs Gladesville Ravens`, opponent: 'Gladesville Ravens', venue: 'Ravens Oval', round: 'Round 4', external_ref: null, was_home: false, our_score: 0, their_score: 2 },
  { local_date: sat(-1), local_time: '09:00', title: `${TAG} Round 5 vs Carlingford Cobras`, opponent: 'Carlingford Cobras', venue: 'ELS Hall Park', round: 'Round 5', external_ref: `${TAG}-R5`, was_home: true, our_score: null, their_score: null },
]

head('1. The games import as before; the scores land on them')
const { data: made, error: ie } = await owner.rpc('create_imported_events', { p_academy: NRIFA, p_team: U8, p_events: rows })
ie ? bad(`import: ${ie.message}`) : ok(`${made?.[0]?.created ?? '?'} games imported`)
const { data: applied, error: ae } = await owner.rpc('apply_imported_results', { p_academy: NRIFA, p_team: U8, p_events: rows })
ae ? bad(`results: ${ae.message}`) : applied.results === 2 && applied.unmatched === 0 ? ok('two results recorded, none unmatched; the unscored row left alone') : bad(`applied: ${JSON.stringify(applied)}`)
const { data: evs } = await admin.from('events').select('id, title, external_ref, our_score, their_score, was_home').like('title', `${TAG} %`).order('starts_at')
const r3 = evs.find((e) => e.external_ref === `${TAG}-R3`), r4 = evs.find((e) => /Round 4/.test(e.title)), r5 = evs.find((e) => /Round 5/.test(e.title))
r3?.our_score === 3 && r3.their_score === 1 && r3.was_home === true ? ok('Round 3 (by reference): 3–1 at home') : bad(`R3: ${JSON.stringify(r3)}`)
r4?.our_score === 0 && r4.their_score === 2 && r4.was_home === false ? ok('Round 4 (by day and opponent, no reference): 0–2 away') : bad(`R4: ${JSON.stringify(r4)}`)
r5?.our_score === null ? ok('Round 5, next week, has no result') : bad(`R5: ${JSON.stringify(r5)}`)
const { data: res } = await owner.rpc('event_result', { p_event: r3.id })
const result = Array.isArray(res) ? res[0] : res
result?.outcome === 'won' && result.ours === 3 ? ok('event_result reads it as a win') : bad(`event_result: ${JSON.stringify(res)}`)

head('2. A re-import corrects, never blanks')
const { data: again } = await owner.rpc('apply_imported_results', { p_academy: NRIFA, p_team: U8, p_events: rows })
again.results === 0 ? ok('the same file again changes nothing') : bad(`second apply: ${JSON.stringify(again)}`)
const fixed = rows.map((r) => (r.external_ref === `${TAG}-R3` ? { ...r, our_score: 4 } : r))
const { data: corr } = await owner.rpc('apply_imported_results', { p_academy: NRIFA, p_team: U8, p_events: fixed })
const { data: r3b } = await admin.from('events').select('our_score').eq('id', r3.id).single()
corr.results === 1 && r3b.our_score === 4 ? ok('a corrected score in the file corrects the game') : bad(`correction: ${JSON.stringify(corr)} → ${r3b.our_score}`)
const blank = rows.map((r) => ({ ...r, our_score: null, their_score: null }))
await owner.rpc('apply_imported_results', { p_academy: NRIFA, p_team: U8, p_events: blank })
const { data: r3c } = await admin.from('events').select('our_score').eq('id', r3.id).single()
r3c.our_score === 4 ? ok("next week's draw, with no scores, leaves last week's result alone") : bad('a scoreless re-import blanked a result')
const stray = [{ ...rows[0], external_ref: `${TAG}-NOPE`, local_date: '2020-01-01', opponent: 'Nobody' }]
const { data: miss } = await owner.rpc('apply_imported_results', { p_academy: NRIFA, p_team: U8, p_events: stray })
miss.unmatched === 1 && miss.results === 0 ? ok('a score for a game we do not have is counted, not invented') : bad(`stray: ${JSON.stringify(miss)}`)

head('3. Who may')
const { error: pe } = await parent.rpc('apply_imported_results', { p_academy: NRIFA, p_team: U8, p_events: rows })
pe?.code === '42501' ? ok('a parent cannot import results') : bad(`parent: ${pe?.code ?? 'allowed'}`)
const { error: ve } = await ravens.rpc('apply_imported_results', { p_academy: NRIFA, p_team: U8, p_events: rows })
ve?.code === '42501' ? ok("another club's owner cannot") : bad(`Ravens: ${ve?.code ?? 'allowed'}`)

head('4. The form')
const { data: form, error: fe } = await parent.rpc('team_form', { p_team: U8, p_n: 5 })
fe ? bad(`team_form: ${fe.message}`) : ok(`a U8 parent reads the form: ${form.last.map((r) => r.outcome[0].toUpperCase()).join('')} (P${form.season.played} W${form.season.won} D${form.season.drawn} L${form.season.lost})`)
form && form.last[0]?.opponent === 'Gladesville Ravens' && form.last[0].outcome === 'lost' && form.last[1]?.outcome === 'won' ? ok('newest first: the Ravens loss, then the Hornsby win') : bad(`form: ${JSON.stringify(form?.last?.slice(0, 2))}`)
form && form.last.every((r) => r.ours !== null) && !form.last.some((r) => /Round 5/.test(r.opponent ?? '')) ? ok('only games with a result count') : bad('an unplayed game is in the form')
const { error: fv } = await ravens.rpc('team_form', { p_team: U8 })
fv?.code === '42501' ? ok("another club's owner cannot read it") : bad(`Ravens form: ${fv?.code ?? 'allowed'}`)

await tidy()
process.exit(process.exitCode ?? 0)
