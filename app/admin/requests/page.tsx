import { redirect } from 'next/navigation'
import { createClient, getUserId } from '@/lib/supabase/server'
import { RequestList } from './request-list'
import { AppShellPage } from '@/components/shell-page'

/**
 * The coach's queue. Everything a parent typed, and the two buttons that
 * decide it.
 *
 * No authorisation code here beyond "are you signed in": RLS on
 * join_requests already limits the rows to academies this person runs and
 * teams they coach. If the list is empty for a parent, that is the database
 * enforcing it, not this page remembering to.
 */
export default async function RequestsPage() {
  const supabase = await createClient()

  const userId = await getUserId()
  if (!userId) redirect('/signin')

  const { data: requests } = await supabase
    .from('join_requests')
    .select('id, full_name, phone, children_names, created_at, status, teams(name), academies(name)')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })

  return (
    <AppShellPage title="Join requests">
      <div className="p-4">

      <RequestList
        initial={(requests ?? []).map((r) => ({
          id: r.id,
          fullName: r.full_name,
          phone: r.phone,
          children: r.children_names ?? [],
          team: firstOf(r.teams)?.name ?? null,
          academy: firstOf(r.academies)?.name ?? null,
        }))}
      />
    </div>
    </AppShellPage>
  )
}

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}
