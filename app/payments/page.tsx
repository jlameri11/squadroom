import { redirect } from 'next/navigation'
import { getUserId } from '@/lib/supabase/server'
import { FamilyPaymentsLoader } from './payments-loader'

/** Thin: the sign-in gate; the browser picks the organisation (payments-loader). */
export default async function PaymentsPage() {
  const userId = await getUserId()
  if (!userId) redirect('/signin')
  return <FamilyPaymentsLoader />
}
