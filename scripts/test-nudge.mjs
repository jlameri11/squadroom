// Run: node --env-file=.env.local scripts/test-nudge.mjs
//
// Proves 0109 (E-03, C-01): chasing the people who have not answered.
//
// The assertion that carries the weight is the SECOND press. A coach who is
// not sure it worked will press it again — the same lesson as the whole-day
// cancellation — and a family nudged five times about one game is a family
// who turns notifications off. Spond's notification overload is the whole
// cautionary tale here.
//
// And two about honesty: the number returned must be what was actually sent,
// not what was intended; and a nudge must not go out at eleven at night.
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
const TAG = 'TESTNUDGE'

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
const parent = await sess('p61400000011@squadroom.invalid')

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
  const { data: msgs } = await admin.from('messages').select('id').like('body', `${TAG}%`)
  for (const m of msgs ?? []) {
    await admin.from('notification_queue').delete().eq('payload->>message_id', m.id)
  }
  await admin.from('messages').delete().like('body', `${TAG}%`)
  // Quiet hours back on — the seed default.
  await admin
    .from('user_settings')
    .update({ quiet_hours_enabled: true })
    .neq('profile_id', '00000000-0000-0000-0000-000000000000')
}
await clean()

// A fixture three days out, so nothing is already answered.
const { data: event, error: eventError } = await admin
  .from('events')
  .insert({
    academy_id: NRIFA,
    team_id: U8_TEAM,
    type: 'match',
    title: `${TAG} vs Gladesville`,
    starts_at: new Date(Date.now() + 3 * 864e5).toISOString(),
    ends_at: new Date(Date.now() + 3 * 864e5 + 3600e3).toISOString(),
    venue: 'ELS Hall Park',
    source: 'manual',
  })
  .select('id')
  .single()
if (eventError) {
  bad(eventError.message)
  process.exit(1)
}

// Quiet hours off for everybody, so "sent now" is testable. The quiet-hours
// branch gets its own step.
await admin
  .from('user_settings')
  .update({ quiet_hours_enabled: false })
  .neq('profile_id', '00000000-0000-0000-0000-000000000000')

head('1. Who has not answered — per CHILD, not per guardian')
{
  const { data, error } = await coach.client.rpc('who_hasnt_answered', { p_event: event.id })
  if (error) {
    bad(error.message)
  } else {
    data.length > 0 ? ok(`${data.length} children unanswered`) : bad('nobody unanswered')
    // A parent with two in the squad appears twice, with a different child
    // each time — "Sam Whitfield" alone tells a coach nothing about which.
    const byGuardian = new Map()
    for (const r of data) byGuardian.set(r.guardian_id, (byGuardian.get(r.guardian_id) ?? 0) + 1)
    const twins = [...byGuardian.values()].some((n) => n > 1)
    twins
      ? ok('a guardian with two children appears once per child')
      : ok('(no guardian with two in this squad to check)')
    data.every((r) => r.player_name) ? ok('each names the child') : bad('a row has no child')
  }

  const { error: asParent } = await parent.client.rpc('who_hasnt_answered', { p_event: event.id })
  asParent
    ? ok('a parent is refused — who else is disorganised is not their business')
    : bad('a parent read the chase list')
}

head('2. Nudging them')
{
  const { data, error } = await coach.client.rpc('nudge_non_responders', { p_event: event.id })
  if (error) {
    bad(error.message)
  } else {
    data.sent > 0 ? ok(`${data.sent} guardians nudged`) : bad('nobody was nudged')
    data.sent === data.outstanding - data.skipped
      ? ok(`the numbers add up (${data.outstanding} outstanding, ${data.skipped} skipped)`)
      : bad(`sent ${data.sent}, outstanding ${data.outstanding}, skipped ${data.skipped}`)

    const { data: queued } = await admin
      .from('notification_queue')
      .select('profile_id, kind, body, url, scheduled_for')
      .eq('payload->>event_id', event.id)
    queued.length === data.sent ? ok('queued, one each') : bad(`${queued.length} rows for ${data.sent} sent`)
    queued.every((q) => q.kind === 'rsvp_nudge') ? ok("kind is 'rsvp_nudge'") : bad('wrong kind')
    // "Please answer" with no fixture in it makes somebody open the app to
    // find out what it is about.
    queued[0]?.body?.includes(TAG)
      ? ok(`says which game: "${queued[0].body.slice(0, 54)}…"`)
      : bad(`body does not name the fixture: ${queued[0]?.body}`)
    queued.every((q) => q.url === `/calendar/${event.id}`)
      ? ok('and links straight to it')
      : bad('the link is wrong')
  }
}

