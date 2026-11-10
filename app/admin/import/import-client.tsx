'use client'

import Link from 'next/link'
import { WhenOn } from '@/components/when-on'
import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useScreen } from '@/lib/hooks/use-screen'
import { useOrg } from '@/lib/org'
import { ScreenSkeleton } from '@/components/screen-skeleton'
import {
  FIELDS,
  suggestMapping,
  toLocalDate,
  toLocalTime,
  toDurationMins,
  resolveSides,
  type FieldKey,
} from '@/lib/import/columns'
import { ImportDiff, type Diff } from './import-diff'
import { DEFAULT_TZ } from '@/lib/time'

type Row = Record<string, unknown>
// Keyed by string rather than FieldKey, so the same screen can serve the
// player field set as well as the fixture one. The REQUIRED-field check below
// is what enforces correctness, not the key type.
type Mapping = Partial<Record<string, string>>

type Prepared = {
  index: number
  local_date: string | null
  local_time: string | null
  end_time: string | null
  duration_mins: number | null
  title: string
  opponent: string
  venue: string
  round: string
  external_ref: string
  was_home: boolean | null
  /** F-05: the result in the file, as ours and theirs; null when it has none. */
  our_score: number | null
  their_score: number | null
  /** Why this row will not be imported. */
  problem: string | null
  /** Both sides are this club's — imported once, named with both teams. */
  derby: boolean
  /** The squad this row belongs to, matched on what the league calls it. */
  team_id: string | null
  team_name: string | null
  /** F-05 (0228): the file's two sides and its own home/away score, for the division table. */
  home_team: string
  away_team: string
  home_score: number | null
  away_score: number | null
  division: string
  foreign: boolean
}

/**
 * Two constants, because a brand colour has two jobs and only one of them
 * adapts.
 *
 * BRAND fills a button and carries white text on it, so it stays the club's
 * actual colour. INK is the brand used AS text — and in dark mode the raw
 * brand is whatever colour a club chose sitting on a near-black ground, so
 * the headings on this screen had all but disappeared. Renaming the one
 * constant would have lightened the buttons too and put white on a pale
 * fill.
 */
const BRAND = 'var(--brand)'
const INK = 'var(--brand-text)'

type Team = {
  id: string
  name: string
  /** What the league calls this squad, so a row can be routed to it. */
  external_ref: string | null
  skip_import: boolean
  /** F-05 (0228): the season the division table is filed under. */
  season?: string | null
}

type Screen = {
  academy: { id: string; name: string; timezone: string } | null
  teams: Team[]
}

export function ImportClient() {
  const org = useOrg()
  const { data, failed } = useScreen<Screen>('import_screen', { p_academy: org })

  if (failed) {
    return (
      <main className="mx-auto grid min-h-dvh w-full max-w-md place-items-center p-6">
        <p className="text-center text-sm text-ink-2">Couldn&apos;t load.</p>
      </main>
    )
  }
  if (!data) return <ScreenSkeleton />
  if (!data.academy) {
    return (
      <main className="mx-auto max-w-md p-6">
        <p className="text-center text-sm text-ink-2">Only a coach can import a draw.</p>
      </main>
    )
  }

  return (
    <Importer
      academyId={data.academy.id}
      academyName={data.academy.name}
      timezone={data.academy.timezone}
      teams={data.teams ?? []}
    />
  )
}

