// Sign a seed person in for a test, reusing the session across suites.
//
// Every suite used to mint a fresh magic link and verify it — two rate-limited
// auth calls per person per suite, seventy suites, three people each. The
// project's limit is per five minutes, so a full run tripped it a third of the
// way through and the rest "failed" for a reason that had nothing to do with
// the product.
//
// A session is good for an hour and can be refreshed for longer, so the first
// suite to sign somebody in writes the session to `.cache/test-sessions.json`
// and every later suite reuses it. The cache is gitignored, per person, and
// thrown away on any error — a stale refresh token falls back to a fresh
// sign-in rather than a failure.
//
//   import { signInClient, signInSession, signInBoth } from './_auth.mjs'
//   const parent = await signInClient(admin, email)   // a client, or null
//
// `admin` is the caller's own service-role client, so this file holds no key.
import { createClient } from '@supabase/supabase-js'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const DIR = '.cache'
const FILE = `${DIR}/test-sessions.json`

function readCache() {
  try {
    return JSON.parse(readFileSync(FILE, 'utf8'))
  } catch {
    return {}
  }
}
function writeCache(cache) {
  try {
    mkdirSync(DIR, { recursive: true })
    writeFileSync(FILE, JSON.stringify(cache))
  } catch {
    // A cache that cannot be written is a slower run, not a failed one.
  }
}

/** The client and its session, or null when the project will not sign anyone in. */
export async function signInBoth(admin, email) {
  const cache = readCache()
  const cached = cache[email]
  if (cached?.refresh_token) {
    const client = createClient(URL_, PUB, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data, error } = await client.auth.setSession({ access_token: cached.access_token, refresh_token: cached.refresh_token })
    if (!error && data?.session) {
      // setSession refreshes when the access token has expired; keep the new pair.
      if (data.session.refresh_token !== cached.refresh_token) {
        cache[email] = pick(data.session)
        writeCache(cache)
      }
      return { client, session: data.session }
    }
    delete cache[email]
    writeCache(cache)
  }
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (!link?.properties?.hashed_token) return null
  const client = createClient(URL_, PUB, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data } = await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' })
  if (!data?.session) return null
  cache[email] = pick(data.session)
  writeCache(cache)
  return { client, session: data.session }
}

export async function signInClient(admin, email) {
  const r = await signInBoth(admin, email)
  return r ? r.client : null
}

export async function signInSession(admin, email) {
  const r = await signInBoth(admin, email)
  return r ? r.session : null
}

/** Sign in by profile id, looking the email up through the admin client. */
export async function signInAs(admin, profileId) {
  const { data } = await admin.auth.admin.getUserById(profileId)
  if (!data?.user?.email) return null
  return signInClient(admin, data.user.email)
}

function pick(s) {
  return { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at }
}
