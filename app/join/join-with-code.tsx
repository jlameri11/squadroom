'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'

/**
 * Six boxes, because a code is six characters.
 *
 * Typed into one text field, a code gets a space in the middle, a lower-case
 * letter, an O where a zero belongs. Six separate boxes make the length
 * obvious, stop a seventh character being typed, and make a mistake visible
 * before the button is pressed. Paste still works and fills all six.
 *
 * Validation happens here as well as on the server, not instead of it: the
 * point is that a parent who mistypes is told so immediately rather than
 * being sent to a page that says the code is dead.
 */
export function JoinWithCode() {
  const router = useRouter()
  const [chars, setChars] = useState<string[]>(Array(6).fill(''))
  const code = chars.join('')
  const complete = code.length === 6 && [...code].every((c) => ALPHABET.includes(c))

  function set(index: number, raw: string) {
    // A paste lands in one box and should fill the rest.
    const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (cleaned.length > 1) {
      const next = [...chars]
      for (let i = 0; i < cleaned.length && index + i < 6; i++) {
        next[index + i] = cleaned[i]
      }
      setChars(next)
      focus(Math.min(index + cleaned.length, 5))
      return
    }

    const next = [...chars]
    next[index] = cleaned
    setChars(next)
    if (cleaned) focus(index + 1)
  }

  function focus(index: number) {
    if (index > 5) return
    document.getElementById(`code-${index}`)?.focus()
  }

  function onKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    // Backspace in an empty box goes back a box, which is what everybody
    // expects and nothing does by default.
    if (e.key === 'Backspace' && !chars[index] && index > 0) {
      e.preventDefault()
      const next = [...chars]
      next[index - 1] = ''
      setChars(next)
      focus(index - 1)
    }
    if (e.key === 'ArrowLeft') focus(index - 1)
    if (e.key === 'ArrowRight') focus(index + 1)
  }

  // Which character they got wrong, if any — said before they press anything.
  const wrong = chars.find((c) => c && !ALPHABET.includes(c))

  return (
    <main
      className="flex min-h-dvh flex-col justify-center px-6 py-10"
      style={{ background: 'var(--brand)' }}
    >
      <div className="mx-auto w-full max-w-sm">
        <span
          className="display mb-6 grid h-12 w-12 place-items-center rounded-[14px] text-lg"
          style={{ background: 'var(--gold)', color: '#202842' }}
          aria-hidden
        >
          SQ
        </span>

        <h1 className="display text-[30px] leading-none" style={{ color: 'var(--brand-ink)' }}>
          Enter your code
        </h1>
        <p className="mt-1.5 text-sm" style={{ color: '#ffffffb3' }}>
          Your coach will have given you six characters. You don&apos;t need an account yet.
        </p>

        <form
          className="mt-6"
          onSubmit={(e) => {
            e.preventDefault()
            if (complete) router.push(`/join/${code}`)
          }}
        >
          <div className="flex gap-1.5">
            {chars.map((c, i) => (
              <input
                key={i}
                id={`code-${i}`}
                value={c}
                onChange={(e) => set(i, e.target.value)}
                onKeyDown={(e) => onKeyDown(i, e)}
                inputMode="text"
                // A phone keyboard would otherwise capitalise the first box
                // and autocorrect the rest into a word.
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                aria-label={`Character ${i + 1} of 6`}
                className="display min-w-0 flex-1 rounded-xl border py-4 text-center text-[22px]"
                style={{
                  background: '#ffffff14',
                  borderColor: c && !ALPHABET.includes(c) ? '#FFD9CE' : '#ffffff2e',
                  color: '#fff',
                }}
              />
            ))}
          </div>

          {/*
            Said plainly, because this is the single most common way a code
            fails: the alphabet has no O and no zero, no I and no one, on
            purpose, and somebody reading a code off a whiteboard will try
            them.
          */}
          {wrong ? (
            <p className="mt-2.5 text-sm" style={{ color: '#FFD9CE' }}>
              There&apos;s no {wrong} in a join code — codes never use O, 0, I, 1 or L, so they
              can&apos;t be misread. Check the one you were given.
            </p>
          ) : (
            <p className="mt-2.5 text-xs" style={{ color: '#ffffff80' }}>
              Codes never contain O, 0, I, 1 or L.
            </p>
          )}

          <button
            type="submit"
            disabled={!complete}
            className="mt-5 w-full rounded-xl px-4 py-3.5 font-semibold disabled:opacity-40"
            style={{ background: 'var(--gold)', color: '#202842' }}
          >
            Continue
          </button>
        </form>

        <div className="mt-7 border-t pt-5" style={{ borderColor: '#ffffff26' }}>
          <p className="text-sm" style={{ color: '#ffffff99' }}>
            Running a club instead?{' '}
            <Link href="/signup" className="underline underline-offset-4" style={{ color: '#fff' }}>
              Set up an academy, club or league
            </Link>
          </p>
          <p className="mt-2 text-sm" style={{ color: '#ffffff99' }}>
            Already in?{' '}
            <Link href="/signin" className="underline underline-offset-4" style={{ color: '#fff' }}>
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </main>
  )
}
