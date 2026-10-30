import { redirect } from 'next/navigation'
import { getUserId } from '@/lib/supabase/server'
import { AppShellPage } from '@/components/shell-page'
import { LeagueImport } from './league-import'

/**
 * L-14: a league brings its draw from a file it exported itself. Thin: the
 * screen reads the file in the browser, maps columns with a human, and
 * calls import_league_draw, which checks that this person runs the
 * competition.
 */
export default async function LeagueImportPage(props: { params: Promise<{ competitionId: string }> }) {
  const { competitionId } = await props.params
  const userId = await getUserId()
  if (!userId) redirect(`/signin?next=/competitions/${competitionId}/import`)
  return (
    <AppShellPage title="Import a draw" meta="From a file the league exported" back={`/competitions/${competitionId}`}>
      <LeagueImport competitionId={competitionId} />
    </AppShellPage>
  )
}
