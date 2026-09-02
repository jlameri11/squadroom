import { redirect } from 'next/navigation'
import { createClient, getUserId } from '@/lib/supabase/server'
import { InviteList } from './invite-list'
import { AppShellPage } from '@/components/shell-page'

/**
 * Who has been invited, by whom, and whether they turned up.
 *
 * "Sent" here means a row exists — it does not mean anything was delivered.
 * Onboarding sends nothing by text; these are the fallback invites for
 * families who never tapped the group link, and the list says so.
 */
export default async function InvitesPage() {
  const supabase = await createClient()
  const userId = await getUserId()
  if (!userId) redirect('/signin')

  const { data: academies } = await supabase.from('academies').select('id, name').order('name')
  const academy = academies?.[0]
  if (!academy) redirect('/start')

  const [{ data: invites }, { data: requests }] = await Promise.all([
    supabase
      .from('invites')
      .select('id, full_name, phone, role, status, created_at, invited_by, profiles!invites_invited_by_fkey(full_name)')
      .eq('academy_id', academy.id)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('join_requests')
      .select('id, full_name, phone, status, created_at')
      .eq('academy_id', academy.id)
      .order('created_at', { ascending: false })
      .limit(50),
  ])

  return (
    <AppShellPage title="Invites" back="/admin">
      <div className="p-4">

      <InviteList
        invites={(invites ?? []).map((i) => ({
          id: i.id,
          name: i.full_name ?? i.phone,
          phone: i.phone,
          role: i.role,
          status: i.status,
          invitedBy: nameOf(i.profiles),
          createdAt: i.created_at,
        }))}
        requests={(requests ?? []).map((r) => ({
          id: r.id,
          name: r.full_name,
          phone: r.phone,
          status: r.status,
          createdAt: r.created_at,
        }))}
      />
    </div>
    </AppShellPage>
  )
}

function nameOf(rel: unknown): string | null {
  const one = Array.isArray(rel) ? rel[0] : rel
  return (one as { full_name?: string } | null)?.full_name ?? null
}
