import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'How Squadroom looks after your info',
  description: 'A privacy notice written for the children who open a Squadroom page, and the grown-ups who look after them.',
  robots: { index: true, follow: false },
}

/**
 * S-05 / W-04: the privacy notice, written for a child first.
 *
 * Every sentence here is checked against the code: no cookies on the public
 * pages (app/c), no accounts for children (0078), names on public pages
 * only by the club's rule and never over a family's opt-out (0093), the
 * photo in a private bucket (0146), the card's audience (0159), export and
 * erase (0127). If the code changes, this page changes with it.
 */
export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-lg px-5 pb-16 pt-8" style={{ background: 'var(--paper)' }}>
      <p className="eyebrow">Squadroom</p>
      <h1 className="display mt-1 text-[1.875rem] leading-tight">How we look after your info</h1>
      <p className="mt-2 text-sm text-ink-2">Written for the kids who open a Squadroom page. The grown-up version is underneath.</p>

      <section className="card mt-6 p-4 text-[0.9375rem] leading-relaxed">
        <h2 className="font-semibold">If you&apos;re a player</h2>
        <ul className="mt-2 list-disc space-y-2 pl-5">
          <li><b>You don&apos;t need an account.</b> You open the page your coach or parent sent you, and you can see the draw, the scores and the ladder. That&apos;s it.</li>
          <li><b>We don&apos;t watch you.</b> The page has no ads and no trackers. We don&apos;t know who opened it.</li>
          <li><b>Your name on the page is your club&apos;s choice, and your family&apos;s.</b> Some clubs show full names, some show just &ldquo;Leo W.&rdquo;, some show no names. Your parent can switch your name off whenever they like, and that always wins.</li>
          <li><b>Your photo is never on the internet.</b> If your club keeps one, it&apos;s only on your player card, which only your family, your coaches and the referee on match day can open.</li>
          <li><b>Your messages are with your team.</b> A coach can&apos;t message you on your own — a parent is always in the chat too.</li>
          <li><b>If something feels wrong, tell a grown-up.</b> Your parent can report it from the app, and only the club&apos;s safeguarding people see it.</li>
        </ul>
      </section>

      <section className="card mt-4 p-4 text-sm leading-relaxed text-ink-2">
        <h2 className="font-semibold text-ink">For parents and carers</h2>
        <dl className="mt-2 space-y-3">
          <div>
            <dt className="font-medium text-ink">What we hold about a child</dt>
            <dd>Name, date of birth, squad and shirt number; the kit sizes, medical notes and emergency contacts you give the club; the agreements you sign; a photo if you add one. Nothing is collected from the child directly — children have no accounts.</dd>
          </div>
          <div>
            <dt className="font-medium text-ink">Who can see it</dt>
            <dd>The club&apos;s owners, admins and coaches. Medical notes: club staff only — never another club, never a league. The player card (photo, squad, number, date of birth): the family, the club&apos;s coaches, a league&apos;s officials while the child is on a season squad, and the opposing manager on match day only. Public competition pages show clubs and scores; names only by the club&apos;s rule, and never if you have switched them off.</dd>
          </div>
          <div>
            <dt className="font-medium text-ink">What we never do</dt>
            <dd>No advertising, no analytics on public pages, no sale or sharing of data, no address-book uploads, no fees charged to families by Squadroom. Children are never alone with an adult in a private chat.</dd>
          </div>
          <div>
            <dt className="font-medium text-ink">Your controls</dt>
            <dd>Settings → My family: each child&apos;s details, medical notes, agreements (agree or withdraw, versioned), kit sizes, the public-name switch, and who can see what. Settings → Your data: download everything we hold, or erase your account — the function tells you what is kept and why (safeguarding reports, the club&apos;s payment records, WWCC records, and the child&apos;s roster row, which belongs to the club).</dd>
          </div>
          <div>
            <dt className="font-medium text-ink">Where it lives</dt>
            <dd>In Sydney, Australia, permanently. Every club&apos;s data is separated from every other club&apos;s at the database level.</dd>
          </div>
          <div>
            <dt className="font-medium text-ink">Questions</dt>
            <dd>Ask your club first — they are the organisation that holds the record. This notice is reviewed against the Children&apos;s Online Privacy Code; a legal review is planned before Squadroom&apos;s second club.</dd>
          </div>
        </dl>
      </section>
    </main>
  )
}
