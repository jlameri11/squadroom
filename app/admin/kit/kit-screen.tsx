'use client'

import { useCallback, useEffect, useState } from 'react'
import { AppBar, Screen } from '@/components/app-shell'
import { ScreenSkeleton } from '@/components/screen-skeleton'
import { createClient } from '@/lib/supabase/client'
import { getOrg } from '@/lib/org'

type Count = { garment: string; size: string; n: number }
type Player = {
  id: string
  name: string
  team_name: string | null
  shirt_size: string | null
  shorts_size: string | null
  socks_size: string | null
  squad_number: number | null
}
type Data = {
  players: Player[]
  counts: Count[]
  missing: { shirt: number; shorts: number; socks: number }
}

const GARMENTS = [
  ['shirt', 'Shirts'],
  ['shorts', 'Shorts'],
  ['socks', 'Socks'],
] as const

/**
 * What to order.
 *
 * The counts first and the names second, because the counts are what goes on
 * the purchase order and the names are what somebody checks it against.
 *
 * The blanks are given the same weight as the counts rather than being left
 * for a club to notice. Ordering 20 shirts for a squad of 24 is the failure
 * this screen exists to prevent, and the number that prevents it is the
 * number of children nobody has asked yet.
 */
export function KitScreen() {
  const [data, setData] = useState<Data | null | undefined>(undefined)
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([])
  const [team, setTeam] = useState<string>('')

  const load = useCallback(async () => {
    const supabase = createClient()
    const { data: rows } = await supabase.rpc('kit_list', {
      p_academy: (getOrg() ?? null) as unknown as string,
      p_team: (team || null) as unknown as string,
    })
    setData((rows as unknown as Data) ?? null)

    if (teams.length === 0) {
      const { data: screen } = await supabase.rpc('import_screen', {
        p_academy: (getOrg() ?? null) as unknown as string,
      })
      const s = screen as unknown as { teams?: { id: string; name: string }[] } | null
      setTeams(s?.teams ?? [])
    }
  }, [team, teams.length])

  useEffect(() => {
    void load()
  }, [load])

  if (data === undefined) return <ScreenSkeleton />
  if (data === null) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
        <AppBar title="Kit" back="/admin" />
        <Screen>
          <p className="p-6 text-center text-sm text-ink-2">
            Only a club owner or admin can see this.
          </p>
        </Screen>
      </div>
    )
  }

  const unknown = data.missing.shirt + data.missing.shorts + data.missing.socks

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
      <AppBar title="Kit" meta={`${data.players.length} players`} back="/admin" />
      <Screen>
        <div className="px-3.5 pt-3">
          <select
            value={team}
            onChange={(e) => {
              setTeam(e.target.value)
              setData(undefined)
            }}
            className="w-full rounded-lg border px-3 py-2.5 text-sm"
            style={{ borderColor: 'var(--line)' }}
          >
            <option value="">Every squad</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        {GARMENTS.map(([key, label]) => {
          const counts = data.counts.filter((c) => c.garment === key)
          const blanks = data.missing[key as keyof Data['missing']]
          if (counts.length === 0 && blanks === 0) return null
          return (
            <section key={key} className="px-3.5 pt-4">
              <span className="eyebrow">{label}</span>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {counts.map((c) => (
                  <span
                    key={c.size}
                    className="rounded-lg border px-2.5 py-1.5 text-sm font-semibold tabular-nums"
                    style={{ borderColor: 'var(--line)' }}
                  >
                    {c.n} × {c.size}
                  </span>
                ))}
                {/* Same visual weight as a size, because a club that reads
                    past this orders short. */}
                {blanks > 0 && (
                  <span
                    className="rounded-lg border px-2.5 py-1.5 text-sm font-semibold"
                    style={{ borderColor: 'var(--maybe)', color: 'var(--maybe)' }}
                  >
                    {blanks} not asked
                  </span>
                )}
              </div>
            </section>
          )
        })}

        {unknown > 0 && (
          <p className="px-3.5 pt-3 text-xs text-ink-3">
            Set a size on the roster, or ask the family — a blank is a question, a guess is a
            shirt that does not fit.
          </p>
        )}

        <section className="mt-5">
          <div className="sect px-3.5">
            <span className="eyebrow">Every player</span>
          </div>
          <div className="mt-1">
            {data.players.map((p) => (
              <div
                key={p.id}
                className="flex items-baseline gap-2 border-b px-4 py-2.5"
                style={{ borderColor: 'var(--line-2)' }}
              >
                <span className="w-7 flex-none text-sm tabular-nums text-ink-3">
                  {p.squad_number ?? '—'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{p.name}</span>
                  {p.team_name && (
                    <span className="block truncate text-xs text-ink-3">{p.team_name}</span>
                  )}
                </span>
                <span className="flex-none text-sm tabular-nums">
                  {[p.shirt_size, p.shorts_size, p.socks_size].every((s) => !s) ? (
                    <span style={{ color: 'var(--maybe)' }}>not asked</span>
                  ) : (
                    [p.shirt_size ?? '—', p.shorts_size ?? '—', p.socks_size ?? '—'].join(' · ')
                  )}
                </span>
              </div>
            ))}
          </div>
        </section>
      </Screen>
    </div>
  )
}
