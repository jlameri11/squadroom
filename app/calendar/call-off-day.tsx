'use client'

import { useEffect, useState } from 'react'
import { Sheet } from '@/components/sheet'
import { createClient } from '@/lib/supabase/client'
import { invalidateScreen } from '@/lib/hooks/use-screen'

type OnDay = {
  event_id: string
  title: string
  starts_at: string
  venue: string | null
  team_name: string | null
  type: string
  cancelled: boolean
  started: boolean
}

const REASONS = [
  { value: 'wet_weather', label: 'Wet weather' },
  { value: 'ground_closed', label: 'Ground closed' },
  { value: 'not_enough_players', label: 'Not enough players' },
  { value: 'other', label: 'Something else' },
] as const

/**
 * Calling off a whole morning.
 *
 * The thing this replaces is thirteen separate cancellations at twenty to
 * seven on a Saturday, each with its own confirmation, while parents are
 * already in cars. One reason, one press.
 *
 * THE LIST IS THE POINT. "Call off 13 sessions" is a number a coach has to
 * trust; thirteen titles with their times and grounds is a number they can
 * check. Anything already off, or already under way, is shown greyed and
 * excluded — so what they are about to do is visible rather than described.
 *
 * It sends through the same `cancelled_at` path as a single cancellation, so
 * the existing trigger does the telling: the whole-team notification that
 * cannot be muted, the reason in the message, and the SMS escalation inside
 * 24 hours. Nothing here decides who hears about it.
 */
