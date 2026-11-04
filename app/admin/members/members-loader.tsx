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

  useEffect(() => {
    if (!org) return
    let live = true
    ;(async () => {
      const { data: tree } = await createClient().rpc('academy_invite_tree', { p_academy: org.id })
      if (!live) return
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
      <MemberTree academyId={org.id} rows={rows} />
    </div>
  )
}
