// Where the tests should point their browser.
//
// THE PROBLEM THIS SOLVES, which cost most of a night:
//
// Every HTTP-driving suite hard-coded `http://localhost:3000` and assumed
// `npm run dev` was healthy. `next dev` does not fail cleanly — it compiles a
// route on first request, and when something upstream wedges it (a type error
// mid-compile, a watcher that lost the filesystem, a stuck Turbopack worker)
// the port stays OPEN and the server stops answering. So `fetch` connects,
// waits, and hangs. The suite does not fail, it stalls, and a run left going
// overnight is still sitting on the first screen in the morning with nothing
// written down.
//
// A dead port is a good failure. A listening port that never replies is the
// bad one, and it is the one `next dev` actually produces.
//
// So: ask, with a deadline. If :3000 answers, use it — a human running `npm
// run dev` wants the tests against the thing they are editing. If it does not
// answer inside ten seconds, fall back to :3100, which `npm run serve:test`
// serves from a real production build. A build either succeeds or fails; it
// does not half-compile a route at request time, so :3100 cannot wedge the
// way :3000 does.
//
// BASE_URL, when set, wins outright and is never probed. A deploy preview or
// a CI URL is not ours to second-guess, and probing it only adds a way for
// the test run to decide it knows better.

const DEV = 'http://localhost:3000'
const TEST = 'http://localhost:3100'
const PROBE_MS = 10_000

/**
 * Resolve the base URL once, at the top of a suite.
 *
 * Returns a string, and never throws: a suite's job is to report on the
 * product, and "could not work out which port" is not a product failure.
 * When neither port answers it returns the test port anyway, so the suite's
 * own first request is what reports the problem — with the URL in the
 * message, which is the thing somebody reading the log needs.
 */
export async function resolveBaseUrl({ quiet = false } = {}) {
  const explicit = process.env.BASE_URL || process.env.SITE
  if (explicit) return explicit.replace(/\/+$/, '')

  if (await answers(DEV)) return DEV

  if (!quiet) {
    console.log(`  :3000 did not answer in ${PROBE_MS / 1000}s — using ${TEST}`)
    if (!(await answers(TEST))) {
      // Said plainly, because the alternative is twelve identical connection
      // errors and a reader working out what they have in common.
      console.log('  nothing on :3100 either. Start one:  npm run serve:test')
    }
  }
  return TEST
}

/**
 * Did anything reply?
 *
 * ANY status counts, including 404 and 500. We are asking whether a server is
 * alive, not whether a page is right — a 500 on `/` is a server that will
 * still report honestly on the twelve URLs the suite actually wants, and
 * refusing to run against it would hide those twelve results behind one.
 *
 * `redirect: 'manual'` because `/` redirects to the sign-in page when there
 * is no cookie, and following it is a second request we have no use for.
 */
async function answers(base) {
  try {
    await fetch(base, {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.timeout(PROBE_MS),
    })
    return true
  } catch {
    // A wedged dev server lands here by timeout, a stopped one by ECONNREFUSED.
    // Both mean the same thing to a caller, so neither is worth separating.
    return false
  }
}
