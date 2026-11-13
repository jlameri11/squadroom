'use client'

import { useEffect, useRef } from 'react'

/**
 * Calls `onSeen` once, a moment after the element first scrolls into view.
 *
 * For prefetching what a row leads to (the "Feels instant" pass): a chat
 * row on the list warms that chat's screen while the person is still
 * reading the list. The moment's delay keeps the list's own requests first.
 */
export function useInViewOnce<T extends HTMLElement>(onSeen: () => void, delayMs = 600) {
  const ref = useRef<T>(null)
  const latest = useRef(onSeen)
  latest.current = onSeen
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    let timer: ReturnType<typeof setTimeout> | null = null
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      io.disconnect()
      timer = setTimeout(() => latest.current(), delayMs)
    })
    io.observe(el)
    return () => {
      io.disconnect()
      if (timer) clearTimeout(timer)
    }
  }, [delayMs])
  return ref
}
