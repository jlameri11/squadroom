'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ScreenSkeleton } from '@/components/screen-skeleton'

export type Offer = {
  id: string
  /** After a trial (R-13), or a returning player's place next season (R-20). */
  kind?: 'trial' | 'returning'
  player_id: string
  player: string
  squad_program: string
  squad_program_id: string
  squad: string | null
  season?: string | null
  trial: string | null
  fee_cents: number | null
  expires_at: string
  state: 'open' | 'accepted' | 'declined' | 'lapsed'
  decided_at: string | null
  registration_id: string | null
  /** 'pending' after accepting where PlayFootball comes first (0221). */
  registration_status?: string | null
}

export function money(cents: number) {
  return `$${(cents / 100).toFixed(2).replace(/\.00$/, '')}`
}

export function when(iso: string) {
  return new Date(iso).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })
}

/**
 * The family's side of an offer: what it is, by when, how much, and two
 * buttons. Accepting makes the squad registration (already approved — the
 * coach decided when they offered), puts the child in the squad so the chat
 * and fixtures follow, and goes straight to the fee if there is one.
 *
 * A returning player's offer (R-20) is the same two buttons for a place the
 * child already has. Saying no to it takes the child off the squad, so that
 * one asks twice. Where PlayFootball comes first, accepting holds the place
 * until the club has confirmed the official registration, and no fee is
 * taken before then.
 */
