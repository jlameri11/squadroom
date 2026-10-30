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
  | 'duration'
  | 'opponent'
  | 'home_team'
  | 'away_team'
  | 'home_club'
  | 'away_club'
  | 'venue'
  | 'field'
  | 'round'
  | 'title'
  | 'bye'
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
  /**
   * Fragments that DISQUALIFY a column, however well it otherwise scores.
   *
   * Added because a real Dribl export titled every game "Pending": `title`
   * matched "match" inside "Matchsheet Status" and claimed it. That is the
   * second time this exact shape has bitten — CLAUDE.md already records
   * `title` stealing "Match Id" from `external_ref` — and a positive-only
   * scorer cannot express "a status column is never a name", which is the
   * thing that is actually true.
   */
  excludes?: string[]
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
    hint: 'Only if the file names the opposition directly',
    required: false,
    // 'away team' is gone from here. A real export has Home Team AND Away
    // Team, and which one is the OPPONENT depends on which side your club
    // is on — it was the away team in one row of a two-row file and the home
    // team in the other. Guessing meant importing a game against ourselves.
    matches: ['opponent', 'opposition', 'versus', 'against'],
    excludes: ['code', 'group', 'club'],
  },
  {
    key: 'home_team',
    label: 'Home team',
    hint: 'Used with the away team to work out who you played',
    required: false,
    matches: ['home team', 'home'],
    excludes: ['code', 'group', 'club', 'score'],
  },
  {
    key: 'away_team',
    label: 'Away team',
    hint: 'Used with the home team to work out who you played',
    required: false,
    matches: ['away team', 'away'],
    excludes: ['code', 'group', 'club', 'score'],
  },
  {
    key: 'home_club',
    label: 'Home club',
    hint: 'So the importer can tell which side is you',
    required: false,
    matches: ['home club name', 'home club'],
    excludes: ['code'],
  },
  {
    key: 'away_club',
    label: 'Away club',
    hint: 'So the importer can tell which side is you',
    required: false,
    matches: ['away club name', 'away club'],
    excludes: ['code'],
  },
  {
    key: 'bye',
    label: 'Bye',
    hint: 'Rows marked as a bye are not games and are left out',
    required: false,
    matches: ['bye'],
  },
  {
    key: 'venue',
    label: 'Ground',
    hint: 'The complex or park',
    required: false,
    // 'field' moved to its own entry: a real export has Ground
    // ("Blacktown Football Park") AND Field ("7v7 Field 3"), and folding
    // them together lost the field number — which is the half a parent
    // standing in a car park actually needs.
    matches: ['venue', 'ground', 'location', 'facility', 'complex'],
  },
  {
    key: 'field',
    label: 'Field',
    hint: 'Field or pitch number, if it is in its own column',
    required: false,
    matches: ['field', 'pitch', 'court'],
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
    hint: 'Only if the file has a finish TIME',
    required: false,
    matches: ['end time', 'finish time', 'finish', 'end'],
    excludes: ['duration'],
  },
  {
    key: 'duration',
    label: 'Length',
    hint: 'How long the game runs — "30 min", "50", "1:30"',
    required: false,
    // A real export gives Duration, not a finish time, so every game was
    // silently getting the 90-minute default. A U7 game is 30 minutes.
    matches: ['duration', 'minutes', 'mins', 'length', 'period'],
  },
  {
    key: 'title',
    label: 'Name',
    hint: 'Left blank, a name is built from the round and the opponent',
    required: false,
    // 'match' is gone. In a spreadsheet about matches it matches everything
    // and means nothing: a real export has "Matchsheet Status", "Match Id"
    // and "Match Date", and not one of them is a name.
    matches: ['title', 'name', 'description'],
    excludes: ['status', 'code', 'id', 'reference', 'type', 'group', 'club'],
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
      // A disqualified column is out however well it scores. Checked before
      // scoring, not after, so a 100-point exact match cannot sneak past.
      const h = header.trim().toLowerCase().replace(/[_-]+/g, ' ')
      if (field.excludes?.some((bad) => h.includes(bad))) continue

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
  // 0123. A club that already keeps sizes in a spreadsheet should not have to
  // retype them one child at a time to get a kit list — which is the only
  // other way they can arrive for a roster that predates the feature.
  {
    key: 'shirt_size',
    label: 'Shirt size',
    hint: 'Only recognised values are kept — 10, YM, L',
    required: false,
    matches: ['shirt size', 'shirt', 'top size', 'jersey size'],
    excludes: ['number', 'colour', 'color'],
  },
  {
    key: 'shorts_size',
    label: 'Shorts size',
    hint: '',
    required: false,
    matches: ['shorts size', 'shorts', 'short size'],
    excludes: ['number', 'colour', 'color'],
  },
  {
    key: 'socks_size',
    label: 'Socks size',
    hint: 'By shoe size — K13-3, 2-7',
    required: false,
    matches: ['socks size', 'socks', 'sock size'],
    excludes: ['number', 'colour', 'color'],
  },
]

