import { redirect } from 'next/navigation'
import { getUserId } from '@/lib/supabase/server'
import { PaymentsAdminLoader } from './payments-loader'

/**
 * Thin: the sign-in gate; the browser resolves which organisation is
 * showing and fetches its money (payments-loader). This page used to take
 * "the first academy by name", which for an owner of several was a club
 * nobody uses.
 */
export default async function AdminPaymentsPage() {
  const userId = await getUserId()
  if (!userId) redirect('/signin')
  return <PaymentsAdminLoader />
}
