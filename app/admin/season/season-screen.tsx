'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getOrg } from '@/lib/org'
import { ScreenSkeleton } from '@/components/screen-skeleton'

type PlanPlayer = { id: string; name: string; dob: string | null; number: number | null; clash: boolean; ageing_out: boolean }
type PlanSquad = {
  key: string
  from: string[]
  from_name: string | null
  from_age_group: string | null
  name: string
  age_group: string
  capacity: number | null
  oldest: boolean
  already_rolled: boolean
  players: PlanPlayer[]
}
type AgeingOut = { id: string; name: string; dob: string | null; from_key: string; from_name: string; from_age_group: string }
type Preview = { from: string; to: string; oldest_age_group: string | null; squads: PlanSquad[]; ageing_out: AgeingOut[] }
type Intake = { name: string; age_group: string; capacity: string }
type RollResult = { teams: number; players: number; left_out: number; intake: number; numbers_kept: number; numbers_not_kept: number }

type Report = {
  team_id: string
  team: string
  total: number
  registered: number
  not_yet: { player_id: string; name: string; guardians: { name: string; phone: string | null }[] }[]
}

type Squad = { id: string; name: string; season: string; status: string }
type Player = { id: string; full_name: string; team_id: string | null }
type MovePreview = {
  player_id: string
  name: string
  from: { id: string; name: string } | null
  to: { id: string; name: string; season: string } | null
  same: boolean
  guardians_follow: number
  number: number | null
  number_kept: boolean
  upcoming_events: number
}

const OUT = '__out__'

/**
 * Rolling a season over, grading it as you go, and then chasing it.
 *
 * Three jobs on one screen because they are one job a month apart: in
 * February the club makes next season from this one — and the preview is
 * a PLAN it edits first (R-19): a player sent to a different squad, a squad
 * split or merged, a player left out, the players ageing out of the oldest
 * group kept or released, a new intake opened. Nothing changes until the
 * owner confirms, because this is the one button in the admin that touches
 * every family at once. For the weeks after, the same screen shows who has
 * not re-registered and nudges them. And mid-season, the same move — chat,
 * number and calendar following the child — is a tool of its own.
 *
 * Moves are a select per player, not a drag: a drag is a desktop gesture
 * and this screen is used on a phone at a kitchen table.
 */
