'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useCurrentOrg } from '@/lib/use-current-org'
import { ScreenSkeleton } from '@/components/screen-skeleton'
import { PaymentsList, type Owing } from './payments-list'

/**
 * A family's bills at the club the browser is showing. A parent whose
 * children are at two clubs used to see whichever sorted first, with no
 * way to the other.
 */
export function FamilyPaymentsLoader() {
  const org = useCurrentOrg()
  const params = useSearchParams()
  const [owing, setOwing] = useState<Owing[] | null>(null)
  // 0264: the club takes Active & Creative Kids vouchers (a provider).
  const [activeKids, setActiveKids] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!org) return
    let live = true
    ;(async () => {
      const supabase = createClient()
      const [{ data }, { data: club }] = await Promise.all([
        supabase.rpc('my_payment_requests', { p_academy: org.id }),
        supabase.from('academies').select('active_kids_provider').eq('id', org.id).maybeSingle(),
      ])
      if (live) {
        setOwing((data ?? []) as Owing[])
        setActiveKids(Boolean((club as { active_kids_provider?: boolean } | null)?.active_kids_provider))
      }
    })()
    return () => {
      live = false
    }
  }, [org, tick])

  if (!org || !owing) return <ScreenSkeleton />
  return (
    <main className="mx-auto max-w-md" data-org={org.id}>
      <header className="border-b border-[var(--line)] p-5">
        <h1 className="text-2xl font-semibold" style={{ color: 'var(--brand-text)' }}>Payments</h1>
        <p className="mt-0.5 text-sm text-ink-2">{org.name}</p>
      </header>
      <PaymentsList owing={owing} justPaid={params.get('paid') === '1'} cancelled={params.get('cancelled') === '1'} onChanged={() => setTick((t) => t + 1)} activeKidsProvider={activeKids} />
    </main>
  )
}
