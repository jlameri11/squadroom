// Run: node --env-file=.env.local scripts/seed-inner-west.mjs
//
// Inner West FC — the Big Club Mode demo (Joey's brief, item 14; 11 Nov
// 2026). Fictional: no real club's name, badge or colours. Forty squads
// across MiniRoos, Juniors, Girls, NPL, Seniors and Over-35s; 800 players,
// adults among them; a thousand parents; a full committee; two grounds with
// training slots; an extras program mid-way; a weekend of fixtures; a
// roster with gaps. Ten demo logins (password squadroom-demo; docs/DEMO.md).
//
// DEV ONLY and idempotent: every person is found again by email, every
// squad by name, and the week's events are made afresh each run. It takes
// several minutes — a thousand accounts are made one at a time, as the
// auth API allows.
import { createClient } from '@supabase/supabase-js'
import { PROJECT_REF, PROJECT_NAME } from './_project.mjs'
import { listAllUsers } from './_users.mjs'

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.includes(PROJECT_REF)) {
  console.error(`\n  Refusing to run: this is not ${PROJECT_NAME}.\n`)
  process.exit(1)
}

const IW = '00000000-0000-0000-0000-0000000a0009'
const PASSWORD = process.env.DEMO_PASSWORD ?? 'squadroom-demo'
const TZ = 'Australia/Sydney'
const SEASON = '2026'
const YEAR = 2026
const say = (m) => console.log('  ' + m)
const t0 = Date.now()

// A fixed seed: the same names every run, so a rerun finds its own people.
let seed = 20261111
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 }
const pick = (arr) => arr[Math.floor(rnd() * arr.length)]
const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] } return a }

const FIRST = ['Ava', 'Noah', 'Mia', 'Leo', 'Zoe', 'Ethan', 'Isla', 'Lucas', 'Chloe', 'Oscar', 'Ruby', 'Hugo', 'Layla', 'Max', 'Ella', 'Finn', 'Amara', 'Jonah', 'Sienna', 'Kai',
  'Priya', 'Arjun', 'Hana', 'Theo', 'Lena', 'Rafael', 'Nia', 'Elias', 'Maya', 'Samir', 'Freya', 'Ibrahim', 'Jade', 'Mateo', 'Aisha', 'Luka', 'Harper', 'Yusuf', 'Willow', 'Nico',
  'Daniel', 'Sarah', 'James', 'Elena', 'Tom', 'Rachel', 'Ben', 'Holly', 'Marcus', 'Nadia', 'Owen', 'Mei', 'Harpreet', 'Luca', 'Sophie', 'Dev', 'Grace', 'Tomasz', 'Fiona', 'Carlos']
const LAST = ['Whitlock', 'Okoro', 'Nguyen', 'Petrov', 'Blake', 'Tanaka', 'Gill', 'Moretti', 'Laurent', 'Sharma', 'Nowak', 'Walsh', 'Mendes', 'Haddad', 'Kowalski', 'Ferreira', 'Ibarra', 'Costa', 'Lindqvist', 'Abara',
  'Chen', 'Rossi', 'Nair', 'Bradley', 'Fraser', 'Pappas', 'Kim', 'Turner', 'Deng', 'Rahman', 'Silva', 'Dubois', 'Novak', 'Hassan', 'Brennan', 'Santos', 'Ali', 'Murray', 'Park', 'Reyes',
  'Ivanova', 'Baker', 'Martin', 'Lopez', 'Hughes', 'Singh', 'Tran', 'Russo', 'Walker', 'Khan', 'Evans', 'Moore', 'Clark', 'Young', 'Wright', 'Adams', 'Hill', 'Scott', 'Green', 'Carter']
const OPPONENTS = ['Haberfield Hawks', 'Lilyfield Lions', 'Rozelle Rovers', 'Leichhardt Lynx', 'Ashfield Arrows', 'Croydon Comets', 'Five Dock Falcons', 'Drummoyne Dragons', 'Summer Hill Strikers', 'Dulwich Hill Dynamos']

// --- time ------------------------------------------------------------------
const localDate = (d) => d.toLocaleDateString('en-CA', { timeZone: TZ })
function atLocal(date, hhmm) {
  const probe = new Date(`${date}T${hhmm}:00Z`)
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' }).formatToParts(probe)
  const off = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+10:00'
  const m = off.match(/GMT([+-])(\d{2}):(\d{2})/)
  const sign = m?.[1] === '-' ? -1 : 1
  const mins = sign * ((Number(m?.[2] ?? 10) * 60) + Number(m?.[3] ?? 0))
  return new Date(probe.getTime() - mins * 60000)
}
const shift = (dateStr, days) => { const d = new Date(`${dateStr}T12:00:00`); d.setDate(d.getDate() + days); return localDate(d) }
const today = localDate(new Date())
const dow = new Date(`${today}T12:00:00`).getDay()
const nextSat = shift(today, ((6 - dow + 7) % 7) || 7)
const lastSat = shift(nextSat, -7)
const thisMon = shift(today, -((dow + 6) % 7))

// --- people ------------------------------------------------------------------
const { data: listed } = await listAllUsers(admin)
const byEmail = new Map((listed?.users ?? []).map((u) => [(u.email ?? '').toLowerCase(), u]))
let phoneN = 0
const nextPhone = () => `+6143${String(1000000 + phoneN++).padStart(7, '0')}`
let made = 0
async function ensureUser({ email, name, password, phone }) {
  const key = email.toLowerCase()
  let user = byEmail.get(key)
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true, password: password ?? undefined, user_metadata: { full_name: name } })
    if (error) throw new Error(`${email}: ${error.message}`)
    user = data.user
    byEmail.set(key, user)
    made++
  } else if (password) {
    await admin.auth.admin.updateUserById(user.id, { password })
  }
  await admin.from('profiles').upsert({ id: user.id, full_name: name, phone: phone ?? null }, { onConflict: 'id' })
  return user.id
}
async function chunked(table, rows, onConflict) {
  for (let i = 0; i < rows.length; i += 200) {
    const slice = rows.slice(i, i + 200)
    const q = onConflict ? admin.from(table).upsert(slice, { onConflict, ignoreDuplicates: true }) : admin.from(table).insert(slice)
    const { error } = await q
    if (error) throw new Error(`${table}: ${error.message}`)
  }
}