export function SeasonScreen() {
  const [academyId, setAcademyId] = useState<string | null>(null)
  const [academyName, setAcademyName] = useState('')
  const [allSeasons, setAllSeasons] = useState<string[]>([])
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [squads, setSquads] = useState<PlanSquad[]>([])
  const [assign, setAssign] = useState<Record<string, string | null>>({})
  const [intake, setIntake] = useState<Intake[]>([])
  const [newIntake, setNewIntake] = useState<Intake | null>(null)
  const [result, setResult] = useState<RollResult | null>(null)
  const [report, setReport] = useState<Report[] | null>(null)
  const [reportSeason, setReportSeason] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nudged, setNudged] = useState<number | null>(null)

  // Mid-season moves.
  const [activeSquads, setActiveSquads] = useState<Squad[]>([])
  const [players, setPlayers] = useState<Player[]>([])
  const [moveFrom, setMoveFrom] = useState('')
  const [moveTo, setMoveTo] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [movePreview, setMovePreview] = useState<MovePreview[] | null>(null)
  const [moved, setMoved] = useState<{ moved: number; left_out: number; guardians_joined: number } | null>(null)

  const loadSquads = useCallback(async (org: string) => {
    const supabase = createClient()
    const [{ data: t }, { data: p }] = await Promise.all([
      supabase.from('teams').select('id, name, season, status').eq('academy_id', org).eq('status', 'active').order('name'),
      supabase.from('players').select('id, full_name, team_id').eq('academy_id', org).order('full_name'),
    ])
    setActiveSquads((t ?? []) as Squad[])
    setPlayers((p ?? []) as Player[])
  }, [])

  // The organisation the browser is showing, then its seasons. Done here
  // rather than on the server because only the browser knows which of a
  // person's organisations they are looking at (lib/org).
  useEffect(() => {
    ;(async () => {
      const supabase = createClient()
      let org = getOrg()
      if (!org) {
        const { data: m } = await supabase.from('academy_members').select('academy_id').eq('status', 'active').limit(1).maybeSingle()
        org = m?.academy_id ?? null
      }
      if (!org) return setError('You are not in a club yet.')
      const [{ data: a }, { data: teams }] = await Promise.all([
        supabase.from('academies').select('name').eq('id', org).maybeSingle(),
        supabase.from('teams').select('season, status').eq('academy_id', org),
      ])
      const active = [...new Set((teams ?? []).filter((t) => t.status === 'active').map((t) => t.season))].sort()
      const all = [...new Set((teams ?? []).map((t) => t.season))].sort()
      const current = active[active.length - 1] ?? ''
      const n = Number(current)
      setAcademyName(a?.name ?? '')
      setAllSeasons(all)
      setFrom(current)
      setTo(Number.isFinite(n) && current ? String(n + 1) : '')
      setReportSeason(all[all.length - 1] ?? '')
      setAcademyId(org)
      await loadSquads(org)
    })()
  }, [loadSquads])

  const loadReport = useCallback(async (season: string) => {
    if (!season || !academyId) return setReport([])
    const { data, error } = await createClient().rpc('rollover_report', { p_academy: academyId as string, p_season: season })
    if (error) return setError(error.message)
    setReport((data ?? []) as unknown as Report[])
  }, [academyId])

  useEffect(() => {
    ;(async () => {
      await loadReport(reportSeason)
    })()
  }, [loadReport, reportSeason])

  if (!academyId) return error ? <p className="p-6 text-center text-sm text-ink-2">{error}</p> : <ScreenSkeleton />

  // ------------------------------------------------------------ the plan
  async function doPreview() {
    setBusy('preview')
    setError(null)
    setResult(null)
    const { data, error } = await createClient().rpc('preview_season_plan', { p_academy: academyId as string, p_from: from, p_to: to })
    setBusy(null)
    if (error) return setError(error.message)
    const p = data as unknown as Preview
    setPreview(p)
    setSquads(p.squads.filter((s) => !s.already_rolled))
    const a: Record<string, string | null> = {}
    for (const s of p.squads) if (!s.already_rolled) for (const pl of s.players) a[pl.id] = s.key
    setAssign(a)
    setIntake([])
    setNewIntake(null)
  }

  const allPlayers = squads.flatMap((s) => s.players)
  const ageing = preview?.ageing_out ?? []
  const ageingIds = new Set(ageing.map((p) => p.id))
  const playersIn = (key: string) => allPlayers.filter((p) => assign[p.id] === key && !ageingIds.has(p.id))
  const leftOut = allPlayers.filter((p) => assign[p.id] === null && !ageingIds.has(p.id))
  const keepKey = (fromKey: string) => `keep:${fromKey.slice(2)}`

  function rename(key: string, patch: Partial<PlanSquad>) {
    setSquads((all) => all.map((s) => (s.key === key ? { ...s, ...patch } : s)))
  }
  function split(key: string) {
    const s = squads.find((x) => x.key === key)
    if (!s) return
    const n = squads.filter((x) => x.key.startsWith('new:')).length + 1
    setSquads((all) => [...all, { ...s, key: `new:${n}`, name: `${s.name} B`, players: [], oldest: false, already_rolled: false }])
  }
  function merge(key: string, into: string) {
    if (!into || into === key) return
    const s = squads.find((x) => x.key === key)
    const t = squads.find((x) => x.key === into)
    if (!s || !t) return
    setAssign((a) => {
      const next = { ...a }
      for (const id of Object.keys(next)) if (next[id] === key) next[id] = into
      return next
    })
    setSquads((all) =>
      all
        .filter((x) => x.key !== key)
        .map((x) => (x.key === into ? { ...x, from: [...x.from, ...s.from.filter((f) => !x.from.includes(f))], players: [...x.players, ...s.players] } : x))
    )
  }
  /** An ageing-out player: up (their bumped squad), keep (a same-age squad, made on demand), or out. */
  function placeAgeing(p: AgeingOut, choice: 'up' | 'keep' | 'out') {
    if (choice === 'keep') {
      const k = keepKey(p.from_key)
      if (!squads.some((s) => s.key === k)) {
        const src = squads.find((s) => s.key === p.from_key)
        setSquads((all) => [...all, { key: k, from: [p.from_key.slice(2)], from_name: p.from_name, from_age_group: p.from_age_group, name: p.from_name, age_group: p.from_age_group, capacity: src?.capacity ?? null, oldest: false, already_rolled: false, players: [] }])
      }
      setAssign((a) => ({ ...a, [p.id]: k }))
    } else {
      setAssign((a) => ({ ...a, [p.id]: choice === 'up' ? p.from_key : null }))
    }
  }
  const ageingChoice = (p: AgeingOut): 'up' | 'keep' | 'out' => (assign[p.id] === null ? 'out' : assign[p.id] === keepKey(p.from_key) ? 'keep' : 'up')

  // Squads nobody is in are not made: an empty U13 with an open program
  // is a new intake, and that is what "Add a new intake squad" is for.
  const used = new Set(Object.values(assign).filter(Boolean) as string[])
  const toMake = squads.filter((s) => used.has(s.key))
  const skipped = squads.filter((s) => !used.has(s.key))
  const placed = Object.values(assign).filter(Boolean).length
  const outCount = Object.values(assign).filter((v) => v === null).length

  async function doRollover() {
    setBusy('roll')
    setError(null)
    const plan = {
      squads: toMake.map((s) => ({ key: s.key, name: s.name.trim(), age_group: s.age_group.trim(), from: s.from, capacity: s.capacity })),
      players: assign,
      intake: intake.map((i) => ({ name: i.name.trim(), age_group: i.age_group.trim(), capacity: i.capacity ? Number(i.capacity) : null })),
    }
    const { data, error } = await createClient().rpc('roll_over_season', { p_academy: academyId as string, p_from: from, p_to: to, p_plan: plan as never })
    setBusy(null)
    if (error) return setError(error.message)
    setResult(data as unknown as RollResult)
    setPreview(null)
    setReportSeason(to)
    await loadReport(to)
    await loadSquads(academyId as string)
  }

  async function doNudge() {
    setBusy('nudge')
    setError(null)
    const { data, error } = await createClient().rpc('nudge_unregistered', { p_academy: academyId as string, p_season: reportSeason })
    setBusy(null)
    if (error) return setError(error.message)
    setNudged(data as number)
  }

  // ------------------------------------------------------ mid-season moves
  const movable = players.filter((p) => (moveFrom === OUT ? p.team_id === null : p.team_id === moveFrom))
  async function previewMoves() {
    setBusy('move-preview')
    setError(null)
    setMoved(null)
    const moves = [...picked].map((player_id) => ({ player_id, team_id: moveTo === OUT ? null : moveTo }))
    const { data, error } = await createClient().rpc('preview_player_moves', { p_academy: academyId as string, p_moves: moves as never })
    setBusy(null)
    if (error) return setError(error.message)
    setMovePreview(data as unknown as MovePreview[])
  }
  async function doMoves() {
    setBusy('move')
    setError(null)
    const moves = [...picked].map((player_id) => ({ player_id, team_id: moveTo === OUT ? null : moveTo }))
    const { data, error } = await createClient().rpc('move_players', { p_academy: academyId as string, p_moves: moves as never })
    setBusy(null)
    if (error) return setError(error.message)
    setMoved(data as unknown as { moved: number; left_out: number; guardians_joined: number })
    setMovePreview(null)
    setPicked(new Set())
    await loadSquads(academyId as string)
  }

  const input = 'mt-0.5 w-full rounded-lg border px-3 py-2 text-base'
  const small = 'rounded-lg border px-2 py-1 text-xs'
  const line = { borderColor: 'var(--line)' }

  return (
    <div className="p-3.5">
      <p className="mb-2 px-1 text-sm text-ink-3">{academyName}</p>
      <section className="card p-3.5" data-rollover>
        <h2 className="eyebrow pb-1.5">Roll the season over</h2>
        <p className="text-sm text-ink-2">
          Every active squad becomes next season&apos;s, an age group up, with the same families, the same chat, and their
          numbers where still free. Before it happens you can re-grade: send a player to a different squad, split or merge
          squads, leave someone out, decide about the oldest group, and open a squad for new players.
        </p>
        <div className="mt-3 flex gap-2">
          <label className="flex-1 text-sm">
            <span className="text-ink-2">From</span>
            <input value={from} onChange={(e) => setFrom(e.target.value)} className={input} style={line} list="seasons" />
          </label>
          <label className="flex-1 text-sm">
            <span className="text-ink-2">To</span>
            <input value={to} onChange={(e) => setTo(e.target.value)} className={input} style={line} placeholder="2027" />
          </label>
          <datalist id="seasons">
            {allSeasons.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>

        {error && (
          <p className="mt-3 rounded-lg p-2.5 text-sm" style={{ background: 'var(--no-bg)', color: 'var(--no)' }}>
            {error}
          </p>
        )}

        {!preview && !result && (
          <button
            onClick={doPreview}
            disabled={busy !== null || !from || !to || from === to}
            className="mt-3 w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: 'var(--brand)' }}
            data-preview
          >
            {busy === 'preview' ? 'Looking…' : 'Show me what would happen'}
          </button>
        )}

        {preview && (
          <div className="mt-3" data-plan>
            {squads.length === 0 && intake.length === 0 ? (
              <p className="text-sm text-ink-3">No active squads in {from} that have not already been rolled.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {squads.map((s) => {
                  const here = playersIn(s.key)
                  // Counting the ageing-out players sent here too; they are
                  // listed in their own box below, not in this one.
                  const total = allPlayers.filter((p) => assign[p.id] === s.key).length
                  return (
                    <div key={s.key} className="rounded-xl border p-2.5" style={line} data-plan-squad={s.key}>
                      <div className="flex items-center gap-1.5">
                        <input
                          value={s.name}
                          onChange={(e) => rename(s.key, { name: e.target.value })}
                          className="min-w-0 flex-1 rounded-lg border px-2 py-1 text-sm font-semibold"
                          style={line}
                          aria-label="Squad name"
                        />
                        <input
                          value={s.age_group}
                          onChange={(e) => rename(s.key, { age_group: e.target.value })}
                          className="w-14 rounded-lg border px-2 py-1 text-center text-sm"
                          style={line}
                          aria-label="Age group"
                        />
                      </div>
                      <p className="mt-1 text-xs text-ink-3">
                        {s.from_name ? `from ${s.from_name}` : 'new'} · {total} {total === 1 ? 'player' : 'players'}
                        {!used.has(s.key) && ' · empty, will not be made'}
                      </p>
                      {here.length > 0 && (
                        <ul className="mt-1.5 flex flex-col gap-1 text-sm">
                          {here.map((p) => (
                            <li key={p.id} className="flex items-center gap-2" data-plan-player={p.id}>
                              <span className="min-w-0 flex-1 truncate">
                                {p.name}
                                {p.number != null && <span className="text-ink-3"> · #{p.number}{p.clash ? ' taken' : ''}</span>}
                              </span>
                              <select
                                value={assign[p.id] ?? OUT}
                                onChange={(e) => setAssign((a) => ({ ...a, [p.id]: e.target.value === OUT ? null : e.target.value }))}
                                className={small}
                                style={line}
                                aria-label={`Where ${p.name} goes`}
                              >
                                {squads.map((o) => (
                                  <option key={o.key} value={o.key}>
                                    {o.key === s.key ? 'stays' : `→ ${o.name}`}
                                  </option>
                                ))}
                                <option value={OUT}>leave out</option>
                              </select>
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                        <button onClick={() => split(s.key)} className="underline underline-offset-2" style={{ color: 'var(--brand-text)' }} data-split>
                          Split into two
                        </button>
                        {squads.length > 1 && (
                          <label className="flex items-center gap-1 text-ink-2">
                            Merge into
                            <select value="" onChange={(e) => merge(s.key, e.target.value)} className={small} style={line} aria-label={`Merge ${s.name} into`} data-merge>
                              <option value="">…</option>
                              {squads.filter((o) => o.key !== s.key).map((o) => (
                                <option key={o.key} value={o.key}>{o.name}</option>
                              ))}
                            </select>
                          </label>
                        )}
                      </div>
                    </div>
                  )
                })}

                {ageing.length > 0 && (
                  <div className="rounded-xl border p-2.5" style={{ borderColor: 'var(--maybe)' }} data-ageing-out>
                    <p className="text-sm font-semibold">Ageing out of {preview.oldest_age_group}</p>
                    <p className="text-xs text-ink-3">The club&apos;s oldest group. Each player moves up, keeps playing {preview.oldest_age_group}, or leaves — nobody is dropped by default.</p>
                    <ul className="mt-1.5 flex flex-col gap-1 text-sm">
                      {ageing.map((p) => (
                        <li key={p.id} className="flex items-center gap-2" data-ageing-player={p.id}>
                          <span className="min-w-0 flex-1 truncate">{p.name} <span className="text-ink-3">· {p.from_name}</span></span>
                          <select value={ageingChoice(p)} onChange={(e) => placeAgeing(p, e.target.value as 'up' | 'keep' | 'out')} className={small} style={line} aria-label={`What happens to ${p.name}`}>
                            <option value="up">move up to {squads.find((s) => s.key === p.from_key)?.name ?? 'the next group'}</option>
                            <option value="keep">keep in {p.from_age_group}</option>
                            <option value="out">leaving</option>
                          </select>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {leftOut.length > 0 && (
                  <div className="rounded-xl border border-dashed p-2.5" style={line} data-left-out>
                    <p className="text-sm font-semibold">Left out of {to}</p>
                    <ul className="mt-1 flex flex-col gap-1 text-sm">
                      {leftOut.map((p) => (
                        <li key={p.id} className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate">{p.name}</span>
                          <select value={OUT} onChange={(e) => setAssign((a) => ({ ...a, [p.id]: e.target.value === OUT ? null : e.target.value }))} className={small} style={line} aria-label={`Put ${p.name} back`}>
                            <option value={OUT}>left out</option>
                            {squads.map((o) => (
                              <option key={o.key} value={o.key}>→ {o.name}</option>
                            ))}
                          </select>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="rounded-xl border p-2.5" style={line} data-intake>
                  <p className="text-sm font-semibold">New intake</p>
                  <p className="text-xs text-ink-3">A squad with nobody on it yet and its registration open, so new families sign up straight into it.</p>
                  {intake.map((i, n) => (
                    <p key={n} className="mt-1 flex items-center gap-2 text-sm">
                      <span className="min-w-0 flex-1 truncate">{i.name} <span className="text-ink-3">· {i.age_group}{i.capacity ? ` · ${i.capacity} places` : ''}</span></span>
                      <button onClick={() => setIntake((all) => all.filter((_, k) => k !== n))} className="text-xs text-ink-3 underline underline-offset-2">remove</button>
                    </p>
                  ))}
                  {newIntake ? (
                    <div className="mt-2 flex flex-col gap-1.5">
                      <input value={newIntake.name} onChange={(e) => setNewIntake({ ...newIntake, name: e.target.value })} placeholder="U7 Rookies" className={input} style={line} aria-label="Intake squad name" />
                      <div className="flex gap-1.5">
                        <input value={newIntake.age_group} onChange={(e) => setNewIntake({ ...newIntake, age_group: e.target.value })} placeholder="U7" className={`${input} flex-1`} style={line} aria-label="Intake age group" />
                        <input value={newIntake.capacity} onChange={(e) => setNewIntake({ ...newIntake, capacity: e.target.value })} placeholder="places" inputMode="numeric" className={`${input} w-24`} style={line} aria-label="Intake places" />
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setIntake((all) => [...all, newIntake]); setNewIntake(null) }}
                          disabled={!newIntake.name.trim()}
                          className="flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                          style={{ background: 'var(--brand)' }}
                          data-intake-add
                        >
                          Add it
                        </button>
                        <button onClick={() => setNewIntake(null)} className="rounded-lg border px-3 py-1.5 text-xs" style={line}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => setNewIntake({ name: '', age_group: '', capacity: '' })} className="mt-1.5 text-xs underline underline-offset-2" style={{ color: 'var(--brand-text)' }} data-intake-new>
                      Add a new intake squad
                    </button>
                  )}
                </div>

                <p className="text-xs text-ink-3" data-plan-summary>
                  {toMake.length} {toMake.length === 1 ? 'squad' : 'squads'} in {to}, {placed} {placed === 1 ? 'player' : 'players'} placed
                  {outCount > 0 && `, ${outCount} left out`}
                  {intake.length > 0 && `, ${intake.length} new intake`}
                  {skipped.length > 0 && ` · not made (empty): ${skipped.map((s) => s.name).join(', ')}`}.
                  Chats, numbers and calendars follow each player&apos;s final squad.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={doRollover}
                    disabled={busy !== null || (toMake.length === 0 && intake.length === 0)}
                    className="flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                    style={{ background: 'var(--brand)' }}
                    data-confirm
                  >
                    {busy === 'roll' ? 'Rolling over…' : `Roll ${from} into ${to}`}
                  </button>
                  <button onClick={() => setPreview(null)} className="rounded-xl border px-4 py-2.5 text-sm" style={line}>
                    Not now
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {result && (
          <p className="mt-3 rounded-lg p-2.5 text-sm" style={{ background: 'var(--yes-bg)', color: 'var(--yes)' }} data-result>
            Done. {result.teams} squads, {result.players} players placed{result.left_out ? `, ${result.left_out} left out` : ''}
            {result.intake ? `, ${result.intake} new intake` : ''}, {result.numbers_kept} numbers kept
            {result.numbers_not_kept ? `, ${result.numbers_not_kept} to reissue` : ''}. Each family is asked to re-register below.
          </p>
        )}
      </section>

      <section className="card mt-4 p-3.5" data-move-players>
        <h2 className="eyebrow pb-1.5">Move players between squads</h2>
        <p className="text-sm text-ink-2">Mid-season changes, the same way: their chat, number and calendar follow. Nothing moves until you confirm.</p>
        <div className="mt-3 flex gap-2">
          <label className="flex-1 text-sm">
            <span className="text-ink-2">From</span>
            <select value={moveFrom} onChange={(e) => { setMoveFrom(e.target.value); setPicked(new Set()); setMovePreview(null) }} className={input} style={line} aria-label="From squad">
              <option value="">Pick a squad</option>
              {activeSquads.map((s) => (
                <option key={s.id} value={s.id}>{s.name} · {s.season}</option>
              ))}
              <option value={OUT}>Not on a squad</option>
            </select>
          </label>
          <label className="flex-1 text-sm">
            <span className="text-ink-2">To</span>
            <select value={moveTo} onChange={(e) => { setMoveTo(e.target.value); setMovePreview(null) }} className={input} style={line} aria-label="To squad">
              <option value="">Pick a squad</option>
              {activeSquads.filter((s) => s.id !== moveFrom).map((s) => (
                <option key={s.id} value={s.id}>{s.name} · {s.season}</option>
              ))}
              {moveFrom !== OUT && <option value={OUT}>Leave out of all squads</option>}
            </select>
          </label>
        </div>
        {moveFrom && (
          <ul className="mt-2 flex max-h-56 flex-col gap-1 overflow-y-auto text-sm" data-move-list>
            {movable.length === 0 && <li className="text-ink-3">Nobody here.</li>}
            {movable.map((p) => (
              <li key={p.id}>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={picked.has(p.id)}
                    onChange={(e) => { setMovePreview(null); setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(p.id); else n.delete(p.id); return n }) }}
                  />
                  <span className="truncate">{p.full_name}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {movePreview && (
          <ul className="mt-2 flex flex-col gap-1 rounded-lg p-2 text-xs" style={{ background: 'var(--surface-2)' }} data-move-preview>
            {movePreview.map((m) => (
              <li key={m.player_id}>
                <b>{m.name}</b>: {m.from?.name ?? 'no squad'} → {m.to?.name ?? 'no squad'}
                {m.same ? ' (already there)' : ''}
                {m.to && (
                  <span className="text-ink-2">
                    {' '}· {m.guardians_follow} {m.guardians_follow === 1 ? 'parent joins' : 'parents join'} the chat
                    {m.number != null ? ` · #${m.number} kept` : ''}
                    {m.upcoming_events ? ` · ${m.upcoming_events} upcoming ${m.upcoming_events === 1 ? 'game' : 'games'} on their calendar` : ''}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {moved && (
          <p className="mt-2 rounded-lg p-2.5 text-sm" style={{ background: 'var(--yes-bg)', color: 'var(--yes)' }} data-moved>
            Moved {moved.moved}{moved.left_out ? `, ${moved.left_out} left out` : ''}; {moved.guardians_joined} {moved.guardians_joined === 1 ? 'parent' : 'parents'} joined a chat.
          </p>
        )}
        <div className="mt-3 flex gap-2">
          {movePreview ? (
            <button onClick={doMoves} disabled={busy !== null} className="flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand)' }} data-move-confirm>
              {busy === 'move' ? 'Moving…' : `Move ${picked.size} ${picked.size === 1 ? 'player' : 'players'}`}
            </button>
          ) : (
            <button onClick={previewMoves} disabled={busy !== null || picked.size === 0 || !moveTo || moveTo === moveFrom} className="flex-1 rounded-xl border px-4 py-2.5 text-sm font-semibold disabled:opacity-50" style={{ borderColor: 'var(--brand)', color: 'var(--brand-text)' }} data-move-preview-button>
              {busy === 'move-preview' ? 'Looking…' : `Preview ${picked.size || ''} ${picked.size === 1 ? 'move' : 'moves'}`}
            </button>
          )}
        </div>
      </section>

      <section className="card mt-4 p-3.5">
        <div className="flex items-center gap-2">
          <h2 className="eyebrow flex-1">Not yet re-registered</h2>
          <select
            value={reportSeason}
            onChange={(e) => setReportSeason(e.target.value)}
            className="rounded-lg border px-2 py-1 text-xs"
            style={line}
            aria-label="Season"
          >
            {allSeasons.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        {report === null ? (
          <p className="mt-2 text-sm text-ink-3">Loading…</p>
        ) : report.length === 0 ? (
          <p className="mt-2 text-sm text-ink-3">No squads were rolled into {reportSeason || 'this season'}.</p>
        ) : (
          <>
            {report.map((r) => (
              <div key={r.team_id} className="mt-3">
                <p className="text-sm">
                  <b>{r.team}</b>{' '}
                  <span style={{ color: r.registered === r.total ? 'var(--yes)' : 'var(--maybe)' }}>
                    {r.registered} of {r.total} re-registered
                  </span>
                </p>
                {r.not_yet.length > 0 && (
                  <ul className="mt-1 flex flex-col gap-0.5 text-sm">
                    {r.not_yet.map((p) => (
                      <li key={p.player_id} className="flex items-baseline justify-between gap-2">
                        <span className="min-w-0 flex-1 truncate">{p.name}</span>
                        <span className="flex-none text-xs text-ink-3">
                          {p.guardians[0]?.phone ? (
                            <a href={`tel:${p.guardians[0].phone}`} className="underline underline-offset-2">
                              {p.guardians[0].name}
                            </a>
                          ) : (
                            p.guardians[0]?.name ?? 'no guardian'
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
            {report.some((r) => r.not_yet.length > 0) && (
              <button
                onClick={doNudge}
                disabled={busy !== null}
                className="mt-3 w-full rounded-xl border px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
                style={{ borderColor: 'var(--brand)', color: 'var(--brand-text)' }}
              >
                {busy === 'nudge' ? 'Sending…' : nudged === null ? 'Remind every family that has not' : nudged === 0 ? 'Everyone was reminded this week already' : `Reminded ${nudged}`}
              </button>
            )}
          </>
        )}
      </section>
    </div>
  )
}
