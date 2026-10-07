'use client'

import { useCallback, useEffect, useState } from 'react'
import { TeamList, type TeamSummary } from './team-list'
import { NewTeam } from './new-team'
import { AppBar, Screen } from '@/components/app-shell'
import { ScreenSkeleton } from '@/components/screen-skeleton'
import { createClient } from '@/lib/supabase/client'

/**
 * The squads, and the one screen where a new one has to appear instantly.
 *
 * It used to be server-rendered and refreshed with router.refresh() after a
 * create, which the client router cache could serve stale — so a coach made a
 * team, came back, and did not see it. Fetching here means the create can
 * simply ask for the list again, and it is the same answer every time.
 */
export function TeamsScreen() {
  const [academy, setAcademy] = useState<{ id: string; name: string } | null>(null)
  const [teams, setTeams] = useState<TeamSummary[] | null>(null)

  const load = useCallback(async (academyId: string) => {
    const supabase = createClient()
    const { data } = await supabase
      .from('teams')
      .select('id, name, age_group, season, status, team_members(count), players(count)')
      .eq('academy_id', academyId)
    setTeams(
      (data ?? []).map((t) => ({
        id: t.id,
        name: t.name,
        ageGroup: t.age_group,
        season: t.season,
        status: t.status,
        memberCount: countOf(t.team_members),
        playerCount: countOf(t.players),
      }))
    )
  }, [])

  useEffect(() => {
    const supabase = createClient()
    ;(async () => {
      const { data: claims } = await supabase.auth.getClaims()
      if (!claims?.claims?.sub) return window.location.replace('/signin')
      const { data: academies } = await supabase.from('academies').select('id, name').order('name')
      const first = academies?.[0]
      if (!first) return window.location.replace('/start')
      setAcademy(first)
      await load(first.id)
    })()
  }, [load])

  if (!academy || !teams) return <ScreenSkeleton />

  const active = teams.filter((t) => t.status === 'active').length

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
      <AppBar
        title="Teams"
        meta={`${active} active · ${academy.name}`}
        back="/admin"
        action={<NewTeam academyId={academy.id} onCreated={() => load(academy.id)} />}
      />
      <Screen>
        <div className="p-3.5">
          <TeamList teams={teams} />
        </div>
      </Screen>
    </div>
  )
}

/** PostgREST returns aggregate counts as [{count: n}]. */
function countOf(rel: unknown): number {
  if (Array.isArray(rel)) return (rel[0] as { count?: number } | undefined)?.count ?? 0
  return (rel as { count?: number } | null)?.count ?? 0
}