console.log('\nInner West FC — the Big Club Mode demo\n')
if (process.argv.includes('--reset')) {
  const { error } = await admin.from('academies').delete().eq('id', IW)
  if (error) throw new Error(`reset: ${error.message}`)
  say('reset: the club and everything of its removed (the accounts stay, and are found again by email)')
}

// --- the club ----------------------------------------------------------------
{
  const { error } = await admin.from('academies').upsert({
    id: IW, name: 'Inner West FC', slug: 'inner-west-fc', type: 'club', primary_colour: '#1D5C3A', timezone: TZ,
    club_mode: true, two_step_required: false, miniroos_scores: false,
  }, { onConflict: 'id' })
  if (error) throw new Error(`academy: ${error.message}`)
  await chunked('streams', [['MiniRoos', 1], ['Juniors', 2], ['Girls', 3], ['NPL', 4], ['Seniors', 5], ['Over-35s', 6]].map(([name, sort_order]) => ({ academy_id: IW, name, sort_order })), 'academy_id,name')
  // Club mode seeds eight default streams; the brief's club has six. The two
  // with no squad in them go.
  const { data: extra } = await admin.from('streams').select('id, name').eq('academy_id', IW).in('name', ['Women', 'Community'])
  for (const x of extra ?? []) {
    const { count } = await admin.from('teams').select('id', { count: 'exact', head: true }).eq('stream_id', x.id)
    if (!count) await admin.from('streams').delete().eq('id', x.id)
  }
  say('the club, in club mode, with six streams')
}
const { data: streamRows } = await admin.from('streams').select('id, name').eq('academy_id', IW)
const stream = Object.fromEntries((streamRows ?? []).map((s) => [s.name, s.id]))

// --- the committee and the ten demo logins ---------------------------------
const DEMO = [
  { key: 'president', email: 'iw.president@squadroom-demo.test', name: 'Nadia Petrov', hat: 'owner', roles: [['president', 'club']] },
  { key: 'secretary', email: 'iw.secretary@squadroom-demo.test', name: 'Owen Blake', hat: 'admin', roles: [['secretary', 'club']] },
  { key: 'registrar', email: 'iw.registrar@squadroom-demo.test', name: 'Mei Tanaka', hat: 'parent', roles: [['registrar', 'club']] },
  { key: 'treasurer', email: 'iw.treasurer@squadroom-demo.test', name: 'Harpreet Gill', hat: 'parent', roles: [['treasurer', 'club']] },
  { key: 'coordinator', email: 'iw.coordinator@squadroom-demo.test', name: 'Luca Moretti', hat: 'parent', roles: [['coordinator', 'age_group', 'U9'], ['coordinator', 'age_group', 'U10'], ['coordinator', 'age_group', 'U11'], ['coordinator', 'age_group', 'U12']] },
  { key: 'manager', email: 'iw.manager@squadroom-demo.test', name: 'Sophie Laurent', hat: 'parent', roles: [['team_manager', 'team', 'U12 Red']] },
  { key: 'coach', email: 'iw.coach@squadroom-demo.test', name: 'Dev Sharma', hat: 'coach', roles: [], coaches: ['U10 Blue'] },
  { key: 'parent', email: 'iw.parent@squadroom-demo.test', name: 'Grace Okoro', hat: 'parent', roles: [], kids: [['Amara Okoro', 'U8 Red', 2018], ['Jonah Okoro', 'U13 Black', 2013]] },
  { key: 'adult', email: 'iw.player@squadroom-demo.test', name: 'Tomasz Nowak', hat: 'player', roles: [], plays: ['Over-35 A', 1984] },
  { key: 'welfare', email: 'iw.welfare@squadroom-demo.test', name: 'Fiona Walsh', hat: 'parent', roles: [['welfare_officer', 'club']], officer: true },
  { key: 'volunteers', email: 'iw.volunteers@squadroom-demo.test', name: 'Carlos Mendes', hat: 'parent', roles: [['volunteer_coordinator', 'club']] },
]
const demoId = {}
for (const d of DEMO) {
  demoId[d.key] = await ensureUser({ email: d.email, name: d.name, password: PASSWORD, phone: nextPhone() })
  await admin.from('account_emails').upsert({ profile_id: demoId[d.key], email: d.email, verified_at: new Date().toISOString() }, { onConflict: 'profile_id' })
}
const PRESIDENT = demoId.president
const clearance = (profile_id, number) => ({ academy_id: IW, profile_id, kind: 'wwcc', number, outcome: 'cleared', expires_on: shift(today, 400 + Math.floor(rnd() * 400)), verified_by: PRESIDENT })
// Staff and coaches need a current check before the membership trigger lets them in.
await chunked('staff_clearances', DEMO.filter((d) => ['owner', 'admin', 'coach'].includes(d.hat)).map((d) => clearance(demoId[d.key], `WWC${d.key.toUpperCase().slice(0, 4)}1E`)), 'academy_id,profile_id')
say('the committee and the ten demo logins')

