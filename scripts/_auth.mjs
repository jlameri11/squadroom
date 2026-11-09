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
import { createHmac } from 'node:crypto'

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

/** Keep a session for an email, so later suites reuse it (an AAL2 one included). */
export function rememberSession(email, session) {
  const cache = readCache()
  cache[email] = pick(session)
  writeCache(cache)
}

/** RFC 6238, six digits, thirty seconds — what every authenticator app does. */
export function totp(secretBase32, at = Date.now()) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const c of secretBase32.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, '0')
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)))
  const h = createHmac('sha1', key).update(counter).digest()
  const o = h[h.length - 1] & 0xf
  const code = ((h[o] & 0x7f) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1_000_000
  return String(code).padStart(6, '0')
}

/**
 * Two-step sign-in, the way a new club's owner does it (0231): enrol an
 * authenticator factor on this client's account and verify it with a code
 * computed here, so the client's session is fully proven (AAL2). Returns
 * the secret, or null when a verified factor is already there (its secret
 * is not knowable). `email`, when given, keeps the proven session for later
 * suites. The client must hold a session of its own (signInBoth gives one).
 */
export async function enrolTwoStep(client, email = null) {
  const { data: factors } = await client.auth.mfa.listFactors()
  for (const f of factors?.all ?? []) if (f.factor_type === 'totp' && f.status !== 'verified') await client.auth.mfa.unenroll({ factorId: f.id })
  if ((factors?.totp ?? []).some((f) => f.status === 'verified')) return null
  const { data: en, error } = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'test' })
  if (error || !en) throw new Error(`could not enrol two-step: ${error?.message ?? 'no factor'}`)
  const { data: ch, error: chErr } = await client.auth.mfa.challenge({ factorId: en.id })
  if (chErr || !ch) throw new Error(`could not challenge two-step: ${chErr?.message ?? 'no challenge'}`)
  const { error: vErr } = await client.auth.mfa.verify({ factorId: en.id, challengeId: ch.id, code: totp(en.totp.secret) })
  if (vErr) throw new Error(`could not verify two-step: ${vErr.message}`)
  if (email) {
    const { data: s } = await client.auth.getSession()
    if (s?.session) rememberSession(email, s.session)
  }
  return en.totp.secret
}
