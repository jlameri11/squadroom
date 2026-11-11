'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`
const SYDNEY = 'Australia/Sydney'
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: SYDNEY }) : '')

type Request = {
  id: string
  club_name: string
  team_name: string
  division: string | null
  contact_name: string
  contact_phone: string | null
  contact_email: string | null
  note: string | null
  status: 'pending' | 'accepted' | 'declined'
  created_at: string
  token: string | null
  /** 0261: a captain's team — no club; how many; who pays. */
  captain?: boolean
  squad_size?: number | null
  pay_mode?: 'split' | 'captain' | null
}
type CaptainTeam = { entry_id: string; team_id: string; team_name: string; division: string; join_code: string; pay_mode: string | null; squad_size: number | null; members: number; captain: string | null; contact: string | null }
/** B-09 (0230): the league's levy per registered player, and each club's statement. */
type LevyLine = { division: string; players: number; levy_cents: number | null; owed_cents: number }
type LevyPayment = { id: string; amount_cents: number; method: string; paid_on: string; note: string | null }
type ClubLevy = { club_id: string; club: string; players: number; owed_cents: number; paid_cents: number; balance_cents: number; lines: LevyLine[]; payments: LevyPayment[] }
type Levy = { levies: { division: string; levy_cents: number; instructions: string | null }[]; clubs: ClubLevy[] }

type Fees = {
  fees: { division: string; fee_cents: number; instructions: string | null }[]
  entries: { fee_id: string; entry_id: string; team: string; division: string; club: string | null; claimed: boolean; amount_cents: number; status: 'owed' | 'paid' | 'waived'; paid_at: string | null; method: string | null; note: string | null }[]
  owed_cents: number
  paid_cents: number
}

/**
 * L-02 / L-16, the organiser's side: open or close entries from the public
 * page, decide the teams that asked (accept hands back the join link),
 * set entry fees per division with the league's own payment instructions,
 * and record who has paid.
 */