// --- the squads --------------------------------------------------------------
// [name, age_group, stream, gender, label]
const TEAMS = [
  ...['U6 Red', 'U6 Blue'].map((n) => [n, 'U6', 'MiniRoos', 'mixed']),
  ...['U7 Red', 'U7 Blue'].map((n) => [n, 'U7', 'MiniRoos', 'mixed']),
  ...['U8 Red', 'U8 Blue', 'U8 Gold'].map((n) => [n, 'U8', 'MiniRoos', 'mixed']),
  ...['U9 Red', 'U9 Blue', 'U9 Gold'].map((n) => [n, 'U9', 'MiniRoos', 'mixed']),
  ...['U10 Red', 'U10 Blue', 'U10 Gold'].map((n) => [n, 'U10', 'MiniRoos', 'mixed']),
  ...['U11 Red', 'U11 Blue', 'U11 Gold'].map((n) => [n, 'U11', 'MiniRoos', 'mixed']),
  ...['U12 Red', 'U12 Blue', 'U12 Gold'].map((n) => [n, 'U12', 'Juniors', 'boys']),
  ...['U13 Black', 'U13 Green'].map((n) => [n, 'U13', 'Juniors', 'boys']),
  ...['U14 Black', 'U14 Green'].map((n) => [n, 'U14', 'Juniors', 'boys']),
  ...['U15 Black', 'U15 Green'].map((n) => [n, 'U15', 'Juniors', 'boys']),
  ['U16 Black', 'U16', 'Juniors', 'boys'],
  ['U10 Girls', 'U10', 'Girls', 'girls'], ['U12 Girls', 'U12', 'Girls', 'girls'], ['U14 Girls', 'U14', 'Girls', 'girls'], ['U16 Girls', 'U16', 'Girls', 'girls'],
  ['NPL U13', 'U13', 'NPL', 'boys'], ['NPL U14', 'U14', 'NPL', 'boys'], ['NPL U15', 'U15', 'NPL', 'boys'], ['NPL U16', 'U16', 'NPL', 'boys'], ['NPL U18', 'U18', 'NPL', 'boys'],
  ['Premier League', 'Open', 'Seniors', 'men'], ['Reserve Grade', 'Open', 'Seniors', 'men'], ['All Age Division 2', 'Open', 'Seniors', 'men'],
  ['Over-35 A', 'Over-35', 'Over-35s', 'men'], ['Over-35 B', 'Over-35', 'Over-35s', 'men'],
]
const team = {}
{
  const { data: existing } = await admin.from('teams').select('id, name').eq('academy_id', IW)
  for (const t of existing ?? []) team[t.name] = t.id
  const missing = TEAMS.filter(([n]) => !team[n]).map(([name, age_group, s, gender]) => ({ academy_id: IW, name, age_group, season: SEASON, status: 'active', stream_id: stream[s], gender }))
  if (missing.length) {
    const { data, error } = await admin.from('teams').insert(missing).select('id, name')
    if (error) throw new Error(`teams: ${error.message}`)
    for (const t of data) team[t.name] = t.id
  }
  say(`${TEAMS.length} squads across the six streams`)
}
const ageOf = (ag) => Number((ag.match(/^U(\d+)$/) ?? [])[1]) || null
const isAdultTeam = (ag) => ag === 'Open' || ag === 'Over-35'

// --- the roster: 800 players, their families, their coaches ------------------
// Paged: one request answers 1,000 rows at most, and the roster is 800 today.
const existingPlayers = []
for (let from = 0; ; from += 1000) {
  const { data } = await admin.from('players').select('id, full_name, team_id').eq('academy_id', IW).order('id').range(from, from + 999)
  existingPlayers.push(...(data ?? []))
  if (!data || data.length < 1000) break
}
const playerKey = (t, n) => `${t}|${n}`
const player = new Map((existingPlayers ?? []).map((p) => [playerKey(p.team_id, p.full_name), p.id]))
// Within this run only: the fixed sequence must give the same names every
// run, or a rerun minds the names already on the roster and mints new ones.
const usedNames = new Set()
function newName(last) {
  for (let i = 0; i < 50; i++) {
    const n = `${pick(FIRST)} ${last ?? pick(LAST)}`
    if (!usedNames.has(n)) { usedNames.add(n); return n }
  }
  const n = `${pick(FIRST)} ${pick(LAST)} ${usedNames.size}`
  usedNames.add(n)
  return n
}
const dobFor = (ag) => {
  const age = ageOf(ag)
  const year = age ? YEAR - age : ag === 'Over-35' ? 1975 + Math.floor(rnd() * 12) : 1990 + Math.floor(rnd() * 16)
  return `${year}-${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rnd() * 28)).padStart(2, '0')}`
}

// Families: the demo parent's two children first, then the rest.
const families = [] // { parents: [{email,name,phone}], kids: [{name, team, dob}] }
const juniorTeams = TEAMS.filter(([, ag]) => !isAdultTeam(ag))
const kidsPerTeam = 20
const slots = juniorTeams.flatMap(([name]) => Array.from({ length: kidsPerTeam }, () => name)) // 700
// Grace's two go first.
const graceKids = DEMO.find((d) => d.key === 'parent').kids
families.push({ parents: [{ id: demoId.parent, name: 'Grace Okoro' }], kids: graceKids.map(([n, t, y]) => ({ name: n, team: t, dob: `${y}-04-12` })) })
const remaining = shuffle(slots.filter((t) => { const i = graceKids.findIndex((k) => k[1] === t); if (i >= 0) { graceKids.splice(i, 1); return false } return true }))
let fi = 0
while (remaining.length) {
  const last = pick(LAST)
  const two = remaining.length > 1 && rnd() < 0.09
  const kids = [remaining.pop()]
  if (two) kids.push(remaining.pop())
  const parents = [{ email: `iw.parent.${fi}@squadroom.invalid`, name: newName(last) }]
  if (rnd() < 0.6) parents.push({ email: `iw.parent.${fi}b@squadroom.invalid`, name: newName(last) })
  families.push({ parents, kids: kids.map((t) => ({ name: newName(last), team: t, dob: dobFor(TEAMS.find(([n]) => n === t)[1]) })) })
  fi++
}
say(`${families.length} families, ${families.reduce((n, f) => n + f.parents.length, 0)} parents, ${families.reduce((n, f) => n + f.kids.length, 0)} children to place`)

