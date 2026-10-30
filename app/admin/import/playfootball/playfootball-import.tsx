'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AppBar, Screen } from '@/components/app-shell'
import { createClient } from '@/lib/supabase/client'
import { getOrg } from '@/lib/org'
import { OFFICIAL_FIELDS, suggestMapping, toLocalDate } from '@/lib/import/columns'

type Row = Record<string, unknown>
type Mapping = Partial<Record<string, string>>
type Prepared = {
  index: number
  full_name: string
  dob: string | null
  ffa_number: string
  fifa_id: string
  status: string
  problem?: string
}
type Result = { matched: number; confirmed_requests: number; unmatched: { name: string; dob: string | null }[] }

/**
 * The registrations export from PlayFootball, read the same way the roster
 * importer reads a spreadsheet: suggest which column is which, a human
 * confirms, a preview, then one call that matches each row to a player by
 * FFA number, FIFA ID or name + date of birth and sets their official
 * status. Pending requests for the same children are confirmed too.
 */
export function PlayfootballImport() {
  const [academy, setAcademy] = useState<{ id: string; name: string } | null | undefined>(undefined)
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const [mapping, setMapping] = useState<Mapping>({})
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)

  useEffect(() => {
    ;(async () => {
      const supabase = createClient()
      let org = getOrg()
      if (!org) {
        const { data: m } = await supabase.from('academy_members').select('academy_id').eq('status', 'active').limit(1).maybeSingle()
        org = m?.academy_id ?? null
      }
      if (!org) return setAcademy(null)
      const { data: a } = await supabase.from('academies').select('id, name').eq('id', org).maybeSingle()
      setAcademy(a ?? null)
    })()
  }, [])

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
      setMapping(suggestMapping(cols, OFFICIAL_FIELDS))
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
      const full_name = text(row, 'full_name') || [text(row, 'first_name'), text(row, 'last_name')].filter(Boolean).join(' ')
      const rawDob = mapping.dob ? row[mapping.dob] : ''
      const dob = rawDob === '' || rawDob == null ? null : toLocalDate(rawDob)
      const ffa_number = text(row, 'ffa_number').replace(/\D/g, '')
      const fifa_id = text(row, 'fifa_id').replace(/\D/g, '')
      let problem: string | undefined
      if (!ffa_number && !fifa_id && !(full_name && dob)) problem = 'nothing to match on — needs an FFA number, a FIFA ID, or a name and date of birth'
      else if (mapping.dob && rawDob !== '' && !dob) problem = `couldn't read "${String(rawDob)}" as a date`
      return { index: index + 2, full_name, dob, ffa_number, fifa_id, status: text(row, 'status'), problem }
    })
  }, [rows, mapping])

  const good = prepared.filter((p) => !p.problem)
  const skipped = prepared.filter((p) => p.problem)

  async function commit() {
    if (!academy) return
    setBusy('Matching…')
    setError(null)
    const { data, error } = await createClient().rpc('import_official_status', {
      p_academy: academy.id,
      p_rows: good.map((p) => ({
        full_name: p.full_name || undefined,
        dob: p.dob || undefined,
        ffa_number: p.ffa_number || undefined,
        fifa_id: p.fifa_id || undefined,
        status: p.status || undefined,
      })),
    })
    setBusy(null)
    if (error) return setError(error.message)
    setResult(data as unknown as Result)
  }

  return (
    <>
      <AppBar title="PlayFootball export" meta={academy?.name ?? ''} back="/admin/import" />
      <Screen>
        <div className="p-4">
          {academy === null && <p className="text-sm text-ink-2">You are not in a club yet.</p>}
          <p className="text-sm text-ink-2">
            In PlayFootball, as your club&apos;s admin, export your registrations and choose the file
            here. Squadroom matches each row to a player by FFA number, FIFA ID or name and date of
            birth, marks them registered (or pending), and confirms any waiting registration for the
            same child.
          </p>
          <p className="mt-2 rounded-lg p-2.5 text-xs" style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }}>
            Squadroom never logs in to PlayFootball. Only the file you download from your own
            account comes across, and only the columns you map below are read.
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
                  {OFFICIAL_FIELDS.map((field) => (
                    <label key={field.key} className="text-sm">
                      <span className="text-ink-2">{field.label}</span>
                      <select
                        value={mapping[field.key] ?? ''}
                        onChange={(e) => setMapping({ ...mapping, [field.key]: e.target.value || undefined })}
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

              <section className="mt-5">
                <h2 className="eyebrow">What will happen</h2>
                <p className="mt-0.5 text-sm text-ink-2">
                  {good.length} {good.length === 1 ? 'row' : 'rows'} to match
                  {skipped.length > 0 ? `, ${skipped.length} skipped` : ''}.
                </p>
                <ul className="mt-2 divide-y text-sm" style={{ borderColor: 'var(--line-2)' }}>
                  {prepared.slice(0, 12).map((p) => (
                    <li key={p.index} className="flex items-baseline gap-2 py-1.5">
                      <span className="w-8 flex-none text-xs tabular-nums text-ink-3">{p.index}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{p.full_name || '(no name)'}{p.dob ? ` · ${p.dob}` : ''}</span>
                        <span className="block truncate text-xs text-ink-3">
                          {p.problem ?? [p.ffa_number && `FFA ${p.ffa_number}`, p.fifa_id && `FIFA ${p.fifa_id}`, p.status].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                    </li>
                  ))}
                  {prepared.length > 12 && <li className="py-1.5 text-xs text-ink-3">…and {prepared.length - 12} more</li>}
                </ul>
              </section>

              <button
                onClick={() => void commit()}
                disabled={good.length === 0 || !academy || Boolean(busy)}
                className="mt-5 w-full rounded-xl px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: 'var(--brand)' }}
              >
                Match {good.length} {good.length === 1 ? 'row' : 'rows'}
              </button>
            </>
          )}

          {result && (
            <section className="card mt-5 p-4 text-sm">
              <p>
                <b>{result.matched}</b> {result.matched === 1 ? 'player' : 'players'} matched and updated
                {result.confirmed_requests > 0 ? `; ${result.confirmed_requests} waiting ${result.confirmed_requests === 1 ? 'registration' : 'registrations'} confirmed` : ''}.
              </p>
              {result.unmatched.length > 0 && (
                <>
                  <p className="mt-2 text-ink-2">Not found on your roster ({result.unmatched.length}):</p>
                  <ul className="mt-1 text-ink-3">
                    {result.unmatched.map((u, i) => (
                      <li key={i}>{u.name}{u.dob ? ` · ${u.dob}` : ''}</li>
                    ))}
                  </ul>
                </>
              )}
              <p className="mt-3">
                <Link href="/admin/registrations" className="underline underline-offset-2" style={{ color: 'var(--brand-text)' }}>
                  Back to registrations ›
                </Link>
              </p>
            </section>
          )}
        </div>
      </Screen>
    </>
  )
}
