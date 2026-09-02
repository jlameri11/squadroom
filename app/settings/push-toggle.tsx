'use client'

import { useEffect, useState } from 'react'
import { enablePush, disablePush, pushState, type PushState } from '@/lib/adapters/push'

export function PushToggle() {
  const [state, setState] = useState<PushState>('unsupported')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { setState(pushState()) }, [])

  async function turnOn() {
    setBusy(true)
    setError(null)
    const result = await enablePush()
    setBusy(false)
    if (!result.ok) return setError(result.reason ?? 'Could not turn those on.')
    setState('on')
  }

  async function turnOff() {
    setBusy(true)
    await disablePush()
    setBusy(false)
    setState('off')
  }

  return (
    <section className="mt-8 rounded-xl border border-[var(--line)] p-4">
      <h2 className="font-semibold">Notifications on this device</h2>

      {state === 'needs-install' && (
        <>
          <p className="mt-1 text-sm text-ink-2">
            {/* Apple's rule, stated plainly. Hiding it just makes the button
                look broken on half the phones in the club. */}
            iPhones only allow notifications once an app is on the home screen. Tap Share, then
            <b> Add to Home Screen</b>, and open Squadroom from there.
          </p>
          <p className="mt-2 text-xs text-ink-3">
            The proper App Store version removes this step.
          </p>
        </>
      )}

      {state === 'unsupported' && (
        <p className="mt-1 text-sm text-ink-2">
          This browser can&apos;t show notifications. Try it on your phone.
        </p>
      )}

      {state === 'denied' && (
        <p className="mt-1 text-sm text-ink-2">
          Notifications are blocked for this site. You&apos;ll need to allow them in your browser
          settings — we can&apos;t ask again from here.
        </p>
      )}

      {(state === 'off' || state === 'on') && (
        <>
          <p className="mt-1 text-sm text-ink-2">
            Match changes and messages in channels you haven&apos;t muted. Reminders come 24 hours
            and 2 hours before a game.
          </p>
          {error && <p className="mt-2 text-sm ">{error}</p>}
          <button
            onClick={state === 'on' ? turnOff : turnOn}
            disabled={busy}
            className="mt-3 w-full rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
            style={state === 'on'
              ? { border: '1px solid var(--line)' }
              : { background: 'var(--brand)', color: '#fff' }}
          >
            {busy ? 'Working…' : state === 'on' ? 'Turn off on this device' : 'Turn on notifications'}
          </button>
        </>
      )}
    </section>
  )
}