export function CallOffDay({
  academyId,
  onClose,
  onDone,
}: {
  academyId: string
  onClose: () => void
  onDone: () => void
}) {
  const [date, setDate] = useState(nextSaturday())
  const [reason, setReason] = useState<string>('wet_weather')
  const [note, setNote] = useState('')
  const [venue, setVenue] = useState('')
  const [onDay, setOnDay] = useState<OnDay[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<number | null>(null)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    let live = true
    ;(async () => {
      setOnDay(null)
      const { data, error } = await createClient().rpc('whats_on', {
        p_academy: academyId,
        p_date: date,
      })
      if (!live) return
      if (error) return setError(error.message)
      setOnDay((data ?? []) as OnDay[])
    })()
    return () => {
      live = false
    }
  }, [academyId, date])

  const venues = [...new Set((onDay ?? []).map((e) => e.venue).filter(Boolean))] as string[]

  // What this press would actually touch, worked out the same way the
  // database works it out — so the number on the button is the number that
  // happens.
  const willGo = (onDay ?? []).filter(
    (e) =>
      !e.cancelled &&
      !e.started &&
      (!venue || (e.venue ?? '').toLowerCase().includes(venue.toLowerCase()))
  )
  const skipping = (onDay ?? []).filter((e) => e.cancelled || e.started)

  async function callOff() {
    setBusy(true)
    setError(null)
    const { data, error } = await createClient().rpc('call_off_day', {
      p_academy: academyId,
      p_date: date,
      p_reason: reason,
      p_note: note.trim() || undefined,
      p_venue: venue || undefined,
    })
    setBusy(false)
    if (error) return setError(error.message)
    invalidateScreen()
    setDone((data as { affected: number }).affected)
  }

  if (done !== null) {
    return (
      <Sheet onClose={onClose}>
        <div className="p-5 text-center">
          <p className="display text-[24px] leading-tight">
            {done} {done === 1 ? 'session' : 'sessions'} called off
          </p>
          <p className="mt-1.5 text-sm text-ink-2">
            Every affected family has been told, with the reason. Nobody can mute this one.
          </p>
          <button
            onClick={() => {
              onDone()
              onClose()
            }}
            className="mt-4 w-full rounded-xl px-4 py-3 font-semibold text-white"
            style={{ background: 'var(--brand)' }}
          >
            Done
          </button>
        </div>
      </Sheet>
    )
  }

  return (
    <Sheet onClose={onClose}>
      <div className="p-4">
        <h2 className="display text-[22px] leading-tight">Call off a day</h2>
        <p className="mt-0.5 text-sm text-ink-2">
          Everything on one day, or one ground, in a single message.
        </p>

        <div className="mt-4 flex gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="eyebrow">Which day</span>
            <input
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value)
                setConfirming(false)
              }}
              className="rounded-xl border px-3 py-3 text-base"
              style={{ borderColor: 'var(--line)' }}
            />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="eyebrow">Which ground</span>
            <select
              value={venue}
              onChange={(e) => {
                setVenue(e.target.value)
                setConfirming(false)
              }}
              className="rounded-xl border px-3 py-3 text-base"
              style={{ borderColor: 'var(--line)' }}
            >
              <option value="">Everywhere</option>
              {venues.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-3">
          <span className="eyebrow">Why</span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {REASONS.map((r) => (
              <button
                key={r.value}
                onClick={() => setReason(r.value)}
                aria-pressed={reason === r.value}
                className="rounded-lg px-3 py-2 text-sm font-semibold"
                style={
                  reason === r.value
                    ? { background: 'var(--brand)', color: '#fff' }
                    : { background: 'var(--surface-2)', color: 'var(--ink-2)' }
                }
              >
                {r.label}
              </button>
            ))}
          </div>
          {/* "Wet weather" and "forfeit" are different things to somebody
              already loading the car, which is why the reason is a fixed set
              and the detail is a separate line. */}
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Anything to add — “council called it at 6:40”"
            className="mt-2 w-full rounded-xl border px-3.5 py-3 text-base"
            style={{ borderColor: 'var(--line)' }}
          />
        </div>

        <section className="mt-4">
          <h3 className="eyebrow">
            {onDay === null ? 'Looking…' : `${willGo.length} would be called off`}
          </h3>

          {onDay !== null && willGo.length === 0 && (
            <p className="card mt-2 p-4 text-center text-sm text-ink-2">
              Nothing on that day{venue ? ` at ${venue}` : ''} that is still to come.
            </p>
          )}

          {willGo.length > 0 && (
            <div className="card mt-2 overflow-hidden">
              {willGo.map((e) => (
                <div
                  key={e.event_id}
                  className="flex items-center gap-2.5 border-t px-3 py-2 text-sm first:border-t-0"
                  style={{ borderColor: 'var(--line-2)' }}
                >
                  <span className="w-12 flex-none text-xs tabular-nums text-ink-3">
                    {clock(e.starts_at)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{e.title}</span>
                    <span className="block truncate text-xs text-ink-3">
                      {[e.team_name, e.venue].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Said rather than silently skipped, so a smaller number than
              expected explains itself. */}
          {skipping.length > 0 && (
            <p className="mt-2 px-1 text-xs text-ink-3">
              {skipping.length} not included —{' '}
              {skipping.filter((e) => e.cancelled).length > 0 &&
                `${skipping.filter((e) => e.cancelled).length} already off`}
              {skipping.filter((e) => e.cancelled).length > 0 &&
                skipping.filter((e) => e.started).length > 0 &&
                ', '}
              {skipping.filter((e) => e.started).length > 0 &&
                `${skipping.filter((e) => e.started).length} already under way`}
              .
            </p>
          )}
        </section>

        {error && (
          <p
            className="mt-3 rounded-lg px-3 py-2.5 text-sm"
            style={{ background: 'var(--no-bg)', color: 'var(--no)' }}
          >
            {error}
          </p>
        )}

        {/* Two taps, because this one cannot be taken back: every affected
            family is told immediately and the notification cannot be muted. */}
        {!confirming ? (
          <button
            onClick={() => setConfirming(true)}
            disabled={willGo.length === 0}
            className="mt-4 w-full rounded-xl px-4 py-3 font-semibold text-white disabled:opacity-50"
            style={{ background: 'var(--no)' }}
          >
            Call off {willGo.length} {willGo.length === 1 ? 'session' : 'sessions'}
          </button>
        ) : (
          <div className="mt-4">
            <p className="mb-2 text-center text-sm" style={{ color: 'var(--no)' }}>
              This tells every affected family straight away, and cannot be undone.
            </p>
            <div className="flex gap-2">
              <button
                onClick={callOff}
                disabled={busy}
                className="flex-1 rounded-xl px-4 py-3 font-semibold text-white disabled:opacity-50"
                style={{ background: 'var(--no)' }}
              >
                {busy ? 'Telling everyone…' : 'Yes, call it off'}
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="rounded-xl border px-4 py-3 font-medium"
                style={{ borderColor: 'var(--line)' }}
              >
                Wait
              </button>
            </div>
          </div>
        )}
      </div>
    </Sheet>
  )
}

/** The next Saturday, because that is the day this gets used. */
function nextSaturday() {
  const d = new Date()
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7))
  return d.toISOString().slice(0, 10)
}

function clock(iso: string) {
  return new Date(iso)
    .toLocaleTimeString('en-AU', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'Australia/Sydney',
    })
    .replace(' ', '')
    .toLowerCase()
}
