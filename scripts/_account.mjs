// An account the way a person makes one (the sign-up brief, 12 Nov 2026):
// through the app's own routes — create, then the six-digit code, then the
// session the server mints. For suites.
//
//   import { createAccount, deleteAccount, forgetCodes } from './_account.mjs'
//   const parent = await createAccount(BASE, { first: 'Testy', last: 'Parent', email: 'testy.parent@squadroom-demo.test', mobile: '0400 008 888' })
//   await post('/api/join/request', {...}, parent.cookie)
//   await page.setCookie(...parent.browserCookies)
//
// Demo addresses only (@squadroom-demo.test): a demo account's code comes
// back in the response, because it was never sent anywhere (docs/DEMO.md).
// A real address would need Resend, and a suite must never email a stranger.
export const TEST_PASSWORD = 'squadroom-test-2026'

export function parseSetCookies(headers) {
  return headers
    .map((h) => {
      const [pair] = h.split(';')
      const i = pair.indexOf('=')
      return { name: pair.slice(0, i).trim(), value: pair.slice(i + 1).trim() }
    })
    .filter((c) => c.name)
}

async function json(res) {
  return res.json().catch(() => ({}))
}

/** Create and confirm an account; returns its cookies for routes and for puppeteer. */
export async function createAccount(base, { first, middle = '', last, email, mobile, password = TEST_PASSWORD, next = '/' }) {
  if (!/@squadroom-demo\.test$/i.test(email)) throw new Error(`createAccount: ${email} is not a demo address — a suite must not email anyone`)
  const create = await fetch(`${base}/api/account/create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ first, middle, last, email, mobile }),
  })
  const made = await json(create)
  if (!create.ok) throw new Error(`create account: ${create.status} ${JSON.stringify(made)}`)
  if (!made.demo_code) throw new Error('create account: no demo code came back')
  const confirm = await fetch(`${base}/api/account/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, code: made.demo_code, purpose: 'confirm', password, next }),
  })
  const done = await json(confirm)
  if (!confirm.ok) throw new Error(`confirm account: ${confirm.status} ${JSON.stringify(done)}`)
  const cookies = parseSetCookies(confirm.headers.getSetCookie?.() ?? [])
  if (cookies.length === 0) throw new Error('confirm account: no session cookie came back')
  return {
    email,
    password,
    cookies,
    cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; '),
    browserCookies: cookies.map((c) => ({ name: c.name, value: c.value, domain: 'localhost', path: '/' })),
    next: done.next,
    adopted: Boolean(made.adopt),
  }
}

/** Sign an existing account in by its emailed code (a demo address), as "Email me a code instead" does. */
export async function signInByCode(base, email, purpose = 'sign_in', password) {
  const sent = await fetch(`${base}/api/account/code`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, purpose }),
  })
  const s = await json(sent)
  if (!sent.ok) throw new Error(`code: ${sent.status} ${JSON.stringify(s)}`)
  if (!s.demo_code) throw new Error('code: no demo code came back')
  const confirm = await fetch(`${base}/api/account/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, code: s.demo_code, purpose, password }),
  })
  const done = await json(confirm)
  if (!confirm.ok) throw new Error(`confirm: ${confirm.status} ${JSON.stringify(done)}`)
  const cookies = parseSetCookies(confirm.headers.getSetCookie?.() ?? [])
  return { cookies, cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; '), browserCookies: cookies.map((c) => ({ name: c.name, value: c.value, domain: 'localhost', path: '/' })) }
}

/** The account's id for an address — its sign-in address or the one it gave its club — through the service role. */
export async function accountId(admin, email) {
  const { data } = await admin.rpc('account_lookup', { p_email: email, p_phone: '' })
  return data?.by_email?.user_id ?? data?.by_account_email?.profile_id ?? null
}

/** Remove an account a suite made, and the codes sent to its address. */
export async function deleteAccount(admin, email) {
  const id = await accountId(admin, email)
  if (id) await admin.auth.admin.deleteUser(id).catch(() => null)
  await admin.from('email_codes').delete().eq('email', email)
  return id
}

/** The code last issued to a demo address (the service role reads the table; a browser never can). */
export async function lastDemoCode(admin, email, purpose) {
  const { data } = await admin
    .from('email_codes')
    .select('demo_code')
    .eq('email', email)
    .eq('purpose', purpose)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.demo_code ?? null
}

/** Forget the codes sent to these addresses, so a suite is not held to five an hour across runs. */
export async function forgetCodes(admin, emails) {
  if (emails.length) await admin.from('email_codes').delete().in('email', emails)
}