// Players first (no team yet for the trigger's sake: families join below).
{
  const rows = []
  for (const f of families) for (const k of f.kids) {
    const tid = team[k.team]
    if (!player.has(playerKey(tid, k.name))) rows.push({ academy_id: IW, team_id: tid, full_name: k.name, dob: k.dob })
  }
  for (let i = 0; i < rows.length; i += 200) {
    const { data, error } = await admin.from('players').insert(rows.slice(i, i + 200)).select('id, full_name, team_id')
    if (error) throw new Error(`players: ${error.message}`)
    for (const p of data) player.set(playerKey(p.team_id, p.full_name), p.id)
  }
  say(`${rows.length} children on the roster`)
}
// Parents: an account each, then their memberships, their children and their squads.
{
  let n = 0
  const members = [], guardians = [], teamMembers = []
  for (const f of families) {
    for (const p of f.parents) {
      if (!p.id) p.id = await ensureUser({ email: p.email, name: p.name, phone: nextPhone() })
      n++
      if (n % 100 === 0) say(`  … ${n} parents (${made} new accounts, ${Math.round((Date.now() - t0) / 1000)}s)`)
      members.push({ academy_id: IW, profile_id: p.id, role: 'parent', status: 'active' })
      for (const k of f.kids) {
        const tid = team[k.team]
        guardians.push({ academy_id: IW, player_id: player.get(playerKey(tid, k.name)), profile_id: p.id, relationship: 'parent' })
        teamMembers.push({ academy_id: IW, team_id: tid, profile_id: p.id, role: 'parent' })
      }
    }
  }
  await chunked('academy_members', members, 'academy_id,profile_id')
  await chunked('player_guardians', guardians, 'player_id,profile_id')
  await chunked('team_members', teamMembers, 'team_id,profile_id')
  say(`${n} parents in, linked to their children and their squads`)
}
// Adults: their own members, on their own squads.
{
  const adultTeams = TEAMS.filter(([, ag]) => isAdultTeam(ag))
  const rows = []
  let ai = 0
  for (const [name, ag] of adultTeams) {
    for (let i = 0; i < kidsPerTeam; i++) {
      const isDemo = name === 'Over-35 A' && i === 0
      const email = isDemo ? DEMO.find((d) => d.key === 'adult').email : `iw.adult.${ai}@squadroom.invalid`
      const pname = isDemo ? 'Tomasz Nowak' : newName()
      // Drawn every time, found or not: a draw skipped for a player already on
      // the roster would shift the fixed sequence and rename everyone after them.
      const dob = isDemo ? '1984-02-20' : dobFor(ag)
      const id = isDemo ? demoId.adult : await ensureUser({ email, name: pname, phone: nextPhone() })
      ai++
      const tid = team[name]
      if (!player.has(playerKey(tid, pname))) {
        const { data, error } = await admin.from('players').insert({ academy_id: IW, team_id: tid, full_name: pname, dob, profile_id: id }).select('id').single()
        if (error) throw new Error(`adult player: ${error.message}`)
        player.set(playerKey(tid, pname), data.id)
      } else {
        // Their own record, their own account — kept in step when an account was made again.
        await admin.from('players').update({ profile_id: id }).eq('id', player.get(playerKey(tid, pname)))
      }
      rows.push({ id, tid })
    }
  }
  await chunked('academy_members', rows.map((r) => ({ academy_id: IW, profile_id: r.id, role: 'player', status: 'active' })), 'academy_id,profile_id')
  await chunked('team_members', rows.map((r) => ({ academy_id: IW, team_id: r.tid, profile_id: r.id, role: 'player' })), 'team_id,profile_id')
  say(`${rows.length} adult players, their own members`)
}
// Coaches: one per squad (a few take two), each with a current check.
{
  const coachRows = []
  const names = TEAMS.map(([n]) => n)
  const coachOf = {}
  let ci = 0
  for (let i = 0; i < names.length; i++) {
    const tname = names[i]
    if (tname === 'U10 Blue') { coachOf[tname] = demoId.coach; continue }
    // every ninth coach takes the next squad too
    if (i > 0 && i % 9 === 0 && coachOf[names[i - 1]]) { coachOf[tname] = coachOf[names[i - 1]]; continue }
    const id = await ensureUser({ email: `iw.coach.${ci}@squadroom.invalid`, name: newName(), phone: nextPhone() })
    ci++
    coachOf[tname] = id
    coachRows.push(clearance(id, `WWC${String(2000000 + ci)}E`))
  }
  await chunked('staff_clearances', coachRows, 'academy_id,profile_id')
  const ids = [...new Set(Object.values(coachOf))]
  await chunked('academy_members', ids.map((id) => ({ academy_id: IW, profile_id: id, role: 'coach', status: 'active' })), 'academy_id,profile_id')
  await chunked('team_members', names.map((n) => ({ academy_id: IW, team_id: team[n], profile_id: coachOf[n], role: 'coach' })), 'team_id,profile_id')
  say(`${ids.length} coaches, every squad with one`)
}
// The committee's hats and roles.
{
  const members = DEMO.map((d) => ({ academy_id: IW, profile_id: demoId[d.key], role: d.hat, status: 'active' }))
  await chunked('academy_members', members, 'academy_id,profile_id')
  // The owner's and admin's rows: the hat must win over 'parent' from an earlier run.
  for (const d of DEMO.filter((x) => ['owner', 'admin', 'coach'].includes(x.hat))) {
    await admin.from('academy_members').update({ role: d.hat }).eq('academy_id', IW).eq('profile_id', demoId[d.key])
  }
  const roles = []
  for (const d of DEMO) for (const [role, scope, which] of d.roles) {
    roles.push({ academy_id: IW, profile_id: demoId[d.key], role, scope_kind: scope, age_group: scope === 'age_group' ? which : null, team_id: scope === 'team' ? team[which] : null, granted_by: PRESIDENT })
  }
  // Team managers for twenty more squads: a parent of the squad — never the
  // demo parent, whose Home must be a plain parent's.
  const managed = new Set(['U12 Red'])
  for (const f of families) {
    if (roles.length >= 32) break
    const k = f.kids[0]
    if (f.parents[0].id === demoId.parent || managed.has(k.team) || isAdultTeam(TEAMS.find(([n]) => n === k.team)[1])) continue
    managed.add(k.team)
    roles.push({ academy_id: IW, profile_id: f.parents[0].id, role: 'team_manager', scope_kind: 'team', team_id: team[k.team], granted_by: PRESIDENT })
  }
  const { data: have } = await admin.from('club_roles').select('profile_id, role, team_id, age_group').eq('academy_id', IW)
  const key = (r) => `${r.profile_id}|${r.role}|${r.team_id ?? ''}|${r.age_group ?? ''}`
  const haveKeys = new Set((have ?? []).map(key))
  const fresh = roles.filter((r) => !haveKeys.has(key(r)))
  if (fresh.length) await chunked('club_roles', fresh)
  {
    const { data: officer } = await admin.from('safeguarding_officers').select('profile_id').eq('academy_id', IW).eq('profile_id', demoId.welfare).maybeSingle()
    if (!officer) await admin.from('safeguarding_officers').insert({ academy_id: IW, profile_id: demoId.welfare, appointed_by: PRESIDENT })
  }
  // Team managers are on their squads and in their chats.
  await chunked('team_members', roles.filter((r) => r.role === 'team_manager').map((r) => ({ academy_id: IW, team_id: r.team_id, profile_id: r.profile_id, role: 'parent' })), 'team_id,profile_id')
  // Grace's two, the demo coach's squad, the manager's squad: on the squads they belong to.
  await chunked('team_members', [
    ...graceKidsTeams().map((t) => ({ academy_id: IW, team_id: t, profile_id: demoId.parent, role: 'parent' })),
    { academy_id: IW, team_id: team['U12 Red'], profile_id: demoId.manager, role: 'parent' },
  ], 'team_id,profile_id')
  say(`the committee: President, Secretary, Registrar, Treasurer, the U9–U12 coordinator, the Welfare officer, the Volunteer coordinator, ${roles.filter((r) => r.role === 'team_manager').length} team managers`)
}
function graceKidsTeams() { return DEMO.find((d) => d.key === 'parent').kids.map(([, t]) => team[t]) }

