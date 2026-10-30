'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { LEAGUE_DRAW_FIELDS, suggestMapping, toLocalDate, toLocalTime } from '@/lib/import/columns'

type Row = Record<string, unknown>
type Mapping = Partial<Record<string, string>>
type Prepared = {
  index: number
  division: string
  local_date: string | null
  local_time: string | null
  home: string
  away: string
  home_club: string
  away_club: string
  round: string
  venue: string
  field: string
  bye: string
  external_ref: string
  problem?: string
}
type Result = { entries: number; created: number; updated: number; skipped: { row: number; why: string }[] }

/**
 * The league's draw, read the way the club importer reads a file: suggest
 * which column is which, a human confirms, a preview shows the reading
 * (dates day first), one call writes it. A re-import updates games that
 * moved and leaves played ones alone.
 */
export function LeagueImport({ competitionId }: { competitionId: string }) {
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const [mapping, setMapping] = useState<Mapping>({})
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)

  async function readFile(file: File) {
    setError(null)
    setResult(null)
    setBusy('Reading the file…')
    try {
      const XLSX = await import('xlsx')
      const book = XLSX.read(await file.arrayBuffer(), { cellDates: true })
      const sheet = book.Sheets[book.SheetNames[0]]
      if (!sheet) throw new Error('That file has no sheets in it.')
      const parsed = XLSX.utils.sheet_to_json<Row>(sheet, { defval: '', raw: false })
      if (parsed.length === 0) throw new Error('That sheet has no rows.')
      const cols = Object.keys(parsed[0])
      setHeaders(cols)
      setRows(parsed)
      setMapping(suggestMapping(cols, LEAGUE_DRAW_FIELDS))
      setFileName(file.name)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That file could not be read.')
      setHeaders([])
      setRows([])
    } finally {
      setBusy(null)
    }
  }

  const prepared: Prepared[] = useMemo(() => {
    const text = (row: Row, key: string) => {
      const column = mapping[key]
      return column ? String(row[column] ?? '').trim() : ''
    }
    return rows.map((row, index) => {
      const rawDate = mapping.local_date ? row[mapping.local_date] : ''
      const rawTime = mapping.local_time ? row[mapping.local_time] : ''
      const local_date = rawDate === '' ? null : toLocalDate(rawDate)
      const local_time = rawTime === '' ? null : toLocalTime(rawTime)
      const p: Prepared = {
        index: index + 2,
        division: text(row, 'division'),
        local_date,
        local_time,
        home: text(row, 'home_team'),
        away: text(row, 'away_team'),
        home_club: text(row, 'home_club'),
        away_club: text(row, 'away_club'),
        round: text(row, 'round'),
        venue: text(row, 'venue'),
        field: text(row, 'field'),
        bye: text(row, 'bye'),
        external_ref: text(row, 'external_ref'),
      }
      if (!p.division) p.problem = 'no division'
      else if (p.bye && /^(y|yes|true|1|bye)$/i.test(p.bye)) p.problem = 'a bye — skipped'
      else if (!p.home || !p.away) p.problem = 'a team is missing'
      else if (rawDate !== '' && !local_date) p.problem = `couldn't read "${String(rawDate)}" as a date`
      else if (rawTime !== '' && !local_time) p.problem = `couldn't read "${String(rawTime)}" as a time`
      return p
    })
  }, [rows, mapping])

  const good = prepared.filter((p) => !p.problem)
  const skipped = prepared.filter((p) => p.problem)
  const ready = good.length > 0 && Boolean(mapping.division) && Boolean(mapping.home_team) && Boolean(mapping.away_team)

  async function commit() {
    setBusy('Importing…')
    setError(null)
    const { data, error } = await createClient().rpc('import_league_draw', {
      p_competition: competitionId,
      p_rows: good.map((p) => ({
        division: p.division,
        local_date: p.local_date || undefined,
        local_time: p.local_time || undefined,
        home: p.home,
        away: p.away,
        home_club: p.home_club || undefined,
        away_club: p.away_club || undefined,
        round: p.round || undefined,
        venue: p.venue || undefined,
        field: p.field || undefined,
        external_ref: p.external_ref || undefined,
      })),
    })
    setBusy(null)
    if (error) return setError(error.message)
    setResult(data as unknown as Result)
  }

  return (
    <div className="p-4">
      <p className="text-sm text-ink-2">
        The draw as a spreadsheet — exported from wherever the league kept it. Squadroom reads the
        headings, suggests which column is which, and shows you the reading before anything is
        written. Teams become entries in each division; a club already entered here is linked by
        name.
      </p>
      <p className="mt-2 rounded-lg p-2.5 text-xs" style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }}>
        Only a file you downloaded yourself. Squadroom never fetches anything from Dribl or anyone
        else. Dates are read <b>day first</b>; check the preview.
      </p>

      <label className="mt-4 block">
        <span className="eyebrow">The file</span>
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void readFile(file)
          }}
          className="mt-1 w-full rounded-xl border p-2.5 text-sm"
          style={{ borderColor: 'var(--line)' }}
        />
      </label>

      {busy && <p className="mt-3 text-sm text-ink-2">{busy}</p>}
      {error && (
        <p className="mt-3 rounded-lg px-3 py-2.5 text-sm" style={{ background: 'var(--no-bg)', color: 'var(--no)' }}>
          {error}
        </p>
      )}

      {headers.length > 0 && !result && (
        <>
          <section className="mt-5">
            <h2 className="eyebrow">Which column is which</h2>
            <p className="mt-0.5 text-xs text-ink-3">{fileName} · {rows.length} rows. Suggestions only — check them.</p>
            <div className="mt-2 grid grid-cols-2 gap-2.5">
              {LEAGUE_DRAW_FIELDS.map((field) => (
                <label key={field.key} className="text-sm">
                  <span className="text-ink-2">{field.label}{field.required && ' *'}</span>
                  <select
                    value={mapping[field.key] ?? ''}
                    onChange={(e) => setMapping({ ...mapping, [field.key]: e.target.value || undefined })}
                    className="mt-0.5 w-full rounded-lg border p-2 text-sm"
                    style={{ borderColor: 'var(--line)' }}
                  >
                    <option value="">— not in this file —</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </section>

          <section className="mt-5">
            <h2 className="eyebrow">The reading</h2>
            <p className="mt-0.5 text-sm text-ink-2">
              {good.length} {good.length === 1 ? 'game' : 'games'}{skipped.length > 0 ? `, ${skipped.length} skipped` : ''}.
            </p>
            <ul className="mt-2 divide-y text-sm" style={{ borderColor: 'var(--line-2)' }}>
              {prepared.slice(0, 14).map((p) => (
                <li key={p.index} className="flex items-baseline gap-2 py-1.5">
                  <span className="w-8 flex-none text-xs tabular-nums text-ink-3">{p.index}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{p.home || '?'} v {p.away || '?'}</span>
                    <span className="block truncate text-xs text-ink-3">
                      {p.problem ?? [p.division, p.round, p.local_date, p.local_time, p.venue, p.field].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </li>
              ))}
              {prepared.length > 14 && <li className="py-1.5 text-xs text-ink-3">…and {prepared.length - 14} more</li>}
            </ul>
          </section>

          <button
            onClick={() => void commit()}
            disabled={!ready || Boolean(busy)}
            className="mt-5 w-full rounded-xl px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: 'var(--brand)' }}
          >
            Import {good.length} {good.length === 1 ? 'game' : 'games'}
          </button>
        </>
      )}

      {result && (
        <section className="card mt-5 p-4 text-sm">
          <p>
            <b>{result.created}</b> {result.created === 1 ? 'game' : 'games'} added, <b>{result.updated}</b> updated; the competition now has{' '}
            <b>{result.entries}</b> teams.
          </p>
          {result.skipped.length > 0 && (
            <>
              <p className="mt-2 text-ink-2">Skipped ({result.skipped.length}):</p>
              <ul className="mt-1 text-xs text-ink-3">
                {result.skipped.slice(0, 20).map((s) => (
                  <li key={s.row}>row {s.row}: {s.why}</li>
                ))}
              </ul>
            </>
          )}
          <p className="mt-3">
            <Link href={`/competitions/${competitionId}`} className="underline underline-offset-2" style={{ color: 'var(--brand-text)' }}>
              Open the run sheet ›
            </Link>
          </p>
        </section>
      )}
    </div>
  )
}
