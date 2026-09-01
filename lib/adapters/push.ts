'use client'

import { createClient } from '@/lib/supabase/client'

/**
 * Web push, behind an adapter so the Capacitor plugin can replace it without
 * anything above this file changing. Native uses APNs and FCM, which hand
 * back a device token instead of a PushSubscription — same idea, different
 * shape, and only this file should have to know.
 */

export type PushState = 'unsupported' | 'needs-install' | 'denied' | 'off' | 'on'

/**
 * iOS is the awkward one: Safari only permits push once the site has been
 * added to the home screen, and until then the API is simply absent. That is
 * a different message from "you said no", so it gets a different state.
 */
export function pushState(): PushState {
  if (typeof window === 'undefined') return 'unsupported'

  const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true

  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return iOS && !standalone ? 'needs-install' : 'unsupported'
  }
  if (Notification.permission === 'denied') return 'denied'
  return Notification.permission === 'granted' ? 'on' : 'off'
}

export async function enablePush(): Promise<{ ok: boolean; reason?: string }> {
  const state = pushState()
  if (state === 'needs-install') {
    return { ok: false, reason: 'On iPhone, add Squadroom to your home screen first.' }
  }
  if (state === 'unsupported') {
    return { ok: false, reason: 'This browser cannot receive notifications.' }
  }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    return { ok: false, reason: 'Notifications are blocked for this site.' }
  }

  const registration = await navigator.serviceWorker.register('/sw.js')
  await navigator.serviceWorker.ready

  const existing = await registration.pushManager.getSubscription()
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(
        process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!
      ),
    }))

  const json = subscription.toJSON()
  const supabase = createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return { ok: false, reason: 'Sign in first.' }

  // endpoint is unique, so re-subscribing on the same device updates rather
  // than accumulating a row per visit.
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      profile_id: auth.user.id,
      endpoint: json.endpoint!,
      p256dh: json.keys?.p256dh ?? null,
      auth: json.keys?.auth ?? null,
      platform: 'web',
      device_label: navigator.userAgent.slice(0, 80),
      failed_at: null,
      failure_count: 0,
    },
    { onConflict: 'endpoint' }
  )

  return error ? { ok: false, reason: 'Could not save this device.' } : { ok: true }
}

export async function disablePush(): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration()
  const subscription = await registration?.pushManager.getSubscription()
  if (!subscription) return

  const supabase = createClient()
  await supabase.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint)
  await subscription.unsubscribe()
}

/**
 * VAPID keys are base64url; PushManager wants raw bytes.
 *
 * Allocating the ArrayBuffer explicitly rather than using Uint8Array.from:
 * the DOM types require a buffer that is definitely an ArrayBuffer, not
 * possibly a SharedArrayBuffer.
 */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const normalised = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(normalised)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}
