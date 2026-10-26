'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { AppBar, Screen } from '@/components/app-shell'
import { createClient } from '@/lib/supabase/client'
import { PLAYER_FIELDS, suggestMapping } from '@/lib/import/columns'

type Row = Record<string, unknown>
type Mapping = Partial<Record<string, string>>

type Prepared = {
  index: number
  full_name: string
  dob: string
  gender: string
  preferred_name: string
  ff_number: string
  squad_number: string
  school: string
  problem?: string
}

/**
 * Importing the roster a club already keeps in a spreadsheet.
 *
 * A separate screen from the fixture importer rather than a mode inside it.
 * The two share the column mapper, which is where the thinking is, and share
 * nothing else: a fixture needs a date and a kick-off reconciled against a
 * timezone, a player needs a name and a birthday and a duplicate check. One
 * screen branching on a mode would be more tangled than two screens.
 *
 * Dates are read DAY FIRST, like the fixture importer, for the same reason:
 * Australian d/m/y and American m/d/y are indistinguishable for the first
 * twelve days of every month, and the preview shows the reading so a human
 * can catch it. A child "born" in 2040 is the tell.
 */
export function PlayersImport({
  academyId,
  academyName,
  teams,
  defaultSeason,
}: {
  academyId: string
  academyName: string
  teams: { id: string; name: string; season: string | null }[]
  defaultSeason: string
}) {
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const [mapping, setMapping] = useState<Mapping>({})
  const [teamId, setTeamId] = useState('')
  const [season, setSeason] = useState(defaultSeason)
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{
    created: number
    matched: number
    numbered: number
    problems: { row: number; name: string; problem: string }[]
  } | null>(null)

  async function readFile(file: File) {
    setError(null)
    setResult(null)
    setBusy('Reading the file…')
    try {
      // Loaded on demand — the parser is large and nobody who is not
      // importing should pay for it on first page load.
      const XLSX = await import('xlsx')
      const book = XLSX.read(await file.arrayBuffer(), { cellDates: true })
      const sheet = book.Sheets[book.SheetNames[0]]
      if (!sheet) throw new Error('That file has no sheets in it.')

      const parsed = XLSX.utils.sheet_to_json<Row>(sheet, { defval: '', raw: false })
      if (parsed.length === 0) throw new Error('That sheet has no rows.')

      const cols = Object.keys(parsed[0])
      setHeaders(cols)
      setRows(parsed)
      setMapping(suggestMapping(cols, PLAYER_FIELDS))
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
      const full_name = text(row, 'full_name')
      const raw = mapping.dob ? row[mapping.dob] : ''
      const dob = toISODate(raw)

      let problem: string | undefined
      if (!full_name) problem = 'no name'
      else if (!dob) problem = `couldn't read "${String(raw)}" as a date`
      else if (dob > new Date().toISOString().slice(0, 10))
        problem = `reads as ${dob} — check day/month order`

      return {
        index: index + 2, // +2: a spreadsheet's first data row is line 2.
        full_name,
        dob,
        gender: normaliseGender(text(row, 'gender')),
        preferred_name: text(row, 'preferred_name'),
        ff_number: text(row, 'ff_number'),
        squad_number: text(row, 'squad_number').replace(/\D/g, ''),
        school: text(row, 'school'),
        problem,
      }
    })
  }, [rows, mapping])

  const good = prepared.filter((p) => !p.problem)
  const skipped = prepared.filter((p) => p.problem)
  const ready = good.length > 0 && Boolean(mapping.full_name) && Boolean(mapping.dob)

  async function commit() {
    setBusy('Importing…')
    setError(null)
    const { data, error } = await createClient().rpc('import_players', {
      p_academy: academyId,
      // The cast is the same one the fixture importer uses: a SQL `default
      // null` parameter is generated as non-nullable, so "no squad" cannot be
      // expressed without it. Null is what the function is written to expect.
      p_team: (teamId || null) as unknown as string,
      p_season: (season.trim() || null) as unknown as string,
      p_rows: good.map((p) => ({
        full_name: p.full_name,
        dob: p.dob,
        gender: p.gender || undefined,
        preferred_name: p.preferred_name || undefined,
        ff_number: p.ff_number || undefined,
        squad_number: p.squad_number || undefined,
        school: p.school || undefined,
      })),
    })
    setBusy(null)
    if (error) return setError(error.message)
    setResult(data as typeof result)
  }

  return (
    <>
      <AppBar title="Import a roster" meta={academyName} back="/admin/import" />
      <Screen>
        <div className="p-4">
          <p className="text-sm text-ink-2">
            A spreadsheet of players — whatever your club already keeps. Squadroom reads the
            headings, suggests which column is which, and shows you the result before anything is
            written.
          </p>
          {/* Said up front, because somebody will arrive with a file that has
              a parent phone column and wonder why it was ignored. */}
          <p className="mt-2 rounded-lg p-2.5 text-xs" style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }}>
            Parent names and numbers are <b>not</b> imported, even if your file has them. Families
            join with your team&apos;s code and you approve them — that is what keeps a stranger out
            of a channel full of children&apos;s names.
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
                <p className="mt-0.5 text-xs text-ink-3">
                  {fileName} · {rows.length} rows. Suggestions only — check them.
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2.5">
                  {PLAYER_FIELDS.map((field) => (
                    <label key={field.key} className="text-sm">
                      <span className="text-ink-2">
                        {field.label}
                        {field.required && ' *'}
                      </span>
                      <select
                        value={mapping[field.key] ?? ''}
                        onChange={(e) =>
                          setMapping({ ...mapping, [field.key]: e.target.value || undefined })
                        }
                        className="mt-0.5 w-full rounded-lg border p-2 text-sm"
                        style={{ borderColor: 'var(--line)' }}
                      >
                        <option value="">— not in this file —</option>
                        {headers.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              </section>

              <section className="mt-5 grid grid-cols-2 gap-2.5">
                <label className="text-sm">
                  <span className="text-ink-2">Into which squad</span>
                  <select
                    value={teamId}
                    onChange={(e) => setTeamId(e.target.value)}
                    className="mt-0.5 w-full rounded-lg border p-2 text-sm"
                    style={{ borderColor: 'var(--line)' }}
                  >
                    <option value="">No squad yet</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="text-ink-2">Season for shirt numbers</span>
                  <input
                    value={season}
                    onChange={(e) => setSeason(e.target.value)}
                    className="mt-0.5 w-full rounded-lg border p-2 text-sm"
                    style={{ borderColor: 'var(--line)' }}
                  />
                </label>
              </section>

              <section className="mt-5">
                <h2 className="eyebrow">
                  What will happen · {good.length} in
                  {skipped.length > 0 && `, ${skipped.length} skipped`}
                </h2>
                <div className="card mt-2 overflow-hidden">
                  {prepared.slice(0, 12).map((p) => (
                    <div
                      key={p.index}
                      className="flex items-center gap-2 border-t px-3 py-2 text-sm first:border-t-0"
                      style={{ borderColor: 'var(--line-2)' }}
                    >
                      <span className="w-7 flex-none text-xs tabular-nums text-ink-3">
                        {p.squad_number || ''}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">
                          {p.full_name || <em className="text-ink-3">no name</em>}
                          {p.preferred_name && (
                            <span className="text-ink-3"> ({p.preferred_name})</span>
                          )}
                        </span>
                        {p.problem ? (
                          <span className="block text-xs" style={{ color: 'var(--no)' }}>
                            row {p.index}: {p.problem}
                          </span>
                        ) : (
                          <span className="block text-xs text-ink-3">
                            born {p.dob}
                            {p.gender && ` · ${p.gender}`}
                            {p.school && ` · ${p.school}`}
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                  {prepared.length > 12 && (
                    <div className="border-t px-3 py-2 text-xs text-ink-3" style={{ borderColor: 'var(--line-2)' }}>
                      and {prepared.length - 12} more
                    </div>
                  )}
                </div>
              </section>

              <button
                onClick={commit}
                disabled={!ready || busy !== null}
                className="mt-4 w-full rounded-xl px-4 py-3 font-semibold text-white disabled:opacity-50"
                style={{ background: 'var(--brand)' }}
              >
                {!mapping.full_name || !mapping.dob
                  ? 'Pick the name and date of birth columns'
                  : `Import ${good.length} ${good.length === 1 ? 'player' : 'players'}`}
              </button>
            </>
          )}

          {result && (
            <section className="mt-5">
              <div
                className="rounded-xl p-4"
                style={{ background: 'var(--yes-bg)', color: 'var(--yes)' }}
              >
                <p className="font-semibold">
                  {result.created} added
                  {result.matched > 0 && `, ${result.matched} already on the roster`}
                </p>
                {result.numbered > 0 && (
                  <p className="mt-0.5 text-sm">{result.numbered} shirt numbers set.</p>
                )}
              </div>

              {/* Named, not counted. "3 rows had problems" sends a coach back
                  to a spreadsheet with no idea which lines. */}
              {(result.problems ?? []).length > 0 && (
                <div className="card mt-3 overflow-hidden">
                  {result.problems.map((p, i) => (
                    <div
                      key={i}
                      className="border-t px-3 py-2 text-sm first:border-t-0"
                      style={{ borderColor: 'var(--line-2)' }}
                    >
                      <span className="font-medium">{p.name}</span>
                      <span className="block text-xs" style={{ color: 'var(--no)' }}>
                        row {p.row}: {p.problem}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <p className="mt-3 text-sm text-ink-2">
                Re-importing a corrected file is safe — children already on the roster are matched
                on name, gender and date of birth rather than added twice.
              </p>

              <Link
                href={teamId ? `/admin/teams/${teamId}` : '/admin/teams'}
                className="mt-3 block w-full rounded-xl px-4 py-3 text-center font-semibold text-white"
                style={{ background: 'var(--brand)' }}
              >
                See the squad
              </Link>
            </section>
          )}
        </div>
      </Screen>
    </>
  )
}

/**
 * A spreadsheet date, read DAY FIRST, as an ISO date.
 *
 * Same rule and the same reason as the fixture importer: Australian d/m/y and
 * American m/d/y are indistinguishable for the first twelve days of every
 * month, so the choice is made explicitly and shown in the preview rather
 * than left to whatever the parser felt like.
 *
 * A real Date from the parser is used as-is in LOCAL parts, never through
 * toISOString — a local midnight in Sydney becomes the previous day in UTC,
 * which would move every January birthday to December.
 */
function toISODate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(+value)) {
    const y = value.getFullYear()
    const m = String(value.getMonth() + 1).padStart(2, '0')
    const d = String(value.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }

  const text = String(value ?? '').trim()
  if (!text) return ''

  // Already ISO.
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`

  const parts = text.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/)
  if (!parts) return ''
  const day = Number(parts[1])
  const month = Number(parts[2])
  let year = Number(parts[3])
  if (year < 100) year += year > 50 ? 1900 : 2000
  if (day < 1 || day > 31 || month < 1 || month > 12) return ''
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Whatever the club wrote, as one of the three values the column accepts. */
function normaliseGender(raw: string): string {
  const v = raw.trim().toLowerCase()
  if (['f', 'female', 'girl', 'girls', 'w', 'women'].includes(v)) return 'female'
  if (['m', 'male', 'boy', 'boys'].includes(v)) return 'male'
  if (v === '') return ''
  return 'other'
}
