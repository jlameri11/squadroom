// Run: node --experimental-strip-types scripts/test-outbox.ts
//   (also picked up by scripts/test-all.mjs)
//
// Proves lib/offline/outbox.ts — X-09's queue for writes made with no signal.
//
// No database and no browser: the storage is an interface and this test gives
// it an in-memory one. That is the point of the split. What is decided in
// that file and nowhere else:
//
//   · a failed write is KEPT, because a tap that silently does nothing at a
//     ground is what loses a club's trust in the whole app
//   · the queue STOPS at the first network failure, or five writes burn
//     their attempts while the person is still in the car park
//   · order is preserved, because two taps on one child are two writes and
//     replaying them backwards leaves the first answer standing
//   · a refusal is not a failure, or the queue never drains
//   · a queued write belongs to the person who made it
import {
  classify,
  drain,
  enqueue,
  pending,
  MAX_ATTEMPTS,
  type Queued,
  type SendResult,
  type Store,
  type Write,
} from '../lib/offline/outbox.ts'

const ok = (m: string) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m: string) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`)
  process.exitCode = 1
}
const head = (m: string) => console.log(`\n${m}`)
const eq = (got: unknown, want: unknown, label: string) =>
  got === want ? ok(`${label} → ${got}`) : bad(`${label} → got ${got}, wanted ${want}`)

/** The in-memory store the pure logic is written against. */
function memory(): Store & { items: Map<string, Queued> } {
  const items = new Map<string, Queued>()
  return {
    items,
    async all() {
      return [...items.values()]
    },
    async put(item) {
      items.set(item.id, item)
    },
    async remove(id) {
      items.delete(id)
    },
  }
}

const ME = 'profile-me'
const THEM = 'profile-them'

const rsvp = (player: string, status: string): Write => ({
  kind: 'upsert',
  table: 'event_rsvps',
  rows: [{ player_id: player, status }],
  onConflict: 'event_id,profile_id,player_id',
})

const online = async (): Promise<SendResult> => ({ ok: true })
const offline = async (): Promise<SendResult> => ({
  ok: false,
  retry: true,
  error: 'Failed to fetch',
})
const refused = async (): Promise<SendResult> => ({
  ok: false,
  retry: false,
  error: 'new row violates row-level security policy',
})

head('1. A write with no signal is kept, not lost')
{
  const store = memory()
  await enqueue(store, ME, rsvp('leo', 'no'))
  eq(await pending(store, ME), 1, 'queued')

  const report = await drain(store, ME, offline)
  eq(report.sent, 0, 'nothing sent')
  eq(report.kept, 1, 'still queued')
  eq(await pending(store, ME), 1, 'and still there after the attempt')
}

head('2. And goes out when the signal comes back')
{
  const store = memory()
  await enqueue(store, ME, rsvp('leo', 'no'))
  await drain(store, ME, offline)
  const report = await drain(store, ME, online)
  eq(report.sent, 1, 'sent')
  eq(await pending(store, ME), 0, 'queue empty')
}

head('3. The queue stops at the first network failure')
{
  // Otherwise five writes each burn an attempt on the same dead connection
  // and reach the cap while the person is still standing in the car park.
  const store = memory()
  for (const name of ['leo', 'zoe', 'arjun', 'mila']) {
    await enqueue(store, ME, rsvp(name, 'yes'))
  }

  let tries = 0
  await drain(store, ME, async () => {
    tries += 1
    return { ok: false, retry: true, error: 'Failed to fetch' }
  })
  eq(tries, 1, 'one attempt for four queued writes')
  eq(await pending(store, ME), 4, 'all four kept')

  const attempts = (await store.all()).map((i) => i.attempts).sort()
  eq(JSON.stringify(attempts), JSON.stringify([0, 0, 0, 1]), 'and only one of them paid for it')
}

head('4. Order is preserved')
{
  // Two taps on the same child are two writes. Replaying them backwards
  // leaves the first answer standing, which is the worst possible outcome:
  // the parent sees what they chose and the coach sees what they un-chose.
  const store = memory()
  await enqueue(store, ME, rsvp('leo', 'no'))
  await new Promise((r) => setTimeout(r, 2))
  await enqueue(store, ME, rsvp('leo', 'yes'))

  const seen: string[] = []
  await drain(store, ME, async (w) => {
    seen.push((w as { rows: { status: string }[] }).rows[0].status)
    return { ok: true }
  })
  eq(JSON.stringify(seen), JSON.stringify(['no', 'yes']), 'replayed in the order they were tapped')
}

head('5. A refusal is not a failure')
{
  // A write the database refuses will be refused again forever. Keeping it
  // means a queue that never drains and a badge that never clears — so it is
  // dropped, and the rest of the queue still goes.
  const store = memory()
  await enqueue(store, ME, rsvp('not-my-child', 'yes'))
  await enqueue(store, ME, rsvp('leo', 'yes'))

  let n = 0
  const report = await drain(store, ME, async () => {
    n += 1
    return n === 1 ? await refused() : await online()
  })
  eq(report.dropped.length, 1, 'one dropped')
  eq(report.sent, 1, 'and the next one still went')
  eq(await pending(store, ME), 0, 'queue empty')
  report.dropped[0].error.includes('row-level security')
    ? ok('with the reason kept, so somebody can be told')
    : bad(`dropped with: ${report.dropped[0].error}`)
}

head(`6. Five failures and it is given up on`)
{
  const store = memory()
  await enqueue(store, ME, rsvp('leo', 'yes'))
  for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
    const r = await drain(store, ME, offline)
    if (r.kept !== 1) bad(`attempt ${i + 1} did not keep it`)
  }
  eq(await pending(store, ME), 1, `still queued after ${MAX_ATTEMPTS - 1} failures`)

  const last = await drain(store, ME, offline)
  eq(last.dropped.length, 1, 'dropped on the fifth')
  eq(await pending(store, ME), 0, 'and the queue does not fill up forever')
}

head('7. A queued write belongs to the person who made it')
{
  // A coach handing their phone to an assistant, or a shared club tablet.
  // Replaying one person's register as the other would give "who marked this
  // child present" the wrong answer.
  const store = memory()
  await enqueue(store, THEM, rsvp('leo', 'no'))
  await enqueue(store, ME, rsvp('zoe', 'yes'))

  const sent: Write[] = []
  const report = await drain(store, ME, async (w) => {
    sent.push(w)
    return { ok: true }
  })
  eq(report.sent, 1, "only this person's write went")
  eq((sent[0] as { rows: { player_id: string }[] }).rows[0].player_id, 'zoe', 'and it was theirs')

  // Left where it is, not thrown away: that person may sign back in here.
  eq(await pending(store, THEM), 1, "the other person's write is still queued")
}

head('8. Telling a network failure from a refusal')
{
  // The distinction is the whole behaviour of the queue, and supabase-js
  // reports both through the same shape.
  const cases: [unknown, boolean, string][] = [
    [{ name: 'TypeError', message: 'Failed to fetch' }, true, 'a fetch that never left the phone'],
    [{ message: 'network timeout' }, true, 'a timeout'],
    [{ code: '42501', message: 'permission denied' }, false, 'permission denied'],
    [{ code: '23505', message: 'duplicate key' }, false, 'a constraint'],
    [{ code: '22023', message: 'Say why they cannot play' }, false, 'a trigger saying no'],
    [{ code: '57014', message: 'statement timeout' }, true, 'the database being busy'],
    [{ code: '08006', message: 'connection failure' }, true, 'a dropped connection'],
    [{ status: 503, message: 'service unavailable' }, true, 'a 503'],
  ]
  for (const [error, retry, label] of cases) {
    const r = classify(error) as { ok: boolean; retry?: boolean }
    r.ok === false && r.retry === retry
      ? ok(`${label} → ${retry ? 'keep it' : 'drop it'}`)
      : bad(`${label} → ${JSON.stringify(r)}`)
  }
  // Anything unrecognised is kept, because keeping a write too long is
  // recoverable and dropping one is not.
  const odd = classify({ message: 'something nobody has seen before' }) as { retry?: boolean }
  odd.retry === true ? ok('and anything unfamiliar is kept, not dropped') : bad('unknown dropped')
}

head('9. Draining an empty queue does nothing at all')
{
  const store = memory()
  let called = 0
  const report = await drain(store, ME, async () => {
    called += 1
    return { ok: true }
  })
  eq(called, 0, 'no requests made')
  eq(report.sent + report.kept + report.dropped.length, 0, 'nothing reported')
}

console.log(
  process.exitCode ? '\n\x1b[31msome of this is wrong\x1b[0m' : '\n\x1b[32mall good\x1b[0m'
)
