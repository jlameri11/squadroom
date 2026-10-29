'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getOrg } from '@/lib/org'
import { ScreenSkeleton } from '@/components/screen-skeleton'

type Preview = {
  id: string
  name: string
  new_name: string
  age_group: string
  new_age_group: string
  players: number
  numbers: number
  numbers_clashing: number
  already_rolled: boolean
}

type Report = {
  team_id: string
  team: string
  total: number
  registered: number
  not_yet: { player_id: string; name: string; guardians: { name: string; phone: string | null }[] }[]
}

/**
 * Rolling a season over, and then chasing it.
 *
 * Two halves on one screen because they are one job a month apart: in
 * February the club makes next season from this one, and for the next few
 * weeks it opens the same screen to see who has not re-registered and to
 * nudge them. The preview is shown before anything happens, naming every
 * squad and every number that will not carry, because this is the one
 * button in the admin that touches every family at once.
 */
export function SeasonScreen() {
  const [academyId, setAcademyId] = useState<string | null>(null)
  const [academyName, setAcademyName] = useState('')
  const [allSeasons, setAllSeasons] = useState<string[]>([])
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [preview, setPreview] = useState<Preview[] | null>(null)
  const [result, setResult] = useState<{ teams: number; players: number; numbers_kept: number; numbers_not_kept: number } | null>(null)
  const [report, setReport] = useState<Report[] | null>(null)
  const [reportSeason, setReportSeason] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nudged, setNudged] = useState<number | null>(null)

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
    })()
  }, [])

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

  async function doPreview() {
    setBusy('preview')
    setError(null)
    setResult(null)
    const { data, error } = await createClient().rpc('preview_season_rollover', { p_academy: academyId as string, p_from: from, p_to: to })
    setBusy(null)
    if (error) return setError(error.message)
    setPreview((data ?? []) as unknown as Preview[])
  }

  async function doRollover() {
    setBusy('roll')
    setError(null)
    const { data, error } = await createClient().rpc('roll_over_season', { p_academy: academyId as string, p_from: from, p_to: to })
    setBusy(null)
    if (error) return setError(error.message)
    setResult(data as unknown as typeof result)
    setPreview(null)
    setReportSeason(to)
    await loadReport(to)
  }

  async function doNudge() {
    setBusy('nudge')
    setError(null)
    const { data, error } = await createClient().rpc('nudge_unregistered', { p_academy: academyId as string, p_season: reportSeason })
    setBusy(null)
    if (error) return setError(error.message)
    setNudged(data as number)
  }

  const rollable = (preview ?? []).filter((p) => !p.already_rolled)
  const clashes = (preview ?? []).reduce((n, p) => n + p.numbers_clashing, 0)

  return (
    <div className="p-3.5">
      <p className="mb-2 px-1 text-sm text-ink-3">{academyName}</p>
      <section className="card p-3.5">
        <h2 className="eyebrow pb-1.5">Roll the season over</h2>
        <p className="text-sm text-ink-2">
          Every active squad becomes next season&apos;s, an age group up, with the same families,
          the same chat, and their numbers where still free. The old squads go read-only. Then
          each family is asked to re-register.
        </p>
        <div className="mt-3 flex gap-2">
          <label className="flex-1 text-sm">
            <span className="text-ink-2">From</span>
            <input value={from} onChange={(e) => setFrom(e.target.value)} className="mt-0.5 w-full rounded-lg border px-3 py-2 text-base" style={{ borderColor: 'var(--line)' }} list="seasons" />
          </label>
          <label className="flex-1 text-sm">
            <span className="text-ink-2">To</span>
            <input value={to} onChange={(e) => setTo(e.target.value)} className="mt-0.5 w-full rounded-lg border px-3 py-2 text-base" style={{ borderColor: 'var(--line)' }} placeholder="2027" />
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
          >
            {busy === 'preview' ? 'Looking…' : 'Show me what would happen'}
          </button>
        )}

        {preview && (
          <div className="mt-3">
            {preview.length === 0 ? (
              <p className="text-sm text-ink-3">No active squads in {from}.</p>
            ) : (
              <ul className="flex flex-col gap-1.5 text-sm">
                {preview.map((p) => (
                  <li key={p.id} className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate">
                      {p.name} <span className="text-ink-3">→</span> <b>{p.new_name}</b>
                    </span>
                    <span className="flex-none text-xs text-ink-3">
                      {p.already_rolled
                        ? 'already done'
                        : `${p.players} players${p.numbers ? ` · ${p.numbers - p.numbers_clashing} of ${p.numbers} numbers kept` : ''}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {clashes > 0 && (
              <p className="mt-2 text-xs" style={{ color: 'var(--maybe)' }}>
                {clashes} {clashes === 1 ? 'number is' : 'numbers are'} already taken in {to} and will need reissuing.
              </p>
            )}
            {rollable.length > 0 && (
              <div className="mt-3 flex gap-2">
                <button
                  onClick={doRollover}
                  disabled={busy !== null}
                  className="flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                  style={{ background: 'var(--brand)' }}
                >
                  {busy === 'roll' ? 'Rolling over…' : `Roll ${rollable.length} ${rollable.length === 1 ? 'squad' : 'squads'} into ${to}`}
                </button>
                <button onClick={() => setPreview(null)} className="rounded-xl border px-4 py-2.5 text-sm" style={{ borderColor: 'var(--line)' }}>
                  Not now
                </button>
              </div>
            )}
          </div>
        )}

        {result && (
          <p className="mt-3 rounded-lg p-2.5 text-sm" style={{ background: 'var(--yes-bg)', color: 'var(--yes)' }}>
            Done. {result.teams} squads, {result.players} players moved, {result.numbers_kept} numbers kept
            {result.numbers_not_kept ? `, ${result.numbers_not_kept} to reissue` : ''}. Each family is asked to re-register below.
          </p>
        )}
      </section>

      <section className="card mt-4 p-3.5">
        <div className="flex items-center gap-2">
          <h2 className="eyebrow flex-1">Not yet re-registered</h2>
          <select
            value={reportSeason}
            onChange={(e) => setReportSeason(e.target.value)}
            className="rounded-lg border px-2 py-1 text-xs"
            style={{ borderColor: 'var(--line)' }}
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
