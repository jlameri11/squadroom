'use client'

import { useCallback, useEffect, useState } from 'react'
import { Sheet } from '@/components/sheet'
import { createClient } from '@/lib/supabase/client'
import { getOrg } from '@/lib/org'

type Kind = 'coach' | 'team_manager' | 'volunteer' | 'referee' | 'president' | 'secretary' | 'registrar' | 'treasurer' | 'welfare_officer'
type Team = { id: string; name: string; age_group: string | null }
type Mine = {
  id: string
  kind: Kind
  words: string
  status: 'pending' | 'approved' | 'declined' | 'withdrawn'
  created_at: string
  decided_at: string | null
  decision_note: string | null
  waiting_on_check: boolean
}

const KINDS: { kind: Kind; label: string; squads: 'required' | 'optional' | 'none'; hint: string }[] = [
  { kind: 'coach', label: 'Coach', squads: 'required', hint: 'Needs a current Working With Children Check.' },
  { kind: 'team_manager', label: 'Team manager', squads: 'required', hint: 'One squad’s availability, team sheet and chat. Needs a current check.' },
  { kind: 'volunteer', label: 'Volunteer', squads: 'optional', hint: 'Canteen, BBQ, set-up and pack-down — or with a squad.' },
  { kind: 'referee', label: 'Referee', squads: 'none', hint: 'On the club’s referee list. Needs a current check.' },
  { kind: 'treasurer', label: 'Treasurer', squads: 'none', hint: 'A committee seat — the owner or the President decides.' },
  { kind: 'secretary', label: 'Secretary', squads: 'none', hint: 'A committee seat — the owner or the President decides.' },
  { kind: 'registrar', label: 'Registrar', squads: 'none', hint: 'A committee seat — the owner or the President decides.' },
  { kind: 'welfare_officer', label: 'Welfare officer', squads: 'none', hint: 'A committee seat — the owner or the President decides.' },
  { kind: 'president', label: 'President', squads: 'none', hint: 'A committee seat — the owner or the President decides.' },
]
const STATUS: Record<Mine['status'], string> = { pending: 'Waiting', approved: 'Approved', declined: 'Not approved', withdrawn: 'Withdrawn' }

/**
 * "Request a role" (Joey, 11 Nov 2026; 0256): a member asks to be a coach,
 * a team manager, a volunteer, a referee or a committee member, names the
 * squads and adds a note. It sits with the committee and opens nothing
 * until they decide; the answer lands here and in the queue.
 */
