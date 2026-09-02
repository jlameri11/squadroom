import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Home, type HomeChannel, type HomeEvent } from './home'

/**
 * The front door.
 *
 * One database call, deliberately. Netlify runs this in us-east-2 and
 * Supabase is in Sydney, so every round trip costs about 250ms — the whole
 * screen used to make seven, several of them serial, which is why it took a
 * second and a half to show anything.
 *
 * Thin by design (see AGENTS.md): fetch, hand to a client component, stop.
 */
export default async function Page() {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('home_screen')

  if (error) {
    console.error('home_screen failed', error)
    redirect('/signin')
  }

  const home = data as unknown as {
    profile: { phone: string | null } | null
    academy: {
      id: string
      name: string
      slug: string
      type: string
      primary_colour: string
      logo_url: string | null
    } | null
    role: string | null
    other_academies: { id: string; name: string; type: string }[]
    is_platform_admin: boolean
    pending_requests: number
    events: HomeEvent[]
    channels: HomeChannel[]
  } | null

  if (!home) redirect('/signin')
  if (!home.academy) redirect('/start')

  return (
    <Home
      academy={home.academy}
      otherAcademies={home.other_academies ?? []}
      role={home.role ?? 'parent'}
      isPlatformAdmin={home.is_platform_admin}
      needsPhone={!home.profile?.phone}
      pendingRequests={home.pending_requests ?? 0}
      events={home.events ?? []}
      channels={home.channels ?? []}
    />
  )
}
