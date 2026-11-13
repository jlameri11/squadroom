'use client'

import { useCallback, useEffect, useState } from 'react'
import { AppBar, Screen } from '@/components/app-shell'
import { ScreenSkeleton } from '@/components/screen-skeleton'
import { createClient } from '@/lib/supabase/client'
import { getOrg } from '@/lib/org'
import { WhenOn } from '@/components/when-on'

type Row = {
  request_id: string
  program_id: string
  program_name: string
  guardian_name: string
  guardian_phone: string | null
  guardian_email: string | null
  child_name: string
  child_dob: string
  child_gender: string | null
  answers: Record<string, string> | null
  consents: { id: string; version: number }[] | null
  status: string
  created_at: string
  decided_by: string | null
  decided_at: string | null
  decision_note: string | null
  existing_player_id: string | null
  spots_left: number | null
  /** 0263: the registration photo, in the private bucket, until approved. */
  photo_path?: string | null
  /** 0267: a coach, team manager, volunteer or referee registering themselves, with their WWCC. */
  register_as?: string | null
  wwcc_number?: string | null
  wwcc_expires_on?: string | null
  wwcc_checked_at?: string | null
  role_note?: string | null
  /** 0268: the club's question to the family and their answer; the registration an accepted request became. */
  info_requested_at?: string | null
  info_note?: string | null
  family_reply?: string | null
  family_replied_at?: string | null
  registration_id?: string | null
  registration_status?: string | null
  // R-18
  ffa_number: string | null
  fifa_id: string | null
  requires_official: boolean
  official_confirmed_at: string | null
  existing_official_status: string | null
}

