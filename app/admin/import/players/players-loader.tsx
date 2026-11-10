'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useCurrentOrg } from '@/lib/use-current-org'
import { ScreenSkeleton } from '@/components/screen-skeleton'
import { PlayersImport, type Team } from './players-import'

/** The roster importer for the organisation the browser is showing, with its active squads. */
export function PlayersImportLoader() {
  const org = useCurrentOrg()
  const [teams, setTeams] = useState<Team[] | null>(null)

  useEffect(() => {
    if (!org) return
    let live = true
    ;(async () => {
      // age_group and label too: a file's "Squad" column says "U12 Red" or
      // "Under 12s", and the match is made against every name a squad goes by.
      const { data } = await createClient()
        .from('teams')
        .select('id, name, season, age_group, label')
        .eq('academy_id', org.id)
        .eq('status', 'active')
        .order('name')
      if (live) setTeams((data ?? []) as Team[])
    })()
    return () => {
      live = false
    }
  }, [org])

  if (!org || !teams) return <ScreenSkeleton />
  // Whatever season the club's active squads are in, so the shirt-number
  // field is prefilled with the answer rather than with this calendar year —
  // a club running a 2027 season in late 2026 should not have to retype it.
  const seasons = teams.map((t) => t.season).filter(Boolean) as string[]
  const defaultSeason = seasons.sort()[seasons.length - 1] ?? String(new Date().getFullYear())
  return (
    <div data-org={org.id}>
      <PlayersImport academyId={org.id} academyName={org.name} teams={teams} defaultSeason={defaultSeason} />
    </div>
  )
}