// --- the grounds, their pitches, the week's slots ----------------------------
const venue = {}
const pitch = {}
{
  const VENUES = [['Hawthorne Reserve', 'Hawthorne Parade, Haberfield'], ['Cintra Park', 'Cintra Street, Concord']]
  for (const [name, address] of VENUES) {
    const { data: v } = await admin.from('venues').select('id').eq('academy_id', IW).eq('name', name).maybeSingle()
    if (v) venue[name] = v.id
    else {
      const { data, error } = await admin.from('venues').insert({ academy_id: IW, name, address }).select('id').single()
      if (error) throw new Error(`venue: ${error.message}`)
      venue[name] = data.id
    }
  }
  // [venue, name, size, parent, x, y, w, h]
  const PITCHES = [
    ['Hawthorne Reserve', 'Pitch 1', 'full', null, 2, 2, 40, 60], ['Hawthorne Reserve', 'Pitch 2', 'full', null, 50, 2, 40, 60],
    ['Hawthorne Reserve', 'Pitch 2 North', 'half', 'Pitch 2', 50, 2, 40, 30], ['Hawthorne Reserve', 'Pitch 2 South', 'half', 'Pitch 2', 50, 32, 40, 30],
    ['Cintra Park', 'Pitch 1', 'full', null, 2, 2, 40, 60], ['Cintra Park', 'Pitch 2', 'full', null, 50, 2, 40, 60],
    ['Cintra Park', 'Pitch 2 East', 'half', 'Pitch 2', 50, 2, 40, 30], ['Cintra Park', 'Pitch 2 West', 'half', 'Pitch 2', 50, 32, 40, 30],
  ]
  const { data: have } = await admin.from('pitches').select('id, name, venue_id').eq('academy_id', IW)
  for (const p of have ?? []) pitch[`${p.venue_id}|${p.name}`] = p.id
  for (const [vname, name, size, parent, x, y, w, h] of PITCHES) {
    const vid = venue[vname]
    if (pitch[`${vid}|${name}`]) continue
    const { data, error } = await admin.from('pitches').insert({ academy_id: IW, venue_id: vid, name, size, parent_id: parent ? pitch[`${vid}|${parent}`] : null, x, y, w, h }).select('id').single()
    if (error) throw new Error(`pitch ${name}: ${error.message}`)
    pitch[`${vid}|${name}`] = data.id
  }
  // Weeknight hours on every full pitch (the halves inherit).
  const fulls = PITCHES.filter((p) => p[2] === 'full').map((p) => pitch[`${venue[p[0]]}|${p[1]}`])
  await admin.from('pitch_availability').delete().in('pitch_id', fulls)
  await chunked('pitch_availability', fulls.flatMap((pid) => [1, 2, 3, 4, 5].map((weekday) => ({ academy_id: IW, pitch_id: pid, weekday, opens: '16:00', closes: '21:00' }))))
  say('two grounds, drawn, open weeknights four to nine')
}
// Training slots: each squad twice a week, on a pitch or a half, clash-free by construction.
{
  const { data: oldSeries } = await admin.from('event_series').select('id').eq('academy_id', IW)
  const ids = (oldSeries ?? []).map((s) => s.id)
  if (ids.length) { await admin.from('events').delete().in('series_id', ids); await admin.from('event_series').delete().in('id', ids) }
  await admin.from('events').delete().eq('academy_id', IW).eq('type', 'training')
  const units = [ // [venue, pitch, forSmallSided] — up to U14 train on a half, as clubs do
    ['Hawthorne Reserve', 'Pitch 1', false], ['Hawthorne Reserve', 'Pitch 2 North', true], ['Hawthorne Reserve', 'Pitch 2 South', true],
    ['Cintra Park', 'Pitch 1', false], ['Cintra Park', 'Pitch 2 East', true], ['Cintra Park', 'Pitch 2 West', true],
  ]
  const times = ['16:30', '17:30', '18:30', '19:30']
  const dayPairs = [[1, 3], [2, 4]]
  const taken = new Set() // `${pitch}|${day}|${time}`
  const seriesRows = [], eventRows = []
  const until = shift(thisMon, 8 * 7 - 1)
  for (const [tname, ag] of TEAMS) {
    const mini = ageOf(ag) !== null && ageOf(ag) <= 14
    let placed = null
    outer: for (const [vname, pname, forMini] of units) {
      if (forMini !== mini) continue
      for (const t of times) for (const pair of dayPairs) {
        const pid = pitch[`${venue[vname]}|${pname}`]
        if (pair.every((d) => !taken.has(`${pid}|${d}|${t}`))) {
          pair.forEach((d) => taken.add(`${pid}|${d}|${t}`))
          placed = { vname, pname, pid, t, pair }
          break outer
        }
      }
    }
    if (!placed) { say(`  no slot left for ${tname}`); continue }
    const label = `${placed.vname} · ${placed.pname}`
    seriesRows.push({ academy_id: IW, team_id: team[tname], type: 'training', title: 'Training', days: placed.pair, at_time: placed.t, duration_mins: 60, arrive_mins: 10, venue: label, starts_on: thisMon, ends_on: until, created_by: PRESIDENT, pitch_id: placed.pid, venue_id: venue[placed.vname] })
  }
  const { data: series, error } = await admin.from('event_series').insert(seriesRows).select('id, team_id, days, at_time, venue, pitch_id, venue_id')
  if (error) throw new Error(`series: ${error.message}`)
  for (const s of series) {
    for (let w = 0; w < 8; w++) for (const d of s.days) {
      const date = shift(thisMon, w * 7 + ((d + 6) % 7))
      const start = atLocal(date, s.at_time.slice(0, 5))
      eventRows.push({ academy_id: IW, team_id: s.team_id, type: 'training', title: 'Training', venue: s.venue, pitch_id: s.pitch_id, venue_id: s.venue_id, series_id: s.id, source: 'manual',
        starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 3600e3).toISOString(), arrive_at: new Date(start.getTime() - 600e3).toISOString() })
    }
  }
  await chunked('events', eventRows)
  say(`${series.length} training slots, ${eventRows.length} sessions over eight weeks`)
}

