'use client'

import { useState } from 'react'
import { Sheet } from '@/components/sheet'
import { createClient } from '@/lib/supabase/client'
import { invalidateScreen } from '@/lib/hooks/use-screen'

type Team = { id: string; name: string }

// 0 = Sunday, matching Postgres's extract(dow).
const DAYS = [
  { n: 1, short: 'Mon' },
  { n: 2, short: 'Tue' },
  { n: 3, short: 'Wed' },
  { n: 4, short: 'Thu' },
  { n: 5, short: 'Fri' },
  { n: 6, short: 'Sat' },
  { n: 0, short: 'Sun' },
] as const

/**
 * Weekly training, in one decision.
 *
 * The first event-creation screen in the product: until now events arrived
 * from a Dribl import or a screenshot, which covers games and nothing else.
 * Training is the event an academy has most of — a squad plays once a week
 * and trains twice — and it was the one thing a coach could not add.
 *
 * The form asks for the pattern, not the occurrences, and then says how many
 * sessions that comes to BEFORE the button is pressed. "Tuesdays and
 * Thursdays until the end of March" is a sentence a coach already knows; "32
 * sessions" is the thing they want to be sure of.
 */
export function NewSessions({
  academyId,
  teams,
  onClose,
}: {
  academyId: string
  teams: Team[]
  onClose: () => void
}) {
  const [title, setTitle] = useState('Training')
  const [team, setTeam] = useState('')
  const [days, setDays] = useState<number[]>([2])
  const [time, setTime] = useState('17:00')
  const [duration, setDuration] = useState('60')
  const [arrive, setArrive] = useState('15')
  const [venue, setVenue] = useState('')
  const [from, setFrom] = useState(today())
  const [until, setUntil] = useState(inWeeks(10))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<number | null>(null)

  // Counted here as well as in the database, so the coach sees the number
  // before committing rather than after. The database still has the final
  // say — this is a preview, not the check.
  const planned = countSessions(from, until, days)

  async function create() {
    setBusy(true)
    setError(null)
    const { data, error } = await createClient().rpc('create_event_series', {
      p_academy: academyId,
      p_title: title.trim() || 'Training',
      p_team: team || undefined,
      p_days: days,
      p_time: time,
      p_duration: Number(duration) || 60,
      p_arrive: arrive === '' ? undefined : Number(arrive),
      p_venue: venue.trim() || undefined,
      p_from: from,
      p_until: until,
    })
    setBusy(false)
    if (error) return setError(error.message)
    // The fixtures screen is cached; without this the coach comes back to a
    // list that does not have what they just made in it.
    invalidateScreen()
    setDone((data as { created: number }).created)
  }

  if (done !== null) {
    return (
      <Sheet onClose={onClose}>
        <div className="p-5 text-center">
          <p className="display text-[24px] leading-tight">
            {done} {done === 1 ? 'session' : 'sessions'} added
          </p>
          <p className="mt-1.5 text-sm text-ink-2">
            They&apos;re in everyone&apos;s fixtures and calendar subscriptions now. Families can
            answer each one.
          </p>
          <button
            onClick={() => window.location.reload()}
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
        <h2 className="display text-[22px] leading-tight">Add training</h2>
        <p className="mt-0.5 text-sm text-ink-2">
          Set the pattern once. Each session can be called off on its own later.
        </p>

        <div className="mt-4 flex flex-col gap-3.5">
          <div className="flex gap-2">
            <label className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="eyebrow">What</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="rounded-xl border px-3.5 py-3 text-base"
                style={{ borderColor: 'var(--line)' }}
              />
            </label>
            <label className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="eyebrow">Who</span>
              <select
                value={team}
                onChange={(e) => setTeam(e.target.value)}
                className="rounded-xl border px-3 py-3 text-base"
                style={{ borderColor: 'var(--line)' }}
              >
                <option value="">Whole academy</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div>
            <span className="eyebrow">Which days</span>
            <div className="mt-1.5 flex gap-1">
              {DAYS.map((d) => {
                const on = days.includes(d.n)
                return (
                  <button
                    key={d.n}
                    onClick={() =>
                      setDays(on ? days.filter((x) => x !== d.n) : [...days, d.n].sort())
                    }
                    aria-pressed={on}
                    className="min-w-0 flex-1 rounded-lg py-2 text-xs font-semibold"
                    style={
                      on
                        ? { background: 'var(--brand)', color: '#fff' }
                        : { background: 'var(--surface-2)', color: 'var(--ink-3)' }
                    }
                  >
                    {d.short}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex gap-2">
            <label className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="eyebrow">Starts</span>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="rounded-xl border px-3 py-3 text-base"
                style={{ borderColor: 'var(--line)' }}
              />
            </label>
            <label className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="eyebrow">Minutes</span>
              <input
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                inputMode="numeric"
                className="rounded-xl border px-3 py-3 text-base tabular-nums"
                style={{ borderColor: 'var(--line)' }}
              />
            </label>
            <label className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="eyebrow">Arrive</span>
              <input
                value={arrive}
                onChange={(e) => setArrive(e.target.value)}
                inputMode="numeric"
                placeholder="15"
                className="rounded-xl border px-3 py-3 text-base tabular-nums"
                style={{ borderColor: 'var(--line)' }}
              />
            </label>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="eyebrow">Where</span>
            <input
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
              placeholder="ELS Hall Park"
              className="rounded-xl border px-3.5 py-3 text-base"
              style={{ borderColor: 'var(--line)' }}
            />
          </label>

          <div className="flex gap-2">
            <label className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="eyebrow">From</span>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="rounded-xl border px-3 py-3 text-base"
                style={{ borderColor: 'var(--line)' }}
              />
            </label>
            <label className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="eyebrow">Until</span>
              <input
                type="date"
                value={until}
                onChange={(e) => setUntil(e.target.value)}
                className="rounded-xl border px-3 py-3 text-base"
                style={{ borderColor: 'var(--line)' }}
              />
            </label>
          </div>

          {/* The number, before the button. A coach should never find out they
              created a decade of Tuesdays by scrolling. */}
          <p
            className="rounded-lg px-3 py-2.5 text-sm"
            style={{
              background: planned > 200 || planned === 0 ? 'var(--no-bg)' : 'var(--surface-2)',
              color: planned > 200 || planned === 0 ? 'var(--no)' : 'var(--ink-2)',
            }}
          >
            {days.length === 0
              ? 'Pick at least one day.'
              : planned === 0
                ? 'No sessions fall between those dates.'
                : planned > 200
                  ? `That's ${planned} sessions — check the end date.`
                  : `${planned} ${planned === 1 ? 'session' : 'sessions'}, ${dayWords(days)} at ${time}.`}
          </p>

          {error && (
            <p
              className="rounded-lg px-3 py-2.5 text-sm"
              style={{ background: 'var(--no-bg)', color: 'var(--no)' }}
            >
              {error}
            </p>
          )}

          <button
            onClick={create}
            disabled={busy || planned === 0 || planned > 200}
            className="rounded-xl px-4 py-3 font-semibold text-white disabled:opacity-50"
            style={{ background: 'var(--brand)' }}
          >
            {busy ? 'Adding…' : `Add ${planned || ''} ${planned === 1 ? 'session' : 'sessions'}`}
          </button>
        </div>
      </div>
    </Sheet>
  )
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function inWeeks(n: number) {
  const d = new Date()
  d.setDate(d.getDate() + n * 7)
  return d.toISOString().slice(0, 10)
}

/**
 * How many sessions the pattern comes to.
 *
 * Counted on plain dates rather than timestamps: this is a calendar question
 * ("how many Tuesdays"), and doing it in UTC would drop or double a session
 * at either end depending on the time of day the coach happens to be filling
 * the form in.
 */
function countSessions(from: string, until: string, days: number[]) {
  if (!from || !until || days.length === 0) return 0
  const start = new Date(`${from}T12:00:00`)
  const end = new Date(`${until}T12:00:00`)
  if (Number.isNaN(+start) || Number.isNaN(+end) || end < start) return 0
  let count = 0
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    if (days.includes(d.getDay())) count++
    if (count > 400) break
  }
  return count
}

/** "Tuesdays and Thursdays" — the way a coach would say it. */
function dayWords(days: number[]) {
  const names = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']
  const picked = [...days].sort().map((d) => names[d])
  if (picked.length === 1) return picked[0]
  return `${picked.slice(0, -1).join(', ')} and ${picked[picked.length - 1]}`
}
