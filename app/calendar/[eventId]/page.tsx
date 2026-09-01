import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { EventDetail } from './event-detail'

export default async function EventPage(props: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await props.params
  const supabase = await createClient()

  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) redirect('/signin')

  const { data: event } = await supabase
    .from('events')
    .select('id, academy_id, team_id, type, title, description, starts_at, ends_at, arrive_at, venue, address, opponent, kit_colour, round, notes, cancelled_at, competition_id')
    .eq('id', eventId)
    .maybeSingle()

  if (!event) notFound()

  const [{ data: mine }, { data: summary }, { data: roster }] = await Promise.all([
    supabase.rpc('my_rsvps_for_event', { p_event: eventId }),
    supabase.rpc('event_rsvp_summary', { p_event: eventId }),
    // Returns nothing to a parent — the RSVP policy limits it to their own.
    supabase
      .from('event_rsvps')
      .select('status, note, player_id, players(full_name)')
      .eq('event_id', eventId),
  ])

  const isCoach = Boolean(summary?.[0])

  return (
    <main className="mx-auto max-w-md p-5">
      <Link href="/calendar" className="text-sm text-neutral-500">← Fixtures</Link>
      <EventDetail
        event={event}
        mine={(mine ?? []).map((r) => ({
          playerId: r.player_id,
          playerName: r.player_name,
          status: r.status,
          note: r.note,
        }))}
        isCoach={isCoach}
        summary={summary?.[0] ?? null}
        roster={(roster ?? []).map((r) => ({
          playerId: r.player_id,
          name: nameOf(r.players),
          status: r.status,
          note: r.note,
        }))}
      />
    </main>
  )
}

function nameOf(rel: unknown): string {
  const one = Array.isArray(rel) ? rel[0] : rel
  return (one as { full_name?: string } | null)?.full_name ?? 'Player'
}
