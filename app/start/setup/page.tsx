import { redirect } from 'next/navigation'
import { getUserId } from '@/lib/supabase/server'
import { SetupChecklist } from './setup-checklist'

/**
 * G-01: the first half hour of a club. Thin — setup_progress decides what
 * is done from the data, and every step is a page that already exists.
 */
export default async function SetupPage() {
  const userId = await getUserId()
  if (!userId) redirect('/signin?next=/start/setup')
  return <SetupChecklist />
}
