import { redirect } from 'next/navigation'
import { getUserId } from '@/lib/supabase/server'
import { PlayfootballImport } from './playfootball-import'

/**
 * R-18: tick off PlayFootball registrations from the club's own export.
 *
 * A static shell; the browser resolves which organisation (lib/org) and
 * fetches. Never a login to PlayFootball — a file a club admin downloaded
 * from their own account, and nothing else, ever crosses.
 */
export default async function ImportPlayfootballPage() {
  const userId = await getUserId()
  if (!userId) redirect('/signin')
  return <PlayfootballImport />
}
