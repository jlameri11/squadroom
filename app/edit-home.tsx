'use client'

import { useState } from 'react'
import { Sheet } from '@/components/sheet'
import { createClient } from '@/lib/supabase/client'
import { SECTIONS, type SectionId } from '@/lib/home-sections'

/**
 * Arranging your own home screen.
 *
 * Up and down buttons rather than drag-and-drop. Dragging on a phone fights
 * the scroll, needs a long press nobody discovers, and is unusable with a
 * screen reader — and the list is at most six items, where two taps to move
 * something is not a hardship. The fancier interaction would be worse at the
 * job.
 *
 * Changes are held locally until Save, so a half-rearranged screen is never
 * written. "Back to the default" clears the saved layout rather than writing
 * the current default, so somebody who resets today still gets a section
 * added in a later release.
 */
export function EditHome({
  sections,
  available,
  customised,
  onClose,
  onSaved,
}: {
  sections: SectionId[]
  available: SectionId[]
  customised: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [on, setOn] = useState<SectionId[]>(sections)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const off = available.filter((id) => !on.includes(id))

  function move(index: number, by: number) {
    const next = [...on]
    const target = index + by
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    setOn(next)
  }

  async function save(reset = false) {
    setBusy(true)
    setError(null)
    const { error } = await createClient().rpc('set_home_sections', {
      // null is "go back to whatever the default is for my role", which is
      // not the same as saving today's default.
      p_sections: reset ? null : (on as unknown as never),
    })
    setBusy(false)
    if (error) return setError(error.message)
    onSaved()
  }

  return (
    <Sheet onClose={onClose}>
      <div className="p-4">
        <h2 className="display text-[22px] leading-tight">Your home screen</h2>
        <p className="mt-0.5 text-sm text-ink-2">
          Choose what you see and the order it comes in. Only you see this.
        </p>

        <div className="mt-4">
          <span className="eyebrow">On your home screen</span>
          <ul className="card mt-1.5 overflow-hidden">
            {on.map((id, i) => {
              const section = SECTIONS.find((s) => s.id === id)
              return (
                <li
                  key={id}
                  className="flex items-center gap-2 border-t px-3 py-2.5 first:border-t-0"
                  style={{ borderColor: 'var(--line-2)' }}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {section?.label ?? id}
                    </span>
                    <span className="block truncate text-xs text-ink-3">{section?.hint}</span>
                  </span>

                  <span className="flex flex-none items-center gap-1">
                    <button
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      aria-label={`Move ${section?.label} up`}
                      className="grid h-8 w-8 place-items-center rounded-lg text-ink-2 disabled:opacity-25"
                      style={{ background: 'var(--surface-2)' }}
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => move(i, 1)}
                      disabled={i === on.length - 1}
                      aria-label={`Move ${section?.label} down`}
                      className="grid h-8 w-8 place-items-center rounded-lg text-ink-2 disabled:opacity-25"
                      style={{ background: 'var(--surface-2)' }}
                    >
                      ↓
                    </button>
                    <button
                      onClick={() => setOn(on.filter((x) => x !== id))}
                      aria-label={`Remove ${section?.label}`}
                      className="grid h-8 w-8 place-items-center rounded-lg"
                      style={{ background: 'var(--no-bg)', color: 'var(--no)' }}
                    >
                      −
                    </button>
                  </span>
                </li>
              )
            })}
            {on.length === 0 && (
              <li className="p-4 text-center text-sm text-ink-3">
                Nothing on it. Add something below.
              </li>
            )}
          </ul>
        </div>

        {off.length > 0 && (
          <div className="mt-4">
            <span className="eyebrow">Available</span>
            <ul className="card mt-1.5 overflow-hidden">
              {off.map((id) => {
                const section = SECTIONS.find((s) => s.id === id)
                return (
                  <li
                    key={id}
                    className="flex items-center gap-2 border-t px-3 py-2.5 first:border-t-0"
                    style={{ borderColor: 'var(--line-2)' }}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {section?.label ?? id}
                      </span>
                      <span className="block truncate text-xs text-ink-3">{section?.hint}</span>
                    </span>
                    <button
                      onClick={() => setOn([...on, id])}
                      aria-label={`Add ${section?.label}`}
                      className="grid h-8 w-8 flex-none place-items-center rounded-lg text-white"
                      style={{ background: 'var(--brand)' }}
                    >
                      ＋
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {error && (
          <p
            className="mt-3 rounded-lg px-3 py-2.5 text-sm"
            style={{ background: 'var(--no-bg)', color: 'var(--no)' }}
          >
            {error}
          </p>
        )}

        <button
          onClick={() => save(false)}
          disabled={busy}
          className="mt-4 w-full rounded-xl px-4 py-3 font-semibold text-white disabled:opacity-50"
          style={{ background: 'var(--brand)' }}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>

        {customised && (
          <button
            onClick={() => save(true)}
            disabled={busy}
            className="mt-2 w-full text-sm underline underline-offset-4 text-ink-2"
          >
            Back to the default
          </button>
        )}
      </div>
    </Sheet>
  )
}
