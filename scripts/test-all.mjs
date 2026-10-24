// Run: node --env-file=.env.local scripts/test-all.mjs
//
// Every suite, with a verdict that cannot be faked by a crash.
//
// Counting "✗" in the output is not enough: a script that throws before its
// first assertion prints no ✗ at all, and a shell loop grepping for one reads
// that as a pass. That is exactly how test-dms-and-approval was recorded as
// passing while it was dying on line 12.
//
// So a suite passes only if it exits 0 AND printed at least one ✓ AND printed
// no ✗. Anything else is reported with its last few lines.
//
// It also runs them one at a time with a pause. Each suite signs several
// people in through generateLink/verifyOtp, and Supabase rate-limits auth per
// project — running two dozen suites back to back exhausts it and the
// failures that follow are about the rate limit, not the product.
import { spawn } from 'node:child_process'
import { readdirSync } from 'node:fs'

const PAUSE_MS = Number(process.env.TEST_PAUSE_MS ?? 1500)
const only = process.argv.slice(2)

const suites = readdirSync('scripts')
  .filter((f) => f.startsWith('test-') && f.endsWith('.mjs') && f !== 'test-all.mjs')
  .filter((f) => only.length === 0 || only.some((o) => f.includes(o)))
  .sort()

const green = (s) => `\x1b[32m${s}\x1b[0m`
const red = (s) => `\x1b[31m${s}\x1b[0m`
const dim = (s) => `\x1b[2m${s}\x1b[0m`

function run(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [`scripts/${file}`], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (out += d))
    child.on('close', (code) => resolve({ code, out }))
  })
}

const results = []
for (const file of suites) {
  const name = file.replace(/^test-|\.mjs$/g, '')
  const { code, out } = await run(file)
  const passed = (out.match(/✓/g) ?? []).length
  const failed = (out.match(/✗/g) ?? []).length
  const crashed = code !== 0 && failed === 0

  // Two crashes that are not about the product, and that cost an hour each
  // time they are read as one.
  //
  // Every suite signs its people in with generateLink + verifyOtp, and
  // Supabase rate-limits that per project. Once the limit is hit verifyOtp
  // returns `{ session: null }` with no error, so the next line dies reading
  // access_token of null — in fifteen suites at once, which looks exactly
  // like the database falling over.
  const rateLimited = /reading 'access_token'/.test(out)
  // test-join-flow drives real HTTP routes and needs the app running.
  const noServer = /ECONNREFUSED/.test(out)

  let verdict
  if (rateLimited) verdict = 'auth rate limited'
  else if (noServer) verdict = 'needs npm run dev'
  else if (crashed) verdict = 'crashed'
  else if (failed > 0) verdict = 'failed'
  else if (passed === 0) verdict = 'asserted nothing'
  else verdict = 'pass'

  results.push({ name, verdict, passed, failed, out })
  const tag =
    verdict === 'pass'
      ? green(`pass ${passed}`)
      : red(`${verdict}${failed ? ' ' + failed : ''}`)
  console.log(`  ${name.padEnd(22)} ${tag}`)

  if (verdict !== 'pass') {
    const reason = out
      .split('\n')
      .filter((l) => l.includes('✗') || /Error|error:/.test(l))
      .slice(0, 3)
    for (const l of reason) console.log(dim('      ' + l.trim().slice(0, 150)))
  }

  await new Promise((r) => setTimeout(r, PAUSE_MS))
}

const bad = results.filter((r) => r.verdict !== 'pass')
const assertions = results.reduce((n, r) => n + r.passed, 0)
const limited = results.filter((r) => r.verdict === 'auth rate limited')

console.log(
  `\n  ${results.length} suites, ${assertions} assertions, ` +
    (bad.length ? red(`${bad.length} not passing`) : green('all passing'))
)

if (limited.length) {
  console.log(
    red(
      `\n  ${limited.length} suites could not sign anybody in. That is the project's\n` +
        '  auth rate limit, not a failure — wait an hour and run them again.\n' +
        '  Running the whole suite repeatedly is what exhausts it.'
    )
  )
}
console.log('')
process.exit(bad.length ? 1 : 0)