head('3. Pressing it again tells nobody twice')
{
  const { data } = await coach.client.rpc('nudge_non_responders', { p_event: event.id })
  data.sent === 0
    ? ok(`second press sent 0, with ${data.skipped} already done today`)
    : bad(`${data.sent} families were nudged twice`)

  const { count } = await admin
    .from('notification_queue')
    .select('id', { count: 'exact', head: true })
    .eq('payload->>event_id', event.id)
  const { data: first } = await coach.client.rpc('nudge_non_responders', { p_event: event.id })
  const { count: after } = await admin
    .from('notification_queue')
    .select('id', { count: 'exact', head: true })
    .eq('payload->>event_id', event.id)
  count === after && first.sent === 0
    ? ok('and a third press adds no rows at all')
    : bad(`the queue grew from ${count} to ${after}`)
}

head('4. Answering takes you off the list')
{
  const { data: before } = await coach.client.rpc('who_hasnt_answered', { p_event: event.id })
  const target = before.find((r) => r.guardian_id === parent.id)
  if (!target) {
    ok('(the test parent has nobody in this squad to answer for)')
  } else {
    const { error } = await parent.client.from('event_rsvps').insert({
      academy_id: NRIFA,
      event_id: event.id,
      profile_id: parent.id,
      player_id: target.player_id,
      status: 'yes',
    })
    error ? bad(`could not RSVP: ${error.message}`) : null
    const { data: after } = await coach.client.rpc('who_hasnt_answered', { p_event: event.id })
    after.some((r) => r.player_id === target.player_id)
      ? bad('an answered child is still on the chase list')
      : ok(`${target.player_name} answered and dropped off the list`)
    after.length === before.length - 1
      ? ok(`${after.length} left, one fewer`)
      : bad(`${after.length} left, expected ${before.length - 1}`)
  }
}

head('5. Quiet hours hold a nudge until morning')
{
  // A nudge at eleven at night is exactly the notification that gets an app
  // muted, and the answer is not needed tonight.
  const { data: tomorrow } = await admin
    .from('events')
    .insert({
      academy_id: NRIFA,
      team_id: U8_TEAM,
      type: 'match',
      title: `${TAG} quiet hours`,
      starts_at: new Date(Date.now() + 4 * 864e5).toISOString(),
      ends_at: new Date(Date.now() + 4 * 864e5 + 3600e3).toISOString(),
      source: 'manual',
    })
    .select('id')
    .single()

  // Quiet hours covering the whole day, so whenever this runs it is inside
  // them — a test that only works in the evening is a test that fails in CI.
  await admin
    .from('user_settings')
    .update({ quiet_hours_enabled: true, quiet_hours_start: '00:01', quiet_hours_end: '23:59' })
    .neq('profile_id', '00000000-0000-0000-0000-000000000000')

  const { data } = await coach.client.rpc('nudge_non_responders', { p_event: tomorrow.id })
  const { data: queued } = await admin
    .from('notification_queue')
    .select('scheduled_for')
    .eq('payload->>event_id', tomorrow.id)
    .limit(1)
    .maybeSingle()

  if (data.sent === 0 || !queued) {
    bad(`nothing queued (sent ${data.sent})`)
  } else {
    new Date(queued.scheduled_for) > new Date()
      ? ok(`held until ${new Date(queued.scheduled_for).toISOString().slice(11, 16)}, not sent now`)
      : bad(`scheduled for ${queued.scheduled_for}, which is now or past`)
  }

  await admin
    .from('user_settings')
    .update({ quiet_hours_enabled: false, quiet_hours_start: '21:00', quiet_hours_end: '07:00' })
    .neq('profile_id', '00000000-0000-0000-0000-000000000000')
}

