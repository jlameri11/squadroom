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
  competitionId, mode, isOrganiser, divisions, fixtures, ladders, entries,
}: {
  competitionId: string
  mode: string
  isOrganiser: boolean
  divisions: string[]
  fixtures: Fixture[]
  ladders: Record<string, LadderRow[]>
  entries: Entry[]
}) {
  // In comms-only mode the draw and the ladder live in whatever software the
  // organiser already uses. Showing empty versions here would invite someone
  // to fill them in and create a second, wrong answer.
  const commsOnly = mode === 'comms_only'
  const tabs = commsOnly
    ? (['send', 'clubs'] as const)
    : (['run', 'ladder', 'clubs', 'send'] as const)

  const [tab, setTab] = useState<string>(tabs[0])
  const [division, setDivision] = useState(divisions[0] ?? '')

  const LABEL: Record<string, string> = {
    run: 'Run sheet', ladder: 'Ladder', clubs: 'Clubs', send: 'Send',
  }

  return (
    <div>
      {commsOnly && (
        <p className="border-b border-[var(--line-2)] bg-[var(--surface-3)] px-4 py-2 text-xs text-ink-2">
          Run elsewhere. Squadroom carries the messages and the reminders — the draw and the
          ladder stay where the organiser keeps them.
        </p>
      )}

      <div className="flex gap-1 border-b border-[var(--line)] p-2">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="flex-1 rounded-lg py-2 text-sm font-medium"
            style={tab === t ? { background: 'var(--brand-soft)', color: 'var(--brand)' } : { color: 'var(--ink-2)' }}
          >
            {LABEL[t]}
          </button>
        ))}
      </div>

      {divisions.length > 1 && tab !== 'clubs' && (
        <div className="flex gap-2 overflow-x-auto border-b border-[var(--line-2)] px-4 py-2">
          {divisions.map((d) => (
            <button
              key={d}
              onClick={() => setDivision(d)}
              className="flex-none rounded-full border px-3 py-1 text-xs font-medium"
              style={division === d
                ? { background: 'var(--brand)', borderColor: 'var(--brand)', color: '#fff' }
                : { borderColor: 'var(--line)', color: 'var(--ink-2)' }}
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
      {tab === 'send' && <Broadcast competitionId={competitionId} isOrganiser={isOrganiser} />}
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
        <p className="rounded-xl bg-[var(--surface-2)] p-5 text-center text-sm text-ink-2">
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
      {isOrganiser && <SetUpFinals competitionId={competitionId} division={division} />}

      {[...slots.entries()].map(([slot, games]) => (
        <section key={slot}>
          <h2 className="sticky top-0 border-b border-[var(--line-2)] bg-[var(--surface-3)]/95 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-2 backdrop-blur">
            {slot === 'unscheduled'
              ? 'Not scheduled'
              : new Date(slot).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Sydney' })}
          </h2>

          {games.map((f) => (
            <div key={f.fixture_id} className="border-b border-[var(--line-2)] px-4 py-2.5">
              <div className="flex items-center gap-2">
                <span className="w-14 flex-none text-xs text-ink-2">{f.field_label}</span>
                <span className="min-w-0 flex-1 text-sm">
                  <span className={f.status === 'final' && (f.home_score ?? 0) > (f.away_score ?? 0) ? 'font-semibold' : ''}>
                    {f.home_name}
                  </span>
                  <span className="text-ink-3"> v </span>
                  <span className={f.status === 'final' && (f.away_score ?? 0) > (f.home_score ?? 0) ? 'font-semibold' : ''}>
                    {f.away_name}
                  </span>
                </span>

                {f.status === 'final' ? (
                  <span className="flex-none text-sm font-bold tabular-nums" style={{ color: 'var(--brand)' }}>
                    {f.home_score}–{f.away_score}
                  </span>
                ) : f.can_score ? (
                  <button
                    onClick={() => { setEditing(f.fixture_id); setHome(''); setAway('') }}
                    className="flex-none rounded border border-[var(--line)] px-2 py-0.5 text-xs"
                  >
                    Score
                  </button>
                ) : (
                  <span className="flex-none text-xs text-ink-3">—</span>
                )}
              </div>

              {editing === f.fixture_id && (
                <div className="mt-2 flex items-center gap-2">
                  <input value={home} onChange={(e) => setHome(e.target.value)} inputMode="numeric"
                         className="w-14 rounded-lg border border-[var(--line)] px-2 py-1.5 text-center tabular-nums" placeholder="0" />
                  <span className="text-ink-3">–</span>
                  <input value={away} onChange={(e) => setAway(e.target.value)} inputMode="numeric"
                         className="w-14 rounded-lg border border-[var(--line)] px-2 py-1.5 text-center tabular-nums" placeholder="0" />
                  <button
                    onClick={() => saveScore(f.fixture_id)}
                    disabled={busy || home === '' || away === ''}
                    className="flex-1 rounded-lg px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                    style={{ background: 'var(--brand)' }}
                  >
                    Save
                  </button>
                  <button onClick={() => setEditing(null)} className="text-sm text-ink-2">Cancel</button>
                </div>
              )}
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}

function Broadcast({ competitionId, isOrganiser }: { competitionId: string; isOrganiser: boolean }) {
  const [body, setBody] = useState('')
  const [sent, setSent] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isOrganiser) {
    return (
      <p className="m-5 rounded-xl bg-[var(--surface-2)] p-5 text-center text-sm text-ink-2">
        Only the organiser can message every club.
      </p>
    )
  }

  async function send() {
    setBusy(true); setError(null); setSent(null)
    const supabase = createClient()
    const { data, error } = await supabase.rpc('broadcast_to_competition', {
      p_competition: competitionId, p_body: body.trim(),
    })
    setBusy(false)
    if (error) return setError(error.message)
    setSent(data as number)
    setBody('')
  }

  return (
    <div className="p-5">
      <h2 className="font-semibold">Message every club</h2>
      <p className="mt-1 text-sm text-ink-2">
        {/* Say exactly where it lands. An organiser about to tell forty clubs
            their Saturday is off should know what that does. */}
        This appears as an announcement in each club&apos;s own channel, from you. Clubs never
        see each other, and a muted channel still shows it.
      </p>

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        placeholder="Round 12 is off — grounds closed. Details Monday."
        className="mt-3 w-full rounded-xl border border-[var(--line)] p-3 text-sm"
      />

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {sent !== null && (
        <p className="mt-2 text-sm text-green-700">Delivered to {sent} {sent === 1 ? 'club' : 'clubs'}.</p>
      )}

      <button
        onClick={send}
        disabled={busy || body.trim().length === 0}
        className="mt-3 w-full rounded-xl px-4 py-3 font-medium text-white disabled:opacity-50"
        style={{ background: 'var(--brand)' }}
      >
        {busy ? 'Sending…' : 'Send to every club'}
      </button>
    </div>
  )
}

function SetUpFinals({ competitionId, division }: { competitionId: string; division: string }) {
  const router = useRouter()
  const [at, setAt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function build() {
    if (!at) return setError('Pick a kick-off time.')
    setBusy(true); setError(null)
    const supabase = createClient()
    const { error } = await supabase.rpc('create_finals', {
      p_competition: competitionId, p_division: division,
      p_start_at: new Date(at).toISOString(),
    })
    setBusy(false)
    if (error) return setError(error.message)
    router.refresh()
  }

  return (
    <div className="border-t border-[var(--line)] p-4">
      <h3 className="font-semibold">Set up the finals</h3>
      <p className="mt-0.5 text-sm text-ink-2">
        {/* The reassurance a coach actually wants before pressing it. */}
        Times and fields now; the teams fill themselves in as results come in.
      </p>
      <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)}
             className="mt-2 w-full rounded-xl border border-[var(--line)] px-3 py-2.5" />
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <button onClick={build} disabled={busy}
              className="mt-2 w-full rounded-xl border border-[var(--line)] px-4 py-2.5 text-sm font-semibold disabled:opacity-50">
        {busy ? 'Setting up…' : 'Set up finals'}
      </button>
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
    <div className="mt-4 rounded-xl border border-[var(--line)] p-4">
      <h3 className="font-semibold">Build the draw</h3>
      <p className="mt-0.5 text-sm text-ink-2">
        Every team plays every other in its group. Nobody is scheduled twice at once.
      </p>

      <label className="mt-3 block">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-2">First kick-off</span>
        <input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)}
               className="mt-1 w-full rounded-xl border border-[var(--line)] px-3 py-2.5" />
      </label>

      <label className="mt-3 block">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-2">Fields</span>
        <input value={fields} onChange={(e) => setFields(e.target.value)}
               className="mt-1 w-full rounded-xl border border-[var(--line)] px-3 py-2.5 text-sm" />
      </label>

      <div className="mt-3 flex gap-3">
        <label className="flex-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-2">Game (min)</span>
          <input value={gameMins} onChange={(e) => setGameMins(e.target.value)} inputMode="numeric"
                 className="mt-1 w-full rounded-xl border border-[var(--line)] px-3 py-2.5" />
        </label>
        <label className="flex-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-2">Gap (min)</span>
          <input value={gapMins} onChange={(e) => setGapMins(e.target.value)} inputMode="numeric"
                 className="mt-1 w-full rounded-xl border border-[var(--line)] px-3 py-2.5" />
        </label>
      </div>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <button onClick={build} disabled={busy}
              className="mt-3 w-full rounded-xl px-4 py-3 font-medium text-white disabled:opacity-50"
              style={{ background: 'var(--brand)' }}>
        {busy ? 'Building…' : 'Build the draw'}
      </button>
    </div>
  )
}

function Ladder({ rows }: { rows: LadderRow[] }) {
  if (rows.length === 0) {
    return <p className="m-5 rounded-xl bg-[var(--surface-2)] p-5 text-center text-sm text-ink-2">Nothing to rank yet.</p>
  }

  const groups = new Map<string, LadderRow[]>()
  for (const r of rows) groups.set(r.group_label ?? '', [...(groups.get(r.group_label ?? '') ?? []), r])

  return (
    <div>
      {[...groups.entries()].map(([g, list]) => (
        <section key={g}>
          {g && (
            <h2 className="border-b border-[var(--line-2)] bg-[var(--surface-3)] px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-2">
              Group {g}
            </h2>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--line-2)] text-xs text-ink-2">
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
                <tr key={r.entry_id} className="border-b border-[var(--line-2)]">
                  <td className="truncate p-2">
                    <span className="mr-1.5 text-xs text-ink-3">{i + 1}</span>
                    {r.team_name}
                  </td>
                  <td className="p-1 text-center tabular-nums">{r.played}</td>
                  <td className="p-1 text-center tabular-nums">{r.won}</td>
                  <td className="p-1 text-center tabular-nums">{r.drawn}</td>
                  <td className="p-1 text-center tabular-nums">{r.lost}</td>
                  <td className="p-1 text-center tabular-nums">{r.goal_difference > 0 ? `+${r.goal_difference}` : r.goal_difference}</td>
                  <td className="p-1 text-center font-bold tabular-nums" style={{ color: 'var(--brand)' }}>{r.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      <p className="p-4 text-xs text-ink-2">
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
        <p className="border-b border-[var(--line-2)] bg-amber-50 px-4 py-2 text-xs text-amber-800">
          {waiting} {waiting === 1 ? 'club has' : 'clubs have'} not accepted their invitation yet. They
          are still on the draw.
        </p>
      )}
      {entries.map((e) => (
        <div key={e.id} className="flex items-center gap-2 border-b border-[var(--line-2)] px-4 py-2.5">
          <span className="min-w-0 flex-1 truncate text-sm">{e.name}</span>
          {e.group && <span className="flex-none text-xs text-ink-3">Group {e.group}</span>}
          <span className="flex-none text-xs" style={{ color: e.signedUp ? 'var(--yes)' : 'var(--ink-3)' }}>
            {e.signedUp ? 'in' : 'invited'}
          </span>
        </div>
      ))}
    </div>
  )
}
