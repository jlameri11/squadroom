/**
 * The card-fee pass-through (the registration brief, gap 10; 0270).
 *
 * A club that turns it on (Settings → Club, default off) has Stripe's
 * standard Australian domestic card rate — 1.7% + A$0.30 a payment — added
 * to what the family pays, as its own line, so the club nets the fee it
 * set. The family still sees one total (CLAUDE.md), with the card fee shown
 * inside it before they pay.
 *
 * The authoritative figure is the database's `app_private.card_fee_cents`
 * (0270), which the charge routes ask; this copy is for what a page SHOWS
 * before the route is asked — the register form, which has no session —
 * and must stay the same sum.
 */
export const CARD_FEE_BPS = 170
export const CARD_FEE_FIXED_CENTS = 30

/** The surcharge so that amount − Stripe's fee on (amount + surcharge) ≈ amount. */
export function cardFeeCents(amountCents: number): number {
  if (!Number.isFinite(amountCents) || amountCents <= 0) return 0
  const gross = Math.ceil((amountCents + CARD_FEE_FIXED_CENTS) / (1 - CARD_FEE_BPS / 10000))
  return Math.max(0, gross - amountCents)
}
