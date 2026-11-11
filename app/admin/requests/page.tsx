import { redirect } from 'next/navigation'
import { createClient, getUserId } from '@/lib/supabase/server'
import { RequestList } from './request-list'
import { RoleRequests } from './role-requests'
import { WhenOn } from '@/components/when-on'
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
    <AppShellPage title="Requests" back="/admin">
      <div className="p-4">

      {/* 0256: members asking for a role — the committee's to decide. */}
      <WhenOn feature="role_requests"><RoleRequests /></WhenOn>

      <div className="sect">
        <span className="eyebrow">Join requests</span>
        <span className="text-xs text-ink-3">{(requests ?? []).length === 0 ? 'none waiting' : `${(requests ?? []).length} waiting`}</span>
      </div>
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
