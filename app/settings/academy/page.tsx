import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AcademySettings } from './academy-settings'

export default async function AcademySettingsPage() {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) redirect('/signin')

  const { data: academies } = await supabase
    .from('academies')
    .select('id, name, dm_policy, directory_visibility')
    .order('name')
  const academy = academies?.[0]
  if (!academy) redirect('/start')

  const { data: me } = await supabase
    .from('academy_members')
    .select('role')
    .eq('academy_id', academy.id)
    .eq('profile_id', auth.user.id)
    .maybeSingle()

  const isStaff = me?.role === 'owner' || me?.role === 'admin'

  return (
    <main className="mx-auto max-w-md p-5">
      <h1 className="text-2xl font-semibold" style={{ color: '#202842' }}>Academy settings</h1>
      <p className="mt-1 text-sm text-neutral-500">{academy.name}</p>

      {isStaff ? (
        <AcademySettings
          academyId={academy.id}
          dmPolicy={academy.dm_policy}
          directoryVisibility={academy.directory_visibility}
        />
      ) : (
        <p className="mt-5 rounded-xl bg-neutral-100 p-5 text-center text-sm text-neutral-500">
          Only owners and admins can change these.
        </p>
      )}
    </main>
  )
}
