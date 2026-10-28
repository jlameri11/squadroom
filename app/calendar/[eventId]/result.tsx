'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ShareCard } from '@/components/share-card'

export type EventResult = {
  ours: number
  theirs: number
  outcome: 'won' | 'lost' | 'drew'
  note: string | null
  was_home: boolean | null
  source: 'event' | 'fixture'
  entered_at: string | null
  entered_by: string | null
}

const TINT = { won: 'var(--yes)', drew: 'var(--maybe)', lost: 'var(--no)' } as const
const WORD = { won: 'Won', drew: 'Drew', lost: 'Lost' } as const

/**
 * What happened on Saturday.
 *
 * The most asked question in a team chat on a Sunday morning, and until now
 * the product had no answer to it: scores lived on `fixtures`, which only
 * exist for competitions we run ourselves, and a club's association games
 * arrive through the import as ordinary events.
 *
 * OURS AND THEIRS, not home and away. An event knows its opponent; it does
 * not reliably know which side was at home, because the Dribl export may not
 * say. Showing a 3-0 win as 0-3 because a column shape was familiar is worse
 * than not showing which end of the ground we were at.
 *
 * The outcome word comes from the database rather than being worked out from
 * the two numbers here. Three screens deriving it is three chances to get the
 * sign the wrong way round, and this is the one screen where that is read in
 * public.
 */
export function Result({
  eventId,
  opponent,
  isCoach,
  played,
  inCompetition,
}: {
  eventId: string
  opponent: string | null
  isCoach: boolean
  /** Kick-off has passed. Nothing about results belongs on a preview. */
  played: boolean
  /** The score lives on the fixture, where the table reads it. */
  inCompetition: boolean
}) {
  const [result, setResult] = useState<EventResult | null | undefined>(undefined)
  const [editing, setEditing] = useState(false)
  const [ours, setOurs] = useState('')
  const [theirs, setTheirs] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    createClient()
      .rpc('event_result', { p_event: eventId })
      .then(({ data }) => {
        if (!live) return
        const r = (data?.[0] ?? null) as EventResult | null
        setResult(r)
        if (r) {
          setOurs(String(r.ours))
          setTheirs(String(r.theirs))
          setNote(r.note ?? '')
        }
      })
    return () => {
      live = false
    }
  }, [eventId])

  async function save(clear = false) {
    setBusy(true)
    setError(null)
    // Clearing OMITS the scores rather than passing null. The function
    // defaults them to null, which is what clears a result, and the generated
    // types make the arguments optional rather than nullable — so omission is
    // both the typed way to say it and the same call.
    const { error } = await createClient().rpc(
      'set_event_result',
      clear
        ? { p_event: eventId }
        : {
            p_event: eventId,
            p_ours: Number(ours),
            p_theirs: Number(theirs),
            p_note: note || undefined,
          }
    )
    setBusy(false)
    if (error) return setError(error.message)
    const { data } = await createClient().rpc('event_result', { p_event: eventId })
    setResult((data?.[0] ?? null) as EventResult | null)
    setEditing(false)
    if (clear) {
      setOurs('')
      setTheirs('')
      setNote('')
    }
  }

  // Still loading, or a game that has not been played and has no result to
  // show or enter. A score box above an unplayed fixture invites somebody to
  // fill it in.
  if (result === undefined) return null
  if (!played && !result) return null

  // A competition game's score is entered where the table reads it. Saying
  // so beats a disabled button nobody can explain.
  if (!result && inCompetition) {
    return isCoach ? (
      <section className="mt-4">
        <span className="eyebrow">Result</span>
        <p className="mt-1 text-sm text-ink-3">
          This game is in a competition — the score goes on the fixture, where the table reads
          it.
        </p>
      </section>
    ) : null
  }

  if (!result) {
    return isCoach ? (
      <section className="mt-4">
        <span className="eyebrow">Result</span>
        {editing ? (
          <Form
            {...{ ours, setOurs, theirs, setTheirs, note, setNote, opponent, busy, error }}
            onSave={() => void save()}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="mt-1 w-full rounded-xl border px-4 py-2.5 text-sm font-semibold"
            style={{ borderColor: 'var(--line)', color: 'var(--brand)' }}
          >
            Add the score
          </button>
        )}
      </section>
    ) : null
  }

  return (
    <section className="mt-4">
      <div className="flex items-baseline justify-between">
        <span className="eyebrow">Result</span>
        {/* A score entered on the fixture is the competition's, not this
            coach's to retype here. */}
        {isCoach && result.source === 'event' && !editing && (
          <button onClick={() => setEditing(true)} className="text-xs" style={{ color: 'var(--brand)' }}>
            Edit
          </button>
        )}
      </div>

      {editing ? (
        <Form
          {...{ ours, setOurs, theirs, setTheirs, note, setNote, opponent, busy, error }}
          onSave={() => void save()}
          onCancel={() => setEditing(false)}
          onClear={() => void save(true)}
        />
      ) : (
        <div
          className="mt-1 rounded-xl border p-4 text-center"
          style={{ borderColor: TINT[result.outcome], background: 'var(--surface)' }}
        >
          <div
            className="display text-3xl font-bold tabular-nums"
            style={{ color: TINT[result.outcome] }}
          >
            {result.ours} – {result.theirs}
          </div>
          <div className="mt-0.5 text-sm font-semibold" style={{ color: TINT[result.outcome] }}>
            {WORD[result.outcome]}
            {opponent ? ` v ${opponent}` : ''}
            {result.was_home === true ? ' · home' : result.was_home === false ? ' · away' : ''}
          </div>
          {result.note && <p className="mt-1.5 text-sm text-ink-2">{result.note}</p>}
          {/* Who said so. A score somebody disputes is a score somebody has
              to be able to ask about. */}
          {result.entered_by && (
            <p className="mt-1.5 text-xs text-ink-3">
              {result.source === 'fixture' ? 'From the competition' : `Entered by ${result.entered_by}`}
            </p>
          )}
          {result.source === 'fixture' && !result.entered_by && (
            <p className="mt-1.5 text-xs text-ink-3">From the competition</p>
          )}
        </div>
      )}

      {/* Only once there is a result, and for staff only — it is the club's
          image to post, not a parent's. */}
      {!editing && isCoach && (
        <ShareCard
          endpoint={`/api/share/result/${eventId}`}
          label="Share this result"
          filename="result"
        />
      )}
    </section>
  )
}

