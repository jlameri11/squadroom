'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { placeParts, zonedToUtc } from '@/lib/time'

/**
 * Change the time or the place of this one session (E-01b).
 *
 * "Training is at 5:30 this Thursday, not 5" is the most common change a
 * coach makes, and until now it meant calling the session off and making a
 * new one. A series is real rows (0090), so one occurrence is one row: this
 * changes that row and nothing else — next Thursday is still at 5.
 *
 * Everyone in the squad is told, by the change alert that already exists
 * (0064: "Changed: … Now Thursday 5:30 pm at Christie Park"). The times are
 * the venue's (lib/time.ts), whatever the coach's phone says. Moving the
 * start moves the finish and the arrive-by with it unless the coach changes
 * those too.
 *
 * A game in a competition is the league's to move, so it is not offered.
 */
export function EditOccurrence({
  event,
  tz,
}: {
  event: {
    id: string
    type: string
    starts_at: string
    ends_at: string | null
    arrive_at: string | null
    venue: string | null
    address: string | null
    series_id: string | null
    fixture_id: string | null
    cancelled_at: string | null
  }
  tz: string
}) {
  const start0 = placeParts(event.starts_at, tz)
  const end0 = event.ends_at ? placeParts(event.ends_at, tz).time : ''
  const arrive0 = event.arrive_at ? placeParts(event.arrive_at, tz).time : ''
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(start0.date)
  const [start, setStart] = useState(start0.time)
  const [end, setEnd] = useState(end0)
  const [arrive, setArrive] = useState(arrive0)
  const [touched, setTouched] = useState({ end: false, arrive: false })
  const [venue, setVenue] = useState(event.venue ?? '')
  const [address, setAddress] = useState(event.address ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (event.cancelled_at) return null
  if (event.fixture_id) {
    return (
      <p className="mt-5 text-xs text-ink-3" data-league-sets-time>
        The league sets this game&apos;s time and ground; a change comes through the competition.
      </p>
    )
  }

  const noun = event.type === 'training' ? 'session' : event.type === 'match' || event.type === 'tournament' ? 'game' : 'event'

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!date || !start) return setError('A date and a start time, please.')
    const newStart = zonedToUtc(date, start, tz)
    const shift = newStart.getTime() - new Date(event.starts_at).getTime()
    // The finish and the arrive-by keep their distance from the start unless
    // the coach set them.
    const newEnd = touched.end
      ? end ? zonedToUtc(date, end, tz) : null
      : event.ends_at ? new Date(new Date(event.ends_at).getTime() + shift) : null
    const newArrive = touched.arrive
      ? arrive ? zonedToUtc(date, arrive, tz) : null
      : event.arrive_at ? new Date(new Date(event.arrive_at).getTime() + shift) : null
    if (newEnd && newEnd <= newStart) return setError('It has to finish after it starts.')
    if (newArrive && newArrive > newStart) return setError('Arrive-by has to be before the start.')
    setBusy(true)
    const { data, error } = await createClient()
      .from('events')
      .update({
        starts_at: newStart.toISOString(),
        ends_at: newEnd ? newEnd.toISOString() : null,
        arrive_at: newArrive ? newArrive.toISOString() : null,
        venue: venue.trim() || null,
        address: address.trim() || null,
      })
      .eq('id', event.id)
      .select('id')
    setBusy(false)
    if (error) return setError(error.message)
    if (!data?.length) return setError(`Only the squad's coaches and the club's admins can change this ${noun}.`)
    window.location.reload()
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-5 w-full rounded-xl border px-4 py-3 text-sm font-semibold"
        style={{ borderColor: 'var(--line)' }}
        data-edit-occurrence
      >
        Change time or place
      </button>
    )
  }

  const field = 'mt-0.5 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] p-2'
  return (
    <form onSubmit={save} className="mt-5 rounded-xl border border-[var(--line)] p-4" data-edit-form>
      <h2 className="font-semibold">Change this {noun}</h2>
      <p className="mt-1 text-sm text-ink-2">
        {event.series_id ? `Only this one changes — the rest of the series stays as it is. ` : ''}
        Everyone in the squad is told what changed.
      </p>

      <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(min(100%,8.5rem),1fr))] gap-2">
        <label className="block text-sm">
          <span className="text-ink-2">Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={field} data-field="date" />
        </label>
        <label className="block text-sm">
          <span className="text-ink-2">Starts</span>
          <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className={field} data-field="start" />
        </label>
        <label className="block text-sm">
          <span className="text-ink-2">Finishes</span>
          <input type="time" value={end} onChange={(e) => { setEnd(e.target.value); setTouched((t) => ({ ...t, end: true })) }} className={field} data-field="end" />
        </label>
        <label className="block text-sm">
          <span className="text-ink-2">Arrive by</span>
          <input type="time" value={arrive} onChange={(e) => { setArrive(e.target.value); setTouched((t) => ({ ...t, arrive: true })) }} className={field} data-field="arrive" />
        </label>
      </div>
      <label className="mt-2 block text-sm">
        <span className="text-ink-2">Where</span>
        <input value={venue} onChange={(e) => setVenue(e.target.value)} className={field} data-field="venue" />
      </label>
      <label className="mt-2 block text-sm">
        <span className="text-ink-2">Address (for directions)</span>
        <input value={address} onChange={(e) => setAddress(e.target.value)} className={field} data-field="address" />
      </label>
      <p className="mt-2 text-xs text-ink-3">Times are the ground&apos;s ({tz.replace('_', ' ')}).</p>

      {error && <p className="mt-2 rounded-lg px-3 py-2 text-sm" style={{ background: 'var(--no-bg)', color: 'var(--no)' }}>{error}</p>}

      <div className="mt-3 flex gap-2">
        <button type="submit" disabled={busy} className="flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-50" style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }} data-save-occurrence>
          {busy ? 'Saving…' : 'Save and tell everyone'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-xl border border-[var(--line)] px-4 py-2.5 text-sm">
          Cancel
        </button>
      </div>
    </form>
  )
}
