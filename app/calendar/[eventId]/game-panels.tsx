'use client'

import type { FormRow, Game, LadderRow } from './use-game'

const TINT = { won: 'var(--yes)', drew: 'var(--maybe)', lost: 'var(--no)' } as const
const INK = { won: 'var(--yes-ink)', drew: 'var(--maybe-ink)', lost: 'var(--no-ink)' } as const
const LETTER = { won: 'W', drew: 'D', lost: 'L' } as const

/**
 * The last five, both sides, oldest on the left so it reads like a season.
 * Ours from every match the squad played; theirs from the competition's
 * results — a friendly's opposition has no record here, and the row says so
 * rather than drawing five empty boxes.
 */
export function TeamForm({ game, ourName, theirName }: { game: Game; ourName: string; theirName: string }) {
  const rows: [string, FormRow[] | null, boolean][] = [
    [ourName, game.ourForm, true],
    [theirName, game.theirForm, false],
  ]
  return (
    <section className="mt-5" data-team-form>
      <span className="eyebrow">Team form</span>
      <div className="card mt-1.5 flex flex-col divide-y" style={{ borderColor: 'var(--line)' }}>
        {rows.map(([name, form, ours]) => (
          <div key={name} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5" data-form-side={ours ? 'ours' : 'theirs'}>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
            {form === null ? (
              <span className="text-xs text-ink-3">{ours ? 'No results yet' : 'Not in a competition here'}</span>
            ) : form.length === 0 ? (
              <span className="text-xs text-ink-3">No results yet</span>
            ) : (
              <span className="flex gap-1" aria-label={`Last ${form.length}: ${[...form].reverse().map((f) => f.outcome).join(', ')}`}>
                {[...form].reverse().map((f, i) => (
                  <span
                    key={i}
                    title={`${f.ours}–${f.theirs}${f.against ? ` v ${f.against}` : ''}`}
                    className="grid h-6 w-6 place-items-center rounded-md text-[0.6875rem] font-bold"
                    style={{ background: TINT[f.outcome], color: INK[f.outcome] }}
                    data-form={f.outcome}
                  >
                    {LETTER[f.outcome]}
                  </span>
                ))}
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

/** The two sides' rows of the division's table, and a way to the whole of it. */
export function MiniLadder({ game, onOpen }: { game: Game; onOpen: () => void }) {
  const rows = (game.ladder ?? []).filter((r) => r.entry_id === game.ourEntry || r.entry_id === game.theirEntry)
  if (rows.length === 0) return null
  return (
    <section className="mt-5" data-mini-ladder>
      <div className="sect">
        <span className="eyebrow">Ladder{game.division ? ` · ${game.division}` : ''}</span>
        <button onClick={onOpen} className="tap text-sm underline underline-offset-4" style={{ color: 'var(--brand-text)' }} data-open-ladder>
          Full ladder
        </button>
      </div>
      <button onClick={onOpen} className="card block w-full text-left" aria-label="Open the full ladder">
        <LadderTable rows={rows} game={game} />
      </button>
    </section>
  )
}

export function FullLadder({ game }: { game: Game }) {
  if (!game.ladder || game.ladder.length === 0) return <p className="card mt-4 p-4 text-sm text-ink-2">No ladder yet — it appears once a result is in.</p>
  return (
    <section className="mt-4" data-full-ladder>
      <span className="eyebrow">{game.division ?? 'Ladder'}</span>
      <div className="card mt-1.5 overflow-x-auto">
        <LadderTable rows={game.ladder} game={game} />
      </div>
    </section>
  )
}

function LadderTable({ rows, game }: { rows: LadderRow[]; game: Game }) {
  return (
    <table className="w-full text-sm tabular-nums">
      <thead>
        <tr className="text-left text-xs text-ink-3">
          <th className="py-2 pl-3 pr-1 font-semibold">#</th>
          <th className="px-1 py-2 font-semibold">Team</th>
          <th className="px-1 py-2 text-right font-semibold">P</th>
          <th className="px-1 py-2 text-right font-semibold">GD</th>
          <th className="py-2 pl-1 pr-3 text-right font-semibold">Pts</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const ours = r.entry_id === game.ourEntry
          const theirs = r.entry_id === game.theirEntry
          return (
            <tr
              key={r.entry_id}
              className="border-t"
              style={{ borderColor: 'var(--line-2)', background: ours || theirs ? 'var(--brand-faint)' : undefined, fontWeight: ours ? 700 : undefined }}
              data-ladder-row={ours ? 'ours' : theirs ? 'theirs' : 'other'}
            >
              <td className="py-2 pl-3 pr-1">{r.pos}</td>
              <td className="px-1 py-2">{r.team_name}</td>
              <td className="px-1 py-2 text-right">{r.played}</td>
              <td className="px-1 py-2 text-right">{r.gd > 0 ? `+${r.gd}` : r.gd}</td>
              <td className="py-2 pl-1 pr-3 text-right">{r.points}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
