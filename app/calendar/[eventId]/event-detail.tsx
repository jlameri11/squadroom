'use client'

import { useState } from 'react'
import { Chase } from './chase'
import { WhyOut } from '@/components/why-out'
import { Register } from './register'
import { Result } from './result'
import { createClient } from '@/lib/supabase/client'

type Mine = { playerId: string | null; playerName: string | null; status: string | null; note: string | null }
type RosterRow = { playerId: string | null; name: string; status: string | null; note: string | null }

const CHOICES = [
  { value: 'yes',   label: 'Going', tint: 'var(--yes)' },
  { value: 'maybe', label: 'Maybe', tint: 'var(--maybe)' },
  { value: 'no',    label: 'Out',   tint: 'var(--no)' },
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
    cancellation_reason: string | null; cancellation_note: string | null
    competition_id: string | null; fixture_id: string | null
  }
  mine: Mine[]
  isCoach: boolean
  summary: { going: number; maybe: number; out_count: number; no_reply: number } | null
  roster: RosterRow[]
}) {
  const [answers, setAnswers] = useState(mine)
  const [busy, setBusy] = useState<string | null>(null)
  const supabase = createClient()
  const [asking, setAsking] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const cancelled = Boolean(event.cancelled_at)
  const when = new Date(event.starts_at)

  /**
   * "Out" asks why; the other two save straight away.
   *
   * 0111 requires a reason on 'no', because a coach looking at "4 out" cannot
   * tell a wedding from a sulk and that is the one fact that changes what
   * they do on Saturday. Asking is the whole point — so the tap opens a box
   * rather than failing at the database, which is what would happen if the
   * screen just sent it.
   *
   * Nothing is asked for turning UP. A reason to be available is an
   * interrogation, and a product that asks for one is a product parents start
   * lying to.
   */
  async function answer(playerId: string, status: string, note?: string) {
    if (status === 'no' && !note?.trim()) {
      setAsking(playerId)
      return
    }
    setBusy(playerId)
    setError(null)
    const before = answers
    setAnswers((prev) =>
      prev.map((a) => (a.playerId === playerId ? { ...a, status, note: note?.trim() || null } : a))
    )
    const { data: auth } = await supabase.auth.getUser()
    const { error } = await supabase.from('event_rsvps').upsert(
      {
        academy_id: event.academy_id, event_id: event.id, profile_id: auth.user!.id,
        player_id: playerId, status: status as 'yes' | 'no' | 'maybe',
        note: note?.trim() || null,
      },
      { onConflict: 'event_id,profile_id,player_id' }
    )
    setBusy(null)
    if (error) {
      setError(error.message)
      // Put the buttons back where they were rather than showing an answer
      // that was not saved. This has to restore the state captured BEFORE the
      // optimistic update — mapping over `prev` can only ever copy what is
      // already on screen, which is the wrong answer.
      setAnswers(before)
      return
    }
    setAsking(null)
  }

  return (
    <>
      <header className="mt-3">
        <div className="flex items-center gap-2">
          <span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"
                style={{ background: cancelled ? 'var(--no)' : 'var(--brand)' }}>
            {cancelled ? 'Cancelled' : event.type}
          </span>
          {event.round && <span className="text-sm text-ink-2">{event.round}</span>}
        </div>
        <h1 className="mt-1.5 text-2xl font-semibold">{event.title}</h1>
      </header>

      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-ink-2">When</dt>
        <dd className="tabular-nums">
          {when.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}
          {', '}
          {when.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}
          {event.ends_at && `–${new Date(event.ends_at).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}`}
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
              <a
                href={`https://maps.google.com/?q=${encodeURIComponent(event.address ?? event.venue)}`}
                target="_blank" rel="noopener noreferrer"
                className="underline underline-offset-2" style={{ color: 'var(--brand)' }}
              >
                {event.venue}
              </a>
              {event.address && <span className="block text-ink-2">{event.address}</span>}
            </dd>
          </>
        )}

        {event.opponent && (<><dt className="text-ink-2">Against</dt><dd>{event.opponent}</dd></>)}
        {event.kit_colour && (<><dt className="text-ink-2">Kit</dt><dd>{event.kit_colour}</dd></>)}
      </dl>

      {event.notes && <p className="mt-3 rounded-xl bg-[var(--surface-2)] p-3 text-sm">{event.notes}</p>}

      <a
        href={`/api/ics/${event.id}`}
        className="mt-4 block rounded-xl border border-[var(--line)] px-4 py-2.5 text-center text-sm font-medium"
      >
        Add to your phone&apos;s calendar
      </a>

      {/* Above the RSVP block on purpose. Before kick-off this renders
          nothing; after it, the result is the only reason anybody opens this
          screen, and an answer about whether a child was available is
          history. */}
      {!cancelled && (
        <Result
          eventId={event.id}
          opponent={event.opponent}
          isCoach={isCoach}
          played={new Date(event.starts_at) <= new Date()}
          inCompetition={Boolean(event.fixture_id)}
        />
      )}

      {isCoach && <CallItOff event={event} />}

      {!cancelled && answers.length > 0 && (
        <section className="mt-6">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-2">
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
                          : { borderColor: 'var(--line)', color: 'var(--ink-2)' }}
                      >
                        {c.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}

            {asking && (
              <WhyOut
                childName={answers.find((a) => a.playerId === asking)?.playerName ?? null}
                busy={busy === asking}
                onSave={(note) => void answer(asking, 'no', note)}
                onCancel={() => setAsking(null)}
              />
            )}

            {error && (
              <p className="text-sm" style={{ color: 'var(--no)' }}>
                {error}
              </p>
            )}
          </div>
        </section>
      )}

      {/* Before the tally, because once a session has started the register is
          what a coach came here to do — the RSVP summary is what they looked
          at beforehand. */}
      {isCoach && (
        <Register eventId={event.id} started={new Date(event.starts_at) <= new Date()} />
      )}

      {isCoach && summary && (
        <section className="mt-6">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-2">
            Who&apos;s coming
          </h2>
          <p className="mt-1 text-sm">
            <b style={{ color: 'var(--yes)' }}>{summary.going} in</b> · {summary.maybe} maybe ·{' '}
            {summary.out_count} out · {summary.no_reply} no reply
          </p>

          {/* Right under the tally, because "12 no reply" is the number a
              coach reads and chasing them is what they want to do about it. */}
          <Chase
            eventId={event.id}
            outstanding={summary.no_reply}
            canChase={!event.cancelled_at && new Date(event.starts_at) > new Date()}
          />

          <div className="mt-2 rounded-xl border border-[var(--line)]">
            {roster.map((r, i) => (
              <div key={r.playerId ?? i} className={`flex items-center gap-2 p-3 ${i > 0 ? 'border-t border-[var(--line-2)]' : ''}`}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{r.name}</span>
                  {r.note && <span className="block truncate text-xs text-ink-2">“{r.note}”</span>}
                </span>
                <span className="flex-none text-xs font-semibold"
                      style={{ color: CHOICES.find((c) => c.value === r.status)?.tint ?? 'var(--ink-3)' }}>
                  {CHOICES.find((c) => c.value === r.status)?.label ?? '—'}
                </span>
              </div>
            ))}
            {roster.length === 0 && (
              <p className="p-4 text-center text-sm text-ink-2">Nobody has answered yet.</p>
            )}
          </div>
        </section>
      )}
    </>
  )
}

