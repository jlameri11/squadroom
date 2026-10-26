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
  poll_id?: string | null
  poll?: unknown
}

/**
 * The realtime seam.
 *
 * This is the ONLY place that knows how messages arrive. It uses
 * postgres_changes, which is the quickest thing that works and does not
 * scale: Supabase re-evaluates RLS per subscriber per change, so a busy
 * academy multiplies the database's work by the number of people watching.
 * Swapping to broadcast-from-trigger is a change to this file and nothing
 * else.
 *
 * IT ALSO DOES NOT ARRIVE RELIABLY. Measured: test-chat's realtime step
 * fails about one run in five, with the message written and simply never
 * delivered, while a fresh subscription in isolation delivers 10 out of 10.
 * Recorded as X-18.
 *
 * So delivery here does not depend on the socket alone. Three paths feed the
 * same merge, and a message needs any ONE of them:
 *
 *   1. The subscription, which is instant when it works.
 *   2. A catch-up whenever the tab becomes visible or the window regains
 *      focus. This is the one that matters most in practice and had nothing
 *      behind it: a phone that sleeps kills the socket, so a parent who
 *      locked their phone during training and opened it afterwards saw
 *      nothing new until they navigated away and back.
 *   3. A slow poll while the conversation is actually on screen.
 *
 * All three go through `catchUp`, which merges by id — so an overlap costs
 * nothing and a duplicate is impossible.
 */
export function useChannelMessages(channelId: string, initial: ChatMessage[]) {
  const [messages, setMessages] = useState<ChatMessage[]>(initial)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [hasMore, setHasMore] = useState(initial.length >= 50)
  const supabase = useRef(createClient())

  /**
   * Fetch the recent messages and merge in anything we do not have.
   *
   * Merged by id and re-sorted, so this is safe to call from three places at
   * once and safe to call far more often than necessary. Twenty is enough to
   * cover a socket that was down for a while without being a page of history.
   */
  const catchUp = useCallback(async () => {
    const { data } = await supabase.current.rpc('channel_messages', {
      p_channel: channelId,
      p_limit: 20,
    })
    const recent = (data ?? []) as ChatMessage[]
    if (recent.length === 0) return

    setMessages((prev) => {
      const seen = new Set(prev.map((m) => m.id))
      const missing = recent.filter((m) => !seen.has(m.id))
      if (missing.length === 0) return prev
      return [...prev, ...missing].sort((a, b) => a.created_at.localeCompare(b.created_at))
    })
  }, [channelId])

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
        () => {
          // The realtime payload is the raw row: no sender name, no role, and
          // no respect for the tombstone shaping. Re-read through the same
          // function the initial load uses, so every message on screen has
          // been through identical rules.
          //
          // This used to fetch p_limit: 1 and look for the id it had just
          // been told about. Two messages a second apart — a coach posting
          // twice, or a fixture card following an announcement — and the
          // single row fetched was the wrong one, `find` returned nothing,
          // and the message was dropped on the floor. catchUp takes twenty
          // and merges, so a burst cannot outrun it.
          void catchUp()
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

    // A phone that sleeps kills the socket. Coming back to the app is the
    // moment a parent most expects to see what they missed.
    const onWake = () => {
      if (document.visibilityState === 'visible') void catchUp()
    }
    document.addEventListener('visibilitychange', onWake)
    window.addEventListener('focus', onWake)

    // And a slow sweep while the conversation is on screen, for the messages
    // the socket silently drops. Ten seconds is short enough that nobody
    // notices the gap and long enough to be cheaper than the socket it is
    // backing up: the query is indexed on (channel_id, created_at).
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void catchUp()
    }, 10_000)

    return () => {
      document.removeEventListener('visibilitychange', onWake)
      window.removeEventListener('focus', onWake)
      clearInterval(timer)
      client.removeChannel(channel)
    }
  }, [channelId, catchUp])

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
