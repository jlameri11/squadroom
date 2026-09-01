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

await admin.from('notification_queue').delete().like('dedupe_key', 'wake-%')
console.log('\ncleaned up\n')
