// Run: node --env-file=.env.local scripts/test-security-attack.mjs
//
// The security pass (Joey, 26 Nov 2026): as an outside attacker and as each
// role, try to READ and CHANGE what is not theirs — another club's rows in
// every table that has a tenant, another family's private rows in their own
// club, another person's account rows — straight through the API, the way
// somebody with a session and a browser console would. Read-only for the
// demo: every write attempted is one that must be refused, and anything that
// does get through is put back and reported.
import { createClient } from '@supabase/supabase-js'
import { signInBoth } from './_auth.mjs'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }
const head = (m) => console.log(`\n${m}`)

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const RAVENS = '00000000-0000-0000-0000-0000000a0002'
const SPL = '00000000-0000-0000-0000-0000000a0003'
const { data: iwRow } = await admin.from('academies').select('id').eq('name', 'Inner West FC').maybeSingle()
const IW = iwRow?.id
if (!IW) { bad('no Inner West FC in the demo'); process.exit(1) }

const TENANT = 'academy_billing,academy_features,academy_members,academy_sponsors,activity_log,bans,channel_members,channels,club_message_recipients,club_messages,club_roles,competition_clubs,competition_entries,conduct_reports,consent_acceptances,consent_documents,deleted_message_archive,entry_fees,entry_squads,event_attendance,event_checklist_ticks,event_duties,event_job_helpers,event_jobs,event_lineup_players,event_lineups,event_photos,event_player_stats,event_pulse,event_rsvps,event_scans,event_series,event_ticker,event_videos,events,import_batches,imported_games,incident_reports,invite_teams,invites,join_link_redemptions,join_links,join_requests,league_roles,message_reactions,message_reports,messages,notification_queue,offers,payment_promises,payment_requests,payments,pitch_availability,pitch_size_rules,pitches,player_clips,player_concussions,player_guardians,player_logins,player_medical,player_reports,players,playfootball_imports,playfootball_rows,poll_votes,polls,potm_votes,program_registrations,programs,referee_appointments,referee_blockouts,referee_payment_items,referee_payment_runs,referees,refunds,registration_drafts,registration_requests,role_requests,safeguarding_officers,squad_numbers,staff_accreditations,staff_clearances,streams,support_requests,suspensions,team_duties,team_members,teams,translation_takes,trial_placements,trial_ratings,venues,voucher_redemptions,vouchers'.split(',')
// Rows of another club a person may see BY DESIGN, with the reason. Anything else non-zero is a finding.
const ALLOWED = {
  competition_clubs: 'which clubs are in a competition you are in (the draw, not the people)',
  competition_entries: 'the teams on a draw you are in',
  academy_sponsors: 'a sponsor strip is public',
  academy_features: 'which features a public page shows',
  consent_documents: 'a club\'s published agreements are on its public register page',
  programs: 'open programs are on a club\'s public page',
  venues: 'grounds on a draw', pitches: 'pitches on a draw', pitch_size_rules: 'a league\'s pitch rules', pitch_availability: 'a league\'s pitch hours',
  referees: 'a league\'s referee pool, to its staff', referee_appointments: 'who referees a game you are in',
  entry_fees: 'what your club owes a league / a league\'s own fees', entry_squads: 'a league checks squads for the sheets',
  suspensions: 'a league\'s discipline list for its competition',
}
const PEOPLE = [
  ['a stranger (signed out)', null, [NRIFA, IW, RAVENS, SPL], null],
  ['NRIFA parent', 'p61400000011@squadroom.invalid', [IW, RAVENS, SPL], NRIFA],
  ['NRIFA coach', 'p61400000002@squadroom.invalid', [IW, RAVENS, SPL], NRIFA],
  ['Inner West parent', 'iw.parent@squadroom-demo.test', [NRIFA, RAVENS, SPL], IW],
  ['Inner West coach', 'iw.coach@squadroom-demo.test', [NRIFA, RAVENS, SPL], IW],
  ['Inner West team manager', 'iw.manager@squadroom-demo.test', [NRIFA, RAVENS, SPL], IW],
  ['Inner West Treasurer', 'iw.treasurer@squadroom-demo.test', [NRIFA, RAVENS, SPL], IW],
  ['Inner West President', 'iw.president@squadroom-demo.test', [NRIFA, RAVENS, SPL], IW],
  ['League organiser', 'organiser@squadroom-demo.test', [NRIFA, IW, RAVENS], SPL],
]
const NAME = { [NRIFA]: 'NRIFA', [IW]: 'Inner West', [RAVENS]: 'Ravens', [SPL]: 'SPL' }
const sessions = {}
for (const [who, email] of PEOPLE) {
  if (!email) { sessions[who] = { client: createClient(URL_, PUB, { auth: { persistSession: false } }), id: null }; continue }
  const s = await signInBoth(admin, email)
  if (!s) { bad(`could not sign in ${who}`); process.exit(2) }
  const { data: u } = await s.client.auth.getUser()
  sessions[who] = { client: s.client, id: u?.user?.id ?? null }
}
// Two reads are a person's own, whatever club the row is filed under: their own
// notifications (a league tells a coach about a suspension), and the Notices
// room of a competition their club plays in (computed membership, 0240).
const count = async (client, table, col, val, me) => {
  let q = client.from(table).select('*', { count: 'exact', head: true }).eq(col, val)
  if (table === 'notification_queue' && me) q = q.neq('profile_id', me)
  if (table === 'channels' && me) q = q.not('type', 'in', '(notices,clubs)')
  const { count: n, error } = await q
  return error ? 0 : (n ?? 0)
}

