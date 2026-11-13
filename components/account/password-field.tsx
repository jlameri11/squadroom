'use client'

import { useState } from 'react'

export const MIN_PASSWORD = 8

/**
 * One password field with a show/hide eye — no confirm field, no rules but
 * the length (the sign-up brief, 12 Nov 2026). The rule is said before they
 * type, not after they submit.
 */
export function PasswordField({
  label = 'Password',
  value,
  onChange,
  required = true,
  autoComplete = 'new-password',
  hint = `At least ${MIN_PASSWORD} characters.`,
  inputProps,
}: {
  label?: string
  value: string
  onChange: (v: string) => void
  required?: boolean
  autoComplete?: 'new-password' | 'current-password'
  hint?: string | null
  inputProps?: React.InputHTMLAttributes<HTMLInputElement>
}) {
  const [shown, setShown] = useState(false)
  const tooShort = value.length > 0 && value.length < MIN_PASSWORD
  return (
    <label className="block">
      <span className="block text-sm font-semibold">
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </span>
      <span className="relative mt-1.5 block">
        <input
          type={shown ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          autoComplete={autoComplete}
          className="w-full rounded-xl border py-3 pl-3.5 pr-12 text-base"
          style={{ borderColor: tooShort ? 'var(--no)' : 'var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
          {...inputProps}
        />
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          aria-label={shown ? 'Hide password' : 'Show password'}
          aria-pressed={shown}
          className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-ink-2"
          data-password-eye
        >
          {shown ? <EyeOff /> : <Eye />}
        </button>
      </span>
      {tooShort ? (
        <span className="mt-1 block text-xs" style={{ color: 'var(--no)' }}>
          {MIN_PASSWORD - value.length} more character{MIN_PASSWORD - value.length === 1 ? '' : 's'}.
        </span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-ink-3">{hint}</span>
      ) : null}
    </label>
  )
}

function Eye() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function EyeOff() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3l18 18" />
      <path d="M10.6 10.6a3 3 0 0 0 4.2 4.2" />
      <path d="M9.9 5.2A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1" />
      <path d="M6.2 6.2C3.6 8 2 12 2 12s3.5 7 10 7c1.7 0 3.2-.4 4.5-1" />
    </svg>
  )
}
