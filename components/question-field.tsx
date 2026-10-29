'use client'

/**
 * A question a program asks, drawn the way its type says.
 *
 * Shared by the public register form and the signed-in one, which rendered
 * the same question differently before — and both as a text box, whatever
 * its type. A yes/no question was a box somebody typed "yes" into, and the
 * club then read "Yes", "yes", "Y", "yep" and "yes please" in its queue.
 *
 * Values are strings throughout, so the answers object stays flat JSON:
 * yes/no answers are 'yes' or 'no', a choice is the option's text, a date
 * is yyyy-mm-dd.
 */
export type Question = {
  id: string
  label: string
  type?: 'text' | 'choice' | 'yesno' | 'date'
  required?: boolean
  options?: string[]
}

export function QuestionField({
  question: q,
  value,
  onChange,
  tint = 'var(--brand)',
}: {
  question: Question
  value: string
  onChange: (v: string) => void
  tint?: string
}) {
  const type = q.type ?? 'text'
  const label = (
    <span className="text-sm text-ink-2">
      {q.label}
      {q.required ? <span style={{ color: 'var(--no)' }}> *</span> : null}
    </span>
  )

  if (type === 'yesno' || type === 'choice') {
    const options = type === 'yesno' ? ['Yes', 'No'] : (q.options ?? [])
    const valueOf = (o: string) => (type === 'yesno' ? o.toLowerCase() : o)
    return (
      <fieldset className="mt-3">
        <legend>{label}</legend>
        {/* Wrapping, so a choice with six options reads as six pills on a
            phone rather than a row scrolling off the edge. */}
        <div className="mt-1 flex flex-wrap gap-1.5">
          {options.map((o) => {
            const v = valueOf(o)
            const on = value === v
            return (
              <button
                key={o}
                type="button"
                onClick={() => onChange(on ? '' : v)}
                aria-pressed={on}
                className="rounded-lg border px-3 py-2 text-sm font-semibold"
                style={
                  on
                    ? { borderColor: tint, background: 'var(--brand-faint)', color: tint }
                    : { borderColor: 'var(--line)', color: 'var(--ink-2)' }
                }
              >
                {o}
              </button>
            )
          })}
        </div>
      </fieldset>
    )
  }

  return (
    <label className="mt-3 block text-sm">
      {label}
      <input
        type={type === 'date' ? 'date' : 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 w-full rounded-lg border px-3 py-2.5 text-base"
        style={{ borderColor: 'var(--line)' }}
      />
    </label>
  )
}

/** The required questions this set of answers has not answered. */
export function unanswered(questions: Question[] | null | undefined, answers: Record<string, string>) {
  return (questions ?? []).filter((q) => q.required && !(answers[q.id] ?? '').trim())
}
