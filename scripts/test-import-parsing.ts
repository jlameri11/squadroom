import {
  suggestMapping,
  toLocalDate,
  toLocalTime,
  toDurationMins,
  resolveSides,
  FIELDS,
} from '../lib/import/columns.ts'

const ok = (m: string) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m: string) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }
const head = (m: string) => console.log(`\n${m}`)
const eq = (got: unknown, want: unknown, label: string) =>
  got === want ? ok(`${label} → ${got}`) : bad(`${label} → got ${got}, wanted ${want}`)

head('1. Column names as league secretaries write them')
const dribl = suggestMapping([
  'Match Id', 'Match Date', 'Kick Off', 'Home Team', 'Away Team', 'Venue', 'Match Round', 'Status',
])
eq(dribl.local_date, 'Match Date', 'date')
eq(dribl.local_time, 'Kick Off', 'kick-off')
eq(dribl.venue, 'Venue', 'venue')
eq(dribl.round, 'Match Round', 'round')
eq(dribl.external_ref, 'Match Id', 'reference')
// This used to assert `opponent → Away Team`, and a real export proved it
// wrong: our club was the AWAY team in one row and the HOME team in the
// next, so mapping the opponent to the away team imported a game against
// ourselves. Home and away are mapped; which one is the opposition is
// worked out per row from the club the coach picked.
eq(dribl.home_team, 'Home Team', 'home team')
eq(dribl.away_team, 'Away Team', 'away team')
eq(dribl.opponent, undefined, 'opponent is NOT guessed from away team')

head('2. "Date" beats "Date Created" — exact match wins over contains')
const tricky = suggestMapping(['Date Created', 'Date', 'Time', 'Opposition', 'Ground'])
eq(tricky.local_date, 'Date', 'date')
eq(tricky.local_time, 'Time', 'time')
eq(tricky.opponent, 'Opposition', 'opponent')
eq(tricky.venue, 'Ground', 'ground')

head('3. A column is claimed once, never by two fields')
const m = suggestMapping(['Date', 'Time', 'Venue'])
const used = Object.values(m).filter(Boolean)
used.length === new Set(used).size ? ok('no column mapped twice') : bad(`duplicates: ${used}`)

head('4. Nothing convincing is left blank rather than assigned')
const junk = suggestMapping(['Column A', 'Column B', 'Notes'])
!junk.local_date && !junk.local_time
  ? ok('unrecognisable headers produce no mapping, so the coach must choose')
  : bad(`invented a mapping: ${JSON.stringify(junk)}`)

head('5. Dates are read DAY first — this is Australian junior football')
eq(toLocalDate('05/09/2026'), '2026-09-05', '05/09/2026')
eq(toLocalDate('5/9/26'), '2026-09-05', '5/9/26')
eq(toLocalDate('13/05/2026'), '2026-05-13', '13/05/2026 (only day-first is possible)')
eq(toLocalDate('2026-09-05'), '2026-09-05', 'ISO')
eq(toLocalDate('Sat 5 Sep 2026'), '2026-09-05', 'Sat 5 Sep 2026')

head('6. A Date object keeps its calendar day')
// The classic bug: toISOString() on a local midnight shifts a Sydney
// Saturday back to Friday. This reads the local calendar fields instead.
const localMidnight = new Date(2026, 8, 5, 0, 0, 0)
eq(toLocalDate(localMidnight), '2026-09-05', 'local midnight 5 Sep')

head('7. Times, in the formats spreadsheets produce')
eq(toLocalTime('9:00'), '09:00', '9:00')
eq(toLocalTime('9:00 AM'), '09:00', '9:00 AM')
eq(toLocalTime('7:30 pm'), '19:30', '7:30 pm')
eq(toLocalTime('12:15 AM'), '00:15', '12:15 AM')
eq(toLocalTime('12:00 PM'), '12:00', 'noon')
eq(toLocalTime('19:30'), '19:30', '24-hour')
eq(toLocalTime(0.375), '09:00', 'Excel serial 0.375')
eq(toLocalTime('kick off tbc'), null, 'unreadable → null, never a guess')
eq(toLocalTime('25:99'), null, 'impossible time → null')

head('8. Every field has a hint, because a bare label is not an instruction')
FIELDS.every((f) => f.hint.length > 0 && f.label.length > 0)
  ? ok(`${FIELDS.length} fields, all explained`)
  : bad('a field has no hint')



