'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useCurrentOrg } from '@/lib/use-current-org'
import { ScreenSkeleton } from '@/components/screen-skeleton'
import { Sheet } from '@/components/sheet'

type ClubRole = 'president' | 'secretary' | 'registrar' | 'treasurer' | 'coordinator' | 'team_manager' | 'welfare_officer' | 'volunteer_coordinator'
type Held = { id: string; profile_id: string; name: string; role: ClubRole; scope_kind: string; scope: string | null; cleared: boolean }
type Member = { profile_id: string; name: string; role: string; cleared: boolean }
type Officials = {
  club_mode: boolean
  roles: Held[]
  members: Member[]
  streams: { id: string; name: string }[]
  age_groups: string[]
  teams: { id: string; name: string; age_group: string }[]
}

/**
 * The roles a club runs on, in plain words (Big Club Mode item 2; 0236).
 * Several per person; the owner, an admin, the President or the Secretary
 * hands them out. A role around children needs a Working With Children
 * Check on record first — the Treasurer excepted.
 */
export const ROLES: { role: ClubRole; label: string; what: string; scoped?: 'stream_or_age' | 'team' }[] = [
  { role: 'president', label: 'President', what: 'The whole club: every tool, the roles, the log, Club HQ on Home.' },
  { role: 'secretary', label: 'Secretary', what: 'The whole club, beside the President: roles, settings, messages to the club.' },
  { role: 'registrar', label: 'Registrar', what: 'Registrations, offers, waitlists, player records and PlayFootball status. Not money.' },
  { role: 'treasurer', label: 'Treasurer', what: 'Payments, refunds, vouchers and reports. Never medical records.' },
  { role: 'coordinator', label: 'Age or stream coordinator', what: 'Full staff rights for the chosen age group or stream only.', scoped: 'stream_or_age' },
  { role: 'team_manager', label: 'Team manager', what: 'One team: availability, the team sheet, the team chat, the duty roster. Not coaching settings.', scoped: 'team' },
  { role: 'welfare_officer', label: 'Welfare officer', what: 'The club’s safeguarding officer: reported messages and concerns come to them.' },
  { role: 'volunteer_coordinator', label: 'Volunteer coordinator', what: 'Club rosters and helpers: canteen, BBQ, field marshals, set-up and pack-down.' },
]

export function roleLabel(role: string): string {
  return ROLES.find((r) => r.role === role)?.label ?? role.replace(/_/g, ' ')
}

