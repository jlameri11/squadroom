'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

/**
 * What the league calls this squad.
 *
 * Our U8s are "U8 SPL" here and "NRFA U7  navy" in Dribl — a different age
 * group and two spaces, because the league counts differently and somebody
 * typed twice. Recording it is what lets one export of the whole club be
 * imported once and land in the right squads, and it is also what tells the
 * importer which side of each game was ours, so it stops having to ask.
 *
 * Paste it, do not type it. The value has to match what actually arrives in
 * the file, and a tidied-up version of it matches nothing — so the help text
 * says paste, and the match is whitespace- and case-insensitive to survive a
 * league secretary adding a trailing space.
 */
export function LeagueName({
  teamId,
  name,
  externalRef,
  skipImport,
}: {
  teamId: string
  name: string
  externalRef: string | null
  skipImport: boolean
}) {
  const [value, setValue] = useState(externalRef ?? '')
  const [skip, setSkip] = useState(skipImport)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(next?: { skip?: boolean }) {
    setBusy(true)
    setError(null)
    setSaved(false)
    const { error } = await createClient()
      .from('teams')
      .update({
        external_ref: value.trim() || null,
        skip_import: next?.skip ?? skip,
      })
      .eq('id', teamId)
    setBusy(false)
    if (error) {
      // The unique index is the one failure worth translating: two squads
      // claiming the same league name would make routing a coin toss, and the
      // row that lost would quietly get no fixtures.
      return setError(
        error.code === '23505'
          ? 'Another squad here already uses that league name.'
          : error.message
      )
    }
    setSaved(true)
  }

  return (
    <section className="mt-5 rounded-xl border p-4" style={{ borderColor: 'var(--line)' }}>
      <h2 className="font-semibold">What the league calls {name}</h2>
      <p className="mt-1 text-xs text-ink-2">
        Paste the team name exactly as it appears in your Dribl export — spacing and all.
        Then one export of the whole club can be imported in one go, and the importer stops
        asking which side you were.
      </p>

      <input
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          setSaved(false)
        }}
        placeholder="NRFA U7  navy"
        className="mt-2 w-full rounded-lg border px-3 py-2.5 text-base"
        style={{ borderColor: 'var(--line)' }}
      />

      <label className="mt-3 flex gap-2 text-sm">
        <input
          type="checkbox"
          checked={skip}
          onChange={(e) => {
            setSkip(e.target.checked)
            void save({ skip: e.target.checked })
          }}
          className="mt-0.5 flex-none"
        />
        <span>
          <span className="font-medium">Leave this squad out of imports</span>
          {/* Not tidiness. A club can have a side that exists in the league
              draw and that nobody in this app answers for, and importing its
              games puts fixtures in the calendars of families who have
              nothing to do with it. */}
          <span className="mt-0.5 block text-xs text-ink-2">
            For a side that is in the league draw but has no families here.
          </span>
        </span>
      </label>

      {error && (
        <p className="mt-2 text-sm" style={{ color: 'var(--no)' }}>
          {error}
        </p>
      )}

      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={() => void save()}
          disabled={busy || value.trim() === (externalRef ?? '')}
          className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: 'var(--brand)' }}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        {saved && (
          <span className="text-sm" style={{ color: 'var(--yes)' }}>
            Saved
          </span>
        )}
      </div>
    </section>
  )
}