head('9. The headers a real Dribl export actually has')
// Taken from an SPL Season 3 2026 export. The VALUES below are invented —
// only the column names are real, because the shape is the thing that broke
// and nobody's draw belongs in a test fixture.
const real = suggestMapping([
  'Identifier', 'Event Status', 'Matchsheet Status', 'Competition', 'Round', 'Date', 'Day',
  'Start', 'Duration', 'Ground', 'Field', 'League', 'Age Group', 'Division', 'Gender',
  'Home Club Code', 'Home Club Name', 'Home Team Code', 'Home Team Group', 'Home Team',
  'Away Club Code', 'Away Club Name', 'Away Team Code', 'Away Team Group', 'Away Team',
  'Status', 'Bye', 'Fixture Reference', 'Fixture Type', 'Allocated Referees',
  'Accepted Referees', 'Present Referees',
])
eq(real.local_date, 'Date', 'date beats the "Day" column')
eq(real.local_time, 'Start', 'kick-off')
eq(real.duration, 'Duration', 'length')
eq(real.venue, 'Ground', 'ground')
eq(real.field, 'Field', 'field, kept separate from the ground')
eq(real.round, 'Round', 'round')
eq(real.home_team, 'Home Team', 'home team beats "Home Team Code" and "Home Team Group"')
eq(real.away_team, 'Away Team', 'away team')
eq(real.home_club, 'Home Club Name', 'home club')
eq(real.away_club, 'Away Club Name', 'away club')
eq(real.bye, 'Bye', 'bye')
eq(real.external_ref, 'Identifier', 'reference')
// The bug this file was bought with: every game came out titled "Pending".
eq(real.title, undefined, '"Matchsheet Status" is NOT a name')
eq(real.end_time, undefined, 'and "Duration" is NOT a finish time')

head('10. "30 min" is half an hour, not an hour and a half')
// The old importer looked for a finish time, found none, and gave every game
// the 90-minute default — so a U7 game that runs 30 minutes sat in a
// parent's calendar for 90 and the next one looked like a clash.
eq(toDurationMins('30 min'), 30, '"30 min"')
eq(toDurationMins('50'), 50, '"50"')
eq(toDurationMins('1:30'), 90, '"1:30"')
eq(toDurationMins('2 hours'), 120, '"2 hours"')
eq(toDurationMins('1 hr 15'), 75, '"1 hr 15"')
eq(toDurationMins(45), 45, 'a bare number')
eq(toDurationMins(''), null, 'blank → the default, not zero')
eq(toDurationMins('TBC'), null, 'nonsense → the default')
// Bounds, because a mis-read duration is worse than none: it puts a wrong
// finish time in every family's calendar.
eq(toDurationMins('5'), null, '5 minutes is not a game')
eq(toDurationMins('480'), null, 'and neither is eight hours')

head('11. Which side of the fixture is us')
const away = resolveSides('NRFA', 'Rilevare Football', 'NRFA', 'Rilevare Football U7', 'NRFA U7 navy')
eq(away.opponent, 'Rilevare Football U7', 'we were away → the opponent is the home team')
eq(away.wasHome, false, 'and was_home is false')

const home = resolveSides('NRFA', 'NRFA', 'Mosman', 'NRFA U7 navy', 'Mosman U7')
eq(home.opponent, 'Mosman U7', 'we were home → the opponent is the away team')
eq(home.wasHome, true, 'and was_home is true')

// Both sides ours. There is no fact in the file about which one this import
// is for, so nothing is invented.
const derby = resolveSides('NRFA', 'NRFA', 'NRFA', 'NRFA U7 navy', 'NRFA U7 sky blue')
eq(derby.derby, true, 'a derby is reported')
eq(derby.wasHome, null, 'and was_home stays unknown rather than guessed')
eq(derby.opponent, null, 'with no opponent claimed')

// Picking a TEAM instead of a club resolves the same derby exactly.
const picked = resolveSides('NRFA U7 navy', 'NRFA', 'NRFA', 'NRFA U7 navy', 'NRFA U7 sky blue')
eq(picked.opponent, 'NRFA U7 sky blue', 'picking the team resolves it')
eq(picked.wasHome, true, 'and knows which end')

const other = resolveSides('NRFA', 'Mosman', 'Manly', 'Mosman U7', 'Manly U7')
eq(other.foreign, true, 'a game between two other clubs is flagged, not imported')

eq(resolveSides(null, 'NRFA', 'Mosman', 'a', 'b').opponent, null, 'nothing claimed before you say who you are')

console.log(process.exitCode ? '\n\x1b[31mBROKEN\x1b[0m' : '\n\x1b[32mPARSING HOLDS\x1b[0m')
