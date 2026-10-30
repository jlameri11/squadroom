'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Role = 'competition_manager' | 'referee_coordinator' | 'discipline_officer' | 'ground_manager'
const ROLES: [Role, string, string][] = [
  ['competition_manager', 'Competition manager', 'The draw, scores, ladders, finals, division rules, announcements — everything an owner can do in this competition'],
  ['referee_coordinator', 'Referee coordinator', 'The pool, appointments, fees and payment runs'],
  ['discipline_officer', 'Discipline officer', 'Tribunal suspensions, overturns, discipline rules'],
  ['ground_manager', 'Ground manager', 'Call off a day or a ground, postpone, reschedule, forfeit, byes'],
]
type Official = { profile_id: string; name: string; roles: Role[] }
type Member = { profile_id: string; name: string; role: string }
type Data = { officials: Official[]; members: Member[] }

/**
 * L-13: who does what at the league. Owners and admins already do
 * everything; these hand one area to somebody who is not an admin — the
 * referee secretary who should not be able to touch a ladder, the
 * discipline officer who should not be appointing referees. Roles are
 * held at the league, so they apply to every competition it runs.
 */
export function LeagueOfficials({ competitionId }: { competitionId: string }) {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [who, setWho] = useState('')
  const [role, setRole] = useState<Role>('referee_coordinator')

  const load = useCallback(async () => {
    const { data, error } = await createClient().rpc('league_officials', { p_competition: competitionId })
    if (error) return setError(error.message)
    setData((data as unknown as Data | null) ?? null)
  }, [competitionId])

  useEffect(() => {
    ;(async () => {
      await load()
    })()
  }, [load])

  async function grant() {
    if (!who) return
    setBusy(true)
    setError(null)
    const { error } = await createClient().rpc('grant_league_role', { p_competition: competitionId, p_profile: who, p_role: role })
    setBusy(false)
    if (error) return setError(error.message)
    setWho('')
    await load()
  }

  async function revoke(profileId: string, r: Role) {
    setBusy(true)
    setError(null)
    const { error } = await createClient().rpc('revoke_league_role', { p_competition: competitionId, p_profile: profileId, p_role: r })
    setBusy(false)
    if (error) return setError(error.message)
    await load()
  }

  if (!data) return null
  const label = (r: Role) => ROLES.find(([k]) => k === r)?.[1] ?? r

  return (
    <div className="m-3.5 rounded-xl border p-3.5" style={{ borderColor: 'var(--line)' }}>
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 text-sm">
          <b>League officials</b>
          <span className="block text-ink-3">
            {data.officials.length === 0 ? 'Only owners and admins run this competition so far.' : `${data.officials.length} with a role`}
          </span>
        </span>
        <button onClick={() => setOpen((v) => !v)} className="flex-none rounded-xl px-3.5 py-2 text-sm font-semibold" style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }}>
          {open ? 'Hide' : 'Manage'}
        </button>
      </div>

      {open && (
        <div className="mt-3">
          {error && (
            <p className="mb-2 rounded-lg p-2 text-xs" style={{ background: 'var(--no-bg)', color: 'var(--no)' }}>{error}</p>
          )}
          <ul className="divide-y text-sm" style={{ borderColor: 'var(--line-2)' }}>
            {data.officials.map((o) => (
              <li key={o.profile_id} className="py-2">
                <span className="block font-medium">{o.name}</span>
                <span className="mt-1 flex flex-wrap gap-1.5">
                  {o.roles.map((r) => (
                    <span key={r} className="pill inline-flex items-center gap-1" style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }}>
                      {label(r)}
                      <button onClick={() => revoke(o.profile_id, r)} disabled={busy} aria-label={`Remove ${label(r)} from ${o.name}`} className="text-ink-3">×</button>
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-3 grid gap-2 text-xs">
            <label>
              <span className="text-ink-2">Who</span>
              <select value={who} onChange={(e) => setWho(e.target.value)} className="mt-0.5 w-full rounded-lg border bg-transparent px-2 py-2 text-sm" style={{ borderColor: 'var(--line)' }}>
                <option value="">Pick a member of the league</option>
                {data.members.map((m) => (
                  <option key={m.profile_id} value={m.profile_id}>{m.name}{m.role === 'owner' || m.role === 'admin' ? ' (already an admin)' : ''}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="text-ink-2">As</span>
              <select value={role} onChange={(e) => setRole(e.target.value as Role)} className="mt-0.5 w-full rounded-lg border bg-transparent px-2 py-2 text-sm" style={{ borderColor: 'var(--line)' }}>
                {ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <span className="mt-0.5 block text-ink-3">{ROLES.find(([k]) => k === role)?.[2]}</span>
            </label>
            <button onClick={grant} disabled={busy || !who} className="rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand)' }}>
              Give them the role
            </button>
            <p className="text-ink-3">Somebody not yet in the league joins with the league&apos;s join link first. A role never shows them a club&apos;s families.</p>
          </div>
        </div>
      )}
    </div>
  )
}
