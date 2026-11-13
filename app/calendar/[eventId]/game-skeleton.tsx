/**
 * What a tap on a game paints before it arrives (the "Feels instant" pass,
 * item 5): the page's own shape — the back link, the hero with two crests
 * and the kick-off, the three tabs, a card — so nothing jumps when the
 * data lands. Only when nothing is cached; a game opened before paints from
 * the cache.
 */
export function GameSkeleton() {
  const block = (cls: string, extra?: React.CSSProperties) => (
    <div className={`animate-pulse rounded ${cls}`} style={{ background: 'var(--surface-2)', ...extra }} />
  )
  return (
    <main className="mx-auto max-w-md p-5" data-skeleton>
      {block('h-4 w-20')}
      <div className="mt-3 rounded-2xl p-4" style={{ background: 'var(--bar)' }}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col items-center gap-2">
            <div className="h-14 w-14 animate-pulse rounded-xl" style={{ background: 'color-mix(in srgb, var(--bar-ink) 16%, transparent)' }} />
            <div className="h-3 w-16 animate-pulse rounded" style={{ background: 'color-mix(in srgb, var(--bar-ink) 14%, transparent)' }} />
          </div>
          <div className="flex flex-col items-center gap-2">
            <div className="h-7 w-20 animate-pulse rounded" style={{ background: 'color-mix(in srgb, var(--bar-ink) 18%, transparent)' }} />
            <div className="h-3 w-24 animate-pulse rounded" style={{ background: 'color-mix(in srgb, var(--bar-ink) 12%, transparent)' }} />
          </div>
          <div className="flex flex-col items-center gap-2">
            <div className="h-14 w-14 animate-pulse rounded-xl" style={{ background: 'color-mix(in srgb, var(--bar-ink) 16%, transparent)' }} />
            <div className="h-3 w-16 animate-pulse rounded" style={{ background: 'color-mix(in srgb, var(--bar-ink) 14%, transparent)' }} />
          </div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-1 rounded-xl p-1" style={{ background: 'var(--surface-2)' }}>
        {block('h-9 rounded-lg', { background: 'var(--surface)' })}
        {block('h-9 rounded-lg', { background: 'transparent' })}
        {block('h-9 rounded-lg', { background: 'transparent' })}
      </div>
      <div className="card mt-4 p-4">
        {block('h-3 w-24')}
        <div className="mt-3 flex gap-2">
          {block('h-10 flex-1 rounded-xl')}
          {block('h-10 flex-1 rounded-xl')}
          {block('h-10 flex-1 rounded-xl')}
        </div>
      </div>
      <div className="card mt-3 p-4">
        {block('h-3 w-32')}
        <div className="mt-3 space-y-2">
          {block('h-3 w-full')}
          {block('h-3 w-2/3')}
        </div>
      </div>
    </main>
  )
}
