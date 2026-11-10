'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useCurrentOrg } from '@/lib/use-current-org'
import { ScreenSkeleton } from '@/components/screen-skeleton'

type Kind = 'club' | 'streams' | 'age_groups' | 'teams' | 'staff' | 'unpaid' | 'unregistered' | 'playfootball'
type Audience = { kind: Kind; ids?: string[]; age_groups?: string[] }
type Sent = {
  id: string; body: string; audience: Audience; pinned: boolean; relevant_until: string | null; urgent: boolean
  status: string; created_at: string; sent_at: string | null; sender_name: string; recipients: number; seen: number; notified: number
}

const KINDS: { kind: Kind; label: string; hint: string }[] = [
  { kind: 'club', label: 'Whole club', hint: 'Every member' },
  { kind: 'streams', label: 'Streams', hint: 'Everyone on the teams in a stream' },
  { kind: 'age_groups', label: 'Age groups', hint: 'Everyone on the teams in an age group' },
  { kind: 'teams', label: 'Teams', hint: 'Everyone on a team' },
  { kind: 'staff', label: 'Staff only', hint: 'Owners, admins, coaches and every role-holder' },
  { kind: 'unpaid', label: 'Unpaid', hint: 'Families who owe a fee' },
  { kind: 'unregistered', label: 'Not yet re-registered', hint: 'Last season’s players not yet back' },
  { kind: 'playfootball', label: 'PlayFootball not done', hint: 'Families whose PlayFootball registration is pending' },
]

/**
 * Write once; pick who; see "This will reach 1,240 people"; send. The
 * database says which audiences are yours (President and Secretary:
 * anyone; Treasurer: unpaid; Registrar: not re-registered and PlayFootball;
 * coordinators: their groups; managers: their team) and fans the pushes out
 * in batches after your tap returns. Pin it, give it an "until" day; urgent
 * is for safety and call-offs and ignores quiet hours.
 */
