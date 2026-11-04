'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

type Item = { item: string; label: string; hint: string | null; href: string | null; auto: boolean; done: boolean; ticked_by: string | null; ticked_at: string | null }

/**
 * F-07: the match-day list, on the game, for the coach. The items the
 * database can see tick themselves; the rest are a tap. The same list is
 * what the hour-before push names.
 */
export function MatchDayChecklist({ eventId }: { eventId: string }) {
  const [items, setItems] = useState<Item[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    ;(async () => {
      const { data, error } = await createClient().rpc('event_checklist', { p_event: eventId })
      if (live) setItems(error ? null : ((data as unknown as Item[]) ?? []))
    })()
    return () => {
      live = false
    }
  }, [eventId])

  if (!items || items.length === 0) return null
  const left = items.filter((i) => !i.done).length

  async function tick(i: Item) {
    if (i.auto) return
    setBusy(i.item)
    const { data } = await createClient().rpc('tick_checklist', { p_event: eventId, p_item: i.item, p_done: !i.done })
    setBusy(null)
    if (data) setItems(data as unknown as Item[])
  }

  return (
    <section className="mt-4" data-match-day>
      <div className="sect">
        <span className="eyebrow">Match day</span>
        <span className="text-xs text-ink-3">{left === 0 ? 'All done' : `${left} to do`}</span>
      </div>
      <ul className="rounded-xl border" style={{ borderColor: 'var(--line)' }}>
        {items.map((i, n) => (
          <li key={i.item} className={`flex items-start gap-2.5 px-3 py-2 ${n > 0 ? 'border-t' : ''}`} style={{ borderColor: 'var(--line-2)' }} data-item={i.item} data-done={i.done}>
            <button
              onClick={() => tick(i)}
              disabled={i.auto || busy !== null}
              className="mt-0.5 grid h-5 w-5 flex-none place-items-center rounded-md border text-xs font-bold"
              style={i.done ? { background: 'var(--yes)', borderColor: 'var(--yes)', color: '#fff' } : { borderColor: 'var(--line)' }}
              aria-label={`${i.label}: ${i.done ? 'done' : 'to do'}${i.auto ? ' (ticks itself)' : ''}`}
            >
              {i.done ? '✓' : ''}
            </button>
            <span className="min-w-0 flex-1">
              <span className={`block text-sm ${i.done ? 'text-ink-3 line-through' : ''}`}>{i.label}</span>
              {(i.hint || i.ticked_by) && (
                <span className="block text-xs text-ink-3">
                  {i.ticked_by ? `Ticked by ${i.ticked_by}` : i.hint}
                </span>
              )}
            </span>
            {i.href && !i.done && (
              <Link href={i.href} className="flex-none text-xs underline underline-offset-2" style={{ color: 'var(--brand-text)' }}>
                Open
              </Link>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-1 text-[0.6875rem] text-ink-3">An hour before kick-off, every coach of the squad gets a push with what is still to do.</p>
    </section>
  )
}
