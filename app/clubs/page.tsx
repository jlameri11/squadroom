import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { FindClub } from './find-club'

export const revalidate = 3600

export const metadata: Metadata = {
  title: 'Find a club on Squadroom',
  description: 'Search clubs and academies by name or suburb and register for what they have open.',
}

/**
 * Find a club (the registration brief, gap 5; 0266). A public page in
 * Squadroom's own black and white: a family who has heard of a club, or of
 * nothing but their suburb, searches and lands on the club's registration
 * page. The list is read through `public_find_clubs` — clubs with something
 * open and the switch on, never a person — with no cookie and no tracking.
 */
export default function ClubsPage() {
  return (
    <main className="mx-auto w-full max-w-md pb-12" style={{ color: 'var(--ink)' }}>
      <header className="px-5 pb-6 pt-8" style={{ background: 'var(--bar)', color: 'var(--bar-ink)' }}>
        <Link href="/for-clubs" aria-label="Squadroom">
          <Image src="/brand/squadroom-logo-white.svg" alt="Squadroom" width={164} height={32} priority unoptimized className="h-8 w-auto" />
        </Link>
        <h1 className="display mt-2 text-[2rem] leading-[1.05]">Find a club</h1>
        <p className="mt-2 text-[0.9375rem] opacity-90">
          Clubs and academies taking registrations on Squadroom, by name or suburb. Register in a few taps, from your phone.
        </p>
      </header>
      <FindClub />
      <p className="px-5 pt-6 text-xs text-ink-3">
        A club appears here while it has something open to register for and has chosen to be listed. Nothing about you is
        collected on this page.{' '}
        <Link href="/privacy" className="underline underline-offset-2">
          How we look after your info ›
        </Link>
      </p>
    </main>
  )
}
