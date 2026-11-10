'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { WhenOn } from '@/components/when-on'

type Slot = {
  series_id: string
  title: string
  days: number[]
  at_time: string
  duration_mins: number
  venue: string | null
  venue_id: string | null
  pitch_id: string | null
  pitch: string | null
  ground: string | null
  starts_on: string
  ends_on: string
}
type Pitch = { id: string; name: string; size: string; parent_id: string | null; venues: { name: string } | { name: string }[] | null }

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** "5:00 pm" from a Postgres time. */
function clock(t: string) {
  const [h, m] = t.split(':').map(Number)
  const am = h < 12
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${am ? 'am' : 'pm'}`
}

/**
 * The squad's weekly training, with its pitch (Big Club Mode item 8; 0250).
 *
 * Read from the series, so it is the same line the calendar and the
 * "Publish teams" message carry. A coach puts the series on a pitch here;
 * a clash or closed hours come back as the database's own words and
 * nothing changes.
 */
export function TrainingSlot({ teamId, academyId }: { teamId: string; academyId: string }) {
  const [slots, setSlots] = useState<Slot[] | null>(null)
  const [pitches, setPitches] = useState<Pitch[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const supabase = createClient()
    const [{ data: s }, { data: p }] = await Promise.all([
      supabase.rpc('team_training', { p_team: teamId }),
      supabase.from('pitches').select('id, name, size, parent_id, venues(name)').eq('academy_id', academyId).order('name'),
    ])
    setSlots((s as unknown as Slot[] | null) ?? [])
    setPitches((p ?? []) as unknown as Pitch[])
  }, [teamId, academyId])
  useEffect(() => {
    void load()
  }, [load])

  async function setPitch(seriesId: string, pitchId: string) {
    setBusy(seriesId)
    setError(null)
    const { error } = await createClient().rpc('set_training_slot', { p_series: seriesId, p_pitch: (pitchId || null) as unknown as string })
    setBusy(null)
    if (error) return setError(error.message)
    await load()
  }

  if (slots === null) return null
  const venueOf = (p: Pitch) => (Array.isArray(p.venues) ? p.venues[0]?.name : p.venues?.name) ?? ''
  const grounds = [...new Set(pitches.map(venueOf))].sort()

  return (
    <section className="mt-4 rounded-xl border border-[var(--line)] p-4" data-training-slot={slots.length}>
      <h2 className="font-semibold">Training</h2>
      {slots.length === 0 ? (
        <p className="mt-1 text-sm text-ink-2">No weekly training set. Add it from Fixtures → Add training.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {slots.map((s) => (
            <li key={s.series_id} className="text-sm" data-slot={s.series_id}>
              <span className="block">
                <b>{s.days.map((d) => DAYS[d]).join('/')}</b> {clock(s.at_time)} · {s.duration_mins} min
                {s.venue ? ` · ${s.venue}` : ''}
              </span>
              <WhenOn feature="training_slots">
                {pitches.length > 0 && (
                  <label className="mt-1 flex items-center gap-2 text-xs text-ink-2">
                    Pitch
                    <select
                      value={s.pitch_id ?? ''}
                      onChange={(e) => setPitch(s.series_id, e.target.value)}
                      disabled={busy !== null}
                      className="min-w-0 flex-1 rounded-lg border px-2 py-1.5 text-sm"
                      style={{ borderColor: 'var(--line)' }}
                      aria-label={`Pitch for ${s.title}`}
                      data-slot-pitch
                    >
                      <option value="">— typed ground only —</option>
                      {grounds.map((g) => (
                        <optgroup key={g} label={g}>
                          {pitches.filter((p) => venueOf(p) === g).map((p) => (
                            <option key={p.id} value={p.id}>{p.name}{p.size !== 'full' ? ` (${p.size})` : ''}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                )}
              </WhenOn>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-2 text-sm" style={{ color: 'var(--no)' }} data-slot-error>{error}</p>}
    </section>
  )
}