/** R-18: may this request be accepted, as far as PlayFootball goes? */
/** 0267: a coach, team manager, volunteer or referee registering themselves. */
const ROLE_LABEL: Record<string, string> = { player: 'Player', coach: 'Coach', team_manager: 'Team manager', volunteer: 'Volunteer', referee: 'Referee' }
function roleOf(r: Row) {
  return r.register_as ?? 'player'
}
/** A coach, a manager or a referee is approved once the WWCC is ticked as checked on the register. */
function wwccOk(r: Row) {
  const role = roleOf(r)
  return role === 'player' || role === 'volunteer' || Boolean(r.wwcc_checked_at)
}
function dayOf(ymd: string) {
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

function officialOk(r: Row) {
  if (!r.requires_official) return true
  return Boolean(r.official_confirmed_at) || r.existing_official_status === 'registered' || r.existing_official_status === 'not_required'
}

/**
 * Families a club has never met, waiting to hear.
 *
 * Oldest first, because a family who filled in a form on Monday and heard
 * nothing by Saturday has already decided what kind of club this is.
 *
 * Accepting is a bigger decision than approving a join request, so this
 * screen is separate from `/admin/requests` rather than a tab on it: a join
 * request lets somebody into a conversation, and this puts a child on a
 * roster, into a program with a capacity, and starts a relationship with
 * money in it.
 *
 * Three things are surfaced because they change the decision:
 *   · the squad has to be chosen, since that is what puts the family in the
 *     right channels
 *   · whether this child is ALREADY on the roster, so a second guardian does
 *     not create a twin
 *   · how many places are left, so a club does not accept twelve into eight
 */
export function RegistrationQueue() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [refused, setRefused] = useState(false)
  const [tab, setTab] = useState<'pending' | 'decided'>('pending')
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([])
  const [open, setOpen] = useState<string | null>(null)
  // 0263: the open request's photo, by a short signed link the bucket's
  // rules allow the club's staff and nobody else.
  const [photos, setPhotos] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!open) return
    const row = (rows ?? []).find((r) => r.request_id === open)
    if (!row?.photo_path || photos[open]) return
    let live = true
    ;(async () => {
      const { data } = await createClient().storage.from('player-photos').createSignedUrl(row.photo_path!, 600)
      if (live && data?.signedUrl) setPhotos((p) => ({ ...p, [open]: data.signedUrl }))
    })()
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  const [team, setTeam] = useState<Record<string, string>>({})
  // 0267: a team manager's role is scoped to a squad, so one has to be picked.
  const teamOk = (r: Row) => roleOf(r) !== 'team_manager' || Boolean(team[r.request_id])
  const [note, setNote] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [slug, setSlug] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  // Question labels by program, so an answer reads "Which school?: Hunters
  // Hill" and not "q3: Hunters Hill". Answers are stored against the id on
  // purpose — a relabelled question keeps its answers — so the label is
  // looked up at the moment of reading.
  const [labels, setLabels] = useState<Record<string, Record<string, string>>>({})
  // R-07. Registrations open on a Monday night and forty land by Tuesday.
  // One tap each, with the sheet opening and closing between, is the
  // hundred-tap Tuesday this exists to remove.
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkTeam, setBulkTeam] = useState('')
  // 0268: the review — filters, the question to a family, the jersey in the
  // same step as the squad, and deregistering an accepted one.
  const [filterText, setFilterText] = useState('')
  const [filterProgram, setFilterProgram] = useState('')
  const [asking, setAsking] = useState<string | null>(null)
  const [askText, setAskText] = useState<Record<string, string>>({})
  const [number, setNumber] = useState<Record<string, string>>({})
  const [teamSeasons, setTeamSeasons] = useState<Record<string, string>>({})
  const [suggested, setSuggested] = useState<Record<string, number | null>>({})
  const [academyId, setAcademyId] = useState<string | null>(null)
  const [deregFor, setDeregFor] = useState<string | null>(null)
  const [deregReason, setDeregReason] = useState<Record<string, string>>({})
  const [progress, setProgress] = useState<{ done: number; total: number; verb: string } | null>(null)

  const load = useCallback(async () => {
    const supabase = createClient()
    const { data, error } = await supabase.rpc('registration_queue', {
      p_academy: (getOrg() ?? null) as unknown as string,
      p_status: null as unknown as string,
    })
    if (error) return setRefused(true)
    const rows = (data ?? []) as Row[]
    setRows(rows)

    // A role's request has no program (0267).
    const programIds = [...new Set(rows.map((r) => r.program_id).filter((id): id is string => Boolean(id)))]
    if (programIds.length > 0) {
      const { data: programs } = await supabase
        .from('programs')
        .select('id, questions')
        .in('id', programIds)
      const next: Record<string, Record<string, string>> = {}
      for (const p of programs ?? []) {
        const qs = Array.isArray(p.questions) ? (p.questions as { id: string; label: string }[]) : []
        next[p.id] = Object.fromEntries(qs.map((q) => [q.id, q.label]))
      }
      setLabels(next)
    }

    const { data: screen } = await supabase.rpc('import_screen', {
      p_academy: (getOrg() ?? null) as unknown as string,
    })
    const s = screen as unknown as {
      academy?: { id: string } | null
      teams?: { id: string; name: string }[]
    } | null
    setTeams(s?.teams ?? [])

    // Read directly rather than widening import_screen for a second caller.
    // RLS lets a member read their own academy, so this is a one-line select
    // and not a new function to keep in step.
    if (s?.academy?.id) {
      setAcademyId(s.academy.id)
      const [{ data: a }, { data: squads }] = await Promise.all([
        supabase.from('academies').select('slug').eq('id', s.academy.id).maybeSingle(),
        // 0268: the jersey pool is per season, and the season is the squad's.
        supabase.from('teams').select('id, season').eq('academy_id', s.academy.id),
      ])
      setSlug(a?.slug ?? null)
      setTeamSeasons(Object.fromEntries((squads ?? []).map((t) => [t.id, t.season ?? ''])))
    }
  }, [])

  // 0268: the lowest free number in the squad's season, as a hint.
  async function suggestNumber(teamId: string) {
    if (!teamId || !academyId || suggested[teamId] !== undefined) return
    const season = teamSeasons[teamId] || String(new Date().getFullYear())
    const { data } = await createClient().rpc('next_squad_number', { p_academy: academyId, p_season: season })
    setSuggested((s) => ({ ...s, [teamId]: (data as number | null) ?? null }))
  }

  // 0268: a question to the family. The request stays pending; the note is
  // on their page and their dashboard, and their answer comes back here.
  async function askInfo(row: Row, text: string | null) {
    setBusy(row.request_id)
    setError(null)
    const { error } = await createClient().rpc('request_registration_info', { p_request: row.request_id, p_note: text ?? '' })
    setBusy(null)
    if (error) return setError(error.message)
    setAsking(null)
    await load()
  }

  // 0268: after approval it is Deregister (R-15's withdrawal, by the club),
  // with the program's refund policy applied as it is for a family.
  async function deregister(row: Row) {
    if (!row.registration_id) return
    setBusy(row.request_id)
    setError(null)
    const { error } = await createClient().rpc('withdraw_registration', { p_registration: row.registration_id, p_reason: deregReason[row.request_id] || undefined })
    setBusy(null)
    if (error) return setError(error.message)
    setDeregFor(null)
    await load()
  }

  useEffect(() => {
    void load()
  }, [load])

  // 0267: the Working With Children Check, checked on the Service NSW
  // register by somebody at the club — approval of a coach, manager or
  // referee waits on it.
  async function confirmWwcc(row: Row, checked: boolean) {
    setBusy(row.request_id)
    setError(null)
    const { error } = await createClient().rpc('confirm_wwcc_check', { p_request: row.request_id, p_checked: checked })
    setBusy(null)
    if (error) return setError(error.message)
    await load()
  }

  async function confirmOfficial(row: Row, confirmed: boolean) {
    setBusy(row.request_id)
    setError(null)
    const { error } = await createClient().rpc('confirm_official_rego', { p_request: row.request_id, p_confirmed: confirmed })
    setBusy(null)
    if (error) return setError(error.message)
    await load()
  }

  async function decide(row: Row, decision: 'approve' | 'decline') {
    // The row goes the moment the club decides (the "Feels instant" pass):
    // the route behind it writes the account, the player, the squad and the
    // number from a server across the Pacific, and nobody should watch a
    // greyed sheet for that. It comes back, with the reason, if the database
    // said no — a taken number, a missing photo, a check not ticked.
    const was = rows
    setBusy(row.request_id)
    setError(null)
    setOpen(null)
    setRows((prev) => (prev ?? []).filter((r) => r.request_id !== row.request_id))
    const res = await fetch('/api/register/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: row.request_id,
        decision,
        teamId: team[row.request_id] || null,
        note: note[row.request_id] || undefined,
        number: number[row.request_id] || null,
      }),
    }).catch(() => null)
    setBusy(null)
    if (!res || !res.ok) {
      const b = res ? await res.json().catch(() => ({})) : {}
      setRows(was)
      setOpen(row.request_id)
      return setError(`${row.child_name}: ${b.error ?? "that didn't save. Try again."}`)
    }
    await load()
  }

  function toggle(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  /**
   * Many decisions, one squad, one tap.
   *
   * Still one request per registration, through the same route a single
   * accept uses, because that route is the one place an account is made
   * from a stranger's form and a second path doing the same job is how the
   * two drift. Sequential rather than parallel: each one creates a profile
   * and may attach to an existing child, and forty at once is a burst the
   * auth service rate-limits. Progress is shown so forty does not look
   * like a hang.
   */
  async function bulk(decision: 'approve' | 'decline') {
    const ids = (rows ?? []).filter((r) => r.status === 'pending' && selected.has(r.request_id))
    if (ids.length === 0) return
    setError(null)
    const verb = decision === 'approve' ? 'Accepting' : 'Declining'
    const failed: string[] = []
    for (let i = 0; i < ids.length; i++) {
      setProgress({ done: i, total: ids.length, verb })
      const res = await fetch('/api/register/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: ids[i].request_id,
          decision,
          teamId: bulkTeam || null,
        }),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        failed.push(`${ids[i].child_name}: ${b.error ?? res.status}`)
      }
    }
    setProgress(null)
    setSelected(new Set())
    setSelecting(false)
    // Named, one per line, because "3 failed" sends somebody back through
    // the list working out which three.
    if (failed.length) setError(`Could not decide ${failed.length}:\n${failed.join('\n')}`)
    await load()
  }

  if (refused) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
        <AppBar title="Registrations" back="/admin" />
        <Screen>
          <p className="p-6 text-center text-sm text-ink-2">Only a coach can see this.</p>
        </Screen>
      </div>
    )
  }
  if (!rows) return <ScreenSkeleton />

  const pending = rows.filter((r) => r.status === 'pending')
  const decided = rows.filter((r) => r.status !== 'pending')
  // 0268: the filters — a name, a program (or the roles).
  const needle = filterText.trim().toLowerCase()
  const matches = (r: Row) =>
    (!needle || `${r.child_name} ${r.guardian_name} ${r.guardian_phone ?? ''}`.toLowerCase().includes(needle)) &&
    (!filterProgram || (filterProgram === 'roles' ? roleOf(r) !== 'player' : r.program_id === filterProgram))
  const programs = [...new Map(rows.filter((r) => r.program_id).map((r) => [r.program_id as string, r.program_name ?? ''])).entries()]
  const shown = (tab === 'pending' ? pending : decided).filter(matches)

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
      <AppBar
        title="Registrations"
        meta={pending.length === 0 ? 'Nobody waiting' : `${pending.length} waiting`}
        back="/admin"
      />
      <Screen>
        {/* 0259: the registrations as a spreadsheet, a column per question. */}
        {getOrg() && (
          <WhenOn feature="registrations_csv">
            <div className="border-b px-4 py-2.5 text-xs" style={{ borderColor: 'var(--line-2)' }}>
              <a href={`/api/export/registrations?academyId=${getOrg()}`} className="tap font-semibold underline underline-offset-4" data-registrations-csv>
                Download the spreadsheet
              </a>
              <span className="text-ink-3"> — every request, with a column per question (CSV)</span>
            </div>
          </WhenOn>
        )}
        {/* The club's own link, where the club will look for it. A public
            page nobody can find is a public page that does nothing — the
            same reason /programs and /payments were built and reachable
            from nowhere. */}
        {slug && (
          <div className="border-b px-4 py-2.5" style={{ borderColor: 'var(--line-2)' }}>
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 text-sm text-ink-2">Your register link</span>
              <button
                onClick={async () => {
                  const url = `${window.location.origin}/${slug}/register`
                  if (navigator.share) {
                    try {
                      await navigator.share({ title: 'Register', url })
                      return
                    } catch (e) {
                      // Dismissing the share sheet throws AbortError. Not a
                      // failure, and must not be reported as one.
                      if ((e as Error)?.name === 'AbortError') return
                    }
                  }
                  try {
                    await navigator.clipboard.writeText(url)
                    setCopied(true)
                  } catch {
                    setCopied(true)
                  }
                }}
                className="flex-none rounded-lg border px-3 py-1.5 text-xs font-semibold"
                style={{ borderColor: 'var(--brand)', color: 'var(--brand-text)' }}
              >
                {copied ? 'Copied' : 'Share'}
              </button>
            </div>
            {/* The link in plain text as well, because a copy button that
                silently fails is how somebody ends up reading a URL down the
                phone. */}
            <a
              href={`/${slug}/register`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-0.5 block truncate text-xs text-ink-3 underline underline-offset-2"
            >
              /{slug}/register
            </a>
          </div>
        )}

        <div className="flex gap-2 px-3.5 pt-3">
          {(
            [
              ['pending', `Waiting${pending.length ? ` · ${pending.length}` : ''}`],
              ['decided', 'Decided'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              aria-pressed={tab === value}
              className="rounded-full border px-3 py-1.5 text-xs font-semibold"
              style={
                tab === value
                  ? {
                      borderColor: 'var(--brand)',
                      background: 'var(--brand-faint)',
                      color: 'var(--brand-text)',
                    }
                  : { borderColor: 'var(--line)', color: 'var(--ink-2)' }
              }
            >
              {label}
            </button>
          ))}
          <span className="flex-1" />
          {tab === 'pending' && pending.length > 1 && (
            <button
              onClick={() => {
                setSelecting(!selecting)
                setSelected(new Set())
              }}
              aria-pressed={selecting}
              className="rounded-full border px-3 py-1.5 text-xs font-semibold"
              style={
                selecting
                  ? { borderColor: 'var(--brand)', background: 'var(--brand-faint)', color: 'var(--brand-text)' }
                  : { borderColor: 'var(--line)', color: 'var(--ink-2)' }
              }
            >
              {selecting ? 'Done' : 'Select'}
            </button>
          )}
        </div>

        {/* 0268: the filters. Shown once there is anything to filter. */}
        {rows.length >= 2 && (
          <div className="flex gap-2 px-3.5 pt-2" data-filters>
            <input
              type="search"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Name or mobile"
              aria-label="Filter by name or mobile"
              className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--line)' }}
              data-filter-text
            />
            {(programs.length > 1 || rows.some((r) => roleOf(r) !== 'player')) && (
              <select
                value={filterProgram}
                onChange={(e) => setFilterProgram(e.target.value)}
                aria-label="Filter by program"
                className="min-w-0 max-w-[45%] rounded-lg border px-2 py-2 text-sm"
                style={{ borderColor: 'var(--line)' }}
                data-filter-program
              >
                <option value="">Everything</option>
                {programs.map(([id, name]) => (
                  <option key={id} value={id}>{name}</option>
                ))}
                {rows.some((r) => roleOf(r) !== 'player') && <option value="roles">Coaches, managers, volunteers, referees</option>}
              </select>
            )}
          </div>
        )}

        {selecting && tab === 'pending' && (
          <div className="card mx-3.5 mt-3 p-3">
            <div className="flex items-center gap-2 text-sm">
              <b className="flex-1">
                {selected.size === 0
                  ? 'Tick the ones to decide'
                  : `${selected.size} of ${pending.length} selected`}
              </b>
              <button
                onClick={() =>
                  setSelected(
                    selected.size === pending.length
                      ? new Set()
                      : new Set(pending.map((r) => r.request_id))
                  )
                }
                className="text-xs underline underline-offset-4"
                style={{ color: 'var(--brand-text)' }}
              >
                {selected.size === pending.length ? 'None' : 'All'}
              </button>
            </div>
            {selected.size > 0 && (
              <>
                <select
                  value={bulkTeam}
                  onChange={(e) => setBulkTeam(e.target.value)}
                  className="mt-2 w-full rounded-lg border px-3 py-2.5 text-sm"
                  style={{ borderColor: 'var(--line)' }}
                  aria-label="Squad for everyone selected"
                >
                  <option value="">Decide the squad later</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      Put them all in {t.name}
                    </option>
                  ))}
                </select>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => void bulk('approve')}
                    disabled={progress !== null}
                    className="flex-1 rounded-lg px-3 py-2.5 text-sm font-semibold text-yes-ink disabled:opacity-50"
                    style={{ background: 'var(--yes)' }}
                  >
                    {progress
                      ? `${progress.verb} ${progress.done + 1} of ${progress.total}…`
                      : `Accept ${selected.size}`}
                  </button>
                  <button
                    onClick={() => void bulk('decline')}
                    disabled={progress !== null}
                    className="rounded-lg border px-3 py-2.5 text-sm font-semibold disabled:opacity-50"
                    style={{ borderColor: 'var(--no)', color: 'var(--no)' }}
                  >
                    Decline {selected.size}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {error && (
          <p
            className="mx-3.5 mt-3 rounded-lg border p-3 text-sm"
            style={{ borderColor: 'var(--no)', color: 'var(--no)' }}
          >
            {error}
          </p>
        )}

        {shown.length === 0 ? (
          <p className="p-6 text-center text-sm text-ink-3">
            {tab === 'pending'
              ? 'Nothing waiting. Share the link above and they will land here.'
              : 'Nothing decided yet.'}
          </p>
        ) : (
          <div className="mt-2">
            {shown.map((r) => (
              <div key={r.request_id} className="border-b" style={{ borderColor: 'var(--line-2)' }}>
                <div className="flex items-stretch">
                {selecting && r.status === 'pending' && (
                  <label className="flex flex-none items-center pl-4">
                    <input
                      type="checkbox"
                      aria-label={`Select ${r.child_name}`}
                      checked={selected.has(r.request_id)}
                      onChange={() => toggle(r.request_id)}
                      className="h-5 w-5"
                    />
                  </label>
                )}
                <button
                  onClick={() =>
                    selecting && r.status === 'pending'
                      ? toggle(r.request_id)
                      : setOpen(open === r.request_id ? null : r.request_id)
                  }
                  className="min-w-0 flex-1 px-4 py-3 text-left"
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {r.child_name}
                      {roleOf(r) !== 'player' && (
                        <span className="ml-2 rounded-full px-2.5 py-1 align-middle text-xs font-semibold" style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }} data-register-as={roleOf(r)}>
                          {ROLE_LABEL[roleOf(r)] ?? roleOf(r)}
                        </span>
                      )}
                      {/* 0268: the question is out, or answered. */}
                      {r.status === 'pending' && r.info_requested_at && (
                        <span
                          className="ml-2 rounded-full px-2.5 py-1 align-middle text-xs font-semibold"
                          style={r.family_reply ? { background: 'var(--yes-bg)', color: 'var(--yes)' } : { background: 'var(--accent)', color: 'var(--accent-ink)' }}
                          data-info-state={r.family_reply ? 'replied' : 'asked'}
                        >
                          {r.family_reply ? 'Replied' : 'Asked for info'}
                        </span>
                      )}
                    </span>
                    <span className="flex-none text-xs text-ink-3">{ago(r.created_at)}</span>
                  </span>
                  <span className="block truncate text-sm text-ink-2">
                    {r.program_name ?? `Registering as ${(ROLE_LABEL[roleOf(r)] ?? roleOf(r)).toLowerCase()}`} · born {r.child_dob.slice(0, 4)}
                  </span>
                  <span className="block truncate text-xs text-ink-3">
                    {r.guardian_name}
                    {r.guardian_phone ? ` · ${r.guardian_phone}` : ''}
                  </span>
                  {r.status !== 'pending' && (
                    <span
                      className="mt-0.5 block text-xs font-semibold"
                      style={{ color: r.status === 'approved' ? 'var(--yes)' : 'var(--no)' }}
                    >
                      {r.status === 'approved' ? (r.registration_status === 'withdrawn' ? 'Accepted, then deregistered' : 'Accepted') : 'Declined'}
                      {r.decided_by ? ` by ${r.decided_by}` : ''}
                      {r.decision_note ? ` — ${r.decision_note}` : ''}
                    </span>
                  )}
                </button>
                </div>

                {open === r.request_id && (
                  <div className="px-4 pb-4">
                    {/* The one fact that changes the decision most: this may
                        not be a new child at all, but a second guardian
                        registering one already here. */}
                    {r.existing_player_id && (
                      <p
                        className="rounded-lg border p-2.5 text-xs"
                        style={{ borderColor: 'var(--maybe)', color: 'var(--maybe)' }}
                      >
                        A child with this name and date of birth is already on your roster.
                        Accepting attaches this parent to that child rather than creating a
                        second one.
                      </p>
                    )}

                    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                      <dt className="text-ink-2">Born</dt>
                      <dd className="tabular-nums">{r.child_dob}</dd>
                      {r.child_gender && (
                        <>
                          <dt className="text-ink-2">Gender</dt>
                          <dd>{r.child_gender}</dd>
                        </>
                      )}
                      {r.guardian_email && (
                        <>
                          <dt className="text-ink-2">Email</dt>
                          <dd className="truncate">{r.guardian_email}</dd>
                        </>
                      )}
                      <dt className="text-ink-2">Agreed</dt>
                      <dd>
                        {(r.consents ?? []).length} document
                        {(r.consents ?? []).length === 1 ? '' : 's'}
                      </dd>
                      {r.spots_left != null && (
                        <>
                          <dt className="text-ink-2">Places</dt>
                          <dd>{r.spots_left} left</dd>
                        </>
                      )}
                    </dl>

                    {r.photo_path && (
                      <div className="mt-2 flex items-center gap-3" data-request-photo={photos[r.request_id] ? 'shown' : 'loading'}>
                        {photos[r.request_id] ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={photos[r.request_id]} alt="" className="h-24 w-[72px] rounded-md object-cover" style={{ border: '1px solid var(--line)' }} />
                        ) : (
                          <div className="h-24 w-[72px] rounded-md" style={{ background: 'var(--surface-2)' }} />
                        )}
                        <span className="text-xs text-ink-3">The photo for the card and the referee&apos;s sheet. Only the club sees it until you accept.</span>
                      </div>
                    )}
                    {Object.entries(r.answers ?? {}).length > 0 && (
                      <ul className="mt-2 flex flex-col gap-0.5 text-sm">
                        {Object.entries(r.answers ?? {}).map(([k, v]) => (
                          <li key={k} className="text-ink-2">
                            <span className="text-ink-3">{labels[r.program_id]?.[k] ?? k}:</span>{' '}
                            {String(v)}
                          </li>
                        ))}
                      </ul>
                    )}

                    {/* 0267: the Working With Children Check, and the club's tick that it was checked on the register. */}
                    {roleOf(r) !== 'player' && (
                      <div className="mt-3 rounded-lg p-2.5 text-sm" style={{ background: 'var(--surface-2)' }} data-wwcc-block>
                        <span className="block text-xs text-ink-3">Working With Children Check</span>
                        <span className="block">
                          {r.wwcc_number ? `${r.wwcc_number}${r.wwcc_expires_on ? ` · expires ${dayOf(r.wwcc_expires_on)}` : ''}` : 'No number given'}
                        </span>
                        {r.role_note && <span className="block text-xs text-ink-2">“{r.role_note}”</span>}
                        {r.wwcc_number &&
                          (r.wwcc_checked_at ? (
                            <span className="mt-1 flex items-center gap-2">
                              <span className="pill" style={{ background: 'var(--yes-bg)', color: 'var(--yes)' }}>Checked on the register</span>
                              {r.status === 'pending' && (
                                <button onClick={() => void confirmWwcc(r, false)} disabled={busy === r.request_id} className="text-xs underline underline-offset-2 text-ink-3">
                                  undo
                                </button>
                              )}
                            </span>
                          ) : (
                            <span className="mt-1 flex items-center gap-2">
                              <span className="pill" style={{ background: 'var(--no-bg)', color: 'var(--no)' }}>Not checked</span>
                              {r.status === 'pending' && (
                                <button onClick={() => void confirmWwcc(r, true)} disabled={busy === r.request_id} className="rounded-lg border px-2 py-1 text-xs font-semibold disabled:opacity-50" style={{ borderColor: 'var(--line)' }} data-wwcc-check>
                                  I checked the WWCC register — cleared
                                </button>
                              )}
                            </span>
                          ))}
                      </div>
                    )}

                    {(r.requires_official || r.ffa_number || r.fifa_id) && (
                      <div className="mt-3 rounded-lg p-2.5 text-sm" style={{ background: 'var(--surface-2)' }}>
                        <span className="block text-xs text-ink-3">PlayFootball</span>
                        <span className="block">
                          {[r.ffa_number && `FFA ${r.ffa_number}`, r.fifa_id && `FIFA ID ${r.fifa_id}`].filter(Boolean).join(' · ') || 'No number given'}
                        </span>
                        {r.requires_official && (
                          officialOk(r) ? (
                            <span className="mt-1 flex items-center gap-2">
                              <span className="pill" style={{ background: 'var(--yes-bg)', color: 'var(--yes)' }}>
                                {r.official_confirmed_at ? 'Registration confirmed' : 'On the roster as registered'}
                              </span>
                              {r.status === 'pending' && r.official_confirmed_at && (
                                <button onClick={() => void confirmOfficial(r, false)} disabled={busy === r.request_id} className="text-xs underline underline-offset-2 text-ink-3">
                                  undo
                                </button>
                              )}
                            </span>
                          ) : (
                            <span className="mt-1 flex items-center gap-2">
                              <span className="pill" style={{ background: 'var(--no-bg)', color: 'var(--no)' }}>Not confirmed</span>
                              {r.status === 'pending' && (
                                <button onClick={() => void confirmOfficial(r, true)} disabled={busy === r.request_id} className="rounded-lg border px-2 py-1 text-xs font-semibold disabled:opacity-50" style={{ borderColor: 'var(--line)' }}>
                                  I checked PlayFootball — registered
                                </button>
                              )}
                            </span>
                          )
                        )}
                      </div>
                    )}

                    {/* 0268: the question to the family, and their answer. */}
                    {r.info_requested_at && (
                      <div className="mt-3 rounded-lg p-2.5 text-sm" style={{ background: 'var(--surface-2)' }} data-info-block={r.family_reply ? 'replied' : 'asked'}>
                        <span className="block text-xs text-ink-3">You asked {dayOf(r.info_requested_at)}</span>
                        <span className="block">“{r.info_note}”</span>
                        {r.family_reply ? (
                          <span className="mt-1 block">
                            <span className="text-xs text-ink-3">They replied{r.family_replied_at ? ` ${dayOf(r.family_replied_at)}` : ''}: </span>“{r.family_reply}”
                          </span>
                        ) : (
                          <span className="mt-1 block text-xs text-ink-3">No reply yet. They see it on the page they registered from, and on their My registrations.</span>
                        )}
                        {r.status === 'pending' && (
                          <button onClick={() => void askInfo(r, null)} disabled={busy === r.request_id} className="mt-1 text-xs underline underline-offset-2 text-ink-3">
                            take the question back
                          </button>
                        )}
                      </div>
                    )}

                    {/* 0268: after approval it is Deregister, not Reject. */}
                    {r.status === 'approved' && r.registration_id && (
                      r.registration_status === 'withdrawn' ? (
                        <span className="mt-3 inline-block rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }} data-deregistered>
                          Deregistered
                        </span>
                      ) : deregFor === r.request_id ? (
                        <div className="mt-3 rounded-lg border p-2.5" style={{ borderColor: 'var(--no)' }} data-deregister-form>
                          <p className="text-xs text-ink-2">
                            Takes {r.child_name} off the program and the squad&apos;s roll. The program&apos;s refund policy applies, as it does when a family withdraws.
                          </p>
                          <input
                            value={deregReason[r.request_id] ?? ''}
                            onChange={(e) => setDeregReason({ ...deregReason, [r.request_id]: e.target.value })}
                            placeholder="Why (the family sees this)"
                            className="mt-2 w-full rounded-lg border px-3 py-2 text-base"
                            style={{ borderColor: 'var(--line)' }}
                            data-deregister-reason
                          />
                          <div className="mt-2 flex gap-2">
                            <button onClick={() => void deregister(r)} disabled={busy === r.request_id} className="flex-1 rounded-lg px-3 py-2 text-sm font-semibold text-no-ink disabled:opacity-50" style={{ background: 'var(--no)' }} data-deregister-send>
                              {busy === r.request_id ? 'Working…' : 'Deregister'}
                            </button>
                            <button onClick={() => setDeregFor(null)} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--line)' }}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => setDeregFor(r.request_id)} className="mt-3 rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: 'var(--no)', color: 'var(--no)' }} data-deregister>
                          Deregister
                        </button>
                      )
                    )}

                    {r.status === 'pending' && (
                      <>
                        <label className="mt-3 block text-sm">
                          <span className="text-ink-2">
                            {roleOf(r) === 'coach' ? 'Which squad do they coach?' : roleOf(r) === 'team_manager' ? 'Which squad do they manage?' : 'Which squad?'}
                          </span>
                          <select
                            value={team[r.request_id] ?? ''}
                            onChange={(e) => {
                              setTeam({ ...team, [r.request_id]: e.target.value })
                              void suggestNumber(e.target.value)
                            }}
                            className="mt-0.5 w-full rounded-lg border px-3 py-2.5 text-sm"
                            style={{ borderColor: 'var(--line)' }}
                            data-squad-select
                          >
                            <option value="">{roleOf(r) === 'team_manager' ? 'Pick a squad' : 'Decide later'}</option>
                            {teams.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name}
                              </option>
                            ))}
                          </select>
                          {/* Said out loud, because a club that leaves this
                              blank will wonder why the family cannot see
                              anything. */}
                          <span className="mt-0.5 block text-xs text-ink-3">
                            Choosing one now puts the family in that squad&apos;s chat and its
                            fixtures. Left blank, they are in the club but see nothing yet.
                          </span>
                        </label>

                        {/* 0268: the jersey, in the same step as the squad; one pool per season (0085). */}
                        {roleOf(r) === 'player' && team[r.request_id] && (
                          <label className="mt-2 block text-sm">
                            <span className="text-ink-2">Squad number</span>
                            <input
                              value={number[r.request_id] ?? ''}
                              onChange={(e) => setNumber({ ...number, [r.request_id]: e.target.value.replace(/\D/g, '').slice(0, 2) })}
                              inputMode="numeric"
                              placeholder={suggested[team[r.request_id]] ? `${suggested[team[r.request_id]]} is free` : 'Leave blank for now'}
                              className="mt-0.5 w-full rounded-lg border px-3 py-2.5 text-base tabular-nums"
                              style={{ borderColor: 'var(--line)' }}
                              data-number
                            />
                            <span className="mt-0.5 block text-xs text-ink-3">One pool per season across every age group: a number any squad holds is taken.</span>
                          </label>
                        )}

                        <input
                          value={note[r.request_id] ?? ''}
                          onChange={(e) => setNote({ ...note, [r.request_id]: e.target.value })}
                          placeholder="A note for your own records"
                          className="mt-2 w-full rounded-lg border px-3 py-2.5 text-base"
                          style={{ borderColor: 'var(--line)' }}
                        />

                        <div className="mt-2 flex gap-2">
                          <button
                            onClick={() => void decide(r, 'approve')}
                            disabled={busy === r.request_id || !officialOk(r) || !wwccOk(r) || !teamOk(r)}
                            title={!officialOk(r) ? 'Confirm the PlayFootball registration first' : !wwccOk(r) ? 'Check the Working With Children Check on the register first' : !teamOk(r) ? 'Pick the squad they manage' : undefined}
                            className="flex-1 rounded-lg px-3 py-2.5 text-sm font-semibold text-yes-ink disabled:opacity-50"
                            style={{ background: 'var(--yes)' }}
                            data-accept
                          >
                            {busy === r.request_id ? 'Working…' : !officialOk(r) ? 'Accept (PlayFootball first)' : !wwccOk(r) ? 'Accept (check the WWCC first)' : !teamOk(r) ? 'Accept (pick a squad)' : 'Accept'}
                          </button>
                          <button
                            onClick={() => void decide(r, 'decline')}
                            disabled={busy === r.request_id}
                            className="rounded-lg border px-3 py-2.5 text-sm font-semibold disabled:opacity-50"
                            style={{ borderColor: 'var(--no)', color: 'var(--no)' }}
                          >
                            Decline
                          </button>
                        </div>

                        {/* 0268: Needs info — a sentence back to the family, the request still waiting. */}
                        {asking === r.request_id ? (
                          <div className="mt-2 rounded-lg border p-2.5" style={{ borderColor: 'var(--accent)' }} data-info-form>
                            <textarea
                              value={askText[r.request_id] ?? ''}
                              onChange={(e) => setAskText({ ...askText, [r.request_id]: e.target.value })}
                              rows={2}
                              placeholder="What do you need from them?"
                              aria-label="What do you need from the family?"
                              className="w-full rounded-lg border px-3 py-2 text-base"
                              style={{ borderColor: 'var(--line)' }}
                              data-info-text
                            />
                            <div className="mt-2 flex gap-2">
                              <button
                                onClick={() => void askInfo(r, askText[r.request_id] ?? '')}
                                disabled={busy === r.request_id || !(askText[r.request_id] ?? '').trim()}
                                className="flex-1 rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50"
                                style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
                                data-info-send
                              >
                                Send to the family
                              </button>
                              <button onClick={() => setAsking(null)} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--line)' }}>
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => setAsking(r.request_id)}
                            disabled={busy === r.request_id}
                            className="mt-2 w-full rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50"
                            style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
                            data-needs-info
                          >
                            {r.info_requested_at ? 'Ask something else' : 'Needs info'}
                          </button>
                        )}

                        {r.guardian_phone && (
                          <a
                            href={`tel:${r.guardian_phone}`}
                            className="mt-2 block rounded-lg border py-2 text-center text-sm"
                            style={{ borderColor: 'var(--line)' }}
                          >
                            Ring {r.guardian_name}
                          </a>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Screen>
    </div>
  )
}

function ago(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 60) return `${Math.max(mins, 0)}m`
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h`
  return `${Math.round(mins / 1440)}d`
}
