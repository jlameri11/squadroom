'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Row = {
  player_id: string
  player_name: string
  sessions: number
  present: number
  late: number
  absent: number
  excused: number
  unmarked: number
  rate: number | null
}

/**
 * The squad's attendance over the last term.
 *
 * This is what the register is FOR. A coach takes it seventeen times a term
 * and gets nothing back unless something adds it up — and "fourteen of
 * sixteen" is the sentence they say at a parent evening, and the one a parent
 * wants before they re-register.
 *
 * Sorted worst first, deliberately. A list sorted by name is a list nobody
 * reads twice; the only reason to open this is to find the two children who
 * have stopped coming, and they should be at the top.
 *
 * Fetched on expand, not on load. Most visits to a squad page are about the
 * join code or the roster.
 */
export function AttendancePanel({ academyId, teamId }: { academyId: string; teamId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || rows) return
    ;(async () => {
      const { data, error } = await createClient().rpc('attendance_summary', {
        p_academy: academyId,
        p_team: teamId,
      })
      if (error) return setError(error.message)
      setRows((data ?? []) as Row[])
    })()
  }, [open, rows, academyId, teamId])

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-7 w-full rounded-xl border px-4 py-3 text-left text-sm font-semibold"
        style={{ borderColor: 'var(--line)', color: 'var(--brand)' }}
      >
        Attendance this term
      </button>
    )
  }

  const marked = (rows ?? []).filter((r) => r.rate !== null)
  const average =
    marked.length > 0
      ? Math.round(marked.reduce((s, r) => s + Number(r.rate), 0) / marked.length)
      : null

  // Worst first: the reason to open this is to find who has stopped coming.
  const sorted = (rows ?? [])
    .slice()
    .sort((a, b) => (a.rate ?? 101) - (b.rate ?? 101))

  return (
    <section className="mt-7">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-2">
          Attendance this term
        </h2>
        {average !== null && (
          <span className="text-xs text-ink-3">{average}% across the squad</span>
        )}
      </div>

      {error && (
        <p
          className="rounded-lg px-3 py-2 text-sm"
          style={{ background: 'var(--no-bg)', color: 'var(--no)' }}
        >
          {error}
        </p>
      )}

      {rows === null ? (
        <p className="rounded-xl border border-[var(--line)] p-5 text-center text-sm text-ink-3">
          Adding it up…
        </p>
      ) : marked.length === 0 ? (
        <p className="rounded-xl border border-[var(--line)] p-5 text-center text-sm text-ink-2">
          No registers taken yet. Open a session that has started and take one.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--line)]">
          {sorted.map((r, i) => (
            <div
              key={r.player_id}
              className={`flex items-center gap-3 p-3 ${i > 0 ? 'border-t border-[var(--line-2)]' : ''}`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{r.player_name}</span>
                <span className="block text-sm text-ink-3">
                  {r.present + r.late} of {r.sessions}
                  {r.late > 0 && ` · ${r.late} late`}
                  {r.excused > 0 && ` · ${r.excused} excused`}
                  {r.unmarked > 0 && ` · ${r.unmarked} not marked`}
                </span>
              </span>
              {r.rate === null ? (
                <span className="flex-none text-sm text-ink-3">—</span>
              ) : (
                <span
                  className="flex-none rounded-lg px-2 py-1 text-sm font-bold tabular-nums"
                  style={tone(Number(r.rate))}
                >
                  {r.rate}%
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Said plainly, because a parent will ask and a coach needs the answer
          ready. */}
      <p className="mt-2 text-xs text-ink-3">
        Sessions that were called off are not counted, and arriving late counts as turning up.
      </p>
    </section>
  )
}

/**
 * Colour by how worried to be.
 *
 * Three bands rather than a gradient: a coach is deciding whether to ring a
 * family, and that is a yes/no, not a shade.
 */
function tone(rate: number) {
  if (rate >= 85) return { background: 'var(--yes-bg)', color: 'var(--yes)' }
  if (rate >= 70) return { background: 'var(--maybe-bg)', color: 'var(--maybe)' }
  return { background: 'var(--no-bg)', color: 'var(--no)' }
}
