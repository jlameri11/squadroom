import { NextResponse } from 'next/server'
import { createClient, getUserId } from '@/lib/supabase/server'

/**
 * Part C item 5 (0259): the club's registrations as a spreadsheet, with the
 * answers. One row per registration request; a column per question the
 * programs asked, headed by the question's label, in the order the programs
 * ask them. `?programId=` keeps it to one program.
 *
 * CSV for the same reasons as the fees export: every spreadsheet opens it,
 * and the Registrar can read it in an email. Dates as the club writes them
 * (the ISO day — a spreadsheet sorts it). Authorisation is the database's:
 * registrations_export refuses anyone but the club's staff and Registrar.
 */
type Question = { id?: string; label?: string; type?: string; options?: string[] }
type Row = {
  request_id: string
  program_id: string
  program_name: string
  season: string | null
  status: string
  created_at: string
  decided_at: string | null
  decision_note: string | null
  child_name: string
  child_dob: string
  child_gender: string | null
  for_self: boolean
  guardian_name: string
  guardian_phone: string | null
  guardian_email: string | null
  ffa_number: string | null
  fifa_id: string | null
  official_confirmed_at: string | null
  player_id: string | null
  team_name: string | null
  answers: Record<string, unknown> | null
  consents: unknown
  questions: Question[] | null
}

function csv(rows: (string | number | null | undefined)[][]) {
  const cell = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v)
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'
}

/** An answer as a person would write it in a cell. */
function answer(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (Array.isArray(v)) return v.map(answer).join('; ')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** The consents, as "code-of-conduct 2026-03-01; photos 2026-03-01". */
function consents(v: unknown): string {
  if (!Array.isArray(v)) return ''
  return v
    .map((c) => {
      if (typeof c === 'string') return c
      if (c && typeof c === 'object') {
        const o = c as Record<string, unknown>
        const name = o.id ?? o.key ?? o.document ?? o.title ?? ''
        const at = typeof o.accepted_at === 'string' ? o.accepted_at.slice(0, 10) : typeof o.at === 'string' ? o.at.slice(0, 10) : ''
        return [name, at].filter(Boolean).join(' ')
      }
      return ''
    })
    .filter(Boolean)
    .join('; ')
}

export async function GET(request: Request) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const url = new URL(request.url)
  const academyId = url.searchParams.get('academyId')
  const programId = url.searchParams.get('programId')
  if (!academyId) return NextResponse.json({ error: 'Which club?' }, { status: 400 })

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('registrations_export', { p_academy: academyId, p_program: (programId || null) as unknown as string })
  if (error) {
    const status = error.code === '42501' ? 403 : 500
    return NextResponse.json({ error: error.message }, { status })
  }
  const rows = (data ?? []) as Row[]

  // The questions, as a union across the programs in the file, in the order
  // each program asks them; the label heads the column, the id finds the
  // answer. Two programs asking "Which school?" under the same id share a
  // column; under different ids they get one each.
  const questions: { id: string; label: string }[] = []
  const seen = new Set<string>()
  for (const r of rows) {
    for (const q of r.questions ?? []) {
      const id = typeof q?.id === 'string' ? q.id : null
      if (!id || seen.has(id)) continue
      seen.add(id)
      questions.push({ id, label: typeof q.label === 'string' && q.label.trim() ? q.label.trim() : id })
    }
  }

  const today = new Date().toISOString().slice(0, 10)
  const body = csv([
    [
      'Program', 'Season', 'Status', 'Asked on', 'Decided on', 'Note', 'Child', 'Date of birth', 'Gender', 'Registering themselves',
      'Guardian', 'Guardian phone', 'Guardian email', 'FFA number', 'FIFA id', 'PlayFootball confirmed', 'Squad', 'Consents',
      ...questions.map((q) => q.label),
    ],
    ...rows.map((r) => [
      r.program_name, r.season, r.status, r.created_at.slice(0, 10), r.decided_at?.slice(0, 10) ?? '', r.decision_note ?? '',
      r.child_name, r.child_dob, r.child_gender ?? '', r.for_self ? 'Yes' : 'No',
      r.guardian_name, r.guardian_phone ?? '', r.guardian_email ?? '', r.ffa_number ?? '', r.fifa_id ?? '',
      r.official_confirmed_at?.slice(0, 10) ?? '', r.team_name ?? '', consents(r.consents),
      ...questions.map((q) => answer(r.answers?.[q.id])),
    ]),
  ])
  return new NextResponse(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="registrations${programId ? '-program' : ''}-${today}.csv"`,
      'cache-control': 'no-store',
    },
  })
}
