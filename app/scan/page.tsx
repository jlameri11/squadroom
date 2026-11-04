import { redirect } from 'next/navigation'
import { getUserId } from '@/lib/supabase/server'
import { ScanLoader } from './scan-loader'

/**
 * Thin by design — see AGENTS.md. Everything below this is a client
 * component, so the Capacitor build only has to replace this file. The
 * browser picks the organisation (scan-loader).
 */
export default async function ScanPage() {
  const userId = await getUserId()
  if (!userId) redirect('/signin')
  return <ScanLoader />
}
