/**
 * Skeletons shaped like the screens they stand in for (the "Feels instant"
 * pass, item 5). The shared ScreenSkeleton is three event cards, which is
 * Home's shape; the Chat list is a search box and rows, the Admin hub a list
 * of rows — so these are drawn instead, and nothing jumps when the data
 * lands. Each carries data-skeleton, which time-screens waits to see go.
 */
const bar = (
  <div className="flex items-center gap-3 px-4 pb-3.5 pt-3" style={{ background: 'var(--bar)' }}>
    <div className="h-9 w-9 flex-none rounded-[10px]" style={{ background: 'color-mix(in srgb, var(--bar-ink) 16%, transparent)' }} />
    <div className="min-w-0 flex-1">
      <div className="h-4 w-28 rounded" style={{ background: 'color-mix(in srgb, var(--bar-ink) 18%, transparent)' }} />
      <div className="mt-1.5 h-2.5 w-20 rounded" style={{ background: 'color-mix(in srgb, var(--bar-ink) 10%, transparent)' }} />
    </div>
  </div>
)

function Row({ i, avatar = true }: { i: number; avatar?: boolean }) {
  return (
    <div className="flex animate-pulse items-center gap-3 px-4 py-3" style={{ animationDelay: `${i * 70}ms` }}>
      {avatar && <div className="h-11 w-11 flex-none rounded-full" style={{ background: 'var(--surface-2)' }} />}
      <div className="min-w-0 flex-1">
        <div className="h-3.5 rounded" style={{ background: 'var(--surface-2)', width: `${55 + ((i * 17) % 30)}%` }} />
        <div className="mt-2 h-3 rounded" style={{ background: 'var(--surface-2)', width: `${35 + ((i * 23) % 40)}%` }} />
      </div>
      {!avatar && <div className="h-4 w-3 flex-none rounded" style={{ background: 'var(--surface-2)' }} />}
    </div>
  )
}

/** The Chat list: the bar, the search box, the rows. */
export function ChatListSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col" data-skeleton>
      {bar}
      <div className="px-4 pt-3">
        <div className="h-10 rounded-xl" style={{ background: 'var(--surface-2)' }} />
      </div>
      <div className="card mx-4 mt-3 overflow-hidden">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Row key={i} i={i} />
        ))}
      </div>
    </div>
  )
}

/** The Admin hub: the bar and two groups of rows. */
export function AdminHubSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col" data-skeleton>
      {bar}
      <div className="p-3.5">
        <div className="mb-2 h-3 w-24 rounded" style={{ background: 'var(--surface-2)' }} />
        <div className="card overflow-hidden">
          {[0, 1, 2, 3].map((i) => (
            <Row key={i} i={i} avatar={false} />
          ))}
        </div>
        <div className="mb-2 mt-5 h-3 w-20 rounded" style={{ background: 'var(--surface-2)' }} />
        <div className="card overflow-hidden">
          {[4, 5, 6].map((i) => (
            <Row key={i} i={i} avatar={false} />
          ))}
        </div>
      </div>
    </div>
  )
}
