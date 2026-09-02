import { redirect } from 'next/navigation'
import { createClient, getUserId } from '@/lib/supabase/server'
import { ScanClient, type CoachedTeam } from './scan-client'

/**
 * Thin by design — see AGENTS.md. Everything below this is a client
 * component, so the Capacitor build only has to replace this file.
 */
export default async function ScanPage() {
  const supabase = await createClient()
  const userId = await getUserId()
  if (!userId) redirect('/signin')

  const { data: academies } = await supabase
    .from('academies')
    .select('id, name, timezone')
    .order('name')
  const academy = academies?.[0]
  if (!academy) redirect('/start')

  // Only teams this person actually coaches. RLS returns more than that, so
  // the filter is explicit: offering to share with a team you cannot post to
  // would produce a button that always fails.
  const { data: coached } = await supabase
    .from('team_members')
    .select('team_id, role, teams(id, name, academy_id)')
    .eq('profile_id', userId)
    .eq('role', 'coach')

  const teams: CoachedTeam[] = (coached ?? [])
    .map((row) => row.teams)
    .filter((t): t is { id: string; name: string; academy_id: string } => !!t)
    .filter((t) => t.academy_id === academy.id)
    .map((t) => ({ id: t.id, name: t.name }))

  return (
    <ScanClient
      academyId={academy.id}
      academyName={academy.name}
      timezone={academy.timezone}
      teams={teams}
    />
  )
}
