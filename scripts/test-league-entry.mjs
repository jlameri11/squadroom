// Run: node --env-file=.env.local scripts/test-league-entry.mjs
//
// L-16 + L-02 (the halves that need no Stripe key): a team asks to enter
// from the public page; the organiser accepts and hands back a join link;
// the club claims it and the entry is theirs; the entry fee is owed by
// that club, shown to it with the league's instructions, and ticked off by
// the treasurer. Declines, rate limits and duplicates behave.
import { createClient } from '@supabase/supabase-js'
import { signInClient } from './_auth.mjs'
import { resolveBaseUrl } from './_base-url.mjs'

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

const RAVENS = '00000000-0000-0000-0000-0000000a0002'
const SPL = '00000000-0000-0000-0000-0000000a0003'
const OWNER = '00000000-0000-0000-0000-0000000000a1'
const RAVENS_OWNER = '00000000-0000-0000-0000-0000000000c1'
const PARENT = '00000000-0000-0000-0000-0000000000b1'
const TAG = 'LENTRY'
const SLUG = 'lentry-cup'

// Sessions are cached across suites (scripts/_auth.mjs), so a full run no
// longer trips the auth rate limit.
const signInEmail = (email) => signInClient(admin, email)
async function cleanup() {
  const { data: comps } = await admin.from('competitions').select('id').like('name', `${TAG} %`)
  for (const c of comps ?? []) await admin.from('competitions').delete().eq('id', c.id)
}
await cleanup()

