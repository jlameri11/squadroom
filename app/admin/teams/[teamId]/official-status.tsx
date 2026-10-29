'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export type OfficialStatus = 'unknown' | 'pending' | 'registered' | 'not_required'

export const STATUS_LABEL: Record<OfficialStatus, string> = {
  unknown: 'PlayFootball: not checked',
  pending: 'PlayFootball: pending',
  registered: 'PlayFootball: registered',
  not_required: 'PlayFootball: not needed',
}

/**
 * Whether this child is registered with PlayFootball — the official,
 * Football-Australia-side registration that makes them eligible, which
 * Squadroom never does and only tracks (R-14).
 *
 * Set by a human, on the roster, because there is no API to ask: a club
 * checks PlayFootball and marks what it saw. The FFA number is recorded
 * alongside because that is the thing they are looking at when they do.
 */
export function OfficialStatusControl({
  playerId,
  status: initial,
  ffNumber: initialNumber,
}: {
  playerId: string
  status: OfficialStatus
  ffNumber: string | null
}) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<OfficialStatus>(initial)
  const [number, setNumber] = useState(initialNumber ?? '')
  const [saved, setSaved] = useState({ status: initial, number: initialNumber ?? '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setBusy(true)
    setError(null)
    const { error } = await createClient().rpc('set_official_status', {
      p_player: playerId,
      p_status: status,
      p_ff_number: number.trim() || undefined,
    })
    setBusy(false)
    if (error) return setError(error.message)
    setSaved({ status, number: number.trim() })
    setOpen(false)
  }

  const colour =
    saved.status === 'registered' || saved.status === 'not_required'
      ? 'var(--yes)'
      : saved.status === 'pending'
        ? 'var(--maybe)'
        : 'var(--ink-3)'

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-0.5 block text-xs underline underline-offset-2"
        style={{ color: colour }}
      >
        {STATUS_LABEL[saved.status]}
        {saved.number ? ` · ${saved.number}` : ''}
      </button>
    )
  }

  return (
    <div className="mt-2 rounded-lg border p-2.5" style={{ borderColor: 'var(--line)' }}>
      <label className="flex items-center gap-2 text-xs">
        <span className="w-20 flex-none text-ink-2">PlayFootball</span>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as OfficialStatus)}
          className="flex-1 rounded-lg border px-2 py-1.5 text-sm"
          style={{ borderColor: 'var(--line)' }}
        >
          <option value="unknown">Not checked</option>
          <option value="pending">Pending — family has started</option>
          <option value="registered">Registered</option>
          <option value="not_required">Not needed for this squad</option>
        </select>
      </label>
      <label className="mt-1.5 flex items-center gap-2 text-xs">
        <span className="w-20 flex-none text-ink-2">FFA number</span>
        <input
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          inputMode="numeric"
          placeholder="as shown in PlayFootball"
          className="flex-1 rounded-lg border px-2 py-1.5 text-sm tabular-nums"
          style={{ borderColor: 'var(--line)' }}
        />
      </label>
      {error && (
        <p className="mt-1.5 text-xs" style={{ color: 'var(--no)' }}>
          {error}
        </p>
      )}
      <div className="mt-2 flex gap-2">
        <button
          onClick={save}
          disabled={busy}
          className="flex-1 rounded-lg px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
          style={{ background: 'var(--brand)' }}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={() => {
            setStatus(saved.status)
            setNumber(saved.number)
            setOpen(false)
          }}
          className="rounded-lg border px-3 py-2 text-xs"
          style={{ borderColor: 'var(--line)' }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
