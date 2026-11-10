'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useCurrentOrg } from '@/lib/use-current-org'
import { ScreenSkeleton } from '@/components/screen-skeleton'
import { FEATURES, forgetFeatures, type FeatureKey } from '@/lib/features'

const CORE = ['Chat and notices', 'Fixtures and availability', 'Team sheets and match sheets', 'Registration and payments', 'Roles', 'Safeguarding', 'Branding', 'Offline scores', 'Message the club']

export function FeaturesScreen() {
  const org = useCurrentOrg()
  const [off, setOff] = useState<Set<string> | null>(null)
  const [mayFlip, setMayFlip] = useState<boolean | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!org) return
    let live = true
    ;(async () => {
      const supabase = createClient()
      const [{ data: offList }, { data: access }] = await Promise.all([
        supabase.rpc('features_off', { p_academy: org.id }),
        supabase.rpc('my_club_access', { p_academy: org.id }),
      ])
      if (!live) return
      setOff(new Set((offList as string[] | null) ?? []))
      const areas = ((access as { areas?: string[] } | null)?.areas ?? []) as string[]
      setMayFlip(areas.includes('staff') || areas.includes('club'))
    })()
    return () => {
      live = false
    }
  }, [org])

  if (!org || off === null || mayFlip === null) return <ScreenSkeleton />

  async function flip(key: FeatureKey, enabled: boolean) {
    if (!org) return
    setBusy(key)
    setError(null)
    const { error } = await createClient().rpc('set_feature', { p_academy: org.id, p_feature: key, p_enabled: enabled })
    setBusy(null)
    if (error) return setError(error.message)
    const next = new Set(off)
    if (enabled) next.delete(key)
    else next.add(key)
    setOff(next)
    forgetFeatures(org.id)
  }

  return (
    <div className="p-4" data-features-screen>
      <p className="text-sm text-ink-2">
        Everything here is on unless you turn it off. Off means it appears nowhere — no empty tab, button or settings row. Core stays on.
      </p>
      {!mayFlip && <p className="mt-2 text-xs text-ink-3">Only the people who run {org.name} change these.</p>}
      {error && <p className="mt-2 rounded-lg p-2 text-sm" style={{ background: 'var(--no-bg)', color: 'var(--no)' }} role="alert">{error}</p>}

      <h2 className="eyebrow mt-5 px-1 pb-2">Switchable</h2>
      <ul className="card divide-y overflow-hidden text-sm" style={{ borderColor: 'var(--line-2)' }} data-features-list>
        {FEATURES.map((f) => {
          const on = !off.has(f.key)
          return (
            <li key={f.key} className="flex items-center justify-between gap-3 px-4 py-3" data-feature={f.key} data-feature-on={on ? 'on' : 'off'}>
              <span className="min-w-0">
                <span className="block font-medium">
                  {f.label}
                  {f.builtYet === false && <span className="pill ml-2">to come</span>}
                </span>
                <span className="block text-xs text-ink-3">{f.what}</span>
              </span>
              <button
                onClick={() => flip(f.key, !on)}
                disabled={!mayFlip || busy !== null}
                role="switch"
                aria-checked={on}
                aria-label={`${f.label}: ${on ? 'on' : 'off'}`}
                className="h-6 w-11 flex-none rounded-full p-0.5 transition disabled:opacity-60"
                style={{ background: on ? 'var(--yes)' : 'var(--line)' }}
                data-feature-switch={f.key}
              >
                <span className="block h-5 w-5 rounded-full bg-white transition" style={{ transform: on ? 'translateX(20px)' : 'translateX(0)' }} />
              </button>
            </li>
          )
        })}
      </ul>

      <h2 className="eyebrow mt-6 px-1 pb-2">Core — always on</h2>
      <ul className="card divide-y overflow-hidden text-sm" style={{ borderColor: 'var(--line-2)' }}>
        {CORE.map((c) => (
          <li key={c} className="px-4 py-2.5 text-ink-2">{c}</li>
        ))}
      </ul>
    </div>
  )
}
