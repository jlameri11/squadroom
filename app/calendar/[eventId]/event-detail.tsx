'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Mine = { playerId: string | null; playerName: string | null; status: string | null; note: string | null }
type RosterRow = { playerId: string | null; name: string; status: string | null; note: string | null }

const CHOICES = [
  { value: 'yes',   label: 'Going', tint: '#1C7A4C' },
  { value: 'maybe', label: 'Maybe', tint: '#9C6B06' },
  { value: 'no',    label: 'Out',   tint: '#8E3020' },
] as const

export function EventDetail({
  event, mine, isCoach, summary, roster,
}: {
  event: {
    id: string; academy_id: string; type: string; title: string
    description: string | null; starts_at: string; ends_at: string | null
    arrive_at: string | null; venue: string | null; address: string | null
    opponent: string | null; kit_colour: string | null; round: string | null
    notes: string | null; cancelled_at: string | null
  }
  mine: Mine[]
  isCoach: boolean
  summary: { going: number; maybe: number; out_count: number; no_reply: number } | null
  roster: RosterRow[]
}) {
  const [answers, setAnswers] = useState(mine)
  const [busy, setBusy] = useState<string | null>(null)
  const supabase = createClient()
  const cancelled = Boolean(event.cancelled_at)
  const when = new Date(event.starts_at)

  async function answer(playerId: string, status: string) {
    setBusy(playerId)
    setAnswers((prev) => prev.map((a) => (a.playerId === playerId ? { ...a, status } : a)))
    const { data: auth } = await supabase.auth.getUser()
    await supabase.from('event_rsvps').upsert(
      {
        academy_id: event.academy_id, event_id: event.id, profile_id: auth.user!.id,
        player_id: playerId, status: status as 'yes' | 'no' | 'maybe',
      },
      { onConflict: 'event_id,profile_id,player_id' }
    )
    setBusy(null)
  }

  return (
    <>
      <header className="mt-3">
        <div className="flex items-center gap-2">
          <span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"
                style={{ background: cancelled ? '#8E3020' : '#202842' }}>
            {cancelled ? 'Cancelled' : event.type}
          </span>
          {event.round && <span className="text-sm text-neutral-500">{event.round}</span>}
        </div>
        <h1 className="mt-1.5 text-2xl font-semibold">{event.title}</h1>
      </header>

      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-neutral-500">When</dt>
        <dd className="tabular-nums">
          {when.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}
          {', '}
          {when.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}
          {event.ends_at && `–${new Date(event.ends_at).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}`}
        </dd>

        {event.arrive_at && (
          <>
            <dt className="text-neutral-500">Arrive</dt>
            <dd className="tabular-nums">
              {new Date(event.arrive_at).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}
            </dd>
          </>
        )}

        {event.venue && (
          <>
            <dt className="text-neutral-500">Where</dt>
            <dd>
              <a
                href={`https://maps.google.com/?q=${encodeURIComponent(event.address ?? event.venue)}`}
                target="_blank" rel="noopener noreferrer"
                className="underline underline-offset-2" style={{ color: '#202842' }}
              >
                {event.venue}
              </a>
              {event.address && <span className="block text-neutral-500">{event.address}</span>}
            </dd>
          </>
        )}

        {event.opponent && (<><dt className="text-neutral-500">Against</dt><dd>{event.opponent}</dd></>)}
        {event.kit_colour && (<><dt className="text-neutral-500">Kit</dt><dd>{event.kit_colour}</dd></>)}
      </dl>

      {event.notes && <p className="mt-3 rounded-xl bg-neutral-100 p-3 text-sm">{event.notes}</p>}

      <a
        href={`/api/ics/${event.id}`}
        className="mt-4 block rounded-xl border border-neutral-300 px-4 py-2.5 text-center text-sm font-medium"
      >
        Add to your phone&apos;s calendar
      </a>

      {!cancelled && answers.length > 0 && (
        <section className="mt-6">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Your answer
          </h2>
          <div className="mt-2 flex flex-col gap-2">
            {answers.map((a) => (
              <div key={a.playerId} className="flex items-center gap-2">
                <span className="w-20 flex-none truncate text-sm font-medium">{a.playerName}</span>
                <div className="flex flex-1 gap-1.5">
                  {CHOICES.map((c) => {
                    const on = a.status === c.value
                    return (
                      <button
                        key={c.value}
                        onClick={() => a.playerId && answer(a.playerId, c.value)}
                        disabled={busy === a.playerId}
                        className="flex-1 rounded-lg border py-2 text-sm font-semibold disabled:opacity-60"
                        style={on
                          ? { borderColor: c.tint, background: `${c.tint}18`, color: c.tint }
                          : { borderColor: '#E5E7EB', color: '#6B7280' }}
                      >
                        {c.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {isCoach && summary && (
        <section className="mt-6">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Who&apos;s coming
          </h2>
          <p className="mt-1 text-sm">
            <b style={{ color: '#1C7A4C' }}>{summary.going} in</b> · {summary.maybe} maybe ·{' '}
            {summary.out_count} out · {summary.no_reply} no reply
          </p>

          <div className="mt-2 rounded-xl border border-neutral-200">
            {roster.map((r, i) => (
              <div key={r.playerId ?? i} className={`flex items-center gap-2 p-3 ${i > 0 ? 'border-t border-neutral-100' : ''}`}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{r.name}</span>
                  {r.note && <span className="block truncate text-xs text-neutral-500">“{r.note}”</span>}
                </span>
                <span className="flex-none text-xs font-semibold"
                      style={{ color: CHOICES.find((c) => c.value === r.status)?.tint ?? '#9CA3AF' }}>
                  {CHOICES.find((c) => c.value === r.status)?.label ?? '—'}
                </span>
              </div>
            ))}
            {roster.length === 0 && (
              <p className="p-4 text-center text-sm text-neutral-500">Nobody has answered yet.</p>
            )}
          </div>
        </section>
      )}
    </>
  )
}
