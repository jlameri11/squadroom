'use client'

import { createClient } from '@/lib/supabase/client'
import { isNative, nativePlatform } from './native'

/**
 * Web push, behind an adapter so the Capacitor plugin can replace it without
 * anything above this file changing. Native uses APNs and FCM, which hand
 * back a device token instead of a PushSubscription — same idea, different
 * shape, and only this file should have to know.
 *
 * The native branch is the entire reason phase 9 exists. Safari will not
 * deliver a web push on iPhone until the parent has added the site to their
 * home screen, and most never will — so for half the families in an academy,
 * "notifications are on" has been quietly untrue. A native token has no such
 * condition.
 */

export type PushState = 'unsupported' | 'needs-install' | 'denied' | 'off' | 'on'

const NATIVE_TOKEN_KEY = 'squadroom.push.token'

/**
 * iOS is the awkward one: Safari only permits push once the site has been
 * added to the home screen, and until then the API is simply absent. That is
 * a different message from "you said no", so it gets a different state.
 */
export function pushState(): PushState {
  if (typeof window === 'undefined') return 'unsupported'

  // In the app there is no service worker and no PushManager, and no home
  // screen caveat either. A token we have already saved is the only evidence
  // available synchronously that this device is registered.
  if (isNative()) return localStorage.getItem(NATIVE_TOKEN_KEY) ? 'on' : 'off'

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
  if (isNative()) return enableNativePush()

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

/**
 * The device token arrives asynchronously, in an event, some time after
 * register() resolves — register() only means "the request was made". So this
 * waits for the event rather than reading a return value that does not exist.
 *
 * Imported dynamically so the plugin never enters the web bundle.
 */
async function enableNativePush(): Promise<{ ok: boolean; reason?: string }> {
  const { PushNotifications } = await import('@capacitor/push-notifications')

  let permission = await PushNotifications.checkPermissions()
  if (permission.receive === 'prompt' || permission.receive === 'prompt-with-rationale') {
    permission = await PushNotifications.requestPermissions()
  }
  if (permission.receive !== 'granted') {
    return { ok: false, reason: 'Notifications are turned off for Squadroom in Settings.' }
  }

  const token = await new Promise<string | null>((resolve) => {
    // If neither event fires the phone is in a state we cannot diagnose from
    // here, and hanging forever is worse than saying so.
    const timer = setTimeout(() => resolve(null), 15000)
    void PushNotifications.addListener('registration', (t) => {
      clearTimeout(timer)
      resolve(t.value)
    })
    void PushNotifications.addListener('registrationError', () => {
      clearTimeout(timer)
      resolve(null)
    })
    void PushNotifications.register()
  })

  if (!token) return { ok: false, reason: 'This phone did not return a notification token.' }

  const supabase = createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return { ok: false, reason: 'Sign in first.' }

  // Same table, same unique endpoint column. A device token is an endpoint
  // in every way that matters to the sender.
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      profile_id: auth.user.id,
      endpoint: token,
      p256dh: null,
      auth: null,
      platform: nativePlatform(),
      device_label: navigator.userAgent.slice(0, 80),
      failed_at: null,
      failure_count: 0,
    },
    { onConflict: 'endpoint' }
  )

  if (error) return { ok: false, reason: 'Could not save this device.' }
  localStorage.setItem(NATIVE_TOKEN_KEY, token)
  return { ok: true }
}

export async function disablePush(): Promise<void> {
  if (isNative()) {
    const { PushNotifications } = await import('@capacitor/push-notifications')
    await PushNotifications.removeAllListeners()
    // There is no "unsubscribe" for a device token — Apple and Google keep
    // handing the app the same one. Deleting the row is what stops the
    // sending, so the token is kept locally purely to be able to name which
    // row to delete.
    const token = localStorage.getItem(NATIVE_TOKEN_KEY)
    if (token) {
      const supabase = createClient()
      await supabase.from('push_subscriptions').delete().eq('endpoint', token)
      localStorage.removeItem(NATIVE_TOKEN_KEY)
    }
    return
  }

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
