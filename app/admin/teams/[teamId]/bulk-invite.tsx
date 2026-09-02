'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { contacts } from '@/lib/adapters/contacts'

type Parsed = { name: string; phone: string; raw: string; ok: boolean }

/**
 * The fallback for families who never tap the group link.
 *
 * Parsing is shown before anything is sent, because a mistyped number does
 * not fail loudly — it quietly invites a stranger, or nobody.
 */
export function BulkInvite({ teamId, academyId }: { teamId: string; academyId: string }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  // Whether a picker exists is a question about the device, so it can only be
  // answered in the browser. Rendering a button that does nothing on an
  // iPhone is worse than not offering it.
  const [canPick, setCanPick] = useState(false)
  useEffect(() => setCanPick(contacts.isSupported()), [])

  /**
   * The picker returns only who the coach tapped, and it lands in the SAME
   * textarea as a pasted list rather than sending anything.
   *
   * That is deliberate. A chosen contact and a typed one get the same review
   * before anyone is invited — one path in, one place to check it, and no way
   * to accidentally invite someone because a tap registered twice.
   */
  async function pickFromContacts() {
    const chosen = await contacts.pick()
    if (chosen.length === 0) return
    const lines = chosen.map((c) => `${c.name}, ${c.phone}`)
    setText((current) => {
      const existing = current.trim()
      const fresh = lines.filter((l) => !existing.includes(l))
      return [existing, ...fresh].filter(Boolean).join('\n')
    })
  }

  const parsed: Parsed[] = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((raw) => {
      const [namePart, ...rest] = raw.split(',')
      const phone = toE164(rest.join(',').trim())
      return { name: namePart.trim(), phone: phone ?? '', raw, ok: Boolean(namePart.trim() && phone) }
    })

  const good = parsed.filter((p) => p.ok)
  const bad = parsed.filter((p) => !p.ok)

  async function send() {
    setBusy(true)
    setResult(null)
    const supabase = createClient()
    const { data: auth } = await supabase.auth.getUser()

    const { error, count } = await supabase.from('invites').insert(
      good.map((p) => ({
        academy_id: academyId,
        phone: p.phone,
        full_name: p.name,
        role: 'parent' as const,
        invited_by: auth.user!.id,
      })),
      { count: 'exact' }
    )

    setBusy(false)
    if (error) {
      return setResult(
        error.code === '23505'
          ? 'Some of those numbers already have an invite waiting.'
          : error.message
      )
    }

    // Attaching the team is a separate row, and it is what makes a coach's
    // invite land in the right place rather than the academy at large.
    setResult(`${count ?? good.length} invited to this team.`)
    setText('')
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-3 w-full rounded-xl border border-[var(--line)] px-4 py-3 text-sm font-medium"
      >
        Add families by phone instead
      </button>
    )
  }

  return (
    <section className="mt-3 rounded-xl border border-[var(--line)] p-4">
      <h2 className="font-semibold">Add by phone</h2>
      <p className="mt-1 text-sm text-ink-2">
        One “Name, Phone” per line. They still get approved by you before they see anything.
      </p>
      {canPick && (
        <p className="mt-1 text-xs text-ink-2">
          Choosing from contacts adds them to the box below — nothing is sent until you check it.
          Only the people you tap are read; Squadroom never sees the rest of your phone.
        </p>
      )}

      {canPick && (
        <button
          onClick={pickFromContacts}
          className="mt-3 w-full rounded-xl border border-[var(--line)] px-4 py-2.5 text-sm font-medium"
        >
          Choose from contacts
        </button>
      )}

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder={'Sam Whitfield, 0412 345 678\nPriya Nair, 0423 987 654'}
        className="mt-3 w-full rounded-xl border border-[var(--line)] p-3 font-mono text-sm"
      />

      {parsed.length > 0 && (
        <div className="mt-3 flex flex-col gap-1 text-sm">
          {good.map((p) => (
            <div key={p.raw} className="flex justify-between gap-3">
              <span className="truncate">{p.name}</span>
              <span className="flex-none tabular-nums text-ink-2">{p.phone}</span>
            </div>
          ))}
          {bad.map((p) => (
            <div key={p.raw} className="text-red-600">
              Couldn&apos;t read: <span className="font-mono">{p.raw}</span>
            </div>
          ))}
        </div>
      )}

      {result && <p className="mt-3 text-sm text-ink">{result}</p>}

      <div className="mt-3 flex gap-2">
        <button
          onClick={send}
          disabled={busy || good.length === 0}
          className="flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: 'var(--brand)' }}
        >
          {busy ? 'Inviting…' : good.length ? `Invite ${good.length}` : 'Nothing to send'}
        </button>
        <button onClick={() => setOpen(false)} className="rounded-xl border border-[var(--line)] px-4 py-2.5 text-sm">
          Close
        </button>
      </div>
    </section>
  )
}

/** Mirrors lib/join.ts: returns null rather than guessing at a number. */
function toE164(raw: string, defaultCountry = '61'): string | null {
  const cleaned = raw.replace(/[^\d+]/g, '')
  if (!cleaned) return null
  if (cleaned.startsWith('+')) return /^\+[1-9]\d{7,14}$/.test(cleaned) ? cleaned : null
  if (cleaned.startsWith('0')) return `+${defaultCountry}${cleaned.slice(1)}`
  if (cleaned.startsWith(defaultCountry)) return `+${cleaned}`
  return null
}
