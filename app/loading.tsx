/**
 * What a tap paints immediately.
 *
 * Netlify runs this app in Ohio and the database is in Sydney, so a screen
 * takes a few hundred milliseconds to come back no matter how few queries it
 * makes. Without a loading state Next.js holds the OLD screen on the display
 * for that whole time — so a tap appears to do nothing, and people tap again.
 * That is the "slow between buttons" feeling, and it is mostly not the wait
 * itself but the absence of any evidence the tap registered.
 *
 * The navy bar paints instantly, so navigation feels immediate even when the
 * data is still crossing the Pacific.
 */
export default function Loading() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
      <div
        className="flex items-center gap-3 px-4 pb-3.5 pt-3"
        style={{ background: 'var(--brand)' }}
      >
        <div className="h-9 w-9 flex-none rounded-[10px]" style={{ background: '#ffffff26' }} />
        <div className="min-w-0 flex-1">
          <div className="h-4 w-32 rounded" style={{ background: '#ffffff2e' }} />
          <div className="mt-1.5 h-2.5 w-24 rounded" style={{ background: '#ffffff1a' }} />
        </div>
      </div>

      <div className="flex-1 px-3.5 pt-4">
        <div className="mb-2 h-3 w-28 rounded bg-[var(--surface-2)]" />
        <div className="stack">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card ev animate-pulse" style={{ animationDelay: `${i * 90}ms` }}>
              <div className="ev-top">
                <div className="datechip">
                  <div className="mx-auto h-5 w-6 rounded bg-[var(--surface-2)]" />
                  <div className="mx-auto mt-1 h-2 w-6 rounded bg-[var(--surface-2)]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="h-3.5 w-16 rounded bg-[var(--surface-2)]" />
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
