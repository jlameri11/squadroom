'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useCurrentOrg } from '@/lib/use-current-org'
import { ScreenSkeleton } from '@/components/screen-skeleton'
import { MemberTree } from './member-tree'

type Row = { profileId: string; fullName: string; role: string; status: string; inviterName: string | null; depth: number }

/** The invite tree of the organisation the browser is showing. The function returns nothing unless the caller is staff. */
export function MembersLoader() {
  const org = useCurrentOrg()
  const [rows, setRows] = useState<Row[] | null>(null)
  // 0214: this organisation's members' emails — for its own owners and
  // admins only (member_emails refuses anyone else); none before 0214.
  const [emails, setEmails] = useState<Record<string, { email: string; verified: boolean }>>({})
  // 0272: members whose name the migration split on its own and found odd —
  // one word, more than three — for the club to check.
  const [nameChecks, setNameChecks] = useState<Record<string, { first: string; last: string }>>({})

  useEffect(() => {
    if (!org) return
    let live = true
    ;(async () => {
      const supabase = createClient()
      const [{ data: tree }, { data: mail }, { data: checks }] = await Promise.all([
        supabase.rpc('academy_invite_tree', { p_academy: org.id }),
        supabase.rpc('member_emails', { p_academy: org.id }),
        supabase.rpc('names_to_check', { p_academy: org.id }),
      ])
      if (!live) return
      setEmails(Object.fromEntries((mail ?? []).map((m) => [m.profile_id, { email: m.email, verified: m.verified }])))
      const flagged = (checks as unknown as { profile_id: string; first_name: string; last_name: string }[] | null) ?? []
      setNameChecks(Object.fromEntries(flagged.map((f) => [f.profile_id, { first: f.first_name, last: f.last_name }])))
      setRows(
        ((tree ?? []) as Record<string, unknown>[]).map((r) => ({
          profileId: r.profile_id as string,
          fullName: (r.full_name as string) || 'Unnamed',
          role: r.role as string,
          status: r.status as string,
          inviterName: (r.inviter_name as string | null) ?? null,
          depth: r.depth as number,
        }))
      )
    })()
    return () => {
      live = false
    }
  }, [org])

  if (!org || !rows) return <ScreenSkeleton />
  return (
    <div className="p-4" data-org={org.id}>
      <MemberTree academyId={org.id} rows={rows} emails={emails} nameChecks={nameChecks} />
    </div>
  )
}