const owner = await signInEmail((await admin.auth.admin.getUserById(OWNER)).data.user.email)
const ravens = await signInEmail((await admin.auth.admin.getUserById(RAVENS_OWNER)).data.user.email)
const parent = await signInEmail((await admin.auth.admin.getUserById(PARENT)).data.user.email)
if (!owner || !ravens || !parent) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}
const BASE = await resolveBaseUrl({ quiet: true })
const { data: comp } = await admin.from('competitions').insert({
  organiser_id: SPL, name: `${TAG} Cup`, type: 'tournament', season: '2026', status: 'active', mode: 'managed', visibility: 'participants', created_by: OWNER,
  public_slug: SLUG, published_at: new Date().toISOString(),
}).select('id').single()
await admin.from('competition_divisions').insert([{ competition_id: comp.id, division: 'U10', allow_playing_up: true }, { competition_id: comp.id, division: 'U12', allow_playing_up: true }])
const enter = (body) => fetch(`${BASE}/api/competitions/enter`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.9' }, body: JSON.stringify({ slug: SLUG, ...body }) })

head('1. Closed until the organiser opens it')
{
  const { data: closed } = await anon.rpc('public_competition_entry', { p_slug: SLUG })
  closed === null ? ok('the public entry form shows nothing while closed') : bad('entry info shown while closed')
  const res = await enter({ clubName: 'Hills Hawks', teamName: 'Hills Hawks U10', division: 'U10', contactName: 'Harry Hawk', contactPhone: '0400 000 111' })
  res.status === 400 ? ok('a request while closed is refused') : bad(`closed request: ${res.status}`)
  const { error: notYours } = await parent.from('competitions').update({ entries_open: true }).eq('id', comp.id)
  const { data: still } = await admin.from('competitions').select('entries_open').eq('id', comp.id).single()
  !still.entries_open ? ok('a parent cannot open entries') : bad(`a parent opened entries (${notYours?.message ?? 'no error'})`)
  const { error } = await owner.from('competitions').update({ entries_open: true }).eq('id', comp.id)
  error ? bad(`open: ${error.message}`) : ok('the organiser opens entries')
  await owner.rpc('set_competition_fee', { p_competition: comp.id, p_division: '', p_fee_cents: 15000, p_instructions: 'Bank transfer to SPL Inc, ref your team' })
  await owner.rpc('set_competition_fee', { p_competition: comp.id, p_division: 'U12', p_fee_cents: 18000 })
  const { data: info } = await anon.rpc('public_competition_entry', { p_slug: SLUG })
  info?.divisions?.length === 2 && info.divisions.find((d) => d.division === 'U10')?.fee_cents === 15000 && info.divisions.find((d) => d.division === 'U12')?.fee_cents === 18000
    ? ok('the public form sees two divisions: U10 $150 (the general fee), U12 $180 (its own)')
    : bad(JSON.stringify(info))
  const { data: centre } = await anon.rpc('public_match_centre', { p_slug: SLUG })
  centre?.entries_open === true ? ok('the public page knows entries are open') : bad('entries_open missing from the public page')
}

head('2. Teams ask to enter')
let hawksId
{
  const bad1 = await enter({ clubName: 'Hills Hawks', teamName: 'Hills Hawks U10', contactName: 'Harry Hawk' })
  bad1.status === 400 ? ok('no phone and no email: refused') : bad(`no contact: ${bad1.status}`)
  const res = await enter({ clubName: 'Hills Hawks', teamName: 'Hills Hawks U10', division: 'U10', contactName: 'Harry Hawk', contactPhone: '0400 000 111', note: 'We can only play mornings' })
  res.ok ? ok('Hills Hawks U10 asks to enter') : bad(`enter: ${res.status} ${await res.text()}`)
  const dup = await enter({ clubName: 'hills hawks', teamName: 'HILLS HAWKS U10', division: 'U10', contactName: 'Harry Hawk', contactPhone: '0400 000 111' })
  dup.status === 409 ? ok('asking twice is a 409') : bad(`duplicate: ${dup.status}`)
  const res2 = await enter({ clubName: 'Ravens FC', teamName: 'Ravens U12', division: 'U12', contactName: 'Rae Raven', contactEmail: 'rae@example.com' })
  res2.ok ? ok('Ravens U12 asks to enter') : bad(`ravens: ${res2.status}`)
  const res3 = await enter({ clubName: 'Nobody FC', teamName: 'Nobody U10', division: 'U10', contactName: 'N O', contactEmail: 'n@example.com' })
  res3.ok ? ok('Nobody U10 asks too') : bad(`nobody: ${res3.status}`)
  const { data: list } = await owner.rpc('entry_requests', { p_competition: comp.id })
  list?.length === 3 && list[0].contact_phone === '+61400000111' ? ok('the organiser sees three requests, phone normalised') : bad(JSON.stringify(list)?.slice(0, 200))
  hawksId = list.find((r) => r.team_name === 'Hills Hawks U10')?.id
  const { data: none } = await ravens.rpc('entry_requests', { p_competition: comp.id })
  none === null ? ok('a club sees no requests (and no contacts)') : bad('a club read the entry requests')
  // The rate limit: ten in an hour from one address.
  for (let i = 0; i < 8; i++) await enter({ clubName: `Spam ${i}`, teamName: `Spam ${i} U10`, division: 'U10', contactName: 'S', contactEmail: 's@example.com' })
  const spam = await enter({ clubName: 'Spam 9', teamName: 'Spam 9 U10', division: 'U10', contactName: 'S', contactEmail: 's@example.com' })
  spam.status === 429 ? ok('the eleventh request from one address in an hour is a 429') : bad(`rate limit: ${spam.status}`)
  await admin.from('competition_entry_requests').delete().like('club_name', 'Spam %')
}

head('3. Decided: accept hands back a join link; the fee is raised; the club claims it')
let token, feeId
{
  const { error: notYours } = await parent.rpc('decide_entry_request', { p_request: hawksId, p_accept: true, p_division: 'U10' })
  notYours?.code === '42501' ? ok('a parent cannot decide') : bad('a parent decided an entry')
  const { data, error } = await owner.rpc('decide_entry_request', { p_request: hawksId, p_accept: true, p_division: 'U10' })
  error ? bad(`accept: ${error.message}`) : ok('Hills Hawks U10 accepted into U10')
  token = data?.token
  const { data: entry } = await admin.from('competition_entries').select('id, display_name, division, academy_id').eq('id', data.entry_id).single()
  entry?.display_name === 'Hills Hawks U10' && entry.division === 'U10' && entry.academy_id === null ? ok('an entry on the draw, no club yet') : bad(JSON.stringify(entry))
  const { data: fee } = await admin.from('entry_fees').select('id, amount_cents, status, club_academy_id').eq('entry_id', entry.id).single()
  fee?.amount_cents === 15000 && fee.status === 'owed' && fee.club_academy_id === null ? ok('$150 owed by whoever claims it') : bad(JSON.stringify(fee))
  feeId = fee.id
  const { data: list } = await owner.rpc('entry_requests', { p_competition: comp.id })
  list.find((r) => r.id === hawksId)?.token === token ? ok('the organiser sees the join link to send') : bad('no token on the accepted request')
  const { data: peek } = await anon.rpc('peek_competition_invite', { p_token: token })
  peek?.[0]?.club_name === 'Hills Hawks' && peek[0].division === 'U10' ? ok('the link previews the right club and division') : bad(JSON.stringify(peek))
  // Ravens' owner claims it for Ravens (standing in for the Hawks' club).
  const { error: claimErr } = await ravens.rpc('claim_competition_invite', { p_token: token, p_academy: RAVENS })
  claimErr ? bad(`claim: ${claimErr.message}`) : ok('the club claims the invitation with its own organisation')
  const { data: fee2 } = await admin.from('entry_fees').select('club_academy_id').eq('id', feeId).single()
  fee2?.club_academy_id === RAVENS ? ok('the fee now belongs to that club') : bad(JSON.stringify(fee2))
  const { data: mine } = await ravens.rpc('my_entry_fees', { p_competition: comp.id })
  mine?.[0]?.amount_cents === 15000 && mine[0].status === 'owed' && /SPL Inc/.test(mine[0].instructions ?? '') ? ok('the club sees $150 owed and how to pay it') : bad(JSON.stringify(mine))
  const ravensReq = (await owner.rpc('entry_requests', { p_competition: comp.id })).data.find((r) => r.team_name === 'Ravens U12')
  const { data: dec } = await owner.rpc('decide_entry_request', { p_request: ravensReq.id, p_accept: false, p_note: 'U12 is full' })
  dec?.status === 'declined' ? ok('Ravens U12 declined with a note') : bad(JSON.stringify(dec))
  const { error: again } = await owner.rpc('decide_entry_request', { p_request: ravensReq.id, p_accept: true })
  again ? ok('a decided request cannot be decided again') : bad('decided twice')
}

head('4. The treasurer ticks it off')
{
  const { error: notClub } = await ravens.rpc('mark_entry_fee', { p_fee: feeId, p_status: 'paid' })
  notClub?.code === '42501' ? ok('the club cannot mark its own fee paid') : bad('a club marked its fee paid')
  const { error } = await owner.rpc('mark_entry_fee', { p_fee: feeId, p_status: 'paid', p_method: 'bank' })
  error ? bad(`paid: ${error.message}`) : ok('the league marks it paid by bank transfer')
  const { data: view } = await owner.rpc('competition_fees_view', { p_competition: comp.id })
  view?.paid_cents === 15000 && view.owed_cents === 0 && view.entries[0]?.club === 'Ravens FC' ? ok('the organiser\'s view: $150 paid, nothing owed, by Ravens FC') : bad(JSON.stringify(view))
  const { data: mine } = await ravens.rpc('my_entry_fees', { p_competition: comp.id })
  mine?.[0]?.status === 'paid' ? ok('the club sees it paid') : bad(JSON.stringify(mine))
  // A fee set later reaches entries that already exist.
  await admin.from('competition_entries').insert({ competition_id: comp.id, display_name: 'Late Entry U12', division: 'U12' })
  const { data: late } = await admin.from('entry_fees').select('amount_cents').eq('competition_id', comp.id).order('created_at', { ascending: false }).limit(1).single()
  late?.amount_cents === 18000 ? ok('an entry added by hand owes U12\'s $180 at once') : bad(JSON.stringify(late))
}

await cleanup()
console.log(process.exitCode ? '\n\x1b[31mENTRIES AND FEES ARE WRONG\x1b[0m\n' : '\n\x1b[32mall good\x1b[0m\n')
