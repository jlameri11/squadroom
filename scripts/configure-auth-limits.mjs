// Run: node --env-file=.env.local scripts/configure-auth-limits.mjs [--show]
//
// Raise squadroom-dev's auth rate limits so the whole test suite can run at
// any hour.
//
// Every suite signs its people in with generateLink + verifyOtp. Supabase's
// defaults allow 30 token verifications and 30 OTP requests per five minutes
// — fine for a club, and about one third of a full `npm run test:all`, which
// is how 34 suites came to "fail" in one night (NIGHT_LOG, 29 Oct). The
// limits below are for the DEV project only: this script goes through
// `endpoint()`, so it cannot be aimed anywhere else, and production will be
// a different project with the defaults.
//
// `scripts/_auth.mjs` cuts the number of sign-ins as well; this is the
// backstop for a run that is still too much.
import { endpoint, confirmProject } from './_project.mjs'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (!token) {
  console.log('SUPABASE_ACCESS_TOKEN is not in .env.local')
  process.exit(1)
}
await confirmProject(token)
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

const WANT = {
  rate_limit_verify: 1000,
  rate_limit_otp: 1000,
  rate_limit_token_refresh: 1000,
  // The sign-up brief (12 Nov 2026): a password is at least 8. The routes
  // and screens hold the rule too; this stops a direct call to Supabase
  // setting a shorter one. Production's setting is Joey's (NEEDS JOEY).
  password_min_length: 8,
}

const current = await (await fetch(endpoint('config/auth'), { headers })).json()
const show = (c) => Object.keys(WANT).map((k) => `${k}=${c[k]}`).join('  ')
console.log('  now:    ' + show(current))
if (process.argv.includes('--show')) process.exit(0)

const response = await fetch(endpoint('config/auth'), { method: 'PATCH', headers, body: JSON.stringify(WANT) })
if (!response.ok) {
  console.log(`  failed: HTTP ${response.status} ${(await response.text()).slice(0, 300)}`)
  process.exit(1)
}
const after = await response.json()
console.log('  after:  ' + show(after))