function Form({
  ours,
  setOurs,
  theirs,
  setTheirs,
  note,
  setNote,
  opponent,
  busy,
  error,
  onSave,
  onCancel,
  onClear,
}: {
  ours: string
  setOurs: (v: string) => void
  theirs: string
  setTheirs: (v: string) => void
  note: string
  setNote: (v: string) => void
  opponent: string | null
  busy: boolean
  error: string | null
  onSave: () => void
  onCancel: () => void
  onClear?: () => void
}) {
  const ok = ours !== '' && theirs !== ''

  return (
    <div className="mt-1 rounded-xl border p-3" style={{ borderColor: 'var(--line)' }}>
      <div className="flex items-end gap-2">
        <Box label="Us" value={ours} onChange={setOurs} />
        <span className="pb-2.5 text-lg text-ink-3">–</span>
        <Box label={opponent ?? 'Them'} value={theirs} onChange={setTheirs} />
      </div>

      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Scorers, or anything worth remembering"
        className="mt-2 w-full rounded-lg border px-3 py-2.5 text-base"
        style={{ borderColor: 'var(--line)' }}
      />

      {error && (
        <p className="mt-2 text-sm" style={{ color: 'var(--no)' }}>
          {error}
        </p>
      )}

      <div className="mt-2 flex gap-2">
        <button
          onClick={onSave}
          disabled={!ok || busy}
          className="flex-1 rounded-lg px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: 'var(--brand)' }}
        >
          {busy ? 'Saving…' : 'Save the result'}
        </button>
        <button
          onClick={onCancel}
          className="rounded-lg border px-3 py-2.5 text-sm"
          style={{ borderColor: 'var(--line)' }}
        >
          Cancel
        </button>
      </div>

      {/* The only way to take back a score typed into the wrong game. A form
          with no way to empty it is a form that leaves a wrong score up. */}
      {onClear && (
        <button
          onClick={onClear}
          disabled={busy}
          className="mt-2 w-full text-xs underline underline-offset-4"
          style={{ color: 'var(--no)' }}
        >
          Remove the result
        </button>
      )}
    </div>
  )
}

function Box({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <label className="min-w-0 flex-1">
      <span className="block truncate text-xs text-ink-2">{label}</span>
      <input
        // `inputMode` rather than `type="number"`, which on iOS brings a
        // keypad with a spinner and lets a scroll wheel change a saved score.
        inputMode="numeric"
        pattern="[0-9]*"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 2))}
        placeholder="0"
        className="mt-0.5 w-full rounded-lg border px-3 py-2 text-center text-2xl font-bold tabular-nums"
        style={{ borderColor: 'var(--line)' }}
      />
    </label>
  )
}
