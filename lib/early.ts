/**
 * A request started before the component that needs it has mounted.
 *
 * Home's screen and its sections were a chain: home_screen, and only once
 * that had rendered, home_layout, needs_you and home_jobs — a second round
 * trip on every open (time-screens, 6 Nov 2026). Home now starts all four at
 * once, and each section joins the request already on its way.
 *
 * WHOEVER ASKS FIRST STARTS IT, the other joins: when Home renders from its
 * cache, React runs the sections' effects before Home's own, and a "start"
 * that only Home could make would then be a request nobody used. An answer
 * is shared for a few seconds and then asked for afresh.
 *
 * No imports, so a suite can run it directly.
 */
type Entry = { at: number; p: Promise<unknown> }
const pending = new Map<string, Entry>()
const FRESH_MS = 4000

/** The request for `key` already on its way (or answered moments ago), else a new one. */
export function takeEarly<T>(key: string, run: () => PromiseLike<T>): Promise<T> {
  const hit = pending.get(key)
  if (hit && Date.now() - hit.at < FRESH_MS) return hit.p as Promise<T>
  const p = Promise.resolve(run())
  pending.set(key, { at: Date.now(), p })
  return p
}

/** Start the request for `key` now, for whoever needs it next. */
export function startEarly<T>(key: string, run: () => PromiseLike<T>): void {
  void takeEarly(key, run)
}
