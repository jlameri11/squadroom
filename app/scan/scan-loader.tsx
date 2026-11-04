'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useCurrentOrg } from '@/lib/use-current-org'
import { ScreenSkeleton } from '@/components/screen-skeleton'
import { ScanClient, type CoachedTeam } from './scan-client'

/**
 * The scan screen for the organisation the browser is showing, offering
 * only the squads this person coaches there. RLS returns more than that,
 * so the filter is explicit: offering to share with a team you cannot post
 * to would produce a button that always fails.
 */
export function ScanLoader() {
  const org = useCurrentOrg()
  const [teams, setTeams] = useState<CoachedTeam[] | null>(null)

  useEffect(() => {
    if (!org) return
    let live = true
    ;(async () => {
      const { data: coached } = await createClient().from('team_members').select('team_id, role, teams(id, name, academy_id)').eq('profile_id', org.userId).eq('role', 'coach')
      if (!live) return
      type T = { id: string; name: string; academy_id: string }
      setTeams(
        (coached ?? [])
          .map((row) => (Array.isArray(row.teams) ? row.teams[0] : row.teams) as T | null)
          .filter((t): t is T => !!t)
          .filter((t) => t.academy_id === org.id)
          .map((t) => ({ id: t.id, name: t.name }))
      )
    })()
    return () => {
      live = false
    }
  }, [org])

  if (!org || !teams) return <ScreenSkeleton />
  return (
    <div data-org={org.id}>
      <ScanClient academyId={org.id} academyName={org.name} timezone={org.timezone} teams={teams} />
    </div>
  )
}
