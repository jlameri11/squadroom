'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { ChatMessage } from './use-channel-messages'

/**
 * W-08: translations for the messages on screen, in the reader's language.
 *
 * Cached ones come straight from the database; the rest go to the route in
 * one batch per render of new messages, never one request per bubble. A
 * message that could not be translated simply shows its original — the
 * original is always there anyway. The map is keyed by language, so a
 * language change shows nothing stale while the new one loads.
 */
export function useTranslations(messages: ChatMessage[], lang: string | null): Record<string, string> {
  const [state, setState] = useState<{ lang: string | null; map: Record<string, string> }>({ lang: null, map: {} })
  const asked = useRef<{ lang: string | null; ids: Set<string> }>({ lang: null, ids: new Set() })

  useEffect(() => {
    if (!lang) return
    if (asked.current.lang !== lang) asked.current = { lang, ids: new Set() }
    const want = messages.filter((m) => m.body && !m.deleted_at && !asked.current.ids.has(m.id)).map((m) => m.id)
    if (want.length === 0) return
    for (const id of want) asked.current.ids.add(id)
    let cancelled = false
    ;(async () => {
      const { data } = await createClient().rpc('translations_for', { p_message_ids: want, p_lang: lang })
      const cached = (data as unknown as Record<string, string>) ?? {}
      if (cancelled) return
      if (Object.keys(cached).length) setState((prev) => ({ lang, map: { ...(prev.lang === lang ? prev.map : {}), ...cached } }))
      const missing = want.filter((id) => !cached[id])
      if (missing.length === 0) return
      const res = await fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messageIds: missing.slice(0, 30) }) })
      const body = (await res.json().catch(() => ({}))) as { translations?: Record<string, string> }
      if (cancelled || !body.translations) return
      const got = body.translations
      setState((prev) => ({ lang, map: { ...(prev.lang === lang ? prev.map : {}), ...got } }))
    })()
    return () => {
      cancelled = true
    }
  }, [messages, lang])

  return state.lang === lang ? state.map : {}
}
