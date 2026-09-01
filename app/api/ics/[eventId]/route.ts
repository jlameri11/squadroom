import { createClient } from '@/lib/supabase/server'

/**
 * One event as an .ics file.
 *
 * Read through the user's own client, so the same RLS that governs the event
 * screen governs the download - a URL guessed by someone outside the team
 * returns nothing, rather than a calendar file describing where a group of
 * children will be on Saturday morning.
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ eventId: string }> }
) {
  const { eventId } = await ctx.params
  const supabase = await createClient()

  const { data: event } = await supabase
    .from('events')
    .select('id, title, starts_at, ends_at, arrive_at, venue, address, opponent, kit_colour, notes, cancelled_at, updated_at, academies(timezone)')
    .eq('id', eventId)
    .maybeSingle()

  if (!event) {
    return new Response('Not found', { status: 404 })
  }

  // The academy's timezone, not the server's. DTSTART is UTC because that is
  // what the format wants, but "arrive 9:23am" is read by a human standing in
  // Sydney, and rendering it in UTC told them 11:23pm.
  const tz =
    (Array.isArray(event.academies) ? event.academies[0] : event.academies)?.timezone ??
    'Australia/Sydney'

  const start = new Date(event.starts_at)
  const end = event.ends_at ? new Date(event.ends_at) : new Date(start.getTime() + 3600_000)

  const description = [
    event.opponent ? `Against ${event.opponent}` : null,
    event.arrive_at
      ? `Arrive ${new Date(event.arrive_at).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: tz })}`
      : null,
    event.kit_colour ? `Kit: ${event.kit_colour}` : null,
    event.notes,
  ].filter(Boolean).join('\n')

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Squadroom//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.id}@squadroom.app`,
    `DTSTAMP:${ical(new Date(event.updated_at ?? Date.now()))}`,
    `DTSTART:${ical(start)}`,
    `DTEND:${ical(end)}`,
    `SUMMARY:${escape(event.title)}`,
    event.venue ? `LOCATION:${escape([event.venue, event.address].filter(Boolean).join(', '))}` : null,
    description ? `DESCRIPTION:${escape(description)}` : null,
    // A cancelled fixture still downloads, marked cancelled, so a calendar
    // that already has it can strike it out rather than leaving it there.
    event.cancelled_at ? 'STATUS:CANCELLED' : 'STATUS:CONFIRMED',
    // The reminder people actually want from their own phone, independent of
    // whether they ever allowed push notifications.
    'BEGIN:VALARM',
    'TRIGGER:-PT2H',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escape(event.title)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n')

  return new Response(fold(ics), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${slug(event.title)}.ics"`,
      'Cache-Control': 'no-store',
    },
  })
}

/**
 * RFC 5545 caps a line at 75 octets and folds the rest onto continuation
 * lines starting with a space. Long venue names and notes go past that, and
 * some clients simply drop an over-long line rather than complaining.
 */
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

/** UTC basic format, which is what every calendar client agrees on. */
function ical(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/** RFC 5545 escaping: commas, semicolons and backslashes are structural. */
function escape(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'event'
}
