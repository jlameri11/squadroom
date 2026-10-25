'use client'

import { useEffect, useState } from 'react'
import { CalendarList, type UpcomingEvent } from './calendar-list'
import { NewSessions } from './new-sessions'
import { createClient } from '@/lib/supabase/client'
import { AppBar, Screen } from '@/components/app-shell'
import { ScreenSkeleton } from '@/components/screen-skeleton'
import { useScreen } from '@/lib/hooks/use-screen'
import { useOrg } from '@/lib/org'

type Data = {
  academy: { id: string; name: string } | null
  is_staff: boolean
  events: UpcomingEvent[]
}

export function FixturesScreen() {
  const org = useOrg()
  const { data, failed } = useScreen<Data>('fixtures_screen', { p_days: 60, p_academy: org })
  const [adding, setAdding] = useState(false)
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([])

  // Only fetched once a coach opens the sheet — a parent never needs the team
  // list, and this screen is the most-opened one in the product.
  useEffect(() => {
    if (!adding || !data?.academy || teams.length > 0) return
    createClient()
      .from('teams')
      .select('id, name')
      .eq('academy_id', data.academy.id)
      .eq('status', 'active')
      .order('name')
      .then(({ data: rows }) => setTeams(rows ?? []))
  }, [adding, data?.academy, teams.length])

  if (failed) {
    return (
      <div className="mx-auto grid min-h-dvh w-full max-w-md place-items-center p-6">
        <p className="text-center text-sm text-ink-2">Couldn&apos;t load your fixtures.</p>
      </div>
    )
  }
  if (!data?.academy) return <ScreenSkeleton />

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
      <AppBar
        title="Fixtures"
        meta={`${data.academy.name} · next 60 days`}
        action={
          data.is_staff && (
            <button
              onClick={() => setAdding(true)}
              className="flex-none rounded-[10px] px-3 py-1.5 text-sm font-semibold"
              style={{ background: '#ffffff26', color: 'var(--brand-ink)' }}
            >
              Add
            </button>
          )
        }
      />
      <Screen>
        {data.is_staff && (
          <div
            className="flex items-center gap-4 border-b px-4 py-3"
            style={{ borderColor: 'var(--line-2)' }}
          >
            <button
              onClick={() => setAdding(true)}
              className="text-sm underline underline-offset-4"
              style={{ color: 'var(--brand)' }}
            >
              Add weekly training
            </button>
            <a
              href="/scan"
              className="text-sm underline underline-offset-4"
              style={{ color: 'var(--brand)' }}
            >
              Add games from a screenshot
            </a>
          </div>
        )}
        <CalendarList academyId={data.academy.id} events={data.events ?? []} />
      </Screen>

      {adding && data.academy && (
        <NewSessions
          academyId={data.academy.id}
          teams={teams}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  )
}
