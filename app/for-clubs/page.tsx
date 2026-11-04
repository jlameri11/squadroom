import type { Metadata } from 'next'
import Link from 'next/link'

export const revalidate = 3600

export const metadata: Metadata = {
  title: 'Squadroom for academies, clubs and leagues',
  description:
    'One app for youth football: the chat families already use, the fixtures and ladders a league needs, and the registration, squads and match day in between. Paid by the club, never by parents.',
}

/**
 * The front door for a club, academy or league that has heard of Squadroom.
 *
 * Static and cookie-less: a page a committee reads on a Tuesday night. One
 * call to action, which is the free trial — founding the club takes a
 * minute and the half-hour setup checklist takes it from there. No prices:
 * pricing is Joey's decision (CLAUDE.md), and the one rule that is already
 * settled is said plainly — the club pays, families never do.
 */
export default function ForClubs() {
  return (
    <main className="mx-auto w-full max-w-md" style={{ color: 'var(--ink)' }}>
      <header className="px-5 pb-8 pt-10" style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}>
        <p className="eyebrow" style={{ color: 'var(--brand-ink)', opacity: 0.8 }}>Squadroom</p>
        <h1 className="display mt-2 text-[2.125rem] leading-[1.05]">
          The chat your families already use, with the football underneath it.
        </h1>
        <p className="mt-3 text-[0.9375rem] opacity-90">
          For academies, clubs and leagues. Fixtures, squads, registration, match day and the
          group chat — one app, built around children&apos;s safety.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link
            href="/signup?next=/start"
            className="rounded-xl px-4 py-3 text-sm font-semibold"
            style={{ background: '#fff', color: 'var(--brand)' }}
            data-start-free
          >
            Start free — set up in 30 minutes
          </Link>
          <Link href="/signin" className="rounded-xl px-4 py-3 text-sm font-semibold" style={{ background: '#ffffff26', color: 'var(--brand-ink)' }}>
            Sign in
          </Link>
        </div>
        <p className="mt-3 text-xs opacity-80">Paid by the club, academy or league. Never by parents — no fee is ever added to a family&apos;s bill.</p>
      </header>

      <section className="px-5 pt-7">
        <h2 className="eyebrow">For academies and clubs</h2>
        <ul className="mt-2 flex flex-col gap-2">
          {[
            ['Registration without the admin', 'A public page families register on, with the questions you ask, the consents you need, kit sizes, sibling discounts, instalments and vouchers. PlayFootball first where the rules say so.'],
            ['Squads, numbers and the roster', 'Import a spreadsheet or add players by hand. One jersey pool per season, so a U10 filling in for the U11s never clashes.'],
            ['Chat that behaves', 'Team, age-group and club channels; announcements with "seen by"; replies that fold; voice notes; a message in each family\'s language. A child is never alone with an adult in a private chat.'],
            ['Match day in your pocket', 'Fixtures from the league land in the right team\'s chat; RSVP in a tap; "can\'t play" with a reason; attendance in twenty seconds; a cancelled game pushes everyone, and cannot be muted.'],
            ['Safeguarding built in', 'Working With Children Checks gate the roster; photo consent is checked before a photo is posted; concussions lock a child out of team sheets until a clearance is accepted.'],
            ['Money, clearly', 'Fees per program, who owes at a glance, a chase that goes out on its own, and a family that always sees one total.'],
          ].map(([h, p]) => (
            <li key={h} className="card p-3.5">
              <span className="block font-semibold">{h}</span>
              <span className="mt-0.5 block text-sm text-ink-2">{p}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="px-5 pt-7">
        <h2 className="eyebrow">For leagues</h2>
        <ul className="mt-2 flex flex-col gap-2">
          {[
            ['Run a whole season', 'Divisions with their own rules, a draw checked before it goes out, home-and-away balance, a public match centre and ladders anyone can audit.'],
            ['Team sheets, scores, discipline', 'Sheets from both sides that lock before kick-off; scores that must agree; cards with the federation\'s codes; suspensions that keep a player off the sheet by name.'],
            ['Referees', 'A pool, availability, appointments with a push, check-in by QR, reports, payment runs. Referees of the right grade can take open games themselves.'],
            ['Clubs talk to clubs', 'A change request between two managers, agreed inside a window the league sets, is done without a phone call. The league sees everything outstanding on one screen.'],
          ].map(([h, p]) => (
            <li key={h} className="card p-3.5">
              <span className="block font-semibold">{h}</span>
              <span className="mt-0.5 block text-sm text-ink-2">{p}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="px-5 pt-7">
        <h2 className="eyebrow">How the trial works</h2>
        <ol className="card mt-2 divide-y" style={{ borderColor: 'var(--line-2)' }}>
          {[
            ['Sign up with an email', 'A link, no password to remember. You are the owner of your club from the first minute.'],
            ['Set the club up', 'Crest and colours, squads, the roster, a program, your coaches — a checklist that times itself. Most clubs are done inside half an hour.'],
            ['Bring the families in', 'Each coach gets a link or a six-character code to say at training. A parent taps it, the coach approves, and they are in the team chat.'],
            ['Pay only when you decide to', 'The trial costs nothing. Pricing is published before anyone is asked for a cent, and it is always the club that pays.'],
          ].map(([h, p], i) => (
            <li key={h} className="flex gap-3 p-3.5">
              <span className="grid h-7 w-7 flex-none place-items-center rounded-full text-xs font-bold" style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}>{i + 1}</span>
              <span className="min-w-0">
                <span className="block font-semibold">{h}</span>
                <span className="mt-0.5 block text-sm text-ink-2">{p}</span>
              </span>
            </li>
          ))}
        </ol>
        <Link
          href="/signup?next=/start"
          className="mt-4 block rounded-xl px-4 py-3 text-center text-sm font-semibold text-white"
          style={{ background: 'var(--brand)' }}
        >
          Start free
        </Link>
      </section>

      <footer className="px-5 pb-10 pt-8 text-xs text-ink-3">
        <p>Built in Sydney for youth football. Children never have accounts; what we hold about them, and why, is on the <Link href="/privacy" className="underline underline-offset-2">privacy page</Link>.</p>
        <p className="mt-1">Official registration stays in PlayFootball. Squadroom does not read from or write to it.</p>
      </footer>
    </main>
  )
}
