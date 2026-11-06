/**
 * When THIS PHONE saw the game kick off.
 *
 * The minute on a score tap is counted from kick-off. The database counts
 * from the kick-off row it holds — and a kick-off tapped with no signal only
 * reaches it when the signal does, so by the database's clock the game began
 * whenever the coach walked back into range, and every goal after that is
 * twenty minutes early. The phone that tapped the whistle knows when it blew.
 * Kept across a reload for the same reason; pruned after six hours.
 *
 * Once 0218 is applied a queued kick-off carries its own time, and the
 * database's row — which every other phone counts from — is right too; this
 * memory then only matters for the moments before the kick-off arrives.
 */
export const KICK_OFF_KEY = 'squadroom.live.kickoff'

const SIX_HOURS = 6 * 3600e3

function read(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(KICK_OFF_KEY) ?? '{}') as Record<string, number>
    const now = Date.now()
    return Object.fromEntries(Object.entries(raw).filter(([, at]) => typeof at === 'number' && now - at < SIX_HOURS))
  } catch {
    return {}
  }
}

function write(all: Record<string, number>) {
  try {
    if (Object.keys(all).length) localStorage.setItem(KICK_OFF_KEY, JSON.stringify(all))
    else localStorage.removeItem(KICK_OFF_KEY)
  } catch {
    // A private window remembers nothing; the database's kick-off stands in.
  }
}

export function rememberKickOff(eventId: string, at: number) {
  write({ ...read(), [eventId]: at })
}

export function forgetKickOff(eventId: string) {
  const all = read()
  delete all[eventId]
  write(all)
}

export function phoneKickOff(eventId: string): number | null {
  return read()[eventId] ?? null
}
