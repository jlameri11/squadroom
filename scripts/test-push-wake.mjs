import { createClient } from '@supabase/supabase-js'
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}})
const ok=m=>console.log(`  \x1b[32m✓\x1b[0m ${m}`), bad=m=>{console.log(`  \x1b[31m✗\x1b[0m ${m}`);process.exitCode=1}
const head=m=>console.log(`\n${m}`)
const NRIFA='00000000-0000-0000-0000-0000000a0001'
const sleep=ms=>new Promise(r=>setTimeout(r,ms))

const { data: who } = await admin.from('profiles').select('id').limit(1).single()

async function enqueue(key, scheduledFor) {
  await admin.from('notification_queue').delete().eq('dedupe_key', key)
  const { data, error } = await admin.from('notification_queue').insert({
    academy_id: NRIFA, profile_id: who.id, kind: 'announcement',
    title: 'wake probe', body: 'probe', url: '/', scheduled_for: scheduledFor,
    dedupe_key: key,
  }).select('id').single()
  if (error) throw new Error(error.message)
  return data.id
}

// pg_net records every request it makes, which is the only way to see from
// here whether the database actually called out.
async function netCalls() {
  const { data } = await admin.rpc('recent_wake_calls')
  return data ?? []
}

const PROBE_ENDPOINT = 'https://probe.invalid/push-wake-test'

/**
 * A device to deliver to.
 *
 * Checks 2 and 5 were asserting something that could not happen: the project
 * has 0 registered devices, `claim_notifications` only claims a row that has
 * a live subscription behind it, and so `attempts` could never move. The test
 * read as "push-now did not drain" when the truth was "there was nothing to
 * drain to".
 *
 * The endpoint is deliberately unreachable. We are testing the CLAIM — that
 * the database hands a row over and counts the attempt — not Apple's or
 * Google's servers, which a test must never depend on.
 */
async function addProbeDevice() {
  await admin.from('push_subscriptions').delete().eq('endpoint', PROBE_ENDPOINT)
  const { data, error } = await admin.from('push_subscriptions').insert({
    profile_id: who.id, platform: 'web', endpoint: PROBE_ENDPOINT,
    p256dh: 'probe', auth: 'probe',
  }).select('id').single()
  if (error) throw new Error(`could not add a probe device: ${error.message}`)
  return data.id
}
const removeProbeDevice = () =>
  admin.from('push_subscriptions').delete().eq('endpoint', PROBE_ENDPOINT)

const device = await addProbeDevice()

// THE WAKE-UP IS DEBOUNCED TO ONE CALL PER 15 SECONDS, which is the whole
// point of it — an announcement to 300 parents must wake Netlify once. But it
// means this suite cannot assume the window is free: run inside a full
// `test:all` and another suite's notification has usually just spent it, so
// check 1 failed with "the trigger did not fire" and passed when run alone.
//
// Same family of mistake as the global-count rule in CLAUDE.md: the thing
// being measured is shared. Wait for the window, so the probe owns it.
await sleep(16000)

head('1. Something due now wakes Netlify')
const before = (await netCalls()).length
const id1 = await enqueue('wake-probe-now', new Date().toISOString())
await sleep(6000)
const after = await netCalls()
after.length > before
  ? ok(`the database called out: HTTP ${after[0].status_code}`)
  : bad('no outbound request — the trigger did not fire')

head('2. The row is claimed and attempted without any schedule running')
await sleep(4000)
const { data: probe } = await admin.from('notification_queue')
  .select('attempts, sent_at').eq('id', id1).single()
// attempts, not sent_at: the probe endpoint cannot receive anything, and a
// test that waited for a real delivery would depend on a push provider.
probe.attempts > 0
  ? ok(`attempts=${probe.attempts} — push-now drained it within seconds, not minutes`)
  : bad('the queue row was never claimed')

