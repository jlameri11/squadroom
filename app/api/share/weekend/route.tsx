import { ImageResponse } from 'next/og'
import { NextResponse } from 'next/server'
import { createClient, getUserId } from '@/lib/supabase/server'
import { Eyebrow, Frame, inkOn, safeColour, sizeOf } from '@/lib/share/card'

/**
 * This weekend's games, as one picture.
 *
 * X-04, and the half a club will use most. A result card goes out once a
 * week per squad; this goes out once and covers the club, which is what a
 * Friday post actually is.
 *
 * NO CHILD IS NAMED, which is not an oversight to be fixed later. R-16 exists
 * because other products published children, and a graphic is the most
 * shareable thing this product makes — once it is in a WhatsApp group it is
 * beyond anyone's recall. Squads, kick-off times, opponents and grounds.
 *
 * It reads `fixtures_screen`, which is the same function the Fixtures tab
 * uses, so what the card shows is what the club sees. A second query here
 * would eventually disagree with the screen, and the first anybody would
 * know is a parent at the wrong ground.
 */
export async function GET(request: Request) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const url = new URL(request.url)
  const supabase = await createClient()

  const { data: screen } = await supabase.rpc('fixtures_screen', {
    p_days: 14,
    p_academy: (url.searchParams.get('academy') ?? null) as unknown as string,
  })

  const data = screen as unknown as {
    academy: { name: string; slug: string } | null
    events: {
      id: string
      title: string
      type: string
      starts_at: string
      venue: string | null
      opponent: string | null
      team_name: string | null
      cancelled_at: string | null
    }[]
  } | null

  if (!data?.academy) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // The coming Saturday and Sunday. Not "the next 7 days": a club posting on
  // a Friday means THIS weekend, and a list that quietly included next
  // Tuesday's training would be a list nobody trusts.
  const now = new Date()
  const day = now.getDay()
  // Sunday is 0. From Monday, the coming weekend; on a Saturday or Sunday,
  // this one.
  const toSaturday = day === 6 ? 0 : day === 0 ? -1 : 6 - day
  const saturday = new Date(now)
  saturday.setDate(now.getDate() + toSaturday)
  saturday.setHours(0, 0, 0, 0)
  const monday = new Date(saturday)
  monday.setDate(saturday.getDate() + 2)

  const allWeekend = (data.events ?? [])
    .filter((e) => !e.cancelled_at)
    .filter((e) => e.type === 'match' || e.type === 'tournament')
    .filter((e) => {
      const t = new Date(e.starts_at)
      return t >= saturday && t < monday
    })

  // Six is what fits legibly once each game carries a day heading, an
  // opponent and a ground on their own lines. A club with more squads gets
  // the earliest six and a line saying so, which beats nine lines of
  // unreadable type.
  const FITS = 6
  const moreThanFits = Math.max(allWeekend.length - FITS, 0)
  const games = allWeekend.slice(0, FITS)


  const { data: academyRow } = await supabase
    .from('academies')
    .select('primary_colour')
    .eq('slug', data.academy.slug)
    .maybeSingle()

  const { width, height } = sizeOf(url.searchParams.get('size'))
  const brand = safeColour(academyRow?.primary_colour)
  const ink = inkOn(brand)

  // A range, not the Saturday. The card covers two days and the first
  // version headed it "31 October" above a Sunday fixture on the 1st, which
  // is a date that contradicts the list underneath it. The month is repeated
  // only when the weekend crosses one.
  const sunday = new Date(saturday)
  sunday.setDate(saturday.getDate() + 1)
  const crossesMonth = saturday.getMonth() !== sunday.getMonth()
  const dayLabel = crossesMonth
    ? `${saturday.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })} – ${sunday.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}`
    : `${saturday.getDate()} – ${sunday.toLocaleDateString('en-AU', { day: 'numeric', month: 'long' })}`

  return new ImageResponse(
    (
      <Frame brand={brand} width={width} height={height} footer={data.academy.name}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <Eyebrow ink={ink}>This weekend</Eyebrow>
          <div
            style={{
              display: 'flex',
              marginTop: 12,
              fontSize: 64,
              fontWeight: 700,
              letterSpacing: -1,
            }}
          >
            {dayLabel}
          </div>

          {games.length === 0 ? (
            <div style={{ display: 'flex', marginTop: 60, fontSize: 48, opacity: 0.8 }}>
              No games this weekend.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', marginTop: 44 }}>
              {/*
                GROUPED BY DAY, which the first version was not — and a
                weekend card is two days. It listed "10:00 am U10" under a
                heading that said only "31 October", so a parent could not
                tell Saturday's game from Sunday's. The sort was right and
                the card was silent about the thing that mattered.
              */}
              {['Saturday', 'Sunday'].map((label, dayIndex) => {
                const ofDay = games.filter(
                  (g) => new Date(g.starts_at).getDay() === (dayIndex === 0 ? 6 : 0)
                )
                if (ofDay.length === 0) return null
                return (
                  <div
                    key={label}
                    style={{ display: 'flex', flexDirection: 'column', marginBottom: 30 }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        fontSize: 34,
                        letterSpacing: 4,
                        textTransform: 'uppercase',
                        opacity: 0.6,
                        marginBottom: 16,
                      }}
                    >
                      {label}
                    </div>

                    {ofDay.map((g) => (
                      <div
                        key={g.id}
                        style={{ display: 'flex', flexDirection: 'column', marginBottom: 26 }}
                      >
                        <div style={{ display: 'flex', alignItems: 'baseline' }}>
                          {/* Wide enough for "10:30 am" with room after it.
                              At 200 the time ran straight into the squad
                              name, and "10:00 am" wrapped onto two lines. */}
                          <div
                            style={{
                              display: 'flex',
                              width: 270,
                              flexShrink: 0,
                              fontSize: 44,
                              fontWeight: 700,
                            }}
                          >
                            {new Date(g.starts_at).toLocaleTimeString('en-AU', {
                              hour: 'numeric',
                              minute: '2-digit',
                            })}
                          </div>
                          <div style={{ display: 'flex', fontSize: 44, fontWeight: 600 }}>
                            {g.team_name ?? 'Squad'}
                          </div>
                        </div>

                        {/* The opponent and the ground on separate lines.
                            Joined, a long ground name wrapped and left a
                            word stranded under the time column. */}
                        {g.opponent && (
                          <div
                            style={{
                              display: 'flex',
                              marginLeft: 270,
                              marginTop: 2,
                              fontSize: 34,
                              opacity: 0.85,
                            }}
                          >
                            v {g.opponent}
                          </div>
                        )}
                        {g.venue && (
                          <div
                            style={{
                              display: 'flex',
                              marginLeft: 270,
                              fontSize: 34,
                              opacity: 0.7,
                            }}
                          >
                            {g.venue}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )
              })}

              {moreThanFits > 0 && (
                <div style={{ display: 'flex', fontSize: 32, opacity: 0.7 }}>
                  …and {moreThanFits} more. Full list in the app.
                </div>
              )}
            </div>
          )}
        </div>
      </Frame>
    ),
    { width, height }
  )
}
