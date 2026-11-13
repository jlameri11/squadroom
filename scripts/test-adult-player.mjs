// Run: node --env-file=.env.local scripts/test-adult-player.mjs
//   (needs the app running — npm run dev, or serve:test)
//
// Part A fix 2 (Joey, 10 Nov 2026; 0239): "Test a 40-year-old over-35s
// player end to end: join, register, pay, chat, play." On squadroom-dev, at
// NRIFA: the Head of academy makes an Over-35s men's team and its players'
// link; a 40-year-old joins through it as themselves (name, mobile, date of
// birth — no children, no guardian); the Head approves; the player's own
// record, membership and squad place exist; they register for a program,
// start a payment for a fee aimed at their team, post in the team chat, and
// RSVP to a game. A 15-year-old through the same link is refused. Everything
// made here is removed.
import { createClient } from '@supabase/supabase-js'
import { signInBoth } from './_auth.mjs'
import { resolveBaseUrl } from './_base-url.mjs'
import { createAccount, deleteAccount } from './_account.mjs'

const BASE = await resolveBaseUrl()
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const REF = URL_.split('//')[1].split('.')[0]
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }
const note = (m) => console.log(`  \x1b[2m… ${m}\x1b[0m`)
const head = (m) => console.log(`\n${m}`)
const post = (path, body, cookie) =>
  fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) })
const cookieFor = (session) => `sb-${REF}-auth-token=${'base64-' + Buffer.from(JSON.stringify(session)).toString('base64')}`

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const PHONE = '+61400009140' // nobody's, made for this
const TAG = 'TEST:: adult player'
// The sign-up brief (12 Nov 2026): everyone comes through an account.
const TEEN_EMAIL = 'teen.tryer@squadroom-demo.test'
const MARCO_EMAIL = 'marco.rossi@squadroom-demo.test'
const forty = new Date(); forty.setFullYear(forty.getFullYear() - 40)
const fifteen = new Date(); fifteen.setFullYear(fifteen.getFullYear() - 15)
const iso = (d) => d.toISOString().slice(0, 10)

const { error: no0239 } = await admin.from('join_requests').select('dob').limit(1)
if (no0239) {
  note('waiting for 0239 on squadroom-dev — test-rls 187–188 prove it locally meanwhile')
  process.exit(0)
}

const owner = await signInBoth(admin, 'head@squadroom-demo.test')
if (!owner) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}

// An Over-35 team makes the club's "Over-35s Age Group" chat the first time; the demo has none.
const { data: ageChatBefore } = await admin.from('channels').select('id').eq('academy_id', NRIFA).eq('type', 'age_group').eq('age_group', 'Over-35').maybeSingle()
let teamId = null
let linkId = null
let adultProfile = null
let programId = null
let feeId = null
async function tidy() {
  if (adultProfile) {
    await admin.from('players').delete().eq('profile_id', adultProfile)
    await admin.auth.admin.deleteUser(adultProfile).catch(() => null)
  }
  const { data: strays } = await admin.from('profiles').select('id').eq('phone', PHONE)
  for (const s of strays ?? []) await admin.auth.admin.deleteUser(s.id).catch(() => null)
  if (feeId) await admin.from('payment_requests').delete().eq('id', feeId)
  if (programId) await admin.from('programs').delete().eq('id', programId)
  if (linkId) await admin.from('join_links').delete().eq('id', linkId)
  if (teamId) await admin.from('teams').delete().eq('id', teamId)
  if (!ageChatBefore) await admin.from('channels').delete().eq('academy_id', NRIFA).eq('type', 'age_group').eq('age_group', 'Over-35')
  await admin.from('join_requests').delete().eq('academy_id', NRIFA).in('phone', [PHONE, '+61400009141'])
  for (const email of [TEEN_EMAIL, MARCO_EMAIL]) await deleteAccount(admin, email)
}
await tidy()

