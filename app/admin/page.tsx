import { redirect } from 'next/navigation'
import { getUserId } from '@/lib/supabase/server'
import { AdminHub } from './admin-hub'

/**
 * Thin: the sign-in gate, then the browser resolves which organisation is
 * showing (lib/use-current-org) and fetches the queues for it.
 */
export default async function AdminHubPage() {
  const userId = await getUserId()
  if (!userId) redirect('/signin')
  return <AdminHub />
}
