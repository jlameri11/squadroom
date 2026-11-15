// A local Supabase, just enough for the real app to open the simulated
// league (Joey, 15 Nov 2026: "open the real app in a browser … and check
// their screens show what the database says"). LOCAL ONLY.
//
// The app talks to one URL (NEXT_PUBLIC_SUPABASE_URL) for REST, auth, realtime
// and storage. Here that URL is a small proxy on :54330 that sends
//   /rest/v1/*   → PostgREST (:54331) on the local Postgres (:54329)
//   /auth/v1/*   → a stub that answers for the accounts the simulation minted
//   everything else (realtime, storage) → 404; the app degrades quietly.
// Sessions are HS256 JWTs signed with a secret only this machine knows;
// PostgREST verifies them and sets request.jwt.claims, exactly as Supabase
// does, so RLS and auth.uid() behave as in production.
//
// The app is built once for this stack:
//   node scripts/simulation/stack.mjs --keys   (prints the two keys)
//   DIST_DIR=.next-sim NEXT_PUBLIC_SUPABASE_URL=http://localhost:54330 \
//     NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<anon> SUPABASE_SERVICE_ROLE_KEY=<service> \
//     NEXT_PUBLIC_SITE_URL=http://localhost:3300 npx next build
//   … then `DIST_DIR=.next-sim npx next start -p 3300`.
import { createHmac } from 'node:crypto'
import { execSync, spawn } from 'node:child_process'
import http from 'node:http'
import { join } from 'node:path'
import pg from 'pg'

export const SECRET = 'squadroom-simulation-only-jwt-secret-not-for-any-real-project-0123456789'
export const PROXY_PORT = 54330
export const POSTGREST_PORT = 54331
export const AUTH_PORT = 54332
export const APP_URL = process.env.SIM_APP_URL ?? 'http://localhost:3300'
export const SUPABASE_URL = `http://localhost:${PROXY_PORT}`
const POSTGREST = process.env.POSTGREST_BIN ?? '/private/tmp/claude-501/-Users-j-lameri/207a9471-a303-4da2-81ca-06a26c42eadc/scratchpad/tools/postgrest/postgrest'
const LIBPQ = join(process.cwd(), 'node_modules/@embedded-postgres/darwin-arm64/native/lib')

const b64url = (s) => Buffer.from(s).toString('base64url')
/** An HS256 JWT the way GoTrue mints them. */
// Ten years: the browser's clock is moved to the season's moment (2027, then
// 2028), and supabase-js treats a session whose expiry that clock has passed
// as dead — 400 days ran out between the finals and Season 5.
export function mintJwt(claims, { hours = 24 * 3650 } = {}) {
  const now = Math.floor(Date.now() / 1000)
  const payload = { iss: `${SUPABASE_URL}/auth/v1`, iat: now, exp: now + hours * 3600, ...claims }
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify(payload))
  const sig = createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url')
  return `${head}.${body}.${sig}`
}
export function verifyJwt(token) {
  const [h, b, s] = String(token ?? '').split('.')
  if (!h || !b || !s) return null
  const sig = createHmac('sha256', SECRET).update(`${h}.${b}`).digest('base64url')
  if (sig !== s) return null
  try {
    const claims = JSON.parse(Buffer.from(b, 'base64url').toString())
    if (claims.exp && claims.exp < Date.now() / 1000) return null
    return claims
  } catch { return null }
}
export const anonKey = () => mintJwt({ role: 'anon', aud: 'anon' }, { hours: 24 * 3650 })
export const serviceKey = () => mintJwt({ role: 'service_role', aud: 'service_role' }, { hours: 24 * 3650 })

/** The user record GoTrue would return for an account. */
async function userRecord(db, sub) {
  const { rows } = await db.query(`select u.id, u.email, u.phone, u.created_at, u.updated_at, u.raw_user_meta_data, u.email_confirmed_at from auth.users u where u.id = $1`, [sub])
  const u = rows[0]
  if (!u) return null
  return {
    id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: u.email_confirmed_at, phone: u.phone ?? '',
    confirmed_at: u.email_confirmed_at, last_sign_in_at: new Date().toISOString(),
    app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: u.raw_user_meta_data ?? {},
    identities: [], created_at: u.created_at, updated_at: u.updated_at, is_anonymous: false,
  }
}

