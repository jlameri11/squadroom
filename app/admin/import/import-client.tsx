'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  FIELDS,
  suggestMapping,
  toLocalDate,
  toLocalTime,
  type FieldKey,
} from '@/lib/import/columns'

type Row = Record<string, unknown>
type Mapping = Partial<Record<FieldKey, string>>

type Prepared = {
  index: number
  local_date: string | null
  local_time: string | null
  end_time: string | null
  title: string
  opponent: string
  venue: string
  round: string
  external_ref: string
  problem: string | null
}

const NAVY = '#202842'

export function ImportClient({
  academyId,
  academyName,
  timezone,
  teams,
}: {
  academyId: string
  academyName: string
  timezone: string
  teams: { id: string; name: string }[]
}) {
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const [mapping, setMapping] = useState<Mapping>({})
  const [teamId, setTeamId] = useState('')
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  async function readFile(file: File) {
    setError(null)
    setResult(null)
    setBusy('Reading the file…')
    try {
      // Loaded on demand — the parser is large, and nobody who is not
      // importing a draw should pay for it on first page load.
      const XLSX = await import('xlsx')
      const buffer = await file.arrayBuffer()
      // cellDates keeps real dates as Dates rather than Excel serials. It
      // does not solve the timezone problem — see toLocalDate — but it beats
      // reasoning about 45000.5416666667.
      const book = XLSX.read(buffer, { cellDates: true })
      const sheet = book.Sheets[book.SheetNames[0]]
      if (!sheet) throw new Error('That file has no sheets in it.')

      const parsed = XLSX.utils.sheet_to_json<Row>(sheet, { defval: '', raw: false })
      if (parsed.length === 0) throw new Error('That sheet has no rows.')

      const cols = Object.keys(parsed[0])
      setHeaders(cols)
      setRows(parsed)
      setMapping(suggestMapping(cols))
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
    const cell = (row: Row, key: FieldKey) => {
      const column = mapping[key]
      return column ? row[column] : ''
    }
    const text = (row: Row, key: FieldKey) => String(cell(row, key) ?? '').trim()

    return rows.map((row, index) => {
      const local_date = toLocalDate(cell(row, 'local_date'))
      const local_time = toLocalTime(cell(row, 'local_time'))
      const opponent = text(row, 'opponent')
      const round = text(row, 'round')
      const explicitTitle = text(row, 'title')

      let problem: string | null = null
      if (!local_date) problem = 'Could not read the date'
      else if (!local_time) problem = 'Could not read the time'

      return {
        index,
        local_date,
        local_time,
        end_time: toLocalTime(cell(row, 'end_time')),
        // A name built from what is there, rather than "Match" forty times.
        title: explicitTitle || [round, opponent && `vs ${opponent}`].filter(Boolean).join(' ') || 'Match',
        opponent,
        venue: text(row, 'venue'),
        round,
        external_ref: text(row, 'external_ref'),
        problem,
      }
    })
  }, [rows, mapping])

  const good = prepared.filter((p) => !p.problem)
  const bad = prepared.filter((p) => p.problem)
  const ready = good.length > 0 && Boolean(mapping.local_date) && Boolean(mapping.local_time)

  async function commit() {
    setBusy('Importing…')
    setError(null)
    const supabase = createClient()
    const { data, error } = await supabase.rpc('create_imported_events', {
      p_academy: academyId,
      p_team: (teamId || null) as unknown as string,
      p_events: good.map((p) => ({
        local_date: p.local_date,
        local_time: p.local_time,
        end_time: p.end_time,
        title: p.title,
        opponent: p.opponent,
        venue: p.venue,
        round: p.round,
        external_ref: p.external_ref,
      })) as never,
    })
    setBusy(null)
    if (error) return setError(error.message)
    const summary = data?.[0]
    setResult(
      `${summary?.created ?? 0} added, ${summary?.updated ?? 0} updated${
        bad.length ? `, ${bad.length} skipped` : ''
      }.`
    )
    setRows([])
    setHeaders([])
  }

  return (
    <main className="mx-auto max-w-md p-5">
      <h1 className="text-2xl font-semibold" style={{ color: NAVY }}>
        Import a draw
      </h1>
      <p className="mt-1 text-sm text-neutral-500">
        In Dribl: Events → filter to your team → Export → Events. Then drop the file here.
        Nothing is created until you have checked it.
      </p>

      {result && (
        <p className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          {result}
        </p>
      )}
      {error && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {headers.length === 0 ? (
        <label className="mt-4 flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-neutral-300 p-6 text-center">
          <input
            type="file"
            accept=".csv,.xlsx,.xls,text/csv"
            className="sr-only"
            disabled={!!busy}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void readFile(file)
              e.target.value = ''
            }}
          />
          {busy ? (
            <span className="text-sm text-neutral-600">{busy}</span>
          ) : (
            <>
              <span className="font-medium" style={{ color: NAVY }}>
                Choose a spreadsheet
              </span>
              <span className="mt-1 text-sm text-neutral-500">.csv, .xlsx or .xls</span>
            </>
          )}
        </label>
      ) : (
        <>
          <p className="mt-4 text-sm text-neutral-500">
            <b>{fileName}</b> · {rows.length} rows
          </p>

          <section className="mt-4 rounded-xl border border-neutral-200 p-4">
            <h2 className="font-semibold">Which column is which?</h2>
            {/*
              The suggestion is the starting point, not the answer. Every field
              is a dropdown a coach can change, because a mapping that was
              guessed and never shown is how an importer quietly puts every
              game on the wrong day.
            */}
            <p className="mt-1 text-xs text-neutral-500">
              I have had a guess from the column names. Check the two marked required —
              everything else can stay blank.
            </p>

            <div className="mt-3 flex flex-col gap-2">
              {FIELDS.map((field) => (
                <label key={field.key} className="text-sm">
                  <span className="text-neutral-500">
                    {field.label}
                    {field.required && <span className="text-red-600"> *</span>}
                  </span>
                  <select
                    value={mapping[field.key] ?? ''}
                    onChange={(e) =>
                      setMapping({ ...mapping, [field.key]: e.target.value || undefined })
                    }
                    className="mt-0.5 w-full rounded-lg border border-neutral-300 p-2"
                  >
                    <option value="">— not in this file —</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                  <span className="mt-0.5 block text-xs text-neutral-400">{field.hint}</span>
                </label>
              ))}
            </div>
          </section>

          <label className="mt-4 block">
            <span className="text-sm font-medium">Which team is this draw for?</span>
            <select
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-neutral-300 p-2.5 text-sm"
            >
              <option value="">Everyone at {academyName}</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>

          <section className="mt-5">
            <h2 className="font-semibold" style={{ color: NAVY }}>
              {good.length} {good.length === 1 ? 'game' : 'games'} ready
            </h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              Times are read exactly as written and set in {timezone}.
            </p>

            <ul className="mt-2 flex flex-col gap-1">
              {good.slice(0, 8).map((p) => (
                <li key={p.index} className="flex justify-between gap-3 border-b border-neutral-100 py-1.5 text-sm">
                  <span className="min-w-0 truncate">{p.title}</span>
                  <span className="flex-none tabular-nums text-neutral-500">
                    {formatWhen(p.local_date!, p.local_time!)}
                  </span>
                </li>
              ))}
              {good.length > 8 && (
                <li className="py-1 text-xs text-neutral-400">…and {good.length - 8} more</li>
              )}
            </ul>

            {/*
              Bad rows are shown, never silently dropped. A coach who exported
              forty games and imported thirty-eight needs to know which two are
              missing, or they find out on a Saturday.
            */}
            {bad.length > 0 && (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-sm font-medium text-amber-900">
                  {bad.length} {bad.length === 1 ? 'row' : 'rows'} will be skipped
                </p>
                <ul className="mt-1 flex flex-col gap-0.5 text-xs text-amber-800">
                  {bad.slice(0, 5).map((p) => (
                    <li key={p.index}>
                      Row {p.index + 2}: {p.problem}
                    </li>
                  ))}
                  {bad.length > 5 && <li>…and {bad.length - 5} more</li>}
                </ul>
                <p className="mt-2 text-xs text-amber-700">
                  Usually the Date or Kick-off dropdown is pointing at the wrong column.
                </p>
              </div>
            )}
          </section>

          <div className="mt-5 flex gap-2">
            <button
              onClick={commit}
              disabled={!ready || !!busy}
              className="flex-1 rounded-xl px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: NAVY }}
            >
              {busy ?? (ready ? `Import ${good.length}` : 'Map the date and time first')}
            </button>
            <button
              onClick={() => {
                setHeaders([])
                setRows([])
              }}
              className="rounded-xl border border-neutral-300 px-4 py-3 text-sm"
            >
              Cancel
            </button>
          </div>

          <p className="mt-3 text-xs text-neutral-500">
            Importing the same draw again updates the games that moved rather than creating a
            second copy of the season.
          </p>
        </>
      )}
    </main>
  )
}

function formatWhen(date: string, time: string) {
  const d = new Date(`${date}T${time}`)
  return d.toLocaleString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}
