'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Child = { player_id: string; name: string }
type Check =
  | { applies: false; reason: string }
  | {
      applies: true
      document: string
      version: number
      squad_size: number
      refused: Child[]
      not_answered: Child[]
      nobody_has_answered: boolean
    }

/**
 * Who in this squad must not be photographed.
 *
 * S-04. Photo consent has been recorded since R-06, including refusals, and
 * nothing read it back — so a coach could photograph a training session and
 * post it into a chat containing the family who said no.
 *
 * IT DOES NOT CLAIM TO HAVE LOOKED AT THE PHOTO, and that is deliberate. A
 * product that said "we checked the image" would be trusted, and it cannot.
 * This names the children whose families have said no, at the moment the
 * coach is about to post, and leaves the looking to the person who was there.
 *
 * A REFUSAL AND AN UNANSWERED FORM ARE SHOWN DIFFERENTLY. One is a decision,
 * the other is a question the club has not asked. Merging them makes the
 * warning fire for every child at a club that has just started — and a
 * warning that always fires trains people past the one that matters.
 *
 * Shown only when images are attached. A permanent notice above the
 * composer is a notice nobody sees.
 */
export function PhotoConsent({ channelId }: { channelId: string }) {
  const [check, setCheck] = useState<Check | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let live = true
    createClient()
      .rpc('photo_consent_check', { p_channel: channelId })
      .then(({ data }) => {
        if (live) setCheck((data as unknown as Check) ?? null)
      })
    return () => {
      live = false
    }
  }, [channelId])

  if (!check || check.applies === false || dismissed) return null

  const refused = check.refused ?? []
  const unasked = check.not_answered ?? []

  // Nothing to say: everybody in the squad has agreed.
  if (refused.length === 0 && unasked.length === 0) return null

  // A club that has not started asking. Listing twenty-six names here is a
  // wall; one sentence a club can act on is not.
  const notStarted = check.nobody_has_answered && refused.length === 0

  return (
    <div
      className="mx-3 mt-2 rounded-lg border p-2.5 text-xs"
      style={{
        borderColor: refused.length > 0 ? 'var(--no)' : 'var(--maybe)',
        background: refused.length > 0 ? 'var(--no-bg)' : 'var(--maybe-bg)',
      }}
      role="status"
    >
      {refused.length > 0 && (
        <p className="font-semibold" style={{ color: 'var(--no)' }}>
          {refused.map((c) => c.name).join(', ')} must not be photographed. Check{' '}
          {refused.length === 1 ? 'they are not' : 'none of them are'} in what you are about
          to post.
        </p>
      )}

      {notStarted ? (
        <p style={{ color: 'var(--maybe)' }}>
          Nobody in this squad has answered the photo consent form yet. Worth asking before
          posting pictures of them.
        </p>
      ) : (
        unasked.length > 0 && (
          <p className={refused.length > 0 ? 'mt-1' : ''} style={{ color: 'var(--maybe)' }}>
            {unasked.length} {unasked.length === 1 ? 'family has' : 'families have'} not answered
            the photo form: {unasked.map((c) => c.name).join(', ')}.
          </p>
        )
      )}

      {/* Dismissible, because a coach who has checked should be able to make
          it go away — and a prompt that cannot be dismissed is a prompt
          people work around rather than read. It comes back next time. */}
      <button
        onClick={() => setDismissed(true)}
        className="mt-1.5 underline underline-offset-2"
        style={{ color: 'var(--ink-3)' }}
      >
        I have checked
      </button>
    </div>
  )
}
