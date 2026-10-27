// Run: node --env-file=.env.local scripts/test-reporting.mjs
//
// Proves 0108 (S-02): reporting a message.
//
// The assertions that carry the weight are about who CANNOT read a report:
//
//   · Not the sender. A mechanism the person complained about can read is
//     not a mechanism, and the sender is the single most likely coach to go
//     looking.
//   · Not other coaches. A coach may be the subject, and "staff can see
//     staff things" is exactly the reasoning that breaks this.
//   · Not another parent. A report names who made it.
//
// And one about the record: a closed report must carry a sentence saying what
// was done, because "dismissed" on its own is the state a club cannot defend
// a year later.
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
const TAG = 'TESTREPORT'

async function sess(email) {
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
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

const owner = await sess('joeylameri@outlook.com')
const coach = await sess('p61400000002@squadroom.invalid') // Marcus, coach only
const sam = await sess('p61400000011@squadroom.invalid')
const other = await sess('p61400000012@squadroom.invalid')

const { data: channel } = await admin
  .from('channels')
  .select('id, name')
  .eq('team_id', U8_TEAM)
  .eq('type', 'team')
  .single()

async function clean() {
  const { data: msgs } = await admin
    .from('messages')
    .select('id')
    .like('body', `${TAG}%`)
  for (const m of msgs ?? []) await admin.from('message_reports').delete().eq('message_id', m.id)
  await admin.from('messages').delete().like('body', `${TAG}%`)
  await admin.from('safeguarding_officers').delete().eq('academy_id', NRIFA)
}
await clean()

// A message from the COACH, so the person reported is staff — which is the
// case the whole design is for.
const { data: message, error: msgError } = await admin
  .from('messages')
  .insert({
    academy_id: NRIFA,
    channel_id: channel.id,
    sender_id: coach.id,
    body: `${TAG} something a parent was unhappy about`,
  })
  .select('id')
  .single()
if (msgError) {
  bad(msgError.message)
  process.exit(1)
}

head('1. A parent reports it')
{
  const { data: id, error } = await sam.client.rpc('report_message', {
    p_message: message.id,
    p_reason: 'inappropriate',
    p_note: 'Said in front of the children',
  })
  error ? bad(error.message) : ok(`reported (${String(id).slice(0, 8)}…)`)

  // Reporting must not act. An officer decides.
  const { data: after } = await admin
    .from('messages')
    .select('deleted_at, status')
    .eq('id', message.id)
    .single()
  !after.deleted_at && after.status === 'published'
    ? ok('the message is untouched — a report is a request to look, not an action')
    : bad('reporting changed the message')
}

head('2. The person reported cannot see the report')
{
  // The single most important assertion in this file.
  const { data: seen } = await coach.client
    .from('message_reports')
    .select('id, reason, note, reported_by')
    .eq('message_id', message.id)
  seen?.length === 0
    ? ok('the sender sees nothing, even though they are a coach')
    : bad(`the person reported read the report: ${JSON.stringify(seen)}`)

  const { error: queueError } = await coach.client.rpc('safeguarding_queue', {})
  queueError
    ? ok('and the queue refuses them')
    : bad('a coach read the safeguarding queue')
}

head('3. Nor can another parent')
{
  const { data: seen } = await other.client
    .from('message_reports')
    .select('id')
    .eq('message_id', message.id)
  seen?.length === 0 ? ok('nothing') : bad(`another parent read ${seen.length} report(s)`)
}

head('4. The reporter can see their own, so they know it landed')
{
  const { data: mine } = await sam.client
    .from('message_reports')
    .select('id, status')
    .eq('message_id', message.id)
  mine?.length === 1 && mine[0].status === 'open'
    ? ok('their own report, still open')
    : bad(`the reporter sees ${mine?.length} of their own reports`)
}

head('5. The owner can read the queue even with no officer appointed')
{
  // A club that has appointed nobody must not be a club where reports go
  // unread.
  const { data: queue, error } = await owner.client.rpc('safeguarding_queue', {})
  if (error) {
    bad(error.message)
  } else {
    const mine = (queue ?? []).filter((r) => r.body?.startsWith(TAG) || r.deleted)
    mine.length > 0 ? ok(`${mine.length} open report(s)`) : bad('the owner sees no reports')
    const row = mine[0]
    row?.body?.includes(TAG)
      ? ok('with the message itself, so it can be judged without hunting for it')
      : bad('the report carries no message body')
    row?.sender_name && row?.reporter
      ? ok(`${row.reporter} reported ${row.sender_name} in ${row.channel_name}`)
      : bad('the report does not say who reported whom')
    row?.note === 'Said in front of the children'
      ? ok('and the reporter’s own words')
      : bad(`note is ${JSON.stringify(row?.note)}`)
  }
}

head('6. An appointed officer can read it; a coach still cannot')
{
  // The club's Child Safe Officer is often not a coach, which is the point of
  // a separate table rather than a role.
  const { error: appointError } = await owner.client.from('safeguarding_officers').insert({
    academy_id: NRIFA,
    profile_id: other.id,
    appointed_by: owner.id,
  })
  appointError ? bad(`could not appoint: ${appointError.message}`) : ok('a parent was appointed officer')

  const { data: queue, error } = await other.client.rpc('safeguarding_queue', {})
  error ? bad(`the officer was refused: ${error.message}`) : ok(`the officer reads ${queue.length} report(s)`)

  const { error: stillNo } = await coach.client.rpc('safeguarding_queue', {})
  stillNo ? ok('and the coach is still refused') : bad('appointing an officer opened it to coaches')

  // And a coach cannot appoint themselves.
  const { error: selfAppoint } = await coach.client.from('safeguarding_officers').insert({
    academy_id: NRIFA,
    profile_id: coach.id,
  })
  selfAppoint
    ? ok('a coach cannot appoint themselves')
    : bad('a coach appointed themselves the officer who reviews complaints about them')
}

head('7. Who the officers are is not a secret')
{
  // A parent should be able to find out who to escalate to — a Child Safe
  // Standard in itself.
  const { data: officers } = await sam.client
    .from('safeguarding_officers')
    .select('profile_id')
    .eq('academy_id', NRIFA)
  officers?.length === 1 ? ok('a parent can see who the officer is') : bad('officers are hidden from parents')
}

head('8. Closing a report needs a sentence')
{
  const { data: reports } = await admin
    .from('message_reports')
    .select('id')
    .eq('message_id', message.id)
  const id = reports[0].id

  const { error: noOutcome } = await other.client.rpc('review_report', {
    p_report: id,
    p_status: 'dismissed',
    p_outcome: '   ',
  })
  noOutcome
    ? ok('“dismissed” with no note is refused')
    : bad('a report was closed with no record of why')

  const { error: stillOpen } = await other.client.rpc('review_report', {
    p_report: id,
    p_status: 'open',
    p_outcome: 'nothing',
  })
  stillOpen ? ok('and “open” is not a way to close one') : bad('closed a report as open')

  const { error } = await other.client.rpc('review_report', {
    p_report: id,
    p_status: 'actioned',
    p_outcome: 'Spoke to the coach. Message deleted and an apology sent to the group.',
  })
  error ? bad(error.message) : ok('closed, with what was done')

  const { data: closed } = await admin
    .from('message_reports')
    .select('status, outcome, reviewed_by, reviewed_at')
    .eq('id', id)
    .single()
  closed.status === 'actioned' && closed.reviewed_by === other.id && closed.reviewed_at
    ? ok('stamped with who reviewed it and when')
    : bad(`not stamped: ${JSON.stringify(closed)}`)

  // And a parent cannot close their own report.
  const { error: parentClose } = await sam.client.rpc('review_report', {
    p_report: id,
    p_status: 'dismissed',
    p_outcome: 'Never mind',
  })
  parentClose ? ok('and the reporter cannot close it themselves') : bad('a parent closed their own report')
}

head('9. A report cannot be deleted, by anybody')
{
  const { data: reports } = await admin
    .from('message_reports')
    .select('id')
    .eq('message_id', message.id)
  for (const [who, client] of [
    ['the owner', owner.client],
    ['the officer', other.client],
    ['the reporter', sam.client],
  ]) {
    await client.from('message_reports').delete().eq('id', reports[0].id)
    const { count } = await admin
      .from('message_reports')
      .select('id', { count: 'exact', head: true })
      .eq('id', reports[0].id)
    count === 1 ? ok(`${who} cannot delete it`) : bad(`${who} deleted a report`)
  }
}

head('10. A reported message that is then deleted still shows')
{
  // The most interesting thing that can happen to a report.
  await admin
    .from('messages')
    .update({ deleted_at: new Date().toISOString(), deleted_by: owner.id })
    .eq('id', message.id)

  const { data: queue } = await owner.client.rpc('safeguarding_queue', { p_status: null })
  const row = (queue ?? []).find((r) => r.deleted)
  row
    ? ok('still in the queue, flagged as deleted')
    : bad('a deleted message vanished from the report queue')
  row && row.body === null
    ? ok('with the body withheld, as the tombstone withholds it elsewhere')
    : bad('a deleted message’s body is still readable in the queue')
}

head('11. You cannot report what you cannot see')
{
  const { data: ravens } = await admin
    .from('academy_members')
    .select('profile_id')
    .eq('academy_id', '00000000-0000-0000-0000-0000000a0002')
    .eq('status', 'active')
    .limit(1)
    .single()
  const { data: u } = await admin.auth.admin.getUserById(ravens.profile_id)
  const outsider = await sess(u.user.email)
  const { error } = await outsider.client.rpc('report_message', {
    p_message: message.id,
    p_reason: 'spam',
  })
  error
    ? ok('an outsider gets “no such message”, which reveals nothing')
    : bad("an outsider reported another academy's message")

  const { error: own } = await coach.client.rpc('report_message', {
    p_message: message.id,
    p_reason: 'spam',
  })
  own ? ok('and reporting your own message is refused') : bad('the sender reported themselves')
}

await clean()
console.log(
  process.exitCode
    ? '\n\x1b[31mREPORTING BROKEN\x1b[0m\n'
    : '\n\x1b[32mA report reaches an officer, and nobody else.\x1b[0m\n'
)
process.exit(process.exitCode ?? 0)