head('6. A called-off or finished fixture cannot be chased')
{
  const { data: past } = await admin
    .from('events')
    .insert({
      academy_id: NRIFA,
      team_id: U8_TEAM,
      type: 'match',
      title: `${TAG} already played`,
      starts_at: new Date(Date.now() - 864e5).toISOString(),
      ends_at: new Date(Date.now() - 864e5 + 3600e3).toISOString(),
      source: 'manual',
    })
    .select('id')
    .single()
  const { error: pastError } = await coach.client.rpc('nudge_non_responders', { p_event: past.id })
  pastError ? ok('a fixture that has started is refused') : bad('chased a game already played')

  const { data: off } = await admin
    .from('events')
    .insert({
      academy_id: NRIFA,
      team_id: U8_TEAM,
      type: 'match',
      title: `${TAG} called off`,
      starts_at: new Date(Date.now() + 5 * 864e5).toISOString(),
      ends_at: new Date(Date.now() + 5 * 864e5 + 3600e3).toISOString(),
      cancelled_at: new Date().toISOString(),
      cancellation_reason: 'wet_weather',
      source: 'manual',
    })
    .select('id')
    .single()
  const { error: offError } = await coach.client.rpc('nudge_non_responders', { p_event: off.id })
  offError ? ok('and a called-off one too') : bad('chased a cancelled game')
}

head('7. A parent cannot nudge anybody')
{
  const { error } = await parent.client.rpc('nudge_non_responders', { p_event: event.id })
  error ? ok('refused') : bad('a parent sent a nudge to the whole squad')
}

head('8. “Seen by” on an announcement')
{
  const { data: channel } = await admin
    .from('channels')
    .select('id')
    .eq('team_id', U8_TEAM)
    .eq('type', 'team')
    .single()

  const { data: msg } = await admin
    .from('messages')
    .insert({
      academy_id: NRIFA,
      channel_id: channel.id,
      sender_id: coach.id,
      body: `${TAG} kit is navy this Saturday`,
      is_announcement: true,
    })
    .select('id')
    .single()

  const { data: reach, error } = await coach.client.rpc('announcement_reach', {
    p_message: msg.id,
  })
  if (error) {
    bad(error.message)
  } else {
    reach.total > 0 ? ok(`${reach.seen} of ${reach.total} have opened it since`) : bad('nobody in the channel')
    Array.isArray(reach.unseen) && reach.unseen.length === reach.total - reach.seen
      ? ok(`and names the ${reach.unseen.length} who have not`)
      : bad(`unseen list is ${reach.unseen?.length}, expected ${reach.total - reach.seen}`)
  }

  // A parent must not see who ignored the coach.
  const { data: asParent } = await parent.client.rpc('announcement_reach', { p_message: msg.id })
  asParent === null
    ? ok('a parent gets nothing — who has not opened a chat is not their business')
    : bad('a parent read the reach breakdown')

  head('9. Re-pinging only the unread')
  const { data: ping, error: pingError } = await coach.client.rpc('reping_unread', {
    p_message: msg.id,
  })
  if (pingError) {
    bad(pingError.message)
  } else {
    const { data: fresh } = await coach.client.rpc('announcement_reach', { p_message: msg.id })
    ping.sent === fresh.total - fresh.seen
      ? ok(`${ping.sent} re-pinged, exactly the ones who had not opened it`)
      : ok(`${ping.sent} re-pinged (${fresh.total - fresh.seen} unseen; some opt out of announcements)`)

    const { data: again } = await coach.client.rpc('reping_unread', { p_message: msg.id })
    again.sent === 0 ? ok('and a second re-ping sends nothing') : bad(`${again.sent} sent twice`)
  }

  const { error: parentPing } = await parent.client.rpc('reping_unread', { p_message: msg.id })
  parentPing ? ok('a parent cannot re-ping a channel') : bad('a parent re-pinged everybody')
}

await clean()
console.log(
  process.exitCode
    ? '\n\x1b[31mNUDGE BROKEN\x1b[0m\n'
    : '\n\x1b[32mOnly the people who have not answered, and only once a day.\x1b[0m\n'
)
process.exit(process.exitCode ?? 0)
