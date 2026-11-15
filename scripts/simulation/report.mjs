// Writes docs/SIMULATION.md from a run's results: the scenario table Joey
// asked for (PASS / FIXED / FAIL), the bugs found and fixed, the load, the
// peak, and what needs Joey.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './lib.mjs'

const GROUPS = ['Season build', 'Fields & venues', 'Weather & safety on the day', 'Results', 'On-field issues', 'Off-field issues', 'People & messaging']

export function writeReport(rows, ctx) {
  const bugsMd = existsSync(join(ROOT, 'docs', 'BUGS.md')) ? readFileSync(join(ROOT, 'docs', 'BUGS.md'), 'utf8') : ''
  const bugRows = bugsMd.split('\n').filter((l) => /^\| \d+ \|/.test(l))
  const fixedCount = bugRows.filter((l) => !/\|\s*\|\s*$/.test(l)).length
  const counts = { PASS: 0, FIXED: 0, FAIL: 0, 'NOT RUN': 0 }
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1

  const lines = []
  lines.push('# SPL Season 4 — the simulation')
  lines.push('')
  lines.push(`Last run: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · ${ctx.perRound.length} rounds played · ${counts.PASS} PASS · ${counts.FIXED} FIXED · ${counts.FAIL} FAIL · ${counts['NOT RUN']} not run · ${bugRows.length} bugs logged (${fixedCount} fixed) · ${ctx.minutes ?? ''}`)
  lines.push('')
  lines.push('## What this is')
  lines.push('')
  lines.push('Joey\'s brief (9 Nov 2026): build a whole league — Harbour Football Group, SPL Season 4, five age groups in 39 divisions, 300 teams from 60 clubs and academies, 12 grounds with their pitches and hours, 150 referees (30 under 18), every league and committee role, 4,500 players with one or two guardians — and play the season week by week on the local Postgres with every scenario on the list of 13 Nov, as the people who would do it, through the same functions the screens call. Measure at the peak. Log every failure in `docs/BUGS.md`; fix every high and medium.')
  lines.push('')
  lines.push('How to run it (local only, never squadroom-dev): `node scripts/simulation/season.mjs --rebuild` — rebuilds the local database from every migration, loads `scripts/simulation/seed.sql` and the clock (`clock.sql`), then plays the season. `--until N` stops after round N. The clock is simulated: every call runs at the season\'s own moment (February to June 2027), so sheet locks, late declines, reminders, quiet hours, scheduled messages, check expiries and the morning sweeps fire as they would; pg_cron and the push drain are emulated every quarter-hour (`world.mjs`). Everything is done as a person under their RLS; the database is never written as the service role except where the product\'s own server would (the Stripe webhook\'s payment rows, the drain marking rows sent). The simulated data is deleted at the end by rebuilding the local database.')
  lines.push('')
  lines.push('## The scenarios')
  lines.push('')
  lines.push('PASS: happened and behaved as expected. FIXED: failed in an earlier run, fixed (the Fixed column names where), passes now. FAIL: still wrong — see the bug number. Every check is in `scripts/simulation/scenarios.mjs`.')
  for (const g of GROUPS) {
    const these = rows.filter((r) => r.group === g)
    if (!these.length) continue
    lines.push('')
    lines.push(`### ${g}`)
    lines.push('')
    lines.push('| # | Scenario | Result | Checks | Bugs | Fixed in |')
    lines.push('|---|---|---|---|---|---|')
    for (const r of these) {
      const checks = r.checks.length ? `${r.checks.filter((c) => c.passed).length}/${r.checks.length}` : '—'
      const failed = r.checks.filter((c) => !c.passed).map((c) => `${c.what}: expected ${c.expected}, got ${String(c.actual).slice(0, 90)}`).join('; ')
      lines.push(`| ${r.id} | ${r.title}${failed ? ` — _${failed.replace(/\|/g, '\\|')}_` : ''} | **${r.status}** | ${checks} | ${r.bugs.map((b) => `#${b}`).join(', ') || '—'} | ${r.fixed ?? '—'} |`)
    }
  }
  lines.push('')
  lines.push('## The load')
  lines.push('')
  const s = ctx.stats
  lines.push(`Over the run: ${s.notices} league notices, ${s.clubMessages} club messages, ${s.chatLines} chat lines, ${s.reactions} reactions, ${s.polls} polls, ${s.scheduled} scheduled messages, ${s.rsvps} RSVPs, ${s.appointments} referee appointments, ${s.sheets} team sheets, ${s.results} results agreed on the sheets, ${s.disputes} disputes (${s.ruled} ruled on), ${s.lateResults} late results, ${s.cards} cards.`)
  lines.push('')
  if (ctx.perRound.length) {
    lines.push('| Round | Date | Games | Notifications queued | Sent | Texts | By kind |')
    lines.push('|---|---|---|---|---|---|---|')
    for (const w of ctx.perRound) {
      const total = w.queue.reduce((n, t) => n + t.n, 0), sent = w.queue.reduce((n, t) => n + t.sent, 0), sms = w.queue.reduce((n, t) => n + t.sms, 0)
      lines.push(`| ${w.r} | ${w.date} | ${w.games} | ${total} | ${sent} | ${sms} | ${w.queue.slice(0, 6).map((t) => `${t.kind} ${t.n}`).join(', ')} |`)
    }
  }
  if (ctx.peak) {
    lines.push('')
    lines.push('## The peak')
    lines.push('')
    lines.push(ctx.peak.summary ?? '')
    if (ctx.peak.table) lines.push('', ctx.peak.table)
  }
  lines.push('')
  lines.push('## Bugs')
  lines.push('')
  lines.push(`${bugRows.length} logged in \`docs/BUGS.md\`, ${fixedCount} marked fixed. The table there carries role, steps, expected, actual and where each was fixed.`)
  lines.push('')
  lines.push('## Needs Joey')
  lines.push('')
  for (const l of ctx.needsJoey ?? []) lines.push(`- ${l}`)
  if (!(ctx.needsJoey ?? []).length) lines.push('- Nothing from this run.')
  lines.push('')
  writeFileSync(join(ROOT, 'docs', 'SIMULATION.md'), lines.join('\n'))
}
