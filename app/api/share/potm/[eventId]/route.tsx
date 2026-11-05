import { ImageResponse } from 'next/og'
import { NextResponse } from 'next/server'
import { createClient, getUserId } from '@/lib/supabase/server'
import { Eyebrow, Frame, inkOn, logoDataUri, safeColour, sizeOf } from '@/lib/share/card'

/**
 * The Player of the Match, as a picture a club can post (X-04, X-03).
 *
 * Signed in, like the result card: the club's image, not an open renderer.
 * event_stats says whether there is a star and refuses anyone outside the
 * squad. NO CHILD IS NAMED, the rule every card keeps (X-04, R-16): this is a
 * graphic for a public feed, and the family knows who it is. The coach's
 * word carries it. No photo either, for the same reason.
 */
export async function GET(request: Request, ctx: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await ctx.params
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const supabase = await createClient()
  const { data: event } = await supabase.from('events').select('id, academy_id, title, opponent, starts_at, round').eq('id', eventId).maybeSingle()
  if (!event) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [{ data: stats }, { data: academy }, { data: result }, { data: team }, { data: sponsors }] = await Promise.all([
    supabase.rpc('event_stats', { p_event: eventId }),
    supabase.from('academies').select('*').eq('id', event.academy_id).maybeSingle(),
    supabase.rpc('event_result', { p_event: eventId }),
    supabase.from('events').select('teams(name)').eq('id', eventId).maybeSingle(),
    supabase.rpc('card_sponsors', { p_academy: event.academy_id }),
  ])
  const thanks = ((sponsors as unknown as { name: string }[] | null) ?? []).map((s) => s.name)
  const footer = (academy?.name ?? 'Squadroom') + (thanks.length ? ` · with thanks to ${thanks.join(', ')}` : '')
  const s = stats as unknown as { players: { potm: boolean; note: string | null }[] } | null
  const star = s?.players.find((p) => p.potm)
  if (!star) return NextResponse.json({ error: 'No Player of the Match picked for that game yet.' }, { status: 409 })
  const squad = (team as unknown as { teams: { name: string } | null } | null)?.teams?.name ?? null

  const { width, height } = sizeOf(new URL(request.url).searchParams.get('size'))
  const brand = safeColour(academy?.primary_colour)
  const ink = inkOn(brand)
  const accent = safeColour((academy as { secondary_colour?: string | null } | null)?.secondary_colour, '') || null
  const logo = await logoDataUri(academy?.logo_url)
  const score = result?.[0]
  const when = new Date(event.starts_at).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })

  return new ImageResponse(
    (
      <Frame brand={brand} width={width} height={height} footer={footer} logo={logo} accent={accent}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <Eyebrow ink={ink}>{squad ? `${squad} · Player of the Match` : 'Player of the Match'}</Eyebrow>
          <div style={{ display: 'flex', fontSize: Math.round(width / 9), fontWeight: 800, color: ink, lineHeight: 1.05, marginTop: 12 }}>
            🏆
          </div>
          <div style={{ display: 'flex', fontSize: Math.round(width / 20), fontWeight: 700, color: ink, lineHeight: 1.1, marginTop: 10 }}>
            {star.note ? `“${star.note}”` : 'Our star today — the squad knows who.'}
          </div>
          {star.note && (
            <div style={{ display: 'flex', fontSize: Math.round(width / 30), color: ink, opacity: 0.85, marginTop: 10 }}>
              Our star today — the squad knows who.
            </div>
          )}
          <div style={{ display: 'flex', fontSize: Math.round(width / 30), color: ink, opacity: 0.8, marginTop: 24 }}>
            {[event.opponent ? `v ${event.opponent}` : event.title, score ? `${score.ours}–${score.theirs}` : null, when].filter(Boolean).join(' · ')}
          </div>
        </div>
      </Frame>
    ),
    { width, height }
  )
}