/** A browser session for a person: the JWT, the refresh token, and the user — what the cookie carries. */
export async function sessionFor(db, profileId, { aal = 'aal1' } = {}) {
  const user = await userRecord(db, profileId)
  if (!user) throw new Error(`no auth user ${profileId}`)
  const sessionId = `${profileId.slice(0, 8)}-0000-4000-8000-${profileId.slice(-12)}`
  const access_token = mintJwt({ sub: profileId, aud: 'authenticated', role: 'authenticated', email: user.email, phone: user.phone ?? '', app_metadata: user.app_metadata, user_metadata: user.user_metadata, aal, amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }], session_id: sessionId, is_anonymous: false })
  const expires_in = 3650 * 24 * 3600
  return { access_token, token_type: 'bearer', expires_in, expires_at: Math.floor(Date.now() / 1000) + expires_in, refresh_token: `rt-${profileId}`, user }
}
/** The cookie @supabase/ssr reads: name from the URL's host, value base64url of the session. */
export function sessionCookie(session) {
  const ref = new URL(SUPABASE_URL).hostname.split('.')[0]
  return { name: `sb-${ref}-auth-token`, value: 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url'), domain: 'localhost', path: '/' }
}

/** PostgREST's login role on the local database. */
export async function ensureRoles(db) {
  await db.query(`alter role authenticator with login password 'local' noinherit`)
  await db.query(`grant anon, authenticated, service_role to authenticator`)
}

/** The database's idea of now for PostgREST's connections (the simulated clock, clock.sql). */
export async function setDbClock(db, iso) {
  if (iso) await db.query(`alter database squadroom_local set sim.now = '${iso}'`)
  else await db.query(`alter database squadroom_local reset sim.now`)
  await db.query(`alter database squadroom_local set timezone = 'UTC'`)
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(fn, { tries = 80, every = 150 } = {}) {
  for (let i = 0; i < tries; i++) {
    try { if (await fn()) return true } catch {}
    await wait(every)
  }
  return false
}

/** Whatever still listens on one of our ports is an earlier run's: it goes, or we do not start. */
async function clearPort(port) {
  for (let i = 0; i < 24; i++) {
    let pids = ''
    try { pids = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() } catch { pids = '' }
    if (!pids) return
    for (const pid of pids.split(/\s+/)) { try { process.kill(Number(pid), i < 12 ? 'SIGTERM' : 'SIGKILL') } catch {} }
    await wait(250)
  }
  throw new Error(`port ${port} is still held by another process`)
}

/**
 * Start PostgREST, the auth stub and the proxy. Returns { stop }. With
 * `expectNow` (an ISO moment) the server's clock is read back through
 * PostgREST and the start fails if it is not within the hour — a stale
 * server from an aborted run held :54331 for eleven hours on 15 Nov 2026
 * and every screen check that day looked at the wrong week.
 */
export async function startStack(db, { quiet = true, expectNow = null } = {}) {
  await ensureRoles(db)
  await clearPort(POSTGREST_PORT)
  await clearPort(AUTH_PORT)
  await clearPort(PROXY_PORT)
  const env = {
    ...process.env,
    DYLD_LIBRARY_PATH: LIBPQ,
    PGRST_DB_URI: 'postgres://authenticator:local@localhost:54329/squadroom_local',
    PGRST_DB_SCHEMAS: 'public',
    PGRST_DB_ANON_ROLE: 'anon',
    PGRST_JWT_SECRET: SECRET,
    PGRST_SERVER_PORT: String(POSTGREST_PORT),
    PGRST_SERVER_HOST: '127.0.0.1',
    PGRST_DB_POOL: '10',
    PGRST_DB_PREPARED_STATEMENTS: 'false',
    PGRST_LOG_LEVEL: quiet ? 'error' : 'info',
  }
  const postgrest = spawn(POSTGREST, [], { env, stdio: quiet ? 'ignore' : 'inherit' })
  let gone = null
  postgrest.on('exit', (code, signal) => { gone = `exited (${code ?? signal})` })
  let upRest = false
  for (let i = 0; i < 80 && !upRest && !gone; i++) {
    try { upRest = (await fetch(`http://127.0.0.1:${POSTGREST_PORT}/`)).ok } catch {}
    if (!upRest) await wait(150)
  }
  if (!upRest) { try { postgrest.kill('SIGKILL') } catch {} throw new Error(`PostgREST did not start${gone ? ` — ${gone}` : ''}`) }
  if (expectNow) {
    const key = anonKey()
    const seen = await fetch(`http://127.0.0.1:${POSTGREST_PORT}/rpc/sim_now`, { headers: { apikey: key, authorization: `Bearer ${key}` } }).then((r) => r.json()).catch(() => null)
    const drift = typeof seen === 'string' ? Math.abs(new Date(seen).getTime() - new Date(expectNow).getTime()) : Infinity
    if (!(drift < 3600_000)) { try { postgrest.kill('SIGKILL') } catch {} throw new Error(`PostgREST's clock reads ${JSON.stringify(seen)}, not ${expectNow} — a stale server, or sim.now not set for the database`) }
  }

  // The auth stub.
  const auth = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${AUTH_PORT}`)
    const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(body)) }
    const bearer = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
    try {
      if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }); return res.end() }
      if (url.pathname.endsWith('/user') && req.method === 'GET') {
        const claims = verifyJwt(bearer)
        if (!claims?.sub) return send(401, { code: 401, msg: 'invalid JWT' })
        const user = await userRecord(db, claims.sub)
        return user ? send(200, user) : send(404, { code: 404, msg: 'no such user' })
      }
      if (url.pathname.endsWith('/token') && req.method === 'POST') {
        let body = ''
        for await (const chunk of req) body += chunk
        const json = body ? JSON.parse(body) : {}
        const sub = String(json.refresh_token ?? '').replace(/^rt-/, '') || verifyJwt(bearer)?.sub
        if (!sub) return send(400, { error: 'invalid_grant', error_description: 'no such session' })
        return send(200, await sessionFor(db, sub))
      }
      if (url.pathname.endsWith('/jwks.json')) return send(200, { keys: [] })
      if (url.pathname.endsWith('/settings')) return send(200, { external: { email: true, phone: false }, disable_signup: true, mailer_autoconfirm: true, phone_autoconfirm: false, sms_provider: '' })
      if (url.pathname.endsWith('/logout')) { res.writeHead(204); return res.end() }
      send(404, { code: 404, msg: `the simulation's auth stub has no ${url.pathname}` })
    } catch (e) {
      send(500, { msg: e.message })
    }
  })
  await new Promise((r) => auth.listen(AUTH_PORT, '127.0.0.1', r))

  // The proxy: one origin for the app.
  const proxy = http.createServer((req, res) => {
    const target = req.url.startsWith('/rest/v1/') ? { port: POSTGREST_PORT, path: req.url.slice('/rest/v1'.length) }
      : req.url.startsWith('/auth/v1/') ? { port: AUTH_PORT, path: req.url }
      : null
    if (!target) {
      res.writeHead(404, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
      return res.end(JSON.stringify({ message: 'not in the simulation stack' }))
    }
    const out = http.request({ host: '127.0.0.1', port: target.port, path: target.path, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${target.port}` } }, (up) => {
      res.writeHead(up.statusCode, up.headers)
      up.pipe(res)
    })
    out.on('error', (e) => { res.writeHead(502); res.end(e.message) })
    req.pipe(out)
  })
  proxy.on('upgrade', (req, socket) => socket.destroy())
  await new Promise((r) => proxy.listen(PROXY_PORT, '127.0.0.1', r))

  return {
    async stop() {
      proxy.closeAllConnections?.()
      auth.closeAllConnections?.()
      await new Promise((r) => proxy.close(r))
      await new Promise((r) => auth.close(r))
      // Wait for PostgREST to go; after three seconds, make it.
      await new Promise((resolve) => {
        if (gone) return resolve()
        const t = setTimeout(() => { try { postgrest.kill('SIGKILL') } catch {} }, 3000)
        postgrest.once('exit', () => { clearTimeout(t); resolve() })
        try { postgrest.kill() } catch { clearTimeout(t); resolve() }
      })
    },
  }
}

if (process.argv[1]?.endsWith('stack.mjs')) {
  if (process.argv.includes('--keys')) {
    console.log(`NEXT_PUBLIC_SUPABASE_URL=${SUPABASE_URL}`)
    console.log(`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${anonKey()}`)
    console.log(`SUPABASE_SERVICE_ROLE_KEY=${serviceKey()}`)
  } else if (process.argv.includes('--serve')) {
    // Hold the stack up by hand (the local Postgres must be running: season.mjs, or sql.mjs in another window).
    const db = new pg.Client({ host: 'localhost', port: 54329, user: 'postgres', password: 'local', database: 'squadroom_local' })
    await db.connect()
    const at = process.argv.includes('--at') ? process.argv[process.argv.indexOf('--at') + 1] : null
    await setDbClock(db, at)
    const stack = await startStack(db, { quiet: false })
    console.log(`stack up at ${SUPABASE_URL} (clock ${at ?? 'real'}) — Ctrl-C to stop`)
    process.on('SIGINT', async () => { await stack.stop(); await db.end(); process.exit(0) })
  }
}
