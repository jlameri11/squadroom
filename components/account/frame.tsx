import Image from 'next/image'
import Link from 'next/link'

/**
 * The ground every account screen sits on (the sign-up brief, 12 Nov 2026:
 * "as simple as Dribl's form — white/near-black card, big tap targets, no
 * extra copy, one button per screen"). Squadroom's mark on `--bar`, which
 * is near-black in light and dark alike (brand/README.md), and one card in
 * the page's own paper for the form. Squadroom is multi-tenant, so these
 * screens wear Squadroom's mark, never a club's.
 */
export function AccountFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col justify-center px-4 py-8" style={{ background: 'var(--bar)', color: 'var(--bar-ink)' }}>
      <div className="mx-auto w-full max-w-sm">
        <Image
          src="/brand/squadroom-logo-white.svg"
          alt="Squadroom"
          width={204}
          height={40}
          priority
          unoptimized
          className="mb-5 h-9 w-auto"
          data-brand-logo
        />
        {children}
      </div>
    </main>
  )
}

export function AccountCard({ children, ...rest }: { children: React.ReactNode } & React.HTMLAttributes<HTMLElement>) {
  return (
    <section className="rounded-2xl border p-5" style={{ background: 'var(--paper)', color: 'var(--ink)', borderColor: 'var(--line)' }} {...rest}>
      {children}
    </section>
  )
}

/** A labelled field: the label above, * for required, one column. */
export function AccountField({
  label,
  value,
  onChange,
  required = false,
  optional = false,
  type = 'text',
  hint,
  inputProps,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  required?: boolean
  optional?: boolean
  type?: string
  hint?: string
  inputProps?: React.InputHTMLAttributes<HTMLInputElement>
}) {
  return (
    <label className="block">
      <span className="block text-sm font-semibold">
        {label}
        {required && <span aria-hidden="true"> *</span>}
        {optional && <span className="font-normal text-ink-3"> (optional)</span>}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="mt-1.5 w-full rounded-xl border px-3.5 py-3 text-base"
        style={{ borderColor: 'var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
        {...inputProps}
      />
      {hint && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
    </label>
  )
}

/** Under the button, on every path that makes an account. Placeholder pages until the lawyer's versions. */
export function TermsLine({ verb = 'creating an account' }: { verb?: string }) {
  return (
    <p className="text-center text-xs text-ink-3" data-terms-line>
      By {verb} you agree to our{' '}
      <Link href="/terms" className="underline underline-offset-4">Terms</Link> and{' '}
      <Link href="/privacy" className="underline underline-offset-4">Privacy Policy</Link>.
    </p>
  )
}

export const PRIMARY_BUTTON = 'w-full rounded-xl px-4 py-3.5 text-base font-semibold disabled:opacity-50'
export const primaryStyle = { background: 'var(--brand)', color: 'var(--brand-ink)' } as const
