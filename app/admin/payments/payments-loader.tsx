'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useCurrentOrg } from '@/lib/use-current-org'
import { ScreenSkeleton } from '@/components/screen-skeleton'
import { PaymentsAdmin, type RequestRow, type BillingStatus } from './payments-admin'

type Loaded = { billing: BillingStatus; requests: RequestRow[]; teams: { id: string; name: string }[] }

/**
 * Which club's money. The organisation the browser is showing, then its
 * billing row (RLS: staff only — an empty result means "not set up" or
 * "not your business", and for a parent who typed the URL those should
 * look the same), its open requests and its squads.
 */
export function PaymentsAdminLoader() {
  const org = useCurrentOrg()
  const [data, setData] = useState<Loaded | null>(null)

  useEffect(() => {
    if (!org) return
    let live = true
    ;(async () => {
      const supabase = createClient()
      const [{ data: billing }, { data: requests }, { data: teams }] = await Promise.all([
        supabase
          .from('academy_billing')
          .select('stripe_account_id, charges_enabled, payouts_enabled, details_submitted')
          .eq('academy_id', org.id)
          .maybeSingle(),
        supabase
          .from('payment_requests')
          .select('id, title, amount_cents, currency, due_on, per_player, team_id, archived_at, teams(name)')
          .eq('academy_id', org.id)
          .is('archived_at', null)
          .order('created_at', { ascending: false }),
        supabase.from('teams').select('id, name').eq('academy_id', org.id).eq('status', 'active').order('name'),
      ])
      if (live) setData({ billing: (billing ?? null) as BillingStatus, requests: (requests ?? []) as unknown as RequestRow[], teams: teams ?? [] })
    })()
    return () => {
      live = false
    }
  }, [org])

  if (!org || !data) return <ScreenSkeleton />
  return (
    <div data-org={org.id}>
      <PaymentsAdmin academyId={org.id} academyName={org.name} billing={data.billing} requests={data.requests} teams={data.teams} />
    </div>
  )
}
