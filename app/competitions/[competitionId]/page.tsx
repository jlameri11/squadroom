import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { CompetitionView, type Fixture, type LadderRow } from './competition-view'

export default async function CompetitionPage(props: {
  params: Promise<{ competitionId: string }>
}) {
  const { competitionId } = await props.params
  const supabase = await createClient()

  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) redirect('/signin')

  const { data: comp } = await supabase
    .from('competitions')
    .select('id, name, type, season, organiser, organiser_id, starts_on, status, mode')
    .eq('id', competitionId)
    .maybeSingle()

  if (!comp) notFound()

  const [{ data: sheet }, { data: entries }, { data: me }] = await Promise.all([
    supabase.rpc('competition_run_sheet', { p_competition: competitionId }),
    supabase
      .from('competition_entries')
      .select('id, display_name, division, group_label, academy_id')
      .eq('competition_id', competitionId)
      .order('division')
      .order('group_label')
      .order('display_name'),
    supabase
      .from('academy_members')
      .select('role')
      .eq('academy_id', comp.organiser_id)
      .eq('profile_id', auth.user.id)
      .maybeSingle(),
  ])

  const isOrganiser = me?.role === 'owner' || me?.role === 'admin'
  const divisions = [...new Set((entries ?? []).map((e) => e.division))]

  // One ladder per division, computed rather than stored.
  const ladders: Record<string, LadderRow[]> = {}
  for (const d of divisions) {
    const { data } = await supabase.rpc('competition_ladder', {
      p_competition: competitionId,
      p_division: d,
    })
    ladders[d] = (data ?? []) as LadderRow[]
  }

  return (
    <main className="mx-auto max-w-md">
      <header className="border-b border-neutral-200 p-5">
        <Link href="/competitions" className="text-sm text-neutral-500">← Competitions</Link>
        <h1 className="mt-2 text-2xl font-semibold" style={{ color: '#202842' }}>{comp.name}</h1>
        <p className="mt-0.5 text-sm capitalize text-neutral-500">
          {[comp.type.replace('_', ' '), comp.organiser, comp.season].filter(Boolean).join(' · ')}
        </p>
      </header>

      <CompetitionView
        competitionId={comp.id}
        mode={comp.mode}
        isOrganiser={isOrganiser}
        divisions={divisions}
        fixtures={(sheet ?? []) as Fixture[]}
        ladders={ladders}
        entries={(entries ?? []).map((e) => ({
          id: e.id,
          name: e.display_name,
          division: e.division,
          group: e.group_label,
          signedUp: e.academy_id !== null,
        }))}
      />
    </main>
  )
}
