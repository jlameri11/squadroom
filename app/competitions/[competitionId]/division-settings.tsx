'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Rules = {
  division: string
  age_group: string | null
  scores_public: boolean
  ladder_enabled: boolean
  points_win: number
  points_draw: number
  points_loss: number
  tie_break: 'gd_then_gf' | 'gf_then_gd'
  match_length_mins: number | null
  squad_size_max: number | null
  grading_note: string | null
  /** L-17: minutes before kick-off the sheet locks. */
  sheet_lock_mins: number
  /** L-29: the pitch size this division plays on; null = the organiser's rule for its age group. */
  pitch_size?: string | null
  /** L-21: games on a sheet needed before a final; games a player may play up. */
  finals_min_games: number | null
  borrow_cap: number | null
  /** L-27: the date-of-birth band, enforced on the sheet; the league can exempt a player. */
  born_after: string | null
  born_before: string | null
}

const DEFAULTS = (division: string): Rules => ({
  division,
  age_group: null,
  scores_public: true,
  ladder_enabled: true,
  points_win: 3,
  points_draw: 1,
  points_loss: 0,
  tie_break: 'gd_then_gf',
  match_length_mins: null,
  squad_size_max: null,
  grading_note: null,
  sheet_lock_mins: 30,
  finals_min_games: null,
  borrow_cap: null,
  born_after: null,
  born_before: null,
})

/**
 * L-01: each division's rules, set by the organiser.
 *
 * One card per division. A division with no saved row shows the defaults
 * the product has always applied (3/1/0, GD then GF, scores and ladder
 * public), so nothing changes until somebody changes it. "Scores hidden"
 * is what a junior league means by no scores: the fixtures stay on the
 * public page, the result and the table come off it.
 */
