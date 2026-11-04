import { redirect } from 'next/navigation'
import { getUserId } from '@/lib/supabase/server'
import { PlayersImportLoader } from './players-loader'

/** Thin: the sign-in gate; the browser picks the organisation (players-loader). */
export default async function ImportPlayersPage() {
  const userId = await getUserId()
  if (!userId) redirect('/signin')
  return <PlayersImportLoader />
}
