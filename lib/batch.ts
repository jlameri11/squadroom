/**
 * Many small asks in the same moment, sent as one.
 *
 * A chat of fifty messages mounted fifty bubbles, and each asked the database
 * for its own reaction counts: fifty requests where one would do, on every
 * open, by everybody — and the scale test's Saturday morning is everybody
 * opening the app at once (time-screens, 6 Nov 2026: 46 of the U8 chat's 61
 * requests). `batched()` keeps each component's code the shape it was — ask
 * for one thing, get one thing back — and sends everything asked for within
 * a few milliseconds as one request, of up to `max` keys.
 *
 * A failed batch answers `undefined` for each key; a component treats that
 * as "nothing to show", exactly as it treated a failed single request.
 *
 * No imports, so a suite can run it directly.
 */
export function batched<K, V>(
  fetchMany: (keys: K[]) => Promise<Map<K, V>>,
  { wait = 8, max = 100 }: { wait?: number; max?: number } = {}
): (key: K) => Promise<V | undefined> {
  let queue: { key: K; resolve: (v: V | undefined) => void }[] = []
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = () => {
    const batch = queue
    queue = []
    if (timer) clearTimeout(timer)
    timer = null
    const keys = [...new Set(batch.map((b) => b.key))]
    fetchMany(keys)
      .catch(() => new Map<K, V>())
      .then((found) => {
        for (const b of batch) b.resolve(found.get(b.key))
      })
  }

  return (key: K) =>
    new Promise<V | undefined>((resolve) => {
      queue.push({ key, resolve })
      if (queue.length >= max) flush()
      else if (!timer) timer = setTimeout(flush, wait)
    })
}