/**
 * The sizes the database will accept, and nothing else.
 *
 * A spreadsheet column of sizes is somebody's own shorthand: "10", "Size 10",
 * "10Y", "med". The enum refuses all but the first, and an import that passed
 * them straight through would fail the whole row over a field nobody needs.
 * So an unrecognised size is DROPPED rather than guessed at or fatal — the
 * child still imports, with a blank where the size would be, and a blank is a
 * question a club can ask.
 *
 * Deliberately not a fuzzy mapper. "10Y" probably means 10, and "med"
 * probably means M, and a product that quietly decides either is a product
 * that orders the wrong shirt.
 */
export const SHIRT_SIZES = [
  '4', '6', '8', '10', '12', '14', '16',
  'YXS', 'YS', 'YM', 'YL',
  'S', 'M', 'L', 'XL', '2XL', '3XL',
] as const

export const SOCK_SIZES = ['K9-12', 'K13-3', '2-7', '7-11', '11-14'] as const

export function toKitSize(value: unknown): string | null {
  const v = String(value ?? '').trim().toUpperCase()
  return (SHIRT_SIZES as readonly string[]).includes(v) ? v : null
}

export function toSockSize(value: unknown): string | null {
  const v = String(value ?? '').trim().toUpperCase()
  return (SOCK_SIZES as readonly string[]).includes(v) ? v : null
}

/**
 * How long a game runs, from whatever the file calls it.
 *
 * A real Dribl export says "30 min". The importer used to look for a FINISH
 * TIME, found none, and silently gave every game the 90-minute default — so
 * a U7 game that runs half an hour sat in a parent's calendar for an hour
 * and a half, and the one after it looked like a clash.
 *
 * Returns minutes, or null when there is nothing usable. Null means "use the
 * default", which is a decision the database makes, not this function.
 */
