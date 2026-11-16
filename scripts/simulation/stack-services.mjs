// The local stack's auth and storage services (LOCAL ONLY; stack.mjs mounts
// them). Just enough of GoTrue and Supabase Storage for the real app to sign
// families up, approve them, upload and read files — against the simulated
// league on the embedded Postgres, with the product's own triggers and
// storage policies doing the work:
//
//   auth    — accounts are rows in auth.users (the 0272 triggers make the
//             profile, settings and account_emails); passwords are bcrypt
//             through pgcrypto; the admin API, the password grant, magic
//             links and verify do what the account routes expect.
//   storage — bytes on disk under .cache/storage/<bucket>/<name>; every
//             upload, read, move and delete is a row in storage.objects
//             written or read AS THE CALLER (role + request.jwt.claims),
//             so the real storage policies decide, as storage-api does.
//             Signed links are HMAC tokens; public buckets serve to anyone.
//
// Nothing here reaches Supabase or the internet.
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import pg from 'pg'

const GLOBAL_LIMIT = 50 * 1024 * 1024
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD',
  'access-control-expose-headers': '*',
}

export function createServices({ secret, supabaseUrl, sessionFor, userRecord, verifyJwt, root }) {
  const pool = new pg.Pool({ host: 'localhost', port: 54329, user: 'postgres', password: 'local', database: 'squadroom_local', max: 8 })
  const FILES = join(root, '.cache', 'storage')
  const links = new Map() // hashed_token → { sub, exp } for generate_link → verify
  mkdirSync(FILES, { recursive: true })

  // ------------------------------------------------------------ plumbing
  const send = (res, code, body, headers = {}) => {
    res.writeHead(code, { 'content-type': 'application/json', ...CORS, ...headers })
    res.end(body === undefined ? '' : JSON.stringify(body))
  }
  const readBody = (req) => new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
  const json = (buf) => { try { return buf.length ? JSON.parse(buf.toString()) : {} } catch { return {} } }
  const bearer = (req) => (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
  /** The caller: the verified JWT's claims, or anon. */
  const claimsOf = (req) => verifyJwt(bearer(req)) ?? verifyJwt(req.headers.apikey ?? '') ?? { role: 'anon' }
  const isService = (c) => c?.role === 'service_role'
  /** Run `fn(client)` in one transaction as the caller (role + claims), as PostgREST and storage-api do. */
  async function asCaller(claims, fn) {
    const c = await pool.connect()
    try {
      await c.query('begin')
      const role = ['anon', 'authenticated', 'service_role'].includes(claims?.role) ? claims.role : 'anon'
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims ?? { role })])
      await c.query(`set local role ${role}`)
      const out = await fn(c)
      await c.query('commit')
      return out
    } catch (e) {
      await c.query('rollback').catch(() => null)
      throw e
    } finally {
      c.release()
    }
  }
  const ensure = async () => {
    await pool.query(`create unique index if not exists sim_objects_bucket_name on storage.objects (bucket_id, name)`)
  }

  // ---------------------------------------------------------------- auth
  const authError = (res, code, error_code, msg) => send(res, code, { code, error_code, msg })
  const gotrueUser = async (sub) => userRecord(sub)
  async function findByEmail(email) {
    const { rows } = await pool.query(`select id from auth.users where lower(email) = lower($1)`, [email])
    return rows[0]?.id ?? null
  }
  async function handleAuth(req, res) {
    const url = new URL(req.url, supabaseUrl)
    const path = url.pathname.replace(/^\/auth\/v1/, '')
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end() }
    const claims = verifyJwt(bearer(req))
    const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ? json(await readBody(req)) : {}
    try {
      // ---- the signed-in person
      if (path === '/user' && req.method === 'GET') {
        if (!claims?.sub) return authError(res, 401, 'bad_jwt', 'invalid JWT')
        const user = await gotrueUser(claims.sub)
        return user ? send(res, 200, user) : authError(res, 404, 'user_not_found', 'User not found')
      }
      if (path === '/user' && req.method === 'PUT') {
        if (!claims?.sub) return authError(res, 401, 'bad_jwt', 'invalid JWT')
        await updateUser(claims.sub, { password: body.password, email: body.email, user_metadata: body.data })
        return send(res, 200, await gotrueUser(claims.sub))
      }
      if (path === '/token' && req.method === 'POST') {
        const grant = url.searchParams.get('grant_type')
        if (grant === 'password') {
          const { rows } = await pool.query(
            `select id, email_confirmed_at, encrypted_password is not null and encrypted_password = crypt($2, encrypted_password) as ok
               from auth.users where lower(email) = lower($1)`, [String(body.email ?? ''), String(body.password ?? '')])
          const u = rows[0]
          if (!u || !u.ok) return authError(res, 400, 'invalid_credentials', 'Invalid login credentials')
          if (!u.email_confirmed_at) return authError(res, 400, 'email_not_confirmed', 'Email not confirmed')
          await pool.query(`update auth.users set last_sign_in_at = now() where id = $1`, [u.id])
          return send(res, 200, await sessionFor(u.id))
        }
        const sub = String(body.refresh_token ?? '').replace(/^rt-/, '') || claims?.sub
        if (!sub) return send(res, 400, { error: 'invalid_grant', error_description: 'no such session' })
        return send(res, 200, await sessionFor(sub))
      }
      if (path === '/verify' && req.method === 'POST') {
        const hit = links.get(String(body.token_hash ?? body.token ?? ''))
        if (!hit || hit.exp < Date.now()) return authError(res, 403, 'otp_expired', 'Email link is invalid or has expired')
        links.delete(body.token_hash)
        await pool.query(`update auth.users set last_sign_in_at = now(), email_confirmed_at = coalesce(email_confirmed_at, now()) where id = $1`, [hit.sub])
        return send(res, 200, await sessionFor(hit.sub))
      }
      if (path === '/logout') { res.writeHead(204, CORS); return res.end() }
      if (path.endsWith('/jwks.json')) return send(res, 200, { keys: [] })
      if (path === '/settings') return send(res, 200, { external: { email: true, phone: false }, disable_signup: true, mailer_autoconfirm: true, phone_autoconfirm: false, sms_provider: '' })
      if (['/otp', '/recover', '/resend', '/magiclink'].includes(path)) return send(res, 200, {})

      // ---- the admin API (the service role only)
      if (path.startsWith('/admin/')) {
        if (!isService(claims)) return authError(res, 401, 'not_admin', 'User not allowed')
        const m = path.match(/^\/admin\/users(?:\/([0-9a-f-]{36}))?$/)
        if (m && req.method === 'POST' && !m[1]) {
          const email = body.email ? String(body.email).toLowerCase() : null
          const phone = body.phone ? String(body.phone).replace(/^\+/, '') : null
          if (email && (await findByEmail(email))) return authError(res, 422, 'email_exists', 'A user with this email address has already been registered')
          if (phone) {
            const { rows } = await pool.query(`select 1 from auth.users where phone = $1`, [phone])
            if (rows.length) return authError(res, 422, 'phone_exists', 'A user with this phone number has already been registered')
          }
          const id = randomUUID()
          await pool.query(
            `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, phone, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
             values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2,
                     case when $3::text is null then null else crypt($3, gen_salt('bf')) end,
                     case when $4::boolean then now() end, $5,
                     '{"provider":"email","providers":["email"]}'::jsonb, coalesce($6::jsonb, '{}'::jsonb), now(), now())`,
            [id, email, body.password ?? null, Boolean(body.email_confirm), phone, JSON.stringify(body.user_metadata ?? {})])
          return send(res, 200, await gotrueUser(id))
        }
        if (m && req.method === 'GET' && !m[1]) {
          const page = Math.max(1, Number(url.searchParams.get('page') ?? 1)), per = Math.min(1000, Number(url.searchParams.get('per_page') ?? 50))
          const { rows } = await pool.query(`select id from auth.users order by created_at desc, id limit $1 offset $2`, [per, (page - 1) * per])
          const users = []
          for (const r of rows) users.push(await gotrueUser(r.id))
          return send(res, 200, { users, aud: 'authenticated' })
        }
        if (m && m[1] && req.method === 'GET') {
          const user = await gotrueUser(m[1])
          return user ? send(res, 200, user) : authError(res, 404, 'user_not_found', 'User not found')
        }
        if (m && m[1] && req.method === 'PUT') {
          const user = await gotrueUser(m[1])
          if (!user) return authError(res, 404, 'user_not_found', 'User not found')
          await updateUser(m[1], body)
          return send(res, 200, await gotrueUser(m[1]))
        }
        if (m && m[1] && req.method === 'DELETE') {
          await pool.query(`delete from auth.users where id = $1`, [m[1]])
          return send(res, 200, {})
        }
        if (path === '/admin/generate_link' && req.method === 'POST') {
          // Never signs anyone up: an unknown address is refused (CLAUDE.md's hazard).
          const sub = body.email ? await findByEmail(String(body.email)) : null
          if (!sub) return authError(res, 404, 'user_not_found', 'User not found')
          const token = randomBytes(24).toString('hex')
          links.set(token, { sub, exp: Date.now() + 3600_000 })
          const user = await gotrueUser(sub)
          return send(res, 200, { ...user, action_link: `${supabaseUrl}/auth/v1/verify?token=${token}&type=${body.type ?? 'magiclink'}`, email_otp: '000000', hashed_token: token, redirect_to: body.options?.redirectTo ?? '', verification_type: body.type ?? 'magiclink' })
        }
      }
      return send(res, 404, { code: 404, msg: `the simulation's auth stub has no ${req.method} ${path}` })
    } catch (e) {
      return send(res, 500, { code: 500, msg: e.message })
    }
  }
  async function updateUser(id, b) {
    const sets = [], vals = [id]
    const add = (sql, v) => { vals.push(v); sets.push(sql.replace('?', `$${vals.length}`)) }
    if (b.email) add(`email = lower(?)`, String(b.email))
    if (b.phone !== undefined && b.phone !== null) add(`phone = ?`, String(b.phone).replace(/^\+/, ''))
    if (b.password) add(`encrypted_password = crypt(?, gen_salt('bf'))`, String(b.password))
    if (b.email_confirm) sets.push(`email_confirmed_at = coalesce(email_confirmed_at, now())`)
    if (b.user_metadata) add(`raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || ?::jsonb`, JSON.stringify(b.user_metadata))
    if (b.app_metadata) add(`raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || ?::jsonb`, JSON.stringify(b.app_metadata))
    if (!sets.length) return
    await pool.query(`update auth.users set ${sets.join(', ')}, updated_at = now() where id = $1`, vals)
  }

  // ------------------------------------------------------------- storage
  const storageError = (res, code, error, message) => send(res, code, { statusCode: String(code), error, message })
  const fileOf = (bucket, name) => join(FILES, bucket, name)
  const seg = (s) => s.split('/').map((x) => decodeURIComponent(x)).join('/')
  async function bucketOf(id) {
    const { rows } = await pool.query(`select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = $1`, [id])
    return rows[0] ?? null
  }
  const signToken = (bucket, name, exp) => {
    const payload = Buffer.from(JSON.stringify({ url: `${bucket}/${name}`, exp })).toString('base64url')
    return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`
  }
  const checkToken = (token, bucket, name) => {
    const [payload, sig] = String(token ?? '').split('.')
    if (!payload || sig !== createHmac('sha256', secret).update(payload).digest('base64url')) return false
    try { const p = JSON.parse(Buffer.from(payload, 'base64url').toString()); return p.url === `${bucket}/${name}` && p.exp > Date.now() / 1000 } catch { return false }
  }
  /** Parse one multipart/form-data body: the part with a filename is the file. */
  function multipart(buf, contentType) {
    const b = /boundary=("?)([^";]+)\1/.exec(contentType)?.[2]
    if (!b) return null
    const delim = Buffer.from(`--${b}`)
    let file = null, fields = {}
    let pos = buf.indexOf(delim)
    while (pos >= 0) {
      const start = pos + delim.length
      if (buf.slice(start, start + 2).toString() === '--') break
      const headEnd = buf.indexOf('\r\n\r\n', start)
      if (headEnd < 0) break
      const head = buf.slice(start + 2, headEnd).toString()
      const next = buf.indexOf(delim, headEnd + 4)
      const data = buf.slice(headEnd + 4, (next >= 0 ? next : buf.length) - 2)
      const name = /name="([^"]*)"/.exec(head)?.[1] ?? ''
      const filename = /filename="([^"]*)"/.exec(head)?.[1]
      const type = /content-type:\s*([^\r\n]+)/i.exec(head)?.[1]?.trim()
      if (filename !== undefined || name === '') file = { data, type: type || 'application/octet-stream', filename }
      else fields[name] = data.toString()
      pos = next
    }
    return { file, fields }
  }
  function serveFile(req, res, bucket, name, meta) {
    const path = fileOf(bucket, name)
    if (!existsSync(path)) return storageError(res, 404, 'not_found', 'Object not found')
    const size = statSync(path).size
    const type = meta?.mimetype ?? 'application/octet-stream'
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
    const base = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'max-age=3600', ...CORS }
    if (range && size > 0) {
      const a = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
      const z = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
      res.writeHead(206, { ...base, 'content-range': `bytes ${a}-${z}/${size}`, 'content-length': z - a + 1 })
      if (req.method === 'HEAD') return res.end()
      return createReadStream(path, { start: a, end: z }).pipe(res)
    }
    res.writeHead(200, { ...base, 'content-length': size })
    if (req.method === 'HEAD') return res.end()
    createReadStream(path).pipe(res)
  }
  const pgRefusal = (e) => e.code === '42501' ? [403, 'Unauthorized', 'new row violates row-level security policy']
    : e.code === '23505' ? [409, 'Duplicate', 'The resource already exists']
    : [500, 'Internal', e.message]

  async function handleStorage(req, res) {
    const url = new URL(req.url, supabaseUrl)
    const path = url.pathname.replace(/^\/storage\/v1/, '')
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end() }
    const claims = claimsOf(req)
    try {
      let m
      // ---- a bucket
      if ((m = path.match(/^\/bucket\/([^/]+)$/)) && req.method === 'GET') {
        const b = await bucketOf(seg(m[1]))
        return b ? send(res, 200, b) : storageError(res, 404, 'Bucket not found', 'Bucket not found')
      }
      // ---- public read
      if ((m = path.match(/^\/object\/public\/([^/]+)\/(.+)$/)) && (req.method === 'GET' || req.method === 'HEAD')) {
        const bucket = seg(m[1]), name = seg(m[2])
        const b = await bucketOf(bucket)
        if (!b?.public) return storageError(res, 400, 'Bucket not found', 'Bucket not found')
        const { rows } = await pool.query(`select metadata from storage.objects where bucket_id = $1 and name = $2`, [bucket, name])
        if (!rows[0]) return storageError(res, 404, 'not_found', 'Object not found')
        return serveFile(req, res, bucket, name, rows[0].metadata)
      }
      // ---- a signed read: the token is the permission, as on Supabase
      if ((m = path.match(/^\/object\/sign\/([^/]+)\/(.+)$/)) && (req.method === 'GET' || req.method === 'HEAD')) {
        const bucket = seg(m[1]), name = seg(m[2])
        if (!checkToken(url.searchParams.get('token'), bucket, name)) return storageError(res, 400, 'InvalidJWT', 'jwt expired or invalid')
        const { rows } = await pool.query(`select metadata from storage.objects where bucket_id = $1 and name = $2`, [bucket, name])
        if (!rows[0]) return storageError(res, 404, 'not_found', 'Object not found')
        return serveFile(req, res, bucket, name, rows[0].metadata)
      }
      // ---- signing: one path, or many
      if ((m = path.match(/^\/object\/sign\/([^/]+)\/(.+)$/)) && req.method === 'POST') {
        const bucket = seg(m[1]), name = seg(m[2]), body = json(await readBody(req))
        const visible = await asCaller(claims, async (c) => (await c.query(`select 1 from storage.objects where bucket_id = $1 and name = $2`, [bucket, name])).rows.length > 0)
        if (!visible) return storageError(res, 400, 'not_found', 'Object not found')
        const exp = Math.floor(Date.now() / 1000) + Number(body.expiresIn ?? 3600)
        return send(res, 200, { signedURL: `/object/sign/${bucket}/${name}?token=${signToken(bucket, name, exp)}` })
      }
      if ((m = path.match(/^\/object\/sign\/([^/]+)$/)) && req.method === 'POST') {
        const bucket = seg(m[1]), body = json(await readBody(req))
        const paths = Array.isArray(body.paths) ? body.paths : []
        const exp = Math.floor(Date.now() / 1000) + Number(body.expiresIn ?? 3600)
        const seen = await asCaller(claims, async (c) => new Set((await c.query(`select name from storage.objects where bucket_id = $1 and name = any($2::text[])`, [bucket, paths])).rows.map((r) => r.name)))
        return send(res, 200, paths.map((p) => seen.has(p)
          ? { path: p, signedURL: `/object/sign/${bucket}/${p}?token=${signToken(bucket, p, exp)}`, error: null }
          : { path: p, signedURL: null, error: 'Either the object does not exist or you do not have access to it' }))
      }
      // ---- list, move, remove
      if ((m = path.match(/^\/object\/list\/([^/]+)$/)) && req.method === 'POST') {
        const bucket = seg(m[1]), body = json(await readBody(req))
        const prefix = body.prefix ? String(body.prefix).replace(/\/?$/, '/') : ''
        const rows = await asCaller(claims, async (c) => (await c.query(
          `select name, id, metadata, created_at, updated_at, last_accessed_at from storage.objects where bucket_id = $1 and ($2 = '' or name like $2 || '%') order by name limit $3 offset $4`,
          [bucket, prefix, Number(body.limit ?? 100), Number(body.offset ?? 0)])).rows)
        const out = new Map()
        for (const r of rows) {
          const rest = r.name.slice(prefix.length)
          const first = rest.split('/')[0]
          if (rest.includes('/')) { if (!out.has(first)) out.set(first, { name: first, id: null, updated_at: null, created_at: null, last_accessed_at: null, metadata: null }) }
          else out.set(first, { name: first, id: r.id, updated_at: r.updated_at, created_at: r.created_at, last_accessed_at: r.last_accessed_at, metadata: r.metadata })
        }
        return send(res, 200, [...out.values()])
      }
      if (path === '/object/move' && req.method === 'POST') {
        const body = json(await readBody(req))
        const { bucketId, sourceKey, destinationKey } = body
        const moved = await asCaller(claims, async (c) => (await c.query(`update storage.objects set name = $3, updated_at = now() where bucket_id = $1 and name = $2 returning id`, [bucketId, sourceKey, destinationKey])).rowCount)
        if (!moved) return storageError(res, 404, 'not_found', 'Object not found')
        const from = fileOf(bucketId, sourceKey), to = fileOf(bucketId, destinationKey)
        if (existsSync(from)) { mkdirSync(dirname(to), { recursive: true }); renameSync(from, to) }
        return send(res, 200, { message: 'Successfully moved' })
      }
      if ((m = path.match(/^\/object\/([^/]+)$/)) && req.method === 'DELETE') {
        const bucket = seg(m[1]), body = json(await readBody(req))
        const prefixes = Array.isArray(body.prefixes) ? body.prefixes : []
        const gone = await asCaller(claims, async (c) => (await c.query(
          `delete from storage.objects where bucket_id = $1 and name = any($2::text[]) returning id, name, bucket_id, metadata, created_at, updated_at, last_accessed_at`, [bucket, prefixes])).rows)
        for (const g of gone) rmSync(fileOf(bucket, g.name), { force: true })
        return send(res, 200, gone)
      }
      // ---- an authenticated read
      if ((m = path.match(/^\/object\/([^/]+)\/(.+)$/)) && (req.method === 'GET' || req.method === 'HEAD')) {
        const bucket = seg(m[1]), name = seg(m[2])
        const row = await asCaller(claims, async (c) => (await c.query(`select metadata from storage.objects where bucket_id = $1 and name = $2`, [bucket, name])).rows[0])
        if (!row) return storageError(res, 400, 'not_found', 'Object not found')
        return serveFile(req, res, bucket, name, row.metadata)
      }
      // ---- an upload
      if ((m = path.match(/^\/object\/([^/]+)\/(.+)$/)) && (req.method === 'POST' || req.method === 'PUT')) {
        const bucket = seg(m[1]), name = seg(m[2])
        const b = await bucketOf(bucket)
        if (!b) return storageError(res, 404, 'Bucket not found', 'Bucket not found')
        const raw = await readBody(req)
        const ct = req.headers['content-type'] ?? ''
        let data = raw, mime = ct.split(';')[0].trim() || 'application/octet-stream', cacheControl = 'max-age=3600'
        if (/multipart\/form-data/i.test(ct)) {
          const parts = multipart(raw, ct)
          if (!parts?.file) return storageError(res, 400, 'InvalidRequest', 'no file in the form')
          data = parts.file.data; mime = parts.file.type
          if (parts.fields.cacheControl) cacheControl = `max-age=${parts.fields.cacheControl}`
        }
        if (b.allowed_mime_types && !b.allowed_mime_types.some((t) => t === mime || (t.endsWith('/*') && mime.startsWith(t.slice(0, -1))))) {
          return storageError(res, 415, 'invalid_mime_type', `mime type ${mime} is not supported`)
        }
        const limit = Math.min(Number(b.file_size_limit ?? GLOBAL_LIMIT), GLOBAL_LIMIT)
        if (data.length > limit) return storageError(res, 413, 'Payload too large', 'The object exceeded the maximum allowed size')
        const upsert = String(req.headers['x-upsert'] ?? '').toLowerCase() === 'true' || req.method === 'PUT'
        const meta = { eTag: `"${randomUUID().replace(/-/g, '')}"`, size: data.length, mimetype: mime, cacheControl, lastModified: new Date().toISOString(), contentLength: data.length, httpStatusCode: 200 }
        let id
        try {
          id = await asCaller(claims, async (c) => {
            const owner = claims.sub ?? null
            const { rows } = await c.query(
              `insert into storage.objects (bucket_id, name, owner, owner_id, metadata, version) values ($1, $2, $3::uuid, $3, $4::jsonb, $5)
               ${upsert ? `on conflict (bucket_id, name) do update set metadata = excluded.metadata, version = excluded.version, owner = excluded.owner, owner_id = excluded.owner_id, updated_at = now()` : ''}
               returning id`, [bucket, name, owner, JSON.stringify(meta), randomUUID()])
            return rows[0]?.id
          })
        } catch (e) {
          const [code, error, message] = pgRefusal(e)
          return storageError(res, code, error, message)
        }
        const file = fileOf(bucket, name)
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(file, data)
        return send(res, 200, { Id: id, Key: `${bucket}/${name}` })
      }
      return storageError(res, 404, 'not_found', `the simulation's storage stub has no ${req.method} ${path}`)
    } catch (e) {
      return storageError(res, 500, 'Internal', e.message)
    }
  }

  return {
    ensure,
    auth: handleAuth,
    storage: handleStorage,
    async stop() { await pool.end().catch(() => null) },
  }
}
