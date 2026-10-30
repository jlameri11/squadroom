import { NextResponse } from 'next/server'
import { createClient, getUserId } from '@/lib/supabase/server'

type Row = {
  run_period: string
  run_status: string
  paid_at: string | null
  paid_method: string | null
  referee: string
  grade: string | null
  bank_details: string | null
  game: string
  played_on: string | null
  role: string
  amount_cents: number
  item_status: string
}

const dollars = (cents: number) => (cents / 100).toFixed(2)

function csv(rows: (string | number | null | undefined)[][]) {
  const cell = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v)
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'
}

/** L-07: the treasurer's referee-payments CSV, one row per game fee. */
export async function GET(request: Request) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const url = new URL(request.url)
  const competitionId = url.searchParams.get('competitionId')
  if (!competitionId) return NextResponse.json({ error: 'Which competition?' }, { status: 400 })

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('referee_payments_export', { p_competition: competitionId })
  if (error) return NextResponse.json({ error: error.message }, { status: error.code === '42501' ? 403 : 500 })
  const rows = (data ?? []) as Row[]
  const body = csv([
    ['Run', 'Run status', 'Paid at', 'Paid by', 'Referee', 'Grade', 'Bank details', 'Game', 'Played', 'Role', 'Amount', 'Status'],
    ...rows.map((r) => [
      r.run_period, r.run_status, r.paid_at, r.paid_method, r.referee, r.grade, r.bank_details, r.game,
      r.played_on ? new Date(r.played_on).toLocaleString('en-AU', { timeZone: 'Australia/Sydney' }) : '',
      r.role, dollars(r.amount_cents), r.item_status,
    ]),
  ])
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="referee-payments-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
}