// --- a weekend of fixtures: last Saturday played, next Saturday to come -------
const games = {}
{
  await admin.from('events').delete().eq('academy_id', IW).eq('type', 'match')
  const rows = []
  const timesHome = ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00']
  let gi = 0
  for (const [tname, ag] of TEAMS) {
    const mini = ageOf(ag) !== null && ageOf(ag) <= 11
    for (const [date, played] of [[lastSat, true], [nextSat, false]]) {
      // Half the squads at home each Saturday (the other half the next), so
      // both grounds are busy on the day the roster is for.
      const home = ((gi >> 1) + (played ? 0 : 1)) % 2 === 0
      const opp = OPPONENTS[(gi * 7 + (played ? 3 : 0)) % OPPONENTS.length]
      const vname = mini ? 'Cintra Park' : gi % 4 < 2 ? 'Hawthorne Reserve' : 'Cintra Park'
      const start = atLocal(date, timesHome[gi % timesHome.length])
      const ours = played && !mini ? Math.floor(rnd() * 5) : null
      const theirs = played && !mini ? Math.floor(rnd() * 4) : null
      rows.push({
        academy_id: IW, team_id: team[tname], type: 'match', title: `${tname} v ${opp}`, opponent: opp, was_home: home,
        venue: home ? vname : `${opp} home ground`, venue_id: home ? venue[vname] : null, source: 'manual', round: played ? 'Round 12' : 'Round 13',
        starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 3600e3).toISOString(), arrive_at: new Date(start.getTime() - 1800e3).toISOString(),
        our_score: ours, their_score: theirs, score_entered_at: played && !mini ? new Date(start.getTime() + 4000e3).toISOString() : null,
      })
      gi++
    }
  }
  const { data, error } = await admin.from('events').insert(rows).select('id, team_id, starts_at')
  if (error) throw new Error(`games: ${error.message}`)
  // The club's date, not UTC's: an 8 am Saturday kick-off in Sydney is Friday in UTC.
  for (const g of data) games[`${g.team_id}|${localDate(new Date(g.starts_at)) === nextSat ? 'next' : 'last'}`] = g.id
  // Half the families have answered for Saturday.
  const rsvps = []
  for (const f of families) {
    for (const p of f.parents.slice(0, 1)) for (const k of f.kids) {
      const r = rnd()
      if (r > 0.6) continue
      const ev = Object.entries(games).find(([key]) => key.startsWith(`${team[k.team]}|`) && key.endsWith('next'))?.[1]
      if (!ev) continue
      const status = r > 0.5 ? 'maybe' : r > 0.42 ? 'no' : 'yes'
      rsvps.push({ academy_id: IW, event_id: ev, profile_id: p.id, player_id: player.get(playerKey(team[k.team], k.name)), status, note: status === 'no' ? pick(['Away for the weekend', 'Unwell', 'A birthday party', 'Family commitment']) : null })
    }
  }
  await chunked('event_rsvps', rsvps, 'event_id,profile_id,player_id')
  say(`${rows.length} games: last Saturday played (scores for the squads that keep them), next Saturday to come, ${rsvps.length} answers in`)
}

