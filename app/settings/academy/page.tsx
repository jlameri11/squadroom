import { redirect } from 'next/navigation'
import { createClient, getUserId } from '@/lib/supabase/server'
import { AcademySettings } from './academy-settings'
import { AppShellPage } from '@/components/shell-page'

export default async function AcademySettingsPage() {
  const supabase = await createClient()
  const userId = await getUserId()
  if (!userId) redirect('/signin')

  const { data: academies } = await supabase
    .from('academies')
    .select('id, name, dm_policy, directory_visibility, primary_colour, name')
    .order('name')
  const academy = academies?.[0]
  if (!academy) redirect('/start')

  const { data: me } = await supabase
    .from('academy_members')
    .select('role')
    .eq('academy_id', academy.id)
    .eq('profile_id', userId)
    .maybeSingle()

  const isStaff = me?.role === 'owner' || me?.role === 'admin'

  return (
    <AppShellPage title="Club settings">
      <div className="p-4">
      <p className="mt-1 text-sm text-ink-2">{academy.name}</p>

      {isStaff ? (
        <AcademySettings
          academyId={academy.id}
          dmPolicy={academy.dm_policy}
          primaryColour={academy.primary_colour}
      academyName={academy.name}
      directoryVisibility={academy.directory_visibility}
        />
      ) : (
        <p className="mt-5 rounded-xl bg-[var(--surface-2)] p-5 text-center text-sm text-ink-2">
          Only owners and admins can change these.
        </p>
      )}
    </div>
    </AppShellPage>
  )
}
