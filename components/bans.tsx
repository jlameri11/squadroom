'use client'

import { useCallback, useEffect, useState } from 'react'
import { Sheet } from '@/components/sheet'
import { createClient } from '@/lib/supabase/client'

type Ban = {
  id: string
  name: string
  kind: 'member' | 'player' | 'name'
  reason: string
  starts_on: string
  ends_on: string | null
  note: string | null
  issued_at: string
  issued_by: string | null
  lifted_at: string | null
  lift_note: string | null
  active: boolean
  upcoming: boolean
}
type Member = { profile_id: string; full_name: string | null; role: string }
type Player = { id: string; full_name: string; team: string | null }

/**
 * Bans (Part C item 2; 0257): the club or the league bans a person — a
 * member, a child on the roster, or a name — for a period with a reason.
 * While it runs they answer nothing, post nothing and go on no team sheet;
 * the refusals say so. Lifted with a note. Who may: the database's call
 * (bans_list answers null to anyone else).
 */
export function Bans({ academyId, who = 'the club' }: { academyId: string; who?: string }) {
  const [rows, setRows] = useState<Ban[] | null | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const [members, setMembers] = useState<Member[]>([])
  const [players, setPlayers] = useState<Player[]>([])
  const [kind, setKind] = useState<'member' | 'player' | 'name'>('member')
  const [profileId, setProfileId] = useState('')
  const [playerId, setPlayerId] = useState('')
  const [name, setName] = useState('')
  const [reason, setReason] = useState('')
  const [until, setUntil] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lifting, setLifting] = useState<string | null>(null)
  const [liftNote, setLiftNote] = useState('')

  const load = useCallback(async () => {
    const { data } = await createClient().rpc('bans_list', { p_academy: academyId })
    setRows((data as unknown as Ban[] | null) ?? null)
  }, [academyId])
  useEffect(() => {
    void load()
  }, [load])
  useEffect(() => {
    if (!open) return
    let live = true
    ;(async () => {
      const supabase = createClient()
      const { data: m } = await supabase.rpc('member_directory', { p_academy: academyId })
      const { data: p } = await supabase.from('players').select('id, full_name, teams(name)').eq('academy_id', academyId).order('full_name').limit(1000)
      if (!live) return
      setMembers((((m as unknown as Member[] | null) ?? []).filter((x) => x.full_name)).sort((a, b) => (a.full_name ?? '').localeCompare(b.full_name ?? '')))
      setPlayers(((p ?? []) as unknown as { id: string; full_name: string; teams: { name: string } | { name: string }[] | null }[]).map((x) => ({
        id: x.id, full_name: x.full_name, team: Array.isArray(x.teams) ? x.teams[0]?.name ?? null : x.teams?.name ?? null,
      })))
    })()
    return () => {
      live = false
    }
  }, [open, academyId])

  if (rows === undefined || rows === null) return null

  async function ban() {
    setBusy('ban')
    setError(null)
    const { error } = await createClient().rpc('ban_person', {
      p_academy: academyId,
      p_reason: reason.trim(),
      p_profile: (kind === 'member' && profileId ? profileId : null) as unknown as string,
      p_player: (kind === 'player' && playerId ? playerId : null) as unknown as string,
      p_name: (kind === 'name' && name.trim() ? name.trim() : null) as unknown as string,
      p_ends_on: (until || null) as unknown as string,
      p_note: (note.trim() || null) as unknown as string,
    })
    setBusy(null)
    if (error) return setError(error.message)
    setOpen(false)
    setProfileId(''); setPlayerId(''); setName(''); setReason(''); setUntil(''); setNote('')
    void load()
  }
  async function lift(id: string) {
    setBusy(id)
    setError(null)
    const { error } = await createClient().rpc('lift_ban', { p_ban: id, p_note: (liftNote.trim() || null) as unknown as string })
    setBusy(null)
    if (error) return setError(error.message)
    setLifting(null)
    setLiftNote('')
    void load()
  }

  const day = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
  const line = { borderColor: 'var(--line)' }
  const current = rows.filter((r) => r.active || r.upcoming)
  const past = rows.filter((r) => !r.active && !r.upcoming)
  const canSend = reason.trim().length > 0 && ((kind === 'member' && profileId) || (kind === 'player' && playerId) || (kind === 'name' && name.trim()))

  return (
    <section className="mt-5" data-bans={current.length}>
      <div className="sect">
        <span className="eyebrow">Bans</span>
        <span className="text-xs text-ink-3">{current.length === 0 ? 'none running' : `${current.length} running`}</span>
      </div>
      <p className="mt-1 text-xs text-ink-3">While a ban runs the person answers no games or training, posts nothing and goes on no team sheet. They read the reason; so does the log.</p>
      {error && <p className="mt-2 rounded-lg px-3 py-2 text-sm" style={{ background: 'var(--no-bg)', color: 'var(--no)' }}>{error}</p>}
      {current.length > 0 && (
        <ul className="mt-2 divide-y rounded-xl border text-sm" style={line}>
          {current.map((b) => (
            <li key={b.id} className="px-3 py-2.5" data-ban={b.id} data-ban-kind={b.kind}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate font-medium">{b.name}</span>
                <span className="flex-none text-xs" style={{ color: b.upcoming ? 'var(--ink-3)' : 'var(--no)' }}>
                  {b.upcoming ? `from ${day(b.starts_on)}` : b.ends_on ? `until ${day(b.ends_on)}` : 'until lifted'}
                </span>
              </div>
              <div className="mt-0.5 text-xs text-ink-2">{b.reason}{b.note ? ` · ${b.note}` : ''}</div>
              <div className="mt-0.5 text-xs text-ink-3">{b.kind === 'player' ? 'A player on the roster' : b.kind === 'name' ? 'By name only — nothing to enforce' : 'A member'}{b.issued_by ? ` · by ${b.issued_by}` : ''} · {day(b.issued_at.slice(0, 10))}</div>
              {lifting === b.id ? (
                <div className="mt-2 flex gap-2">
                  <input value={liftNote} onChange={(e) => setLiftNote(e.target.value)} maxLength={500} placeholder="A note for them (optional)" className="min-w-0 flex-1 rounded-lg border px-3 py-1.5 text-sm" style={line} data-lift-note />
                  <button onClick={() => lift(b.id)} disabled={busy !== null} className="flex-none rounded-lg px-3 py-1.5 text-xs font-semibold text-brand-ink disabled:opacity-50" style={{ background: 'var(--brand)' }} data-lift-ban={b.id}>
                    {busy === b.id ? '…' : 'Lift it'}
                  </button>
                  <button onClick={() => setLifting(null)} className="flex-none rounded-lg border px-3 py-1.5 text-xs" style={line}>Keep</button>
                </div>
              ) : (
                <button onClick={() => setLifting(b.id)} className="tap mt-1 text-xs font-semibold underline underline-offset-4" data-lift-open={b.id}>Lift the ban</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {past.length > 0 && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-xs text-ink-3">{past.length} lifted or lapsed in the last ninety days</summary>
          <ul className="mt-1 divide-y rounded-xl border" style={line}>
            {past.map((b) => (
              <li key={b.id} className="px-3 py-2 text-xs text-ink-2" data-ban-past={b.id}>
                <span className="font-medium text-ink">{b.name}</span> · {b.reason} · {b.lifted_at ? `lifted ${day(b.lifted_at.slice(0, 10))}${b.lift_note ? ` — ${b.lift_note}` : ''}` : `ended ${day(b.ends_on!)}`}
              </li>
            ))}
          </ul>
        </details>
      )}
      <button onClick={() => setOpen(true)} className="mt-2 w-full rounded-xl border px-4 py-3 text-sm font-semibold" style={{ borderColor: 'var(--no)', color: 'var(--no)' }} data-ban-open>
        Ban someone
      </button>

      {open && (
        <Sheet onClose={() => setOpen(false)}>
          <div className="p-4" data-ban-form>
            <h2 className="display text-[1.375rem] leading-tight">Ban someone</h2>
            <p className="mt-0.5 text-sm text-ink-2">From {who}: no answering, no posting, no team sheet while it runs. They read the reason.</p>
            <div className="mt-3 flex flex-col gap-3">
              <div className="flex gap-1.5 text-xs" role="group" aria-label="Who">
                {([['member', 'A member'], ['player', 'A player'], ['name', 'A name']] as const).map(([k, label]) => (
                  <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k} className="rounded-full border px-3 py-1.5 font-semibold" style={kind === k ? { background: 'var(--brand)', color: 'var(--brand-ink)', borderColor: 'var(--brand)' } : { borderColor: 'var(--line)', color: 'var(--ink-2)' }} data-ban-kind-pick={k}>
                    {label}
                  </button>
                ))}
              </div>
              {kind === 'member' && (
                <label className="block text-sm">
                  <span className="text-ink-2">Who</span>
                  <select value={profileId} onChange={(e) => setProfileId(e.target.value)} className="mt-0.5 w-full rounded-lg border px-3 py-2.5 text-base" style={line} data-ban-member>
                    <option value="">Choose a member</option>
                    {members.map((m) => <option key={m.profile_id} value={m.profile_id}>{m.full_name} · {m.role}</option>)}
                  </select>
                </label>
              )}
              {kind === 'player' && (
                <label className="block text-sm">
                  <span className="text-ink-2">Who</span>
                  <select value={playerId} onChange={(e) => setPlayerId(e.target.value)} className="mt-0.5 w-full rounded-lg border px-3 py-2.5 text-base" style={line} data-ban-player>
                    <option value="">Choose a player</option>
                    {players.map((p) => <option key={p.id} value={p.id}>{p.full_name}{p.team ? ` · ${p.team}` : ''}</option>)}
                  </select>
                </label>
              )}
              {kind === 'name' && (
                <label className="block text-sm">
                  <span className="text-ink-2">Their name</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="A spectator, a visitor" className="mt-0.5 w-full rounded-lg border px-3 py-2.5 text-base" style={line} data-ban-name />
                  <span className="mt-1 block text-xs text-ink-3">A record for the gate and the log — there is no account to stop.</span>
                </label>
              )}
              <label className="block text-sm">
                <span className="text-ink-2">Why</span>
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} placeholder="Abuse of the referee at the U8s on Saturday" className="mt-0.5 w-full rounded-lg border px-3 py-2.5 text-base" style={line} data-ban-reason />
              </label>
              <label className="block text-sm">
                <span className="text-ink-2">Until <span className="text-ink-3">(leave empty for until lifted)</span></span>
                <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="mt-0.5 w-full rounded-lg border px-3 py-2.5 text-base" style={line} data-ban-until />
              </label>
              <label className="block text-sm">
                <span className="text-ink-2">A note for the committee <span className="text-ink-3">(optional; the person does not see it)</span></span>
                <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} className="mt-0.5 w-full rounded-lg border px-3 py-2.5 text-base" style={line} data-ban-note />
              </label>
              {error && <p className="text-sm" style={{ color: 'var(--no)' }}>{error}</p>}
              <button onClick={ban} disabled={busy !== null || !canSend} className="w-full rounded-xl px-4 py-3 font-semibold disabled:opacity-50" style={{ background: 'var(--no)', color: 'var(--no-ink)' }} data-ban-send>
                {busy === 'ban' ? 'Banning…' : 'Ban them'}
              </button>
            </div>
          </div>
        </Sheet>
      )}
    </section>
  )
}
