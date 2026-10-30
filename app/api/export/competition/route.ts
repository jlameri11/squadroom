import { NextResponse } from 'next/server'
import { createClient, getUserId } from '@/lib/supabase/server'

const SYDNEY = 'Australia/Sydney'

function csv(rows: (string | number | null | undefined)[][]) {
  const cell = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v)
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'
}
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-AU', { timeZone: SYDNEY }) : '')

type SheetRow = {
  fixture_id: string
  starts_at: string | null
  field_label: string | null
  division: string
  group_label: string | null
  round: string | null
  home_name: string | null
  away_name: string | null
  home_score: number | null
  away_score: number | null
  status: string
  referees: string | null
}
type LadderRow = {
  entry_id: string
  team_name: string
  group_label: string | null
  played: number
  won: number
  drawn: number
  lost: number
  goals_for: number
  goals_against: number
  goal_difference: number
  points: number
}
type Discipline = {
  rules: { yellows_per_suspension: number; games_per_yellow_suspension: number; games_per_red: number }
  players: {
    name: string
    club: string | null
    entry: string | null
    yellows: number
    reds: number
    blues: number
    suspensions: { reason: string; games: number; served: number; status: string; issued_at: string; note: string | null; appeal_note: string | null }[]
  }[]
}

/**
 * L-15: a competition's reports as CSV — results, ladders, discipline,
 * entries. Read through the caller's own client, so every report answers
 * exactly what that person may see: a club gets its competition's draw and
 * ladders, the organiser gets the contacts too, a stranger gets 404.
 * Referee payments have their own route (L-07).
 */
export async function GET(request: Request) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const url = new URL(request.url)
  const competitionId = url.searchParams.get('competitionId')
  const report = url.searchParams.get('report') ?? 'results'
  if (!competitionId) return NextResponse.json({ error: 'Which competition?' }, { status: 400 })

  const supabase = await createClient()
  const { data: comp } = await supabase.from('competitions').select('id, name, season').eq('id', competitionId).maybeSingle()
  if (!comp) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const stamp = new Date().toISOString().slice(0, 10)
  const slug = comp.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const send = (name: string, body: string) =>
    new NextResponse(body, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${slug}-${name}-${stamp}.csv"`,
      },
    })

  if (report === 'results') {
    const { data, error } = await supabase.rpc('competition_run_sheet', { p_competition: competitionId })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const rows = (data ?? []) as SheetRow[]
    return send('results', csv([
      ['Division', 'Group', 'Round', 'Kick-off', 'Field', 'Home', 'Away', 'Home score', 'Away score', 'Status', 'Referees'],
      ...rows.map((r) => [r.division, r.group_label, r.round, when(r.starts_at), r.field_label, r.home_name, r.away_name, r.home_score, r.away_score, r.status, r.referees]),
    ]))
  }

  if (report === 'ladders') {
    const { data: entries } = await supabase.from('competition_entries').select('division').eq('competition_id', competitionId)
    const divisions = [...new Set((entries ?? []).map((e) => e.division).filter(Boolean))].sort() as string[]
    const out: (string | number | null)[][] = [['Division', 'Position', 'Team', 'Group', 'P', 'W', 'D', 'L', 'GF', 'GA', 'GD', 'Pts']]
    for (const d of divisions) {
      const { data } = await supabase.rpc('competition_ladder', { p_competition: competitionId, p_division: d })
      ;((data ?? []) as LadderRow[]).forEach((r, i) => {
        out.push([d, i + 1, r.team_name, r.group_label, r.played, r.won, r.drawn, r.lost, r.goals_for, r.goals_against, r.goal_difference, r.points])
      })
    }
    return send('ladders', csv(out))
  }

  if (report === 'discipline') {
    const { data, error } = await supabase.rpc('discipline_report', { p_competition: competitionId })
    if (error) return NextResponse.json({ error: error.message }, { status: error.code === '42501' ? 403 : 500 })
    const rep = data as unknown as Discipline
    const out: (string | number | null)[][] = [['Player', 'Club', 'Team', 'Yellows', 'Reds', 'Blues', 'Suspension', 'Games', 'Served', 'Status', 'Issued', 'Note', 'Appeal']]
    for (const p of rep.players) {
      if (p.suspensions.length === 0) out.push([p.name, p.club, p.entry, p.yellows, p.reds, p.blues, '', '', '', '', '', '', ''])
      for (const s of p.suspensions) out.push([p.name, p.club, p.entry, p.yellows, p.reds, p.blues, s.reason, s.games, s.served, s.status, when(s.issued_at), s.note, s.appeal_note])
    }
    out.push([])
    out.push(['Rules', `${rep.rules.yellows_per_suspension} yellows → ${rep.rules.games_per_yellow_suspension} game(s)`, `red → ${rep.rules.games_per_red} game(s)`])
    return send('discipline', csv(out))
  }

  if (report === 'entries') {
    const [{ data: entries }, { data: contacts }] = await Promise.all([
      supabase
        .from('competition_entries')
        .select('display_name, division, group_label, team_id, academy:academies(name)')
        .eq('competition_id', competitionId)
        .order('division')
        .order('display_name'),
      // Organiser only inside the function; a club gets an empty list.
      supabase.rpc('competition_contacts', { p_competition: competitionId }),
    ])
    const byClub = new Map<string, { contact_name: string | null; contact_email: string | null; contact_phone: string | null; status: string }>()
    for (const c of (contacts ?? []) as { club_name: string; status: string; contact_name: string | null; contact_email: string | null; contact_phone: string | null }[]) {
      byClub.set(c.club_name.toLowerCase(), c)
    }
    const rows = (entries ?? []) as { display_name: string; division: string; group_label: string | null; team_id: string | null; academy: { name: string } | null }[]
    return send('entries', csv([
      ['Team', 'Division', 'Group', 'Club', 'On Squadroom', 'Invite status', 'Contact', 'Email', 'Phone'],
      ...rows.map((e) => {
        const c = byClub.get((e.academy?.name ?? e.display_name).toLowerCase())
        return [e.display_name, e.division, e.group_label, e.academy?.name ?? '', e.team_id ? 'yes' : 'no', c?.status ?? '', c?.contact_name ?? '', c?.contact_email ?? '', c?.contact_phone ?? '']
      }),
    ]))
  }

  return NextResponse.json({ error: 'Which report? results, ladders, discipline or entries' }, { status: 400 })
}
