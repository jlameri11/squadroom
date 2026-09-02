'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

/**
 * Ending a season archives the team's channels rather than deleting them.
 *
 * Two seasons of a parent asking "what time is the game?" is also two seasons
 * of photos and arrangements. Nothing here destroys any of it.
 */
export function SeasonControl({ teamId, status }: { teamId: string; status: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ended = status === 'ended'

  async function setStatus(next: 'active' | 'ended') {
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { error } = await supabase
      .from('teams')
      .update({ status: next, ended_at: next === 'ended' ? new Date().toISOString() : null })
      .eq('id', teamId)
    setBusy(false)
    setConfirming(false)
    if (error) return setError(error.message)
    router.refresh()
  }

  return (
    <section className="mt-7 rounded-xl border border-[var(--line)] p-4">
      <h2 className="font-semibold">{ended ? 'Season ended' : 'End of season'}</h2>
      <p className="mt-1 text-sm text-ink-2">
        {ended
          ? 'Channels are read-only. Everything said and shared is still there.'
          : 'Makes this team’s channels read-only. Nothing is deleted, and you can reopen it.'}
      </p>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {ended ? (
        <button
          onClick={() => setStatus('active')}
          disabled={busy}
          className="mt-3 w-full rounded-xl border border-[var(--line)] px-4 py-2.5 text-sm font-medium disabled:opacity-50"
        >
          {busy ? 'Reopening…' : 'Reopen the season'}
        </button>
      ) : confirming ? (
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => setStatus('ended')}
            disabled={busy}
            className="flex-1 rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? 'Ending…' : 'Yes, end the season'}
          </button>
          <button onClick={() => setConfirming(false)} className="rounded-xl border border-[var(--line)] px-4 py-2.5 text-sm">
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          className="mt-3 w-full rounded-xl border border-[var(--line)] px-4 py-2.5 text-sm font-medium"
        >
          End the season
        </button>
      )}
    </section>
  )
}
