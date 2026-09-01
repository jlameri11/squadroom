/**
 * Service worker: the only part of the app that runs when nobody has it open.
 *
 * Deliberately thin. Everything it knows arrives in the push payload, because
 * it has no session, no Supabase client and no way to ask a question — a
 * service worker that needs to fetch before it can show a notification will
 * show nothing when the network is slow, which is exactly when a parent is
 * driving to the wrong ground.
 */

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { title: 'Squadroom', body: event.data ? event.data.text() : '' }
  }

  const title = payload.title || 'Squadroom'
  const options = {
    body: payload.body || '',
    icon: '/icon-192.png',
    badge: '/badge.png',
    // Collapses repeats from the same channel into one entry rather than a
    // stack of twelve, which is what makes a group chat unbearable.
    tag: payload.tag || payload.url || 'squadroom',
    renotify: true,
    data: { url: payload.url || '/' },
    timestamp: Date.now(),
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      // Reuse a tab that is already open rather than piling up new ones.
      for (const client of windows) {
        if ('focus' in client) {
          client.navigate(target)
          return client.focus()
        }
      }
      return self.clients.openWindow(target)
    })
  )
})
