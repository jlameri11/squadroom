'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export type Fixture = {
  fixture_id: string
  starts_at: string | null
  field_label: string | null
  division: string
  group_label: string | null
  round: string | null
  home_name: string | null
  away_name: string | null
  home_score: number | null
  away_score: number | null
  status: string
  can_score: boolean
}

export type LadderRow = {
  entry_id: string
  team_name: string
  group_label: string | null
  played: number
  won: number
  drawn: number
  lost: number
  goals_for: number
  goals_against: number
  goal_difference: number
  points: number
}

type Entry = { id: string; name: string; division: string; group: string | null; signedUp: boolean }

export function CompetitionView({
  competitionId, isOrganiser, divisions, fixtures, ladders, entries,
}: {
  competitionId: string
  isOrganiser: boolean
  divisions: string[]
  fixtures: Fixture[]
  ladders: Record<string, LadderRow[]>
  entries: Entry[]
}) {
  const [tab, setTab] = useState<'run' | 'ladder' | 'clubs'>('run')
  const [division, setDivision] = useState(divisions[0] ?? '')

  return (
    <div>
      <div className="flex gap-1 border-b border-neutral-200 p-2">
        {(['run', 'ladder', 'clubs'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="flex-1 rounded-lg py-2 text-sm font-medium"
            style={tab === t ? { background: '#2028420f', color: '#202842' } : { color: '#6B7280' }}
          >
            {t === 'run' ? 'Run sheet' : t === 'ladder' ? 'Ladder' : 'Clubs'}
          </button>
        ))}
      </div>

      {divisions.length > 1 && tab !== 'clubs' && (
        <div className="flex gap-2 overflow-x-auto border-b border-neutral-100 px-4 py-2">
          {divisions.map((d) => (
            <button
              key={d}
              onClick={() => setDivision(d)}
              className="flex-none rounded-full border px-3 py-1 text-xs font-medium"
              style={division === d
                ? { background: '#202842', borderColor: '#202842', color: '#fff' }
                : { borderColor: '#E5E7EB', color: '#4B5563' }}
            >
              {d}
            </button>
          ))}
        </div>
      )}

      {tab === 'run' && (
        <RunSheet
          competitionId={competitionId}
          isOrganiser={isOrganiser}
          division={division}
          fixtures={fixtures.filter((f) => divisions.length <= 1 || f.division === division)}
        />
      )}
      {tab === 'ladder' && <Ladder rows={ladders[division] ?? []} />}
      {tab === 'clubs' && <Clubs entries={entries} />}
    </div>
  )
}

