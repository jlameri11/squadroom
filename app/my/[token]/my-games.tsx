'use client'

export type FeedEvent = {
  event_id: string
  title: string
  starts_at: string
  ends_at: string | null
  arrive_at: string | null
  venue: string | null
  address: string | null
  opponent: string | null
  kit_colour: string | null
  cancelled_at: string | null
  timezone: string
}

/**
 * What a kid sees.
 *
 * The next game is the whole point of opening this, so it is the whole top of
 * the screen: the day, the time, what to wear and when to be there. Everything
 * after it is a list.
 *
 * Written for someone standing up, on a phone, who wants one fact. No
 * navigation, no account, nothing to tap that asks them to sign in.
 */
export function MyGames({ events }: { events: FeedEvent[] }) {
  const now = Date.now()
  // calendar_feed_events orders by id, not by time — it uses DISTINCT ON to
  // dedupe, and that fixes the ordering. Taking its first row gave whichever
  // game happened to have the lowest id, which is not "next".
  const upcoming = events
    .filter((e) => new Date(e.starts_at).getTime() > now - 3 * 3600e3)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  const next = upcoming[0]
  const rest = upcoming.slice(1, 12)
  // Every time on this page is the CLUB's time. The page renders on a server
  // in Ohio, so formatting with the machine's own clock turns a 9am Sydney
  // kick-off into something else entirely.
  const tz = next?.timezone ?? events[0]?.timezone ?? 'Australia/Sydney'

  return (
    <main className="mx-auto w-full max-w-md pb-10">
      <header
        className="px-5 pb-5 pt-6"
        style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
      >
        <p className="eyebrow" style={{ color: '#ffffffaa' }}>
          Your games
        </p>

        {next ? (
          <>
            <p className="display mt-1 text-[34px] leading-none">{whenBig(next.starts_at, tz)}</p>
            <p className="display mt-1 text-[22px] leading-tight opacity-95">{next.title}</p>

            <div className="mt-3 flex flex-wrap gap-2">
              {next.cancelled_at ? (
                <Chip tone="off">Called off</Chip>
              ) : (
                <>
                  {next.arrive_at && <Chip>Be there {clock(next.arrive_at, tz)}</Chip>}
                  {next.kit_colour && <Chip>Wear {next.kit_colour.toLowerCase()}</Chip>}
                </>
              )}
            </div>

            {next.venue && (
              <p className="mt-3 text-sm opacity-90">
                {next.venue}
                {/*
                  A ground name is useless to a kid being driven somewhere new.
                  Maps opens in whatever app they already have.
                */}
                {' · '}
                <a
                  className="underline underline-offset-2"
                  href={`https://maps.google.com/?q=${encodeURIComponent(next.address || next.venue)}`}
                >
                  Map
                </a>
              </p>
            )}
          </>
        ) : (
          <p className="display mt-1 text-[26px] leading-tight">No games coming up</p>
        )}
      </header>

      {rest.length > 0 && (
        <section className="p-3.5">
          <h2 className="eyebrow px-1 pb-2">After that</h2>
          <div className="card overflow-hidden">
            {rest.map((e) => {
              const off = Boolean(e.cancelled_at)
              return (
                <div key={e.event_id} className={`row ${off ? 'opacity-55' : ''}`}>
                  <span className="datechip">
                    <span className="d block">
                      {new Date(e.starts_at).toLocaleDateString('en-AU', { day: 'numeric', timeZone: tz })}
                    </span>
                    <span className="m block">
                      {new Date(e.starts_at).toLocaleDateString('en-AU', { weekday: 'short', timeZone: tz })}
                    </span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate font-medium">{e.title}</span>
                      {off && (
                        <span
                          className="tag flex-none"
                          style={{ background: 'var(--no-bg)', color: 'var(--no)' }}
                        >
                          Off
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-sm text-ink-3">
                      {[clock(e.starts_at, tz), e.venue].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </div>
              )
            })}
          </div>
        </section>
      )}

      <p className="px-5 pt-4 text-center text-xs text-ink-3">
        This page updates on its own. Keep the link — it&apos;s just for you.
      </p>
    </main>
  )
}

function Chip({ children, tone }: { children: React.ReactNode; tone?: 'off' }) {
  return (
    <span
      className="rounded-lg px-2.5 py-1 text-sm font-semibold"
      style={
        tone === 'off'
          ? { background: '#ffffff26', color: '#fff' }
          : { background: '#ffffff26', color: '#fff' }
      }
    >
      {children}
    </span>
  )
}

/**
 * "Saturday 9:00am", or "Today" / "Tomorrow" when that is what it is.
 *
 * Everything here is computed in the CLUB's timezone, not the machine's.
 * This page renders on a server in Ohio; "is it today?" answered against a
 * UTC clock is wrong for most of every Australian evening.
 */
function whenBig(iso: string, tz: string) {
  const time = clock(iso, tz)
  const day = dayKey(iso, tz)

  if (day === dayKey(new Date().toISOString(), tz)) return `Today ${time}`
  if (day === dayKey(new Date(Date.now() + 864e5).toISOString(), tz)) return `Tomorrow ${time}`

  return `${new Date(iso).toLocaleDateString('en-AU', { weekday: 'long', timeZone: tz })} ${time}`
}

/** The calendar date in a given zone, for comparing one day to another. */
function dayKey(iso: string, tz: string) {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: tz })
}

function clock(iso: string, tz: string) {
  return new Date(iso)
    .toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: tz })
    .replace(' ', '')
    .toLowerCase()
}
