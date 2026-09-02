'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * A bottom sheet that actually sits on top of everything.
 *
 * These are opened from a button in the app bar, and the app bar is
 * `sticky top-0 z-20`. A positioned element with a z-index creates a stacking
 * context, so a `fixed inset-0 z-50` child of it is not competing with the
 * rest of the page at all — it is competing inside the header, and the tab
 * bar (z-20, later in the DOM) painted straight over it.
 *
 * The symptom was precise and baffling: the sheet appeared, you could fill it
 * in, and then the button along the bottom could not be pressed, because the
 * tab bar was on top of it. Create a team, start a chat, add a player — all
 * three, and only after entering the details.
 *
 * A portal to document.body is the fix. Nothing above it, so nothing to
 * escape from.
 */
export function Sheet({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // Escape closes it, and the page behind it stops scrolling — otherwise
  // flicking the sheet scrolls the list underneath and it feels broken.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [onClose])

  if (!mounted) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center"
      style={{ background: '#0E172699' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-y-auto rounded-t-2xl p-5"
        style={{
          background: 'var(--surface)',
          // Room for the phone's home indicator, and never taller than the
          // visible viewport — with a keyboard open, 90dvh still puts the
          // buttons under the keys.
          maxHeight: '88dvh',
          paddingBottom: 'max(20px, env(safe-area-inset-bottom))',
        }}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[var(--line)]" />
        {children}
      </div>
    </div>,
    document.body
  )
}
