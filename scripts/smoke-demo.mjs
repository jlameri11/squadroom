// Run: node --env-file=.env.local scripts/smoke-demo.mjs
//
// Walks the demo the way a person would, and reports anything a demo would
// trip over.
//
// Every other test in scripts/ asks "is this rule enforced". This one asks
// "is there anything to look at" — which is a different question, and the one
// that matters the day before somebody shows this to a club. A screen that
// enforces its rules perfectly and renders an empty list is a screen that
// fails a demo.
//
// So each check is a screen, in the order a person meets it, as the person
// who meets it: a coach for the admin half, a parent for the family half, and
// nobody at all for the public pages. It reports WARN for thin-but-working
// and FAIL for broken, because those need different responses.
import { createClient } from '@supabase/supabase-js'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})
const anon = createClient(URL_, PUB, { auth: { persistSession: false } })
const SITE = process.env.SITE ?? 'https://squadroom-dev.netlify.app'

let fails = 0
let warns = 0
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const warn = (m) => {
  console.log(`  \x1b[33m!\x1b[0m ${m}`)
  warns++
}
const fail = (m) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`)
  fails++
}
const head = (m) => console.log(`\n\x1b[1m${m}\x1b[0m`)

const NRIFA = '00000000-0000-0000-0000-0000000a0001'

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
    console.log(`\n  Stopping: could not sign in ${email} — auth rate limit, not a failure.\n`)
    process.exit(2)
  }
  return createClient(URL_, PUB, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${s.session.access_token}` } },
  })
}

console.log('\n\x1b[1mSquadroom demo walkthrough\x1b[0m')

const coach = await sess('joeylameri@outlook.com')
const parent = await sess('p61400000011@squadroom.invalid')

// --- the coach's half ------------------------------------------------------

head('Home screen (coach)')
{
  const { data, error } = await coach.rpc('home_screen', {})
  if (error || !data) {
    fail(`home_screen: ${error?.message ?? 'returned nothing'}`)
  } else {
    data.academy?.name ? ok(`lands in ${data.academy.name}`) : fail('no academy')
    data.events?.length > 0
      ? ok(`${data.events.length} upcoming fixtures on the home screen`)
      : fail('no upcoming fixtures — the home screen is empty')
    data.channels?.length > 0
      ? ok(`${data.channels.length} chats`)
      : fail('no chats on the home screen')
    const withPreview = (data.channels ?? []).filter((c) => c.last_message_body)
    withPreview.length > 0
      ? ok(`${withPreview.length} show a message preview`)
      : warn('no chat previews — the list will look dead')
    data.role ? ok(`signed in as ${data.role}`) : fail('no role')
  }
}

head('Organisation switcher')
{
  const { data } = await coach.rpc('my_organisations')
  const orgs = data ?? []
  orgs.length >= 2
    ? ok(`${orgs.length} organisations: ${orgs.map((o) => `${o.name} (${o.type})`).join(', ')}`)
    : warn(`only ${orgs.length} organisation — the switcher will be hidden`)
  const { data: badges } = await coach.rpc('nav_badges', {})
  badges?.org_count >= 2 ? ok('the crest will offer a switch') : warn('switcher hidden')
}

head('Chat')
{
  const { data } = await coach.rpc('chat_screen', {})
  const channels = data?.channels ?? []
  channels.length > 0 ? ok(`${channels.length} channels`) : fail('no channels')
  const named = channels.filter((c) => c.name && c.name !== 'Direct message')
  named.length > 0 ? ok(`e.g. ${named.slice(0, 3).map((c) => c.name).join(', ')}`) : fail('no named channels')

  const biggest = channels.sort((a, b) => (b.unread_count ?? 0) - (a.unread_count ?? 0))[0]
  const { data: msgs } = await coach.rpc('channel_messages', {
    p_channel: biggest.channel_id,
    p_limit: 20,
  })
  ;(msgs ?? []).length > 0
    ? ok(`"${biggest.name}" has ${msgs.length} messages to scroll`)
    : fail(`"${biggest.name}" is empty — opening it shows nothing`)
  const withSender = (msgs ?? []).filter((m) => m.sender_name)
  withSender.length === (msgs ?? []).length
    ? ok('every message has a sender name')
    : fail(`${(msgs ?? []).length - withSender.length} messages have no sender name`)

  // DMs were broken for three weeks by a dropped join; worth checking every time.
  const dms = channels.filter((c) => c.type === 'direct')
  if (dms.length > 0) {
    dms.every((c) => c.name && c.name !== 'Direct message')
      ? ok(`${dms.length} DMs, all named after the other person`)
      : fail('a DM is showing as "Direct message" — the 0071 regression is back')
  }
}