function Importer({
  academyId,
  academyName,
  timezone,
  teams,
}: {
  academyId: string
  academyName: string
  timezone: string
  teams: Team[]
}) {
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const [mapping, setMapping] = useState<Mapping>({})
  const [teamId, setTeamId] = useState('')
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  // The diff is the database's answer about THIS mapping and THIS team. Any
  // change to either makes it a statement about an import that is no longer
  // the one being made, so it is thrown away rather than left on screen
  // looking authoritative.
  const [diff, setDiff] = useState<Diff | null>(null)
  const [cancelMissing, setCancelMissing] = useState(false)
  // Which club in the file is this one. Asked rather than matched: a real
  // export calls this academy "NRFA" while the app calls it "NRIFA", and a
  // fuzzy match that got that right would get the next club wrong. One tap,
  // exact after that.
  const [ourClub, setOurClub] = useState<string | null>(null)

  async function readFile(file: File) {
    setError(null)
    setResult(null)
    setBusy('Reading the file…')
    try {
      // Loaded on demand — the parser is large, and nobody who is not
      // importing a draw should pay for it on first page load.
      const XLSX = await import('xlsx')
      const buffer = await file.arrayBuffer()
      // cellDates keeps real dates as Dates rather than Excel serials. It
      // does not solve the timezone problem — see toLocalDate — but it beats
      // reasoning about 45000.5416666667.
      const book = XLSX.read(buffer, { cellDates: true })
      const sheet = book.Sheets[book.SheetNames[0]]
      if (!sheet) throw new Error('That file has no sheets in it.')

      const parsed = XLSX.utils.sheet_to_json<Row>(sheet, { defval: '', raw: false })
      if (parsed.length === 0) throw new Error('That sheet has no rows.')

      const cols = Object.keys(parsed[0])
      setHeaders(cols)
      setRows(parsed)
      setMapping(suggestMapping(cols))
      setFileName(file.name)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That file could not be read.')
      setHeaders([])
      setRows([])
    } finally {
      setBusy(null)
    }
  }

  // What the league calls each of our squads, matched loosely — a trailing
  // space from a league secretary must not break routing, while the stored
  // value stays exactly as the club typed it. Mirrors
  // app_private.team_for_external_ref so the screen and the database route a
  // row the same way.
  const byLeagueName = useMemo(() => {
    const key = (v: string) => v.trim().replace(/\s+/g, ' ').toLowerCase()
    const m = new Map<string, Team>()
    for (const t of teams) if (t.external_ref) m.set(key(t.external_ref), t)
    return m
  }, [teams])

  const prepared: Prepared[] = useMemo(() => {
    const cell = (row: Row, key: FieldKey) => {
      const column = mapping[key]
      return column ? row[column] : ''
    }
    const text = (row: Row, key: FieldKey) => String(cell(row, key) ?? '').trim()

    // 0228: does the file route itself? When our squads are known by their
    // league names and a row names none of them, it is another club's game.
    const norm = (v: string) => v.trim().replace(/\s+/g, ' ').toLowerCase()
    const anyRouted = rows.some((row) => byLeagueName.has(norm(text(row, 'home_team'))) || byLeagueName.has(norm(text(row, 'away_team'))))

    return rows.map((row, index) => {
      const local_date = toLocalDate(cell(row, 'local_date'))
      const local_time = toLocalTime(cell(row, 'local_time'))
      const rawRound = text(row, 'round')
      const explicitTitle = text(row, 'title')

      // A real export gives Home Team and Away Team and no opponent column.
      // Which side is the opposition depends on which club is ours, so it is
      // worked out rather than mapped — the old guess of "Away Team" would
      // have imported a game against ourselves.
      const homeTeam = text(row, 'home_team')
      const awayTeam = text(row, 'away_team')
      const key = (v: string) => v.trim().replace(/\s+/g, ' ').toLowerCase()

      // A squad that has recorded its league name answers the question the
      // file otherwise cannot: a row whose home team is one of ours was
      // played at home. Once the names are in, nobody is asked anything.
      const mineHome = byLeagueName.get(key(homeTeam))
      const mineAway = byLeagueName.get(key(awayTeam))

      const sides =
        mineHome || mineAway
          ? {
              opponent: mineHome ? awayTeam || null : homeTeam || null,
              wasHome: Boolean(mineHome),
              // Both ours by league name. Routed to the home side, because
              // that is the squad the fixture is listed under.
              derby: Boolean(mineHome && mineAway),
              foreign: false,
            }
          : !ourClub && anyRouted
            ? // The file routes itself and this row names none of our squads:
              // another club's game, kept for the division table (0228).
              { opponent: null, wasHome: null, derby: false, foreign: true }
            : resolveSides(
                ourClub,
                text(row, 'home_club'),
                text(row, 'away_club'),
                homeTeam,
                awayTeam
              )

      const team = mineHome ?? mineAway ?? null
      const opponent = text(row, 'opponent') || sides.opponent || ''

      // Ground and field are separate columns, and the field number is the
      // half a parent standing in a car park actually needs.
      const venue = [text(row, 'venue'), text(row, 'field')].filter(Boolean).join(' · ')

      // "7" on its own is not a round, it is a number. The file means Round 7.
      const round = /^\d+$/.test(rawRound) ? `Round ${rawRound}` : rawRound

      // F-05: scores, as ours and theirs. Home/away columns are turned by
      // which side was ours; a single "2 - 1" column reads home first. A
      // row with no score carries none, and leaves any result alone.
      const num = (k: FieldKey) => {
        const v = text(row, k)
        return /^\d+$/.test(v) ? Number(v) : null
      }
      let our_score: number | null = num('our_score')
      let their_score: number | null = num('their_score')
      if (our_score === null || their_score === null) {
        let hs = num('home_score')
        let as = num('away_score')
        const combined = text(row, 'score').match(/^(\d+)\s*[-–:]\s*(\d+)$/)
        if ((hs === null || as === null) && combined) {
          hs = Number(combined[1])
          as = Number(combined[2])
        }
        if (hs !== null && as !== null && typeof sides.wasHome === 'boolean') {
          our_score = sides.wasHome ? hs : as
          their_score = sides.wasHome ? as : hs
        }
      }
      // F-05 (0228): the file's own home and away scores, for the division
      // table — turned back from ours and theirs when that is all a file has.
      let home_score: number | null = num('home_score')
      let away_score: number | null = num('away_score')
      if (home_score === null || away_score === null) {
        const scoreCell = text(row, 'score').match(/^(\d+)\s*[-–:]\s*(\d+)$/)
        if (scoreCell) {
          home_score = Number(scoreCell[1])
          away_score = Number(scoreCell[2])
        } else if (our_score !== null && their_score !== null && typeof sides.wasHome === 'boolean') {
          home_score = sides.wasHome ? our_score : their_score
          away_score = sides.wasHome ? their_score : our_score
        }
      }
      const divisionColumn = mapping['division']

      let problem: string | null = null
      if (isBye(text(row, 'bye'))) problem = 'Marked as a bye — not a game'
      else if (!local_date) problem = 'Could not read the date'
      else if (!local_time) problem = 'Could not read the time'
      else if (sides.foreign) problem = "Another club's game — kept for the division table, not imported"
      else if (team?.skip_import) problem = `${team.name} is set to be left out of imports`

      const bothTeams = [text(row, 'home_team'), text(row, 'away_team')].filter(Boolean)

      return {
        index,
        local_date,
        local_time,
        end_time: toLocalTime(cell(row, 'end_time')),
        duration_mins: toDurationMins(cell(row, 'duration')),
        // A name built from what is there, rather than "Match" forty times.
        // A derby names both sides, because there is no "opponent" when both
        // teams are yours and "Round 8" alone tells a family nothing.
        title:
          explicitTitle ||
          (sides.derby && bothTeams.length === 2
            ? [round, `${bothTeams[0]} v ${bothTeams[1]}`].filter(Boolean).join(' · ')
            : [round, opponent && `vs ${opponent}`].filter(Boolean).join(' ')) ||
          'Match',
        opponent,
        venue,
        round,
        external_ref: text(row, 'external_ref'),
        was_home: sides.wasHome,
        our_score,
        their_score,
        problem,
        derby: sides.derby,
        team_id: team?.id ?? null,
        team_name: team?.name ?? null,
        home_team: homeTeam,
        away_team: awayTeam,
        home_score,
        away_score,
        division: divisionColumn ? String(row[divisionColumn] ?? '').trim() : '',
        foreign: sides.foreign,
      }
    })
  }, [rows, mapping, ourClub, byLeagueName])

  const good = prepared.filter((p) => !p.problem)
  const bad = prepared.filter((p) => p.problem)

  // F-05 (0228): every game in the file with two named sides — ours and the
  // other clubs' — is kept for the division table. Byes and rows whose day
  // could not be read are not games.
  const tableRows = prepared.filter((p) => p.local_date && p.home_team && p.away_team && !p.problem?.startsWith('Marked as a bye'))
  // The season the table is filed under: the squad this file is for, else
  // the squads its rows were routed to, else the club's latest.
  const tableSeason = useMemo(() => {
    const chosen = teams.find((t) => t.id === teamId)?.season
    if (chosen) return chosen
    const counts = new Map<string, number>()
    for (const p of prepared) {
      const s = teams.find((t) => t.id === p.team_id)?.season
      if (s) counts.set(s, (counts.get(s) ?? 0) + 1)
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    return top ?? teams.map((t) => t.season).filter((s): s is string => Boolean(s)).sort().pop() ?? null
  }, [teams, teamId, prepared])

  // The clubs named in the file, so the coach can say which one is them.
  // Taken from the rows rather than a list of clubs we know about, because
  // the file is the only place the file's spelling exists.
  const clubsInFile = useMemo(() => {
    const collect = (keys: readonly string[]) => {
      const seen = new Set<string>()
      for (const row of rows) {
        for (const key of keys) {
          const col = mapping[key]
          const v = col ? String(row[col] ?? '').trim() : ''
          if (v) seen.add(v)
        }
      }
      return [...seen].sort()
    }
    // Clubs when the file names them, team names when it does not. Some
    // exports have Home Team and Away Team and nothing else, and then the
    // team name is the only thing there is to pick.
    const clubs = collect(['home_club', 'away_club'])
    return clubs.length > 0 ? clubs : collect(['home_team', 'away_team'])
  }, [rows, mapping])

  // Only when the file actually has home/away clubs AND names more than one.
  // A single-club file needs no question, and a file with no club columns is
  // one where the opponent is mapped directly.
  // Not asked when the file routes itself. Every row that matched a squad by
  // its league name already knows which side was ours, so the question would
  // be asked and then ignored.
  // And only when the file routes NONE of its rows. A league's results file
  // (0228) carries every club's games, so once our squads are known by their
  // league names the unrouted rows are the other clubs' — kept for the
  // division table, and no reason to ask. The question stays on the screen
  // for a coach whose squad has no league name yet.
  const routed = prepared.filter((p) => p.team_id).length
  const needsClub = clubsInFile.length > 1 && !ourClub && routed === 0

  const ready =
    good.length > 0 &&
    Boolean(mapping.local_date) &&
    Boolean(mapping.local_time) &&
    !needsClub

  // One definition of the payload, used by the preview and the write. Two
  // would be two descriptions of the import, and the preview's job is to be
  // the same import.
  function payload() {
    // Only the rows that will actually be imported. Sending a bye or another
    // club's game and letting the database decide would make the preview
    // describe an import nobody asked for.
    return good.map((p) => ({
      local_date: p.local_date,
      local_time: p.local_time,
      end_time: p.end_time,
      duration_mins: p.duration_mins,
      title: p.title,
      opponent: p.opponent,
      venue: p.venue,
      round: p.round,
      external_ref: p.external_ref,
      was_home: p.was_home,
      // F-05: null when the file has no score for the row.
      our_score: p.our_score,
      their_score: p.their_score,
      // Per row, so one export of the whole club lands in the right squads.
      // Null falls back to the squad chosen for the file.
      team_id: p.team_id,
    }))
  }
  const scoredRows = good.filter((p) => p.our_score !== null && p.their_score !== null).length

  async function check() {
    setBusy('Working out what changes…')
    setError(null)
    const { data, error } = await createClient().rpc('preview_imported_events', {
      p_academy: academyId,
      p_team: (teamId || null) as unknown as string,
      p_events: payload() as never,
    })
    setBusy(null)
    if (error) return setError(error.message)
    setDiff(data as unknown as Diff)
  }

  async function commit() {
    setBusy('Importing…')
    setError(null)
    const { data, error } = await createClient().rpc('create_imported_events', {
      p_academy: academyId,
      p_team: (teamId || null) as unknown as string,
      p_events: payload() as never,
      p_cancel_missing: cancelMissing,
    })
    if (error) {
      setBusy(null)
      return setError(error.message)
    }
    // F-05: the results in the file, onto the games just imported.
    let recorded: { results: number; unmatched: number } | null = null
    if (scoredRows > 0) {
      const { data: rr, error: re } = await createClient().rpc('apply_imported_results', {
        p_academy: academyId,
        p_team: (teamId || null) as unknown as string,
        p_events: payload() as never,
      })
      if (re) {
        setBusy(null)
        return setError(re.message)
      }
      recorded = rr as unknown as { results: number; unmatched: number }
    }
    // F-05 (0228): the whole file's games, the other clubs' included, for
    // the division table. Before 0228 the function is not there, and the
    // import above stands on its own.
    let kept: { added: number; updated: number } | null = null
    if (tableSeason && tableRows.length > 0) {
      const { data: tk, error: te } = await createClient().rpc('store_imported_games', {
        p_academy: academyId,
        p_season: tableSeason,
        p_rows: tableRows.map((p) => ({
          division: p.division || null,
          round: p.round || null,
          local_date: p.local_date,
          home: p.home_team,
          away: p.away_team,
          home_score: p.home_score,
          away_score: p.away_score,
          external_ref: p.external_ref || null,
        })) as never,
      })
      if (!te) kept = tk as unknown as { added: number; updated: number }
    }
    setBusy(null)
    const r = data?.[0]
    setResult(
      [
        r?.created ? `${r.created} added` : null,
        r?.updated ? `${r.updated} updated` : null,
        r?.cancelled ? `${r.cancelled} called off` : null,
        r?.skipped ? `${r.skipped} skipped` : null,
        recorded?.results ? `${recorded.results} ${recorded.results === 1 ? 'result' : 'results'} recorded` : null,
        recorded?.unmatched ? `${recorded.unmatched} ${recorded.unmatched === 1 ? 'score' : 'scores'} for games not found` : null,
        kept ? `${kept.added + kept.updated} ${kept.added + kept.updated === 1 ? 'game' : 'games'} kept for the division table` : null,
      ]
        .filter(Boolean)
        .join(', ') + '.' || 'Nothing to do.'
    )
    setRows([])
    setHeaders([])
    setDiff(null)
    setCancelMissing(false)
  }

  return (
    <main className="mx-auto max-w-md p-5">
      <h1 className="text-2xl font-semibold" style={{ color: INK }}>
        Import a draw
      </h1>
      <p className="mt-1 text-sm text-ink-2">
        In Dribl: Events → filter to your team → Export → Events. Then drop the file here.
        Nothing is created until you have checked it.
      </p>

      {/*
        Admin used to carry three rows — import a draw, import a roster, scan
        a draw — which made a coach choose a TECHNIQUE before knowing which
        applied to the thing in their hand. It is one row now, and the
        question belongs here, where the answer is obvious because they are
        looking at the file.

        Only shown before a file is chosen: once somebody is mapping columns,
        two links out are two ways to lose their work.
      */}
      {headers.length === 0 && (
        <p className="mt-2 text-sm text-ink-2">
          Got something else?{' '}
          <Link
            href="/admin/import/players"
            className="underline underline-offset-2"
            style={{ color: INK }}
          >
            A spreadsheet of players
          </Link>
          {' · '}
          <Link
            href="/admin/import/playfootball"
            className="underline underline-offset-2"
            style={{ color: INK }}
          >
            Your PlayFootball export
          </Link>
          <WhenOn feature="scan">
            {' · '}
            <Link href="/scan" className="underline underline-offset-2" style={{ color: INK }}>
              A screenshot of the draw
            </Link>
          </WhenOn>
        </p>
      )}

      {result && (
        <p className="mt-4 rounded-lg border p-3 text-sm " style={{ background: 'var(--yes-bg)', borderColor: 'var(--yes)', color: 'var(--yes)' }}>
          {result}
        </p>
      )}
      {error && (
        <p className="mt-4 rounded-lg border p-3 text-sm " style={{ background: 'var(--no-bg)', borderColor: 'var(--no)', color: 'var(--no)' }}>
          {error}
        </p>
      )}

      {headers.length === 0 ? (
        <label className="mt-4 flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-[var(--line)] p-6 text-center">
          <input
            type="file"
            accept=".csv,.xlsx,.xls,text/csv"
            className="sr-only"
            disabled={!!busy}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void readFile(file)
              e.target.value = ''
            }}
          />
          {busy ? (
            <span className="text-sm text-ink-2">{busy}</span>
          ) : (
            <>
              <span className="font-medium" style={{ color: INK }}>
                Choose a spreadsheet
              </span>
              <span className="mt-1 text-sm text-ink-2">.csv, .xlsx or .xls</span>
            </>
          )}
        </label>
      ) : (
        <>
          <p className="mt-4 text-sm text-ink-2">
            <b>{fileName}</b> · {rows.length} rows
          </p>

          <section className="mt-4 rounded-xl border border-[var(--line)] p-4">
            <h2 className="font-semibold">Which column is which?</h2>
            {/*
              The suggestion is the starting point, not the answer. Every field
              is a dropdown a coach can change, because a mapping that was
              guessed and never shown is how an importer quietly puts every
              game on the wrong day.
            */}
            <p className="mt-1 text-xs text-ink-2">
              I have had a guess from the column names. Check the two marked required —
              everything else can stay blank.
            </p>

            <div className="mt-3 flex flex-col gap-2">
              {FIELDS.map((field) => (
                <label key={field.key} className="text-sm">
                  <span className="text-ink-2">
                    {field.label}
                    {field.required && <span className=""> *</span>}
                  </span>
                  <select
                    value={mapping[field.key] ?? ''}
                    onChange={(e) =>
                      {
                      setMapping({ ...mapping, [field.key]: e.target.value || undefined })
                      setDiff(null)
                    }
                    }
                    className="mt-0.5 w-full rounded-lg border border-[var(--line)] p-2"
                  >
                    <option value="">— not in this file —</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                  <span className="mt-0.5 block text-xs text-ink-3">{field.hint}</span>
                </label>
              ))}
            </div>
          </section>

          {clubsInFile.length > 1 && (
            <section className="mt-4 rounded-xl border p-4" style={{ borderColor: 'var(--line)' }}>
              <h2 className="font-semibold">Which of these is you?</h2>
              {/*
                Asked, never matched. This export calls the academy "NRFA"
                while the app calls it "NRIFA" — a fuzzy match that got that
                right would get the next club wrong, and the cost of being
                wrong is importing a game against yourself.
              */}
              <p className="mt-1 text-xs text-ink-2">
                The file has Home Team and Away Team, so I need to know which side you are
                before I can tell who you played.
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {clubsInFile.map((c) => (
                  <button
                    key={c}
                    onClick={() => {
                      setOurClub(c === ourClub ? null : c)
                      setDiff(null)
                    }}
                    aria-pressed={c === ourClub}
                    className="rounded-full border px-3 py-1.5 text-xs font-semibold"
                    style={
                      c === ourClub
                        ? {
                            borderColor: BRAND,
                            background: 'var(--brand-faint)',
                            color: INK,
                          }
                        : { borderColor: 'var(--line)', color: 'var(--ink-2)' }
                    }
                  >
                    {c}
                  </button>
                ))}
              </div>
            </section>
          )}

          <label className="mt-4 block">
            <span className="text-sm font-medium">Which team is this draw for?</span>
            <select
              value={teamId}
              onChange={(e) => {
                setTeamId(e.target.value)
                setDiff(null)
                setCancelMissing(false)
              }}
              className="mt-1 w-full rounded-lg border border-[var(--line)] p-2.5 text-sm"
            >
              <option value="">Everyone at {academyName}</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>

          {/*
            The old screen listed the rows it was about to send and reported
            what happened afterwards. "12 added, 3 updated" after the fact is
            the wrong end of the decision — by then forty families have been
            notified about a draw nobody checked.
          */}
          {diff ? (
            <ImportDiff
              diff={diff}
              timezone={timezone}
              cancelMissing={cancelMissing}
              onCancelMissing={setCancelMissing}
            />
          ) : (
            <section className="mt-5">
              <h2 className="font-semibold" style={{ color: INK }}>
                {good.length} {good.length === 1 ? 'game' : 'games'} read
                {bad.length > 0 && `, ${bad.length} not imported`}
              </h2>
              <p className="mt-0.5 text-xs text-ink-2">
                Times are read exactly as written and set in {timezone}. Check the changes
                before anything is created or anyone is told.
              </p>
              {/*
                Shown before the import, not after. A coach who exported forty
                games and imported thirty-eight needs to know which two went
                missing and why, or they find out on a Saturday.
              */}
              {bad.length > 0 && (
                <ul className="mt-2 flex flex-col gap-0.5 text-xs text-ink-2">
                  {Object.entries(
                    bad.reduce<Record<string, number>>((acc, p) => {
                      acc[p.problem!] = (acc[p.problem!] ?? 0) + 1
                      return acc
                    }, {})
                  ).map(([reason, n]) => (
                    <li key={reason}>
                      {n} × {reason}
                    </li>
                  ))}
                </ul>
              )}
              {good.some((p) => p.derby) && (
                <p className="mt-2 text-xs text-ink-2">
                  {good.filter((p) => p.derby).length} of these are between two of your own
                  teams. They are imported once, named with both sides — the file does not say
                  which of them this draw is for.
                </p>
              )}
            </section>
          )}

          <div className="mt-5 flex gap-2">
            <button
              onClick={diff ? commit : check}
              disabled={!ready || !!busy}
              className="flex-1 rounded-xl px-4 py-3 text-sm font-semibold text-brand-ink disabled:opacity-50"
              style={{ background: diff ? BRAND : 'var(--ink-3)' }}
            >
              {busy ??
                (needsClub
                  ? 'Say which club is you first'
                  : !ready
                    ? 'Map the date and time first'
                    : diff
                      ? importLabel(diff, cancelMissing)
                      : 'Check the changes')}
            </button>
            <button
              onClick={() => {
                setHeaders([])
                setRows([])
                setDiff(null)
                setCancelMissing(false)
              }}
              className="rounded-xl border border-[var(--line)] px-4 py-3 text-sm"
            >
              Cancel
            </button>
          </div>

          <p className="mt-3 text-xs text-ink-2">
            Importing the same draw again updates the games that moved rather than creating a
            second copy of the season.
          </p>
        </>
      )}
    </main>
  )
}

function formatWhen(date: string, time: string) {
  const d = new Date(`${date}T${time}`)
  return d.toLocaleString('en-AU', { timeZone: DEFAULT_TZ,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function importLabel(diff: Diff, cancelMissing: boolean) {
  const writes = diff.rows.filter(
    (r) => r.verdict === 'new' || r.verdict === 'moved' || r.verdict === 'changed'
  ).length
  const offs = cancelMissing ? diff.missing.length : 0
  if (writes === 0 && offs === 0) return 'Nothing to import'
  const parts = []
  if (writes) parts.push(`${writes} ${writes === 1 ? 'change' : 'changes'}`)
  if (offs) parts.push(`call off ${offs}`)
  return `Apply ${parts.join(' and ')}`
}


/**
 * Dribl writes this column as the text "True" / "False", not a boolean, so
 * `Boolean(value)` is true for both. A bye is not a game and importing one
 * puts a fixture in a family's calendar for a weekend off.
 */
function isBye(value: string) {
  return ['true', 'yes', '1', 'y'].includes(value.trim().toLowerCase())
}