export function OfferScreen({ offerId }: { offerId: string }) {
  const [offer, setOffer] = useState<Offer | null | undefined>(undefined)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sure, setSure] = useState(false)

  async function load() {
    const { data, error } = await createClient().rpc('my_offers')
    if (error) return setError(error.message)
    const found = ((data ?? []) as unknown as Offer[]).find((o) => o.id === offerId) ?? null
    setOffer(found)
  }

  useEffect(() => {
    ;(async () => {
      await load()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerId])

  async function accept() {
    if (!offer) return
    setBusy('accept')
    setError(null)
    const { data, error } = await createClient().rpc('accept_offer', { p_offer: offer.id })
    if (error) {
      setBusy(null)
      return setError(error.message)
    }
    const result = data as unknown as { registration_id: string; payment_request_id: string | null; player_id: string; waiting_for?: string | null }
    if (result.payment_request_id && !result.waiting_for) {
      // The squad's fee, through the one checkout. The amount is read from
      // the database there, never sent from here.
      const res = await fetch('/api/payments/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: result.payment_request_id, playerId: result.player_id }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok && body.url) {
        window.location.href = body.url
        return
      }
      // Accepted all the same: the place is theirs, and the fee is on their
      // payments screen for when the club's card payments are set up.
      setBusy(null)
      await load()
      setError(body.error ? `The place is yours. The payment could not start: ${body.error}` : null)
      return
    }
    setBusy(null)
    await load()
  }

  async function decline() {
    if (!offer) return
    // Saying no to next season takes the child off the squad: ask twice.
    if (offer.kind === 'returning' && !sure) return setSure(true)
    setBusy('decline')
    setError(null)
    const { error } = await createClient().rpc('decline_offer', { p_offer: offer.id })
    setBusy(null)
    setSure(false)
    if (error) return setError(error.message)
    await load()
  }

  if (offer === undefined) return error ? <p className="p-6 text-center text-sm" style={{ color: 'var(--no)' }}>{error}</p> : <ScreenSkeleton />
  if (offer === null) {
    return (
      <p className="card m-4 p-6 text-center text-sm text-ink-2">
        That offer isn&apos;t here. It may have been for another family&apos;s child, or the club may have withdrawn it.
      </p>
    )
  }

  const first = offer.player.split(' ')[0]
  const squad = offer.squad ?? offer.squad_program
  const returning = offer.kind === 'returning'
  const heldForPlayFootball = offer.state === 'accepted' && offer.registration_status === 'pending'

  return (
    <div className="p-3.5">
      <article className="card p-4" data-offer-kind={offer.kind ?? 'trial'}>
        <span className="eyebrow">{returning ? `${offer.season ?? 'Next'} season` : `After ${offer.trial}`}</span>
        <h2 className="display mt-1 text-2xl">
          {returning
            ? `${first} has a place in ${squad}${offer.season ? ` for ${offer.season}` : ''}`
            : `${first} has been offered a place in ${squad}`}
        </h2>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-ink-3">Program</dt>
          <dd>{offer.squad_program}</dd>
          <dt className="text-ink-3">Fee</dt>
          <dd>{offer.fee_cents != null ? money(offer.fee_cents) : 'None'}</dd>
          <dt className="text-ink-3">{offer.state === 'open' ? 'Accept by' : 'Was open until'}</dt>
          <dd>{when(offer.expires_at)}</dd>
        </dl>

        {offer.state === 'open' && (
          <>
            <p className="mt-3 text-xs text-ink-3">
              {returning
                ? `Accepting keeps ${first}'s place${offer.fee_cents != null ? `, and the ${money(offer.fee_cents)} fee is paid next` : ''}. After the date, the club can give it to someone else.`
                : `Accepting puts ${first} straight into the squad — the team chat and fixtures appear at once${offer.fee_cents != null ? `, and the ${money(offer.fee_cents)} fee is paid next` : ''}.`}
            </p>
            {error && (
              <p className="mt-3 rounded-lg p-2.5 text-sm" style={{ background: 'var(--no-bg)', color: 'var(--no)' }}>
                {error}
              </p>
            )}
            {sure ? (
              <div className="mt-3 rounded-lg p-3" style={{ background: 'var(--no-bg)' }} data-decline-confirm>
                <p className="text-sm" style={{ color: 'var(--no)' }}>
                  {first} comes off {squad}, and the place can go to someone else.
                </p>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <button
                    onClick={decline}
                    disabled={busy !== null}
                    className="min-w-fit flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-no-ink disabled:opacity-50"
                    style={{ background: 'var(--no)' }}
                  >
                    {busy === 'decline' ? 'Telling the club…' : `Yes, ${first} is leaving`}
                  </button>
                  <button
                    onClick={() => setSure(false)}
                    disabled={busy !== null}
                    className="min-w-fit rounded-xl border px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
                    style={{ borderColor: 'var(--line)', color: 'var(--ink-2)' }}
                  >
                    Keep the place
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={accept}
                  disabled={busy !== null}
                  className="min-w-fit flex-1 rounded-xl px-4 py-3 font-semibold text-yes-ink disabled:opacity-50"
                  style={{ background: 'var(--yes)' }}
                >
                  {busy === 'accept' ? 'Accepting…' : offer.fee_cents != null ? 'Accept and pay' : 'Accept the place'}
                </button>
                <button
                  onClick={decline}
                  disabled={busy !== null}
                  className="min-w-fit rounded-xl border px-4 py-3 font-semibold disabled:opacity-50"
                  style={{ borderColor: 'var(--line)', color: 'var(--ink-2)' }}
                >
                  {busy === 'decline' ? '…' : returning ? `${first} won't be back` : 'No thanks'}
                </button>
              </div>
            )}
          </>
        )}

        {offer.state === 'accepted' && !heldForPlayFootball && (
          <p className="mt-3 rounded-lg p-2.5 text-sm" style={{ background: 'var(--yes-bg)', color: 'var(--yes)' }}>
            Accepted{offer.decided_at ? ` on ${when(offer.decided_at)}` : ''}. {first} is in the squad.
            {offer.fee_cents != null ? ' The fee is on your payments screen if it is not paid yet.' : ''}
          </p>
        )}
        {heldForPlayFootball && (
          <p className="mt-3 rounded-lg p-2.5 text-sm" style={{ background: 'var(--yes-bg)', color: 'var(--yes)' }} data-held>
            Accepted{offer.decided_at ? ` on ${when(offer.decided_at)}` : ''}. The place is held for {first}: the club confirms it
            once {first}&apos;s PlayFootball registration{offer.season ? ` for ${offer.season}` : ''} is through. If you
            haven&apos;t registered in PlayFootball yet, do that next.
          </p>
        )}
        {offer.state === 'declined' && (
          <p className="mt-3 text-sm text-ink-2">
            {returning
              ? `You told the club ${first} won't be back, so ${first} is off ${squad}. If that was a mistake, ask the club — they can offer the place again.`
              : 'You declined this one. If that was a mistake, ask the club — they can offer it again.'}
          </p>
        )}
        {offer.state === 'lapsed' && (
          <p className="mt-3 rounded-lg p-2.5 text-sm" style={{ background: 'var(--maybe-bg)', color: 'var(--maybe)' }}>
            This offer lapsed on {when(offer.expires_at)}. Ask the club whether {returning ? `${first}'s` : 'the'} place is still there — they can offer it again.
          </p>
        )}
      </article>
    </div>
  )
}