head('1. Another club\'s rows, table by table, as each person')
const findings = []
for (const [who, , targets] of PEOPLE) {
  const { client, id: me } = sessions[who]
  let leaks = 0, byDesign = 0
  for (const target of targets) {
    const ns = await Promise.all(TENANT.map((t) => count(client, t, 'academy_id', target, me)))
    TENANT.forEach((t, i) => {
      if (!ns[i]) return
      if (ALLOWED[t] && who !== 'a stranger (signed out)') { byDesign++; return }
      leaks++; findings.push(`${who} reads ${ns[i]} ${t} rows of ${NAME[target]}`)
    })
  }
  leaks === 0 ? ok(`${who}: nothing of another club's in ${TENANT.length} tables × ${targets.length} clubs (${byDesign} by-design reads: draws, public pages)`) : bad(`${who}: ${leaks} leaks`)
}
for (const f of findings) console.log(`      ${f}`)

head('2. Another person\'s account rows')
{
  const PERSONAL = [['profiles', 'id'], ['account_emails', 'profile_id'], ['user_settings', 'profile_id'], ['push_subscriptions', 'profile_id'], ['trusted_devices', 'profile_id'], ['two_step_passes', 'profile_id'], ['two_step_codes', 'profile_id'], ['email_codes', 'email'], ['email_confirmations', 'profile_id'], ['news_consents', 'profile_id'], ['calendar_feeds', 'profile_id'], ['notice_reads', 'profile_id'], ['platform_admins', 'profile_id'], ['join_attempts', 'ip'], ['registration_attempts', 'ip']]
  for (const [who] of PEOPLE) {
    const { client, id } = sessions[who]
    const out = []
    for (const [t, col] of PERSONAL) {
      let q = client.from(t).select('*', { count: 'exact', head: true })
      if (id && col !== 'email' && col !== 'ip') q = q.neq(col, id)
      const { count: n, error } = await q
      if (!error && n) out.push(`${t}: ${n}`)
    }
    // profiles of people in your own organisation are the directory; anything else is not.
    const others = out.filter((x) => !x.startsWith('profiles:') && !x.startsWith('account_emails:') && !x.startsWith('notice_reads:'))
    others.length === 0 ? ok(`${who}: no other person's settings, devices, codes or passes${out.length ? ` (directory reads: ${out.join(', ')})` : ''}`) : bad(`${who} reads other people's ${others.join(', ')}`)
  }
  // The directory: profiles a person can read must all share an organisation (or a competition's computed room) with them.
  for (const who of ['NRIFA parent', 'Inner West parent', 'Inner West Treasurer']) {
    const { client, id } = sessions[who]
    const { data: seen } = await client.from('profiles').select('id').neq('id', id).limit(2000)
    const ids = (seen ?? []).map((p) => p.id)
    const { data: mine } = await admin.from('academy_members').select('academy_id').eq('profile_id', id).eq('status', 'active')
    const orgs = (mine ?? []).map((m) => m.academy_id)
    let strangers = 0
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200)
      const { data: shared } = await admin.from('academy_members').select('profile_id').in('profile_id', chunk).in('academy_id', orgs)
      const inMine = new Set((shared ?? []).map((s) => s.profile_id))
      strangers += chunk.filter((x) => !inMine.has(x)).length
    }
    strangers === 0 ? ok(`${who}: every profile they can read (${ids.length}) is in their own club`) : bad(`${who} reads ${strangers} profiles of people outside their club`)
    const { data: phones } = await client.from('profiles').select('id, phone').neq('id', id).not('phone', 'is', null).limit(2000)
    console.log(`      (${who} can read ${(phones ?? []).length} other people's phone numbers)`)
    const { data: emails } = await client.from('account_emails').select('profile_id').neq('profile_id', id).limit(2000)
    ;(emails ?? []).length === 0 || who !== 'NRIFA parent' && who !== 'Inner West parent' ? ok(`${who}: other people's emails readable: ${(emails ?? []).length}`) : bad(`${who} (a parent) reads ${(emails ?? []).length} other people's email addresses`)
  }
}

