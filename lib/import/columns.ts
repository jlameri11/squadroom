/**
 * Guessing which spreadsheet column is the kick-off time, and then asking.
 *
 * CLAUDE.md is explicit that a Dribl column mapping must never be guessed,
 * because a wrong mapping produces an importer that silently drops or
 * mangles games. This does not break that rule — it SUGGESTS, and the
 * interface makes a human confirm every field before anything is written.
 * The distinction is the whole design: a suggestion someone approved is not
 * a guess, and it survives Dribl renaming a column next season.
 */

export type FieldKey =
  | 'local_date'
  | 'local_time'
  | 'end_time'
  | 'opponent'
  | 'venue'
  | 'round'
  | 'title'
  | 'external_ref'

export type FieldSpec = {
  /**
   * Widened from the fixture-only union so the same mapper can serve a second
   * field set. The scoring, the global strongest-claim-wins rule and the
   * "leave it blank rather than guess weakly" behaviour are all identical for
   * players — only the list of fields differs, and duplicating the mapper to
   * change a list is how the two drift apart.
   */
  key: string
  label: string
  hint: string
  required: boolean
  /** Lowercase fragments that suggest this column, best first. */
  matches: string[]
}

export const FIELDS: FieldSpec[] = [
  {
    key: 'local_date',
    label: 'Date',
    hint: 'The day of the game',
    required: true,
    matches: ['match date', 'fixture date', 'date', 'day'],
  },
  {
    key: 'local_time',
    label: 'Kick-off',
    hint: 'Start time as it appears in the file',
    required: true,
    matches: ['kick off', 'kick-off', 'kickoff', 'start time', 'time', 'start'],
  },
  {
    key: 'opponent',
    label: 'Opponent',
    hint: 'The other team',
    required: false,
    matches: ['opponent', 'away team', 'versus', 'vs', 'against', 'opposition'],
  },
  {
    key: 'venue',
    label: 'Ground',
    hint: 'Where it is played, and the field number if there is one',
    required: false,
    matches: ['venue', 'ground', 'field', 'pitch', 'location', 'facility'],
  },
  {
    key: 'round',
    label: 'Round',
    hint: 'Round 14, Semi Final, and so on',
    required: false,
    matches: ['round', 'match round', 'stage', 'week'],
  },
  {
    key: 'end_time',
    label: 'Finish',
    hint: 'Only if the file has one',
    required: false,
    matches: ['end time', 'finish', 'end'],
  },
  {
    key: 'title',
    label: 'Name',
    hint: 'Left blank, a name is built from the round and the opponent',
    required: false,
    matches: ['title', 'name', 'description', 'match'],
  },
  {
    key: 'external_ref',
    label: 'Reference',
    hint: 'A fixture id, if the file has one. This is what lets a re-import update rather than duplicate.',
    required: false,
    matches: ['match id', 'fixture id', 'id', 'reference', 'ref', 'uuid'],
  },
]

/**
 * Score a header against a field. Exact beats prefix beats contains, so a
 * column literally called "Date" wins over "Date Created".
 */
function score(header: string, fragment: string): number {
  const h = header.trim().toLowerCase().replace(/[_-]+/g, ' ')
  if (h === fragment) return 100
  if (h.startsWith(fragment)) return 60
  if (h.includes(fragment)) return 30
  return 0
}

/**
 * A first pass at the mapping.
 *
 * Every (field, column) pair is scored and the strongest claim wins, globally
 * — not field by field in list order. That distinction is not academic: the
 * first version walked FIELDS in order, so `title` (which matches "match")
 * claimed a column called "Match Id" on a 60-point prefix before
 * `external_ref` could claim it on a 100-point exact match. The reference
 * column is what stops a re-import duplicating a season, so losing it to a
 * weaker guess mattered.
 *
 * Anything unconvincing is left blank for a person to fill in rather than
 * assigned on a weak match.
 */
export function suggestMapping(
  headers: string[],
  fields: FieldSpec[] = FIELDS
): Partial<Record<string, string>> {
  type Claim = { field: string; header: string; score: number }
  const claims: Claim[] = []

  for (const field of fields) {
    for (const header of headers) {
      for (let i = 0; i < field.matches.length; i++) {
        // Earlier fragments are stronger signals, so later ones are damped.
        const s = score(header, field.matches[i]) - i
        if (s >= 30) claims.push({ field: field.key, header, score: s })
      }
    }
  }

  // Strongest first. Ties fall back to the field set's own order so the
  // result is stable rather than depending on how the object happened to be
  // built.
  const order = new Map(fields.map((f, i) => [f.key as string, i]))
  claims.sort((a, b) => b.score - a.score || order.get(a.field)! - order.get(b.field)!)

  const mapping: Partial<Record<string, string>> = {}
  const takenHeaders = new Set<string>()

  for (const claim of claims) {
    if (mapping[claim.field] || takenHeaders.has(claim.header)) continue
    mapping[claim.field] = claim.header
    takenHeaders.add(claim.header)
  }

  return mapping
}

