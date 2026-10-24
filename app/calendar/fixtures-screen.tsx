'use client'

import { CalendarList, type UpcomingEvent } from './calendar-list'
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
      <AppBar title="Fixtures" meta={`${data.academy.name} · next 60 days`} />
      <Screen>
        <div className="border-b px-4 py-3" style={{ borderColor: 'var(--line-2)' }}>
          <a href="/scan" className="text-sm underline underline-offset-4" style={{ color: 'var(--brand)' }}>
            Add games from a screenshot
          </a>
        </div>
        <CalendarList academyId={data.academy.id} events={data.events ?? []} />
      </Screen>
    </div>
  )
}
