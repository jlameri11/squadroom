import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Home, type HomeChannel, type HomeEvent } from './home'

/**
 * The front door.
 *
 * Signed out → sign in. Signed in but belonging to nothing → found one.
 * Otherwise: what is coming up, then the rooms you are in, then the things
 * your role actually lets you do.
 *
 * Thin by design — see AGENTS.md. All the UI is in home.tsx.
 */
export default async function Page() {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) redirect('/signin')

  const { data: profile } = await supabase.rpc('my_profile')
  const needsPhone = !profile?.[0]?.phone

  // RLS returns only academies this person belongs to, so no filter here.
  const { data: academies } = await supabase
    .from('academies')
    .select('id, name, slug, type, primary_colour, logo_url')
    .order('name')

  if (!academies || academies.length === 0) redirect('/start')
  const academy = academies[0]

  // The role decides what the screen offers. Showing a parent "Collect
  // payments" and letting them find out by tapping is not a menu, it is a
  // maze.
  const { data: membership } = await supabase
    .from('academy_members')
    .select('role')
    .eq('academy_id', academy.id)
    .eq('profile_id', auth.user.id)
    .eq('status', 'active')
    .maybeSingle()

  const [{ data: events }, { data: channels }, { count: pendingRequests }, { data: isAdmin }] =
    await Promise.all([
    supabase.rpc('my_upcoming_events', { p_academy: academy.id, p_days: 21 }),
    supabase.rpc('my_channels', { p_academy: academy.id }),
    supabase
      .from('join_requests')
      .select('id', { count: 'exact', head: true })
      .eq('academy_id', academy.id)
      .eq('status', 'pending'),
    // platform_admins is readable only by the people in it, so a returned
    // row IS the check. There is no public is_platform_admin() — 0016 moved
    // every helper into app_private precisely so PostgREST would not publish
    // them as endpoints.
    supabase.from('platform_admins').select('profile_id').limit(1),
  ])

  return (
    <Home
      academy={academy}
      otherAcademies={academies.slice(1)}
      role={membership?.role ?? 'parent'}
      isPlatformAdmin={(isAdmin?.length ?? 0) > 0}
      needsPhone={needsPhone}
      pendingRequests={pendingRequests ?? 0}
      events={((events ?? []) as HomeEvent[]).slice(0, 4)}
      channels={(channels ?? []) as HomeChannel[]}
    />
  )
}
