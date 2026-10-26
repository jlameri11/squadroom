import { redirect } from 'next/navigation'
import { createClient, getUserId } from '@/lib/supabase/server'
import { PlayersImport } from './players-import'

export default async function ImportPlayersPage() {
  const supabase = await createClient()
  const userId = await getUserId()
  if (!userId) redirect('/signin')

  const { data: academies } = await supabase.from('academies').select('id, name').order('name')
  const academy = academies?.[0]
  if (!academy) redirect('/start')

  const { data: teams } = await supabase
    .from('teams')
    .select('id, name, season')
    .eq('academy_id', academy.id)
    .eq('status', 'active')
    .order('name')

  // Whatever season the club's active squads are in, so the shirt-number
  // field is prefilled with the answer rather than with this calendar year —
  // a club running a 2027 season in late 2026 should not have to retype it.
  const seasons = (teams ?? []).map((t) => t.season).filter(Boolean) as string[]
  const defaultSeason = seasons.sort()[seasons.length - 1] ?? String(new Date().getFullYear())

  return (
    <PlayersImport
      academyId={academy.id}
      academyName={academy.name}
      teams={teams ?? []}
      defaultSeason={defaultSeason}
    />
  )
}
