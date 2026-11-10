'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AppBar, Screen } from '@/components/app-shell'
import { createClient } from '@/lib/supabase/client'
import { PLAYER_FIELDS, suggestMapping, toKitSize, toSockSize } from '@/lib/import/columns'

type Row = Record<string, unknown>
type Mapping = Partial<Record<string, string>>

export type Team = { id: string; name: string; season: string | null; age_group?: string | null; label?: string | null }

type Prepared = {
  index: number
  full_name: string
  dob: string
  gender: string
  preferred_name: string
  ff_number: string
  squad_number: string
  school: string
  /** What the file called the squad, and which of ours that is (null: none named, or none matched). */
  team: string
  team_id: string | null
  // Null, not '', because an unrecognised size is DROPPED rather than
  // guessed at — "10Y" probably means 10 and a product that quietly decides
  // that is a product that orders the wrong shirt.
  shirt_size: string | null
  shorts_size: string | null
  socks_size: string | null
  problem?: string
}

type Result = {
  batchId: string
  created: number
  matched: number
  numbered: number
  problems: { row: number; name: string; problem: string }[]
}

type Batch = {
  id: string
  file_name: string | null
  created_at: string
  rows_sent: number
  created_players: number
  matched_players: number
  removed_players: number | null
  undone_at: string | null
}

type Undo = { removed: number; kept: number; kept_names: string[] }

/** Rows per call. The function takes 500; a margin keeps a long row set under it. */
const CHUNK = 400

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
 *
 * 0247 (Big Club Mode item 5): a whole club's file at once. A "Squad" column
 * sends each row to its own squad, matched by name against every name a
 * squad goes by; 1,500 rows go up in chunks on one batch; and the batch can
 * be undone — the players it ADDED are removed, the ones it matched are
 * left, and anyone a family has since claimed stays and is named.
 */
