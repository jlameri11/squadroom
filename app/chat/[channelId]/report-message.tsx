'use client'

import { useState } from 'react'
import { Sheet } from '@/components/sheet'
import { createClient } from '@/lib/supabase/client'

const REASONS = [
  { value: 'safeguarding', label: "A child's welfare", hint: 'Anything that worries you about a child' },
  { value: 'inappropriate', label: 'Inappropriate', hint: 'Language, content or tone' },
  { value: 'bullying', label: 'Bullying', hint: 'Aimed at someone' },
  { value: 'wrong_channel', label: 'Wrong place', hint: 'A private matter in a team chat' },
  { value: 'spam', label: 'Spam', hint: '' },
  { value: 'other', label: 'Something else', hint: '' },
] as const

/**
 * Reporting a message to the club's safeguarding officer.
 *
 * A child's welfare is FIRST in the list, not buried under "inappropriate"
 * and "spam". Somebody reaching for this is most often worried rather than
 * annoyed, and the order of a list is an instruction about what it is for.
 *
 * It says plainly what happens next, because the two things a person wants to
 * know before tapping are whether the sender will find out and whether
 * anything disappears. Both answers are no: a report asks a human to look.
 *
 * The sender can never see the report, and never learns who made it. That is
 * enforced in the database (0108), not here — a parent should not have to
 * trust a sentence in a sheet.
 */
export function ReportMessage({
  messageId,
  senderName,
  onClose,
}: {
  messageId: string
  senderName: string | null
  onClose: () => void
}) {
  const [reason, setReason] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function send() {
    if (!reason) return
    setBusy(true)
    setError(null)
    const { error } = await createClient().rpc('report_message', {
      p_message: messageId,
      p_reason: reason as never,
      p_note: note.trim() || undefined,
    })
    setBusy(false)
    if (error) return setError(error.message)
    setDone(true)
  }

  if (done) {
    return (
      <Sheet onClose={onClose}>
        <div className="p-5 text-center">
          <p className="display text-[22px] leading-tight">Thank you — that&apos;s been sent</p>
          <p className="mt-1.5 text-sm text-ink-2">
            Your club&apos;s safeguarding officer will look at it. They can see what you wrote;{' '}
            {senderName ?? 'the sender'} cannot, and will not be told who reported it.
          </p>
          <button
            onClick={onClose}
            className="mt-4 w-full rounded-xl px-4 py-3 font-semibold text-white"
            style={{ background: 'var(--brand)' }}
          >
            Done
          </button>
        </div>
      </Sheet>
    )
  }

  return (
    <Sheet onClose={onClose}>
      <div className="p-4">
        <h2 className="display text-[22px] leading-tight">Report this message</h2>
        <p className="mt-0.5 text-sm text-ink-2">
          It goes to your club&apos;s safeguarding officer. Nothing is deleted and{' '}
          {senderName ?? 'the sender'} is not told.
        </p>

        <div className="mt-4 flex flex-col gap-2">
          {REASONS.map((r) => (
            <button
              key={r.value}
              onClick={() => setReason(r.value)}
              aria-pressed={reason === r.value}
              className="flex items-start gap-3 rounded-xl border p-3 text-left"
              style={{
                borderColor: reason === r.value ? 'var(--brand)' : 'var(--line)',
                background: reason === r.value ? 'var(--surface-2)' : 'var(--surface)',
              }}
            >
              <span
                className="mt-0.5 grid h-4 w-4 flex-none place-items-center rounded-full border"
                style={{
                  borderColor: reason === r.value ? 'var(--brand)' : 'var(--line)',
                  background: reason === r.value ? 'var(--brand)' : 'transparent',
                }}
              />
              <span className="min-w-0">
                <span className="block font-medium">{r.label}</span>
                {r.hint && <span className="block text-sm text-ink-3">{r.hint}</span>}
              </span>
            </button>
          ))}
        </div>

        <label className="mt-3 flex flex-col gap-1.5">
          <span className="eyebrow">Anything you want to add</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="In your own words — the officer reads this"
            className="rounded-xl border px-3.5 py-3 text-base"
            style={{ borderColor: 'var(--line)' }}
          />
        </label>

        {error && (
          <p
            className="mt-3 rounded-lg px-3 py-2.5 text-sm"
            style={{ background: 'var(--no-bg)', color: 'var(--no)' }}
          >
            {error}
          </p>
        )}

        <button
          onClick={send}
          disabled={busy || !reason}
          className="mt-4 w-full rounded-xl px-4 py-3 font-semibold text-white disabled:opacity-50"
          style={{ background: 'var(--brand)' }}
        >
          {busy ? 'Sending…' : reason ? 'Send to the safeguarding officer' : 'Choose a reason'}
        </button>
      </div>
    </Sheet>
  )
}
