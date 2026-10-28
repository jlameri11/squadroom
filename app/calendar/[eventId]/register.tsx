'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { sendOrQueue } from '@/lib/offline/use-outbox'

type Row = {
  player_id: string
  player_name: string
  squad_number: number | null
  status: 'present' | 'absent' | 'late' | 'excused' | null
  note: string | null
  rsvp: string | null
}

const MARKS = [
  { value: 'present' as const, short: 'In', colour: 'var(--yes)', bg: 'var(--yes-bg)' },
  { value: 'late' as const, short: 'Late', colour: 'var(--maybe)', bg: 'var(--maybe-bg)' },
  { value: 'absent' as const, short: 'Out', colour: 'var(--no)', bg: 'var(--no-bg)' },
]

/**
 * The register, taken at the ground.
 *
 * This is the thing an academy does more than anything else, and the design
 * constraint is where it happens: a coach standing on grass, holding a phone,
 * with a squad of seventeen in front of them and two bars of signal. So:
 *
 *   · "All in" first, because most weeks most children turn up. Marking the
 *     exceptions is three taps; marking everyone individually is seventeen.
 *   · Every change is held locally and sent in ONE call. Seventeen round
 *     trips at a ground is seventeen chances to fail halfway through.
 *   · The RSVP sits beside each child, greyed. "Said yes, did not come" is
 *     the row a coach is actually looking for, and it is invisible unless the
 *     two are on the same line.
 *
 * It only appears for a session that has started. A register taken on Monday
 * for Tuesday's training is not a register.
 */
