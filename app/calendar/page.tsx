import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { CalendarList, type UpcomingEvent } from './calendar-list'
import { AppShellPage } from '@/components/shell-page'

/** One round trip. See 0068. */
export default async function CalendarPage() {
  const supabase = await createClient()
  const { data } = await supabase.rpc('fixtures_screen', { p_days: 60 })

  const screen = data as unknown as {
    academy: { id: string; name: string } | null
    is_staff: boolean
    events: UpcomingEvent[]
  } | null

  if (!screen) redirect('/signin')
  if (!screen.academy) redirect('/start')

  return (
    <AppShellPage
      title="Fixtures"
      meta={`${screen.academy.name} · next 60 days`}
      isStaff={screen.is_staff}
    >
      <div className="border-b px-4 py-3" style={{ borderColor: 'var(--line-2)' }}>
        <a href="/scan" className="text-sm underline underline-offset-4" style={{ color: 'var(--brand)' }}>
          Add games from a screenshot
        </a>
      </div>
      <CalendarList academyId={screen.academy.id} events={screen.events ?? []} />
    </AppShellPage>
  )
}
