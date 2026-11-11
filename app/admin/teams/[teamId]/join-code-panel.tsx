'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Code = { join_code: string; slug: string | null; competition: string; members: number; squad_size: number | null; pay_mode: 'split' | 'captain' | null; captain: boolean }

/**
 * Team Creator (0261): a captain's team's code, on its own page, for the
 * captain and whoever runs the team. Teammates land on the link, give a
 * name and a mobile, and are in. Nothing here for a club's squad.
 */
export function JoinCodePanel({ teamId }: { teamId: string }) {
  const [code, setCode] = useState<Code | null | undefined>(undefined)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    let live = true
    ;(async () => {
      const { data } = await createClient().rpc('team_join_code', { p_team: teamId })
      if (live) setCode((data as unknown as Code | null) ?? null)
    })()
    return () => {
      live = false
    }
  }, [teamId])
  if (!code) return null
  const link = `${typeof window !== 'undefined' ? window.location.origin : ''}/c/${code.slug ?? ''}/team/${code.join_code}`
  return (
    <section className="card mb-3 p-3.5" data-join-code-panel={code.join_code}>
      <div className="sect">
        <span className="eyebrow">Your team&apos;s code</span>
        <span className="text-xs text-ink-3">{code.members}{code.squad_size ? ` of ${code.squad_size}` : ''} in</span>
      </div>
      <p className="mt-1 text-sm text-ink-2">{code.competition}. Share it — each teammate lands on the link, gives a name and a mobile, and is on the team{code.pay_mode === 'split' ? ' with their share of the fee to pay in the app' : ''}.</p>
      <div className="mt-2 flex items-center gap-2">
        <span className="display flex-1 rounded-xl px-3 py-2 text-center text-[1.5rem] tracking-[0.2em]" style={{ background: 'var(--surface-2)' }}>{code.join_code}</span>
        <button
          onClick={async () => { await navigator.clipboard.writeText(link).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
          className="flex-none rounded-xl border px-3 py-2 text-sm font-semibold"
          style={{ borderColor: 'var(--brand)', color: 'var(--brand-text)' }}
          data-copy-team-code
        >
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>
    </section>
  )
}
