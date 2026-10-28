// Run: node --env-file=.env.local scripts/check-realtime.mjs
//
// Which tables actually broadcast changes, and why not.
//
// test-chat step 8 fails with "nothing arrived within 8s", which is accurate
// and tells you nothing about the cause. There are three, and they need
// different fixes:
//
//   1. The table is not in the `supabase_realtime` publication. Nothing is
//      sent to anyone. The fix is DDL.
//   2. The table is published, but RLS does not let the SUBSCRIBER read the
//      row. Realtime re-evaluates policies per subscriber, so a row can
//      insert fine and still reach nobody. The fix is a policy.
//   3. The socket never connected at all — wrong key, blocked WebSocket.
//
// This separates them by subscribing twice: once with the service role, which
// bypasses RLS entirely, and once as an ordinary member. Service role silent
// means (1) or (3); service role hears it and the member does not means (2).
//
// Worth keeping. CLAUDE.md notes that postgres_changes does not scale and has
// to be swapped for broadcast-from-trigger before roughly the twentieth
// academy, and this is how you tell whether that swap worked.
import { createClient } from '@supabase/supabase-js'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const WAIT = 7000
// --trials N measures how OFTEN delivery works, not just whether it can.
// test-chat's realtime step fails about one run in three, and an
// intermittent realtime is a different problem from a broken one.
const TRIALS = Number(process.argv.find((a) => a.startsWith('--trials='))?.split('=')[1] ?? 0)
const green = (s) => `\x1b[32m${s}\x1b[0m`
const red = (s) => `\x1b[31m${s}\x1b[0m`

// A channel with a member in it, so the RLS half of the test has somebody to
// be. Any channel will do.
const { data: channel } = await admin
  .from('channels')
  .select('id, academy_id')
  .eq('type', 'team')
  .limit(1)
  .single()

const { data: member } = await admin
  .from('channel_members')
  .select('profile_id')
  .eq('channel_id', channel.id)
  .limit(1)
  .single()

const { data: profile } = await admin
  .from('profiles')
  .select('id, full_name')
  .eq('id', member.profile_id)
  .single()

// profiles has no email column — the address lives in auth.users, which only
// the admin API reaches.
const { data: authUser } = await admin.auth.admin.getUserById(member.profile_id)
const email = authUser?.user?.email

/**
 * The broadcast path (0088), as a real channel member.
 *
 * Measured next to postgres_changes rather than instead of it, because the
 * only reason to add a second transport is that it is more reliable than the
 * first — and that is a number, not an opinion.
 */
async function listenBroadcast(client, label, cause) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('silent'), WAIT)
    const sub = client
      .channel(`channel:${channel.id}`, { config: { private: true } })
      .on('broadcast', { event: 'new_message' }, () => {
        clearTimeout(timer)
        resolve('delivered')
      })
      .subscribe(async (status, err) => {
        if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
          clearTimeout(timer)
          return resolve(`${status.toLowerCase()}${err ? ': ' + err.message : ''}`)
        }
        if (status !== 'SUBSCRIBED') return
        const problem = await cause()
        if (problem) {
          clearTimeout(timer)
          resolve(`could not cause a change: ${problem}`)
        }
      })
    setTimeout(() => {
      sub.unsubscribe()
      client.removeChannel(sub)
    }, WAIT + 1000)
  })
}

/**
 * Subscribe, cause a change, and report what arrived.
 *
 * The insert happens inside the SUBSCRIBED callback deliberately. Firing it
 * before the socket is ready is the single most common way to write a realtime
 * test that fails for a reason that has nothing to do with realtime.
 */
async function listen(client, label, cause, filter) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('silent'), WAIT)
    const on = { event: 'INSERT', schema: 'public', table: 'messages' }
    // The app's own hook subscribes WITH a channel_id filter
    // (lib/hooks/use-channel-messages.ts), so an unfiltered check can pass
    // while every real user's subscription is the flaky one.
    if (filter) on.filter = `channel_id=eq.${channel.id}`
    const sub = client
      .channel(`check:${label}:${Date.now()}`)
      .on('postgres_changes', on, () => {
        clearTimeout(timer)
        resolve('delivered')
      })
      .subscribe(async (status, err) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          clearTimeout(timer)
          return resolve(`${status.toLowerCase()}${err ? ': ' + err.message : ''}`)
        }
        if (status !== 'SUBSCRIBED') return
        const problem = await cause()
        if (problem) {
          clearTimeout(timer)
          resolve(`could not cause a change: ${problem}`)
        }
      })
    setTimeout(() => sub.unsubscribe(), WAIT + 1000)
  })
}

