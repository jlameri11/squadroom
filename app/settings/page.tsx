import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ProfileForm } from './profile-form'

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) redirect('/signin')

  // Your own number is only readable through this function: 0012 revoked the
  // column from the table grant so nobody can read anyone else's.
  const { data } = await supabase.rpc('my_profile')
  const me = data?.[0]

  return (
    <main className="mx-auto max-w-md p-5">
      <h1 className="text-2xl font-semibold" style={{ color: '#202842' }}>Your details</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Your name is what people see on your messages.
      </p>
      <ProfileForm
        initialName={me?.full_name ?? ''}
        initialPhone={me?.phone ?? ''}
        email={auth.user.email ?? null}
      />
    </main>
  )
}
