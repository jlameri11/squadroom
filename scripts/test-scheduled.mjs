// Run: node --env-file=.env.local scripts/test-scheduled.mjs
//
// C-04: "send Thursday 7pm". A scheduled message is the sender's alone
// until it goes; nobody else reads it, no push fires, the channel list
// does not count it. When its time comes the publisher sends it like any
// other message — pushes, mentions, mutes — with its send time as its
// time. Cancel or move it before then. Same posting rules as a message
// sent now.
import { createClient } from '@supabase/supabase-js'
import { signInClient } from './_auth.mjs'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`)
  process.exitCode = 1
}
const head = (m) => console.log(`\n${m}`)

const MARCUS = '00000000-0000-0000-0000-0000000000a2'
const PARENT = '00000000-0000-0000-0000-0000000000b1'
const OUTSIDER = '00000000-0000-0000-0000-0000000000c2'
const U8 = '00000000-0000-0000-0000-0000000d0008'
const TAG = 'SCHED'

// Sessions are cached across suites (scripts/_auth.mjs), so a full run no
// longer trips the auth rate limit.
const signInEmail = (email) => signInClient(admin, email)
const { data: ch } = await admin.from('channels').select('id, name, posting_mode').eq('team_id', U8).eq('status', 'active').limit(1).single()
async function cleanup() {
  const { data: msgs } = await admin.from('messages').select('id').like('body', `${TAG}%`)
  for (const m of msgs ?? []) await admin.from('notification_queue').delete().filter('payload->>message_id', 'eq', m.id)
  await admin.from('messages').delete().like('body', `${TAG}%`)
}
await cleanup()

const marcus = await signInEmail((await admin.auth.admin.getUserById(MARCUS)).data.user.email)
const parent = await signInEmail((await admin.auth.admin.getUserById(PARENT)).data.user.email)
const outsider = await signInEmail((await admin.auth.admin.getUserById(OUTSIDER)).data.user.email)
if (!marcus || !parent || !outsider) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}
const later = new Date(Date.now() + 2 * 3600_000).toISOString()

head('1. Scheduling, and who sees it')
let id
{
  const { error: past } = await marcus.rpc('schedule_message', { p_channel: ch.id, p_body: `${TAG} too late`, p_at: new Date(Date.now() - 60_000).toISOString() })
  past ? ok('a time in the past is refused') : bad('scheduled into the past')
  const { error: stranger } = await outsider.rpc('schedule_message', { p_channel: ch.id, p_body: `${TAG} hi`, p_at: later })
  stranger?.code === '42501' ? ok('an outsider cannot schedule into the channel') : bad('an outsider scheduled a message')
  const { error: notHost } = await parent.rpc('schedule_message', { p_channel: ch.id, p_body: `${TAG} parent announce`, p_at: later, p_announcement: true })
  notHost ? ok('a parent cannot schedule an announcement') : bad('a parent scheduled an announcement')
  const { data, error } = await marcus.rpc('schedule_message', { p_channel: ch.id, p_body: `${TAG} Reminder: boots and shin pads tomorrow`, p_at: later, p_announcement: true })
  error ? bad(`schedule: ${error.message}`) : ok('the coach schedules an announcement for two hours from now')
  id = data
  const { data: mine } = await marcus.rpc('my_scheduled_messages', { p_channel: ch.id })
  mine?.some((m) => m.id === id) ? ok('it is in his scheduled strip') : bad(JSON.stringify(mine))
  const { data: theirs } = await parent.rpc('my_scheduled_messages', { p_channel: ch.id })
  !theirs?.some((m) => m.id === id) ? ok('not in a parent\'s') : bad('a parent saw someone else\'s scheduled message')
  const { data: feed } = await parent.rpc('channel_messages', { p_channel: ch.id, p_limit: 50 })
  !feed?.some((m) => m.id === id) ? ok('and not in the channel feed') : bad('a scheduled message is in the feed')
  const { data: row } = await parent.from('messages').select('id').eq('id', id)
  const rowRows = row ?? []
  rowRows.length === 0 ? ok('nor readable from the table by anyone else') : bad('a parent read a scheduled message')
  const { count } = await admin.from('notification_queue').select('id', { count: 'exact', head: true }).filter('payload->>message_id', 'eq', id)
  count === 0 ? ok('no push yet') : bad(`${count} pushes queued before send time`)
}

head('2. Move it, cancel it')
{
  const { error: notYours } = await parent.rpc('reschedule_message', { p_message: id, p_at: later })
  notYours?.code === '42501' ? ok('only the sender moves it') : bad('somebody else moved it')
  const soon = new Date(Date.now() + 3600_000).toISOString()
  const { error } = await marcus.rpc('reschedule_message', { p_message: id, p_at: soon, p_body: `${TAG} Reminder: boots, shin pads AND a drink bottle tomorrow` })
  error ? bad(`move: ${error.message}`) : ok('moved an hour earlier, with a better body')
  const { data: mine } = await marcus.rpc('my_scheduled_messages', { p_channel: ch.id })
  const m = mine.find((x) => x.id === id)
  m && new Date(m.scheduled_for).getTime() === new Date(soon).getTime() && /drink bottle/.test(m.body) ? ok('the strip shows the new time and text') : bad(JSON.stringify(m))
  const { data: id2 } = await marcus.rpc('schedule_message', { p_channel: ch.id, p_body: `${TAG} never mind`, p_at: later })
  const { error: ce } = await marcus.rpc('cancel_scheduled_message', { p_message: id2 })
  ce ? bad(`cancel: ${ce.message}`) : ok('a second one cancelled')
  const { data: gone } = await admin.from('messages').select('id').eq('id', id2)
  const goneRows = gone ?? []
  goneRows.length === 0 ? ok('and gone for good') : bad('a cancelled message remains')
}

head('3. When its time comes, it goes like any other message')
{
  await admin.from('messages').update({ scheduled_for: new Date(Date.now() - 30_000).toISOString() }).eq('id', id)
  const { data: n, error } = await admin.rpc('publish_scheduled_messages')
  error ? bad(`publish: ${error.message}`) : ok(`the publisher sent ${n}`)
  const { data: feed } = await parent.rpc('channel_messages', { p_channel: ch.id, p_limit: 50 })
  const sent = feed?.find((m) => m.id === id)
  sent && sent.is_announcement && Date.now() - new Date(sent.created_at).getTime() < 120_000 ? ok('a parent sees it in the feed, as an announcement, timed at the moment it went') : bad(JSON.stringify(sent))
  const { data: pushes } = await admin.from('notification_queue').select('kind').filter('payload->>message_id', 'eq', id)
  const pushRows = pushes ?? []
  pushRows.length > 0 && pushRows.every((p) => p.kind === 'announcement') ? ok(`${pushRows.length} announcement pushes queued at send time`) : bad(JSON.stringify(pushRows).slice(0, 120))
  const { data: mine } = await marcus.rpc('my_scheduled_messages', { p_channel: ch.id })
  !mine?.some((m) => m.id === id) ? ok('and it has left the strip') : bad('a sent message still shows as scheduled')
  const { error: late } = await marcus.rpc('cancel_scheduled_message', { p_message: id })
  late ? ok('a sent message cannot be cancelled as scheduled') : bad('cancelled a message that had gone')
}

await cleanup()
console.log(process.exitCode ? '\n\x1b[31mSCHEDULED MESSAGES ARE WRONG\x1b[0m\n' : '\n\x1b[32mall good\x1b[0m\n')
