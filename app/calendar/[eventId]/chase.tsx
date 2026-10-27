'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Row = {
  player_id: string
  player_name: string
  guardian_id: string | null
  guardian_name: string | null
  guardian_phone: string | null
}

/**
 * Chasing the families who have not answered.
 *
 * The most tedious thing in running a squad. A coach needs eleven on
 * Saturday, has nine answers, and the alternative is scrolling a WhatsApp
 * group counting names or texting people one at a time.
 *
 * Per CHILD, not per guardian. A parent with two in the squad has answered
 * for one and not the other, and "Sam Whitfield" in a chase list tells a
 * coach nothing about which — so the list names the child and the number
 * to ring beside it.
 *
 * One tap nudges all of them, and only them. The rate limit is in the
 * database (one per person per day), so pressing it twice is safe and the
 * button says what actually happened rather than what it intended.
 */
export function Chase({
  eventId,
  outstanding,
  canChase,
}: {
  eventId: string
  outstanding: number
  canChase: boolean
}) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await createClient().rpc('who_hasnt_answered', { p_event: eventId })
    if (error) return setError(error.message)
    setRows((data ?? []) as Row[])
  }, [eventId])

  useEffect(() => {
    if (!open || rows) return
    ;(async () => {
      await load()
    })()
  }, [open, rows, load])

  async function nudge() {
    setBusy(true)
    setError(null)
    const { data, error } = await createClient().rpc('nudge_non_responders', {
      p_event: eventId,
    })
    setBusy(false)
    if (error) return setError(error.message)

    const { sent, skipped } = data as { sent: number; skipped: number }
    setResult(
      sent === 0
        ? skipped > 0
          ? `Already nudged today. Nobody was told twice.`
          : 'Nobody left to nudge.'
        : `${sent} ${sent === 1 ? 'family' : 'families'} nudged.` +
          (skipped > 0 ? ` ${skipped} skipped — already done today, or reminders turned off.` : '')
    )
    await load()
  }

  if (!canChase || outstanding === 0) return null

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-2 w-full rounded-xl border px-4 py-2.5 text-left text-sm font-semibold"
        style={{ borderColor: 'var(--line)', color: 'var(--brand)' }}
      >
        {outstanding} {outstanding === 1 ? "hasn't" : "haven't"} answered — chase them
      </button>
    )
  }

  return (
    <div className="mt-2 rounded-xl border p-3" style={{ borderColor: 'var(--line)' }}>
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">Still waiting on</h3>
        <button onClick={() => setOpen(false)} className="text-xs text-ink-3">
          Hide
        </button>
      </div>

      {rows === null ? (
        <p className="mt-2 text-sm text-ink-3">Looking…</p>
      ) : rows.length === 0 ? (
        <p className="mt-2 text-sm text-ink-2">Everybody has answered.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1">
          {rows.map((r) => (
            <li key={r.player_id} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate">{r.player_name}</span>
                {r.guardian_name && (
                  <span className="block truncate text-xs text-ink-3">{r.guardian_name}</span>
                )}
              </span>
              {/* The number, because sometimes a nudge is not the answer and
                  a phone call is. */}
              {r.guardian_phone && (
                <a
                  href={`tel:${r.guardian_phone}`}
                  className="grid h-8 w-8 flex-none place-items-center rounded-lg border"
                  style={{ borderColor: 'var(--line)' }}
                  aria-label={`Call ${r.guardian_name}`}
                >
                  📞
                </a>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="mt-2 text-sm" style={{ color: 'var(--no)' }}>
          {error}
        </p>
      )}
      {result && (
        <p
          className="mt-2 rounded-lg px-3 py-2 text-sm"
          style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }}
        >
          {result}
        </p>
      )}

      {rows !== null && rows.length > 0 && (
        <>
          <button
            onClick={nudge}
            disabled={busy}
            className="mt-2 w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: 'var(--brand)' }}
          >
            {busy ? 'Nudging…' : `Nudge all ${new Set(rows.map((r) => r.guardian_id)).size}`}
          </button>
          {/* Said before the button, because a coach pressing this wants to
              know it will not arrive at eleven at night. */}
          <p className="mt-1.5 text-xs text-ink-3">
            One notification each, held until morning if it is late. Pressing it again today tells
            nobody twice.
          </p>
        </>
      )}
    </div>
  )
}
