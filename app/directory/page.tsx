import { redirect } from 'next/navigation'
import { createClient, getUserId } from '@/lib/supabase/server'
import { DirectoryList } from './directory-list'

export default async function DirectoryPage() {
  const supabase = await createClient()
  const userId = await getUserId()
  if (!userId) redirect('/signin')

  const { data: academies } = await supabase
    .from('academies')
    .select('id, name, dm_policy')
    .order('name')
  const academy = academies?.[0]
  if (!academy) redirect('/start')

  const [{ data: people }, { data: me }] = await Promise.all([
    supabase.rpc('member_directory', { p_academy: academy.id }),
    supabase
      .from('academy_members')
      .select('role')
      .eq('academy_id', academy.id)
      .eq('profile_id', userId)
      .maybeSingle(),
  ])

  const iAmStaff = me?.role === 'owner' || me?.role === 'admin' || me?.role === 'coach'

  return (
    <main className="mx-auto max-w-md">
      <header className="border-b border-[var(--line)] p-5">
        <h1 className="text-2xl font-semibold" style={{ color: 'var(--brand)' }}>Directory</h1>
        <p className="mt-0.5 text-sm text-ink-2">
          {academy.name} · {people?.length ?? 0} people
        </p>
      </header>

      <DirectoryList
        academyId={academy.id}
        myId={userId}
        iAmStaff={iAmStaff}
        dmPolicy={academy.dm_policy}
        people={(people ?? []).map((p) => ({
          id: p.profile_id,
          name: p.full_name,
          role: p.role,
          phone: p.phone,
          teams: p.teams ?? [],
        }))}
      />
    </main>
  )
}
