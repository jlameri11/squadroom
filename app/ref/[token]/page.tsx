import { redirect } from 'next/navigation'
import { getUserId } from '@/lib/supabase/server'
import { AppShellPage } from '@/components/shell-page'
import { ClaimScreen } from './claim-screen'

/**
 * A referee's link, opened once. Signed out, it goes through sign-in and
 * comes back here; signed in, the screen claims the pool row and sends
 * them to their games.
 */
export default async function ClaimRefereePage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params
  const userId = await getUserId()
  if (!userId) redirect(`/signin?next=/ref/${token}`)
  return (
    <AppShellPage title="Refereeing">
      <ClaimScreen token={token} />
    </AppShellPage>
  )
}
