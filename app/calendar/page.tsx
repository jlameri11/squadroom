import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { CalendarList, type UpcomingEvent } from './calendar-list'
import { AppShellPage } from '@/components/shell-page'

export default async function CalendarPage() {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) redirect('/signin')

  const { data: academies } = await supabase.from('academies').select('id, name').order('name')
  const academy = academies?.[0]
  if (!academy) redirect('/start')

  const { data: events } = await supabase.rpc('my_upcoming_events', {
    p_academy: academy.id,
    p_days: 60,
  })

  return (
    <AppShellPage title="Fixtures" meta={`${academy.name} · next 60 days`}>
      <div className="border-b px-4 py-3" style={{ borderColor: 'var(--line-2)' }}>
        <a href="/scan" className="text-sm underline underline-offset-4" style={{ color: 'var(--brand)' }}>
          Add games from a screenshot
        </a>
      </div>
      <CalendarList academyId={academy.id} events={(events ?? []) as UpcomingEvent[]} />
    </AppShellPage>
  )
}
