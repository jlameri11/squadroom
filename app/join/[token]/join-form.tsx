'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Stage = 'form' | 'pending' | 'done'

/**
 * The join request, for somebody signed in (the sign-up brief, 12 Nov 2026):
 * the account already says who they are, so this asks only what the account
 * does not know — the children's names and birthdays (or, on an adult team's
 * link, their own date of birth), whether they would like to help, and the
 * news opt-in. The coach approves, and they are in: no claim, no second
 * step, nothing repeated.
 */
export function JoinForm({
  token,
  academyName,
  teamName,
  teamId = null,
  squads = [],
  role = 'parent',
  account,
  pendingRequestId = null,
}: {
  token: string
  academyName: string
  teamName: string | null
  /** 0256: the link's squad, the first one ticked when they offer to help a squad. */
  teamId?: string | null
  /** 0256: the club's squads by name, to coach, manage or help. */
  squads?: { id: string; name: string }[]
  /** The link's role (0239): 'player' is an adult team's link — the person joins as themselves. */
  role?: string
  /** The signed-in person, from their account. */
  account: { fullName: string }
  /** A request this person already made on this link and is still waiting on. */
  pendingRequestId?: string | null
}) {
  const asPlayer = role === 'player'
  const router = useRouter()
  const [stage, setStage] = useState<Stage>(pendingRequestId ? 'pending' : 'form')
  const [requestId, setRequestId] = useState<string | null>(pendingRequestId)
  // Never pre-ticked, never required (Joey, 5 Nov 2026).
  const [news, setNews] = useState(false)
  // Each child by name and birthday (0248): the birthday is what finds them
  // on a roster the club has already imported, so nobody is added twice.
  const [kids, setKids] = useState<{ name: string; dob: string }[]>([{ name: '', dob: '' }])
  const [dob, setDob] = useState('')
  // 0256: what they would like to be, if anything — filed as a role request
  // for the committee once they are in.
  const [wantedRole, setWantedRole] = useState('')
  const [wantedNote, setWantedNote] = useState('')
  const [wantedTeams, setWantedTeams] = useState<string[]>(teamId ? [teamId] : [])
  const squadRole = wantedRole === 'coach' || wantedRole === 'team_manager' || wantedRole === 'volunteer'
  const needsSquad = (wantedRole === 'coach' || wantedRole === 'team_manager') && wantedTeams.length === 0
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)

    const res = await fetch('/api/join/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        news,
        children: asPlayer ? [] : kids.filter((k) => k.name.trim()).map((k) => ({ name: k.name.trim(), dob: k.dob || null })),
        dob: asPlayer ? dob : undefined,
        wantedRole: wantedRole || undefined,
        wantedNote: wantedRole && wantedNote.trim() ? wantedNote.trim() : undefined,
        wantedTeams: squadRole ? wantedTeams : undefined,
      }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)

    if (res.status === 401) {
      router.replace(`/signin?next=${encodeURIComponent(`/join/${token}`)}`)
      return
    }
    if (!res.ok) return setError(data.error ?? 'Something went wrong.')

    setRequestId(data.requestId)
    setStage('pending')
  }

  async function checkApproval() {
    if (!requestId) return setError('Start again — this browser lost the request.')
    setBusy(true)
    setError(null)
    const res = await fetch('/api/join/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId }),
    })
    setBusy(false)

    if (res.status === 202) return setError('Not yet — your coach hasn’t approved it.')
    if (!res.ok) return setError('That didn’t work. Ask your coach to check.')

    setStage('done')
    router.replace('/')
    router.refresh()
  }

  if (stage === 'pending') {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6" data-join-pending>
        <h1 className="text-2xl font-semibold">Waiting for your coach</h1>
        <p className="text-sm text-ink-2">
          They&apos;ll see that you asked to join {teamName ?? academyName} and tap approve. You can
          close this — come back any time.
        </p>
        {error && <p className="text-sm ">{error}</p>}
        <button
          onClick={checkApproval}
          disabled={busy}
          className="rounded-xl bg-[var(--brand)] px-4 py-3 font-medium text-brand-ink disabled:opacity-50"
          data-join-check
        >
          {busy ? 'Checking…' : 'Check again'}
        </button>
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 p-6" data-join-form>
      <div>
        <h1 className="text-2xl font-semibold">Join {teamName ?? academyName}</h1>
        <p className="mt-1 text-sm text-ink-2">
          {academyName}
          {account.fullName ? ` · as ${account.fullName}` : ''}
        </p>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-4">
        {asPlayer ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-2">Your date of birth</span>
            <input
              required
              type="date"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              className="rounded-xl border border-[var(--line)] px-3 py-3"
              autoComplete="bday"
              data-join-dob
            />
            <span className="text-xs text-ink-3">You join as a player yourself. Under 18? Ask a parent to join through the family link instead.</span>
          </label>
        ) : (
          <fieldset className="flex flex-col gap-2.5" data-join-children>
            <legend className="text-xs font-semibold uppercase tracking-wide text-ink-2">
              Your children in this team
            </legend>
            {kids.map((k, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,9.5rem)] gap-2">
                <input
                  value={k.name}
                  onChange={(e) => setKids(kids.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                  className="min-w-0 rounded-xl border border-[var(--line)] px-3 py-3"
                  placeholder={i === 0 ? 'Leo Whitfield' : 'Another child'}
                  aria-label={`Child ${i + 1}'s name`}
                  data-join-child-name
                />
                <input
                  type="date"
                  value={k.dob}
                  onChange={(e) => setKids(kids.map((x, j) => (j === i ? { ...x, dob: e.target.value } : x)))}
                  required={Boolean(k.name.trim())}
                  className="min-w-0 rounded-xl border border-[var(--line)] px-3 py-3"
                  aria-label={`Child ${i + 1}'s date of birth`}
                  data-join-child-dob
                />
              </div>
            ))}
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs text-ink-3">
                Name and birthday as the club has them, so they are matched to the roster rather than added twice.
              </span>
              <button
                type="button"
                onClick={() => setKids([...kids, { name: '', dob: '' }])}
                className="tap flex-none text-xs font-semibold underline underline-offset-4"
                data-join-add-child
              >
                Add another
              </button>
            </div>
          </fieldset>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-2">Would you like to help? <span className="font-normal normal-case tracking-normal text-ink-3">(optional)</span></span>
          <select value={wantedRole} onChange={(e) => setWantedRole(e.target.value)} className="rounded-xl border border-[var(--line)] bg-transparent px-3 py-3" data-join-wanted-role>
            <option value="">Not just now</option>
            <option value="coach">Coach</option>
            <option value="team_manager">Team manager</option>
            <option value="volunteer">Volunteer</option>
            <option value="referee">Referee</option>
            <optgroup label="The committee">
              <option value="president">President</option>
              <option value="secretary">Secretary</option>
              <option value="registrar">Registrar</option>
              <option value="treasurer">Treasurer</option>
              <option value="welfare_officer">Welfare officer</option>
            </optgroup>
          </select>
          {squadRole && squads.length > 0 && (
            <div className="flex flex-wrap gap-1.5" data-join-wanted-squads>
              {squads.map((s) => {
                const on = wantedTeams.includes(s.id)
                return (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setWantedTeams(on ? wantedTeams.filter((x) => x !== s.id) : [...wantedTeams, s.id])}
                    className="rounded-full border px-3 py-1.5 text-xs font-semibold"
                    style={on ? { background: 'var(--brand)', color: 'var(--brand-ink)', borderColor: 'var(--brand)' } : { borderColor: 'var(--line)' }}
                    data-join-wanted-squad={s.id}
                  >
                    {s.name}
                  </button>
                )
              })}
            </div>
          )}
          {wantedRole && (
            <>
              <input
                value={wantedNote}
                onChange={(e) => setWantedNote(e.target.value)}
                maxLength={500}
                placeholder="A line about you — experience, the days you can do"
                className="rounded-xl border border-[var(--line)] px-3 py-3"
                data-join-wanted-note
              />
              <span className="text-xs text-ink-3">
                {needsSquad ? 'Tick the squad first. ' : ''}The committee comes back to you once you are in. Coaches, managers and referees need a current Working With Children Check.
              </span>
            </>
          )}
        </label>

        <label className="flex items-start gap-2.5 text-sm text-ink-2">
          <input
            type="checkbox"
            checked={news}
            onChange={(e) => setNews(e.target.checked)}
            className="mt-0.5 h-4 w-4 flex-none"
            data-news-opt-in
          />
          <span>Send me news and offers from Squadroom <span className="text-ink-3">(optional)</span></span>
        </label>

        {error && <p className="text-sm ">{error}</p>}

        <button
          type="submit"
          disabled={busy || needsSquad}
          className="rounded-xl bg-[var(--brand)] px-4 py-3 font-medium text-brand-ink disabled:opacity-50"
          data-join-submit
        >
          {busy ? 'Sending…' : 'Request to join'}
        </button>
        <p className="text-center text-xs text-ink-2">
          Your coach approves you, and you&apos;re in.
        </p>
      </form>
    </main>
  )
}
