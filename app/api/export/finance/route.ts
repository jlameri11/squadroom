import { NextResponse } from 'next/server'
import { createClient, getUserId } from '@/lib/supabase/server'

/**
 * B-05: the club's money, as a spreadsheet.
 *
 * `?view=detail` is one row per child per fee — what was asked, what the
 * family actually owes after discounts, what is paid, what is outstanding,
 * and the Stripe payment ids so a treasurer can match rows to Stripe's own
 * payout report. `?view=summary` is the same money totalled three ways —
 * by program, by squad and by family — which is what a committee meeting
 * reads.
 *
 * CSV, not XLSX: Excel, Numbers and Google Sheets all open it, and a CSV is
 * a text file somebody can read in an email. Dollars with two places, from
 * integer cents, formatted once here.
 *
 * Authorisation is the database's: finance_export refuses anyone but the
 * club's staff, and the cookie client carries the caller's session.
 */
type Row = {
  request_id: string
  title: string
  scope_kind: string
  scope_name: string | null
  due_on: string | null
  instalments: number
  player_id: string
  player_name: string
  guardian_name: string | null
  guardian_phone: string | null
  fee_cents: number
  net_cents: number
  paid_cents: number
  outstanding_cents: number
  status: string
  paid_at: string | null
  stripe_payment_intents: string | null
}

const dollars = (cents: number) => (cents / 100).toFixed(2)

function csv(rows: (string | number | null | undefined)[][]) {
  const cell = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v)
    // Quote anything with a comma, quote, or newline; double the quotes.
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'
}

export async function GET(request: Request) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const url = new URL(request.url)
  const academyId = url.searchParams.get('academyId')
  const view = url.searchParams.get('view') === 'summary' ? 'summary' : 'detail'
  if (!academyId) return NextResponse.json({ error: 'Which club?' }, { status: 400 })

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('finance_export', { p_academy: academyId })
  if (error) {
    const status = error.code === '42501' ? 403 : 500
    return NextResponse.json({ error: error.message }, { status })
  }
  const rows = (data ?? []) as Row[]
  const today = new Date().toISOString().slice(0, 10)

  if (view === 'detail') {
    const body = csv([
      [
        'Fee', 'For', 'Program or squad', 'Due', 'Instalments', 'Player', 'Guardian', 'Guardian phone',
        'Fee (list)', 'Owed after discounts', 'Paid', 'Outstanding', 'Status', 'Paid at', 'Stripe payment ids',
      ],
      ...rows.map((r) => [
        r.title, r.scope_kind, r.scope_name, r.due_on, r.instalments, r.player_name, r.guardian_name,
        r.guardian_phone, dollars(r.fee_cents), dollars(r.net_cents), dollars(r.paid_cents),
        dollars(r.outstanding_cents), r.status, r.paid_at, r.stripe_payment_intents,
      ]),
    ])
    return new NextResponse(body, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="fees-${today}.csv"`,
        'cache-control': 'no-store',
      },
    })
  }

  // Summary: totals by program/squad, then by family.
  const groups = new Map<string, { group: string; name: string; players: Set<string>; net: number; paid: number; out: number }>()
  const add = (group: string, name: string, r: Row) => {
    const key = `${group}\u0000${name}`
    const g = groups.get(key) ?? { group, name, players: new Set<string>(), net: 0, paid: 0, out: 0 }
    g.players.add(r.player_id)
    g.net += r.net_cents
    g.paid += r.paid_cents
    g.out += r.outstanding_cents
    groups.set(key, g)
  }
  for (const r of rows) {
    add(r.scope_kind === 'program' ? 'Program' : r.scope_kind === 'team' ? 'Squad' : 'Whole club', r.scope_name ?? r.title, r)
    add('Family', r.guardian_name ?? `(no guardian) ${r.player_name}`, r)
  }
  const order = ['Program', 'Squad', 'Whole club', 'Family']
  const sorted = [...groups.values()].sort(
    (a, b) => order.indexOf(a.group) - order.indexOf(b.group) || a.name.localeCompare(b.name)
  )
  const body = csv([
    ['Group', 'Name', 'Players', 'Owed after discounts', 'Paid', 'Outstanding'],
    ...sorted.map((g) => [g.group, g.name, g.players.size, dollars(g.net), dollars(g.paid), dollars(g.out)]),
    [],
    ['All', 'Everything', new Set(rows.map((r) => r.player_id)).size,
      dollars(rows.reduce((n, r) => n + r.net_cents, 0)),
      dollars(rows.reduce((n, r) => n + r.paid_cents, 0)),
      dollars(rows.reduce((n, r) => n + r.outstanding_cents, 0))],
  ])
  return new NextResponse(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="fees-summary-${today}.csv"`,
      'cache-control': 'no-store',
    },
  })
}