export function Register({ eventId, started }: { eventId: string; started: boolean }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [draft, setDraft] = useState<Record<string, Row['status']>>({})
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [queued, setQueued] = useState<number | null>(null)
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await createClient().rpc('event_register', { p_event: eventId })
    if (error) return setError(error.message)
    setRows((data ?? []) as Row[])
  }, [eventId])

  useEffect(() => {
    if (!open) return
    ;(async () => {
      await load()
    })()
  }, [open, load])

  async function save() {
    if (!rows) return
    setBusy(true)
    setError(null)
    // Only what changed. Sending the untouched rows would overwrite a mark
    // another coach made from the other side of the pitch.
    const marks = Object.entries(draft)
      .filter(([, status]) => status)
      .map(([player_id, status]) => ({ player_id, status }))

    if (marks.length === 0) {
      setBusy(false)
      return setError('Nothing changed yet.')
    }

    // X-09. The register is the one thing in this product that is always
    // taken in the worst possible signal: a touchline, forty phones on one
    // tower. A tap that silently does nothing here is a coach going back to
    // paper for good, so a network failure KEEPS the marks and sends them
    // later rather than reporting an error for something that is not lost.
    const outcome = await sendOrQueue({
      kind: 'rpc',
      fn: 'take_register',
      args: { p_event: eventId, p_marks: marks },
    })
    setBusy(false)

    if (outcome.status === 'refused') return setError(outcome.error)

    if (outcome.status === 'queued') {
      // Said plainly, because "saved" would be a lie and an error would be
      // worse than one — the marks are safe either way.
      setQueued(marks.length)
      setDraft({})
      setTimeout(() => setQueued(null), 6000)
      return
    }

    setSaved(marks.length)
    setDraft({})
    await load()
    setTimeout(() => setSaved(null), 3000)
  }

  if (!started) return null

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="sect w-full rounded-xl border px-4 py-3 text-left text-sm font-semibold"
        style={{ borderColor: 'var(--line)', color: 'var(--brand)' }}
      >
        Take the register
      </button>
    )
  }

  const marked = (rows ?? []).filter((r) => (draft[r.player_id] ?? r.status) !== null).length
  const total = rows?.length ?? 0

  return (
    <section className="sect">
      <div className="flex items-baseline justify-between">
        <h2 className="eyebrow">Register</h2>
        <span className="text-xs text-ink-3">
          {marked} of {total} marked
        </span>
      </div>

      {rows === null ? (
        <p className="card mt-2 p-5 text-center text-sm text-ink-3">Loading the squad…</p>
      ) : rows.length === 0 ? (
        <p className="card mt-2 p-5 text-center text-sm text-ink-2">
          No players in this squad yet.
        </p>
      ) : (
        <>
          <button
            onClick={() =>
              setDraft(Object.fromEntries(rows.map((r) => [r.player_id, 'present' as const])))
            }
            className="mt-2 w-full rounded-xl px-4 py-2.5 text-sm font-semibold"
            style={{ background: 'var(--surface-2)', color: 'var(--ink)' }}
          >
            Everyone&apos;s here
          </button>

          <div className="card mt-2 overflow-hidden">
            {rows.map((r) => {
              const current = draft[r.player_id] ?? r.status
              return (
                <div
                  key={r.player_id}
                  className="flex items-center gap-2 border-t px-3 py-2 first:border-t-0"
                  style={{ borderColor: 'var(--line-2)' }}
                >
                  <span className="w-5 flex-none text-right text-xs tabular-nums text-ink-3">
                    {r.squad_number ?? ''}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{r.player_name}</span>
                    {/* Greyed, because it is what they SAID, not what happened. */}
                    {r.rsvp && (
                      <span className="block text-xs text-ink-3">
                        said {r.rsvp === 'yes' ? 'yes' : r.rsvp === 'no' ? 'no' : r.rsvp}
                      </span>
                    )}
                  </span>
                  <span className="flex flex-none gap-1">
                    {MARKS.map((m) => {
                      const on = current === m.value
                      return (
                        <button
                          key={m.value}
                          onClick={() =>
                            setDraft({ ...draft, [r.player_id]: on ? null : m.value })
                          }
                          aria-pressed={on}
                          className="rounded-lg px-2 py-1.5 text-xs font-semibold"
                          style={{
                            background: on ? m.bg : 'var(--surface-2)',
                            color: on ? m.colour : 'var(--ink-3)',
                            border: `1px solid ${on ? m.colour : 'transparent'}`,
                          }}
                        >
                          {m.short}
                        </button>
                      )
                    })}
                  </span>
                </div>
              )
            })}
          </div>

          {error && (
            <p
              className="mt-2 rounded-lg px-3 py-2 text-sm"
              style={{ background: 'var(--no-bg)', color: 'var(--no)' }}
            >
              {error}
            </p>
          )}
          {saved !== null && (
            <p
              className="mt-2 rounded-lg px-3 py-2 text-sm"
              style={{ background: 'var(--yes-bg)', color: 'var(--yes)' }}
            >
              {saved} {saved === 1 ? 'child' : 'children'} saved.
            </p>
          )}
          {/* A different colour and different words from "saved", because it
              is a different fact. The marks are safe and the club cannot see
              them yet, and a coach who is told "saved" and then finds the
              register empty at home trusts nothing after that. */}
          {queued !== null && (
            <p
              className="mt-2 rounded-lg px-3 py-2 text-sm"
              style={{ background: 'var(--maybe-bg)', color: 'var(--maybe)' }}
            >
              {queued} {queued === 1 ? 'mark' : 'marks'} kept on this phone — no signal. They
              will go as soon as there is, even if you close the app.
            </p>
          )}

          <button
            onClick={save}
            disabled={busy || Object.keys(draft).length === 0}
            className="mt-2 w-full rounded-xl px-4 py-3 font-semibold text-white disabled:opacity-50"
            style={{ background: 'var(--brand)' }}
          >
            {busy
              ? 'Saving…'
              : Object.keys(draft).length === 0
                ? 'Nothing to save'
                : `Save ${Object.keys(draft).length} change${Object.keys(draft).length === 1 ? '' : 's'}`}
          </button>
        </>
      )}
    </section>
  )
}
