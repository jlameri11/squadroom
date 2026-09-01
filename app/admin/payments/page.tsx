import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PaymentsAdmin, type RequestRow, type BillingStatus } from './payments-admin'

export default async function AdminPaymentsPage() {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) redirect('/signin')

  const { data: academies } = await supabase.from('academies').select('id, name').order('name')
  const academy = academies?.[0]
  if (!academy) redirect('/start')

  // RLS on academy_billing is staff-only, so an empty result here means
  // either "not set up" or "not your business" — and for a parent who typed
  // this URL, those should look the same.
  const { data: billing } = await supabase
    .from('academy_billing')
    .select('stripe_account_id, charges_enabled, payouts_enabled, details_submitted')
    .eq('academy_id', academy.id)
    .maybeSingle()

  const { data: requests } = await supabase
    .from('payment_requests')
    .select('id, title, amount_cents, currency, due_on, per_player, team_id, archived_at, teams(name)')
    .eq('academy_id', academy.id)
    .is('archived_at', null)
    .order('created_at', { ascending: false })

  const { data: teams } = await supabase
    .from('teams')
    .select('id, name')
    .eq('academy_id', academy.id)
    .eq('status', 'active')
    .order('name')

  return (
    <PaymentsAdmin
      academyId={academy.id}
      academyName={academy.name}
      billing={(billing ?? null) as BillingStatus}
      requests={(requests ?? []) as unknown as RequestRow[]}
      teams={teams ?? []}
    />
  )
}
