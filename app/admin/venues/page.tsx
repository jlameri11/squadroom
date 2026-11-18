import { redirect } from 'next/navigation'
import { getUserId } from '@/lib/supabase/server'
import { AppShellPage } from '@/components/shell-page'
import { VenuesScreen } from './venues-screen'

/**
 * Admin → Venues and pitches (L-29). Thin: the screen resolves the
 * organisation the browser is showing (lib/org) and draws from
 * venue_layout; every change goes through a function that refuses anyone
 * but the club's staff.
 */
export default async function VenuesPage(props: { searchParams: Promise<{ back?: string }> }) {
  const userId = await getUserId()
  if (!userId) redirect('/signin')
  // 0287: reached from a competition's Setup tab too — Back goes where they came from.
  const { back } = await props.searchParams
  const backTo = back && /^\/competitions\/[0-9a-f-]{36}(\?tab=[a-z]+)?$/.test(back) ? back : '/admin'
  return (
    <AppShellPage title="Venues and pitches" back={backTo}>
      <VenuesScreen />
    </AppShellPage>
  )
}