export function EntriesAndFees({ competitionId, divisions, entriesOpen }: { competitionId: string; divisions: string[]; entriesOpen: boolean }) {
  const [open, setOpen] = useState(entriesOpen)
  const [requests, setRequests] = useState<Request[]>([])
  const [fees, setFees] = useState<Fees | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [pick, setPick] = useState<Record<string, string>>({})
  const [copied, setCopied] = useState<string | null>(null)
  const [showFees, setShowFees] = useState(false)
  const [feeDraft, setFeeDraft] = useState({ division: '', dollars: '', instructions: '' })
  const [levy, setLevy] = useState<Levy | null>(null)
  const [showLevy, setShowLevy] = useState(false)
  const [levyDraft, setLevyDraft] = useState({ division: '', dollars: '', instructions: '' })
  const [payFor, setPayFor] = useState<string | null>(null)
  const [payDraft, setPayDraft] = useState({ dollars: '', method: 'bank', note: '' })

  const [captainTeams, setCaptainTeams] = useState<CaptainTeam[]>([])
  const [slug, setSlug] = useState<string | null>(null)

  const load = useCallback(async () => {
    const client = createClient()
    const [r, f, l, ct, c] = await Promise.all([
      client.rpc('entry_requests', { p_competition: competitionId }),
      client.rpc('competition_fees_view', { p_competition: competitionId }),
      client.rpc('levy_statement', { p_competition: competitionId }),
      client.rpc('captain_teams', { p_competition: competitionId }),
      client.from('competitions').select('public_slug').eq('id', competitionId).maybeSingle(),
    ])
    if (r.error) return setError(r.error.message)
    setRequests((r.data as unknown as Request[] | null) ?? [])
    setFees((f.data as unknown as Fees | null) ?? null)
    setLevy(l.error ? null : ((l.data as unknown as Levy | null) ?? null))
    setCaptainTeams((ct.data as unknown as CaptainTeam[] | null) ?? [])
    setSlug(c.data?.public_slug ?? null)
  }, [competitionId])

  useEffect(() => {
    ;(async () => {
      await load()
    })()
  }, [load])

  async function toggleOpen(next: boolean) {
    setBusy('open')
    const { error } = await createClient().from('competitions').update({ entries_open: next }).eq('id', competitionId)
    setBusy(null)
    if (error) return setError(error.message)
    setOpen(next)
  }

  async function decide(r: Request, accept: boolean) {
    setBusy(r.id)
    setError(null)
    const { error } = await createClient().rpc('decide_entry_request', {
      p_request: r.id,
      p_accept: accept,
      p_division: pick[r.id] || r.division || undefined,
    })
    setBusy(null)
    if (error) return setError(error.message)
    await load()
  }

  async function saveFee() {
    setBusy('fee')
    setError(null)
    const { error } = await createClient().rpc('set_competition_fee', {
      p_competition: competitionId,
      p_division: feeDraft.division,
      p_fee_cents: Math.round(Number(feeDraft.dollars) * 100),
      p_instructions: feeDraft.instructions || undefined,
    })
    setBusy(null)
    if (error) return setError(error.message)
    setFeeDraft({ division: '', dollars: '', instructions: '' })
    await load()
  }

  // B-09 (0230): the league's share of each player, collected by the club.
  async function saveLevy() {
    setBusy('levy')
    setError(null)
    const { error } = await createClient().rpc('set_competition_levy', {
      p_competition: competitionId,
      p_division: levyDraft.division,
      p_levy_cents: Math.round(Number(levyDraft.dollars) * 100),
      p_instructions: levyDraft.instructions || undefined,
    })
    setBusy(null)
    if (error) return setError(error.message)
    setLevyDraft({ division: '', dollars: '', instructions: '' })
    await load()
  }
  async function recordLevyPayment(clubId: string) {
    setBusy(`levy:${clubId}`)
    setError(null)
    const { error } = await createClient().rpc('record_levy_payment', {
      p_competition: competitionId,
      p_club: clubId,
      p_amount_cents: Math.round(Number(payDraft.dollars) * 100),
      p_method: payDraft.method,
      p_note: payDraft.note || undefined,
    })
    setBusy(null)
    if (error) return setError(error.message)
    setPayFor(null)
    setPayDraft({ dollars: '', method: 'bank', note: '' })
    await load()
  }
  async function undoLevyPayment(id: string) {
    setBusy(id)
    const { error } = await createClient().rpc('undo_levy_payment', { p_payment: id })
    setBusy(null)
    if (error) return setError(error.message)
    await load()
  }
  async function mark(feeId: string, status: 'paid' | 'waived' | 'owed') {
    setBusy(feeId)
    const { error } = await createClient().rpc('mark_entry_fee', { p_fee: feeId, p_status: status, p_method: 'bank' })
    setBusy(null)
    if (error) return setError(error.message)
    await load()
  }

  async function copy(token: string, id: string) {
    const url = `${window.location.origin}/join-competition/${token}`
    try {
      await navigator.clipboard.writeText(url)
      setCopied(id)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      window.prompt('Copy this link', url)
    }
  }

  const pending = requests.filter((r) => r.status === 'pending')
  const decided = requests.filter((r) => r.status !== 'pending')

  return (
    <div className="m-3.5 rounded-xl border p-3.5" style={{ borderColor: 'var(--line)' }}>
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 text-sm">
          <b>Entries from the public page</b>
          <span className="block text-ink-3">{open ? 'Open — teams can ask to enter' : 'Closed'}{pending.length ? ` · ${pending.length} waiting` : ''}</span>
        </span>
        <button onClick={() => toggleOpen(!open)} disabled={busy === 'open'} className="flex-none rounded-xl px-3.5 py-2 text-sm font-semibold disabled:opacity-50" style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }}>
          {open ? 'Close' : 'Open'}
        </button>
      </div>
      {error && <p className="mt-2 rounded-lg p-2 text-xs" style={{ background: 'var(--no-bg)', color: 'var(--no)' }}>{error}</p>}

      {pending.length > 0 && (
        <ul className="mt-3 divide-y text-sm" style={{ borderColor: 'var(--line-2)' }}>
          {pending.map((r) => (
            <li key={r.id} className="py-2.5">
              <span className="block font-medium">
                {r.team_name}{' '}
                {r.captain
                  ? <span className="rounded-full px-1.5 py-0.5 text-[0.6875rem] font-semibold" style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }} data-captain-request>captain&apos;s team · {r.squad_size} players · {r.pay_mode === 'split' ? 'split the fee' : 'captain pays'}</span>
                  : <span className="font-normal text-ink-3">· {r.club_name}</span>}
              </span>
              <span className="block text-xs text-ink-3">
                {r.contact_name}{r.contact_phone ? ` · ${r.contact_phone}` : ''}{r.contact_email ? ` · ${r.contact_email}` : ''} · asked {day(r.created_at)}
              </span>
              {r.note && <span className="block text-xs text-ink-2">“{r.note}”</span>}
              <div className="mt-2 flex items-center gap-2 text-xs">
                <select value={pick[r.id] ?? r.division ?? ''} onChange={(e) => setPick({ ...pick, [r.id]: e.target.value })} className="min-w-0 flex-1 rounded-lg border bg-transparent px-2 py-1.5" style={{ borderColor: 'var(--line)' }}>
                  <option value="">Which division?</option>
                  {[...new Set([...divisions, ...(r.division ? [r.division] : [])])].map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
                <button onClick={() => decide(r, true)} disabled={busy === r.id || !(pick[r.id] ?? r.division)} className="rounded-lg px-3 py-1.5 font-semibold text-yes-ink disabled:opacity-50" style={{ background: 'var(--yes)' }}>Accept</button>
                <button onClick={() => decide(r, false)} disabled={busy === r.id} className="rounded-lg border px-3 py-1.5 disabled:opacity-50" style={{ borderColor: 'var(--no)', color: 'var(--no)' }}>Decline</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {decided.some((r) => r.token) && (
        <ul className="mt-3 space-y-1.5 text-xs">
          {decided.filter((r) => r.token).map((r) => (
            <li key={r.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate">{r.team_name} — accepted; send {r.contact_name.split(' ')[0]} their link</span>
              <button onClick={() => copy(r.token!, r.id)} className="flex-none rounded-lg border px-2 py-1" style={{ borderColor: 'var(--line)' }}>{copied === r.id ? 'Copied' : 'Copy link'}</button>
            </li>
          ))}
        </ul>
      )}
      {/* 0261: captains' teams — the code and the link each captain shares. */}
      {captainTeams.length > 0 && (
        <ul className="mt-3 space-y-1.5 text-xs" data-captain-teams={captainTeams.length}>
          {captainTeams.map((t) => (
            <li key={t.entry_id} className="flex items-center gap-2" data-captain-team={t.join_code}>
              <span className="min-w-0 flex-1 truncate">
                <b className="tracking-widest">{t.join_code}</b> · {t.team_name} · {t.members}{t.squad_size ? ` of ${t.squad_size}` : ''} in{t.captain ? ` · captain ${t.captain}` : ` · send to ${t.contact ?? 'the captain'}`}
              </span>
              <button
                onClick={async () => { await navigator.clipboard.writeText(`${window.location.origin}/c/${slug ?? ''}/team/${t.join_code}`).catch(() => {}); setCopied(t.entry_id); setTimeout(() => setCopied(null), 1500) }}
                className="flex-none rounded-lg border px-2 py-1"
                style={{ borderColor: 'var(--line)' }}
                data-copy-join-code={t.join_code}
              >
                {copied === t.entry_id ? 'Copied' : 'Copy link'}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 border-t pt-3" style={{ borderColor: 'var(--line-2)' }}>
        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1 text-sm">
            <b>Entry fees</b>
            <span className="block text-ink-3">
              {fees?.fees.length ? `${fees.fees.map((f) => `${f.division || 'All'} ${money(f.fee_cents)}`).join(' · ')} · owed ${money(fees.owed_cents)} · paid ${money(fees.paid_cents)}` : 'None set — entries are free.'}
            </span>
          </span>
          <button onClick={() => setShowFees((v) => !v)} className="flex-none rounded-xl px-3.5 py-2 text-sm font-semibold" style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }}>
            {showFees ? 'Hide' : 'Manage'}
          </button>
        </div>
        {showFees && (
          <div className="mt-3">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <label>
                <span className="text-ink-2">Division</span>
                <select value={feeDraft.division} onChange={(e) => setFeeDraft({ ...feeDraft, division: e.target.value })} className="mt-0.5 w-full rounded-lg border bg-transparent px-2 py-1.5 text-sm" style={{ borderColor: 'var(--line)' }}>
                  <option value="">All divisions</option>
                  {divisions.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </label>
              <label>
                <span className="text-ink-2">Fee</span>
                <span className="mt-0.5 flex items-center gap-1 rounded-lg border px-2" style={{ borderColor: 'var(--line)' }}>
                  <span className="text-ink-3">$</span>
                  <input value={feeDraft.dollars} onChange={(e) => setFeeDraft({ ...feeDraft, dollars: e.target.value })} inputMode="decimal" placeholder="0" className="w-full min-w-0 py-1.5 text-sm tabular-nums" />
                </span>
              </label>
              <label className="col-span-2">
                <span className="text-ink-2">How to pay (shown to clubs)</span>
                <input value={feeDraft.instructions} onChange={(e) => setFeeDraft({ ...feeDraft, instructions: e.target.value })} placeholder="Bank transfer to SPL Inc, BSB 062-000, acct 1234 5678, reference your team" className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: 'var(--line)' }} />
              </label>
              <button onClick={saveFee} disabled={busy === 'fee' || feeDraft.dollars === ''} className="col-span-2 rounded-lg px-3 py-2 text-sm font-semibold text-brand-ink disabled:opacity-50" style={{ background: 'var(--brand)' }}>Set the fee</button>
            </div>
            <p className="mt-1.5 text-[0.6875rem] text-ink-3">Online payment to the league&apos;s Stripe account comes with the key; until then clubs pay as you say above and you tick them off here.</p>
            {fees && fees.entries.length > 0 && (
              <ul className="mt-3 divide-y text-xs" style={{ borderColor: 'var(--line-2)' }}>
                {fees.entries.map((e) => (
                  <li key={e.fee_id} className="flex items-center gap-2 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{e.team} <span className="text-ink-3">· {e.division}{e.club ? ` · ${e.club}` : ' · not claimed yet'}</span></span>
                      <span className="block text-ink-3">{money(e.amount_cents)} · {e.status}{e.paid_at ? ` ${day(e.paid_at)}${e.method ? ` by ${e.method}` : ''}` : ''}</span>
                    </span>
                    {e.status === 'owed' ? (
                      <>
                        <button onClick={() => mark(e.fee_id, 'paid')} disabled={busy === e.fee_id} className="flex-none rounded-lg px-2 py-1 font-semibold text-brand-ink disabled:opacity-50" style={{ background: 'var(--brand)' }}>Paid</button>
                        <button onClick={() => mark(e.fee_id, 'waived')} disabled={busy === e.fee_id} className="flex-none rounded-lg border px-2 py-1 disabled:opacity-50" style={{ borderColor: 'var(--line)' }}>Waive</button>
                      </>
                    ) : (
                      <button onClick={() => mark(e.fee_id, 'owed')} disabled={busy === e.fee_id} className="flex-none text-ink-3 underline underline-offset-2">undo</button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* B-09 (0230): the levy. The club collects the whole fee; the league
          sees what each club owes it from its registered players, and the
          treasurer ticks it off — as entry fees work. Squadroom takes nothing. */}
      <div className="mt-3 border-t pt-3" style={{ borderColor: 'var(--line-2)' }} data-levy>
        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1 text-sm">
            <b>Player levy</b>
            <span className="block text-ink-3">
              {levy?.levies.length
                ? `${levy.levies.map((l) => `${l.division || 'All'} ${money(l.levy_cents)} a player`).join(' · ')} · owed ${money(levy.clubs.reduce((n, c) => n + c.owed_cents, 0))} · paid ${money(levy.clubs.reduce((n, c) => n + c.paid_cents, 0))}`
                : 'None set — the clubs owe the league nothing per player.'}
            </span>
          </span>
          <button onClick={() => setShowLevy((v) => !v)} className="flex-none rounded-xl px-3.5 py-2 text-sm font-semibold" style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }} data-levy-toggle>
            {showLevy ? 'Hide' : 'Manage'}
          </button>
        </div>
        {showLevy && (
          <div className="mt-3" data-levy-panel>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <label>
                <span className="text-ink-2">Division</span>
                <select value={levyDraft.division} onChange={(e) => setLevyDraft({ ...levyDraft, division: e.target.value })} className="mt-0.5 w-full rounded-lg border bg-transparent px-2 py-1.5 text-sm" style={{ borderColor: 'var(--line)' }} aria-label="Levy division">
                  <option value="">All divisions</option>
                  {divisions.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </label>
              <label>
                <span className="text-ink-2">Per player</span>
                <span className="mt-0.5 flex items-center gap-1 rounded-lg border px-2" style={{ borderColor: 'var(--line)' }}>
                  <span className="text-ink-3">$</span>
                  <input value={levyDraft.dollars} onChange={(e) => setLevyDraft({ ...levyDraft, dollars: e.target.value })} inputMode="decimal" placeholder="0" className="w-full min-w-0 py-1.5 text-sm tabular-nums" aria-label="Levy per player, dollars" />
                </span>
              </label>
              <label className="col-span-2">
                <span className="text-ink-2">How to pay (shown to clubs)</span>
                <input value={levyDraft.instructions} onChange={(e) => setLevyDraft({ ...levyDraft, instructions: e.target.value })} placeholder="Bank transfer to SPL Inc, BSB 062-000, acct 1234 5678, reference your club" className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: 'var(--line)' }} />
              </label>
              <button onClick={saveLevy} disabled={busy === 'levy' || levyDraft.dollars === ''} className="col-span-2 rounded-lg px-3 py-2 text-sm font-semibold text-brand-ink disabled:opacity-50" style={{ background: 'var(--brand)' }} data-levy-save>Set the levy</button>
            </div>
            <p className="mt-1.5 text-[0.6875rem] text-ink-3">The club collects the whole fee from its families; what it owes you is its registered players today times the levy. You tick it off here when it pays.</p>
            {levy && levy.clubs.length > 0 && (
              <ul className="mt-3 divide-y text-xs" style={{ borderColor: 'var(--line-2)' }}>
                {levy.clubs.map((c) => (
                  <li key={c.club_id} className="py-2" data-levy-club={c.club_id}>
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{c.club}</span>
                        <span className="block text-ink-3">
                          {c.players} {c.players === 1 ? 'player' : 'players'} · owes {money(c.owed_cents)} · paid {money(c.paid_cents)} ·{' '}
                          <span style={{ color: c.balance_cents > 0 ? 'var(--no)' : 'var(--yes)' }} data-levy-balance>{c.balance_cents > 0 ? `${money(c.balance_cents)} to come` : 'settled'}</span>
                        </span>
                      </span>
                      {payFor !== c.club_id && (
                        <button onClick={() => { setPayFor(c.club_id); setPayDraft({ dollars: c.balance_cents > 0 ? (c.balance_cents / 100).toFixed(2) : '', method: 'bank', note: '' }) }} className="flex-none rounded-lg px-2 py-1 font-semibold text-brand-ink" style={{ background: 'var(--brand)' }} data-levy-pay={c.club_id}>Paid</button>
                      )}
                    </div>
                    {c.lines.length > 1 && (
                      <p className="mt-0.5 text-ink-3">{c.lines.map((l) => `${l.division}: ${l.players} × ${l.levy_cents == null ? '—' : money(l.levy_cents)}`).join(' · ')}</p>
                    )}
                    {payFor === c.club_id && (
                      <div className="mt-2 grid grid-cols-[1fr_auto_auto] gap-2" data-levy-pay-form>
                        <span className="flex items-center gap-1 rounded-lg border px-2" style={{ borderColor: 'var(--line)' }}>
                          <span className="text-ink-3">$</span>
                          <input value={payDraft.dollars} onChange={(e) => setPayDraft({ ...payDraft, dollars: e.target.value })} inputMode="decimal" className="w-full min-w-0 py-1.5 tabular-nums" aria-label="Amount paid, dollars" />
                        </span>
                        <select value={payDraft.method} onChange={(e) => setPayDraft({ ...payDraft, method: e.target.value })} className="rounded-lg border bg-transparent px-2 py-1.5" style={{ borderColor: 'var(--line)' }} aria-label="Paid how">
                          <option value="bank">Bank</option>
                          <option value="cash">Cash</option>
                        </select>
                        <button onClick={() => recordLevyPayment(c.club_id)} disabled={busy === `levy:${c.club_id}` || !payDraft.dollars} className="rounded-lg px-3 py-1.5 font-semibold text-brand-ink disabled:opacity-50" style={{ background: 'var(--brand)' }} data-levy-pay-save>Record</button>
                        <input value={payDraft.note} onChange={(e) => setPayDraft({ ...payDraft, note: e.target.value })} placeholder="Note (reference, who paid)" className="col-span-2 rounded-lg border px-2 py-1.5" style={{ borderColor: 'var(--line)' }} aria-label="Note" />
                        <button onClick={() => setPayFor(null)} className="rounded-lg border px-2 py-1.5" style={{ borderColor: 'var(--line)' }}>Cancel</button>
                      </div>
                    )}
                    {c.payments.length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-ink-3">
                        {c.payments.map((p) => (
                          <li key={p.id} className="flex items-center gap-2" data-levy-payment={p.id}>
                            <span className="min-w-0 flex-1 truncate">{money(p.amount_cents)} by {p.method} · {day(p.paid_on)}{p.note ? ` · ${p.note}` : ''}</span>
                            <button onClick={() => undoLevyPayment(p.id)} disabled={busy === p.id} className="tap flex-none underline underline-offset-2">undo</button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** The club's side of the levy (B-09, 0230): what this club owes the league per player, and how to pay. */
export function ClubLevy({ competitionId }: { competitionId: string }) {
  const [s, setS] = useState<(ClubLevy & { league: string; instructions: string | null; levies: { division: string; levy_cents: number }[] }) | null>(null)
  useEffect(() => {
    ;(async () => {
      const { data, error } = await createClient().rpc('my_levy_statement', { p_competition: competitionId })
      setS(error ? null : ((data as unknown as typeof s) ?? null))
    })()
  }, [competitionId])
  if (!s || s.levies.length === 0) return null
  return (
    <div className="m-3.5 rounded-xl border p-3.5 text-sm" style={{ borderColor: 'var(--line)' }} data-club-levy>
      <b>Player levy to {s.league}</b>
      <p className="mt-1 text-xs text-ink-2">
        {s.players} registered {s.players === 1 ? 'player' : 'players'} × {s.levies.map((l) => `${money(l.levy_cents)}${l.division ? ` (${l.division})` : ''}`).join(' / ')} = {money(s.owed_cents)} · paid {money(s.paid_cents)} ·{' '}
        <span style={{ color: s.balance_cents > 0 ? 'var(--no)' : 'var(--yes)' }} data-club-levy-balance>{s.balance_cents > 0 ? `${money(s.balance_cents)} to pay` : 'settled'}</span>
      </p>
      {s.instructions && <p className="mt-1 text-xs text-ink-3">How to pay: {s.instructions}</p>}
      <p className="mt-1 text-[0.6875rem] text-ink-3">You collect the whole fee from your families; this is the league&apos;s share of each player on your entered squads today. Squadroom takes nothing.</p>
    </div>
  )
}

/** The club's side: what this club owes the league for its entries. */
export function ClubFees({ competitionId }: { competitionId: string }) {
  const [rows, setRows] = useState<{ fee_id: string; team: string; division: string; amount_cents: number; status: string; paid_at: string | null; league: string; instructions: string | null }[] | null>(null)
  useEffect(() => {
    ;(async () => {
      const { data } = await createClient().rpc('my_entry_fees', { p_competition: competitionId })
      setRows((data as unknown as typeof rows) ?? [])
    })()
  }, [competitionId])
  if (!rows || rows.length === 0) return null
  const owed = rows.filter((r) => r.status === 'owed')
  return (
    <div className="m-3.5 rounded-xl border p-3.5 text-sm" style={{ borderColor: 'var(--line)' }}>
      <b>Entry fees</b>
      <ul className="mt-1.5 space-y-1 text-xs">
        {rows.map((r) => (
          <li key={r.fee_id} className="flex gap-2">
            <span className="min-w-0 flex-1 truncate">{r.team} · {r.division}</span>
            <span className="flex-none tabular-nums">{money(r.amount_cents)}</span>
            <span className="pill flex-none" style={r.status === 'owed' ? { background: 'var(--no-bg)', color: 'var(--no)' } : { background: 'var(--yes-bg)', color: 'var(--yes)' }}>{r.status}</span>
          </li>
        ))}
      </ul>
      {owed.length > 0 && (
        <p className="mt-2 text-xs text-ink-2">
          Pay {rows[0].league} {money(owed.reduce((s, r) => s + r.amount_cents, 0))}{rows[0].instructions ? ` — ${rows[0].instructions}` : '. They will tell you how.'}
        </p>
      )}
    </div>
  )
}