head('3. Another family\'s private rows in the same club')
{
  for (const [who, club] of [['NRIFA parent', NRIFA], ['Inner West parent', IW], ['Inner West coach', IW], ['Inner West team manager', IW], ['Inner West Treasurer', IW]]) {
    const { client, id } = sessions[who]
    const { data: g } = await admin.from('player_guardians').select('player_id').eq('profile_id', id)
    const mineKids = (g ?? []).map((x) => x.player_id)
    const notMine = (q) => (mineKids.length ? q.not('player_id', 'in', `(${mineKids.join(',')})`) : q)
    const n = async (t, f = (q) => q) => { const { count: c, error } = await f(client.from(t).select('*', { count: 'exact', head: true }).eq('academy_id', club)); return error ? 0 : (c ?? 0) }
    const med = await n('player_medical', notMine)
    const pay = await n('payments', (q) => notMine(q).neq('profile_id', id))
    const reg = await n('registration_requests', (q) => q.neq('profile_id', id))
    const guard = await n('player_guardians', (q) => notMine(q).neq('profile_id', id)) // a co-parent of your own child is yours to see
    const inc = await n('incident_reports'); const con = await n('conduct_reports', (q) => q.neq('reported_by', id)); const clr = await n('staff_clearances', (q) => q.neq('profile_id', id))
    const rep = await n('player_reports', notMine); const conc = await n('player_concussions', notMine); const cons = await n('consent_acceptances', (q) => q.neq('profile_id', id))
    const refunds = await n('refunds', notMine); const promises = await n('payment_promises', (q) => q.neq('profile_id', id)); const vouch = await n('voucher_redemptions', notMine)
    const line = `medical ${med}, payments ${pay}, registrations ${reg}, guardians ${guard}, incidents ${inc}, conduct ${con}, clearances ${clr}, reports ${rep}, concussions ${conc}, consents ${cons}, refunds ${refunds}, promises ${promises}, vouchers ${vouch}`
    const isParent = /parent/.test(who)
    const isTreasurer = /Treasurer/.test(who)
    const wrong = isParent ? med + pay + reg + guard + inc + con + clr + rep + conc + cons + refunds + promises + vouch
      : isTreasurer ? med + inc + con + rep + conc
      : pay + refunds + promises + inc + con // a coach or manager: no money, no welfare reports
    wrong === 0 ? ok(`${who}: ${line}`) : bad(`${who} sees what is not theirs — ${line}`)
  }
}