export function PlayersImport({
  academyId,
  academyName,
  teams,
  defaultSeason,
}: {
  academyId: string
  academyName: string
  teams: Team[]
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
  const [result, setResult] = useState<Result | null>(null)
  const [undo, setUndo] = useState<Undo | null>(null)
  const [recent, setRecent] = useState<Batch[] | null>(null)

  // The club's last few imports, each undoable until it has been.
  const loadRecent = useCallback(async () => {
    const { data } = await createClient()
      .from('import_batches')
      .select('id, file_name, created_at, rows_sent, created_players, matched_players, removed_players, undone_at')
      .eq('academy_id', academyId)
      .order('created_at', { ascending: false })
      .limit(5)
    setRecent((data ?? []) as Batch[])
  }, [academyId])
  useEffect(() => {
    void loadRecent()
  }, [loadRecent])

  async function readFile(file: File) {
    setError(null)
    setResult(null)
    setUndo(null)
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

  // Every name a squad goes by, normalised, to the squad.
  const teamIndex = useMemo(() => {
    const index = new Map<string, string>()
    for (const t of teams) {
      const names = [t.name, t.label ?? '', t.age_group ? `${t.age_group} ${t.name}` : '', t.age_group ? `${t.name} ${t.age_group}` : '']
      for (const n of names) {
        const key = normalise(n)
        if (key && !index.has(key)) index.set(key, t.id)
      }
    }
    return index
  }, [teams])

  const prepared: Prepared[] = useMemo(() => {
    const text = (row: Row, key: string) => {
      const column = mapping[key]
      return column ? String(row[column] ?? '').trim() : ''
    }

    return rows.map((row, index) => {
      const full_name = text(row, 'full_name')
      const raw = mapping.dob ? row[mapping.dob] : ''
      const dob = toISODate(raw)
      const team = text(row, 'team')
      const team_id = team ? (teamIndex.get(normalise(team)) ?? null) : null

      let problem: string | undefined
      if (!full_name) problem = 'no name'
      else if (!dob) problem = `couldn't read "${String(raw)}" as a date`
      else if (dob > new Date().toISOString().slice(0, 10))
        problem = `reads as ${dob} — check day/month order`
      else if (team && !team_id) problem = `no squad called "${team}" — add it first, or map a different column`

      return {
        index: index + 2, // +2: a spreadsheet's first data row is line 2.
        full_name,
        dob,
        gender: normaliseGender(text(row, 'gender')),
        preferred_name: text(row, 'preferred_name'),
        ff_number: text(row, 'ff_number'),
        squad_number: text(row, 'squad_number').replace(/\D/g, ''),
        school: text(row, 'school'),
        team,
        team_id,
        // Dropped rather than guessed at. "10Y" probably means 10 and "med"
        // probably means M, and a product that quietly decides either is a
        // product that orders the wrong shirt — so an unrecognised size
        // becomes a blank, which is a question a club can ask.
        shirt_size: toKitSize(text(row, 'shirt_size')),
        shorts_size: toKitSize(text(row, 'shorts_size')),
        socks_size: toSockSize(text(row, 'socks_size')),
        problem,
      }
    })
  }, [rows, mapping, teamIndex])

  const good = prepared.filter((p) => !p.problem)
  const skipped = prepared.filter((p) => p.problem)
  const ready = good.length > 0 && Boolean(mapping.full_name) && Boolean(mapping.dob)
  const teamName = (id: string | null) => teams.find((t) => t.id === id)?.name ?? null
  const squadsNamed = new Set(good.map((p) => p.team_id).filter(Boolean)).size

  async function commit() {
    setBusy('Starting…')
    setError(null)
    const supabase = createClient()
    const { data: batchId, error: startErr } = await supabase.rpc('start_import_batch', {
      p_academy: academyId,
      p_kind: 'players',
      p_file: (fileName || null) as unknown as string,
    })
    if (startErr || !batchId) {
      setBusy(null)
      return setError(startErr?.message ?? 'Could not start the import.')
    }

    const totals: Result = { batchId, created: 0, matched: 0, numbered: 0, problems: [] }
    for (let at = 0; at < good.length; at += CHUNK) {
      const chunk = good.slice(at, at + CHUNK)
      setBusy(`Importing… ${Math.min(at + chunk.length, good.length)} of ${good.length}`)
      const { data, error } = await supabase.rpc('import_players', {
        p_academy: academyId,
        // The cast is the same one the fixture importer uses: a SQL `default
        // null` parameter is generated as non-nullable, so "no squad" cannot be
        // expressed without it. Null is what the function is written to expect.
        p_team: (teamId || null) as unknown as string,
        p_season: (season.trim() || null) as unknown as string,
        p_batch: batchId,
        p_rows: chunk.map((p) => ({
          full_name: p.full_name,
          dob: p.dob,
          gender: p.gender || undefined,
          preferred_name: p.preferred_name || undefined,
          ff_number: p.ff_number || undefined,
          squad_number: p.squad_number || undefined,
          school: p.school || undefined,
          shirt_size: p.shirt_size || undefined,
          shorts_size: p.shorts_size || undefined,
          socks_size: p.socks_size || undefined,
          // The row's own squad; the function falls back to the one picked
          // for the whole file.
          team_id: p.team_id ?? undefined,
        })),
      })
      if (error) {
        setBusy(null)
        setResult(totals.created + totals.matched > 0 ? totals : null)
        return setError(`${error.message} — ${totals.created} added so far; you can undo this import below.`)
      }
      const part = data as unknown as Omit<Result, 'batchId'>
      totals.created += part.created
      totals.matched += part.matched
      totals.numbered += part.numbered
      // Problem rows are numbered within their chunk; make them the file's lines.
      totals.problems.push(...(part.problems ?? []).map((pr) => ({ ...pr, row: chunk[pr.row - 1]?.index ?? pr.row })))
    }
    setBusy(null)
    setResult(totals)
    void loadRecent()
  }

  async function undoBatch(id: string) {
    setBusy('Undoing…')
    setError(null)
    const { data, error } = await createClient().rpc('undo_import_batch', { p_batch: id })
    setBusy(null)
    if (error) return setError(error.message)
    setUndo(data as unknown as Undo)
    void loadRecent()
  }

  return (
    <>
      <AppBar title="Import a roster" meta={academyName} back="/admin/import" />
      <Screen>
        <div className="p-4">
          <p className="text-sm text-ink-2">
            A spreadsheet of players — whatever your club already keeps, the whole club in one file
            if a column names each squad. Squadroom reads the headings, suggests which column is
            which, and shows you the result before anything is written.
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
              data-import-file
            />
          </label>

          {busy && <p className="mt-3 text-sm text-ink-2" data-import-busy>{busy}</p>}
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
                        data-map={field.key}
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
                  <span className="text-ink-2">{mapping.team ? 'Squad for rows without one' : 'Into which squad'}</span>
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
                  {squadsNamed > 0 && ` · ${squadsNamed} ${squadsNamed === 1 ? 'squad' : 'squads'}`}
                </h2>
                <div className="card mt-2 overflow-hidden" data-import-preview>
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
                          <span className="block truncate text-xs text-ink-3">
                            born {p.dob}
                            {p.gender && ` · ${p.gender}`}
                            {(p.team_id || teamId) && ` · ${teamName(p.team_id ?? teamId)}`}
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
                className="mt-4 w-full rounded-xl px-4 py-3 font-semibold text-brand-ink disabled:opacity-50"
                style={{ background: 'var(--brand)' }}
                data-import-go
              >
                {!mapping.full_name || !mapping.dob
                  ? 'Pick the name and date of birth columns'
                  : `Import ${good.length} ${good.length === 1 ? 'player' : 'players'}`}
              </button>
            </>
          )}

          {result && (
            <section className="mt-5" data-import-result>
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

              {undo ? (
                <p className="mt-3 rounded-xl p-3 text-sm" style={{ background: 'var(--surface-2)' }} data-import-undone>
                  <b>Undone.</b> {undo.removed} {undo.removed === 1 ? 'player' : 'players'} removed
                  {undo.kept > 0 && ` · ${undo.kept} kept because a family has since claimed them, or they have registered: ${undo.kept_names.join(', ')}`}.
                </p>
              ) : (
                <>
                  <p className="mt-3 text-sm text-ink-2">
                    Re-importing a corrected file is safe — children already on the roster are matched
                    on name, gender and date of birth rather than added twice. Wrong file? Undo removes
                    exactly the players this import added, and nothing the club already had.
                  </p>
                  <button
                    onClick={() => undoBatch(result.batchId)}
                    disabled={busy !== null}
                    className="mt-3 w-full rounded-xl border px-4 py-3 font-semibold disabled:opacity-50"
                    style={{ borderColor: 'var(--line)' }}
                    data-import-undo
                  >
                    Undo this import
                  </button>
                </>
              )}

              <Link
                href={teamId ? `/admin/teams/${teamId}` : '/admin/teams'}
                className="mt-3 block w-full rounded-xl px-4 py-3 text-center font-semibold text-brand-ink"
                style={{ background: 'var(--brand)' }}
              >
                See the squads
              </Link>
            </section>
          )}

          {/* The last few imports, each undoable until it has been — for the
              coach who finds out on Monday that Saturday's file was last
              season's. */}
          {headers.length === 0 && !result && recent && recent.length > 0 && (
            <section className="mt-6" data-recent-imports>
              <h2 className="eyebrow">Recent imports</h2>
              <ul className="card mt-2 divide-y overflow-hidden" style={{ borderColor: 'var(--line-2)' }}>
                {recent.map((b) => (
                  <li key={b.id} className="flex items-center gap-3 px-3 py-2.5 text-sm" data-import-batch={b.id}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{b.file_name ?? 'A spreadsheet'}</span>
                      <span className="block truncate text-xs text-ink-3">
                        {new Date(b.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                        {' · '}
                        {b.undone_at
                          ? `undone · ${b.removed_players ?? 0} removed`
                          : `${b.created_players} added${b.matched_players ? `, ${b.matched_players} matched` : ''}`}
                      </span>
                    </span>
                    {!b.undone_at && (
                      <button
                        onClick={() => undoBatch(b.id)}
                        disabled={busy !== null}
                        className="tap flex-none text-sm font-semibold underline underline-offset-4 disabled:opacity-50"
                      >
                        Undo
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {undo && (
                <p className="mt-2 text-sm text-ink-2" data-import-undone>
                  Undone: {undo.removed} removed{undo.kept > 0 && `, ${undo.kept} kept (${undo.kept_names.join(', ')})`}.
                </p>
              )}
            </section>
          )}
        </div>
      </Screen>
    </>
  )
}

/** A squad's name as a key: case, punctuation and spacing do not count. */
function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
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
