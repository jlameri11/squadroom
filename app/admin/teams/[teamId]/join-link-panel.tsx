'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export type ActiveLink = {
  id: string
  url: string
  code: string
  useCount: number
  maxUses: number | null
  expiresAt: string
}

/**
 * The team's three ways in, for three ways a coach actually recruits.
 *
 * A LINK to paste into the group parents already use. A QR to hold up at
 * training. And a CODE to say out loud, write on a whiteboard or print on a
 * flyer — the one that works when the coach is not holding anybody's phone.
 *
 * All three are the same join link underneath, with the same expiry, the same
 * use limit, the same revocation and the same coach approval at the end.
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
  const [copiedCode, setCopiedCode] = useState(false)

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
      <section className="rounded-xl border border-[var(--line)] p-4">
        <h2 className="font-semibold">Bring this team in</h2>
        <p className="mt-1 text-sm text-ink-2">
          Create a link, paste it into the team&apos;s WhatsApp group, and approve people as they
          appear. Nothing is sent by text.
        </p>
        {error && <p className="mt-2 text-sm ">{error}</p>}
        <button
          onClick={create}
          disabled={busy}
          className="mt-3 w-full rounded-xl px-4 py-3 font-medium text-white disabled:opacity-50"
          style={{ background: 'var(--brand)' }}
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
    <section className="rounded-xl border border-[var(--line)] p-4">
      <h2 className="font-semibold">How parents join</h2>

      {/*
        The code first, and big. It is the only one of the three a coach can
        use without a device in their hand, and the one they will read out at
        the end of training on Saturday.
      */}
      <div
        className="mt-2.5 rounded-xl p-3 text-center"
        style={{ background: 'var(--surface-2)' }}
      >
        <p className="eyebrow">Join code</p>
        <p
          className="display mt-0.5 text-[30px] leading-none tabular-nums"
          style={{ color: 'var(--brand)', letterSpacing: '0.12em' }}
        >
          {link.code}
        </p>
        <button
          onClick={async () => {
            await navigator.clipboard.writeText(link.code)
            setCopiedCode(true)
            setTimeout(() => setCopiedCode(false), 2000)
          }}
          className="mt-1.5 text-xs underline underline-offset-4 text-ink-2"
        >
          {copiedCode ? 'Copied' : 'Copy code'}
        </button>
        <p className="mt-1.5 text-xs text-ink-3">
          They enter it at {origin()}/join
        </p>
      </div>

      <p className="mt-3 break-all text-sm" style={{ color: 'var(--brand)' }}>{link.url}</p>
      <p className="mt-1 text-sm text-ink-2">
        Used {link.useCount}{link.maxUses ? ` of ${link.maxUses}` : ' times'} · expires {expires}
      </p>

      {error && <p className="mt-2 text-sm ">{error}</p>}

      <div className="mt-3 flex gap-2">
        <button
          onClick={copy}
          className="flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-white"
          style={{ background: 'var(--brand)' }}
        >
          {copied ? 'Copied' : 'Copy link'}
        </button>
        <button
          onClick={() => setShowQr((v) => !v)}
          className="rounded-xl border border-[var(--line)] px-4 py-2.5 text-sm"
        >
          {showQr ? 'Hide QR' : 'QR code'}
        </button>
        <button
          onClick={revoke}
          disabled={busy}
          className="rounded-xl border border-[var(--line)] px-4 py-2.5 text-sm  disabled:opacity-50"
        >
          Revoke
        </button>
      </div>

      {showQr && qrSvg && (
        <div className="mt-4 flex flex-col items-center gap-2">
          <div className="rounded-xl bg-[var(--surface)] p-2" dangerouslySetInnerHTML={{ __html: qrSvg }}
          style={{ background: '#ffffff', borderRadius: 10, padding: 8 }} />
          <p className="text-center text-xs text-ink-2">
            Hold this up at training. Revoking it later never removes anyone already in.
          </p>
        </div>
      )}
    </section>
  )
}

/** The site's own origin, for telling a parent where to type the code. */
function origin() {
  if (typeof window === 'undefined') return 'squadroom.app'
  return window.location.host
}