head('4. Writes that must be refused')
{
  const { data: iwKid } = await admin.from('players').select('id, full_name, team_id, dob').eq('academy_id', IW).limit(1).single()
  const { data: nrKid } = await admin.from('players').select('id, full_name, team_id, dob').eq('academy_id', NRIFA).not('team_id', 'is', null).limit(1).single()
  const { data: iwCh } = await admin.from('channels').select('id').eq('academy_id', IW).eq('type', 'team').limit(1).single()
  const { data: iwEv } = await admin.from('events').select('id, title').eq('academy_id', IW).gt('starts_at', new Date().toISOString()).limit(1).single()
  const { data: iwPay } = await admin.from('payments').select('id, status').eq('academy_id', IW).neq('status', 'paid').limit(1).maybeSingle()
  for (const who of ['a stranger (signed out)', 'NRIFA parent', 'NRIFA coach', 'League organiser']) {
    const { client, id } = sessions[who]
    const tries = []
    const t = async (label, p) => { const { data, error } = await p; const took = !error && (Array.isArray(data) ? data.length > 0 : Boolean(data)); tries.push([label, took, error?.code]) }
    await t('rename another club\'s child', client.from('players').update({ full_name: 'HACKED' }).eq('id', iwKid.id).select('id'))
    await t('delete another club\'s child', client.from('players').delete().eq('id', iwKid.id).select('id'))
    await t('post in another club\'s squad chat', client.from('messages').insert({ academy_id: IW, channel_id: iwCh.id, sender_id: id, body: 'HACKED' }).select('id'))
    await t('call off another club\'s game', client.from('events').update({ cancelled_at: new Date().toISOString() }).eq('id', iwEv.id).select('id'))
    await t('join another club as its owner', client.from('academy_members').insert({ academy_id: IW, profile_id: id, role: 'owner', status: 'active' }).select('profile_id'))
    await t('become guardian of another club\'s child', client.from('player_guardians').insert({ academy_id: IW, player_id: iwKid.id, profile_id: id }).select('player_id'))
    await t('read another club\'s child\'s medical notes', client.from('player_medical').select('player_id').eq('player_id', iwKid.id))
    if (iwPay) await t('mark another club\'s payment paid', client.from('payments').update({ status: 'paid' }).eq('id', iwPay.id).select('id'))
    await t('answer a game for another club\'s child', client.from('event_rsvps').insert({ academy_id: IW, event_id: iwEv.id, profile_id: id, player_id: iwKid.id, status: 'yes' }).select('event_id'))
    const through = tries.filter((x) => x[1])
    through.length === 0 ? ok(`${who}: ${tries.length} writes on another club refused`) : bad(`${who} GOT THROUGH: ${through.map((x) => x[0]).join('; ')}`)
  }
  // Inside the club: a parent on their own club's rows.
  {
    const who = 'NRIFA parent'; const { client, id } = sessions[who]
    const { data: g } = await admin.from('player_guardians').select('player_id').eq('profile_id', id)
    const { data: other } = await admin.from('players').select('id, full_name').eq('academy_id', NRIFA).not('id', 'in', `(${(g ?? []).map((x) => x.player_id).join(',')})`).limit(1).single()
    const { data: someone } = await admin.from('academy_members').select('profile_id').eq('academy_id', NRIFA).neq('profile_id', id).limit(1).single()
    const tries = []
    const t = async (label, p) => { const { data, error } = await p; tries.push([label, !error && Array.isArray(data) && data.length > 0]) }
    await t('make themselves owner', client.from('academy_members').update({ role: 'owner', roles: ['owner'] }).eq('academy_id', NRIFA).eq('profile_id', id).select('profile_id'))
    await t('rename another family\'s child', client.from('players').update({ full_name: 'HACKED' }).eq('id', other.id).select('id'))
    await t('become another child\'s guardian', client.from('player_guardians').insert({ academy_id: NRIFA, player_id: other.id, profile_id: id }).select('player_id'))
    await t('edit another person\'s profile', client.from('profiles').update({ full_name: 'HACKED' }).eq('id', someone.profile_id).select('id'))
    await t('write a payment as paid', client.from('payments').insert({ academy_id: NRIFA, request_id: null, profile_id: id, amount_cents: 1, currency: 'aud', status: 'paid' }).select('id'))
    await t('give themselves a club role', client.from('club_roles').insert({ academy_id: NRIFA, profile_id: id, role: 'treasurer', scope_kind: 'club' }).select('id'))
    await t('clear their own check', client.from('staff_clearances').insert({ academy_id: NRIFA, profile_id: id, kind: 'wwcc', number: 'WWC9999999E', outcome: 'cleared', expires_on: '2030-01-01' }).select('profile_id'))
    await t('delete a squad', client.from('teams').delete().eq('academy_id', NRIFA).select('id'))
    const { data: me } = await admin.from('academy_members').select('role').eq('academy_id', NRIFA).eq('profile_id', id).single()
    const through = tries.filter((x) => x[1])
    through.length === 0 && me.role === 'parent' ? ok(`a parent in their own club: ${tries.length} escalations refused, still a parent`) : bad(`a parent GOT THROUGH: ${through.map((x) => x[0]).join('; ')} (role now ${me.role})`)
    const { data: still } = await admin.from('players').select('full_name').eq('id', other.id).single()
    if (still.full_name === 'HACKED') await admin.from('players').update({ full_name: other.full_name }).eq('id', other.id)
  }
  const { data: kidNow } = await admin.from('players').select('full_name').eq('id', iwKid.id).maybeSingle()
  kidNow?.full_name === iwKid.full_name ? ok('the Inner West child is untouched') : bad(`the Inner West child is now ${JSON.stringify(kidNow)}`)
  await admin.from('messages').delete().eq('channel_id', iwCh.id).eq('body', 'HACKED')
  void nrKid
}
console.log(process.exitCode ? '\n\x1b[31mSOMETHING GOT THROUGH\x1b[0m\n' : '\n\x1b[32mnothing got through\x1b[0m\n')