head('Fixtures')
{
  const { data } = await coach.rpc('fixtures_screen', { p_days: 60 })
  const events = data?.events ?? []
  events.length > 0 ? ok(`${events.length} events in the next 60 days`) : fail('no fixtures')
  const kinds = new Set(events.map((e) => e.type))
  kinds.has('training')
    ? ok(`includes training (${[...kinds].join(', ')})`)
    : warn(`no training sessions — only ${[...kinds].join(', ')}`)
  const withVenue = events.filter((e) => e.venue)
  withVenue.length > 0 ? ok(`${withVenue.length} have a venue`) : warn('no venues set')
  const future = events.filter((e) => new Date(e.starts_at) > new Date())
  future.length > 0 ? ok(`${future.length} still to come`) : fail('every fixture is in the past')
}

head('Teams and players')
{
  const { data: teams } = await coach
    .from('teams')
    .select('id, name, status, players(count)')
    .eq('academy_id', NRIFA)
    .eq('status', 'active')
  const active = teams ?? []
  active.length > 0 ? ok(`${active.length} active squads`) : fail('no active teams')
  const peopled = active.filter((t) => (t.players?.[0]?.count ?? 0) > 0)
  peopled.length === active.length
    ? ok('every active squad has players')
    : warn(`${active.length - peopled.length} active squads are empty and will show in pickers`)

  const { data: links } = await coach
    .from('join_links')
    .select('code, expires_at, revoked_at, team_id')
    .eq('academy_id', NRIFA)
  const live = (links ?? []).filter(
    (l) => !l.revoked_at && new Date(l.expires_at) > new Date()
  )
  live.length > 0
    ? ok(`${live.length} live join codes, e.g. ${live[0].code}`)
    : fail('no live join codes — "here is how a parent joins" will show an expired page')
}

head('Competitions')
{
  const { data: comps } = await coach
    .from('competitions')
    .select('id, name, mode, public_slug, published_at')
  const all = comps ?? []
  all.length > 0 ? ok(`${all.length} competitions`) : fail('no competitions')

  for (const c of all) {
    const { data: sheet } = await coach.rpc('competition_run_sheet', { p_competition: c.id })
    const games = sheet ?? []
    const played = games.filter((g) => g.status === 'final')
    if (games.length === 0) {
      warn(`"${c.name}" has no draw`)
      continue
    }
    ok(`"${c.name}": ${games.length} games, ${played.length} played`)

    const { data: entries } = await coach
      .from('competition_entries')
      .select('division')
      .eq('competition_id', c.id)
    const divisions = [...new Set((entries ?? []).map((e) => e.division))].filter(Boolean)
    for (const d of divisions) {
      const { data: ladder } = await coach.rpc('competition_ladder', {
        p_competition: c.id,
        p_division: d,
      })
      ;(ladder ?? []).length > 0
        ? ok(`  ${d}: ladder of ${ladder.length}, top is ${ladder[0].team_name} on ${ladder[0].points}`)
        : warn(`  ${d}: empty ladder`)
    }
  }
}

