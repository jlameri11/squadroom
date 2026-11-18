// The real app, live, inside a simulation step (Joey, 16 Nov 2026): the
// local stack up at the season's moment — PostgREST, the auth and storage
// services, the proxy — and, when asked, a headless browser whose clock is
// the season's. Steps that sign families up through the sign-up flow, upload
// files through the composer or pay through Checkout go through here, the
// way the screen check does.
//
// Needs the app built for the stack and serving on :3300 (stack.mjs
// explains); without it the step is skipped with a note, never failed.
import pg from 'pg'
import { clock, note } from './lib.mjs'
import { APP_URL, sessionCookie, sessionFor, setDbClock, startStack } from './stack.mjs'

export const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

/** Is the app serving? (Checked once a step; a missing app is a note and a NEEDS JOEY line, not a failure.) */
export async function appUp(ctx, what) {
  const up = await fetch(`${APP_URL}/signin`).then((r) => r.ok).catch(() => false)
  if (!up) {
    note(`${what}: the app is not serving at ${APP_URL} — skipped`)
    ctx.needsJoey?.push(`"${what}" was skipped: the app was not built for the local stack (scripts/simulation/stack.mjs).`)
  }
  return up
}

/**
 * Run `fn({ db, browser })` with the stack up at the simulated moment. The
 * database-level clock is set for PostgREST's connections and reset after;
 * the stack refuses to start on a server whose clock is not the season's.
 */
export async function withStack(ctx, what, fn, { browser = false } = {}) {
  if (!(await appUp(ctx, what))) return null
  const db = new pg.Client({ host: 'localhost', port: 54329, user: 'postgres', password: 'local', database: 'squadroom_local' })
  await db.connect()
  await setDbClock(db, clock.iso())
  const stack = await startStack(db, { expectNow: clock.iso() })
  let br = null
  try {
    if (browser) {
      const puppeteer = (await import('puppeteer-core')).default
      br = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
    }
    return await fn({ db, browser: br, stack })
  } finally {
    await br?.close().catch(() => null)
    await stack.stop().catch(() => null)
    await setDbClock(db, null).catch(() => null)
    await db.end().catch(() => null)
  }
}

/**
 * A page open as a person: their session cookie, the organisation shown,
 * the browser's clock moved to the simulated moment, 375px wide, light.
 * Returns { context, page }; close the context when done.
 */
export async function pageAs(browser, db, personId, { org = null, hat = null, dark = false, width = 375, aal2 = false } = {}) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width, height: 812 })
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }])
  if (personId) {
    // A league's staff sign in with two steps (0231); aal2 is that session, as the SQL calls' {aal2:true} is.
    const session = await sessionFor(db, personId, { aal: aal2 ? 'aal2' : 'aal1' })
    await page.setCookie(sessionCookie(session))
  }
  const shift = clock.now ? clock.now.getTime() - Date.now() : 0
  await page.evaluateOnNewDocument((o, h, shiftMs) => {
    try {
      if (o) localStorage.setItem('squadroom.org', o)
      if (o && h) localStorage.setItem(`squadroom.hat:${o}`, h)
    } catch {}
    const RealDate = Date
    class SimDate extends RealDate {
      constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + shiftMs) }
      static now() { return RealDate.now() + shiftMs }
    }
    globalThis.Date = SimDate
  }, org, hat, shift)
  return { context, page }
}

/** Open a path and wait for the screen to settle (no skeleton, a quiet moment). Returns the page's text. */
export async function openSettled(page, path, { timeout = 45000 } = {}) {
  await page.goto(`${APP_URL}${path}`, { waitUntil: 'domcontentloaded', timeout })
  await page.waitForFunction(() => !document.querySelector('[data-skeleton]'), { timeout: 20000 }).catch(() => null)
  await new Promise((r) => setTimeout(r, 1200))
  return page.evaluate(() => document.body?.innerText ?? '')
}

/** The app's own API, as a person (the cookie a browser would send) — for routes that need a session. */
export async function apiAs(db, personId, path, { method = 'POST', body = null, headers = {} } = {}) {
  const session = personId ? await sessionFor(db, personId) : null
  const cookie = session ? sessionCookie(session) : null
  const res = await fetch(`${APP_URL}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie: `${cookie.name}=${cookie.value}` } : {}), ...headers },
    body: body == null ? undefined : JSON.stringify(body),
  })
  let data = null
  try { data = await res.json() } catch { data = null }
  return { status: res.status, ok: res.ok, data, headers: res.headers }
}

export const text = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()
export const has = (body, needle) => Boolean(needle) && text(body).toLowerCase().includes(text(needle).toLowerCase())
