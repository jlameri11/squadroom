'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export type ActiveLink = {
  id: string
  url: string
  useCount: number
  maxUses: number | null
  expiresAt: string
}

/**
 * The team's way in: a link to paste into the group parents already use, and
 * a QR to hold up at training.
 */
export function JoinLinkPanel({
  teamId,
  academyId,
  link,
  qrSvg,
}: {
  teamId: string
  academyId: string
  link: ActiveLink | null
  qrSvg: string | null
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showQr, setShowQr] = useState(false)

  async function create() {
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { data: auth } = await supabase.auth.getUser()

    const { error } = await supabase.from('join_links').insert({
      academy_id: academyId,
      team_id: teamId,
      role: 'parent',
      created_by: auth.user!.id,
    })

    setBusy(false)
    if (error) return setError(error.message)
    router.refresh()
  }

  async function revoke() {
    if (!link) return
    setBusy(true)
    const supabase = createClient()
    // Revoking stops new people joining. It does not touch anyone already in.
    const { error } = await supabase
      .from('join_links')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', link.id)
    setBusy(false)
    if (error) return setError(error.message)
    router.refresh()
  }

  async function copy() {
    if (!link) return
    await navigator.clipboard.writeText(link.url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!link) {
    return (
      <section className="rounded-xl border border-neutral-200 p-4">
        <h2 className="font-semibold">Bring this team in</h2>
        <p className="mt-1 text-sm text-neutral-500">
          Create a link, paste it into the team&apos;s WhatsApp group, and approve people as they
          appear. Nothing is sent by text.
        </p>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <button
          onClick={create}
          disabled={busy}
          className="mt-3 w-full rounded-xl px-4 py-3 font-medium text-white disabled:opacity-50"
          style={{ background: '#202842' }}
        >
          {busy ? 'Creating…' : 'Create join link'}
        </button>
      </section>
    )
  }

  const expires = new Date(link.expiresAt).toLocaleDateString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric',
  })

  return (
    <section className="rounded-xl border border-neutral-200 p-4">
      <h2 className="font-semibold">Join link</h2>
      <p className="mt-1 break-all text-sm" style={{ color: '#202842' }}>{link.url}</p>
      <p className="mt-1 text-sm text-neutral-500">
        Used {link.useCount}{link.maxUses ? ` of ${link.maxUses}` : ' times'} · expires {expires}
      </p>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <div className="mt-3 flex gap-2">
        <button
          onClick={copy}
          className="flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-white"
          style={{ background: '#202842' }}
        >
          {copied ? 'Copied' : 'Copy link'}
        </button>
        <button
          onClick={() => setShowQr((v) => !v)}
          className="rounded-xl border border-neutral-300 px-4 py-2.5 text-sm"
        >
          {showQr ? 'Hide QR' : 'QR code'}
        </button>
        <button
          onClick={revoke}
          disabled={busy}
          className="rounded-xl border border-neutral-300 px-4 py-2.5 text-sm text-red-600 disabled:opacity-50"
        >
          Revoke
        </button>
      </div>

      {showQr && qrSvg && (
        <div className="mt-4 flex flex-col items-center gap-2">
          <div className="rounded-xl bg-white p-2" dangerouslySetInnerHTML={{ __html: qrSvg }} />
          <p className="text-center text-xs text-neutral-500">
            Hold this up at training. Revoking it later never removes anyone already in.
          </p>
        </div>
      )}
    </section>
  )
}
