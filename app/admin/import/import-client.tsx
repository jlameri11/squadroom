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
import { ImportDiff, type Diff } from './import-diff'

type Row = Record<string, unknown>
// Keyed by string rather than FieldKey, so the same screen can serve the
// player field set as well as the fixture one. The REQUIRED-field check below
// is what enforces correctness, not the key type.
type Mapping = Partial<Record<string, string>>

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

const NAVY = 'var(--brand)'

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
  // The diff is the database's answer about THIS mapping and THIS team. Any
  // change to either makes it a statement about an import that is no longer
  // the one being made, so it is thrown away rather than left on screen
  // looking authoritative.
  const [diff, setDiff] = useState<Diff | null>(null)
  const [cancelMissing, setCancelMissing] = useState(false)

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

  // One definition of the payload, used by the preview and the write. Two
  // would be two descriptions of the import, and the preview's job is to be
  // the same import.
  function payload() {
    return prepared.map((p) => ({
      local_date: p.local_date,
      local_time: p.local_time,
      end_time: p.end_time,
      title: p.title,
      opponent: p.opponent,
      venue: p.venue,
      round: p.round,
      external_ref: p.external_ref,
    }))
  }

  async function check() {
    setBusy('Working out what changes…')
    setError(null)
    const { data, error } = await createClient().rpc('preview_imported_events', {
      p_academy: academyId,
      p_team: (teamId || null) as unknown as string,
      p_events: payload() as never,
    })
    setBusy(null)
    if (error) return setError(error.message)
    setDiff(data as unknown as Diff)
  }

  async function commit() {
    setBusy('Importing…')
    setError(null)
    const { data, error } = await createClient().rpc('create_imported_events', {
      p_academy: academyId,
      p_team: (teamId || null) as unknown as string,
      p_events: payload() as never,
      p_cancel_missing: cancelMissing,
    })
    setBusy(null)
    if (error) return setError(error.message)
    const r = data?.[0]
    setResult(
      [
        r?.created ? `${r.created} added` : null,
        r?.updated ? `${r.updated} updated` : null,
        r?.cancelled ? `${r.cancelled} called off` : null,
        r?.skipped ? `${r.skipped} skipped` : null,
      ]
        .filter(Boolean)
        .join(', ') + '.' || 'Nothing to do.'
    )
    setRows([])
    setHeaders([])
    setDiff(null)
    setCancelMissing(false)
  }

  return (
    <main className="mx-auto max-w-md p-5">
      <h1 className="text-2xl font-semibold" style={{ color: NAVY }}>
        Import a draw
      </h1>
      <p className="mt-1 text-sm text-ink-2">
        In Dribl: Events → filter to your team → Export → Events. Then drop the file here.
        Nothing is created until you have checked it.
      </p>

      {result && (
        <p className="mt-4 rounded-lg border p-3 text-sm " style={{ background: 'var(--yes-bg)', borderColor: 'var(--yes)', color: 'var(--yes)' }}>
          {result}
        </p>
      )}
      {error && (
        <p className="mt-4 rounded-lg border p-3 text-sm " style={{ background: 'var(--no-bg)', borderColor: 'var(--no)', color: 'var(--no)' }}>
          {error}
        </p>
      )}

      {headers.length === 0 ? (
        <label className="mt-4 flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-[var(--line)] p-6 text-center">
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
            <span className="text-sm text-ink-2">{busy}</span>
          ) : (
            <>
              <span className="font-medium" style={{ color: NAVY }}>
                Choose a spreadsheet
              </span>
              <span className="mt-1 text-sm text-ink-2">.csv, .xlsx or .xls</span>
            </>
          )}
        </label>
      ) : (
        <>
          <p className="mt-4 text-sm text-ink-2">
            <b>{fileName}</b> · {rows.length} rows
          </p>

          <section className="mt-4 rounded-xl border border-[var(--line)] p-4">
            <h2 className="font-semibold">Which column is which?</h2>
            {/*
              The suggestion is the starting point, not the answer. Every field
              is a dropdown a coach can change, because a mapping that was
              guessed and never shown is how an importer quietly puts every
              game on the wrong day.
            */}
            <p className="mt-1 text-xs text-ink-2">
              I have had a guess from the column names. Check the two marked required —
              everything else can stay blank.
            </p>

            <div className="mt-3 flex flex-col gap-2">
              {FIELDS.map((field) => (
                <label key={field.key} className="text-sm">
                  <span className="text-ink-2">
                    {field.label}
                    {field.required && <span className=""> *</span>}
                  </span>
                  <select
                    value={mapping[field.key] ?? ''}
                    onChange={(e) =>
                      {
                      setMapping({ ...mapping, [field.key]: e.target.value || undefined })
                      setDiff(null)
                    }
                    }
                    className="mt-0.5 w-full rounded-lg border border-[var(--line)] p-2"
                  >
                    <option value="">— not in this file —</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                  <span className="mt-0.5 block text-xs text-ink-3">{field.hint}</span>
                </label>
              ))}
            </div>
          </section>

          <label className="mt-4 block">
            <span className="text-sm font-medium">Which team is this draw for?</span>
            <select
              value={teamId}
              onChange={(e) => {
                setTeamId(e.target.value)
                setDiff(null)
                setCancelMissing(false)
              }}
              className="mt-1 w-full rounded-lg border border-[var(--line)] p-2.5 text-sm"
            >
              <option value="">Everyone at {academyName}</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>

          {/*
            The old screen listed the rows it was about to send and reported
            what happened afterwards. "12 added, 3 updated" after the fact is
            the wrong end of the decision — by then forty families have been
            notified about a draw nobody checked.
          */}
          {diff ? (
            <ImportDiff
              diff={diff}
              timezone={timezone}
              cancelMissing={cancelMissing}
              onCancelMissing={setCancelMissing}
            />
          ) : (
            <section className="mt-5">
              <h2 className="font-semibold" style={{ color: NAVY }}>
                {good.length} {good.length === 1 ? 'game' : 'games'} read
                {bad.length > 0 && `, ${bad.length} unreadable`}
              </h2>
              <p className="mt-0.5 text-xs text-ink-2">
                Times are read exactly as written and set in {timezone}. Check the changes
                before anything is created or anyone is told.
              </p>
            </section>
          )}

          <div className="mt-5 flex gap-2">
            <button
              onClick={diff ? commit : check}
              disabled={!ready || !!busy}
              className="flex-1 rounded-xl px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: diff ? NAVY : 'var(--mid, #3D4A6D)' }}
            >
              {busy ??
                (!ready
                  ? 'Map the date and time first'
                  : diff
                    ? importLabel(diff, cancelMissing)
                    : 'Check the changes')}
            </button>
            <button
              onClick={() => {
                setHeaders([])
                setRows([])
                setDiff(null)
                setCancelMissing(false)
              }}
              className="rounded-xl border border-[var(--line)] px-4 py-3 text-sm"
            >
              Cancel
            </button>
          </div>

          <p className="mt-3 text-xs text-ink-2">
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

function importLabel(diff: Diff, cancelMissing: boolean) {
  const writes = diff.rows.filter(
    (r) => r.verdict === 'new' || r.verdict === 'moved' || r.verdict === 'changed'
  ).length
  const offs = cancelMissing ? diff.missing.length : 0
  if (writes === 0 && offs === 0) return 'Nothing to import'
  const parts = []
  if (writes) parts.push(`${writes} ${writes === 1 ? 'change' : 'changes'}`)
  if (offs) parts.push(`call off ${offs}`)
  return `Apply ${parts.join(' and ')}`
}
