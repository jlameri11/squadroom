import { suggestMapping, toLocalDate, toLocalTime, FIELDS } from '../lib/import/columns.ts'

const ok = (m: string) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m: string) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }
const head = (m: string) => console.log(`\n${m}`)
const eq = (got: unknown, want: unknown, label: string) =>
  got === want ? ok(`${label} → ${got}`) : bad(`${label} → got ${got}, wanted ${want}`)

head('1. Column names as Dribl and league secretaries actually write them')
const dribl = suggestMapping([
  'Match Id', 'Match Date', 'Kick Off', 'Home Team', 'Away Team', 'Venue', 'Match Round', 'Status',
])
eq(dribl.local_date, 'Match Date', 'date')
eq(dribl.local_time, 'Kick Off', 'kick-off')
eq(dribl.opponent, 'Away Team', 'opponent')
eq(dribl.venue, 'Venue', 'venue')
eq(dribl.round, 'Match Round', 'round')
eq(dribl.external_ref, 'Match Id', 'reference')

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

console.log(process.exitCode ? '\n\x1b[31mBROKEN\x1b[0m\n' : '\n\x1b[32mPARSING HOLDS\x1b[0m\n')