head('Programs and registrations')
{
  const { data: programs } = await coach
    .from('programs')
    .select('id, name, status, capacity, program_registrations(status)')
    .eq('academy_id', NRIFA)
  const all = programs ?? []
  all.length > 0 ? ok(`${all.length} programs`) : fail('no programs — /admin/programs is empty')
  const open = all.filter((p) => p.status === 'open')
  open.length > 0 ? ok(`${open.length} open for registration`) : fail('none open')

  const regs = all.flatMap((p) => p.program_registrations ?? [])
  const byStatus = {}
  for (const r of regs) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1
  regs.length > 0
    ? ok(`${regs.length} registrations: ${Object.entries(byStatus).map(([k, v]) => `${v} ${k}`).join(', ')}`)
    : fail('no registrations — the approval queue is empty')
  byStatus.pending > 0 ? ok('something is waiting to be approved') : warn('nothing pending to demo')
  byStatus.waitlisted > 0 ? ok('and a waitlist to show') : warn('no waitlist to demo')
}

head('Attendance')
{
  const { data: teams } = await coach
    .from('teams')
    .select('id, name')
    .eq('academy_id', NRIFA)
    .eq('status', 'active')
    .order('name')
  let anyMarked = false
  for (const t of teams ?? []) {
    const { data, error } = await coach.rpc('attendance_summary', {
      p_academy: NRIFA,
      p_team: t.id,
    })
    if (error) {
      fail(`attendance_summary ${t.name}: ${error.message}`)
      continue
    }
    const rated = (data ?? []).filter((r) => r.rate !== null)
    if (rated.length === 0) {
      warn(`${t.name}: no registers taken`)
      continue
    }
    anyMarked = true
    const avg = Math.round(rated.reduce((n, r) => n + Number(r.rate), 0) / rated.length)
    const worst = rated.slice().sort((a, b) => Number(a.rate) - Number(b.rate))[0]
    ok(`${t.name}: ${rated.length} players, ${avg}% average, lowest ${worst.player_name} on ${worst.rate}%`)
  }
  if (!anyMarked) fail('no attendance anywhere — the panel will be empty on every squad')

  // And a register a coach could take right now.
  const { data: past } = await coach
    .from('events')
    .select('id, title')
    .eq('academy_id', NRIFA)
    .not('team_id', 'is', null)
    .is('cancelled_at', null)
    .lt('starts_at', new Date().toISOString())
    .order('starts_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (past) {
    const { data: register, error } = await coach.rpc('event_register', { p_event: past.id })
    error
      ? fail(`event_register: ${error.message}`)
      : (register ?? []).length > 0
        ? ok(`"${past.title}" has a register of ${register.length}`)
        : fail('the most recent session has an empty register')
  }
}

head('Admin queues')
{
  const { data: badges } = await coach.rpc('nav_badges', {})
  badges?.is_staff ? ok('the Admin tab is visible') : fail('the coach is not staff')
  typeof badges?.pending_registrations === 'number'
    ? ok(`badge shows ${badges.pending} waiting (${badges.pending_joins} joins, ${badges.pending_registrations} registrations)`)
    : fail('nav_badges is missing the registration count')
}

// --- the family's half -----------------------------------------------------

head('Home screen (parent)')
{
  const { data, error } = await parent.rpc('home_screen', {})
  if (error || !data) {
    fail(`home_screen: ${error?.message ?? 'nothing'}`)
  } else {
    const events = data.events ?? []
    events.length > 0 ? ok(`${events.length} fixtures`) : fail('a parent sees no fixtures')
    const askable = events.filter((e) => (e.rsvps ?? []).length > 0)
    askable.length > 0
      ? ok(`${askable.length} ask about their children by name`)
      : fail('no per-child RSVP rows — the main parent action is missing')
    const kids = new Set(events.flatMap((e) => (e.rsvps ?? []).map((r) => r.player_name)))
    kids.size > 0 ? ok(`children: ${[...kids].join(', ')}`) : fail('no children linked')
    data.role === 'parent' ? ok('signed in as a parent') : warn(`role is ${data.role}`)
  }
}

head('Sign-up screen (parent)')
{
  const { data: programs } = await parent
    .from('programs')
    .select('id, name, status')
    .eq('academy_id', NRIFA)
    .eq('status', 'open')
  ;(programs ?? []).length > 0
    ? ok(`${programs.length} programs a parent can sign up to`)
    : fail('/programs is empty for a parent')
  const { data: drafts } = await parent
    .from('programs')
    .select('id')
    .eq('academy_id', NRIFA)
    .eq('status', 'draft')
  ;(drafts ?? []).length === 0
    ? ok('and drafts are invisible to them')
    : fail(`a parent can see ${drafts.length} draft programs`)
}

