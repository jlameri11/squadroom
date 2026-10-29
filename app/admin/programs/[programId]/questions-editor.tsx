'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Question } from '@/components/question-field'

const TYPES: { value: NonNullable<Question['type']>; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'yesno', label: 'Yes / no' },
  { value: 'choice', label: 'Pick one' },
  { value: 'date', label: 'Date' },
]

/**
 * The questions a program's form asks, written by the club.
 *
 * Before this, a club that wanted to ask "Which school?" or "Can they swim?"
 * on a tour form had to have somebody type JSON into the database, which is
 * to say no club asked anything.
 *
 * It saves the whole list at once rather than a question at a time, because
 * the questions are ONE form: the order matters, and a family half-way
 * through should not see a question appear between two they have answered.
 * The database normalises and refuses (0134) and its message is shown as-is;
 * it is the one place the rules live.
 *
 * Ids are made from the label the first time and then kept, because an
 * answer is stored against its id — renaming "Which school?" to "School" must
 * not orphan every answer already given.
 */
export function QuestionsEditor({
  programId,
  questions,
  onSaved,
}: {
  programId: string
  questions: Question[]
  onSaved: (questions: Question[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Question[]>(questions)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function update(i: number, patch: Partial<Question>) {
    setDraft(draft.map((q, j) => (j === i ? { ...q, ...patch } : q)))
  }
  function move(i: number, by: -1 | 1) {
    const j = i + by
    if (j < 0 || j >= draft.length) return
    const next = [...draft]
    ;[next[i], next[j]] = [next[j], next[i]]
    setDraft(next)
  }
  function add() {
    setDraft([...draft, { id: freshId(draft), label: '', type: 'text', required: false }])
  }

  async function save() {
    setBusy(true)
    setError(null)
    // Options arrive as one per line from the textarea; the database trims,
    // drops blanks and duplicates, and insists on two.
    const payload = draft.map((q) => ({
      ...q,
      id: q.id || freshId(draft),
      options: q.type === 'choice' ? q.options ?? [] : undefined,
    }))
    const { data, error } = await createClient()
      .from('programs')
      .update({ questions: payload as never })
      .eq('id', programId)
      .select('questions')
      .maybeSingle()
    setBusy(false)
    if (error) return setError(error.message)
    // PostgREST answers an update that matched nothing with no row and no
    // error, which is what somebody without the right sees.
    if (!data) return setError('Could not save — are you an admin of this club?')
    const saved = (data.questions ?? []) as Question[]
    setDraft(saved)
    onSaved(saved)
    setOpen(false)
  }

  if (!open) {
    return (
      <div className="card mb-4 p-3.5">
        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1 text-sm">
            <b>
              {questions.length === 0
                ? 'The form asks nothing extra'
                : `The form asks ${questions.length} ${questions.length === 1 ? 'question' : 'questions'}`}
            </b>
            {questions.length > 0 && (
              <span className="block truncate text-ink-3">
                {questions.map((q) => q.label).join(' · ')}
              </span>
            )}
          </span>
          <button
            onClick={() => {
              setDraft(questions)
              setOpen(true)
            }}
            className="flex-none rounded-xl px-3.5 py-2 text-sm font-semibold"
            style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }}
          >
            {questions.length === 0 ? 'Add questions' : 'Edit'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="card mb-4 p-3.5">
      <h2 className="eyebrow pb-2">Questions the form asks</h2>

      {draft.length === 0 && (
        <p className="pb-2 text-sm text-ink-3">
          Name, date of birth and the agreements are always asked. Add anything else this
          program needs to know.
        </p>
      )}

      <ol className="flex flex-col gap-3">
        {draft.map((q, i) => (
          <li key={q.id} className="rounded-xl border p-2.5" style={{ borderColor: 'var(--line)' }}>
            <input
              value={q.label}
              onChange={(e) => update(i, { label: e.target.value })}
              placeholder="The question, as the family will read it"
              className="w-full rounded-lg border px-3 py-2 text-base"
              style={{ borderColor: 'var(--line)' }}
              aria-label={`Question ${i + 1}`}
            />
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <select
                value={q.type ?? 'text'}
                onChange={(e) => update(i, { type: e.target.value as Question['type'] })}
                className="rounded-lg border px-2 py-1.5"
                style={{ borderColor: 'var(--line)' }}
                aria-label="Type"
              >
                {TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={Boolean(q.required)}
                  onChange={(e) => update(i, { required: e.target.checked })}
                />
                Required
              </label>
              <span className="flex-1" />
              <button onClick={() => move(i, -1)} disabled={i === 0} className="px-1.5 disabled:opacity-30" aria-label="Move up">
                ↑
              </button>
              <button onClick={() => move(i, 1)} disabled={i === draft.length - 1} className="px-1.5 disabled:opacity-30" aria-label="Move down">
                ↓
              </button>
              <button
                onClick={() => setDraft(draft.filter((_, j) => j !== i))}
                className="px-1.5"
                style={{ color: 'var(--no)' }}
                aria-label="Remove"
              >
                ✕
              </button>
            </div>
            {q.type === 'choice' && (
              <textarea
                value={(q.options ?? []).join('\n')}
                onChange={(e) => update(i, { options: e.target.value.split('\n') })}
                rows={3}
                placeholder={'One option per line, e.g.\nSmall\nMedium\nLarge'}
                className="mt-2 w-full rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--line)' }}
                aria-label="Options"
              />
            )}
          </li>
        ))}
      </ol>

      <button
        onClick={add}
        disabled={draft.length >= 20}
        className="mt-3 text-sm underline underline-offset-4 disabled:opacity-40"
        style={{ color: 'var(--brand-text)' }}
      >
        ＋ Add a question
      </button>

      {error && (
        <p className="mt-3 rounded-lg p-2.5 text-sm" style={{ background: 'var(--no-bg)', color: 'var(--no)' }}>
          {error}
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <button
          onClick={save}
          disabled={busy}
          className="flex-1 rounded-xl px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: 'var(--brand)' }}
        >
          {busy ? 'Saving…' : 'Save questions'}
        </button>
        <button
          onClick={() => {
            setDraft(questions)
            setError(null)
            setOpen(false)
          }}
          className="rounded-xl border px-3 py-2.5 text-sm"
          style={{ borderColor: 'var(--line)' }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

/** A short id nobody has used in this list. */
function freshId(existing: Question[]) {
  const taken = new Set(existing.map((q) => q.id))
  let n = existing.length + 1
  while (taken.has(`q${n}`)) n++
  return `q${n}`
}
