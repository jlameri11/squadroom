import { createAdminClient } from '@/lib/supabase/admin'

/**
 * A subscribable calendar of one person's fixtures.
 *
 * Fetched by Apple Calendar or Google every few hours with no session at all,
 * so the token in the URL is the only credential. It is checked inside the
 * database function, which returns nothing for an unknown token — this route
 * cannot be talked into returning somebody else's season.
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params

  // Not a 404: a calendar app that gets an error every few hours will
  // eventually stop asking, and an empty calendar is the honest answer for a
  // token that has been rotated away.
  if (!/^[a-f0-9]{48}$/.test(token)) {
    return empty()
  }

  const admin = createAdminClient()
  const { data: events, error } = await admin.rpc('calendar_feed_events', { p_token: token })

  // An empty calendar and a broken one look identical to a phone, so a real
  // failure must not be dressed up as "no games". This swallowed a runtime
  // error for a whole build.
  if (error) {
    console.error('calendar feed failed', error)
    return new Response('Calendar unavailable', { status: 500 })
  }

  if (!events || events.length === 0) return empty()

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Squadroom//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Squadroom',
    // Ask the client not to hammer us. Most honour it; none are obliged to.
    'X-PUBLISHED-TTL:PT1H',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
  ]

  for (const e of events) {
    const start = new Date(e.starts_at)
    const end = e.ends_at ? new Date(e.ends_at) : new Date(start.getTime() + 3600_000)
    const tz = e.timezone ?? 'Australia/Sydney'

    const description = [
      e.opponent ? `Against ${e.opponent}` : null,
      e.arrive_at
        ? `Arrive ${new Date(e.arrive_at).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: tz })}`
        : null,
      e.kit_colour ? `Kit: ${e.kit_colour}` : null,
    ].filter(Boolean).join('\n')

    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.event_id}@squadroom.app`,
      `DTSTAMP:${ical(new Date(e.updated_at ?? Date.now()))}`,
      `DTSTART:${ical(start)}`,
      `DTEND:${ical(end)}`,
      `SUMMARY:${esc(e.title)}`,
      ...(e.venue ? [`LOCATION:${esc([e.venue, e.address].filter(Boolean).join(', '))}`] : []),
      ...(description ? [`DESCRIPTION:${esc(description)}`] : []),
      // A cancelled fixture stays in the feed, marked cancelled, so a calendar
      // that already has it strikes it out instead of quietly keeping it.
      e.cancelled_at ? 'STATUS:CANCELLED' : 'STATUS:CONFIRMED',
      'BEGIN:VALARM',
      'TRIGGER:-PT2H',
      'ACTION:DISPLAY',
      `DESCRIPTION:${esc(e.title)}`,
      'END:VALARM',
      'END:VEVENT'
    )
  }

  lines.push('END:VCALENDAR')
  return calendar(fold(lines.join('\r\n')))
}

function empty() {
  return calendar(
    ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Squadroom//EN', 'END:VCALENDAR'].join('\r\n')
  )
}

function calendar(body: string) {
  return new Response(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': 'private, max-age=900',
    },
  })
}

function ical(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function esc(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

/** RFC 5545 folds at 75 octets; some clients drop a longer line silently. */
function fold(text: string): string {
  return text
    .split('\r\n')
    .map((line) => {
      if (Buffer.byteLength(line, 'utf8') <= 75) return line
      const out: string[] = []
      let current = ''
      for (const char of line) {
        if (Buffer.byteLength(current + char, 'utf8') > (out.length === 0 ? 75 : 74)) {
          out.push(current)
          current = char
        } else {
          current += char
        }
      }
      out.push(current)
      return out.join('\r\n ')
    })
    .join('\r\n')
}