export function toDurationMins(value: unknown): number | null {
  if (value == null || value === '') return null

  if (typeof value === 'number' && Number.isFinite(value)) {
    return sane(Math.round(value))
  }

  const text = String(value).trim().toLowerCase()

  // "1:30" and "0:45" — a duration written as a clock.
  const clock = text.match(/^(\d{1,2}):(\d{2})$/)
  if (clock) return sane(Number(clock[1]) * 60 + Number(clock[2]))

  // "1h 30", "1 hr 30m", "2 hours".
  const hours = text.match(/^(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b\s*(\d+)?/)
  if (hours) return sane(Math.round(Number(hours[1]) * 60) + Number(hours[2] ?? 0))

  // "30 min", "30mins", "30 minutes", "30".
  const mins = text.match(/^(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)?$/)
  if (mins) return sane(Math.round(Number(mins[1])))

  return null
}

/**
 * Bounds rather than a bare number, because a mis-read duration is worse
 * than none: it puts a wrong finish time in every family's calendar. Five
 * minutes is not a game and eight hours is not a game either — both mean
 * the column was misunderstood, and the default is the honest answer.
 */
function sane(mins: number): number | null {
  return mins >= 10 && mins <= 300 ? mins : null
}

export type Sides = {
  /** The team we played. Null when it cannot be worked out. */
  opponent: string | null
  /** True, false, or null for genuinely unknown — never a guess. */
  wasHome: boolean | null
  /** Both sides belong to the chosen club. */
  derby: boolean
  /** Neither side belongs to the chosen club. */
  foreign: boolean
}

/**
 * Which side of a fixture is us.
 *
 * A real export has Home Team and Away Team and no "opponent" column at all,
 * and which one is the opposition depends on which side your club is on — in
 * a two-row file it was the away team in one row and the home team in the
 * other. Mapping "opponent" straight to "Away Team" meant importing a game
 * against ourselves.
 *
 * It takes the club name the COACH CHOSE rather than matching the academy's
 * own name against the file. "NRIFA" in the app is "NRFA" in the export, and
 * a fuzzy match that got that right would get the next club wrong — this is
 * precisely the guess CLAUDE.md says not to make. One tap, exact after that.
 *
 * A derby is reported, not resolved. When both teams are yours there is no
 * fact in the file about which one this import is for, so `wasHome` stays
 * null and the screen says so.
 */
export function resolveSides(
  /**
   * The club OR team name the coach picked out of the file. Either works,
   * and a file that names clubs separately is not the only shape there is —
   * some exports have Home Team and Away Team and nothing else, and then the
   * team name is the only thing there is to pick.
   */
  ourSide: string | null,
  homeClub: string,
  awayClub: string,
  homeTeam: string,
  awayTeam: string
): Sides {
  const same = (a: string, b: string) =>
    a.trim().toLowerCase().replace(/\s+/g, ' ') === b.trim().toLowerCase().replace(/\s+/g, ' ')

  const home = homeTeam.trim()
  const away = awayTeam.trim()

  if (!ourSide || (!home && !away && !homeClub.trim() && !awayClub.trim())) {
    return { opponent: null, wasHome: null, derby: false, foreign: false }
  }

  // Club first, then team. Picking a CLUB in a file that also names teams is
  // what makes a derby a derby; picking a TEAM resolves one exactly, which
  // is why both are allowed rather than one being the "right" way.
  const weAreHome = same(homeClub, ourSide) || same(home, ourSide)
  const weAreAway = same(awayClub, ourSide) || same(away, ourSide)

  if (weAreHome && weAreAway) {
    return { opponent: null, wasHome: null, derby: true, foreign: false }
  }
  if (weAreHome) return { opponent: away || null, wasHome: true, derby: false, foreign: false }
  if (weAreAway) return { opponent: home || null, wasHome: false, derby: false, foreign: false }

  // Neither side is ours. A game between two other clubs that came along in
  // the export — reported rather than imported, because an event nobody at
  // this academy is playing in is noise in every family's calendar.
  return { opponent: null, wasHome: null, derby: false, foreign: true }
}

/**
 * R-18: the registrations export a club admin downloads from their own
 * PlayFootball account. Only ever a file handed to us — Squadroom never
 * logs in to PlayFootball and never scrapes it (CLAUDE.md). A name can
 * arrive whole or as first + last; either is enough with a date of birth,
 * and an FFA number or FIFA ID matches on its own.
 */
export const OFFICIAL_FIELDS: FieldSpec[] = [
  {
    key: 'ffa_number',
    label: 'FFA number',
    hint: 'Matches a player on its own',
    required: false,
    matches: ['ffa number', 'ffa no', 'ffa id', 'ffa', 'fa number', 'participant id'],
  },
  {
    key: 'fifa_id',
    label: 'FIFA ID',
    hint: 'The FIFA Connect ID',
    required: false,
    matches: ['fifa id', 'fifa connect', 'fifa'],
  },
  {
    key: 'full_name',
    label: 'Full name',
    hint: 'If the file has one name column',
    required: false,
    matches: ['full name', 'player name', 'participant name', 'name'],
    excludes: ['first', 'last', 'surname', 'given', 'club', 'team', 'program', 'parent', 'guardian'],
  },
  {
    key: 'first_name',
    label: 'First name',
    hint: 'If names are split',
    required: false,
    matches: ['first name', 'given name', 'first', 'given'],
    excludes: ['parent', 'guardian', 'contact'],
  },
  {
    key: 'last_name',
    label: 'Last name',
    hint: 'If names are split',
    required: false,
    matches: ['last name', 'surname', 'family name', 'last'],
    excludes: ['parent', 'guardian', 'contact'],
  },
  {
    key: 'dob',
    label: 'Date of birth',
    hint: 'Read day first',
    required: false,
    matches: ['date of birth', 'dob', 'birth date', 'birthday', 'born'],
  },
  {
    key: 'status',
    label: 'Registration status',
    hint: 'Active / pending / cancelled',
    required: false,
    matches: ['registration status', 'status', 'state'],
    excludes: ['payment', 'match'],
  },
]
