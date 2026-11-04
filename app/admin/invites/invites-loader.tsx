'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useCurrentOrg } from '@/lib/use-current-org'
import { ScreenSkeleton } from '@/components/screen-skeleton'
import { InviteList } from './invite-list'

type Invite = { id: string; name: string; phone: string; role: string; status: string; invitedBy: string | null; createdAt: string }
type Request = { id: string; name: string; phone: string | null; status: string; createdAt: string }

function nameOf(rel: unknown): string | null {
  const one = Array.isArray(rel) ? rel[0] : rel
  return (one as { full_name?: string } | null)?.full_name ?? null
}

/** Invites and join requests of the organisation the browser is showing. */
export function InvitesLoader() {
  const org = useCurrentOrg()
  const [data, setData] = useState<{ invites: Invite[]; requests: Request[] } | null>(null)

  useEffect(() => {
    if (!org) return
    let live = true
    ;(async () => {
      const supabase = createClient()
      const [{ data: invites }, { data: requests }] = await Promise.all([
        supabase
          .from('invites')
          .select('id, full_name, phone, role, status, created_at, invited_by, profiles!invites_invited_by_fkey(full_name)')
          .eq('academy_id', org.id)
          .order('created_at', { ascending: false })
          .limit(50),
        supabase.from('join_requests').select('id, full_name, phone, status, created_at').eq('academy_id', org.id).order('created_at', { ascending: false }).limit(50),
      ])
      if (!live) return
      setData({
        invites: (invites ?? []).map((i) => ({ id: i.id, name: i.full_name ?? i.phone, phone: i.phone, role: i.role, status: i.status, invitedBy: nameOf(i.profiles), createdAt: i.created_at })),
        requests: (requests ?? []).map((r) => ({ id: r.id, name: r.full_name, phone: r.phone, status: r.status, createdAt: r.created_at })),
      })
    })()
    return () => {
      live = false
    }
  }, [org])

  if (!org || !data) return <ScreenSkeleton />
  return (
    <div className="p-4" data-org={org.id}>
      <InviteList invites={data.invites} requests={data.requests} />
    </div>
  )
}
