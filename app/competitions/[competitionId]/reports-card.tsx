'use client'

/**
 * L-15: the competition's reports, as CSV. Plain links — a download is a
 * download — through the caller's own session, so a club sees its
 * competition and the organiser sees the contacts and the money too.
 */
export function ReportsCard({ competitionId, referees }: { competitionId: string; referees: boolean }) {
  const base = `/api/export/competition?competitionId=${competitionId}&report=`
  const links: [string, string, string][] = [
    ['Results', `${base}results`, 'every game with scores, status and referees'],
    ['Ladders', `${base}ladders`, 'every division, adjustments included'],
    ['Discipline', `${base}discipline`, 'cards and suspensions per player'],
    ['Entries', `${base}entries`, 'teams, clubs and the contacts who entered them'],
  ]
  if (referees) links.push(['Referee payments', `/api/export/referee-payments?competitionId=${competitionId}`, 'every game fee, paid or owed'])
  return (
    <div className="m-3.5 rounded-xl border p-3.5" style={{ borderColor: 'var(--line)' }}>
      <h3 className="text-sm font-semibold">Reports</h3>
      <p className="mt-0.5 text-xs text-ink-2">CSV, for a spreadsheet or the federation.</p>
      <ul className="mt-2 divide-y text-sm" style={{ borderColor: 'var(--line-2)' }}>
        {links.map(([label, href, hint]) => (
          <li key={label} className="py-2">
            <a href={href} className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1">
                <span className="block font-medium underline underline-offset-4" style={{ color: 'var(--brand-text)' }}>{label}</span>
                <span className="block text-xs text-ink-3">{hint}</span>
              </span>
              <span className="flex-none text-xs text-ink-3">CSV ↓</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}
