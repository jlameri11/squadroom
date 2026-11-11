'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const SUGGESTED = ['Oranges', 'Linesperson', 'Kit wash', 'Canteen helper', 'Ground set-up']

/**
 * The squad's duty roster (Big Club Mode item 10; 0252): the duties a
 * family takes in turn — oranges, linesperson, kit wash — and one tap to
 * roster the next games fairly: the family with the fewest turns first,
 * the longest ago first, never twice in one game. Families see their turn
 * on the game page and are reminded the evening before.
 */
export function DutiesPanel({ teamId }: { teamId: string }) {
  const [titles, setTitles] = useState<string[] | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ games: number; assigned: number } | null>(null)

  const load = useCallback(async () => {
    const { data } = await createClient().from('team_duties').select('title, position').eq('team_id', teamId).order('position')
    setTitles((data ?? []).map((d) => d.title))
  }, [teamId])
  useEffect(() => {
    void load()
  }, [load])

  if (titles === null) return null

  async function save(next: string[]) {
    setBusy('save')
    setError(null)
    const { data, error } = await createClient().rpc('set_team_duties', { p_team: teamId, p_titles: next })
    setBusy(null)
    if (error) return setError(error.message)
    setTitles((data as unknown as string[] | null) ?? next)
    setDone(null)
  }
  async function roster() {
    setBusy('roster')
    setError(null)
    const { data, error } = await createClient().rpc('roster_team_duties', { p_team: teamId, p_games: 10 })
    setBusy(null)
    if (error) return setError(error.message)
    setDone(data as unknown as { games: number; assigned: number })
  }

  const chip = 'rounded-full border px-3 py-1.5 text-xs font-semibold'
  return (
    <section className="mt-4 rounded-xl border border-[var(--line)] p-4" data-duties-panel={titles.length}>
      <h2 className="font-semibold">Duties</h2>
      <p className="mt-1 text-sm text-ink-2">What a family does in turn on game day. Roster the next ten games and each family sees its turn on the game page; a family that can&apos;t make it asks the squad for a swap.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {titles.map((t) => (
          <button key={t} onClick={() => save(titles.filter((x) => x !== t))} disabled={busy !== null} className={chip} style={{ borderColor: 'var(--line)' }} aria-label={`Remove ${t}`} data-duty-title={t}>
            {t} ×
          </button>
        ))}
        {SUGGESTED.filter((s) => !titles.some((t) => t.toLowerCase() === s.toLowerCase())).map((s) => (
          <button key={s} onClick={() => save([...titles, s])} disabled={busy !== null} className={chip} style={{ borderColor: 'var(--line)', color: 'var(--brand-text)' }} data-duty-suggest={s}>
            + {s}
          </button>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (draft.trim()) void save([...titles, draft.trim()])
          setDraft('')
        }}
        className="mt-2 flex gap-2"
      >
        <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={40} placeholder="Another duty" className="min-w-0 flex-1 rounded-lg border px-2.5 py-1.5 text-sm" style={{ borderColor: 'var(--line)' }} aria-label="Another duty" />
        <button type="submit" disabled={busy !== null || !draft.trim()} className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-50" style={{ borderColor: 'var(--line)' }}>Add</button>
      </form>
      {titles.length > 0 && (
        <button onClick={roster} disabled={busy !== null} className="mt-3 w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-brand-ink disabled:opacity-50" style={{ background: 'var(--brand)' }} data-roster-duties>
          {busy === 'roster' ? 'Rostering…' : 'Roster the next 10 games'}
        </button>
      )}
      {done && (
        <p className="mt-2 text-sm" style={{ color: 'var(--yes)' }} data-rostered>
          {done.assigned} {done.assigned === 1 ? 'duty' : 'duties'} across {done.games} {done.games === 1 ? 'game' : 'games'}{done.assigned === 0 && done.games > 0 ? ' — every game was already rostered, or the squad has no players yet' : ''}.
        </p>
      )}
      {error && <p className="mt-2 text-sm" style={{ color: 'var(--no)' }}>{error}</p>}
    </section>
  )
}
