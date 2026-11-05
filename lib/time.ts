/**
 * A game's time, in the game's place (Joey, 4 Nov 2026: "times always shown
 * in the venue's timezone").
 *
 * Every format here names its timezone. `toLocaleTimeString()` without one
 * uses whatever clock the code happens to run on — and the server that
 * renders the first frame runs on UTC, so a 2:20 pm kick-off in Sydney was
 * written into the page as 3:20 am, and a phone set to another timezone (a
 * parent on holiday, a grandparent in Perth) moved every game. The place's
 * timezone is the club's (`academies.timezone`); venues sit where their club
 * is, and a venue in another timezone would need its own column.
 *
 * No imports, so a test can load this file directly.
 */
export const DEFAULT_TZ = 'Australia/Sydney'

const fmt = (iso: string | Date, tz: string | null | undefined, o: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-AU', { ...o, timeZone: tz || DEFAULT_TZ }).format(typeof iso === 'string' ? new Date(iso) : iso)

/** "2:20 pm" */
export function kickOff(iso: string | Date, tz?: string | null): string {
  return fmt(iso, tz, { hour: 'numeric', minute: '2-digit' }).replace(/\s?([ap])\.?m\.?$/i, (_, x) => ` ${x.toLowerCase()}m`)
}

/** "Saturday 15 November" */
export function gameDay(iso: string | Date, tz?: string | null): string {
  return fmt(iso, tz, { weekday: 'long', day: 'numeric', month: 'long' })
}

/** "Sat 15 Nov" */
export function gameDayShort(iso: string | Date, tz?: string | null): string {
  return fmt(iso, tz, { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '')
}

/** The calendar date in that place, "2026-11-15", for comparing days. */
export function placeDate(iso: string | Date, tz?: string | null): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz || DEFAULT_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(typeof iso === 'string' ? new Date(iso) : iso)
  return parts
}

/**
 * How far off a game is, the way a parent says it: "in 3 days",
 * "tomorrow", "today". Days are counted in the game's place, so a game at
 * 9 am Saturday is "tomorrow" all of Friday there, whatever the phone says.
 */
export function countdown(iso: string | Date, now: Date = new Date(), tz?: string | null): string {
  const day = (d: Date | string) => {
    const [y, m, dd] = placeDate(d, tz).split('-').map(Number)
    return Date.UTC(y, m - 1, dd) / 864e5
  }
  const days = Math.round(day(iso) - day(now))
  if (days <= 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days < 14) return `in ${days} days`
  const weeks = Math.round(days / 7)
  return `in ${weeks} weeks`
}
