import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Squadroom terms',
  description: 'The terms of using Squadroom — a placeholder until the reviewed version.',
  robots: { index: false, follow: false },
}

/**
 * /terms — a placeholder until the lawyer's version (the sign-up brief,
 * 12 Nov 2026: "links; placeholder pages until the lawyer's versions").
 * Linked under every Create account button with the privacy notice. Plain
 * words, nothing a family would have to argue with.
 */
export default function TermsPage() {
  return (
    <main className="mx-auto w-full max-w-lg px-5 pb-16 pt-8" style={{ background: 'var(--paper)' }}>
      <p className="eyebrow">Squadroom</p>
      <h1 className="display mt-1 text-[1.875rem] leading-tight">Terms of use</h1>
      <p className="mt-2 text-sm text-ink-2">
        A plain-words placeholder. A reviewed version replaces this before Squadroom&apos;s second club.
      </p>

      <section className="card mt-6 p-4 text-sm leading-relaxed text-ink-2">
        <ul className="list-disc space-y-2 pl-5">
          <li><b className="text-ink">Your account is yours.</b> One person, one account, your own name. You keep your password to yourself.</li>
          <li><b className="text-ink">Children don&apos;t have accounts.</b> A parent or carer joins and registers on their behalf. From 13 a teenager may have their own login with a parent&apos;s approval.</li>
          <li><b className="text-ink">Be decent.</b> Squadroom is a place for teams and families. A club or league may remove someone from its rooms; a ban is theirs to give and to lift.</li>
          <li><b className="text-ink">Your club runs your club.</b> Fees, programs, squads, consents and decisions are the club&apos;s or the league&apos;s. Squadroom is the tool they use; it does not take a cut of what a family pays.</li>
          <li><b className="text-ink">Your information.</b> How it is looked after is in the <Link href="/privacy" className="underline underline-offset-4">privacy notice</Link>, which is part of these terms.</li>
          <li><b className="text-ink">Leaving.</b> You can take your data with you and erase your account from Settings at any time.</li>
        </ul>
      </section>

      <p className="mt-6 text-xs text-ink-3">
        Questions: ask from Settings → Help and support. A person replies.
      </p>
    </main>
  )
}
