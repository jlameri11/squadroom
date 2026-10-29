'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ScreenSkeleton } from '@/components/screen-skeleton'

export type Offer = {
  id: string
  player_id: string
  player: string
  squad_program: string
  squad_program_id: string
  squad: string | null
  trial: string
  fee_cents: number | null
  expires_at: string
  state: 'open' | 'accepted' | 'declined' | 'lapsed'
  decided_at: string | null
  registration_id: string | null
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
 */
export function OfferScreen({ offerId }: { offerId: string }) {
  const [offer, setOffer] = useState<Offer | null | undefined>(undefined)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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
    const result = data as unknown as { registration_id: string; payment_request_id: string | null; player_id: string }
    if (result.payment_request_id) {
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
    setBusy('decline')
    setError(null)
    const { error } = await createClient().rpc('decline_offer', { p_offer: offer.id })
    setBusy(null)
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

  return (
    <div className="p-3.5">
      <article className="card p-4">
        <span className="eyebrow">After {offer.trial}</span>
        <h2 className="display mt-1 text-2xl">
          {offer.player.split(' ')[0]} has been offered a place in {offer.squad ?? offer.squad_program}
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
              Accepting puts {offer.player.split(' ')[0]} straight into the squad — the team chat and fixtures
              appear at once{offer.fee_cents != null ? `, and the ${money(offer.fee_cents)} fee is paid next` : ''}.
            </p>
            {error && (
              <p className="mt-3 rounded-lg p-2.5 text-sm" style={{ background: 'var(--no-bg)', color: 'var(--no)' }}>
                {error}
              </p>
            )}
            <div className="mt-3 flex gap-2">
              <button
                onClick={accept}
                disabled={busy !== null}
                className="flex-1 rounded-xl px-4 py-3 font-semibold text-white disabled:opacity-50"
                style={{ background: 'var(--yes)' }}
              >
                {busy === 'accept' ? 'Accepting…' : offer.fee_cents != null ? 'Accept and pay' : 'Accept the place'}
              </button>
              <button
                onClick={decline}
                disabled={busy !== null}
                className="rounded-xl border px-4 py-3 font-semibold disabled:opacity-50"
                style={{ borderColor: 'var(--line)', color: 'var(--ink-2)' }}
              >
                {busy === 'decline' ? '…' : 'No thanks'}
              </button>
            </div>
          </>
        )}

        {offer.state === 'accepted' && (
          <p className="mt-3 rounded-lg p-2.5 text-sm" style={{ background: 'var(--yes-bg)', color: 'var(--yes)' }}>
            Accepted{offer.decided_at ? ` on ${when(offer.decided_at)}` : ''}. {offer.player.split(' ')[0]} is in the squad.
            {offer.fee_cents != null ? ' The fee is on your payments screen if it is not paid yet.' : ''}
          </p>
        )}
        {offer.state === 'declined' && (
          <p className="mt-3 text-sm text-ink-2">You declined this one. If that was a mistake, ask the club — they can offer it again.</p>
        )}
        {offer.state === 'lapsed' && (
          <p className="mt-3 rounded-lg p-2.5 text-sm" style={{ background: 'var(--maybe-bg)', color: 'var(--maybe)' }}>
            This offer lapsed on {when(offer.expires_at)}. Ask the club whether the place is still there — they can offer it again.
          </p>
        )}
      </article>
    </div>
  )
}