export function DivisionSettings({
  competitionId,
  divisions,
}: {
  competitionId: string
  divisions: string[]
}) {
  const [rows, setRows] = useState<Record<string, Rules> | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [draft, setDraft] = useState<Rules | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data } = await createClient()
      .from('competition_divisions')
      .select('division, age_group, scores_public, ladder_enabled, points_win, points_draw, points_loss, tie_break, match_length_mins, squad_size_max, grading_note, sheet_lock_mins, finals_min_games, borrow_cap, born_after, born_before, pitch_size')
      .eq('competition_id', competitionId)
    const map: Record<string, Rules> = {}
    for (const r of (data ?? []) as Rules[]) map[r.division] = r
    setRows(map)
  }, [competitionId])

  useEffect(() => {
    ;(async () => {
      await load()
    })()
  }, [load])

  async function save() {
    if (!draft) return
    setBusy(true)
    setError(null)
    const { error } = await createClient()
      .from('competition_divisions')
      .upsert({ competition_id: competitionId, ...draft }, { onConflict: 'competition_id,division' })
    setBusy(false)
    if (error) return setError(error.message)
    setOpen(null)
    setDraft(null)
    await load()
  }

  if (!rows) return null

  return (
    <section className="mb-4">
      <h3 className="eyebrow px-1 pb-1.5">Division rules</h3>
      <ul className="card overflow-hidden">
        {divisions.map((d) => {
          const r = rows[d] ?? DEFAULTS(d)
          const editing = open === d && draft
          const summary = [
            `${r.points_win}/${r.points_draw}/${r.points_loss}`,
            r.scores_public ? 'scores public' : 'scores hidden',
            r.ladder_enabled && r.scores_public ? 'ladder' : 'no ladder',
            r.match_length_mins ? `${r.match_length_mins} min` : null,
            `sheets lock T-${r.sheet_lock_mins ?? 30}`,
            r.finals_min_games ? `finals need ${r.finals_min_games} games` : null,
            r.borrow_cap != null ? `play up ×${r.borrow_cap}` : null,
            r.born_after || r.born_before ? `born ${r.born_after?.slice(0, 4) ?? '…'}–${r.born_before?.slice(0, 4) ?? '…'}` : null,
          ]
            .filter(Boolean)
            .join(' · ')
          return (
            <li key={d} className="border-t px-3.5 py-3 text-sm first:border-t-0" style={{ borderColor: 'var(--line-2)' }}>
              {!editing ? (
                <div className="flex items-center gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{d}</span>
                    <span className="block truncate text-xs text-ink-3">
                      {summary}
                      {!rows[d] ? ' · defaults' : ''}
                    </span>
                  </span>
                  <button
                    onClick={() => {
                      setOpen(d)
                      setDraft({ ...r })
                    }}
                    className="flex-none rounded-lg px-2.5 py-1.5 text-xs font-semibold"
                    style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }}
                  >
                    Edit
                  </button>
                </div>
              ) : (
                <div>
                  <p className="font-medium">{d}</p>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {(['points_win', 'points_draw', 'points_loss'] as const).map((k, i) => (
                      <label key={k} className="text-xs">
                        <span className="text-ink-2">{['Win', 'Draw', 'Loss'][i]}</span>
                        <input
                          type="number"
                          min={0}
                          max={10}
                          value={draft[k]}
                          onChange={(e) => setDraft({ ...draft, [k]: Number(e.target.value) })}
                          className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-sm tabular-nums"
                          style={{ borderColor: 'var(--line)' }}
                        />
                      </label>
                    ))}
                  </div>
                  <label className="mt-2 block text-xs">
                    <span className="text-ink-2">Tie-break after points</span>
                    <select
                      value={draft.tie_break}
                      onChange={(e) => setDraft({ ...draft, tie_break: e.target.value as Rules['tie_break'] })}
                      className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-sm"
                      style={{ borderColor: 'var(--line)' }}
                    >
                      <option value="gd_then_gf">Goal difference, then goals for</option>
                      <option value="gf_then_gd">Goals for, then goal difference</option>
                    </select>
                  </label>
                  <label className="mt-2 flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={draft.scores_public} onChange={(e) => setDraft({ ...draft, scores_public: e.target.checked })} />
                    Scores on the public page
                  </label>
                  <label className="mt-1 flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={draft.ladder_enabled} onChange={(e) => setDraft({ ...draft, ladder_enabled: e.target.checked })} />
                    Ladder shown
                  </label>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <label className="text-xs">
                      <span className="text-ink-2">Match length (min)</span>
                      <input type="number" min={10} max={120} value={draft.match_length_mins ?? ''} onChange={(e) => setDraft({ ...draft, match_length_mins: e.target.value ? Number(e.target.value) : null })} className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-sm tabular-nums" style={{ borderColor: 'var(--line)' }} />
                    </label>
                    <label className="text-xs">
                      <span className="text-ink-2">Squad size (max)</span>
                      <input type="number" min={5} max={30} value={draft.squad_size_max ?? ''} onChange={(e) => setDraft({ ...draft, squad_size_max: e.target.value ? Number(e.target.value) : null })} className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-sm tabular-nums" style={{ borderColor: 'var(--line)' }} />
                    </label>
                  </div>
                  {/* L-17 and L-21: the match-day rules Squadi leagues expect. */}
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <label className="text-xs">
                      <span className="text-ink-2">Sheet locks (min before)</span>
                      <input type="number" min={0} max={180} value={draft.sheet_lock_mins ?? 30} onChange={(e) => setDraft({ ...draft, sheet_lock_mins: Number(e.target.value) })} className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-sm tabular-nums" style={{ borderColor: 'var(--line)' }} />
                    </label>
                    <label className="text-xs">
                      <span className="text-ink-2">Finals need (games)</span>
                      <input type="number" min={1} max={50} value={draft.finals_min_games ?? ''} onChange={(e) => setDraft({ ...draft, finals_min_games: e.target.value ? Number(e.target.value) : null })} className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-sm tabular-nums" style={{ borderColor: 'var(--line)' }} />
                    </label>
                    <label className="text-xs">
                      <span className="text-ink-2">Play up (max games)</span>
                      <input type="number" min={0} max={50} value={draft.borrow_cap ?? ''} onChange={(e) => setDraft({ ...draft, borrow_cap: e.target.value ? Number(e.target.value) : null })} className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-sm tabular-nums" style={{ borderColor: 'var(--line)' }} />
                    </label>
                  </div>
                  <p className="mt-1 text-[0.6875rem] text-ink-3">After the lock only the referee or the league changes a sheet. Leave finals and play-up blank for no rule.</p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <label className="text-xs">
                      <span className="text-ink-2">Born on or after</span>
                      <input type="date" value={draft.born_after ?? ''} onChange={(e) => setDraft({ ...draft, born_after: e.target.value || null })} className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: 'var(--line)' }} />
                    </label>
                    <label className="text-xs">
                      <span className="text-ink-2">Born on or before</span>
                      <input type="date" value={draft.born_before ?? ''} onChange={(e) => setDraft({ ...draft, born_before: e.target.value || null })} className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: 'var(--line)' }} />
                    </label>
                  </div>
                  <p className="mt-1 text-[0.6875rem] text-ink-3">A player outside the band is refused on the sheet by name; the league can exempt one from Nominations.</p>
                  <label className="mt-2 block text-xs">
                    <span className="text-ink-2">Pitch size</span>
                    <select value={draft.pitch_size ?? ''} onChange={(e) => setDraft({ ...draft, pitch_size: e.target.value || null })} className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: 'var(--line)' }} data-pitch-size>
                      <option value="">By age group (the league&apos;s rules in Venues)</option>
                      <option value="full">Full pitch</option>
                      <option value="half">Half</option>
                      <option value="third">Third</option>
                      <option value="quarter">Quarter</option>
                    </select>
                  </label>
                  <label className="mt-2 block text-xs">
                    <span className="text-ink-2">Age group / grading note</span>
                    <input value={draft.grading_note ?? ''} onChange={(e) => setDraft({ ...draft, grading_note: e.target.value || null })} placeholder="e.g. U10, graded after round 3" className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: 'var(--line)' }} />
                  </label>
                  {error && <p className="mt-2 text-xs" style={{ color: 'var(--no)' }}>{error}</p>}
                  <div className="mt-2 flex gap-2">
                    <button onClick={save} disabled={busy} className="flex-1 rounded-lg px-3 py-2 text-xs font-semibold text-brand-ink disabled:opacity-50" style={{ background: 'var(--brand)' }}>
                      {busy ? 'Saving…' : 'Save'}
                    </button>
                    <button onClick={() => { setOpen(null); setDraft(null); setError(null) }} className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'var(--line)' }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