head('3. A reminder scheduled for tomorrow wakes nothing')
const quietBefore = (await netCalls()).length
await enqueue('wake-probe-later', new Date(Date.now() + 864e5).toISOString())
await sleep(6000)
const quietAfter = (await netCalls()).length
quietAfter === quietBefore
  ? ok('no outbound request for a notification that is not due yet')
  : bad(`woke ${quietAfter - quietBefore} times for a future reminder`)

head('4. A burst of notifications wakes it once, not once per row')
const burstBefore = (await netCalls()).length
const rows = Array.from({length: 40}, (_, i) => ({
  academy_id: NRIFA, profile_id: who.id, kind: 'announcement',
  title: 'burst', body: 'b', url: '/', scheduled_for: new Date().toISOString(),
  dedupe_key: `wake-burst-${i}`,
}))
await admin.from('notification_queue').delete().like('dedupe_key', 'wake-burst-%')
await admin.from('notification_queue').insert(rows)
await sleep(6000)
const burstAfter = (await netCalls()).length
burstAfter - burstBefore <= 1
  ? ok(`40 notifications in one statement → ${burstAfter - burstBefore} wake call`)
  : bad(`40 rows produced ${burstAfter - burstBefore} calls to Netlify`)

// 0131. Claiming used to be a data-modifying CTE inside a `language sql`
// function, which postgres is free to INLINE into the caller's query — and
// once inlined, how many times it runs is up to that plan. Measured on the
// same row: zero increments through PostgREST, two when wrapped in count(*).
// The retry cap is `attempts < 5`, so a counter that never moves is a cap
// that never engages and an undeliverable row is re-claimed for ever.
//
// This calls it THE WAY THE APP DOES — lib/push/drain.ts uses supabase.rpc —
// because a test that ran the SQL directly would have passed throughout.
head('5. Claiming through the RPC counts exactly one attempt (0131)')
const id5 = await enqueue('wake-probe-claim', new Date(Date.now() - 60000).toISOString())
const { data: firstClaim, error: claimErr } = await admin.rpc('claim_notifications', { p_limit: 200 })
if (claimErr) bad(`claim_notifications failed: ${claimErr.message}`)
const returnedOurs = (firstClaim ?? []).filter(r => r.id === id5).length
const attemptsAfterOne = (await admin.from('notification_queue')
  .select('attempts').eq('id', id5).single()).data?.attempts
returnedOurs === 1
  ? ok('the row is handed over once, with its device')
  : bad(`expected our row back once, got it ${returnedOurs} times`)
attemptsAfterOne === 1
  ? ok('attempts=1 after one call — not 0, and not 2')
  : bad(`attempts=${attemptsAfterOne} after a single RPC, expected exactly 1`)

await admin.rpc('claim_notifications', { p_limit: 200 })
const attemptsAfterTwo = (await admin.from('notification_queue')
  .select('attempts').eq('id', id5).single()).data?.attempts
attemptsAfterTwo === 2
  ? ok('a second call makes it 2, so the attempts < 5 cap can engage')
  : bad(`attempts=${attemptsAfterTwo} after two RPCs, expected 2`)

head('6. A notification for somebody with no device is left alone')
// Unchanged by 0131 and asserted so it stays a decision rather than a
// side effect: without this, the now-working cap would quietly abandon the
// row after five sweeps, which is a choice about dropping somebody's
// notification. Open question in NIGHT_LOG.
await removeProbeDevice()
const id6 = await enqueue('wake-probe-nodevice', new Date(Date.now() - 60000).toISOString())
await admin.rpc('claim_notifications', { p_limit: 200 })
const noDevice = (await admin.from('notification_queue')
  .select('attempts').eq('id', id6).single()).data?.attempts
noDevice === 0
  ? ok('not claimed, so it does not burn an attempt it could never use')
  : bad(`attempts=${noDevice} for a profile with no registered device`)

await admin.from('notification_queue').delete().like('dedupe_key', 'wake-%')
await removeProbeDevice()
void device
console.log('\ncleaned up\n')
