// Run: node --experimental-strip-types scripts/test-request-sharing.ts
//   (also picked up by scripts/test-all.mjs)
//
// The two helpers the screen timings led to (6 Nov 2026), with no browser
// and no database:
//   lib/batch.ts  — asks made in the same moment go as one request, each
//                   gets its own answer back, and a failure costs nothing;
//   lib/early.ts  — whoever asks first starts the request, whoever asks
//                   next joins it, and an old answer is not reused.
import { batched } from '../lib/batch.ts'
import { startEarly, takeEarly } from '../lib/early.ts'

const ok = (m: string) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m: string) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`)
  process.exitCode = 1
}
const head = (m: string) => console.log(`\n${m}`)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

head('1. Fifty bubbles, one request')
{
  const calls: string[][] = []
  const counts = batched<string, number>(async (ids) => {
    calls.push(ids)
    return new Map(ids.map((id) => [id, Number(id.slice(1))]))
  })
  const ids = Array.from({ length: 50 }, (_, i) => `m${i}`)
  const got = await Promise.all(ids.map((id) => counts(id)))
  calls.length === 1 ? ok('50 asks in the same moment → 1 request') : bad(`${calls.length} requests`)
  got.every((v, i) => v === i) ? ok('and each ask got its own answer back') : bad(`answers: ${got.slice(0, 5)}`)
}

head('2. The same thing asked twice is asked for once')
{
  const calls: string[][] = []
  const counts = batched<string, number>(async (ids) => {
    calls.push(ids)
    return new Map(ids.map((id) => [id, 1]))
  })
  await Promise.all([counts('a'), counts('a'), counts('b')])
  JSON.stringify(calls) === JSON.stringify([['a', 'b']]) ? ok('keys deduplicated in the request') : bad(JSON.stringify(calls))
}

head('3. Never more than the cap in one request')
{
  const sizes: number[] = []
  const counts = batched<number, number>(async (ids) => {
    sizes.push(ids.length)
    return new Map(ids.map((id) => [id, id]))
  }, { max: 100 })
  await Promise.all(Array.from({ length: 250 }, (_, i) => counts(i)))
  JSON.stringify(sizes) === JSON.stringify([100, 100, 50]) ? ok('250 asks → 100, 100, 50') : bad(JSON.stringify(sizes))
}

head('4. A failed request answers "nothing", for everyone in it')
{
  const counts = batched<string, number>(async () => {
    throw new Error('offline')
  })
  const got = await Promise.all([counts('x'), counts('y')])
  got.every((v) => v === undefined) ? ok('both get undefined — the screen shows nothing, as a failed single request did') : bad(JSON.stringify(got))
}

head('5. Asks a moment apart are separate requests')
{
  const calls: string[][] = []
  const counts = batched<string, number>(async (ids) => {
    calls.push(ids)
    return new Map(ids.map((id) => [id, 1]))
  }, { wait: 5 })
  await counts('first')
  await sleep(20)
  await counts('second')
  calls.length === 2 ? ok('a later ask is not held back for an earlier batch') : bad(`${calls.length} requests`)
}

head('6. Whoever asks first starts it; the next joins (lib/early.ts)')
{
  let runs = 0
  const run = async () => {
    runs += 1
    await sleep(10)
    return 'answer'
  }
  // Home renders from cache: the section asks before Home starts it.
  const section = takeEarly('home_jobs:t1', run)
  startEarly('home_jobs:t1', run)
  const got = await section
  runs === 1 && got === 'answer' ? ok('the section asked first; Home\'s start joined it — one request') : bad(`${runs} requests`)

  // Home first, the section a moment later.
  runs = 0
  startEarly('home_jobs:t2', run)
  await sleep(2)
  const later = await takeEarly('home_jobs:t2', run)
  runs === 1 && later === 'answer' ? ok('Home started it; the section joined — one request') : bad(`${runs} requests`)

  runs = 0
  const a = await takeEarly('needs_you:org-a', run)
  const b = await takeEarly('needs_you:org-b', run)
  runs === 2 && a === b ? ok('a different organisation is a different request') : bad(`${runs} requests`)
}

console.log(process.exitCode ? '\n\x1b[31msome of this is wrong\x1b[0m' : '\n\x1b[32mall good\x1b[0m')
