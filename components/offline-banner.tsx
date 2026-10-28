'use client'

import { useEffect, useState } from 'react'
import { useOutbox } from '@/lib/offline/use-outbox'

/**
 * What is waiting to be sent.
 *
 * X-09. The point is not to announce that the network is down — a phone
 * already shows that. It is to answer the question a tap at a ground raises:
 * "did that save?" A coach who has taken a register in a dead spot needs to
 * know the twelve taps are held and will go, or they will take it again on
 * paper, which is the outcome the whole feature exists to prevent.
 *
 * Says nothing when there is nothing to say. A permanent "offline" chip
 * trains people to ignore the bar it lives in.
 */
export function OfflineBanner() {
  const waiting = useOutbox()
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    const update = () => setOffline(navigator.onLine === false)
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  if (waiting === 0 && !offline) return null

  return (
    <div
      className="px-4 py-2 text-center text-xs font-semibold"
      style={{
        background: waiting > 0 ? 'var(--maybe-bg)' : 'var(--surface-2)',
        color: waiting > 0 ? 'var(--maybe)' : 'var(--ink-2)',
      }}
      role="status"
    >
      {waiting > 0
        ? `${waiting} ${waiting === 1 ? 'change' : 'changes'} saved on this phone — ${
            offline ? 'will send when you have signal' : 'sending…'
          }`
        : 'No signal. What you tap is kept and sent when it comes back.'}
    </div>
  )
}
