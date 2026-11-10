'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { WhenOn } from '@/components/when-on'

type Slot = { series_id: string; title: string; team_id: string | null; team: string | null; days: number[]; at_time: string; duration_mins: number; starts_on: string; ends_on: string }
type Pitch = { id: string; name: string; size: string; parent_id: string | null; hours: { weekday: number; opens: string; closes: string }[]; slots: Slot[] }
type Week = { venue: { id: string; name: string }; pitches: Pitch[] }
type Closed = { sessions: number; titles: string[]; games: number; could_not: { competition: string; why: string }[]; ask_the_league: { competition: string; organiser: string; games: number }[] }

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function clock(t: string) {
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
}

/**
 * A ground's week (Big Club Mode item 8; 0250): which squad trains on
 * which pitch when — the slots every weekly series on this ground holds,
 * a list per pitch. And "Close ground": one date, one reason, every session here
 * called off and every family told through the cancellation trigger; games
 * in competitions the club runs postponed; games another league holds
 * here named for the club to tell them.
 */
export function GroundWeek({ venueId, academyId, canEdit }: { venueId: string; academyId: string; canEdit: boolean }) {
  const [week, setWeek] = useState<Week | null | undefined>(undefined)
  const [closing, setClosing] = useState(false)
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [reason, setReason] = useState('wet_weather')
  const [note, setNote] = useState('')
  const [result, setResult] = useState<Closed | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data } = await createClient().rpc('ground_slots', { p_venue: venueId })
    setWeek((data as unknown as Week | null) ?? null)
  }, [venueId])
  useEffect(() => {
    void load()
  }, [load])

  async function closeGround() {
    setBusy(true)
    setError(null)
    const { data, error } = await createClient().rpc('close_ground', {
      p_academy: academyId,
      p_venue: venueId,
      p_date: date,
      p_reason: reason,
      p_note: (note.trim() || null) as unknown as string,
    })
    setBusy(false)
    if (error) return setError(error.message)
    setResult(data as unknown as Closed)
    setClosing(false)
  }

  if (!week) return null
  const slotCount = week.pitches.reduce((n, p) => n + p.slots.length, 0)
  const line = { borderColor: 'var(--line)' }

  return (
    <>
      <WhenOn feature="training_slots">
        <section className="card mb-3 p-3.5" data-ground-slots={slotCount}>
          <div className="sect">
            <span className="eyebrow">The week on {week.venue.name}</span>
            <span className="text-xs text-ink-3">{slotCount} {slotCount === 1 ? 'slot' : 'slots'}</span>
          </div>
          {week.pitches.length === 0 ? (
            <p className="mt-2 text-sm text-ink-2">Draw a pitch below first.</p>
          ) : slotCount === 0 ? (
            <p className="mt-2 text-sm text-ink-2">No weekly training on this ground yet. Add training from Fixtures and pick a pitch.</p>
          ) : (
            <>
              {/* A list per pitch, at every width: the admin shell is a phone's
                  width on a laptop too, and seven columns in it only scroll. */}
              <ul className="mt-2 flex flex-col gap-2">
                {week.pitches.map((p) => (
                  <li key={p.id} className="text-sm">
                    <span className="font-semibold">{p.name}</span>
                    {p.size !== 'full' && <span className="text-xs text-ink-3"> · {p.size}</span>}
                    {p.slots.length === 0 ? (
                      <span className="block text-xs text-ink-3">free</span>
                    ) : (
                      <span className="mt-1 flex flex-wrap gap-1.5">
                        {p.slots.map((s) => (
                          <span key={s.series_id} className="pill" style={{ background: 'var(--surface-2)', color: 'var(--ink)' }} data-slot-chip>
                            {s.days.map((d) => DAYS[d]).join('/')} {clock(s.at_time)} · {s.team ?? s.title}
                          </span>
                        ))}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </WhenOn>

      {canEdit && (
        <section className="card mb-3 p-3.5" data-close-ground>
          <div className="sect">
            <span className="eyebrow">Close ground</span>
            {!closing && (
              <button onClick={() => { setClosing(true); setResult(null) }} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold" style={{ background: 'var(--no-bg)', color: 'var(--no)' }} data-close-ground-open>
                Close for a day
              </button>
            )}
          </div>
          {closing && (
            <div className="mt-2 text-sm" data-close-ground-form>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-ink-2">
                  Which day
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-0.5 w-full rounded-lg border p-2 text-sm" style={line} data-close-date />
                </label>
                <label className="text-xs text-ink-2">
                  Why
                  <select value={reason} onChange={(e) => setReason(e.target.value)} className="mt-0.5 w-full rounded-lg border p-2 text-sm" style={line} data-close-reason>
                    <option value="wet_weather">Wet weather</option>
                    <option value="ground_closed">Ground closed</option>
                    <option value="other">Other</option>
                  </select>
                </label>
              </div>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="A note for families (optional)" className="mt-2 w-full rounded-lg border p-2 text-sm" style={line} aria-label="A note for families" />
              <p className="mt-2 text-xs text-ink-3">
                Every session here that day is called off and every family told at once — by text as well inside 24 hours. Games in competitions you run are postponed; a league&apos;s games here are named for you to tell them.
              </p>
              <div className="mt-2 flex gap-2">
                <button onClick={closeGround} disabled={busy} className="flex-1 rounded-xl px-4 py-2.5 font-semibold disabled:opacity-50" style={{ background: 'var(--no)', color: 'var(--no-ink)' }} data-close-ground-go>
                  {busy ? 'Closing…' : `Close ${week.venue.name} that day`}
                </button>
                <button onClick={() => setClosing(false)} className="rounded-xl border px-4 py-2.5 text-sm" style={line}>Not now</button>
              </div>
              {error && <p className="mt-2 text-sm" style={{ color: 'var(--no)' }}>{error}</p>}
            </div>
          )}
          {result && (
            <div className="mt-2 rounded-lg p-3 text-sm" style={{ background: 'var(--surface-2)' }} data-close-ground-result>
              <p>
                <b>{result.sessions}</b> {result.sessions === 1 ? 'session' : 'sessions'} called off{result.titles.length ? `: ${result.titles.join(', ')}` : ''}.
                {result.games > 0 && ` ${result.games} ${result.games === 1 ? 'game' : 'games'} postponed.`}
              </p>
              {result.ask_the_league.length > 0 && (
                <ul className="mt-1 text-xs text-ink-2">
                  {result.ask_the_league.map((a, i) => (
                    <li key={i}>{a.games} {a.games === 1 ? 'game' : 'games'} in {a.competition} {a.games === 1 ? 'is' : 'are'} {a.organiser}&apos;s to call off — tell them.</li>
                  ))}
                </ul>
              )}
              {result.could_not.length > 0 && (
                <ul className="mt-1 text-xs" style={{ color: 'var(--no)' }}>
                  {result.could_not.map((c, i) => <li key={i}>{c.competition}: {c.why}</li>)}
                </ul>
              )}
            </div>
          )}
          {!closing && !result && <p className="mt-1 text-xs text-ink-3">Wet weather, a closed ground: one tap for the whole day here.</p>}
        </section>
      )}
    </>
  )
}
