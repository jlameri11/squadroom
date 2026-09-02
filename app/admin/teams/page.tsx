import { redirect } from 'next/navigation'
import { createClient, getUserId } from '@/lib/supabase/server'
import { TeamList } from './team-list'
import { NewTeam } from './new-team'
import { AppShellPage } from '@/components/shell-page'

/**
 * Thin on purpose. Fetch, shape, hand to a client component.
 *
 * Capacitor cannot run a server component, so anything rendered directly in
 * one has to be rewritten for the native build. Keeping pages to fetch-and-
 * pass means that rewrite is a handful of wrappers rather than every screen.
 */
export default async function TeamsPage() {
  const supabase = await createClient()
  const userId = await getUserId()
  if (!userId) redirect('/signin')

  const { data: academies } = await supabase.from('academies').select('id, name').order('name')
  const academy = academies?.[0]
  if (!academy) redirect('/start')

  const { data: teams } = await supabase
    .from('teams')
    .select('id, name, age_group, season, status, team_members(count), players(count)')
    .eq('academy_id', academy.id)
    .order('age_group')

  return (
    <AppShellPage title="Teams" back="/admin" action={<NewTeam academyId={academy.id} />}>
      <div className="p-4">

      <TeamList
        teams={(teams ?? []).map((t) => ({
          id: t.id,
          name: t.name,
          ageGroup: t.age_group,
          season: t.season,
          status: t.status,
          memberCount: countOf(t.team_members),
          playerCount: countOf(t.players),
        }))}
      />
    </div>
    </AppShellPage>
  )
}

/** PostgREST returns aggregate counts as [{count: n}]. */
function countOf(rel: unknown): number {
  if (Array.isArray(rel)) return (rel[0] as { count?: number } | undefined)?.count ?? 0
  return (rel as { count?: number } | null)?.count ?? 0
}