const REASONS = [
  { value: 'wet_weather', label: 'Wet weather' },
  { value: 'ground_closed', label: 'Ground closed' },
  { value: 'not_enough_players', label: 'Not enough players' },
  { value: 'forfeit', label: 'Forfeit' },
  { value: 'other', label: 'Something else' },
] as const

/**
 * Calling a game off, and putting it back on.
 *
 * This is the highest-consequence button in the product: pressing it wakes
 * every phone in the team, and inside 24 hours it also sends a text. So it
 * asks for a reason before it will do anything — "cancelled" and "the council
 * shut the ground" are different messages to somebody already loading the car
 * — and it says plainly how many people are about to be interrupted.
 */
function CallItOff({
  event,
}: {
  event: {
    id: string
    title: string
    starts_at: string
    cancelled_at: string | null
    cancellation_reason: string | null
    cancellation_note: string | null
  }
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<string>('wet_weather')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cancelled = Boolean(event.cancelled_at)

  // Inside 24 hours the notification escalates to SMS, and a coach should
  // know that before pressing rather than after the bill.
  const soon =
    new Date(event.starts_at).getTime() - Date.now() < 24 * 3600 * 1000 &&
    new Date(event.starts_at).getTime() > Date.now() - 3 * 3600 * 1000

  async function set(cancel: boolean) {
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { error } = await supabase
      .from('events')
      .update(
        cancel
          ? {
              cancelled_at: new Date().toISOString(),
              cancellation_reason: reason,
              cancellation_note: note.trim() || null,
            }
          : { cancelled_at: null, cancellation_reason: null, cancellation_note: null }
      )
      .eq('id', event.id)
    setBusy(false)
    if (error) return setError(error.message)
    window.location.reload()
  }

  if (cancelled) {
    return (
      <section className="mt-5 rounded-xl border   p-4">
        <p className="text-sm font-semibold ">This game is off</p>
        {(event.cancellation_reason || event.cancellation_note) && (
          <p className="mt-0.5 text-sm ">
            {REASONS.find((r) => r.value === event.cancellation_reason)?.label}
            {event.cancellation_note ? ` — ${event.cancellation_note}` : ''}
          </p>
        )}
        <p className="mt-1 text-xs ">Everyone in the team has been told.</p>
        <button
          onClick={() => set(false)}
          disabled={busy}
          className="mt-3 w-full rounded-xl border border-red-300 bg-[var(--surface)] px-4 py-2.5 text-sm font-medium"
        >
          {busy ? 'Working…' : "It's back on"}
        </button>
        {error && <p className="mt-2 text-sm ">{error}</p>}
      </section>
    )
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-5 w-full rounded-xl border border-[var(--line)] px-4 py-3 text-sm font-medium "
      >
        Call this game off
      </button>
    )
  }

  return (
    <section className="mt-5 rounded-xl border border-[var(--line)] p-4">
      <h2 className="font-semibold">Call this game off</h2>
      <p className="mt-1 text-sm text-ink-2">
        Everyone in the team gets a notification straight away, whether or not they
        RSVP&apos;d and whatever their quiet hours are set to.
        {soon && ' Because it is within 24 hours, they also get a text message.'}
      </p>

      <label className="mt-3 block text-sm">
        <span className="text-ink-2">Why</span>
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="mt-0.5 w-full rounded-lg border border-[var(--line)] p-2"
        >
          {REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </label>

      <label className="mt-2 block text-sm">
        <span className="text-ink-2">Anything to add (optional)</span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Council closed all grounds — training Tuesday as normal"
          className="mt-0.5 w-full rounded-lg border border-[var(--line)] p-2"
        />
      </label>

      {error && <p className="mt-2 text-sm ">{error}</p>}

      <div className="mt-3 flex gap-2">
        <button
          onClick={() => set(true)}
          disabled={busy}
          className="flex-1 rounded-xl bg-red-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? 'Telling everyone…' : 'Call it off and tell everyone'}
        </button>
        <button
          onClick={() => setOpen(false)}
          className="rounded-xl border border-[var(--line)] px-4 py-2.5 text-sm"
        >
          Cancel
        </button>
      </div>
    </section>
  )
}
