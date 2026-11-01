'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export type Marks = { players: number; coaches: number; spectators: number; note: string }
const ROWS: [keyof Omit<Marks, 'note'>, string][] = [['players', 'Players'], ['coaches', 'Coaches'], ['spectators', 'Spectators']]

/** Three rows of 1–5, used by the opposition on the match page and the referee in their report. */
export function MarksPicker({ value, onChange, compact = false }: { value: Marks; onChange: (m: Marks) => void; compact?: boolean }) {
  return (
    <div className="grid gap-1.5">
      {ROWS.map(([k, label]) => (
        <div key={k} className="flex items-center gap-2 text-xs">
          <span className="w-20 flex-none text-ink-2">{label}</span>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => onChange({ ...value, [k]: n })}
                aria-label={`${label}: ${n} of 5`}
                className={`${compact ? 'h-7 w-7' : 'h-8 w-8'} rounded-lg text-sm font-semibold`}
                style={value[k] === n ? { background: n <= 2 ? 'var(--no)' : n === 3 ? 'var(--maybe)' : 'var(--yes)', color: '#fff' } : { background: 'var(--surface-2)', color: 'var(--ink-2)' }}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      ))}
      <input value={value.note} onChange={(e) => onChange({ ...value, note: e.target.value })} placeholder="Anything the league should know (optional)" className="w-full rounded-lg border px-2 py-1.5 text-xs" style={{ borderColor: 'var(--line)' }} />
    </div>
  )
}

/**
 * W-01: the opposition's panel on the match page once the game is final.
 * Marks the OTHER team, never your own; a mark can be changed on the day.
 */
export function RespectPanel({ fixtureId, aboutEntryId, aboutName }: { fixtureId: string; aboutEntryId: string; aboutName: string }) {
  const [marks, setMarks] = useState<Marks>({ players: 4, coaches: 4, spectators: 4, note: '' })
  const [given, setGiven] = useState(false)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data } = await createClient().rpc('my_respect_marks', { p_fixture: fixtureId })
    const mine = ((data as unknown as (Marks & { about_entry_id: string })[]) ?? []).find((m) => m.about_entry_id === aboutEntryId)
    if (mine) {
      setMarks({ players: mine.players, coaches: mine.coaches, spectators: mine.spectators, note: mine.note ?? '' })
      setGiven(true)
    }
  }, [fixtureId, aboutEntryId])

  useEffect(() => {
    ;(async () => {
      await load()
    })()
  }, [load])

  async function send() {
    setBusy(true)
    setError(null)
    const { error } = await createClient().rpc('give_respect_marks', { p_fixture: fixtureId, p_about_entry: aboutEntryId, p_players: marks.players, p_coaches: marks.coaches, p_spectators: marks.spectators, p_note: marks.note || undefined })
    setBusy(false)
    if (error) return setError(error.message)
    setGiven(true)
    setOpen(false)
  }

  return (
    <section className="card mt-4 p-3.5">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 text-sm">
          <b>How were {aboutName} today?</b>
          <span className="block text-xs text-ink-3">{given ? `Marked ${marks.players}/${marks.coaches}/${marks.spectators}. Only the league sees it.` : 'Players, coaches, spectators — 1 to 5. Only the league sees it; nothing is public.'}</span>
        </span>
        {!open && (
          <button onClick={() => setOpen(true)} className="flex-none rounded-xl px-3.5 py-2 text-sm font-semibold" style={{ background: given ? 'var(--surface-2)' : 'var(--brand)', color: given ? 'var(--ink-2)' : '#fff' }}>
            {given ? 'Change' : 'Mark'}
          </button>
        )}
      </div>
      {open && (
        <div className="mt-3">
          <MarksPicker value={marks} onChange={setMarks} />
          {error && <p className="mt-1.5 text-xs" style={{ color: 'var(--no)' }}>{error}</p>}
          <div className="mt-2 flex gap-2">
            <button onClick={send} disabled={busy} className="flex-1 rounded-lg px-3 py-2 text-xs font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand)' }}>Send to the league</button>
            <button onClick={() => setOpen(false)} className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'var(--line)' }}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  )
}

/** W-01: the league's table (every team) or a club's own rows. */
export function RespectDashboard({ competitionId, isOrganiser }: { competitionId: string; isOrganiser: boolean }) {
  const [rows, setRows] = useState<{ entry_id: string; team: string; division: string; club: string | null; marks: number; players: number | null; coaches: number | null; spectators: number | null; overall: number | null; low: number; notes: { note: string; role: string; at: string }[] }[] | null>(null)
  const [openNotes, setOpenNotes] = useState<string | null>(null)
  useEffect(() => {
    ;(async () => {
      const { data } = await createClient().rpc('respect_dashboard', { p_competition: competitionId })
      setRows((data as unknown as typeof rows) ?? [])
    })()
  }, [competitionId])
  if (!rows || rows.length === 0) return null
  const marked = rows.filter((r) => r.marks > 0)
  return (
    <section className="mt-5">
      <h3 className="eyebrow px-1 pb-1.5">Respect marks</h3>
      <p className="mb-2 px-1 text-xs text-ink-3">
        Given by the other team&apos;s manager and the referee after each game, 1 to 5. {isOrganiser ? 'Every team; lowest first. Never public.' : 'Your teams only. Never public.'}
      </p>
      {marked.length === 0 ? (
        <p className="card p-4 text-center text-sm text-ink-3">No marks yet.</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-ink-3">
                <th className="px-3 py-2 font-normal">Team</th>
                <th className="px-2 py-2 text-right font-normal">Marks</th>
                <th className="px-2 py-2 text-right font-normal">Players</th>
                <th className="px-2 py-2 text-right font-normal">Coaches</th>
                <th className="px-2 py-2 text-right font-normal">Crowd</th>
                <th className="px-3 py-2 text-right font-normal">Overall</th>
              </tr>
            </thead>
            <tbody>
              {marked.map((r) => (
                <tr key={r.entry_id} className="border-t" style={{ borderColor: 'var(--line-2)' }}>
                  <td className="px-3 py-1.5">
                    <span className="block">{r.team}</span>
                    <span className="block text-ink-3">{r.division}{r.low > 0 ? ` · ${r.low} low` : ''}{isOrganiser && r.notes.length > 0 ? <button onClick={() => setOpenNotes(openNotes === r.entry_id ? null : r.entry_id)} className="ml-1 underline underline-offset-2">{r.notes.length} note{r.notes.length === 1 ? '' : 's'}</button> : null}</span>
                    {openNotes === r.entry_id && (
                      <ul className="mt-1 space-y-0.5 text-ink-2">
                        {r.notes.map((n, i) => <li key={i}>“{n.note}” <span className="text-ink-3">— {n.role}</span></li>)}
                      </ul>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.marks}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.players}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.coaches}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.spectators}</td>
                  <td className="px-3 py-1.5 text-right font-semibold tabular-nums" style={{ color: (r.overall ?? 5) <= 2.5 ? 'var(--no)' : (r.overall ?? 5) < 3.5 ? 'var(--maybe)' : 'var(--yes)' }}>{r.overall}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
