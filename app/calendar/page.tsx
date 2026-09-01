import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { CalendarList, type UpcomingEvent } from './calendar-list'

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
    <main className="mx-auto max-w-md">
      <header className="border-b border-neutral-200 p-5">
        <h1 className="text-2xl font-semibold" style={{ color: '#202842' }}>Fixtures</h1>
        <p className="mt-0.5 text-sm text-neutral-500">
          {academy.name} · next 60 days
        </p>
      </header>
      <CalendarList
        academyId={academy.id}
        events={(events ?? []) as UpcomingEvent[]}
      />
    </main>
  )
}