function RunSheet({
  competitionId, isOrganiser, division, fixtures,
}: {
  competitionId: string
  isOrganiser: boolean
  division: string
  fixtures: Fixture[]
}) {
  const router = useRouter()
  const [editing, setEditing] = useState<string | null>(null)
  const [home, setHome] = useState('')
  const [away, setAway] = useState('')
  const [busy, setBusy] = useState(false)

  async function saveScore(id: string) {
    setBusy(true)
    const supabase = createClient()
    await supabase
      .from('fixtures')
      .update({
        home_score: Number(home),
        away_score: Number(away),
        status: 'final',
        score_entered_at: new Date().toISOString(),
      })
      .eq('id', id)
    setBusy(false)
    setEditing(null)
    router.refresh()
  }

  if (fixtures.length === 0) {
    return (
      <div className="p-5">
        <p className="rounded-xl bg-neutral-100 p-5 text-center text-sm text-neutral-500">
          No draw yet.
        </p>
        {isOrganiser && <BuildDraw competitionId={competitionId} division={division} />}
      </div>
    )
  }

  // Grouped by kick-off, which is how a run sheet is read on the day.
  const slots = new Map<string, Fixture[]>()
  for (const f of fixtures) {
    const key = f.starts_at ?? 'unscheduled'
    slots.set(key, [...(slots.get(key) ?? []), f])
  }

  return (
    <div>
      {[...slots.entries()].map(([slot, games]) => (
        <section key={slot}>
          <h2 className="sticky top-0 border-b border-neutral-100 bg-neutral-50/95 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500 backdrop-blur">
            {slot === 'unscheduled'
              ? 'Not scheduled'
              : new Date(slot).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Sydney' })}
          </h2>

          {games.map((f) => (
            <div key={f.fixture_id} className="border-b border-neutral-100 px-4 py-2.5">
              <div className="flex items-center gap-2">
                <span className="w-14 flex-none text-xs text-neutral-500">{f.field_label}</span>
                <span className="min-w-0 flex-1 text-sm">
                  <span className={f.status === 'final' && (f.home_score ?? 0) > (f.away_score ?? 0) ? 'font-semibold' : ''}>
                    {f.home_name}
                  </span>
                  <span className="text-neutral-400"> v </span>
                  <span className={f.status === 'final' && (f.away_score ?? 0) > (f.home_score ?? 0) ? 'font-semibold' : ''}>
                    {f.away_name}
                  </span>
                </span>

                {f.status === 'final' ? (
                  <span className="flex-none text-sm font-bold tabular-nums" style={{ color: '#202842' }}>
                    {f.home_score}–{f.away_score}
                  </span>
                ) : f.can_score ? (
                  <button
                    onClick={() => { setEditing(f.fixture_id); setHome(''); setAway('') }}
                    className="flex-none rounded border border-neutral-300 px-2 py-0.5 text-xs"
                  >
                    Score
                  </button>
                ) : (
                  <span className="flex-none text-xs text-neutral-400">—</span>
                )}
              </div>

              {editing === f.fixture_id && (
                <div className="mt-2 flex items-center gap-2">
                  <input value={home} onChange={(e) => setHome(e.target.value)} inputMode="numeric"
                         className="w-14 rounded-lg border border-neutral-300 px-2 py-1.5 text-center tabular-nums" placeholder="0" />
                  <span className="text-neutral-400">–</span>
                  <input value={away} onChange={(e) => setAway(e.target.value)} inputMode="numeric"
                         className="w-14 rounded-lg border border-neutral-300 px-2 py-1.5 text-center tabular-nums" placeholder="0" />
                  <button
                    onClick={() => saveScore(f.fixture_id)}
                    disabled={busy || home === '' || away === ''}
                    className="flex-1 rounded-lg px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                    style={{ background: '#202842' }}
                  >
                    Save
                  </button>
                  <button onClick={() => setEditing(null)} className="text-sm text-neutral-500">Cancel</button>
                </div>
              )}
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}

function BuildDraw({ competitionId, division }: { competitionId: string; division: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [date, setDate] = useState('')
  const [fields, setFields] = useState('Field 1, Field 2, Field 3, Field 4')
  const [gameMins, setGameMins] = useState('20')
  const [gapMins, setGapMins] = useState('5')

  async function build() {
    if (!date) return setError('Pick a start time.')
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { error } = await supabase.rpc('generate_fixtures', {
      p_competition: competitionId,
      p_division: division,
      p_start_at: new Date(date).toISOString(),
      p_game_mins: Number(gameMins),
      p_gap_mins: Number(gapMins),
      p_fields: fields.split(',').map((f) => f.trim()).filter(Boolean),
    })
    setBusy(false)
    if (error) return setError(error.message)
    router.refresh()
  }

  return (
    <div className="mt-4 rounded-xl border border-neutral-300 p-4">
      <h3 className="font-semibold">Build the draw</h3>
      <p className="mt-0.5 text-sm text-neutral-500">
        Every team plays every other in its group. Nobody is scheduled twice at once.
      </p>

      <label className="mt-3 block">
        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">First kick-off</span>
        <input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)}
               className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2.5" />
      </label>

      <label className="mt-3 block">
        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Fields</span>
        <input value={fields} onChange={(e) => setFields(e.target.value)}
               className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2.5 text-sm" />
      </label>

      <div className="mt-3 flex gap-3">
        <label className="flex-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Game (min)</span>
          <input value={gameMins} onChange={(e) => setGameMins(e.target.value)} inputMode="numeric"
                 className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2.5" />
        </label>
        <label className="flex-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Gap (min)</span>
          <input value={gapMins} onChange={(e) => setGapMins(e.target.value)} inputMode="numeric"
                 className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2.5" />
        </label>
      </div>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <button onClick={build} disabled={busy}
              className="mt-3 w-full rounded-xl px-4 py-3 font-medium text-white disabled:opacity-50"
              style={{ background: '#202842' }}>
        {busy ? 'Building…' : 'Build the draw'}
      </button>
    </div>
  )
}

function Ladder({ rows }: { rows: LadderRow[] }) {
  if (rows.length === 0) {
    return <p className="m-5 rounded-xl bg-neutral-100 p-5 text-center text-sm text-neutral-500">Nothing to rank yet.</p>
  }

  const groups = new Map<string, LadderRow[]>()
  for (const r of rows) groups.set(r.group_label ?? '', [...(groups.get(r.group_label ?? '') ?? []), r])

  return (
    <div>
      {[...groups.entries()].map(([g, list]) => (
        <section key={g}>
          {g && (
            <h2 className="border-b border-neutral-100 bg-neutral-50 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Group {g}
            </h2>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-100 text-xs text-neutral-500">
                <th className="p-2 text-left font-medium">Team</th>
                <th className="w-7 p-1 font-medium">P</th>
                <th className="w-7 p-1 font-medium">W</th>
                <th className="w-7 p-1 font-medium">D</th>
                <th className="w-7 p-1 font-medium">L</th>
                <th className="w-9 p-1 font-medium">GD</th>
                <th className="w-9 p-1 font-medium">Pts</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r, i) => (
                <tr key={r.entry_id} className="border-b border-neutral-50">
                  <td className="truncate p-2">
                    <span className="mr-1.5 text-xs text-neutral-400">{i + 1}</span>
                    {r.team_name}
                  </td>
                  <td className="p-1 text-center tabular-nums">{r.played}</td>
                  <td className="p-1 text-center tabular-nums">{r.won}</td>
                  <td className="p-1 text-center tabular-nums">{r.drawn}</td>
                  <td className="p-1 text-center tabular-nums">{r.lost}</td>
                  <td className="p-1 text-center tabular-nums">{r.goal_difference > 0 ? `+${r.goal_difference}` : r.goal_difference}</td>
                  <td className="p-1 text-center font-bold tabular-nums" style={{ color: '#202842' }}>{r.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      <p className="p-4 text-xs text-neutral-500">
        {/* The spreadsheet says the same thing, and it is honest about it. */}
        Three points a win, one a draw. Split by goal difference, then goals for. Teams still level
        are shown level — settle it on the day.
      </p>
    </div>
  )
}

function Clubs({ entries }: { entries: Entry[] }) {
  const waiting = entries.filter((e) => !e.signedUp).length
  return (
    <div>
      {waiting > 0 && (
        <p className="border-b border-neutral-100 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          {waiting} {waiting === 1 ? 'club has' : 'clubs have'} not accepted their invitation yet. They
          are still on the draw.
        </p>
      )}
      {entries.map((e) => (
        <div key={e.id} className="flex items-center gap-2 border-b border-neutral-100 px-4 py-2.5">
          <span className="min-w-0 flex-1 truncate text-sm">{e.name}</span>
          {e.group && <span className="flex-none text-xs text-neutral-400">Group {e.group}</span>}
          <span className="flex-none text-xs" style={{ color: e.signedUp ? '#1C7A4C' : '#9CA3AF' }}>
            {e.signedUp ? 'in' : 'invited'}
          </span>
        </div>
      ))}
    </div>
  )
}
