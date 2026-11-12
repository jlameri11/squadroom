/**
 * The demo, row by row — so a suite that leaves a change behind is named.
 *
 * Found the hard way on 5 Nov 2026: one suite parked the demo's next game
 * nine days out, another called that Saturday off for real (twice), a third
 * called off the real evening trainings, and five left 113 "Message deleted"
 * bubbles in the U8 chat. Each passed its own checks. The runner now takes
 * this snapshot between suites and reports any difference against the
 * suite that made it (scripts/test-all.mjs).
 *
 * Only the fields a person would notice: a game's time, ground and whether
 * it is on; a club's colours and settings; who is in which squad; a
 * program's dates and places; how many messages and deleted ones a chat
 * has. Nothing a background job legitimately touches (reminder stamps,
 * read receipts, the push queue).
 */
const PAGE = 1000

async function all(admin, table, cols, build) {
  const out = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin.from(table).select(cols).range(from, from + PAGE - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }
  return out.map(build)
}

export async function snapshot(admin) {
  const rows = new Map()
  const put = (key, value, label) => rows.set(key, { v: JSON.stringify(value), label })
  const jobs = [
    all(admin, 'academies', 'id, name, slug, type, primary_colour, logo_url, timezone, dm_policy, directory_visibility, public_player_names, sibling_discount_bps, block_rsvp_when_overdue, overdue_grace_days, fee_reminders, plan', (r) => [`academies:${r.id}`, { ...r }, r.name]),
    all(admin, 'events', 'id, title, type, starts_at, ends_at, arrive_at, venue, cancelled_at, cancellation_reason, team_id', (r) => [`events:${r.id}`, { s: r.starts_at, e: r.ends_at, a: r.arrive_at, v: r.venue, c: r.cancelled_at ? r.cancellation_reason ?? 'off' : null, t: r.team_id }, r.title]),
    all(admin, 'fixtures', 'id, starts_at, status, home_score, away_score, venue_id, pitch_id, field_label, division, round', (r) => [`fixtures:${r.id}`, { s: r.starts_at, st: r.status, h: r.home_score, a: r.away_score, v: r.venue_id, p: r.pitch_id, f: r.field_label }, `${r.division} ${r.round ?? ''}`.trim()]),
    all(admin, 'teams', 'id, name, status, season, academy_id', (r) => [`teams:${r.id}`, { n: r.name, st: r.status, s: r.season }, r.name]),
    // team_since and team_told_at too: a suite that moves a demo child off a
    // squad and back leaves team_id as it was, but team_since moves past
    // team_told_at (the 0249 trigger) and the Season screen then says the
    // family has not been told. test-trials found two of them, 12 Nov 2026.
    all(admin, 'players', 'id, full_name, team_id, academy_id, team_since, team_told_at', (r) => [`players:${r.id}`, { t: r.team_id, a: r.academy_id, s: r.team_since, k: r.team_told_at }, r.full_name]),
    all(admin, 'programs', 'id, name, status, capacity, opens_at, closes_at', (r) => [`programs:${r.id}`, { st: r.status, c: r.capacity, o: r.opens_at, cl: r.closes_at }, r.name]),
    all(admin, 'academy_members', 'academy_id, profile_id, role, status', (r) => [`academy_members:${r.academy_id}:${r.profile_id}`, { r: r.role, st: r.status }, `${r.role}`]),
    all(admin, 'team_members', 'team_id, profile_id, role', (r) => [`team_members:${r.team_id}:${r.profile_id}`, { r: r.role }, `${r.role}`]),
    all(admin, 'competitions', 'id, name, status, published_at, public_slug', (r) => [`competitions:${r.id}`, { st: r.status, p: r.published_at, sl: r.public_slug }, r.name]),
    all(admin, 'staff_clearances', 'id, profile_id, number, outcome, expires_on', (r) => [`staff_clearances:${r.id}`, { n: r.number, o: r.outcome, x: r.expires_on }, r.number]),
  ]
  for (const list of await Promise.all(jobs)) for (const [k, v, label] of list) put(k, v, label)
  // A chat's shape, not its rows: how many messages, how many deleted.
  const { data: chans } = await admin.from('channels').select('id, name')
  await Promise.all((chans ?? []).map(async (c) => {
    const [{ count: live }, { count: dead }] = await Promise.all([
      admin.from('messages').select('id', { count: 'exact', head: true }).eq('channel_id', c.id).is('deleted_at', null),
      admin.from('messages').select('id', { count: 'exact', head: true }).eq('channel_id', c.id).not('deleted_at', 'is', null),
    ])
    put(`chat:${c.id}`, { live, dead }, c.name)
  }))
  return rows
}

/** What changed between two snapshots, in words a person can act on. */
export function difference(before, after) {
  const lines = []
  for (const [k, a] of after) {
    const b = before.get(k)
    const table = k.split(':')[0]
    if (!b) lines.push(`${table}: added “${a.label ?? k}”`)
    else if (b.v !== a.v) lines.push(`${table}: changed “${a.label ?? k}” ${describe(JSON.parse(b.v), JSON.parse(a.v))}`)
  }
  for (const [k, b] of before) if (!after.has(k)) lines.push(`${k.split(':')[0]}: removed “${b.label ?? k}”`)
  return lines
}

function describe(b, a) {
  const keys = [...new Set([...Object.keys(b ?? {}), ...Object.keys(a ?? {})])].filter((k) => JSON.stringify(b?.[k]) !== JSON.stringify(a?.[k]))
  return keys.map((k) => `${k} ${short(b?.[k])} → ${short(a?.[k])}`).join(', ')
}
const short = (v) => (v === null || v === undefined ? '∅' : String(typeof v === 'object' ? JSON.stringify(v) : v).slice(0, 24))
