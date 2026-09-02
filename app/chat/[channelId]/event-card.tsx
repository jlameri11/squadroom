'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export type CardEvent = {
  id: string
  type: string
  title: string
  starts_at: string
  arrive_at: string | null
  venue: string | null
  address: string | null
  opponent: string | null
  kit_colour: string | null
  round: string | null
  cancelled_at: string | null
}

type Rsvp = { player_id: string; player_name: string; status: string | null; note: string | null }
type Summary = { going: number; maybe: number; out_count: number; no_reply: number }

const CHOICES = [
  { value: 'yes',   label: 'Going', tint: 'var(--yes)' },
  { value: 'maybe', label: 'Maybe', tint: 'var(--maybe)' },
  { value: 'no',    label: 'Out',   tint: 'var(--no)' },
] as const

/**
 * A fixture in the thread, answerable without leaving it.
 *
 * The card reads the event live rather than showing what was true when it was
 * posted, so a game moved on Thursday does not leave the old time sitting in
 * Tuesday's message being read by people arriving an hour early.
 */
export function EventCard({
  event, academyId, isCoach,
}: {
  event: CardEvent
  academyId: string
  isCoach: boolean
}) {
  const [rsvps, setRsvps] = useState<Rsvp[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const supabase = createClient()

  useEffect(() => {
    let cancelled = false
    supabase.rpc('my_rsvps_for_event', { p_event: event.id }).then(({ data }) => {
      if (!cancelled) setRsvps((data ?? []) as Rsvp[])
    })
    if (isCoach) {
      supabase.rpc('event_rsvp_summary', { p_event: event.id }).then(({ data }) => {
        if (!cancelled) setSummary((data?.[0] ?? null) as Summary | null)
      })
    }
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.id, isCoach])

  async function answer(playerId: string, status: string) {
    setSaving(playerId)
    setRsvps((prev) => prev.map((r) => (r.player_id === playerId ? { ...r, status } : r)))

    const { data: auth } = await supabase.auth.getUser()
    await supabase.from('event_rsvps').upsert(
      {
        academy_id: academyId, event_id: event.id, profile_id: auth.user!.id,
        player_id: playerId, status: status as 'yes' | 'no' | 'maybe',
      },
      { onConflict: 'event_id,profile_id,player_id' }
    )
    setSaving(null)
  }

  const when = new Date(event.starts_at)
  const cancelled = Boolean(event.cancelled_at)

  return (
    <div className={`w-full overflow-hidden rounded-xl border bg-[var(--surface)] ${cancelled ? 'opacity-60' : ''}`}
         style={{ borderColor: 'var(--brand)' }}>
      <div className="flex items-center gap-2 px-3 py-2" style={{ background: 'var(--brand-faint)' }}>
        <span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"
              style={{ background: 'var(--brand)' }}>
          {cancelled ? 'Cancelled' : event.type}
        </span>
        {event.round && <span className="text-xs font-medium text-ink-2">{event.round}</span>}
      </div>

      <div className="p-3">
        <p className="font-semibold leading-snug">{event.title}</p>

        <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
          <dt className="text-ink-2">When</dt>
          <dd className="tabular-nums">
            {when.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}
            {', '}
            {when.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}
          </dd>

          {event.arrive_at && (
            <>
              <dt className="text-ink-2">Arrive</dt>
              <dd className="tabular-nums">
                {new Date(event.arrive_at).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}
              </dd>
            </>
          )}

          {event.venue && (
            <>
              <dt className="text-ink-2">Where</dt>
              <dd>
                {/* Straight to Maps. A parent reading this is in a car. */}
                <a
                  href={`https://maps.google.com/?q=${encodeURIComponent(event.address ?? event.venue)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2"
                  style={{ color: 'var(--brand)' }}
                >
                  {event.venue}
                </a>
              </dd>
            </>
          )}

          {event.kit_colour && (
            <>
              <dt className="text-ink-2">Kit</dt>
              <dd>{event.kit_colour}</dd>
            </>
          )}
        </dl>

        {!cancelled && rsvps.length > 0 && (
          <div className="mt-3 flex flex-col gap-2">
            {rsvps.map((r) => (
              <div key={r.player_id} className="flex items-center gap-2">
                <span className="w-14 flex-none truncate text-sm font-medium text-ink-2">
                  {r.player_name.split(' ')[0]}
                </span>
                <div className="flex flex-1 gap-1">
                  {CHOICES.map((c) => {
                    const on = r.status === c.value
                    return (
                      <button
                        key={c.value}
                        onClick={() => answer(r.player_id, c.value)}
                        disabled={saving === r.player_id}
                        className="flex-1 rounded-lg border py-1.5 text-xs font-semibold disabled:opacity-60"
                        style={
                          on
                            ? { borderColor: c.tint, background: `${c.tint}18`, color: c.tint }
                            : { borderColor: 'var(--line)', color: 'var(--ink-2)' }
                        }
                      >
                        {c.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {!cancelled && (
          <a
            href={`/api/ics/${event.id}`}
            className="mt-3 block rounded-lg border border-[var(--line)] py-2 text-center text-xs font-semibold"
            style={{ color: 'var(--brand)' }}
          >
            Add to calendar
          </a>
        )}

        {isCoach && summary && (
          <p className="mt-3 border-t border-[var(--line-2)] pt-2 text-xs text-ink-2">
            <b style={{ color: 'var(--yes)' }}>{summary.going} in</b> · {summary.maybe} maybe ·{' '}
            {summary.out_count} out · {summary.no_reply} no reply
          </p>
        )}

        {!isCoach && rsvps.length === 0 && !cancelled && (
          <p className="mt-2 text-xs text-ink-2">
            No children of yours in this team yet.
          </p>
        )}
      </div>
    </div>
  )
}
