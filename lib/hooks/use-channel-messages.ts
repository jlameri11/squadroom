'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export type ChatMessage = {
  id: string
  body: string | null
  attachments: unknown
  sender_id: string | null
  sender_name: string | null
  sender_role: string | null
  reply_to_id: string | null
  reply_to_body: string | null
  reply_to_name: string | null
  is_announcement: boolean
  pinned_at: string | null
  created_at: string
  edited_at: string | null
  deleted_at: string | null
  event_id?: string | null
  event?: unknown
}

/**
 * The realtime seam.
 *
 * This is the ONLY place that knows how messages arrive. It currently uses
 * postgres_changes, which is the quickest thing that works and does not
 * scale: Supabase re-evaluates RLS per subscriber per change, so a busy
 * academy multiplies the database's work by the number of people watching.
 *
 * Swapping to broadcast-from-trigger is a change to this file and nothing
 * else. Do it before roughly the twentieth academy, not after.
 */
export function useChannelMessages(channelId: string, initial: ChatMessage[]) {
  const [messages, setMessages] = useState<ChatMessage[]>(initial)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [hasMore, setHasMore] = useState(initial.length >= 50)
  const supabase = useRef(createClient())

  // Re-seed when the caller navigates to a different channel.
  useEffect(() => {
    setMessages(initial)
    setHasMore(initial.length >= 50)
  }, [channelId, initial])

  useEffect(() => {
    const client = supabase.current

    const channel = client
      .channel(`messages:${channelId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `channel_id=eq.${channelId}` },
        async (payload) => {
          const row = payload.new as { id: string }
          // The realtime payload is the raw row: no sender name, no role, and
          // no respect for the tombstone shaping. Re-read through the same
          // function the initial load uses so every message on screen has
          // been through identical rules.
          const { data } = await client.rpc('channel_messages', { p_channel: channelId, p_limit: 1 })
          const fresh = (data ?? []) as ChatMessage[]
          const match = fresh.find((m) => m.id === row.id)
          if (!match) return
          setMessages((prev) => (prev.some((m) => m.id === match.id) ? prev : [...prev, match]))
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `channel_id=eq.${channelId}` },
        (payload) => {
          const row = payload.new as { id: string; deleted_at: string | null; body: string | null; edited_at: string | null }
          setMessages((prev) =>
            prev.map((m) =>
              m.id === row.id
                ? { ...m, body: row.deleted_at ? null : row.body, deleted_at: row.deleted_at, edited_at: row.edited_at }
                : m
            )
          )
        }
      )
      .subscribe()

    return () => {
      client.removeChannel(channel)
    }
  }, [channelId])

  const loadOlder = useCallback(async () => {
    if (loadingOlder || messages.length === 0) return
    setLoadingOlder(true)
    const oldest = messages[0].created_at
    const { data } = await supabase.current.rpc('channel_messages', {
      p_channel: channelId,
      p_before: oldest,
      p_limit: 50,
    })
    const older = ((data ?? []) as ChatMessage[]).slice().reverse()
    setMessages((prev) => [...older, ...prev])
    setHasMore(older.length >= 50)
    setLoadingOlder(false)
  }, [channelId, messages, loadingOlder])

  /** Shown immediately, replaced by the real row when realtime delivers it. */
  const addOptimistic = useCallback((m: ChatMessage) => {
    setMessages((prev) => [...prev, m])
  }, [])

  const replaceOptimistic = useCallback((tempId: string, real: ChatMessage | null) => {
    setMessages((prev) =>
      real
        ? prev.some((m) => m.id === real.id)
          ? prev.filter((m) => m.id !== tempId)
          : prev.map((m) => (m.id === tempId ? real : m))
        : prev.filter((m) => m.id !== tempId)
    )
  }, [])

  return { messages, loadOlder, hasMore, loadingOlder, addOptimistic, replaceOptimistic }
}