try {
  head('1. An Over-35s men\'s team, and its players\' link')
  const { data: team, error: teamErr } = await owner.client.from('teams').insert({ academy_id: NRIFA, name: `${TAG} Over-35s`, age_group: 'Over-35', season: '2099', gender: 'men' }).select('id, age_group').single()
  teamId = team?.id ?? null
  teamErr ? bad(`team: ${teamErr.message}`) : ok(`an ${team.age_group} men's team is a team (the U18 ceiling is gone)`)
  const { data: link, error: linkErr } = await owner.client.from('join_links').insert({ academy_id: NRIFA, team_id: teamId, role: 'player', created_by: owner.session.user.id }).select('id, token').single()
  linkId = link?.id ?? null
  linkErr ? bad(`link: ${linkErr.message}`) : ok("a players' link — adults join as themselves")

  head('2. A 15-year-old is turned away; a 40-year-old asks to join')
  const teen = await createAccount(BASE, { first: 'Teen', last: 'Tryer', email: TEEN_EMAIL, mobile: '+61400009141' })
  const young = await post('/api/join/request', { token: link.token, dob: iso(fifteen), children: [] }, teen.cookie)
  const youngBody = await young.json().catch(() => ({}))
  young.status === 400 && /parent/i.test(youngBody.error ?? '') ? ok(`under 18: "${youngBody.error}"`) : bad(`teen: ${young.status} ${JSON.stringify(youngBody)}`)
  const noDob = await post('/api/join/request', { token: link.token, children: [] }, teen.cookie)
  noDob.status === 400 ? ok('no date of birth: asked for one') : bad(`no dob: ${noDob.status}`)
  const marco = await createAccount(BASE, { first: 'Marco', last: 'Rossi', email: MARCO_EMAIL, mobile: PHONE })
  const ask = await post('/api/join/request', { token: link.token, dob: iso(forty), children: [] }, marco.cookie)
  const askBody = await ask.json().catch(() => ({}))
  ask.ok && askBody.requestId ? ok('the 40-year-old asks to join, as a player') : bad(`request: ${ask.status} ${JSON.stringify(askBody)}`)
  const { data: reqRow } = await admin.from('join_requests').select('dob, children_names').eq('id', askBody.requestId).single()
  reqRow?.dob === iso(forty) && (reqRow.children_names ?? []).length === 0 ? ok('the request carries their date of birth and no children') : bad(`request row: ${JSON.stringify(reqRow)}`)

  head('3. The Head approves: their own record, membership and squad place')
  const appr = await post('/api/join/approve', { requestId: askBody.requestId, decision: 'approve' }, cookieFor(owner.session))
  const apprBody = await appr.json().catch(() => ({}))
  appr.ok ? ok('approved') : bad(`approve: ${appr.status} ${JSON.stringify(apprBody)}`)
  const { data: prof } = await admin.from('profiles').select('id').eq('phone', PHONE).maybeSingle()
  adultProfile = prof?.id ?? null
  const { data: own } = adultProfile ? await admin.from('players').select('id, dob, team_id, profile_id').eq('profile_id', adultProfile).maybeSingle() : { data: null }
  own && own.team_id === teamId && own.dob === iso(forty) ? ok('a player record of their own, on the squad, with their date of birth') : bad(`player: ${JSON.stringify(own)}`)
  const { data: mem } = adultProfile ? await admin.from('academy_members').select('role, roles').eq('academy_id', NRIFA).eq('profile_id', adultProfile).maybeSingle() : { data: null }
  mem?.role === 'player' && (mem.roles ?? []).includes('player') ? ok(`a membership with the player's hat (${mem.roles.join(' + ')}) — no guardian anywhere`) : bad(`membership: ${JSON.stringify(mem)}`)
  const { data: guardians } = own ? await admin.from('player_guardians').select('profile_id').eq('player_id', own.id) : { data: [] }
  ;(guardians ?? []).length === 0 ? ok('no guardian row: they are their own member') : bad('a guardian row was made for an adult')
  const { data: tm } = adultProfile ? await admin.from('team_members').select('role').eq('team_id', teamId).eq('profile_id', adultProfile).maybeSingle() : { data: null }
  tm?.role === 'player' ? ok("a player's place on the squad") : bad(`team row: ${JSON.stringify(tm)}`)

  // Already signed in: the check says approved, and nothing more is minted.
  const claim = await post('/api/join/claim', { requestId: askBody.requestId }, marco.cookie)
  claim.status === 200 ? ok('their check says approved — they were signed in from the start') : bad(`claim: ${claim.status}`)
  const { data: adultUser } = await admin.auth.admin.getUserById(adultProfile)
  const me = await signInBoth(admin, adultUser.user.email)
  if (!me) throw new Error('could not sign the adult in')

  head('4. Register, pay, chat, play — as themselves')
  const { data: fam } = await me.client.rpc('my_family')
  const self = (fam ?? []).find((c) => c.id === own?.id)
  self?.relationship === 'self' ? ok('My family lists them as "self"') : bad(`my_family: ${JSON.stringify(fam).slice(0, 160)}`)
  const { data: program, error: progErr } = await owner.client.from('programs').insert({ academy_id: NRIFA, name: `${TAG} Over-35s season`, kind: 'squad', status: 'open', team_id: teamId, capacity: 30 }).select('id').single()
  programId = program?.id ?? null
  progErr ? bad(`program: ${progErr.message}`) : ok('a season program for the squad (no birth years — adults)')
  const { error: regErr } = await me.client.from('program_registrations').insert({ academy_id: NRIFA, program_id: programId, player_id: own.id, submitted_by: me.session.user.id })
  regErr ? bad(`register: ${regErr.message}`) : ok('they register themselves for it')
  const { data: fee, error: feeErr } = await owner.client.from('payment_requests').insert({ academy_id: NRIFA, team_id: teamId, title: `${TAG} season fee`, amount_cents: 12000, due_on: new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10), created_by: owner.session.user.id }).select('id').single()
  feeId = fee?.id ?? null
  feeErr ? bad(`fee: ${feeErr.message}`) : ok('the club asks the squad for $120.00')
  const { data: owing } = await me.client.rpc('my_payment_requests', { p_academy: NRIFA })
  ;(owing ?? []).some((o) => o.request_id === feeId && o.player_id === own.id) ? ok('the fee is on their own list, for themselves') : bad(`my fees: ${JSON.stringify(owing).slice(0, 200)}`)
  const pay = await post('/api/payments/checkout', { requestId: feeId, playerIds: [own.id] }, cookieFor(me.session))
  const payBody = await pay.json().catch(() => ({}))
  // The route checks whose fee it is BEFORE it looks at the club's Stripe
  // account, so "not set up" (409) means the adult was accepted as the payer
  // and only the club's connection is missing on this server.
  if (pay.status === 503) note('Stripe is not set up on this server — the checkout step is skipped')
  else if (pay.status === 409 && /payments yet/.test(payBody.error ?? '')) ok('the checkout accepts them as the payer of their own fee (the club\'s Stripe account is not connected on this server, so no session opens)')
  else pay.ok && payBody.url ? ok(`a checkout for $${(payBody.amount_cents / 100).toFixed(2)} opens for them — "That is not your child" no longer stands in the way`) : bad(`checkout: ${pay.status} ${JSON.stringify(payBody)}`)
  const { data: chat } = await me.client.rpc('my_channels', { p_academy: NRIFA })
  const teamChat = (chat ?? []).find((c) => c.team_id === teamId && c.type === 'team')
  teamChat ? ok(`the team's chat is in their list: ${teamChat.name}`) : bad(`chats: ${JSON.stringify((chat ?? []).map((c) => c.name))}`)
  const { error: postErr } = teamChat ? await me.client.from('messages').insert({ academy_id: NRIFA, channel_id: teamChat.channel_id, sender_id: me.session.user.id, body: `${TAG} Who's bringing the oranges?` }) : { error: { message: 'no chat' } }
  postErr ? bad(`post: ${postErr.message}`) : ok('and they post in it')
  const { data: game, error: gameErr } = await owner.client.from('events').insert({ academy_id: NRIFA, team_id: teamId, type: 'match', title: `${TAG} v Old Boys`, starts_at: new Date(Date.now() + 3 * 864e5).toISOString() }).select('id').single()
  gameErr ? bad(`game: ${gameErr.message}`) : ok('a game is drawn for the squad')
  const { data: up } = await me.client.rpc('my_upcoming_events', { p_academy: NRIFA, p_days: 10 })
  const mine = (up ?? []).find((e) => e.id === game?.id)
  mine?.my_children === 1 ? ok('the game counts them (my_children = 1): Home will ask them to answer') : bad(`upcoming: ${JSON.stringify(mine)}`)
  const { error: rsvpErr } = await me.client.from('event_rsvps').insert({ academy_id: NRIFA, event_id: game.id, player_id: own.id, profile_id: me.session.user.id, status: 'yes' })
  rsvpErr ? bad(`rsvp: ${rsvpErr.message}`) : ok('they say yes — for themselves')
  const { data: replies } = await me.client.rpc('my_rsvps_for_event', { p_event: game.id })
  ;(replies ?? []).some((r) => r.player_id === own.id && r.status === 'yes') ? ok('and the answer is theirs on the game page') : bad(`replies: ${JSON.stringify(replies)}`)
  const { data: home } = await me.client.rpc('home_jobs', { p_academy: NRIFA })
  home?.persona === 'player' && (home.hats ?? []).includes('player') ? ok(`Home: the player's hat (${(home.hats ?? []).join(' · ')}), jobs ${(home.jobs ?? []).map((j) => j.id).join(', ')}`) : bad(`home: ${JSON.stringify(home).slice(0, 160)}`)
} finally {
  await tidy()
}
console.log(process.exitCode ? '' : '\n  \x1b[32ma forty-year-old plays for themselves\x1b[0m\n')