export function RolesScreen() {
  const org = useCurrentOrg()
  const [data, setData] = useState<Officials | null | undefined>(undefined)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!org) return
    const { data } = await createClient().rpc('club_officials', { p_academy: org.id })
    setData((data as unknown as Officials | null) ?? null)
  }, [org])
  useEffect(() => {
    if (!org) return
    let live = true
    ;(async () => {
      const { data } = await createClient().rpc('club_officials', { p_academy: org.id })
      if (live) setData((data as unknown as Officials | null) ?? null)
    })()
    return () => {
      live = false
    }
  }, [org])

  if (!org || data === undefined) return <ScreenSkeleton />
  if (data === null) {
    return (
      <p className="m-5 rounded-xl bg-[var(--surface-2)] p-5 text-center text-sm text-ink-2" data-roles-denied>
        Roles are handed out by the club’s owners, admins, President or Secretary.
      </p>
    )
  }

  async function revoke(id: string) {
    setError(null)
    const { error } = await createClient().rpc('revoke_club_role', { p_role_id: id })
    if (error) return setError(error.message)
    await load()
  }

  const byPerson = new Map<string, Held[]>()
  for (const r of data.roles) byPerson.set(r.profile_id, [...(byPerson.get(r.profile_id) ?? []), r])

  return (
    <div className="p-4" data-roles-screen>
      <p className="text-sm text-ink-2">
        Several per person. Everyone sees only their job: a Treasurer never sees a medical record, a Registrar never the money, a coordinator only their age groups.
      </p>

      <button onClick={() => setAdding(true)} className="mt-3 w-full rounded-xl px-4 py-3 font-semibold text-brand-ink" style={{ background: 'var(--brand)' }} data-role-add>
        Give someone a role
      </button>
      {error && <p className="mt-2 rounded-lg p-2 text-sm" style={{ background: 'var(--no-bg)', color: 'var(--no)' }} role="alert">{error}</p>}

      <h2 className="eyebrow mt-5 px-1 pb-2">Who holds what</h2>
      {byPerson.size === 0 ? (
        <p className="card p-4 text-sm text-ink-2" data-roles-empty>Nobody yet. Owners and admins run everything until roles are handed out.</p>
      ) : (
        <ul className="card overflow-hidden" data-roles-list>
          {[...byPerson.entries()].map(([pid, held]) => (
            <li key={pid} className="border-b px-4 py-3 last:border-b-0" style={{ borderColor: 'var(--line-2)' }} data-role-person={pid}>
              <div className="font-medium">{held[0].name}</div>
              <ul className="mt-1 space-y-1">
                {held.map((h) => (
                  <li key={h.id} className="flex items-center justify-between gap-2 text-sm" data-role-held={h.role}>
                    <span className="min-w-0 truncate text-ink-2">
                      {roleLabel(h.role)}
                      {h.scope_kind !== 'club' && h.scope ? ` · ${h.scope}` : ''}
                      {!h.cleared && h.role !== 'treasurer' && <span className="pill ml-2" style={{ background: 'var(--no-bg)', color: 'var(--no)' }}>check lapsed</span>}
                    </span>
                    <button onClick={() => revoke(h.id)} className="tap flex-none text-xs underline underline-offset-2 text-ink-3" data-role-revoke={h.id}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      <h2 className="eyebrow mt-6 px-1 pb-2">What each role does</h2>
      <ul className="card divide-y overflow-hidden text-sm" style={{ borderColor: 'var(--line-2)' }}>
        {ROLES.map((r) => (
          <li key={r.role} className="px-4 py-3">
            <span className="block font-medium">{r.label}</span>
            <span className="block text-ink-3">{r.what}</span>
          </li>
        ))}
      </ul>

      {adding && <GrantSheet academyId={org.id} data={data} onClose={() => setAdding(false)} onGranted={async () => { setAdding(false); await load() }} />}
    </div>
  )
}

function GrantSheet({ academyId, data, onClose, onGranted }: { academyId: string; data: Officials; onClose: () => void; onGranted: () => Promise<void> }) {
  const [profile, setProfile] = useState('')
  const [role, setRole] = useState<ClubRole>('team_manager')
  const [scopeKind, setScopeKind] = useState<'stream' | 'age_group' | 'team'>('age_group')
  const [stream, setStream] = useState('')
  const [ageGroup, setAgeGroup] = useState(data.age_groups[0] ?? '')
  const [team, setTeam] = useState(data.teams[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const def = ROLES.find((r) => r.role === role)!
  const needsCheck = role !== 'treasurer'
  const chosen = data.members.find((m) => m.profile_id === profile)

  async function grant(e: React.FormEvent) {
    e.preventDefault()
    if (!profile) return setError('Pick a person.')
    setBusy(true)
    setError(null)
    const scope = def.scoped === 'team' ? 'team' : def.scoped === 'stream_or_age' ? scopeKind : 'club'
    const { error } = await createClient().rpc('grant_club_role', {
      p_academy: academyId,
      p_profile: profile,
      p_role: role,
      p_scope_kind: scope,
      p_stream: scope === 'stream' ? stream || undefined : undefined,
      p_age_group: scope === 'age_group' ? ageGroup || undefined : undefined,
      p_team: scope === 'team' ? team || undefined : undefined,
    })
    setBusy(false)
    if (error) return setError(error.message)
    await onGranted()
  }

  return (
    <Sheet onClose={onClose}>
      <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[var(--line)]" />
      <h2 className="text-lg font-semibold">Give someone a role</h2>
      <form onSubmit={grant} className="mt-3 flex flex-col gap-3 text-sm" data-grant-form>
        <label className="block">
          <span className="eyebrow">Who</span>
          <select value={profile} onChange={(e) => setProfile(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2.5" style={{ borderColor: 'var(--line)' }} data-grant-person>
            <option value="">Pick a member…</option>
            {data.members.map((m) => (
              <option key={m.profile_id} value={m.profile_id}>
                {m.name} · {m.role}{m.cleared ? '' : ' · no check on record'}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="eyebrow">Role</span>
          <select value={role} onChange={(e) => setRole(e.target.value as ClubRole)} className="mt-1 w-full rounded-xl border px-3 py-2.5" style={{ borderColor: 'var(--line)' }} data-grant-role>
            {ROLES.map((r) => (
              <option key={r.role} value={r.role}>{r.label}</option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-ink-3">{def.what}</span>
        </label>
        {def.scoped === 'stream_or_age' && (
          <div className="flex flex-wrap gap-2">
            <label className="min-w-fit flex-1">
              <span className="eyebrow">Of</span>
              <select value={scopeKind} onChange={(e) => setScopeKind(e.target.value as 'stream' | 'age_group')} className="mt-1 w-full rounded-xl border px-3 py-2.5" style={{ borderColor: 'var(--line)' }} data-grant-scope-kind>
                <option value="age_group">An age group</option>
                <option value="stream">A stream</option>
              </select>
            </label>
            {scopeKind === 'age_group' ? (
              <label className="min-w-fit flex-1">
                <span className="eyebrow">Age group</span>
                <select value={ageGroup} onChange={(e) => setAgeGroup(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2.5" style={{ borderColor: 'var(--line)' }} data-grant-age-group>
                  {data.age_groups.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </label>
            ) : (
              <label className="min-w-fit flex-1">
                <span className="eyebrow">Stream</span>
                <select value={stream} onChange={(e) => setStream(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2.5" style={{ borderColor: 'var(--line)' }} data-grant-stream>
                  <option value="">Pick a stream…</option>
                  {data.streams.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
            )}
          </div>
        )}
        {def.scoped === 'team' && (
          <label className="block">
            <span className="eyebrow">Team</span>
            <select value={team} onChange={(e) => setTeam(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2.5" style={{ borderColor: 'var(--line)' }} data-grant-team>
              {data.teams.map((t) => <option key={t.id} value={t.id}>{t.name} · {t.age_group}</option>)}
            </select>
          </label>
        )}
        {needsCheck && chosen && !chosen.cleared && (
          <p className="rounded-lg p-2 text-xs" style={{ background: 'var(--maybe-bg)', color: 'var(--maybe)' }}>
            {chosen.name} has no Working With Children Check on record. Record it under Working With Children Checks first; this role is around children.
          </p>
        )}
        {error && <p className="rounded-lg p-2 text-sm" style={{ background: 'var(--no-bg)', color: 'var(--no)' }} role="alert">{error}</p>}
        <button type="submit" disabled={busy} className="w-full rounded-xl px-4 py-3 font-semibold text-brand-ink disabled:opacity-50" style={{ background: 'var(--brand)' }} data-grant-submit>
          {busy ? 'One moment…' : 'Give the role'}
        </button>
      </form>
    </Sheet>
  )
}
