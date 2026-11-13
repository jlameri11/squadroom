/**
 * What a tap on a chat paints before its messages arrive (the "Feels
 * instant" pass, item 5): the same shape as the real screen — the bar with
 * a back button and a name, bubbles either side, the composer — so nothing
 * jumps when the data lands. Shown only when there is nothing cached; a
 * chat opened before paints from the cache instead.
 */
export function ChatSkeleton() {
  const bubble = (i: number, mine: boolean, w: string) => (
    <div key={i} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`animate-pulse rounded-2xl px-3.5 py-2.5 ${w}`}
        style={{ background: 'var(--surface-2)', animationDelay: `${i * 70}ms` }}
      >
        <div className="h-3 w-full rounded" style={{ background: 'color-mix(in srgb, var(--ink) 8%, transparent)' }} />
        <div className="mt-1.5 h-3 w-2/3 rounded" style={{ background: 'color-mix(in srgb, var(--ink) 8%, transparent)' }} />
      </div>
    </div>
  )
  return (
    <div className="mx-auto flex h-dvh max-w-md flex-col" data-skeleton>
      <header className="flex items-center gap-3 px-4 pb-3.5 pt-3" style={{ background: 'var(--bar)', borderBottom: '1px solid var(--bar-line)' }}>
        <div className="-ml-1 h-9 w-9 flex-none rounded-[10px]" style={{ background: 'color-mix(in srgb, var(--bar-ink) 16%, transparent)' }} />
        <div className="min-w-0 flex-1">
          <div className="h-4 w-36 rounded" style={{ background: 'color-mix(in srgb, var(--bar-ink) 18%, transparent)' }} />
          <div className="mt-1.5 h-2.5 w-24 rounded" style={{ background: 'color-mix(in srgb, var(--bar-ink) 10%, transparent)' }} />
        </div>
        <div className="h-9 w-9 flex-none rounded-[10px]" style={{ background: 'color-mix(in srgb, var(--bar-ink) 16%, transparent)' }} />
      </header>
      <div className="flex flex-1 flex-col justify-end gap-2.5 overflow-hidden px-4 py-3" style={{ background: 'var(--paper)' }}>
        {bubble(0, false, 'w-3/5')}
        {bubble(1, false, 'w-2/5')}
        {bubble(2, true, 'w-1/2')}
        {bubble(3, false, 'w-3/4')}
        {bubble(4, true, 'w-2/5')}
        {bubble(5, false, 'w-1/2')}
      </div>
      <div className="flex items-center gap-2 border-t px-3 py-2.5" style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}>
        <div className="h-10 flex-1 rounded-full" style={{ background: 'var(--surface-2)' }} />
        <div className="h-10 w-10 flex-none rounded-full" style={{ background: 'var(--surface-2)' }} />
      </div>
    </div>
  )
}
