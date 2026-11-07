'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { PhotoConsentWarning, type PhotoConsentCheck } from '@/components/photo-consent-warning'

type Check = PhotoConsentCheck

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

  if (!check || dismissed) return null
  return <PhotoConsentWarning check={check} onDismiss={() => setDismissed(true)} />
}
