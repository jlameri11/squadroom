'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Sheet } from '@/components/sheet'

type Cell = { status: 'yes' | 'no' | 'maybe' | null; note: string | null; by: string | null; at: string | null; attendance: string | null }
type GridEvent = { id: string; title: string; starts_at: string; type: string; opponent: string | null; past: boolean; going: number; no_reply: number }
type GridPlayer = { id: string; name: string; preferred_name: string | null; number: number | null; cells: Record<string, Cell> }
type Grid = { team: { id: string; name: string; season: string | null }; timezone: string; events: GridEvent[]; players: GridPlayer[] }

const COLOUR: Record<string, { bg: string; ink: string; mark: string }> = {
  yes: { bg: 'var(--yes-bg)', ink: 'var(--yes)', mark: '✓' },
  maybe: { bg: 'var(--maybe-bg)', ink: 'var(--maybe)', mark: '?' },
  no: { bg: 'var(--no-bg)', ink: 'var(--no)', mark: '✕' },
  none: { bg: 'var(--surface-2)', ink: 'var(--ink-3)', mark: '·' },
}
const ATTEND: Record<string, string> = { present: '✓', absent: '✕', late: 'L', excused: 'E' }

/**
 * E-05: the squad down the side, the next few games and sessions across the
 * top, and in each cell what the family said. Tap a cell for the reason and
 * who gave it. The last sessions' register sits to the left, so "said yes,
 * did not come" is on the same screen. Coaches only — the function refuses
 * anyone else, and this draws what it returns.
 */
export function AvailabilityGrid({ teamId }: { teamId: string }) {
  const [grid, setGrid] = useState<Grid | null | undefined>(undefined)
  const [open, setOpen] = useState<{ player: GridPlayer; event: GridEvent; cell: Cell } | null>(null)

  useEffect(() => {
    let live = true
    ;(async () => {
      const { data, error } = await createClient().rpc('availability_grid', { p_team: teamId, p_upcoming: 4, p_past: 2 })
      if (live) setGrid(error ? null : (data as unknown as Grid))
    })()
    return () => {
      live = false
    }
  }, [teamId])

  if (!grid || grid.events.length === 0) return null
  const day = (iso: string) => new Date(iso).toLocaleDateString('en-AU', { timeZone: grid.timezone, day: 'numeric', month: 'short' })
  const when = (iso: string) => new Date(iso).toLocaleString('en-AU', { timeZone: grid.timezone, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

  return (
    <section className="mt-7" data-availability-grid>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-2">Who&apos;s available</h2>
      <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--line)' }}>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-[var(--surface)] px-2 py-1.5 text-left text-[11px] font-semibold text-ink-3">Player</th>
              {grid.events.map((e) => (
                <th key={e.id} className="px-1 py-1.5 text-center text-[11px] font-semibold" style={{ color: e.past ? 'var(--ink-3)' : 'var(--ink-2)' }} data-grid-event={e.id}>
                  <span className="block">{day(e.starts_at)}</span>
                  <span className="block font-normal text-ink-3">{e.type === 'match' ? (e.opponent ? `v ${e.opponent}` : 'match') : e.type}{e.past ? ' · register' : ''}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.players.map((p, i) => (
              <tr key={p.id} className={i > 0 ? 'border-t' : ''} style={{ borderColor: 'var(--line-2)' }} data-grid-player={p.id}>
                <td className="sticky left-0 z-10 max-w-[9rem] truncate bg-[var(--surface)] px-2 py-1">
                  {p.number != null && <span className="mr-1 text-xs tabular-nums text-ink-3">#{p.number}</span>}
                  {p.preferred_name || p.name.split(' ')[0]} <span className="text-ink-3">{p.name.split(' ').slice(1).join(' ')}</span>
                </td>
                {grid.events.map((e) => {
                  const c = p.cells[e.id] ?? { status: null, note: null, by: null, at: null, attendance: null }
                  const k = e.past ? (c.attendance ? (c.attendance === 'present' ? 'yes' : c.attendance === 'absent' ? 'no' : 'maybe') : 'none') : (c.status ?? 'none')
                  const mark = e.past ? (c.attendance ? ATTEND[c.attendance] : '·') : COLOUR[k].mark
                  const label = e.past ? (c.attendance ?? 'not marked') : (c.status === 'yes' ? 'Going' : c.status === 'no' ? `Can't play${c.note ? `: ${c.note}` : ''}` : c.status === 'maybe' ? 'Maybe' : 'No answer')
                  return (
                    <td key={e.id} className="px-1 py-1 text-center">
                      <button
                        onClick={() => setOpen({ player: p, event: e, cell: c })}
                        className="mx-auto grid h-7 w-7 place-items-center rounded-md text-xs font-bold"
                        style={{ background: COLOUR[k].bg, color: COLOUR[k].ink }}
                        aria-label={`${p.name}, ${day(e.starts_at)}: ${label}`}
                        data-cell={c.status ?? (e.past ? c.attendance ?? 'none' : 'none')}
                      >
                        {mark}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t" style={{ borderColor: 'var(--line)' }}>
              <td className="sticky left-0 z-10 bg-[var(--surface)] px-2 py-1 text-[11px] text-ink-3">Going · no answer</td>
              {grid.events.map((e) => (
                <td key={e.id} className="px-1 py-1 text-center text-[11px] tabular-nums text-ink-3">
                  {e.past ? '' : `${e.going} · ${e.no_reply}`}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="mt-1 text-[11px] text-ink-3">✓ going · ? maybe · ✕ can&apos;t play · no answer. Tap a cell for the reason. Past columns show the register.</p>

      {open && (
        <Sheet onClose={() => setOpen(null)}>
          <div className="p-4" data-cell-sheet>
            <span className="eyebrow">{open.player.name}</span>
            <h3 className="display text-lg leading-tight">{open.event.title}</h3>
            <p className="text-xs text-ink-3">{when(open.event.starts_at)}</p>
            {open.event.past ? (
              <p className="mt-3 text-sm">Register: <b>{open.cell.attendance ?? 'not marked'}</b>{open.cell.status ? ` · the family had said ${open.cell.status === 'yes' ? 'going' : open.cell.status === 'no' ? "can't play" : 'maybe'}` : ''}</p>
            ) : (
              <>
                <p className="mt-3 text-sm">
                  {open.cell.status === 'yes' ? 'Going' : open.cell.status === 'no' ? "Can't play" : open.cell.status === 'maybe' ? 'Maybe' : 'No answer yet'}
                  {open.cell.by && <span className="text-ink-3"> · {open.cell.by}{open.cell.at ? `, ${when(open.cell.at)}` : ''}</span>}
                </p>
                {open.cell.note && <p className="mt-1.5 rounded-lg p-2.5 text-sm" style={{ background: 'var(--surface-2)' }}>“{open.cell.note}”</p>}
                <a href={`/calendar/${open.event.id}`} className="mt-3 inline-block text-sm underline underline-offset-2" style={{ color: 'var(--brand-text)' }}>Open the event</a>
              </>
            )}
          </div>
        </Sheet>
      )}
    </section>
  )
}
