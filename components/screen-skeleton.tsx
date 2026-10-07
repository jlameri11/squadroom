/**
 * What a tap paints before the data arrives.
 *
 * Same shape as the real screen, so nothing jumps when it lands. Without one,
 * Next.js holds the OLD screen on the display while the new one loads — so a
 * tap appears to do nothing and people tap again. That is most of what "slow"
 * feels like, and it is not the wait itself.
 */
export function ScreenSkeleton() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
      <div className="flex items-center gap-3 px-4 pb-3.5 pt-3" style={{ background: 'var(--brand)' }}>
        <div className="h-9 w-9 flex-none rounded-[10px]" style={{ background: '#ffffff26' }} />
        <div className="min-w-0 flex-1">
          <div className="h-4 w-40 rounded" style={{ background: '#ffffff2e' }} />
          <div className="mt-1.5 h-2.5 w-28 rounded" style={{ background: '#ffffff1a' }} />
        </div>
      </div>

      <div className="flex-1 px-3.5 pt-4">
        <div className="mb-2.5 h-3 w-32 rounded bg-[var(--surface-2)]" />
        <div className="stack">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card ev animate-pulse" style={{ animationDelay: `${i * 90}ms` }}>
              <div className="ev-top">
                <div className="datechip">
                  <div className="mx-auto h-5 w-6 rounded bg-[var(--surface-2)]" />
                  <div className="mx-auto mt-1 h-2 w-6 rounded bg-[var(--surface-2)]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="h-3 w-20 rounded bg-[var(--surface-2)]" />
                  <div className="mt-2 h-3.5 w-full rounded bg-[var(--surface-2)]" />
                  <div className="mt-1.5 h-3 w-2/3 rounded bg-[var(--surface-2)]" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