// --- an extras program, mid-way ----------------------------------------------
{
  const NAME = 'Winter Skills Clinic'
  let { data: prog } = await admin.from('programs').select('id, payment_request_id').eq('academy_id', IW).eq('name', NAME).maybeSingle()
  if (!prog) {
    const { data: pr, error: pe } = await admin.from('payment_requests').insert({ academy_id: IW, title: `${NAME} — Term 3`, description: 'Eight Wednesday sessions with the NPL coaches.', amount_cents: 12000, due_on: shift(today, 10), created_by: PRESIDENT }).select('id').single()
    if (pe) throw new Error(`fee: ${pe.message}`)
    const { data, error } = await admin.from('programs').insert({ academy_id: IW, name: NAME, kind: 'development', status: 'open', season: SEASON, born_from_year: YEAR - 12, born_to_year: YEAR - 9, capacity: 60, starts_on: shift(today, -21), ends_on: shift(today, 35), description: 'Eight Wednesday sessions with the NPL coaches. Places are capped at 60.', payment_request_id: pr.id, created_by: PRESIDENT }).select('id, payment_request_id').single()
    if (error) throw new Error(`program: ${error.message}`)
    prog = data
  }
  await admin.from('program_registrations').delete().eq('program_id', prog.id)
  await admin.from('payments').delete().eq('request_id', prog.payment_request_id)
  const eligible = families.filter((f) => f.kids.some((k) => { const ag = TEAMS.find(([n]) => n === k.team)[1]; const a = ageOf(ag); return a && a >= 9 && a <= 12 })).slice(0, 58)
  const regs = [], pays = []
  for (const [i, f] of eligible.entries()) {
    const k = f.kids.find((k) => { const a = ageOf(TEAMS.find(([n]) => n === k.team)[1]); return a && a >= 9 && a <= 12 })
    const pid = player.get(playerKey(team[k.team], k.name))
    regs.push({ academy_id: IW, program_id: prog.id, player_id: pid, status: i < 50 ? 'approved' : 'pending', submitted_by: f.parents[0].id })
    if (i < 36) pays.push({ academy_id: IW, request_id: prog.payment_request_id, profile_id: f.parents[0].id, player_id: pid, amount_cents: 12000, status: 'paid', paid_at: shift(today, -3 - (i % 12)) })
  }
  await chunked('program_registrations', regs)
  await chunked('payments', pays)
  say(`${NAME}: ${regs.length} registered (${regs.filter((r) => r.status === 'pending').length} waiting), ${pays.length} paid, ${regs.length - pays.length - regs.filter((r) => r.status === 'pending').length} owing`)
}

// --- the Saturday roster, with gaps -------------------------------------------
{
  const { data: old } = await admin.from('events').select('id').eq('academy_id', IW).eq('ground_day', true)
  if (old?.length) await admin.from('events').delete().in('id', old.map((e) => e.id))
  const { data: gd, error } = await admin.from('events').insert({ academy_id: IW, type: 'other', title: `Hawthorne Reserve — Saturday`, venue: 'Hawthorne Reserve', venue_id: venue['Hawthorne Reserve'], ground_day: true, source: 'manual',
    starts_at: atLocal(nextSat, '07:00').toISOString(), ends_at: atLocal(nextSat, '18:00').toISOString() }).select('id').single()
  if (error) throw new Error(`ground day: ${error.message}`)
  const jobs = [['Set-up', '07:00', '08:00', 2], ['Canteen', '08:00', '12:00', 2], ['BBQ', '10:00', '14:00', 2], ['Field marshal', '08:00', '12:00', 1], ['Pack-down', '14:00', '15:00', 2]]
  const { data: made } = await admin.from('event_jobs').insert(jobs.map(([title, start_time, end_time, spots], i) => ({ academy_id: IW, event_id: gd.id, title, start_time, end_time, spots, position: i + 1, created_by: PRESIDENT }))).select('id, title')
  const canteen = made.find((j) => j.title === 'Canteen')
  await admin.from('event_job_helpers').insert([{ job_id: canteen.id, academy_id: IW, profile_id: families[3].parents[0].id, added_by: families[3].parents[0].id }])
  // Duties on six junior squads: rostered for Saturday, one swap asked for.
  const dutyTeams = ['U8 Red', 'U9 Blue', 'U10 Blue', 'U12 Red', 'U13 Black', 'U14 Green']
  await admin.from('team_duties').delete().eq('academy_id', IW)
  await admin.from('event_duties').delete().eq('academy_id', IW)
  await chunked('team_duties', dutyTeams.flatMap((t) => ['Oranges', 'Linesperson', 'Kit wash'].map((title, i) => ({ academy_id: IW, team_id: team[t], title, position: i + 1 }))))
  const duties = []
  for (const t of dutyTeams) {
    const ev = games[`${team[t]}|next`]
    const kids = [...player.entries()].filter(([k]) => k.startsWith(`${team[t]}|`)).map(([, id]) => id)
    ;['Oranges', 'Linesperson', 'Kit wash'].forEach((title, i) => duties.push({ academy_id: IW, event_id: ev, team_id: team[t], title, player_id: kids[i], requested_swap_at: t === 'U12 Red' && i === 0 ? new Date().toISOString() : null, swap_note: t === 'U12 Red' && i === 0 ? 'Away that weekend' : null }))
  }
  await chunked('event_duties', duties)
  say(`Saturday at Hawthorne: ${jobs.length} jobs, one name down; ${dutyTeams.length} squads with duties, one swap asked for`)
}

