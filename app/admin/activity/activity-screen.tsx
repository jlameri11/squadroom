'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useCurrentOrg } from '@/lib/use-current-org'
import { ScreenSkeleton } from '@/components/screen-skeleton'
import { roleLabel } from '../roles/roles-screen'

type Entry = {
  id: number
  actor_id: string | null
  action: string
  subject_kind: string | null
  subject_id: string | null
  subject_name: string | null
  detail: Record<string, unknown>
  at: string
  profiles: { full_name: string | null } | { full_name: string | null }[] | null
}

const PAGE = 60

/** One line per change, in plain words. */
export function describe(e: Entry): string {
  const d = e.detail ?? {}
  const who = e.subject_name ?? 'someone'
  const str = (k: string) => (typeof d[k] === 'string' ? (d[k] as string) : null)
  const change = (k: string) => {
    const v = d[k] as { from?: string | null; to?: string | null } | undefined
    return v ? `${v.from ?? '—'} → ${v.to ?? '—'}` : null
  }
  const dollars = (c: unknown) => (typeof c === 'number' ? `$${(c / 100).toFixed(2)}` : '')
  switch (e.action) {
    case 'role.granted': return `${who} made ${roleLabel(str('role') ?? '')}${str('age_group') ? ` of ${str('age_group')}` : ''}`
    case 'role.revoked': return `${who} no longer ${roleLabel(str('role') ?? '')}`
    case 'member.added': return `${who} joined as ${str('role')}${str('status') === 'pending' ? ' (waiting)' : ''}`
    case 'member.removed': return `${who} removed (${str('role')})`
    case 'member.role_changed': return `${who}: ${change('from') ? '' : ''}${str('from')} → ${str('to')}`
    case 'member.status_changed': return `${who}: ${str('from')} → ${str('to')}`
    case 'team.created': return `Team ${who} made (${str('age_group')}, ${str('season')})`
    case 'team.deleted': return `Team ${who} deleted`
    case 'team.ended': return `Team ${who} ended`
    case 'team.active': return `Team ${who} active again`
    case 'team.changed': return `Team ${who} changed${change('name') ? `: ${change('name')}` : ''}${change('age_group') ? `, age group ${change('age_group')}` : ''}`
    case 'stream.created': return `Stream ${who} made`
    case 'stream.deleted': return `Stream ${who} deleted`
    case 'stream.renamed': return `Stream renamed ${str('from')} → ${str('to')}`
    case 'fee.created': return `Fee “${who}” ${dollars(d.amount_cents)} set`
    case 'fee.changed': return `Fee “${who}” changed (${dollars(d.amount_cents)})`
    case 'fee.deleted': return `Fee “${who}” deleted`
    case 'refund.requested': return `Refund requested, ${dollars(d.amount_cents)}`
    case 'ban.issued': return `${who} banned${str('until') ? ` until ${str('until')}` : ''} — ${str('reason') ?? ''}`
    case 'ban.lifted': return `${who}'s ban lifted${str('note') ? ` — ${str('note')}` : ''}`
    case 'role_request.made': return `${who} asked to be ${str('words') ?? 'given a role'}`
    case 'role_request.approved': return `${who} approved as ${str('words') ?? 'asked'}${str('note') ? ` — “${str('note')}”` : ''}`
    case 'role_request.declined': return `${who}'s request to be ${str('words') ?? 'given a role'} declined${str('note') ? ` — “${str('note')}”` : ''}`
    case 'role_request.withdrawn': return `${who} withdrew their request to be ${str('words') ?? 'given a role'}`
    case 'event.called_off': return `${who} called off${str('reason') ? ` — ${str('reason')}` : ''}`
    case 'event.back_on': return `${who} back on`
    default:
      if (e.action.startsWith('payment.')) return `Payment ${e.action.slice(8)}, ${dollars(d.amount_cents)}`
      if (e.action.startsWith('refund.')) return `Refund ${e.action.slice(7)}, ${dollars(d.amount_cents)}`
      return e.action
  }
}

export function ActivityScreen() {
  const org = useCurrentOrg()
  const [rows, setRows] = useState<Entry[] | null | undefined>(undefined)
  const [more, setMore] = useState(false)

  useEffect(() => {
    if (!org) return
    let live = true
    ;(async () => {
      const { data, error } = await createClient()
        .from('activity_log')
        .select('id, actor_id, action, subject_kind, subject_id, subject_name, detail, at, profiles:actor_id(full_name)')
        .eq('academy_id', org.id)
        .order('at', { ascending: false })
        .limit(PAGE)
      if (!live) return
      setRows(error ? null : ((data as unknown as Entry[]) ?? []))
      setMore((data?.length ?? 0) === PAGE)
    })()
    return () => {
      live = false
    }
  }, [org])

  async function loadMore() {
    if (!org || !rows?.length) return
    const last = rows[rows.length - 1]
    const { data } = await createClient()
      .from('activity_log')
      .select('id, actor_id, action, subject_kind, subject_id, subject_name, detail, at, profiles:actor_id(full_name)')
      .eq('academy_id', org.id)
      .lt('at', last.at)
      .order('at', { ascending: false })
      .limit(PAGE)
    setRows([...rows, ...((data as unknown as Entry[]) ?? [])])
    setMore((data?.length ?? 0) === PAGE)
  }

  if (!org || rows === undefined) return <ScreenSkeleton />
  if (rows === null) {
    return <p className="m-5 rounded-xl bg-[var(--surface-2)] p-5 text-center text-sm text-ink-2">The activity log is for the people who run the club.</p>
  }
  const when = (iso: string) => new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  const actor = (e: Entry) => {
    const p = Array.isArray(e.profiles) ? e.profiles[0] : e.profiles
    return p?.full_name ?? (e.actor_id ? 'Someone' : 'Squadroom')
  }

  return (
    <div className="p-4" data-activity-screen>
      <p className="text-sm text-ink-2">Every admin change — roles, members, teams, fees, payments, refunds, call-offs — with who and when. It stays when the committee changes.</p>
      {rows.length === 0 ? (
        <p className="card mt-3 p-4 text-sm text-ink-2" data-activity-empty>Nothing recorded yet.</p>
      ) : (
        <ul className="card mt-3 divide-y overflow-hidden text-sm" style={{ borderColor: 'var(--line-2)' }} data-activity-list>
          {rows.map((e) => (
            <li key={e.id} className="px-4 py-2.5" data-activity-row={e.action}>
              <span className="block">{describe(e)}</span>
              <span className="block text-xs text-ink-3">{actor(e)} · {when(e.at)}</span>
            </li>
          ))}
        </ul>
      )}
      {more && (
        <button onClick={loadMore} className="mt-3 w-full rounded-xl border px-4 py-2.5 text-sm" style={{ borderColor: 'var(--line)' }}>
          Earlier
        </button>
      )}
    </div>
  )
}
