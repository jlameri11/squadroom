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

  useEffect(() => {
    if (!org) return
    let live = true
    ;(async () => {
      const { data } = await createClient().rpc('my_payment_requests', { p_academy: org.id })
      if (live) setOwing((data ?? []) as Owing[])
    })()
    return () => {
      live = false
    }
  }, [org])

  if (!org || !owing) return <ScreenSkeleton />
  return (
    <main className="mx-auto max-w-md" data-org={org.id}>
      <header className="border-b border-[var(--line)] p-5">
        <h1 className="text-2xl font-semibold" style={{ color: 'var(--brand-text)' }}>Payments</h1>
        <p className="mt-0.5 text-sm text-ink-2">{org.name}</p>
      </header>
      <PaymentsList owing={owing} justPaid={params.get('paid') === '1'} cancelled={params.get('cancelled') === '1'} />
    </main>
  )
}
