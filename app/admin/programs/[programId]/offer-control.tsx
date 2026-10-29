'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export type TrialOffer = {
  id: string
  trial_registration_id: string
  player_id: string
  squad_program: string
  squad_program_id: string
  expires_at: string
  state: 'open' | 'accepted' | 'declined' | 'lapsed'
}

/**
 * After a trial: offer this child a place in a squad.
 *
 * One row per trialist who was in the trial. The squad is a squad PROGRAM
 * (open, kind 'squad'), because that is where the fee and the capacity
 * live; the number of days is how long the family has. Making it again
 * extends it, which is also how a lapsed one is revived.
 */
export function OfferControl({
  registrationId,
  squadPrograms,
  existing,
  onMade,
}: {
  registrationId: string
  squadPrograms: { id: string; name: string }[]
  existing: TrialOffer | undefined
  onMade: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [program, setProgram] = useState(existing?.squad_program_id ?? squadPrograms[0]?.id ?? '')
  const [days, setDays] = useState(7)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function make() {
    setBusy(true)
    setError(null)
    const { error } = await createClient().rpc('make_offer', {
      p_registration: registrationId,
      p_squad_program: program,
      p_days: days,
    })
    setBusy(false)
    if (error) return setError(error.message)
    setOpen(false)
    await onMade()
  }

  const colour =
    existing?.state === 'accepted' ? 'var(--yes)' : existing?.state === 'open' ? 'var(--maybe)' : 'var(--ink-3)'

  if (!open) {
    return (
      <div className="flex flex-none flex-col items-end gap-0.5">
        {existing && (
          <span className="text-xs" style={{ color: colour }}>
            {existing.state === 'open'
              ? `offered · by ${new Date(existing.expires_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}`
              : existing.state}
          </span>
        )}
        {existing?.state !== 'accepted' && squadPrograms.length > 0 && (
          <button
            onClick={() => setOpen(true)}
            className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-white"
            style={{ background: 'var(--brand)' }}
          >
            {existing ? 'Offer again' : 'Offer a place'}
          </button>
        )}
        {squadPrograms.length === 0 && !existing && (
          <span className="text-xs text-ink-3">open a squad program first</span>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-none flex-col gap-1.5">
      <select
        value={program}
        onChange={(e) => setProgram(e.target.value)}
        className="max-w-[160px] rounded-lg border px-1.5 py-1.5 text-xs"
        style={{ borderColor: 'var(--line)' }}
        aria-label="Squad program"
      >
        {squadPrograms.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-1 text-xs text-ink-2">
        for
        <input
          type="number"
          min={1}
          max={60}
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="w-12 rounded-lg border px-1.5 py-1 text-xs tabular-nums"
          style={{ borderColor: 'var(--line)' }}
          aria-label="Days to accept"
        />
        days
      </label>
      {error && <span className="text-xs" style={{ color: 'var(--no)' }}>{error}</span>}
      <div className="flex gap-1">
        <button onClick={make} disabled={busy || !program} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand)' }}>
          {busy ? '…' : 'Offer'}
        </button>
        <button onClick={() => setOpen(false)} className="rounded-lg border px-2 py-1.5 text-xs" style={{ borderColor: 'var(--line)' }}>
          Cancel
        </button>
      </div>
    </div>
  )
}
