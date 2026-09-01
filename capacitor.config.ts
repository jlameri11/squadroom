import type { CapacitorConfig } from '@capacitor/cli'

/**
 * The native shell loads the deployed web app rather than a copy bundled
 * inside it.
 *
 * That is a real trade and worth naming. Against: the app needs a network to
 * start, and Apple review is warier of an app whose content is all remote.
 * For: the whole product is Next.js server components reading cookies, which
 * cannot be statically exported without rewriting every page — and the point
 * of this phase is to get notifications working on iPhone, not to spend three
 * weeks re-architecting to get there.
 *
 * What makes it a real app rather than a bookmark is the native layer:
 * APNs push (the thing web push cannot do on iOS unless a parent installs the
 * PWA first), the system contact picker Safari has no equivalent for, and the
 * camera. Those are the plugins below, and they are also the honest answer if
 * a reviewer asks what the app does that the website does not.
 *
 * webDir points at a placeholder that is never shown. Capacitor requires the
 * directory to exist even when server.url is set.
 */
const config: CapacitorConfig = {
  appId: 'app.squadroom.mobile',
  appName: 'Squadroom',
  webDir: 'native/www',
  server: {
    url: process.env.CAP_SERVER_URL ?? 'https://squadroom-dev.netlify.app',
    // Squadroom is https everywhere. Leaving cleartext off means a
    // misconfigured URL fails loudly rather than quietly downgrading.
    cleartext: false,
  },
  ios: {
    // The web app already paints its own background; matching it stops a
    // white flash on launch against the navy header.
    backgroundColor: '#202842',
    contentInset: 'always',
  },
  android: {
    backgroundColor: '#202842',
  },
  plugins: {
    PushNotifications: {
      // Show the alert while the app is open too. A parent reading one
      // channel still needs to know a game was cancelled in another.
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
}

export default config
