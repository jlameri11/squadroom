'use client'

export type DiffRow = {
  verdict: 'new' | 'moved' | 'changed' | 'unchanged' | 'skipped'
  event_id: string | null
  title: string
  round: string | null
  venue: string | null
  was_at: string | null
  now_at: string | null
  was_venue: string | null
  reason?: string
}

export type Missing = {
  event_id: string
  title: string
  starts_at: string
  venue: string | null
  answered: number
}

export type Diff = {
  rows: DiffRow[]
  missing: Missing[]
  covers: { from: string; to: string } | null
}

/**
 * F-03. What this file is about to do.
 *
 * The old screen reported "12 added, 3 updated" AFTERWARDS, which is the
 * wrong end of the decision — by then forty families have been notified about
 * a draw nobody checked. This is the same information, before.
 *
 * The verdicts are computed by the database, by the same code that will do
 * the write. Nothing here recalculates anything: a preview a screen worked
 * out for itself is a preview of a different import.
 *
 * MOVED and CHANGED are deliberately separate. A coach reading "3 moved"
 * checks the times; if a new ground were reported the same way they would
 * check the wrong thing and drive to the old one.
 */
export function ImportDiff({
  diff,
  timezone,
  cancelMissing,
  onCancelMissing,
}: {
  diff: Diff
  timezone: string
  cancelMissing: boolean
  onCancelMissing: (on: boolean) => void
}) {
  const n = (v: DiffRow['verdict']) => diff.rows.filter((r) => r.verdict === v).length
  const moved = diff.rows.filter((r) => r.verdict === 'moved')
  const changed = diff.rows.filter((r) => r.verdict === 'changed')
  const fresh = diff.rows.filter((r) => r.verdict === 'new')
  const skipped = diff.rows.filter((r) => r.verdict === 'skipped')

  const nothing =
    n('new') === 0 && n('moved') === 0 && n('changed') === 0 && diff.missing.length === 0

  return (
    <section className="mt-5">
      <h2 className="font-semibold" style={{ color: 'var(--brand)' }}>
        {nothing ? 'Nothing has changed' : 'What this will do'}
      </h2>
      <p className="mt-0.5 text-xs text-ink-2">
        {nothing
          ? 'Every game in this file already matches what is in the app.'
          : `Times are read exactly as written and set in ${timezone}.`}
      </p>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <Tally n={n('new')} label="new" tint="var(--yes)" />
        <Tally n={n('moved')} label="moved" tint="var(--maybe)" />
        <Tally n={n('changed')} label="new ground or round" tint="var(--maybe)" />
        <Tally n={diff.missing.length} label="gone from the draw" tint="var(--no)" />
        <Tally n={n('unchanged')} label="unchanged" tint="var(--ink-3)" />
        <Tally n={n('skipped')} label="unreadable" tint="var(--no)" />
      </div>

      {/* Moved first, and in full. It is the only verdict where a family is
          already planning around the old answer. */}
      {moved.length > 0 && (
        <Group title="Moved" tint="var(--maybe)">
          {moved.map((r, i) => (
            <li key={r.event_id ?? i} className="py-1.5 text-sm">
              <span className="block truncate font-medium">{r.title}</span>
              <span className="block text-xs tabular-nums text-ink-2">
                <s>{when(r.was_at)}</s> → <b>{when(r.now_at)}</b>
              </span>
            </li>
          ))}
        </Group>
      )}

      {changed.length > 0 && (
        <Group title="Same time, new details" tint="var(--maybe)">
          {changed.map((r, i) => (
            <li key={r.event_id ?? i} className="py-1.5 text-sm">
              <span className="block truncate font-medium">{r.title}</span>
              <span className="block text-xs text-ink-2">
                {when(r.now_at)}
                {r.was_venue && r.was_venue !== r.venue
                  ? ` · ${r.was_venue} → ${r.venue ?? 'no ground'}`
                  : r.venue
                    ? ` · ${r.venue}`
                    : ''}
              </span>
            </li>
          ))}
        </Group>
      )}

      {diff.missing.length > 0 && (
        <Group title="In the app, not in this file" tint="var(--no)">
          {diff.missing.map((m) => (
            <li key={m.event_id} className="py-1.5 text-sm">
              <span className="block truncate font-medium">{m.title}</span>
              <span className="block text-xs tabular-nums text-ink-2">
                {when(m.starts_at)}
                {m.venue ? ` · ${m.venue}` : ''}
                {/* Said out loud, because it is the reason the default is to
                    leave them alone. */}
                {m.answered > 0 &&
                  ` · ${m.answered} ${m.answered === 1 ? 'family has' : 'families have'} answered`}
              </span>
            </li>
          ))}

          <li className="pt-2">
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={cancelMissing}
                onChange={(e) => onCancelMissing(e.target.checked)}
                className="mt-0.5 flex-none"
              />
              <span>
                <span className="font-medium">Call these off too</span>
                <span className="mt-0.5 block text-xs text-ink-2">
                  They stay in the app marked off, and everyone who can see them is told
                  why. Nothing is deleted — a game somebody has answered is a Saturday
                  they have planned around.
                </span>
              </span>
            </label>
          </li>

          {/* The honest limit of what the file proves. */}
          {diff.covers && (
            <li className="pt-1.5 text-xs text-ink-3">
              Only games on the {diff.covers.from === diff.covers.to ? 'day' : 'days'} this
              file covers ({dayOnly(diff.covers.from)}
              {diff.covers.to !== diff.covers.from && ` – ${dayOnly(diff.covers.to)}`}). A day
              this file says nothing about is left alone.
            </li>
          )}
        </Group>
      )}

      {fresh.length > 0 && (
        <Group title="New" tint="var(--yes)">
          {fresh.slice(0, 8).map((r, i) => (
            <li key={i} className="flex justify-between gap-3 py-1.5 text-sm">
              <span className="min-w-0 truncate">{r.title}</span>
              <span className="flex-none text-xs tabular-nums text-ink-2">{when(r.now_at)}</span>
            </li>
          ))}
          {fresh.length > 8 && (
            <li className="py-1 text-xs text-ink-3">…and {fresh.length - 8} more</li>
          )}
        </Group>
      )}

      {/*
        Unreadable rows are shown, never silently dropped. A coach who
        exported forty games and imported thirty-eight needs to know which
        two are missing, or they find out on a Saturday.
      */}
      {skipped.length > 0 && (
        <Group title="Will be skipped" tint="var(--no)">
          {skipped.slice(0, 5).map((r, i) => (
            <li key={i} className="py-1 text-xs">
              {r.title} — {r.reason}
            </li>
          ))}
          {skipped.length > 5 && (
            <li className="py-1 text-xs text-ink-3">…and {skipped.length - 5} more</li>
          )}
          <li className="pt-1.5 text-xs text-ink-3">
            Usually the Date or Kick-off dropdown is pointing at the wrong column.
          </li>
        </Group>
      )}
    </section>
  )
}

function Tally({ n, label, tint }: { n: number; label: string; tint: string }) {
  // A zero is not news. Showing "0 moved" trains people to read past the
  // numbers that matter.
  if (n === 0) return null
  return (
    <span
      className="rounded-full border px-2.5 py-1 text-xs font-semibold"
      style={{ borderColor: tint, color: tint }}
    >
      {n} {label}
    </span>
  )
}

function Group({
  title,
  tint,
  children,
}: {
  title: string
  tint: string
  children: React.ReactNode
}) {
  return (
    <div className="mt-4 rounded-xl border p-3" style={{ borderColor: 'var(--line)' }}>
      <h3 className="eyebrow" style={{ color: tint }}>
        {title}
      </h3>
      <ul className="mt-1 flex flex-col divide-y" style={{ borderColor: 'var(--line-2)' }}>
        {children}
      </ul>
    </div>
  )
}

function when(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function dayOnly(date: string) {
  // A plain yyyy-mm-dd from the database. Split rather than `new Date(date)`,
  // which reads it as UTC midnight and shows the previous day in Sydney.
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}
