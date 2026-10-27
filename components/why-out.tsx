'use client'

import { useState } from 'react'

/**
 * Asking why a child cannot play.
 *
 * One component, three places: the home screen, the event screen and a
 * fixture card in a chat. 0111 requires a reason on 'no' in the database, so
 * every surface that offers an "Out" button has to ask for one — and three
 * copies of this prompt would be three chances for them to drift into asking
 * differently.
 *
 * Deliberately inline rather than a sheet. A parent is answering in a car
 * park with one hand; a modal that covers the fixture they are answering
 * about is a modal they have to dismiss to check what they are saying no to.
 */
export function WhyOut({
  childName,
  busy,
  onSave,
  onCancel,
}: {
  childName: string | null
  busy?: boolean
  onSave: (note: string) => void
  onCancel: () => void
}) {
  const [note, setNote] = useState('')

  return (
    <div
      className="rounded-xl border p-3"
      style={{ borderColor: 'var(--no)', background: 'var(--no-bg)' }}
    >
      <label className="block text-sm font-medium" style={{ color: 'var(--no)' }}>
        Why can&apos;t {childName ?? 'they'} play?
      </label>
      <input
        autoFocus
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && note.trim()) onSave(note)
          if (e.key === 'Escape') onCancel()
        }}
        placeholder="Away, injured, a party — anything"
        className="mt-1.5 w-full rounded-lg border px-3 py-2.5 text-base"
        style={{ borderColor: 'var(--line)' }}
      />
      {/* Worth saying, because a parent typing "at my sister's wedding" wants
          to know it is not going in the team chat. */}
      <p className="mt-1 text-xs" style={{ color: 'var(--no)' }}>
        Only your coach sees this.
      </p>
      <div className="mt-2 flex gap-2">
        <button
          onClick={() => onSave(note)}
          disabled={!note.trim() || busy}
          className="flex-1 rounded-lg px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: 'var(--no)' }}
        >
          {busy ? 'Saving…' : 'Mark them out'}
        </button>
        <button
          onClick={onCancel}
          className="rounded-lg border px-3 py-2.5 text-sm"
          style={{ borderColor: 'var(--line)' }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
