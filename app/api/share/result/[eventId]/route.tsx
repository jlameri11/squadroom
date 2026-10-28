import { ImageResponse } from 'next/og'
import { NextResponse } from 'next/server'
import { createClient, getUserId } from '@/lib/supabase/server'
import { Eyebrow, Frame, inkOn, safeColour, sizeOf } from '@/lib/share/card'

/**
 * Saturday's result, as a picture a club can post.
 *
 * X-04. The thing a club does with a result is tell people, and what it has
 * to do that with today is a screenshot of a phone. A graphic in their own
 * colours is the difference between a club that looks organised and one that
 * looks like it is using an app.
 *
 * SIGNED IN, though nothing on the card is private. Not because the score is
 * a secret — the public match centre publishes scores — but because this is
 * the club's image to post, and an open endpoint that renders any club's
 * branded graphic on request is a thing somebody will eventually use to make
 * a fake one.
 *
 * The score comes from `event_result`, which is the function that knows
 * whether it lives on the event or on a competition fixture, and which knows
 * which side of a fixture this academy was on. A card that printed a 3-0 win
 * as 0-3 would be the single most visible bug the product could ship.
 */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ eventId: string }> }
) {
  const { eventId } = await ctx.params

  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const supabase = await createClient()

  // RLS decides this. If the event is hidden from this person, so is its card.
  const { data: event } = await supabase
    .from('events')
    .select('id, academy_id, title, opponent, starts_at, venue, round, type')
    .eq('id', eventId)
    .maybeSingle()
  if (!event) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [{ data: result }, { data: academy }] = await Promise.all([
    supabase.rpc('event_result', { p_event: eventId }),
    supabase
      .from('academies')
      .select('name, primary_colour')
      .eq('id', event.academy_id)
      .maybeSingle(),
  ])

  const score = result?.[0]
  if (!score) {
    return NextResponse.json(
      { error: 'No result recorded for that game yet.' },
      { status: 409 }
    )
  }

  const { width, height } = sizeOf(new URL(request.url).searchParams.get('size'))
  const brand = safeColour(academy?.primary_colour)
  const ink = inkOn(brand)

  const outcome = score.outcome === 'won' ? 'Won' : score.outcome === 'lost' ? 'Lost' : 'Drew'
  const when = new Date(event.starts_at).toLocaleDateString('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

  return new ImageResponse(
    (
      <Frame brand={brand} width={width} height={height} footer={academy?.name ?? 'Squadroom'}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <Eyebrow ink={ink}>{event.round ? `${outcome} · ${event.round}` : outcome}</Eyebrow>

          {/* The score, as large as it will go. This is the whole picture;
              everything else on the card is a caption for it. */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              marginTop: height * 0.04,
              fontSize: height * 0.19,
              fontWeight: 700,
              letterSpacing: -6,
            }}
          >
            {score.ours}
            {/* Smaller than the numbers. At the same size an en-dash renders
                as a slab and reads as a redaction. */}
            <span
              style={{
                fontSize: height * 0.09,
                opacity: 0.45,
                paddingLeft: 36,
                paddingRight: 36,
              }}
            >
              –
            </span>
            {score.theirs}
          </div>

          {/* "v Gladesville Ravens", and which end of the ground, where the
              file says. An imported fixture often does not, and inventing it
              would print a home game as an away one. */}
          <div
            style={{
              display: 'flex',
              marginTop: height * 0.02,
              fontSize: 58,
              fontWeight: 600,
              lineHeight: 1.15,
            }}
          >
            {event.opponent ? `v ${event.opponent}` : event.title}
          </div>

          {/* Two lines, not one joined string. A venue like "ELS Hall Park,
              Field 3" wrapped mid-name when it shared a line with the date,
              leaving "3" stranded underneath. */}
          <div style={{ display: 'flex', marginTop: 18, fontSize: 40, opacity: 0.8 }}>
            {[when, score.was_home === true ? 'Home' : score.was_home === false ? 'Away' : null]
              .filter(Boolean)
              .join('  ·  ')}
          </div>
          {event.venue && (
            <div style={{ display: 'flex', marginTop: 6, fontSize: 40, opacity: 0.8 }}>
              {event.venue}
            </div>
          )}

          {/* A sentence the coach typed. Nothing is generated here: a card
              that invented "what a performance" would read as a club that
              did not write its own posts. */}
          {score.note && (
            <div
              style={{
                display: 'flex',
                marginTop: height * 0.035,
                fontSize: 44,
                opacity: 0.9,
                lineHeight: 1.3,
              }}
            >
              {score.note}
            </div>
          )}
        </div>
      </Frame>
    ),
    { width, height }
  )
}
