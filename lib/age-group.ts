/**
 * Age groups (0236/0239): juniors are U5–U18; U19–U23, Open and Over-NN are
 * adult groups, where players are their own members and join as themselves.
 */
export function isAdultAgeGroup(ageGroup: string | null | undefined): boolean {
  if (!ageGroup) return false
  if (/^(Open|Over-\d{2})$/.test(ageGroup)) return true
  const m = /^U(\d{1,2})$/.exec(ageGroup)
  return Boolean(m && Number(m[1]) >= 19)
}

/** Eighteen or over on the given day. */
export function isAdult(dob: string | Date, on: Date = new Date()): boolean {
  const d = typeof dob === 'string' ? new Date(dob + (dob.length === 10 ? 'T00:00:00' : '')) : dob
  const eighteen = new Date(d.getFullYear() + 18, d.getMonth(), d.getDate())
  return eighteen <= on
}

/** A date of birth that is in the past and under a hundred years ago. */
export function isPlausibleDob(dob: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return false
  const d = new Date(dob + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return false
  const now = new Date()
  const hundred = new Date(now.getFullYear() - 100, now.getMonth(), now.getDate())
  return d <= now && d > hundred
}

/**
 * MiniRoos (U5–U11): the small-sided years. A club game in these age groups
 * keeps no score and no ladder unless the club turns scores on (0251,
 * academies.miniroos_scores); the database applies the rule, this is for
 * the screens that decide what to offer.
 */
export function isMiniRoos(ageGroup: string | null | undefined): boolean {
  const m = (ageGroup ?? '').match(/^U(\d{1,2})$/)
  if (!m) return false
  const n = Number(m[1])
  return n >= 5 && n <= 11
}