export function MessageClub() {
  const org = useCurrentOrg()
  const [kind, setKind] = useState<Kind>('club')
  const [ids, setIds] = useState<string[]>([])
  const [groups, setGroups] = useState<string[]>([])
  const [body, setBody] = useState('')
  const [pinned, setPinned] = useState(false)
  const [until, setUntil] = useState('')
  const [urgent, setUrgent] = useState(false)
  const [preview, setPreview] = useState<{ allowed: boolean; count: number } | null>(null)
  const [streams, setStreams] = useState<{ id: string; name: string }[]>([])
  const [teams, setTeams] = useState<{ id: string; name: string; age_group: string }[]>([])
  const [sent, setSent] = useState<Sent[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const audience: Audience = kind === 'teams' || kind === 'streams' ? { kind, ids } : kind === 'age_groups' ? { kind, age_groups: groups } : { kind }

  useEffect(() => {
    if (!org) return
    let live = true
    ;(async () => {
      const supabase = createClient()
      const [{ data: st }, { data: tm }, { data: list }] = await Promise.all([
        supabase.from('streams').select('id, name').eq('academy_id', org.id).order('sort_order').order('name'),
        supabase.from('teams').select('id, name, age_group').eq('academy_id', org.id).eq('status', 'active').order('age_group').order('name'),
        supabase.rpc('club_messages_sent', { p_academy: org.id }),
      ])
      if (!live) return
      setStreams((st as { id: string; name: string }[] | null) ?? [])
      setTeams((tm as { id: string; name: string; age_group: string }[] | null) ?? [])
      setSent((list as unknown as Sent[] | null) ?? [])
    })()
    return () => {
      live = false
    }
  }, [org])

  // The count follows the audience as it is picked.
  const audienceKey = JSON.stringify(audience)
  useEffect(() => {
    if (!org) return
    let live = true
    ;(async () => {
      const { data } = await createClient().rpc('preview_club_message', { p_academy: org.id, p_audience: JSON.parse(audienceKey) })
      if (live) setPreview((data as unknown as { allowed: boolean; count: number } | null) ?? null)
    })()
    return () => {
      live = false
    }
  }, [org, audienceKey])

  if (!org || sent === null) return <ScreenSkeleton />

  const ageGroups = [...new Set(teams.map((t) => t.age_group))]
  const toggle = (list: string[], v: string, set: (next: string[]) => void) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  async function send() {
    if (!org) return
    setBusy(true)
    setError(null)
    setDone(null)
    const { data, error } = await createClient().rpc('send_club_message', {
      p_academy: org.id,
      p_body: body.trim(),
      p_audience: audience as never,
      p_pinned: pinned,
      p_until: until ? new Date(until + 'T23:59:59').toISOString() : undefined,
      p_urgent: urgent,
    })
    setBusy(false)
    if (error) return setError(error.message)
    setDone(`Sent to ${preview?.count ?? 0} people. Pushes go out in batches over the next minute or two.`)
    setBody('')
    setPinned(false)
    setUntil('')
    setUrgent(false)
    void data
    const { data: list } = await createClient().rpc('club_messages_sent', { p_academy: org.id })
    setSent((list as unknown as Sent[] | null) ?? [])
  }

  async function reping(id: string) {
    const { data, error } = await createClient().rpc('reping_club_message', { p_message: id })
    if (error) return setError(error.message)
    setDone(`Re-pinged ${data as number} people who had not opened it.`)
  }

  const when = (iso: string) => new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

  return (
    <div className="p-4" data-message-club>
      <h2 className="eyebrow px-1 pb-2">Who</h2>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Audience">
        {KINDS.map((k) => (
          <button
            key={k.kind}
            onClick={() => { setKind(k.kind); setIds([]); setGroups([]) }}
            aria-pressed={kind === k.kind}
            className="min-w-fit rounded-full border px-3 py-1.5 text-xs font-semibold"
            style={kind === k.kind ? { background: 'var(--brand)', color: 'var(--brand-ink)', borderColor: 'var(--brand)' } : { borderColor: 'var(--line)', background: 'var(--surface)', color: 'var(--ink-2)' }}
            data-audience={k.kind}
          >
            {k.label}
          </button>
        ))}
      </div>
      <p className="mt-1 px-1 text-xs text-ink-3">{KINDS.find((k) => k.kind === kind)?.hint}</p>

      {kind === 'streams' && (
        <div className="mt-2 flex flex-wrap gap-2" data-pick-streams>
          {streams.length === 0 && <span className="text-xs text-ink-3">No streams yet — set them up in Club settings.</span>}
          {streams.map((s) => (
            <button key={s.id} onClick={() => toggle(ids, s.id, setIds)} aria-pressed={ids.includes(s.id)} className="min-w-fit rounded-lg border px-3 py-1.5 text-xs" style={ids.includes(s.id) ? { background: 'var(--brand)', color: 'var(--brand-ink)', borderColor: 'var(--brand)' } : { borderColor: 'var(--line)' }}>
              {s.name}
            </button>
          ))}
        </div>
      )}
      {kind === 'age_groups' && (
        <div className="mt-2 flex flex-wrap gap-2" data-pick-age-groups>
          {ageGroups.map((g) => (
            <button key={g} onClick={() => toggle(groups, g, setGroups)} aria-pressed={groups.includes(g)} className="min-w-fit rounded-lg border px-3 py-1.5 text-xs" style={groups.includes(g) ? { background: 'var(--brand)', color: 'var(--brand-ink)', borderColor: 'var(--brand)' } : { borderColor: 'var(--line)' }}>
              {g}
            </button>
          ))}
        </div>
      )}
      {kind === 'teams' && (
        <div className="mt-2 flex flex-wrap gap-2" data-pick-teams>
          {teams.map((t) => (
            <button key={t.id} onClick={() => toggle(ids, t.id, setIds)} aria-pressed={ids.includes(t.id)} className="min-w-fit rounded-lg border px-3 py-1.5 text-xs" style={ids.includes(t.id) ? { background: 'var(--brand)', color: 'var(--brand-ink)', borderColor: 'var(--brand)' } : { borderColor: 'var(--line)' }}>
              {t.name}
            </button>
          ))}
        </div>
      )}

      <p className="mt-3 rounded-xl border p-3 text-sm" style={{ borderColor: preview?.allowed === false ? 'var(--no)' : 'var(--line)' }} data-reach={preview?.count ?? ''} data-allowed={preview?.allowed === false ? 'no' : 'yes'}>
        {preview === null ? 'Counting…'
          : !preview.allowed ? 'That audience is not yours to message.'
          : preview.count === 0 ? 'This would reach nobody yet — pick a stream, age group or team.'
          : <>This will reach <b>{preview.count.toLocaleString('en-AU')}</b> {preview.count === 1 ? 'person' : 'people'}.</>}
      </p>

      <h2 className="eyebrow mt-5 px-1 pb-2">What</h2>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value.slice(0, 4000))}
        rows={5}
        className="w-full rounded-xl border px-3 py-3 text-sm"
        style={{ borderColor: 'var(--line)' }}
        placeholder="Write it once. Plain words; the push shows the first 140 characters."
        aria-label="Your message"
        data-message-body
      />
      <div className="mt-2 flex flex-wrap gap-3 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} className="h-4 w-4" data-message-pin /> Pin it</label>
        <label className="flex items-center gap-2">Until <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="rounded-lg border px-2 py-1 text-sm" style={{ borderColor: 'var(--line)' }} aria-label="Relevant until" data-message-until /></label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} className="h-4 w-4" data-message-urgent /> Urgent <span className="text-xs text-ink-3">(safety and call-offs only; ignores quiet hours)</span></label>
      </div>
      {error && <p className="mt-2 rounded-lg p-2 text-sm" style={{ background: 'var(--no-bg)', color: 'var(--no)' }} role="alert">{error}</p>}
      {done && <p className="mt-2 rounded-lg p-2 text-sm" style={{ background: 'var(--yes-bg)', color: 'var(--yes)' }} data-message-done>{done}</p>}
      <button onClick={send} disabled={busy || !body.trim() || !preview?.allowed || (preview?.count ?? 0) === 0} className="mt-3 w-full rounded-xl px-4 py-3 font-semibold text-brand-ink disabled:opacity-50" style={{ background: 'var(--brand)' }} data-message-send>
        {busy ? 'Sending…' : `Send to ${preview?.count?.toLocaleString('en-AU') ?? '…'}`}
      </button>

      <h2 className="eyebrow mt-6 px-1 pb-2">Sent</h2>
      {sent.length === 0 ? (
        <p className="card p-4 text-sm text-ink-2">Nothing sent yet.</p>
      ) : (
        <ul className="card divide-y overflow-hidden text-sm" style={{ borderColor: 'var(--line-2)' }} data-sent-list>
          {sent.map((m) => (
            <li key={m.id} className="px-4 py-3" data-sent={m.id}>
              <span className="block">{m.body.length > 140 ? m.body.slice(0, 140) + '…' : m.body}</span>
              <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-3">
                <span>{KINDS.find((k) => k.kind === m.audience?.kind)?.label ?? 'Club'} · {m.sender_name} · {when(m.created_at)}</span>
                {m.pinned && <span className="pill">pinned</span>}
                {m.urgent && <span className="pill" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>urgent</span>}
                <span data-seen-of={`${m.seen}/${m.recipients}`}>Seen by {m.seen} of {m.recipients}{m.status !== 'sent' ? ` · ${m.notified} told so far` : ''}</span>
                {m.recipients > m.seen && m.status === 'sent' && (
                  <button onClick={() => reping(m.id)} className="tap underline underline-offset-2" data-reping={m.id}>Re-ping the unseen</button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
