import { redirect } from 'next/navigation'
import { createClient, getUserId } from '@/lib/supabase/server'
import { MemberTree } from './member-tree'
import { AppShellPage } from '@/components/shell-page'

/**
 * Who is in the academy, and who let them in.
 *
 * The tree is the reason invited_by is recorded at all: an owner can see that
 * a coach brought fourteen families, and remove all fifteen in one action if
 * that coach leaves under a cloud.
 */
export default async function MembersPage() {
  const supabase = await createClient()
  const userId = await getUserId()
  if (!userId) redirect('/signin')

  const { data: academies } = await supabase
    .from('academies')
    .select('id, name')
    .order('name')

  const academy = academies?.[0]
  if (!academy) redirect('/start')

  // Returns nothing unless you are staff — the function checks, not this page.
  const { data: tree } = await supabase.rpc('academy_invite_tree', {
    p_academy: academy.id,
  })

  return (
    <AppShellPage title="Members">
      <div className="p-4">

      <MemberTree
        academyId={academy.id}
        rows={(tree ?? []).map((r: Record<string, unknown>) => ({
          profileId: r.profile_id as string,
          fullName: (r.full_name as string) || 'Unnamed',
          role: r.role as string,
          status: r.status as string,
          inviterName: (r.inviter_name as string | null) ?? null,
          depth: r.depth as number,
        }))}
      />
    </div>
    </AppShellPage>
  )
}
