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

// .ts as well as .mjs. test-import-parsing.ts has existed for months and
// this runner never looked at it — it only ran when somebody remembered
// `npm run test:parsing`, and nobody did. It was asserting that the opponent
// column is the away team, which a real Dribl export later disproved.
const suites = readdirSync('scripts')
  .filter(
    (f) =>
      f.startsWith('test-') && (f.endsWith('.mjs') || f.endsWith('.ts')) && f !== 'test-all.mjs'
  )
  .filter((f) => only.length === 0 || only.some((o) => f.includes(o)))
  .sort()

const green = (s) => `\x1b[32m${s}\x1b[0m`
const red = (s) => `\x1b[31m${s}\x1b[0m`
const dim = (s) => `\x1b[2m${s}\x1b[0m`

function run(file) {
  return new Promise((resolve) => {
    // TypeScript suites need the stripper; plain ones must not get the flag,
    // because it is still experimental and prints a warning that lands in the
    // captured output.
    const args = file.endsWith('.ts')
      ? ['--experimental-strip-types', '--no-warnings', `scripts/${file}`]
      : [`scripts/${file}`]
    const child = spawn(process.execPath, args, {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (out += d))
    child.on('close', (code) => resolve({ code, out }))
  })
}

// How many times a suite that hit the auth rate limit is tried again, and
// how long to wait first. The limit is per five minutes; `_auth.mjs` reuses
// sessions and `configure-auth-limits.mjs` raised the dev project's ceiling,
// so this should rarely fire — but when it does, waiting is right and
// reporting a failure is wrong.
const RETRIES = Number(process.env.TEST_RETRIES ?? 2)
const RETRY_WAIT_MS = Number(process.env.TEST_RETRY_WAIT_MS ?? 60_000)

const results = []
for (const file of suites) {
  const name = file.replace(/^test-|\.mjs$|\.ts$/g, '')
  let { code, out } = await run(file)
  for (let attempt = 1; attempt <= RETRIES && /auth rate limit|reading 'access_token'|reading 'hashed_token'/.test(out); attempt++) {
    console.log(dim(`  ${name.padEnd(22)} rate limited — waiting ${Math.round(RETRY_WAIT_MS / 1000)}s, retry ${attempt}/${RETRIES}`))
    await new Promise((r) => setTimeout(r, RETRY_WAIT_MS))
    const again = await run(file)
    code = again.code
    out = again.out
  }
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
  // Two spellings of the same thing: a suite that dies on the null session
  // (TypeError), and one that notices and exits gracefully. test-tenant-guards
  // does the latter and was being reported as "crashed" — which for a
  // cross-tenant SECURITY test is the worst possible thing to be wrong about,
  // because it reads as the guards being broken.
  //
  // Every suite now guards both halves of the sign-in and SAYS "auth rate
  // limit", so the phrase is the real signal and the TypeError spellings are
  // belt and braces for anything written later that forgets. Both halves
  // matter: generateLink is rate limited as well as verifyOtp, and when IT
  // trips the link comes back null — a crash on 'hashed_token' that used to
  // be reported as a product failure.
  const rateLimited =
    /auth rate limit/i.test(out) ||
    /reading 'access_token'/.test(out) ||
    /reading 'hashed_token'/.test(out)
  // test-join-flow drives real HTTP routes and needs the app running.
  const noServer = /ECONNREFUSED/.test(out)
  // test-stripe-e2e needs the Stripe CLI listener and a flag, says so, and
  // exits 2: by hand, not a crash.
  const byHand = code === 2 && /only runs by hand/i.test(out)

  let verdict
  if (rateLimited) verdict = 'auth rate limited'
  else if (byHand) verdict = 'by hand'
  else if (noServer) verdict = 'needs npm run dev'
  else if (crashed) verdict = 'crashed'
  else if (failed > 0) verdict = 'failed'
  else if (passed === 0) verdict = 'asserted nothing'
  else verdict = 'pass'

  results.push({ name, verdict, passed, failed, out })
  const tag =
    verdict === 'pass'
      ? green(`pass ${passed}`)
      : verdict === 'by hand'
        ? dim('by hand (STRIPE_E2E=1, listener up)')
        : red(`${verdict}${failed ? ' ' + failed : ''}`)
  console.log(`  ${name.padEnd(22)} ${tag}`)

  if (verdict !== 'pass' && verdict !== 'by hand') {
    const reason = out
      .split('\n')
      .filter((l) => l.includes('✗') || /Error|error:/.test(l))
      .slice(0, 3)
    for (const l of reason) console.log(dim('      ' + l.trim().slice(0, 150)))
  }

  await new Promise((r) => setTimeout(r, PAUSE_MS))
}

const bad = results.filter((r) => r.verdict !== 'pass' && r.verdict !== 'by hand')
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