const send = async () => {
  const { error } = await admin.from('messages').insert({
    academy_id: channel.academy_id,
    channel_id: channel.id,
    sender_id: member.profile_id,
    body: 'REALTIMECHECK::ping',
  })
  return error?.message
}

console.log('\nChecking postgres_changes on public.messages (the OLD path — see X-18)\n')

const asService = await listen(admin, 'service', send, false)
console.log(`  service role (no RLS)  ${asService === 'delivered' ? green('delivered') : red(asService)}`)

// The same listen, as a real person who is in the channel.
let asMember = 'skipped'
let memberClient = null
if (!email) {
  console.log(red(`  ${profile.full_name} has no email address — cannot test as them`))
  process.exit(1)
}
const { data: link } = await admin.auth.admin.generateLink({
  type: 'magiclink',
  email,
})
const anon = createClient(URL_, PUB, { auth: { persistSession: false } })
// generateLink is rate limited per project as well as verifyOtp, and
// returns null when it trips — so this property read throws before any
// session check runs, and the runner reports a crash that is really the
// auth budget.
if (!link?.properties?.hashed_token) {
  console.log("  could not issue a magic link — the project's auth rate limit, not a failure")
  process.exit(2)
}
const { data: session, error: otpError } = await anon.auth.verifyOtp({
  token_hash: link.properties.hashed_token,
  type: 'email',
})
if (otpError) {
  asMember = `could not sign in: ${otpError.message}`
} else {
  const asPerson = createClient(URL_, PUB, { auth: { persistSession: false } })
  memberClient = asPerson
  // Realtime authorises the SOCKET, which reads the access token from the
  // auth state rather than from a header — setting an Authorization header
  // would be invisible to it.
  await asPerson.realtime.setAuth(session.session.access_token)
  asMember = await listen(asPerson, 'member', send, false)
}
console.log(
  `  ${(profile.full_name ?? 'a member').padEnd(22)} ${asMember === 'delivered' ? green('delivered') : red(asMember)}`
)

await admin.from('messages').delete().like('body', 'REALTIMECHECK::%')

// --trials: the same subscription, over and over, filtered and not.
if (TRIALS > 0) {
  console.log(`\n  Measuring over ${TRIALS} trials each\n`)

  // As a real member, not the service role: that is who the app is, and
  // broadcast authorisation goes through a policy on realtime.messages.
  const member = asMember === 'delivered' ? memberClient : admin

  const runs = [
    ['postgres_changes, no filter', (i) => listen(admin, `t${i}`, send, false)],
    ['postgres_changes, filtered', (i) => listen(admin, `t${i}`, send, true)],
    ['broadcast (0088)', (i) => listenBroadcast(member, `b${i}`, send)],
  ]

  for (const [label, run] of runs) {
    let delivered = 0
    const failures = []
    for (let i = 0; i < TRIALS; i++) {
      const got = await run(i)
      if (got === 'delivered') delivered++
      else failures.push(got)
      await admin.from('messages').delete().like('body', 'REALTIMECHECK::%')
    }
    const rate = Math.round((delivered / TRIALS) * 100)
    console.log(
      `  ${label.padEnd(30)} ${delivered}/${TRIALS} delivered (${rate}%)` +
        (failures.length ? `  ${dimmed([...new Set(failures)].join(', '))}` : '')
    )
  }
  console.log('')
  process.exit(0)
}

console.log('\n' + verdict(asService, asMember) + '\n')
process.exit(asService === 'delivered' && asMember === 'delivered' ? 0 : 1)

function dimmed(s) {
  return `\x1b[2m${s}\x1b[0m`
}

function verdict(service, person) {
  if (service === 'delivered' && person === 'delivered') {
    return green('Realtime works for both.')
  }
  if (service !== 'delivered' && person !== 'delivered') {
    return red(
      'Nobody received anything. public.messages is almost certainly not in the\n' +
        'supabase_realtime publication. Fix with DDL:\n\n' +
        '  alter publication supabase_realtime add table public.messages;\n\n' +
        'Then run this again. If it still fails, the WebSocket is not connecting\n' +
        'at all — check the publishable key and that wss:// is not blocked.'
    )
  }
  if (service === 'delivered') {
    return red(
      'Published, but RLS stops the subscriber seeing it. Realtime re-evaluates\n' +
        'policies per subscriber, so the insert succeeds and reaches nobody. Check\n' +
        'the select policy on public.messages for a channel member.'
    )
  }
  return red('The member heard it and the service role did not, which should be impossible.')
}
