'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

type Last = { event_id: string; starts_at: string; opponent: string | null; was_home: boolean | null; ours: number; theirs: number; outcome: 'won' | 'drew' | 'lost' }
type Form = { team: { id: string; name: string }; last: Last[]; season: { played: number; won: number; drawn: number; lost: number; gf: number; ga: number } }

const TINT = { won: 'var(--yes)', drew: 'var(--maybe)', lost: 'var(--no)' } as const
const LETTER = { won: 'W', drew: 'D', lost: 'L' } as const

/**
 * F-05: the squad's form. The last five results as letters a parent reads
 * at a glance, the season's totals under them, each one a link to the
 * game. Results come from the coach (set_event_result), our own sheets, or
 * a league's results export (apply_imported_results) — the strip does not
 * care which.
 */
export function FormStrip({ teamId }: { teamId: string }) {
  const [form, setForm] = useState<Form | null | undefined>(undefined)
  useEffect(() => {
    let live = true
    ;(async () => {
      const { data, error } = await createClient().rpc('team_form', { p_team: teamId, p_n: 5 })
      if (live) setForm(error ? null : (data as unknown as Form))
    })()
    return () => {
      live = false
    }
  }, [teamId])

  if (!form || form.last.length === 0) return null
  const s = form.season
  return (
    <section className="mt-6" data-form-strip>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-2">Form</h2>
      <div className="rounded-xl border p-3" style={{ borderColor: 'var(--line)' }}>
        <div className="flex items-center gap-1.5">
          {[...form.last].reverse().map((r) => (
            <Link
              key={r.event_id}
              href={`/calendar/${r.event_id}`}
              className="grid h-8 w-8 place-items-center rounded-lg text-sm font-bold text-white"
              style={{ background: TINT[r.outcome] }}
              title={`${r.ours}–${r.theirs} v ${r.opponent ?? '?'}`}
              aria-label={`${LETTER[r.outcome]}: ${r.ours} ${r.theirs} against ${r.opponent ?? 'unknown'}`}
              data-result={r.outcome}
            >
              {LETTER[r.outcome]}
            </Link>
          ))}
          <span className="ml-auto text-xs tabular-nums text-ink-2">
            P{s.played} W{s.won} D{s.drawn} L{s.lost} · {s.gf}–{s.ga}
          </span>
        </div>
        <p className="mt-1.5 truncate text-xs text-ink-3">
          Last: {form.last[0].ours}–{form.last[0].theirs} v {form.last[0].opponent ?? '?'}
          {form.last[0].was_home === true ? ' (home)' : form.last[0].was_home === false ? ' (away)' : ''}
        </p>
      </div>
    </section>
  )
}