// --- a little conversation ----------------------------------------------------
{
  const { data: chans } = await admin.from('channels').select('id, type, team_id').eq('academy_id', IW).in('type', ['team', 'academy_wide'])
  const wide = (chans ?? []).find((c) => c.type === 'academy_wide')
  const now = Date.now()
  const day = 864e5
  const msgs = []
  if (wide) {
    const { count } = await admin.from('messages').select('id', { count: 'exact', head: true }).eq('channel_id', wide.id)
    if (!count) {
      msgs.push({ academy_id: IW, channel_id: wide.id, sender_id: PRESIDENT, is_announcement: true, body: 'Winter Skills Clinic places are nearly gone — 50 of 60 taken. Register under Programs.', created_at: new Date(now - 2 * day).toISOString() })
      msgs.push({ is_announcement: false, academy_id: IW, channel_id: wide.id, sender_id: demoId.volunteers, body: 'Canteen and BBQ at Hawthorne this Saturday need hands — open the game page and put your name down.', created_at: new Date(now - 1 * day).toISOString() })
      msgs.push({ is_announcement: false, academy_id: IW, channel_id: wide.id, sender_id: demoId.secretary, body: 'Reminder: the AGM is Tuesday 24 November, 7 pm, in the clubhouse.', created_at: new Date(now - 0.4 * day).toISOString() })
    }
  }
  for (const t of ['U8 Red', 'U10 Blue', 'U12 Red', 'Over-35 A']) {
    const c = (chans ?? []).find((x) => x.team_id === team[t])
    if (!c) continue
    const { count } = await admin.from('messages').select('id', { count: 'exact', head: true }).eq('channel_id', c.id)
    if (count) continue
    const { data: coach } = await admin.from('team_members').select('profile_id').eq('team_id', team[t]).eq('role', 'coach').limit(1).maybeSingle()
    const { data: parentsHere } = await admin.from('team_members').select('profile_id').eq('team_id', team[t]).neq('role', 'coach').limit(3)
    const who = (parentsHere ?? []).map((p) => p.profile_id)
    const sender = coach?.profile_id ?? who[0]
    msgs.push({ is_announcement: false, academy_id: IW, channel_id: c.id, sender_id: sender, body: `Saturday: ${t} are ${t.includes('Over') ? 'at home' : 'on'} — kit is green, be there half an hour before kick-off.`, created_at: new Date(now - 1.5 * day).toISOString() })
    if (who[0]) msgs.push({ is_announcement: false, academy_id: IW, channel_id: c.id, sender_id: who[0], body: 'Thanks coach, we will be there.', created_at: new Date(now - 1.4 * day).toISOString() })
    if (who[1]) msgs.push({ is_announcement: false, academy_id: IW, channel_id: c.id, sender_id: who[1], body: 'Is there parking at Hawthorne or should we use the side street?', created_at: new Date(now - 1.2 * day).toISOString() })
    msgs.push({ is_announcement: false, academy_id: IW, channel_id: c.id, sender_id: sender, body: 'Side street — the car park fills by eight.', created_at: new Date(now - 1.1 * day).toISOString() })
  }
  if (msgs.length) await chunked('messages', msgs)
  say(`${msgs.length} messages in the club chat and four squads' chats`)
}

{
  // Paged: one request answers 1,000 rows at most, and the club has more
  // members than that — the first run of this tidy took everyone past the
  // thousandth for a leftover.
  const inClub = new Set()
  for (let from = 0; ; from += 1000) {
    const { data: members } = await admin.from('academy_members').select('profile_id').eq('academy_id', IW).order('profile_id').range(from, from + 999)
    for (const m of members ?? []) inClub.add(m.profile_id)
    if (!members || members.length < 1000) break
  }
  let gone = 0
  for (const u of byEmail.values()) {
    if (!/^iw\.(parent|adult|coach)\.[^@]+@squadroom\.invalid$/.test(u.email ?? '') || inClub.has(u.id)) continue
    const { error } = await admin.auth.admin.deleteUser(u.id)
    if (!error) gone++
  }
  if (gone) say(`${gone} leftover accounts from earlier runs removed`)
}
const { count: playersN } = await admin.from('players').select('id', { count: 'exact', head: true }).eq('academy_id', IW)
const { count: parentsN } = await admin.from('academy_members').select('profile_id', { count: 'exact', head: true }).eq('academy_id', IW).eq('role', 'parent')
const { count: membersN } = await admin.from('academy_members').select('profile_id', { count: 'exact', head: true }).eq('academy_id', IW)
console.log(`\n  Inner West FC: ${TEAMS.length} squads, ${playersN} players, ${parentsN} parents, ${membersN} members in all; ${made} accounts made this run in ${Math.round((Date.now() - t0) / 1000)}s.`)
console.log(`  Demo logins (password ${PASSWORD}): ${DEMO.map((d) => d.email).join(', ')}\n`)
