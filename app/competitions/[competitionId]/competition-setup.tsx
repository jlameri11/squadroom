'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export type SetupStep = { id: string; label: string; done: boolean; href: string; detail: string | null }
/** What competition_setup (0287) returns: the steps in order, each with what is missing. */
export type CompetitionSetupData = {
  competition_id: string
  name: string
  published: boolean
  steps: SetupStep[]
  done: number
  total: number
  complete: boolean
}

const SIZES = [
  ['full', 'Full field'],
  ['half', 'Half field'],
  ['third', 'Third of a field'],
  ['quarter', 'Quarter'],
] as const

/**
 * The Setup tab (Joey, 16 Nov 2026): a league set up in thirty minutes,
 * self-serve. Venues & pitches → the competition → divisions & rules →
 * invite clubs / open entries → entry fees → referees → build & check the
 * draw → publish. Every tick is read from the data; each step is one tap
 * away. Three steps live here because nowhere else had them: a division
 * named before any club enters it, "no entry fee" as a decision, and
 * publishing. The tab goes away once the competition is published.
 */
export function CompetitionSetup({
  setup, competitionId, divisions, onTab, publish, rules,
}: {
  setup: CompetitionSetupData
  competitionId: string
  divisions: string[]
  /** Switch this screen's tab — the steps that live on another tab open it rather than reloading. */
  onTab: (tab: string) => void
  /** The publish control, rendered by the parent so this file does not reach back into it. */
  publish: React.ReactNode
  /** The rules per division, when there are divisions. */
  rules: React.ReactNode
}) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [age, setAge] = useState('')
  const [size, setSize] = useState<string>('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const step = (id: string) => setup.steps.find((s) => s.id === id)

  /** A step's link: a tab of this screen switches in place; anything else is a page. */
  function open(s: SetupStep) {
    const m = s.href.match(/^\/competitions\/[0-9a-f-]{36}\?tab=([a-z]+)(?:#([a-z]+))?$/)
    if (!m) return
    onTab(m[1])
    if (m[2]) setTimeout(() => document.getElementById(m[2])?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  async function addDivision(e: React.FormEvent) {
    e.preventDefault()
    setBusy('division')
    setError(null)
    const { error } = await createClient().rpc('add_division', {
      p_competition: competitionId, p_division: name, p_age_group: age || undefined, p_pitch_size: size || undefined,
    })
    setBusy(null)
    if (error) return setError(error.message)
    setName('')
    setAge('')
    setSize('')
    router.refresh()
  }

  async function noFee() {
    setBusy('fees')
    setError(null)
    const { error } = await createClient().rpc('mark_entry_fees_free', { p_competition: competitionId })
    setBusy(null)
    if (error) return setError(error.message)
    router.refresh()
  }

  const fees = step('fees')

  return (
    <div className="p-4" data-competition-setup>
      <section className="card p-3.5">
        <div className="flex items-center justify-between">
          <span className="eyebrow">Setting up</span>
          <span className="pill" data-setup-count>{setup.done} of {setup.total}</span>
        </div>
        <p className="mt-1 text-xs text-ink-3">In order, each one tap away. The ticks come from what is in the competition, not from this list.</p>
        <ol className="mt-3 divide-y" style={{ borderColor: 'var(--line-2)' }}>
          {setup.steps.map((s, i) => {
            const inner = (
              <>
                <span className="grid h-7 w-7 flex-none place-items-center rounded-full text-xs font-bold" style={s.done ? { background: 'var(--yes)', color: 'var(--yes-ink)' } : { background: 'var(--surface-2)', color: 'var(--ink-2)' }}>
                  {s.done ? '✓' : i + 1}
                </span>
                <span className="min-w-0 flex-1 text-left">
                  <span className="block font-medium">{s.label}</span>
                  {s.detail && <span className="block truncate text-xs text-ink-3">{s.detail}</span>}
                </span>
                <span className="flex-none text-ink-3">›</span>
              </>
            )
            const local = /^\/competitions\/[0-9a-f-]{36}\?tab=/.test(s.href)
            return (
              <li key={s.id}>
                {local ? (
                  <button type="button" onClick={() => open(s)} className="tap flex w-full items-center gap-3 py-3" data-setup-step={s.id} data-done={s.done ? '1' : '0'}>
                    {inner}
                  </button>
                ) : (
                  <Link href={s.href} className="flex items-center gap-3 py-3" data-setup-step={s.id} data-done={s.done ? '1' : '0'}>
                    {inner}
                  </Link>
                )}
              </li>
            )
          })}
        </ol>
      </section>

      {/* .sect is a header ROW (eyebrow left, action right); the content stacks under it. */}
      <section className="mt-4" id="divisions">
        <div className="sect"><span className="eyebrow">Divisions & rules</span></div>
        {divisions.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5" data-divisions>
            {divisions.map((d) => <span key={d} className="pill">{d}</span>)}
          </div>
        ) : (
          <p className="mt-1 text-sm text-ink-2">Name the divisions clubs will enter — U12 Division 1, Over 35s — before anyone has.</p>
        )}
        <form onSubmit={addDivision} className="card mt-2 flex flex-col gap-2 p-3" data-add-division>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Division name, e.g. U12 Division 1" required minLength={2}
                 className="rounded-xl border border-[var(--line)] px-3 py-2.5 text-sm" data-division-name />
          <div className="flex gap-2">
            <input value={age} onChange={(e) => setAge(e.target.value)} placeholder="Age group, e.g. U12" className="min-w-0 flex-1 rounded-xl border border-[var(--line)] px-3 py-2.5 text-sm" data-division-age />
            <select value={size} onChange={(e) => setSize(e.target.value)} className="min-w-0 flex-1 rounded-xl border border-[var(--line)] px-3 py-2.5 text-sm" data-division-size aria-label="Pitch size">
              <option value="">Pitch size</option>
              {SIZES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <button type="submit" disabled={busy === 'division' || name.trim().length < 2} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-brand-ink disabled:opacity-50" style={{ background: 'var(--brand)' }}>
            {busy === 'division' ? 'Adding…' : 'Add the division'}
          </button>
        </form>
        {rules}
      </section>

      <section className="mt-4" id="fees">
        <div className="sect"><span className="eyebrow">Entry fees</span></div>
        <p className="mt-1 text-sm text-ink-2" data-fees-state>{fees?.detail}</p>
        {!fees?.done && (
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => onTab('clubs')} className="flex-1 rounded-xl border px-3 py-2.5 text-sm font-semibold" style={{ borderColor: 'var(--brand)', color: 'var(--brand-text)' }} data-set-fees>
              Set a fee
            </button>
            <button type="button" onClick={noFee} disabled={busy === 'fees'} className="flex-1 rounded-xl border px-3 py-2.5 text-sm font-semibold disabled:opacity-50" style={{ borderColor: 'var(--line)' }} data-no-fee>
              {busy === 'fees' ? 'Saving…' : 'No entry fee'}
            </button>
          </div>
        )}
        {fees?.done && (
          <button type="button" onClick={() => onTab('clubs')} className="mt-2 text-xs text-ink-2 underline underline-offset-4">Change the fees</button>
        )}
      </section>

      <section className="mt-4" id="publish">
        <div className="sect"><span className="eyebrow">Publish</span></div>
        <p className="mt-1 text-sm text-ink-2">The public page every family sees — the draw, results and ladders, no child&apos;s name. Once it is live this tab goes away and entries can open.</p>
        {publish}
      </section>

      {error && <p className="mt-3 text-sm" style={{ color: 'var(--no)' }} data-setup-error>{error}</p>}
    </div>
  )
}
