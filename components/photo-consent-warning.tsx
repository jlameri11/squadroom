'use client'

type Child = { player_id: string; name: string }
export type PhotoConsentCheck =
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
 * Who in this squad must not be photographed (0128), said at the moment a
 * coach is about to post pictures — in the chat (photo-consent.tsx) and on a
 * game's photos (0223). It names the children whose families have said no
 * and leaves the looking to the person who was there; it never claims to
 * have looked at the photo. A refusal and an unanswered form are shown
 * differently, and nothing is shown at a club that does not ask.
 */
export function PhotoConsentWarning({ check, onDismiss, className = 'mx-3 mt-2' }: { check: PhotoConsentCheck; onDismiss?: () => void; className?: string }) {
  if (check.applies === false) return null

  const refused = check.refused ?? []
  const unasked = check.not_answered ?? []

  // Nothing to say: everybody in the squad has agreed.
  if (refused.length === 0 && unasked.length === 0) return null

  // A club that has not started asking. Listing twenty-six names here is a
  // wall; one sentence a club can act on is not.
  const notStarted = check.nobody_has_answered && refused.length === 0

  return (
    <div
      className={`${className} rounded-lg border p-2.5 text-xs`}
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
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="tap mt-1.5 underline underline-offset-2"
          style={{ color: 'var(--ink-3)' }}
        >
          I have checked
        </button>
      )}
    </div>
  )
}
