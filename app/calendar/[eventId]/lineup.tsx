'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Picked = {
  player_id: string
  name: string
  full_name: string
  role: 'starting' | 'bench' | 'out'
  position: string | null
  sort_order: number
  squad_number: number | null
  rsvp: string | null
}

type Data = {
  can_pick: boolean
  lineup: {
    id: string
    formation: string | null
    note: string | null
    published_at: string | null
    players: Picked[]
  } | null
}

const ROLES = [
  ['starting', 'Starting'],
  ['bench', 'Bench'],
  ['out', 'Not this week'],
] as const

/**
 * The team sheet.
 *
 * A DRAFT until a coach publishes it, which is the whole shape of this
 * screen. A side gets picked over two days with changes of mind, and a sheet
 * parents could watch being edited is a sheet that gets argued about before
 * it is a decision — at which point a coach goes back to paper and the
 * feature has failed.
 *
 * So: a coach sees it always and sees whether it is published; everybody else
 * sees nothing until it is, and then sees it read-only.
 *
 * The RSVP is shown beside every name, because the clash a coach needs to
 * catch is a starter whose family has already said they cannot play. It is
 * never enforced — a coach may know something the form does not.
 */
export function Lineup({ eventId, canSee }: { eventId: string; canSee: boolean }) {
  const [data, setData] = useState<Data | null | undefined>(undefined)
  const [editing, setEditing] = useState(false)
  const [squad, setSquad] = useState<{ player_id: string; player_name: string; rsvp: string | null }[]>([])
  const [picks, setPicks] = useState<Record<string, Picked['role']>>({})
  const [positions, setPositions] = useState<Record<string, string>>({})
  const [formation, setFormation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data: d } = await createClient().rpc('event_lineup', { p_event: eventId })
    setData((d as unknown as Data) ?? null)
    const l = (d as unknown as Data)?.lineup
    if (l) {
      setFormation(l.formation ?? '')
      setPicks(Object.fromEntries(l.players.map((p) => [p.player_id, p.role])))
      setPositions(
        Object.fromEntries(l.players.filter((p) => p.position).map((p) => [p.player_id, p.position!]))
      )
    }
  }, [eventId])

  useEffect(() => {
    void load()
  }, [load])

  // The squad is only needed to EDIT, so it is fetched when the coach starts
  // rather than on every open of an event screen.
  async function startEditing() {
    setError(null)
    const { data: reg, error } = await createClient().rpc('event_register', { p_event: eventId })
    if (error) return setError(error.message)
    setSquad(
      (reg ?? []).map((r: { player_id: string; player_name: string; rsvp: string | null }) => ({
        player_id: r.player_id,
        player_name: r.player_name,
        rsvp: r.rsvp,
      }))
    )
    setEditing(true)
  }

  async function save() {
    setBusy(true)
    setError(null)
    // Only the children actually given a role. Everybody else is not in the
    // squad this week, which is what leaving them out means — and 'out' is
    // there for a coach who wants to say so explicitly.
    const players = Object.entries(picks)
      .filter(([, role]) => role)
      .map(([player_id, role], i) => ({
        player_id,
        role,
        position: positions[player_id] || null,
        sort_order: i + 1,
      }))
    const { error } = await createClient().rpc('set_lineup', {
      p_event: eventId,
      p_players: players as never,
      p_formation: formation || undefined,
    })
    setBusy(false)
    if (error) return setError(error.message)
    setEditing(false)
    await load()
  }

  async function publish(on: boolean) {
    setBusy(true)
    setError(null)
    const { error } = await createClient().rpc('publish_lineup', {
      p_event: eventId,
      p_published: on,
    })
    setBusy(false)
    if (error) return setError(error.message)
    await load()
  }

  // Nothing to show and nothing to offer: not a coach, and no published
  // sheet. Deliberately renders nothing rather than "no team sheet yet",
  // which would tell a parent a sheet exists and is being withheld.
  if (data === undefined || data === null) return null
  if (!canSee && !data.lineup) return null

  const l = data.lineup

  if (editing) {
    return (
      <section className="mt-4">
        <span className="eyebrow">Team sheet</span>
        <div className="mt-1 rounded-xl border p-3" style={{ borderColor: 'var(--line)' }}>
          <input
            value={formation}
            onChange={(e) => setFormation(e.target.value)}
            placeholder="Shape — 2-3-1, rolling subs, anything"
            className="w-full rounded-lg border px-3 py-2.5 text-base"
            style={{ borderColor: 'var(--line)' }}
          />

          <div className="mt-2 flex flex-col gap-1.5">
            {squad.map((p) => (
              <div key={p.player_id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{p.player_name}</span>
                  {/* The clash. Shown while picking, which is the only moment
                      it can change the decision. */}
                  {p.rsvp === 'no' && (
                    <span className="block text-xs" style={{ color: 'var(--no)' }}>
                      family said they can&apos;t play
                    </span>
                  )}
                  {p.rsvp === 'maybe' && (
                    <span className="block text-xs" style={{ color: 'var(--maybe)' }}>
                      maybe
                    </span>
                  )}
                  {!p.rsvp && (
                    <span className="block text-xs text-ink-3">no answer yet</span>
                  )}
                </span>
                <select
                  value={picks[p.player_id] ?? ''}
                  onChange={(e) =>
                    setPicks({ ...picks, [p.player_id]: e.target.value as Picked['role'] })
                  }
                  className="flex-none rounded-lg border px-2 py-1.5 text-xs"
                  style={{ borderColor: 'var(--line)' }}
                >
                  <option value="">—</option>
                  {ROLES.map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
                {picks[p.player_id] === 'starting' && (
                  <input
                    value={positions[p.player_id] ?? ''}
                    onChange={(e) =>
                      setPositions({ ...positions, [p.player_id]: e.target.value })
                    }
                    placeholder="pos"
                    className="w-16 flex-none rounded-lg border px-2 py-1.5 text-xs"
                    style={{ borderColor: 'var(--line)' }}
                  />
                )}
              </div>
            ))}
          </div>

          {error && (
            <p className="mt-2 text-sm" style={{ color: 'var(--no)' }}>
              {error}
            </p>
          )}

          <div className="mt-3 flex gap-2">
            <button
              onClick={save}
              disabled={busy}
              className="flex-1 rounded-lg px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: 'var(--brand)' }}
            >
              {busy ? 'Saving…' : `Save ${Object.values(picks).filter(Boolean).length} named`}
            </button>
            <button
              onClick={() => {
                setEditing(false)
                void load()
              }}
              className="rounded-lg border px-3 py-2.5 text-sm"
              style={{ borderColor: 'var(--line)' }}
            >
              Cancel
            </button>
          </div>
          <p className="mt-1.5 text-xs text-ink-3">
            Saving does not tell anybody. Publish it when you are ready.
          </p>
        </div>
      </section>
    )
  }

  if (!l) {
    return (
      <section className="mt-4">
        <span className="eyebrow">Team sheet</span>
        <button
          onClick={startEditing}
          className="mt-1 w-full rounded-xl border px-4 py-2.5 text-sm font-semibold"
          style={{ borderColor: 'var(--line)', color: 'var(--brand-text)' }}
        >
          Pick the side
        </button>
      </section>
    )
  }

  const byRole = (role: Picked['role']) => l.players.filter((p) => p.role === role)

  return (
    <section className="mt-4">
      <div className="flex items-baseline justify-between">
        <span className="eyebrow">Team sheet</span>
        {data.can_pick && (
          <span className="flex gap-3 text-xs">
            <button onClick={startEditing} style={{ color: 'var(--brand-text)' }}>
              Edit
            </button>
            <button
              onClick={() => void publish(!l.published_at)}
              disabled={busy}
              style={{ color: l.published_at ? 'var(--no)' : 'var(--yes)' }}
            >
              {l.published_at ? 'Unpublish' : 'Publish'}
            </button>
          </span>
        )}
      </div>

      <div className="mt-1 rounded-xl border p-3" style={{ borderColor: 'var(--line)' }}>
        <div className="flex items-baseline justify-between">
          {l.formation && <span className="text-sm font-semibold">{l.formation}</span>}
          {/* A coach has to be able to tell at a glance whether parents can
              see this, or they will assume the wrong one. */}
          {data.can_pick && (
            <span
              className="text-xs font-semibold"
              style={{ color: l.published_at ? 'var(--yes)' : 'var(--maybe)' }}
            >
              {l.published_at ? 'Parents can see this' : 'Draft — only coaches'}
            </span>
          )}
        </div>

        {ROLES.map(([role, label]) => {
          const rows = byRole(role)
          if (rows.length === 0) return null
          return (
            <div key={role} className="mt-2">
              <p className="text-xs font-semibold text-ink-3">{label}</p>
              <ul className="mt-0.5 flex flex-col">
                {rows.map((p) => (
                  <li key={p.player_id} className="flex items-baseline gap-2 py-0.5 text-sm">
                    <span className="w-6 flex-none tabular-nums text-ink-3">
                      {p.squad_number ?? ''}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    {p.position && <span className="flex-none text-xs text-ink-3">{p.position}</span>}
                    {p.rsvp === 'no' && role !== 'out' && (
                      <span className="flex-none text-xs" style={{ color: 'var(--no)' }}>
                        said no
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )
        })}

        {l.note && <p className="mt-2 text-sm text-ink-2">{l.note}</p>}
      </div>
    </section>
  )
}
