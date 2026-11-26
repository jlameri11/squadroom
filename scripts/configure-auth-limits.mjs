// Run: node --env-file=.env.local scripts/configure-auth-limits.mjs [--show|--strict]
//
// squadroom-dev's auth rate limits: raised for a full test run, strict the
// rest of the time.
//
// Every suite signs its people in with generateLink + verifyOtp. Supabase's
// defaults allow 30 token verifications and 30 OTP requests per five minutes
// — fine for a club, and about one third of a full `npm run test:all`, which
// is how 34 suites came to "fail" in one night (NIGHT_LOG, 29 Oct). So a full
// run raises the ceiling.
//
// The security pass (26 Nov 2026) found the raised numbers had been LEFT on,
// and that this project is also what the live site signs people in against:
// 1,000 password or code guesses per five minutes from one address. So:
//   (no flag)  raise, for a full run — `scripts/test-all.mjs` does this itself
//   --strict   Supabase's defaults — `test-all.mjs` puts them back when it ends,
//              however it ends; run this by hand if a run was killed outright
//   --show     print, change nothing
// This script goes through `endpoint()`, so it cannot be aimed anywhere else.
//
// `scripts/_auth.mjs` cuts the number of sign-ins as well.
import { endpoint, confirmProject } from './_project.mjs'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (!token) {
  console.log('SUPABASE_ACCESS_TOKEN is not in .env.local')
  process.exit(1)
}
await confirmProject(token)
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

const strict = process.argv.includes('--strict')
const WANT = {
  rate_limit_verify: strict ? 30 : 1000,
  rate_limit_otp: strict ? 30 : 1000,
  rate_limit_token_refresh: strict ? 150 : 1000,
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
