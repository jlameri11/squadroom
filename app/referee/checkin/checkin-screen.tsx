'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export function CheckinScreen({ fixtureId, keyValue }: { fixtureId: string; keyValue: string }) {
  const [state, setState] = useState<{ game: string; at: string } | { error: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!fixtureId || !keyValue) return setState({ error: 'That code is incomplete. Ask for it again.' })
      const { data, error } = await createClient().rpc('referee_check_in_by_key', { p_fixture: fixtureId, p_key: keyValue })
      if (cancelled) return
      if (error) return setState({ error: error.message })
      const r = data as unknown as { game: string; checked_in_at: string }
      setState({ game: r.game, at: r.checked_in_at })
    })()
    return () => {
      cancelled = true
    }
  }, [fixtureId, keyValue])

  if (!state) return <p className="p-5 text-center text-sm text-ink-3">Checking you in…</p>
  return (
    <div className="p-5">
      {'error' in state ? (
        <p className="card p-5 text-center text-sm" style={{ color: 'var(--no)' }}>{state.error}</p>
      ) : (
        <p className="card p-5 text-center text-sm">
          <b>Checked in</b> to {state.game} at {new Date(state.at).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}.
        </p>
      )}
      <p className="mt-3 text-center text-sm">
        <Link href="/referee" className="underline underline-offset-4" style={{ color: 'var(--brand-text)' }}>Your games ›</Link>
      </p>
    </div>
  )
}