head('Directory (parent)')
{
  const { data, error } = await parent.rpc('member_directory', { p_academy: NRIFA })
  if (error) {
    fail(`academy_directory: ${error.message}`)
  } else {
    const people = data ?? []
    people.length > 0 ? ok(`${people.length} people listed`) : fail('the directory is empty')
    // A parent SHOULD see their coach's number — that is who you ring when
    // you are lost on the way to a ground. What they must not see is other
    // parents', which is the default and the thing worth checking.
    const withPhone = people.filter((p) => p.phone)
    const staffPhones = withPhone.filter((p) => ['owner', 'admin', 'coach'].includes(p.role))
    const parentPhones = withPhone.filter((p) => p.role === 'parent')
    staffPhones.length > 0
      ? ok(`${staffPhones.length} staff numbers visible, which is the point of the directory`)
      : warn('no staff numbers visible — a parent cannot ring their coach')
    parentPhones.length === 0
      ? ok("and no other parents' numbers, which is the default")
      : warn(`${parentPhones.length} other parents' numbers visible — check directory_visibility`)
  }
}

head('Payments (parent)')
{
  const { data, error } = await parent.rpc('my_payment_requests', { p_academy: NRIFA })
  if (error) {
    fail(`my_payment_requests: ${error.message}`)
  } else {
    const bills = data ?? []
    bills.length > 0
      ? ok(`${bills.length} bill(s), e.g. "${bills[0].title}" at $${(bills[0].amount_cents / 100).toFixed(2)}`)
      : warn('nothing to pay — the payments screen will be empty')
  }
}

head('Event detail and RSVP (parent)')
{
  const { data: home } = await parent.rpc('home_screen', {})
  const next = (home?.events ?? [])[0]
  if (!next) {
    fail('no event to open')
  } else {
    const { data: mine, error } = await parent.rpc('my_rsvps_for_event', { p_event: next.id })
    error
      ? fail(`my_rsvps_for_event: ${error.message}`)
      : (mine ?? []).length > 0
        ? ok(`"${next.title}" asks about ${mine.length} child(ren)`)
        : fail('the event detail has nothing to answer')
    // A tally is for coaches only — a parent seeing one is a leak.
    const { data: summary } = await parent.rpc('event_rsvp_summary', { p_event: next.id })
    const row = Array.isArray(summary) ? summary[0] : summary
    row?.going === null || row?.going === undefined
      ? ok('and no tally, which is staff-only')
      : warn(`a parent can see the tally (going=${row.going})`)
  }
}

head('Search')
{
  // search_chat returns { messages, people } rather than a flat list, and
  // searches MESSAGES — so a term has to exist in the chat history, not in a
  // fixture title.
  let searched = 0
  for (const q of ['kit', 'training', 'game', 'Sam']) {
    const { data, error } = await coach.rpc('search_chat', {
      p_query: q,
      p_limit: 20,
      p_academy: NRIFA,
    })
    if (error) {
      fail(`search_chat "${q}": ${error.message}`)
      break
    }
    const hits = (data?.messages?.length ?? 0) + (data?.people?.length ?? 0)
    if (hits > 0) {
      ok(`"${q}" finds ${data.messages?.length ?? 0} message(s) and ${data.people?.length ?? 0} person/people`)
      searched++
    }
  }
  searched > 0 ? null : warn('search found nothing for any common term')
}

head('Polls')
{
  const { data: channels } = await coach.rpc('chat_screen', {})
  let found = 0
  for (const c of (channels?.channels ?? []).slice(0, 6)) {
    const { data: msgs } = await coach.rpc('channel_messages', { p_channel: c.channel_id, p_limit: 30 })
    found += (msgs ?? []).filter((m) => m.poll_id).length
  }
  found > 0 ? ok(`${found} poll(s) in the recent chat history`) : warn('no polls to show')
}