export function RequestARole() {
  const [org, setOrgId] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [mine, setMine] = useState<Mine[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [kind, setKind] = useState<Kind>('volunteer')
  const [picked, setPicked] = useState<string[]>([])
  const [area, setArea] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)

  useEffect(() => setOrgId(getOrg()), [])
  const load = useCallback(async () => {
    if (!org) return
    const { data } = await createClient().rpc('my_role_requests', { p_academy: org })
    setMine(((data as unknown as Mine[] | null) ?? []))
  }, [org])
  useEffect(() => {
    void load()
  }, [load])
  useEffect(() => {
    if (!open || !org) return
    let live = true
    ;(async () => {
      const { data } = await createClient().from('teams').select('id, name, age_group').eq('academy_id', org).eq('status', 'active').order('name')
      if (live) setTeams((data ?? []) as Team[])
    })()
    return () => {
      live = false
    }
  }, [open, org])

  const def = KINDS.find((k) => k.kind === kind)!
  const needsSquad = def.squads === 'required' && picked.length === 0

  async function send() {
    if (!org) return
    setBusy(true)
    setError(null)
    const { error } = await createClient().rpc('request_role', {
      p_academy: org,
      p_kind: kind,
      p_teams: def.squads === 'none' ? [] : picked,
      p_area: (kind === 'volunteer' && area.trim() ? area.trim() : null) as unknown as string,
      p_note: (note.trim() || null) as unknown as string,
    })
    setBusy(false)
    if (error) return setError(error.message)
    setSent(def.label)
    setPicked([])
    setArea('')
    setNote('')
    void load()
  }
  async function withdraw(id: string) {
    setBusy(true)
    await createClient().rpc('withdraw_role_request', { p_request: id })
    setBusy(false)
    void load()
  }
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const line = { borderColor: 'var(--line)' }
  const day = (iso: string) => new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })

  if (!org) return null
  return (
    <section className="mt-6" data-role-request={mine.length}>
      <h2 className="font-semibold">Help the club</h2>
      <p className="mt-0.5 text-sm text-ink-2">Coach, manage a squad, volunteer, referee or sit on the committee. The committee approves; nothing changes until they do.</p>
      {mine.length > 0 && (
        <ul className="mt-2 divide-y rounded-xl border text-sm" style={line}>
          {mine.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 px-3 py-2.5" data-my-role-request={m.status}>
              <span className="min-w-0">
                <span className="block truncate font-medium">{m.words}</span>
                <span className="block text-xs text-ink-3">
                  {STATUS[m.status]}
                  {m.status === 'pending' && m.waiting_on_check ? ' · waiting on your Working With Children Check — the club records it' : ''}
                  {m.decision_note ? ` · “${m.decision_note}”` : ''}
                  {m.decided_at ? ` · ${day(m.decided_at)}` : ` · asked ${day(m.created_at)}`}
                </span>
              </span>
              {m.status === 'pending' && (
                <button onClick={() => withdraw(m.id)} disabled={busy} className="tap flex-none text-xs underline underline-offset-4 text-ink-2 disabled:opacity-50" data-withdraw-role-request={m.id}>
                  Withdraw
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <button onClick={() => { setSent(null); setOpen(true) }} className="mt-2 w-full rounded-xl border px-4 py-3 text-sm font-semibold" style={{ borderColor: 'var(--brand)', color: 'var(--brand-text)' }} data-request-role-open>
        Request a role
      </button>

      {open && (
        <Sheet onClose={() => setOpen(false)}>
          <div className="p-4" data-request-role-form>
            {sent ? (
              <div className="text-center" data-request-role-sent>
                <p className="display text-[1.375rem] leading-tight">Asked</p>
                <p className="mt-1.5 text-sm text-ink-2">The committee has your request to be {sent.toLowerCase()}. You will hear either way; nothing changes until they say yes.</p>
                <button onClick={() => setOpen(false)} className="mt-4 w-full rounded-xl px-4 py-3 font-semibold text-brand-ink" style={{ background: 'var(--brand)' }}>Done</button>
              </div>
            ) : (
              <>
                <h2 className="display text-[1.375rem] leading-tight">Request a role</h2>
                <p className="mt-0.5 text-sm text-ink-2">Pick the role and, for a squad’s, which squads. Nothing changes until it is approved.</p>
                <div className="mt-3 flex flex-col gap-3">
                  <label className="block text-sm">
                    <span className="text-ink-2">Role</span>
                    <select value={kind} onChange={(e) => { setKind(e.target.value as Kind); setPicked([]) }} className="mt-0.5 w-full rounded-lg border px-3 py-2.5 text-base" style={line} data-request-role-kind>
                      {KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
                    </select>
                    <span className="mt-1 block text-xs text-ink-3">{def.hint}</span>
                  </label>
                  {def.squads !== 'none' && (
                    <fieldset className="text-sm" data-request-role-squads>
                      <legend className="text-ink-2">{def.squads === 'required' ? 'Which squad' : 'With a squad (optional)'}</legend>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {teams.map((t) => (
                          <button key={t.id} type="button" onClick={() => toggle(t.id)} aria-pressed={picked.includes(t.id)} className="rounded-full border px-3 py-1.5 text-xs font-semibold" style={picked.includes(t.id) ? { background: 'var(--brand)', color: 'var(--brand-ink)', borderColor: 'var(--brand)' } : { borderColor: 'var(--line)', color: 'var(--ink-2)' }} data-request-role-squad={t.id}>
                            {t.name}
                          </button>
                        ))}
                        {teams.length === 0 && <span className="text-xs text-ink-3">Loading squads…</span>}
                      </div>
                    </fieldset>
                  )}
                  {kind === 'volunteer' && (
                    <label className="block text-sm">
                      <span className="text-ink-2">Where you can help</span>
                      <input value={area} onChange={(e) => setArea(e.target.value)} maxLength={80} placeholder="Canteen, BBQ, set-up, first aid" className="mt-0.5 w-full rounded-lg border px-3 py-2.5 text-base" style={line} data-request-role-area />
                    </label>
                  )}
                  <label className="block text-sm">
                    <span className="text-ink-2">A note for the committee</span>
                    <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={500} placeholder="Experience, certificates, the days you can do" className="mt-0.5 w-full rounded-lg border px-3 py-2.5 text-base" style={line} data-request-role-note />
                  </label>
                  {error && <p className="text-sm" style={{ color: 'var(--no)' }}>{error}</p>}
                  <button onClick={send} disabled={busy || needsSquad} className="w-full rounded-xl px-4 py-3 font-semibold text-brand-ink disabled:opacity-50" style={{ background: 'var(--brand)' }} data-request-role-send>
                    {busy ? 'Sending…' : 'Send the request'}
                  </button>
                </div>
              </>
            )}
          </div>
        </Sheet>
      )}
    </section>
  )
}
