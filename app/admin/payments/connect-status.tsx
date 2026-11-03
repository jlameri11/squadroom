'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

/**
 * Where the club's Stripe account is up to, read back on demand: Accounts v2
 * raise no classic webhook, so this asks when the owner comes back from
 * onboarding (?connect=return) and whenever the screen opens unfinished.
 */
export function ConnectStatus({ academyId, started, ready }: { academyId: string; started: boolean; ready: boolean }) {
  const router = useRouter()
  const params = useSearchParams()
  const [note, setNote] = useState<string | null>(null)
  const cameBack = params.get('connect') === 'return'

  useEffect(() => {
    if (!started || (ready && !cameBack)) return
    let live = true
    ;(async () => {
      const res = await fetch(`/api/payments/connect?academyId=${academyId}`)
      const data = await res.json().catch(() => null)
      if (!live || !res.ok) return
      if (data?.charges_enabled && !ready) {
        setNote('Stripe is connected. Families can pay.')
        router.refresh()
      } else if (!data?.charges_enabled) {
        setNote(data?.requirements?.outstanding ? `Stripe still needs ${data.requirements.outstanding} thing${data.requirements.outstanding === 1 ? '' : 's'} from the club.` : 'Stripe is still checking the club’s details.')
      }
    })()
    return () => {
      live = false
    }
  }, [academyId, started, ready, cameBack, router])

  if (!note) return null
  return <p className="mt-2 text-xs" style={{ color: 'var(--brand-text)' }} data-connect-status>{note}</p>
}
