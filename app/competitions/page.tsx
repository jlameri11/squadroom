import { redirect } from 'next/navigation'
import { createClient, getUserId } from '@/lib/supabase/server'
import { AppShellPage } from '@/components/shell-page'
import { CompetitionsList, type CompRow } from './competitions-list'

export default async function CompetitionsPage() {
  const supabase = await createClient()
  const userId = await getUserId()
  if (!userId) redirect('/signin')

  // RLS returns competitions you organise or your club has entered.
  const { data: comps } = await supabase
    .from('competitions')
    .select('id, name, type, season, organiser, starts_on, ends_on, status, organiser_id, academies!organiser_id(name)')
    .order('starts_on', { ascending: false })

  const rows: CompRow[] = (comps ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    type: c.type,
    season: c.season,
    status: c.status,
    runBy: orgName(c.academies) ?? c.organiser,
  }))

  return (
    <AppShellPage title="Competitions">
      <CompetitionsList comps={rows} />
    </AppShellPage>
  )
}

function orgName(rel: unknown): string | null {
  const one = Array.isArray(rel) ? rel[0] : rel
  return (one as { name?: string } | null)?.name ?? null
}
