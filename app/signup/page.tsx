'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { CreateAccount } from '@/components/account/create-account'

/**
 * /signup — Create account (the sign-up brief, 12 Nov 2026). Every way in
 * lands here with a `next`: a coach's link (/join/<token>), a club's public
 * registration, or nothing — which is somebody setting up an academy, club
 * or league, who goes on to /start.
 */
function SignUpInner() {
  const params = useSearchParams()
  const raw = params.get('next') ?? '/start'
  // Only ever a path on this site.
  const next = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/start'
  const why = (params.get('why') ?? '').slice(0, 80) || null
  return <CreateAccount next={next} why={why} />
}

export default function SignUp() {
  // useSearchParams needs a Suspense boundary, or the whole route opts out of
  // static rendering.
  return (
    <Suspense fallback={null}>
      <SignUpInner />
    </Suspense>
  )
}
