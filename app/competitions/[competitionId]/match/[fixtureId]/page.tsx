import { redirect } from 'next/navigation'
import { getUserId } from '@/lib/supabase/server'
import { AppShellPage } from '@/components/shell-page'
import { MatchSheet } from './match-sheet'

/**
 * One game, from both sides: the sheets, the events, the score, the log.
 * Thin: match_sheet_view (0151) decides who may see it and what they may
 * do, and every write is a function with its own rule.
 */
export default async function MatchPage(props: {
  params: Promise<{ competitionId: string; fixtureId: string }>
}) {
  const userId = await getUserId()
  const { competitionId, fixtureId } = await props.params
  if (!userId) redirect(`/signin?next=/competitions/${competitionId}/match/${fixtureId}`)
  return (
    <AppShellPage title="Match sheet" back={`/competitions/${competitionId}`}>
      <MatchSheet fixtureId={fixtureId} />
    </AppShellPage>
  )
}
