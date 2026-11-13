import Link from 'next/link'
import { AccountCard, AccountFrame, PRIMARY_BUTTON, primaryStyle } from '@/components/account/frame'
import { inkOn } from '@/lib/brand/colour'

/**
 * The first screen off a coach's link for somebody with no session (the
 * sign-up brief, 12 Nov 2026): the club's crest, "Join U9 Navy at NRIFA",
 * Create account — or "I already have an account → Sign in". Both carry
 * this page as `next`, so the person lands straight back on the join
 * request. Nothing else: the request itself is asked for once they are in.
 */
export function JoinLanding({
  token,
  academyName,
  teamName,
  logoUrl,
  colour,
}: {
  token: string
  academyName: string
  teamName: string | null
  logoUrl: string | null
  colour: string | null
}) {
  const next = `/join/${encodeURIComponent(token)}`
  const what = teamName ? `Join ${teamName} at ${academyName}` : `Join ${academyName}`
  const initials = academyName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
  return (
    <AccountFrame>
      <AccountCard data-join-landing>
        <div className="flex items-center gap-3.5">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- a club's own crest, from its own bucket
            <img src={logoUrl} alt="" width={56} height={56} className="h-14 w-14 flex-none rounded-xl object-contain" style={{ background: 'var(--surface-2)' }} data-join-crest />
          ) : (
            <span
              className="grid h-14 w-14 flex-none place-items-center rounded-xl text-lg font-bold"
              style={{ background: colour ?? 'var(--bar)', color: colour ? inkOn(colour) : 'var(--bar-ink)' }}
              aria-hidden="true"
              data-join-crest
            >
              {initials || 'SQ'}
            </span>
          )}
          <h1 className="display min-w-0 text-[1.5rem] leading-tight" data-join-what>
            {what}
          </h1>
        </div>
        <Link
          href={`/signup?next=${encodeURIComponent(next)}&why=${encodeURIComponent(what)}`}
          className={`${PRIMARY_BUTTON} mt-5 block text-center`}
          style={primaryStyle}
          data-join-create
        >
          Create account
        </Link>
        <p className="mt-4 text-center text-sm text-ink-2">
          I already have an account →{' '}
          <Link href={`/signin?next=${encodeURIComponent(next)}`} className="font-semibold underline underline-offset-4 text-ink" data-join-sign-in>
            Sign in
          </Link>
        </p>
      </AccountCard>
    </AccountFrame>
  )
}