/**
 * Spreadsheet dates are the whole problem.
 *
 * A cell can arrive as a JS Date (already shifted into the reader's own
 * timezone by the parser), an Excel serial number, or text in any of a dozen
 * formats. Australian files are d/m/y and American ones are m/d/y and they
 * are indistinguishable for the first twelve days of every month — so an
 * ambiguous value is treated as DAY first, because this is a product for
 * Australian junior football, and the preview shows the reading so a human
 * can catch it.
 */
export function toLocalDate(value: unknown): string | null {
  if (value == null || value === '') return null

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    // Read back the calendar date the parser produced, in local terms. Using
    // toISOString here would apply a UTC shift and move Saturday games to
    // Friday for anyone east of Greenwich.
    const y = value.getFullYear()
    const m = String(value.getMonth() + 1).padStart(2, '0')
    const d = String(value.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }

  const text = String(value).trim()

  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`

  const slash = text.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})/)
  if (slash) {
    const day = Number(slash[1])
    const month = Number(slash[2])
    // 13/05 can only be day-first; anything else is assumed day-first too.
    if (day > 12 && month > 12) return null
    const year = slash[3].length === 2 ? 2000 + Number(slash[3]) : Number(slash[3])
    if (month > 12) return null
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  // "Sat 5 Sep 2026" and friends.
  const parsed = new Date(text)
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getFullYear()
    const m = String(parsed.getMonth() + 1).padStart(2, '0')
    const d = String(parsed.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }

  return null
}

/** Returns 24-hour HH:MM, or null rather than a guess. */
export function toLocalTime(value: unknown): string | null {
  if (value == null || value === '') return null

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`
  }

  // Excel stores a bare time as a fraction of a day.
  if (typeof value === 'number' && value >= 0 && value < 1) {
    const minutes = Math.round(value * 24 * 60)
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
  }

  const text = String(value).trim().toLowerCase()
  const m = text.match(/^(\d{1,2})[:.](\d{2})\s*(am|pm)?/) ?? text.match(/^(\d{1,2})\s*(am|pm)/)
  if (!m) return null

  let hour = Number(m[1])
  const minute = m[2] && /^\d+$/.test(m[2]) ? Number(m[2]) : 0
  const meridiem = m[3] ?? (m[2] && !/^\d+$/.test(m[2]) ? m[2] : null)

  if (meridiem === 'pm' && hour < 12) hour += 12
  if (meridiem === 'am' && hour === 12) hour = 0
  if (hour > 23 || minute > 59) return null

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/**
 * Importing a ROSTER, which is how a club actually arrives.
 *
 * A club onboarding has two hundred players in a spreadsheet somebody already
 * maintains, and typing them in is the single biggest reason a club gives up
 * halfway through setup. Same suggest-then-confirm rule as the fixtures: this
 * proposes a mapping and a human approves it before a row is written.
 *
 * GUARDIANS ARE DELIBERATELY NOT IMPORTED. A spreadsheet column of parent
 * phone numbers is exactly the bulk contact upload CLAUDE.md forbids — "a
 * coach's phone holds people with no relationship to the academy, and putting
 * them on our servers is a Privacy Act problem". Parents arrive through a
 * join code and a coach's approval, which is the identity gate for this whole
 * product. The roster is the children; the families let themselves in.
 */
export const PLAYER_FIELDS: FieldSpec[] = [
  {
    key: 'full_name',
    label: 'Name',
    hint: "The child's name as registered",
    required: true,
    matches: ['player name', 'full name', 'name', 'player'],
  },
  {
    key: 'dob',
    label: 'Date of birth',
    hint: 'Read day first, like the fixtures',
    required: true,
    matches: ['date of birth', 'dob', 'birth date', 'birthdate', 'born'],
  },
  {
    key: 'gender',
    label: 'Gender',
    hint: 'Used for duplicate detection and competition eligibility',
    required: false,
    matches: ['gender', 'sex'],
  },
  {
    key: 'preferred_name',
    label: 'Goes by',
    hint: 'What the child is actually called',
    required: false,
    matches: ['preferred name', 'preferred', 'nickname', 'known as'],
  },
  {
    key: 'ff_number',
    label: 'FFA number',
    hint: 'Their Football Australia / PlayFootball number',
    required: false,
    matches: ['ffa number', 'ff number', 'fa number', 'playfootball', 'ffa id', 'registration number'],
  },
  {
    key: 'squad_number',
    label: 'Shirt number',
    hint: 'One pool per season across the club',
    required: false,
    matches: ['shirt number', 'squad number', 'jersey', 'number'],
  },
  {
    key: 'school',
    label: 'School',
    hint: '',
    required: false,
    matches: ['school'],
  },
]