head('Calendar subscription and the child link')
{
  const { data: token } = await parent.rpc('my_calendar_token')
  if (!token) {
    fail('no calendar token — the child link and the subscription both break')
  } else {
    ok('calendar token issued')
    const ics = await fetch(`${SITE}/api/calendar/${token}`)
    const body = await ics.text()
    ics.ok && body.includes('BEGIN:VCALENDAR')
      ? ok(`the .ics feed works (${(body.match(/BEGIN:VEVENT/g) ?? []).length} events)`)
      : fail(`the calendar feed returned ${ics.status}`)

    const page = await fetch(`${SITE}/my/${token}`)
    const html = await page.text()
    page.ok && !/No games coming up/.test(html)
      ? ok("the child's page shows their next game")
      : fail(`/my/${token.slice(0, 8)}… shows no games`)
  }
}

// --- nobody at all ---------------------------------------------------------

head('Public pages (no account)')
{
  const { data: published } = await admin
    .from('competitions')
    .select('name, public_slug')
    .not('public_slug', 'is', null)
    .not('published_at', 'is', null)
  if ((published ?? []).length === 0) {
    fail('no competition is published — there is no public page to show')
  } else {
    for (const c of published) {
      const { data } = await anon.rpc('public_match_centre', { p_slug: c.public_slug })
      if (!data) {
        fail(`/c/${c.public_slug} returns nothing`)
        continue
      }
      ok(`/c/${c.public_slug}: ${data.fixtures.length} fixtures, ${data.divisions.length} divisions`)
      const squads = Object.values(data.squads ?? {}).flat()
      squads.length > 0
        ? ok(`  ${squads.length} players named across ${Object.keys(data.squads).length} squads`)
        : warn('  no squads published')
      const page = await fetch(`${SITE}/c/${c.public_slug}`)
      page.ok ? ok(`  the page itself returns ${page.status}`) : fail(`  the page returned ${page.status}`)
    }
  }

  const { data: link } = await admin
    .from('join_links')
    .select('code')
    .eq('academy_id', NRIFA)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .limit(1)
    .maybeSingle()
  if (link) {
    const page = await fetch(`${SITE}/join/${link.code}`)
    const html = await page.text()
    page.ok && !/expired/i.test(html)
      ? ok(`/join/${link.code} opens the join form`)
      : fail(`/join/${link.code} shows an expired page`)
  }
}

head('Every route answers')
{
  const routes = [
    '/', '/signin', '/signup', '/join', '/chat', '/calendar', '/directory',
    '/admin', '/admin/teams', '/admin/programs', '/admin/requests', '/admin/import',
    '/admin/payments', '/admin/members', '/admin/invites',
    '/programs', '/competitions', '/competitions/new', '/payments', '/settings',
    '/settings/academy', '/scan',
  ]
  const broken = []
  for (const r of routes) {
    const res = await fetch(`${SITE}${r}`, { redirect: 'manual' })
    if (res.status >= 500) broken.push(`${r} → ${res.status}`)
  }
  broken.length === 0
    ? ok(`all ${routes.length} routes answer without a server error`)
    : fail(`${broken.length} broken: ${broken.join(', ')}`)
}

// --- things a demo needs that need a key -----------------------------------

head('Known gaps')
{
  const { data: billing } = await admin
    .from('academy_billing')
    .select('stripe_account_id, charges_enabled')
    .eq('academy_id', NRIFA)
    .maybeSingle()
  billing?.charges_enabled
    ? ok('Stripe is connected — payments can be demoed')
    : warn('Stripe is not connected: a parent can see a bill but not pay it (needs a free sk_test key)')

  const { count: devices } = await admin
    .from('push_subscriptions')
    .select('id', { count: 'exact', head: true })
  devices > 0
    ? ok(`${devices} device(s) registered for push`)
    : warn('no push devices: install the PWA on a phone to demo notifications')
}

console.log(
  `\n  ${fails === 0 ? '\x1b[32m' : '\x1b[31m'}${fails} blocking\x1b[0m, ` +
    `\x1b[33m${warns} worth knowing\x1b[0m\n`
)
process.exit(fails > 0 ? 1 : 0)
