import { redirect } from 'next/navigation'
import { getUserId } from '@/lib/supabase/server'
import { AppShellPage } from '@/components/shell-page'
import { SeasonScreen } from './season-screen'

/**
 * Admin → New season. Thin: the screen resolves the organisation the
 * browser is showing (lib/org) and asks preview_season_rollover /
 * roll_over_season / rollover_report, each of which refuses anyone but an
 * admin.
 *
 * NOT "the first academy by name". A server page cannot see which
 * organisation the browser has chosen, and this owner belongs to three —
 * one of them a stray called "NRIFA" with no squads, which sorted first and
 * gave the first screenshot an empty From box.
 */
export default async function SeasonPage() {
  const userId = await getUserId()
  if (!userId) redirect('/signin')
  return (
    <AppShellPage title="New season" back="/admin">
      <SeasonScreen />
    </AppShellPage>
  )
}
