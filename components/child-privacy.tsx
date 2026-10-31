'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

type Privacy = {
  club: string
  club_rule: 'off' | 'initials' | 'full'
  name_hidden: boolean
  effective_public_name: string
  has_photo: boolean
  card_audience: string[]
  public_squads: string[]
  consents: { title: string; kind: string; version: number; accepted: boolean | null; at: string | null }[]
  medical_readers: string
  phone_rule: string
}

/**
 * W-04: one place for a child's privacy. The facts come from
 * child_privacy, which reads the same rules the product enforces, so this
 * screen cannot describe a policy the code does not implement.
 */
export function ChildPrivacy({ playerId, firstName }: { playerId: string; firstName: string }) {
  const [p, setP] = useState<Privacy | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await createClient().rpc('child_privacy', { p_player: playerId })
    if (error) return setError(error.message)
    setP(data as unknown as Privacy)
  }, [playerId])

  useEffect(() => {
    ;(async () => {
      await load()
    })()
  }, [load])

  async function setHidden(hidden: boolean) {
    setBusy(true)
    setError(null)
    const { error } = await createClient().rpc('set_child_public_name', { p_player: playerId, p_hidden: hidden })
    setBusy(false)
    if (error) return setError(error.message)
    await load()
  }

  if (!p) return error ? <p className="text-xs" style={{ color: 'var(--no)' }}>{error}</p> : null
  const rule = p.club_rule === 'full' ? 'full names' : p.club_rule === 'initials' ? 'first name and initial' : 'no names'

  return (
    <div className="text-sm">
      <div className="rounded-lg p-3" style={{ background: 'var(--surface-2)' }}>
        <p className="font-medium">On public pages: {p.effective_public_name}</p>
        <p className="mt-0.5 text-xs text-ink-3">
          {p.club} publishes {rule} on its competition pages{p.public_squads.length ? ` (${p.public_squads.join(', ')})` : ''}. Your choice wins over the club&apos;s.
        </p>
        <label className="mt-2 flex items-center gap-2 text-xs">
          <input type="checkbox" checked={p.name_hidden} disabled={busy} onChange={(e) => void setHidden(e.target.checked)} />
          Never name {firstName} on a public page
        </label>
      </div>

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
        <dt className="text-ink-3">Photo</dt>
        <dd>
          {p.has_photo ? 'On the match-day card only, never published.' : 'None.'}{' '}
          <Link href={`/card/${playerId}`} className="underline underline-offset-2" style={{ color: 'var(--brand-text)' }}>{p.has_photo ? 'Change or remove' : 'Add one'}</Link>
        </dd>
        <dt className="text-ink-3">Card</dt>
        <dd>Opens for: {p.card_audience.join('; ')}.</dd>
        <dt className="text-ink-3">Medical</dt>
        <dd>{p.medical_readers}.</dd>
        <dt className="text-ink-3">Your phone</dt>
        <dd>{p.phone_rule === 'all' ? `Any member of ${p.club} can see it (the club's setting).` : `${p.club}'s coaches and admins only.`}</dd>
        <dt className="text-ink-3">Agreements</dt>
        <dd>
          {p.consents.length === 0 ? 'None asked.' : `${p.consents.filter((c) => c.accepted === true).length} of ${p.consents.length} agreed — each one, with its version, is above.`}
        </dd>
        <dt className="text-ink-3">Your data</dt>
        <dd>
          <Link href="/settings" className="underline underline-offset-2" style={{ color: 'var(--brand-text)' }}>Download everything we hold, or erase it</Link>, from Settings.
        </dd>
      </dl>
      <p className="mt-2 text-xs text-ink-3">
        No ads, no tracking, nothing sold, and no account for {firstName}: children open the public page in a browser and that is all.{' '}
        <Link href="/privacy" className="underline underline-offset-2">Read the notice written for them.</Link>
      </p>
      {error && <p className="mt-1 text-xs" style={{ color: 'var(--no)' }}>{error}</p>}
    </div>
  )
}
