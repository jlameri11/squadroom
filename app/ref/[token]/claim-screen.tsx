'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export function ClaimScreen({ token }: { token: string }) {
  const router = useRouter()
  const [state, setState] = useState<{ league: string } | { error: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data, error } = await createClient().rpc('claim_referee', { p_token: token })
      if (cancelled) return
      if (error) return setState({ error: error.message })
      const r = data as unknown as { league: string }
      setState({ league: r.league })
      setTimeout(() => router.replace('/referee'), 900)
    })()
    return () => {
      cancelled = true
    }
  }, [token, router])

  if (!state) return <p className="p-5 text-center text-sm text-ink-3">One moment…</p>
  if ('error' in state) {
    return (
      <div className="p-5">
        <p className="card p-5 text-center text-sm" style={{ color: 'var(--no)' }}>{state.error}</p>
      </div>
    )
  }
  return (
    <div className="p-5">
      <p className="card p-5 text-center text-sm">
        You&apos;re in <b>{state.league}</b>&apos;s referee pool. Taking you to your games…
      </p>
    </div>
  )
}
