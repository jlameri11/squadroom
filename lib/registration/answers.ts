import type { Question } from '@/components/question-field'

/**
 * Answers, checked against the questions that were actually asked.
 *
 * The register page is public, so what arrives is whatever a browser sent:
 * answers to questions the program does not have, a "maybe" to a yes/no, a
 * date that is not one, and a required question left blank by a form that
 * was edited in the inspector. The database stores the answers as given —
 * `answers jsonb` has no way to know the questions — so this is where the
 * form's rules are made true for every caller and not only for the honest
 * one.
 *
 * Unknown ids are DROPPED, not refused. A club that deleted a question
 * while a parent had the form open should get that parent's registration,
 * minus the answer to a question that no longer exists.
 *
 * Returns the cleaned answers, or the first thing wrong in words a parent
 * can act on.
 */
export function cleanAnswers(
  questions: Question[] | null | undefined,
  raw: unknown
): { ok: true; answers: Record<string, string> } | { ok: false; error: string } {
  const given =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {}
  const out: Record<string, string> = {}

  for (const q of questions ?? []) {
    const v = typeof given[q.id] === 'string' ? (given[q.id] as string).trim() : ''
    if (!v) {
      if (q.required) return { ok: false, error: `Please answer “${q.label}”.` }
      continue
    }
    if (v.length > 1000) return { ok: false, error: `The answer to “${q.label}” is too long.` }

    switch (q.type ?? 'text') {
      case 'yesno':
        if (v !== 'yes' && v !== 'no') {
          return { ok: false, error: `“${q.label}” is a yes or no question.` }
        }
        break
      case 'choice':
        if (!(q.options ?? []).includes(v)) {
          return { ok: false, error: `Pick one of the options for “${q.label}”.` }
        }
        break
      case 'date':
        // A real calendar date, not just the shape of one: 2026-02-31 has
        // the shape. Built in UTC so the check does not depend on the
        // server's zone.
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !isCalendarDate(v)) {
          return { ok: false, error: `“${q.label}” needs a date.` }
        }
        break
    }
    out[q.id] = v
  }

  return { ok: true, answers: out }
}

function isCalendarDate(v: string) {
  const [y, m, d] = v.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}
